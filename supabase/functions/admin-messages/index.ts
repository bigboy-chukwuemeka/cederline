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

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function normalizeSearch(value: unknown) {
  return typeof value === 'string'
    ? value.trim().replace(/[^a-zA-Z0-9@._' -]/g, '').slice(0, 100)
    : ''
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
    return jsonResponse({ error: 'The admin messaging service is not configured.' }, 503)
  }

  const adminAuth = await getVerifiedAdminContext(token, { supabaseUrl, anonKey, serviceRoleKey })
  if (adminAuth.error) return jsonResponse({ error: adminAuth.error }, adminAuth.status)
  const { actor, adminClient } = adminAuth

  let payload: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return jsonResponse({ error: 'The request body must be a JSON object.' }, 400)
    }
    payload = parsed as Record<string, unknown>
  } catch {
    return jsonResponse({ error: 'The request body must be valid JSON.' }, 400)
  }

  if (payload.action === 'inbox') {
    const search = normalizeSearch(payload.search)
    const { data, error } = await adminClient.rpc('admin_message_inbox', {
      p_actor_id: actor.id,
      p_search: search,
      p_limit: 100,
    })
    if (error) {
      console.error('Admin message inbox failed:', error.message)
      return jsonResponse({ error: 'Unable to load the admin message inbox.' }, 500)
    }
    return jsonResponse(data)
  }

  if (payload.action === 'recipients') {
    const search = normalizeSearch(payload.search)
    const { data, error } = await adminClient.rpc('admin_search_message_recipients', {
      p_actor_id: actor.id,
      p_search: search,
      p_limit: 10,
    })
    if (error) {
      console.error('Admin message recipient search failed:', error.message)
      return jsonResponse({ error: 'Unable to search customer recipients.' }, 500)
    }
    return jsonResponse(data)
  }

  if (payload.action === 'thread') {
    if (!isUuid(payload.userId)) return jsonResponse({ error: 'A valid customer user ID is required.' }, 400)
    const { data, error } = await adminClient.rpc('admin_message_thread', {
      p_actor_id: actor.id,
      p_recipient_user_id: payload.userId,
      p_limit: 100,
    })
    if (error) {
      if (error.message.includes('not found')) return jsonResponse({ error: 'The requested user was not found.' }, 404)
      console.error('Admin message thread failed:', error.message)
      return jsonResponse({ error: 'Unable to load this customer conversation.' }, 500)
    }
    return jsonResponse(data)
  }

  if (payload.action === 'send') {
    if (!isUuid(payload.userId)) return jsonResponse({ error: 'A valid customer user ID is required.' }, 400)
    if (typeof payload.subject !== 'string' || payload.subject.trim().length < 1 || payload.subject.trim().length > 120) {
      return jsonResponse({ error: 'Subjects must contain between 1 and 120 characters.' }, 400)
    }
    if (typeof payload.message !== 'string' || payload.message.trim().length < 1 || payload.message.trim().length > 4000) {
      return jsonResponse({ error: 'Messages must contain between 1 and 4,000 characters.' }, 400)
    }
    if (!['normal', 'high', 'urgent'].includes(String(payload.priority))) {
      return jsonResponse({ error: 'Choose a valid message priority.' }, 400)
    }
    if (payload.category != null && payload.category !== ''
      && !['account_alert', 'security', 'general', 'investigation'].includes(String(payload.category))) {
      return jsonResponse({ error: 'Choose a valid message category.' }, 400)
    }
    const { data, error } = await adminClient.rpc('admin_send_message', {
      p_actor_id: actor.id,
      p_recipient_user_id: payload.userId,
      p_subject: payload.subject.trim(),
      p_body: payload.message.trim(),
      p_priority: payload.priority,
      p_category: payload.category || null,
    })
    if (error) {
      if (error.message.includes('not found')) return jsonResponse({ error: 'The requested user was not found.' }, 404)
      if (error.message.includes('between 1 and 120 characters')
        || error.message.includes('between 1 and 4,000 characters')
        || error.message.includes('valid message priority')
        || error.message.includes('valid message category')) return jsonResponse({ error: error.message }, 400)
      console.error('Admin customer message send failed:', error.message)
      return jsonResponse({ error: 'The message could not be sent. No message was delivered.' }, 500)
    }
    const emailSent = await sendCustomerNotificationEmail(
      adminClient,
      payload.userId,
      'A new secure message is available in Cedarline',
      'Cedarline sent you a secure in-app message. Sign in to your account to read it and reply.',
    )
    return jsonResponse({ ...data, emailSent })
  }

  return jsonResponse({ error: 'Unsupported admin messaging action.' }, 400)
})
