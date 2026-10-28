import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const bucket = 'identity-documents'
const maximumFileSize = 10 * 1024 * 1024
const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'application/pdf'])

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function safeFileName(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.replace(/[^\w.-]/g, '_').slice(-120)
}

function isValidBirthDate(value: unknown) {
  if (typeof value !== 'string' || !/^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/.test(value)) return false
  const [month, day, year] = value.split('/').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function isValidDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function getExtension(mimeType: string) {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'pdf'
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'The KYC submission service is not configured.' }, 503)
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'The request body must be valid JSON.' }, 400)
  }

  const userId = typeof body.userId === 'string' ? body.userId : ''
  const token = typeof body.token === 'string' ? body.token : ''
  if (!userId || token.length < 32 || token.length > 200) {
    return jsonResponse({ error: 'The secure application submission could not be verified.' }, 401)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: userResult, error: userError } = await admin.auth.admin.getUserById(userId)
  if (userError || !userResult.user) {
    return jsonResponse({ error: 'The application account could not be verified.' }, 401)
  }

  const user = userResult.user
  const metadataToken = user.user_metadata?.kyc_submission_token
  const existingApplication = await admin
    .from('kyc_applications')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (existingApplication.error) {
    console.error('KYC submission lookup failed:', existingApplication.error.message)
    return jsonResponse({ error: 'Unable to verify the application status.' }, 500)
  }
  if (existingApplication.data) return jsonResponse({ submitted: true })
  if (metadataToken !== token) {
    return jsonResponse({ error: 'The secure application submission has expired. Please contact support.' }, 401)
  }

  if (body.action === 'prepare') {
    const files = body.files
    if (!Array.isArray(files) || files.length < 1 || files.length > 2) {
      return jsonResponse({ error: 'Upload the required front and back identity files.' }, 400)
    }

    const signedUploads: Array<{ path: string; token: string }> = []
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      if (!file || typeof file !== 'object') return jsonResponse({ error: 'An identity file is invalid.' }, 400)
      const mimeType = file.mime_type
      const size = Number(file.size_bytes)
      const originalFileName = safeFileName(file.original_file_name)
      if (
        typeof mimeType !== 'string' ||
        !allowedMimeTypes.has(mimeType) ||
        !Number.isSafeInteger(size) ||
        size < 1 ||
        size > maximumFileSize ||
        !originalFileName
      ) {
        return jsonResponse({ error: 'Choose a valid JPG, PNG, or PDF file under 10 MB.' }, 400)
      }

      const path = `${userId}/${crypto.randomUUID()}-${index}.${getExtension(mimeType)}`
      const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path)
      if (error || !data?.token) {
        console.error('KYC signed upload URL creation failed:', error?.message)
        return jsonResponse({ error: 'Unable to prepare secure identity document upload.' }, 500)
      }
      signedUploads.push({ path, token: data.token })
    }
    return jsonResponse({ uploads: signedUploads })
  }

  if (body.action !== 'submit') return jsonResponse({ error: 'Unsupported KYC submission action.' }, 400)

  const formData = body.formData
  const documents = body.documents
  if (!formData || typeof formData !== 'object' || Array.isArray(formData) || !Array.isArray(documents)) {
    return jsonResponse({ error: 'Complete application details and identity files are required.' }, 400)
  }

  const application = formData as Record<string, unknown>
  const requiredFields = [
    'firstName',
    'lastName',
    'username',
    'phone',
    'streetAddress',
    'city',
    'state',
    'postalCode',
    'governmentIdNumber',
  ]
  const missingRequiredField = requiredFields.some((field) => {
    const value = application[field]
    return typeof value !== 'string' || !value.trim()
  })
  const phoneDigits = typeof application.phone === 'string' ? application.phone.replace(/\D/g, '') : ''
  if (
    typeof user.email !== 'string' ||
    typeof application.email !== 'string' ||
    application.email.trim().toLowerCase() !== user.email.toLowerCase() ||
    missingRequiredField ||
    !isValidBirthDate(application.dateOfBirth) ||
    typeof application.taxId !== 'string' ||
    !/^\d{3}-?\d{2}-?\d{4}$/.test(application.taxId) ||
    !isValidDate(application.governmentIdExpiration) ||
    !['drivers-license', 'state-id', 'passport'].includes(String(application.governmentIdType)) ||
    !['employed', 'self-employed', 'unemployed', 'retired', 'other'].includes(String(application.employmentStatus)) ||
    !['yes', 'no'].includes(String(application.isStudent)) ||
    !['mobile', 'home'].includes(String(application.phoneType)) ||
    typeof application.mailingAddressDifferent !== 'boolean' ||
    !/^[A-Za-z0-9_]{3,32}$/.test(String(application.username)) ||
    !(phoneDigits.length === 10 || (phoneDigits.length === 11 && phoneDigits.startsWith('1'))) ||
    (application.mailingAddressDifferent && [
      'mailingStreetAddress', 'mailingCity', 'mailingState', 'mailingPostalCode',
    ].some((field) => {
      const value = application[field]
      return typeof value !== 'string' || !value.trim()
    }))
  ) {
    return jsonResponse({ error: 'Review the applicant details and correct any missing or invalid information.' }, 400)
  }

  const expectedDocumentTypes = application.governmentIdType === 'passport'
    ? (documents.length === 2 ? ['passport', 'passport_back'] : ['passport'])
    : application.governmentIdType === 'state-id'
      ? ['state_id_front', 'state_id_back']
      : ['drivers_license_front', 'drivers_license_back']
  if (
    documents.length !== expectedDocumentTypes.length ||
    documents.some((document, index) => document?.document_type !== expectedDocumentTypes[index])
  ) {
    return jsonResponse({ error: 'The selected identity document requires the correct front and back files.' }, 400)
  }

  const normalizedDocuments: Array<{
    document_type: string
    storage_path: string
    original_file_name: string
    mime_type: string
    size_bytes: number
    expires_at: string
  }> = []
  for (const document of documents) {
    if (!document || typeof document !== 'object') return jsonResponse({ error: 'An identity document entry is invalid.' }, 400)
    const path = typeof document.storage_path === 'string' ? document.storage_path : ''
    const mimeType = document.mime_type
    const size = Number(document.size_bytes)
    const originalFileName = safeFileName(document.original_file_name)
    const documentType = typeof document.document_type === 'string' ? document.document_type : ''
    const expirationDate = document.expires_at
    if (
      !path.startsWith(`${userId}/`) ||
      !allowedMimeTypes.has(String(mimeType)) ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > maximumFileSize ||
      !originalFileName ||
      expirationDate !== application.governmentIdExpiration ||
      !['drivers_license_front', 'drivers_license_back', 'state_id_front', 'state_id_back', 'passport', 'passport_back'].includes(documentType)
    ) {
      return jsonResponse({ error: 'An uploaded identity file could not be verified.' }, 400)
    }
    normalizedDocuments.push({
      document_type: documentType,
      storage_path: path,
      mime_type: mimeType,
      size_bytes: size,
      original_file_name: originalFileName,
      expires_at: String(expirationDate),
    })
  }

  const { data: signedFiles, error: storageError } = await admin
    .storage
    .from(bucket)
    .createSignedUrls(normalizedDocuments.map((document) => document.storage_path), 30)
  if (storageError || !signedFiles || signedFiles.some((file) => file.error)) {
    return jsonResponse({ error: 'Upload all identity files before submitting the application.' }, 400)
  }

  const allowedFields = [
    'firstName', 'lastName', 'email', 'username', 'phone', 'phoneType',
    'taxId', 'dateOfBirth', 'employmentStatus', 'isStudent', 'promoCode', 'bankerId',
    'governmentIdType', 'governmentIdNumber', 'governmentIdExpiration', 'frontImage', 'backImage',
    'streetAddress', 'addressLine2', 'city', 'state', 'postalCode', 'mailingAddressDifferent',
    'mailingStreetAddress', 'mailingAddressLine2', 'mailingCity', 'mailingState', 'mailingPostalCode',
  ]
  const persistedFormData: Record<string, unknown> = {}
  for (const field of allowedFields) {
    const value = application[field]
    if (field === 'mailingAddressDifferent') {
      persistedFormData[field] = value === true
    } else if (typeof value === 'string') {
      persistedFormData[field] = value.trim().slice(0, field === 'taxId' || field === 'governmentIdNumber' ? 200 : 500)
    }
  }

  const { data: submission, error: submissionError } = await admin.rpc('submit_customer_kyc_application', {
    p_user_id: userId,
    p_form_data: persistedFormData,
    p_documents: normalizedDocuments,
  })
  if (submissionError) {
    console.error('KYC application persistence failed:', submissionError.message)
    const { error: cleanupError } = await admin.storage
      .from(bucket)
      .remove(normalizedDocuments.map((document) => document.storage_path))
    if (cleanupError) console.error('Uncommitted KYC identity file cleanup failed:', cleanupError.message)
    return jsonResponse({ error: 'Your application could not be saved. Please try again.' }, 500)
  }

  const { error: tokenError } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: { ...user.user_metadata, kyc_submission_token: null },
  })
  if (tokenError) console.error('KYC submission token cleanup failed:', tokenError.message)

  return jsonResponse({ ...submission, submitted: true })
})
