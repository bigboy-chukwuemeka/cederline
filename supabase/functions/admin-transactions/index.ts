import { getVerifiedAdminContext } from '../_shared/admin-auth.ts'

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

function parseDate(value: unknown) {
  if (typeof value !== 'string' || !value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
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
    return jsonResponse({ error: 'The admin transaction service is not configured.' }, 503)
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
    const search = typeof body.search === 'string'
      ? body.search.trim().replace(/[^a-zA-Z0-9@._' -]/g, '').slice(0, 100)
      : ''
    const from = parseDate(body.from)
    const to = parseDate(body.to)
    if (body.from && !from) return jsonResponse({ error: 'Enter a valid start date.' }, 400)
    if (body.to && !to) return jsonResponse({ error: 'Enter a valid end date.' }, 400)
    const minAmount = body.minAmount === '' || body.minAmount === undefined || body.minAmount === null ? null : Number(body.minAmount)
    const maxAmount = body.maxAmount === '' || body.maxAmount === undefined || body.maxAmount === null ? null : Number(body.maxAmount)
    if (minAmount !== null && (!Number.isFinite(minAmount) || minAmount < 0)) return jsonResponse({ error: 'Enter a valid non-negative minimum amount.' }, 400)
    if (maxAmount !== null && (!Number.isFinite(maxAmount) || maxAmount < 0)) return jsonResponse({ error: 'Enter a valid non-negative maximum amount.' }, 400)
    if (from && to && from > to) return jsonResponse({ error: 'Start date must be before the end date.' }, 400)
    if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) return jsonResponse({ error: 'Minimum amount must not exceed maximum amount.' }, 400)

    const { data, error } = await adminClient.rpc('admin_list_transactions', {
      p_actor_id: actor.id,
      p_search: search,
      p_status: ['pending', 'posted', 'reversed', 'failed', 'flagged'].includes(String(body.status)) ? body.status : 'all',
      p_type: ['credit', 'debit'].includes(String(body.type)) ? body.type : 'all',
      p_from: from,
      p_to: to,
      p_min_amount: minAmount,
      p_max_amount: maxAmount,
      p_page: Number.isInteger(body.page) ? body.page : 1,
      p_page_size: Number.isInteger(body.pageSize) ? body.pageSize : 10,
    })
    if (error) {
      console.error('Admin transaction list failed:', error.message)
      return jsonResponse({ error: 'Unable to load the platform transaction directory.' }, 500)
    }
    return jsonResponse(data)
  }

  if (body.action === 'details') {
    if (typeof body.transactionId !== 'string') return jsonResponse({ error: 'A valid transaction ID is required.' }, 400)
    const { data, error } = await adminClient.rpc('admin_transaction_details', {
      p_actor_id: actor.id,
      p_transaction_id: body.transactionId,
    })
    if (error) {
      const status = error.message.includes('not found') ? 404 : 500
      if (status === 500) console.error('Admin transaction detail failed:', error.message)
      return jsonResponse({ error: status === 404 ? 'The requested transaction was not found.' : 'Unable to load the secured transaction details.' }, status)
    }
    return jsonResponse(data)
  }

  if (body.action === 'list_external_requests') {
    const { data, error } = await adminClient.rpc('admin_list_external_transfer_requests', {
      p_actor_id: actor.id,
    })
    if (error) {
      console.error('Admin external transfer request list failed:', error.message)
      return jsonResponse({ error: 'Unable to load external transfer requests.' }, 500)
    }
    return jsonResponse(data)
  }

  if (body.action === 'external_request_details') {
    if (!isUuid(body.requestId)) return jsonResponse({ error: 'A valid external transfer request ID is required.' }, 400)
    const { data, error } = await adminClient.rpc('admin_external_transfer_request_details', {
      p_actor_id: actor.id,
      p_request_id: body.requestId,
    })
    if (error) {
      const status = error.message.includes('not found') ? 404 : 500
      if (status === 500) console.error('Admin external transfer request detail failed:', error.message)
      return jsonResponse({ error: status === 404 ? 'The requested external transfer was not found.' : 'Unable to load secured external transfer details.' }, status)
    }
    return jsonResponse(data)
  }

  if (body.action === 'review_external_request') {
    if (!isUuid(body.requestId)) return jsonResponse({ error: 'A valid external transfer request ID is required.' }, 400)
    if (!['approve', 'reject'].includes(String(body.decision))) {
      return jsonResponse({ error: 'Choose approve or reject.' }, 400)
    }
    if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.trim().length > 500)) {
      return jsonResponse({ error: 'Review notes must be 500 characters or fewer.' }, 400)
    }
    if (body.decision === 'reject' && (typeof body.reason !== 'string' || body.reason.trim().length < 5)) {
      return jsonResponse({ error: 'Provide a rejection reason between 5 and 500 characters.' }, 400)
    }
    if (body.responsePrompt !== undefined && body.responsePrompt !== null
      && (typeof body.responsePrompt !== 'string'
        || body.responsePrompt.trim().length < 1
        || body.responsePrompt.trim().length > 160)) {
      return jsonResponse({ error: 'The customer input label must contain between 1 and 160 characters.' }, 400)
    }
    const decision = body.decision === 'approve' ? 'approve' : 'reject'
    const { data, error } = await adminClient.rpc('admin_review_external_transfer_request', {
      p_actor_id: actor.id,
      p_request_id: body.requestId,
      p_decision: decision,
      p_reason: typeof body.reason === 'string' ? body.reason.trim() : '',
      p_response_prompt: typeof body.responsePrompt === 'string' ? body.responsePrompt.trim() : null,
    })
    if (error) {
      const knownErrors = [
        'Administrator access is required.',
        'Choose approve or reject.',
        'The requested external transfer was not found.',
        'This external transfer request is no longer awaiting review.',
      ]
      if (knownErrors.includes(error.message) || error.message.startsWith('Provide a rejection reason') || error.message.startsWith('The customer input label')) {
        return jsonResponse({ error: error.message }, 400)
      }
      console.error('Admin external transfer review failed:', error.message)
      return jsonResponse({ error: 'The external transfer request could not be reviewed.' }, 500)
    }
    return jsonResponse(data)
  }

  if (body.action === 'flag') {
    if (typeof body.transactionId !== 'string') return jsonResponse({ error: 'A valid transaction ID is required.' }, 400)
    if (typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.trim().length > 500) {
      return jsonResponse({ error: 'Provide a flag reason between 5 and 500 characters.' }, 400)
    }
    const { data, error } = await adminClient.rpc('admin_flag_transaction', {
      p_actor_id: actor.id,
      p_transaction_id: body.transactionId,
      p_reason: body.reason.trim(),
    })
    if (error) {
      const knownErrors = [
        'Administrator access is required.',
        'Provide a flag reason between 5 and 500 characters.',
        'The requested transaction was not found.',
        'This transaction is already flagged.',
        'Transfers awaiting approval must be reviewed, not flagged as posted transactions.',
      ]
      if (knownErrors.includes(error.message)) return jsonResponse({ error: error.message }, 400)
      console.error('Admin transaction flag failed:', error.message)
      return jsonResponse({ error: 'The transaction could not be flagged.' }, 500)
    }
    return jsonResponse(data)
  }

  if (body.action === 'unflag') {
    if (typeof body.transactionId !== 'string') return jsonResponse({ error: 'A valid transaction ID is required.' }, 400)
    const { data, error } = await adminClient.rpc('admin_unflag_transaction', {
      p_actor_id: actor.id,
      p_transaction_id: body.transactionId,
    })
    if (error) {
      const knownErrors = [
        'Administrator access is required.',
        'The requested transaction was not found.',
        'This transaction is not flagged.',
      ]
      if (knownErrors.includes(error.message)) return jsonResponse({ error: error.message }, 400)
      console.error('Admin transaction unflag failed:', error.message)
      return jsonResponse({ error: 'The transaction flag could not be removed.' }, 500)
    }
    return jsonResponse(data)
  }

  if (body.action === 'review_transfer') {
    if (typeof body.transferId !== 'string') return jsonResponse({ error: 'A valid transfer ID is required.' }, 400)
    if (!['approve', 'reject'].includes(String(body.decision))) {
      return jsonResponse({ error: 'Choose approve or reject.' }, 400)
    }
    const decision = body.decision === 'approve' ? 'approve' : 'reject'
    if (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.trim().length > 500)) {
      return jsonResponse({ error: 'Approval notes must be 500 characters or fewer.' }, 400)
    }
    if (decision === 'reject' && (typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.trim().length > 500)) {
      return jsonResponse({ error: 'Provide a rejection reason between 5 and 500 characters.' }, 400)
    }
    const { data, error } = await adminClient.rpc('admin_review_pending_transfer', {
      p_actor_id: actor.id,
      p_transfer_id: body.transferId,
      p_decision: decision,
      p_reason: typeof body.reason === 'string' ? body.reason.trim() : '',
    })
    if (error) {
      const knownErrors = [
        'Administrator access is required.',
        'Choose approve or reject.',
        'Provide a rejection reason between 5 and 500 characters.',
        'Approval note must be 500 characters or fewer.',
        'The requested transfer was not found.',
        'This transfer is no longer awaiting review.',
        'The sender or recipient account is no longer eligible for this transfer.',
        'The sender account no longer has enough funds for this transfer.',
        'The loan balance is no longer sufficient for this payment.',
        'This transfer does not have a complete pair of pending transaction records.',
      ]
      if (knownErrors.includes(error.message)) return jsonResponse({ error: error.message }, 400)
      console.error('Admin pending transfer review failed:', error.message)
      return jsonResponse({ error: 'The transfer review could not be completed.' }, 500)
    }
    return jsonResponse(data)
  }

  return jsonResponse({ error: 'Unsupported admin transaction action.' }, 400)
})
