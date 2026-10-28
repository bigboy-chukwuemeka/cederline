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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return jsonResponse({ error: 'Authentication is required.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'The admin account service is not configured.' }, 503)
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
    const { data, error } = await adminClient.rpc('admin_list_accounts', {
      p_actor_id: actor.id,
      p_search: typeof body.search === 'string' ? body.search.trim().slice(0, 100) : '',
      p_status: ['active', 'on_hold', 'frozen', 'closed'].includes(String(body.status)) ? body.status : 'all',
      p_account_type: ['checking', 'savings', 'loan', 'cd'].includes(String(body.accountType)) ? body.accountType : 'all',
      p_page: Number.isInteger(body.page) ? body.page : 1,
      p_page_size: Number.isInteger(body.pageSize) ? body.pageSize : 10,
    })
    if (error) return jsonResponse({ error: 'Unable to load the account directory.' }, 500)
    return jsonResponse(data)
  }

  if (body.action === 'details') {
    if (typeof body.accountId !== 'string') return jsonResponse({ error: 'A valid account ID is required.' }, 400)
    const { data, error } = await adminClient.rpc('admin_account_details', {
      p_actor_id: actor.id,
      p_account_id: body.accountId,
    })
    if (error) {
      const status = error.message.includes('not found') ? 404 : 500
      return jsonResponse({ error: status === 404 ? 'The requested account was not found.' : 'Unable to load the secured account details.' }, status)
    }
    return jsonResponse(data)
  }

  const operationActions = ['hold', 'release_hold', 'freeze', 'unfreeze', 'adjust_balance', 'send_money']
  if (operationActions.includes(String(body.action))) {
    if (typeof body.accountId !== 'string') return jsonResponse({ error: 'A valid account ID is required.' }, 400)
    if (body.action !== 'send_money' && (typeof body.reason !== 'string' || body.reason.trim().length < 5 || body.reason.trim().length > 500)) {
      return jsonResponse({ error: 'Provide a reason between 5 and 500 characters.' }, 400)
    }

    const amount = body.action === 'adjust_balance' || body.action === 'send_money' ? Number(body.amount) : null
    if (body.action === 'adjust_balance' && (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1_000_000_000)) {
      return jsonResponse({ error: 'Enter a non-zero adjustment amount within the supported range.' }, 400)
    }
    if (body.action === 'send_money') {
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000 || Math.round(amount * 100) !== amount * 100) {
        return jsonResponse({ error: 'Enter a valid amount greater than $0.00 with no more than two decimal places.' }, 400)
      }
      if (typeof body.senderName !== 'string' || !body.senderName.trim() || body.senderName.trim().length > 80) {
        return jsonResponse({ error: 'Enter a sender name of 1 to 80 characters.' }, 400)
      }
      if (body.memo !== undefined && (typeof body.memo !== 'string' || body.memo.trim().length > 140)) {
        return jsonResponse({ error: 'Memo must be 140 characters or fewer.' }, 400)
      }
      if (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) {
        return jsonResponse({ error: 'A unique funding request key is required.' }, 400)
      }
    }
    const { data, error } = body.action === 'send_money'
      ? await adminClient.rpc('admin_send_account_funds', {
        p_actor_id: actor.id,
        p_account_id: body.accountId,
        p_amount: amount,
        p_sender_name: body.senderName.trim(),
        p_memo: typeof body.memo === 'string' ? body.memo.trim() : '',
        p_request_id: body.requestId,
      })
      : await adminClient.rpc('admin_account_operation', {
        p_actor_id: actor.id,
        p_account_id: body.accountId,
        p_action: body.action,
        p_reason: typeof body.reason === 'string' ? body.reason.trim() : null,
        p_amount: amount,
      })
    if (error) {
      const message = error.message
      const clientError = [
        'Administrator access is required.',
        'The requested account was not found.',
        'Closed accounts cannot be changed.',
        'Provide a reason of at least 5 characters.',
        'Enter a non-zero adjustment amount within the supported range.',
        'The adjustment cannot reduce the account balance below zero.',
        'This account is already on hold.',
        'This account is not on hold.',
        'Only open accounts without an investigation hold can be frozen.',
        'This account is not frozen.',
        'Only open accounts without an investigation hold can have a balance adjustment.',
        'Enter a valid amount greater than $0.00 with no more than two decimal places.',
        'Enter a sender name of 1 to 80 characters.',
        'Memo must be 140 characters or fewer.',
        'Only open accounts without an investigation hold can receive funds.',
        'This account cannot receive supported transfers.',
        'A unique funding request key is required.',
        'This funding request key was already used for a different request.',
      ]
      if (clientError.includes(message)) return jsonResponse({ error: message }, 400)
      console.error('Admin account operation failed:', message)
      return jsonResponse({ error: 'The account operation failed. No change was confirmed.' }, 500)
    }
    return jsonResponse(data)
  }

  return jsonResponse({ error: 'Unsupported admin action.' }, 400)
})
