import { getVerifiedAdminContext } from '../_shared/admin-auth.ts'
import { sendCustomerNotificationEmail } from '../_shared/send-notification-email.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return jsonResponse({ error: 'Authentication is required.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'The admin application service is not configured.' }, 503)
  }

  const adminAuth = await getVerifiedAdminContext(token, { supabaseUrl, anonKey, serviceRoleKey })
  if (adminAuth.error) return jsonResponse({ error: adminAuth.error }, adminAuth.status)
  const { actor, adminClient } = adminAuth
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'The request body must be valid JSON.' }, 400)
  }

  if (body.action === 'list') {
    const { data, error } = await adminClient.rpc('admin_list_kyc_applications', {
      p_actor_id: actor.id,
      p_search: typeof body.search === 'string' ? body.search.trim().slice(0, 100) : '',
      p_status: ['pending', 'approved', 'rejected'].includes(String(body.status)) ? body.status : 'all',
      p_page: Number.isInteger(body.page) ? body.page : 1,
      p_page_size: Number.isInteger(body.pageSize) ? body.pageSize : 10,
    })
    if (error) {
      console.error('Admin application list failed:', error.message)
      return jsonResponse({ error: 'Unable to load KYC applications.' }, 500)
    }
    return jsonResponse(data)
  }

  if (body.action === 'details') {
    if (typeof body.userId !== 'string') return jsonResponse({ error: 'A valid applicant ID is required.' }, 400)
    const { data, error } = await adminClient.rpc('admin_kyc_application_details', {
      p_actor_id: actor.id,
      p_user_id: body.userId,
    })
    if (error) {
      const status = error.message.includes('not found') ? 404 : 500
      if (status === 500) console.error('Admin application detail failed:', error.message)
      return jsonResponse({ error: status === 404 ? 'The requested applicant was not found.' : 'Unable to load secured applicant details.' }, status)
    }

    const [{ data: application, error: applicationError }, { data: savedDocuments, error: documentsError }] = await Promise.all([
      adminClient
        .from('kyc_applications')
        .select('form_data, status, submitted_at, reviewed_at, review_reason')
        .eq('user_id', body.userId)
        .maybeSingle(),
      adminClient
        .from('identity_documents')
        .select('id, original_file_name, mime_type, size_bytes, expires_at')
        .eq('user_id', body.userId),
    ])
    if (applicationError || documentsError) {
      console.error('Admin application records failed:', applicationError?.message || documentsError?.message)
      return jsonResponse({ error: 'Unable to load the saved application form and document records.' }, 500)
    }

    const savedDocumentById = new Map((savedDocuments || []).map((document) => [document.id, document] as const))
    const documentRecords = (data.documents || []).map((document: { id: string; storage_path: string }) => ({
      ...document,
      ...savedDocumentById.get(document.id),
    }))
    const documentPaths = documentRecords.map((document: { storage_path: string }) => document.storage_path)
    const signedUrls = new Map<string, string>()
    let documentAccessError: string | null = null
    if (documentPaths.length) {
      const { data: signedDocuments, error: storageError } = await adminClient
        .storage
        .from('identity-documents')
        .createSignedUrls(documentPaths, 60)
      if (storageError || !signedDocuments) {
        console.error('Admin identity document signing failed:', storageError?.message)
        documentAccessError = 'Unable to securely open identity documents. Confirm the private identity-documents bucket and stored files exist.'
      } else {
        for (const signedDocument of signedDocuments) {
          if (signedDocument.error || !signedDocument.path || !signedDocument.signedUrl) {
            console.error('Identity document has no readable private storage object:', signedDocument.error || signedDocument.path)
            documentAccessError = 'One or more stored identity files are unavailable.'
            continue
          }
          signedUrls.set(signedDocument.path, signedDocument.signedUrl)
        }
      }
    }

    const documents = documentRecords.map((document: { storage_path: string; [key: string]: unknown }) => {
      const { storage_path: storagePath, ...safeDocument } = document
      return { ...safeDocument, signed_url: signedUrls.get(storagePath) || null }
    })
    return jsonResponse({ ...data, application, documents, document_access_error: documentAccessError })
  }

  if (body.action === 'review') {
    if (typeof body.userId !== 'string') return jsonResponse({ error: 'A valid applicant ID is required.' }, 400)
    if (!['approved', 'rejected'].includes(String(body.decision))) return jsonResponse({ error: 'Choose approve or reject.' }, 400)
    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (body.decision === 'rejected' && reason.length < 5) {
      return jsonResponse({ error: 'Enter a rejection reason of at least 5 characters.' }, 400)
    }
    if (reason.length > 1000) return jsonResponse({ error: 'The review reason must be 1000 characters or fewer.' }, 400)

    const { data, error } = await adminClient.rpc('admin_review_kyc_application', {
      p_actor_id: actor.id,
      p_user_id: body.userId,
      p_decision: body.decision,
      p_reason: reason,
    })
    if (error) {
      const knownErrors = [
        'Administrator access is required.',
        'Choose an approval or rejection decision.',
        'A rejection reason of at least 5 characters is required.',
        'The review reason must be 1000 characters or fewer.',
        'This applicant has no pending identity documents to review.',
      ]
      if (knownErrors.includes(error.message)) return jsonResponse({ error: error.message }, 400)
      console.error('KYC review action failed:', error.message)
      return jsonResponse({ error: 'The review decision could not be completed.' }, 500)
    }
    const approved = body.decision === 'approved'
    const emailSent = await sendCustomerNotificationEmail(
      adminClient,
      body.userId,
      approved ? 'Your Cedarline application was approved' : 'An update is available for your Cedarline application',
      approved
        ? 'Your identity verification was approved. Your Cedarline account is ready to use.'
        : 'Your identity verification was not approved. Sign in to your Cedarline account to review the decision and next steps.',
    )
      return jsonResponse({ ...data, emailSent })
  }

  return jsonResponse({ error: 'Unsupported admin application action.' }, 400)
})
