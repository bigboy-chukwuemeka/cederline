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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed.' }, 405)

  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return jsonResponse({ error: 'Authentication is required.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'The admin audit-log service is not configured.' }, 503)
  }

  const adminAuth = await getVerifiedAdminContext(token, { supabaseUrl, anonKey, serviceRoleKey })
  if (adminAuth.error) return jsonResponse({ error: adminAuth.error }, adminAuth.status)
  const { actor, adminClient } = adminAuth

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return jsonResponse({ error: 'The request body must be a JSON object.' }, 400)
    }
    body = parsed as Record<string, unknown>
  } catch {
    return jsonResponse({ error: 'The request body must be valid JSON.' }, 400)
  }

  if (body.action !== 'list') return jsonResponse({ error: 'Unsupported audit-log action.' }, 400)

  const adminSearch = typeof body.adminSearch === 'string'
    ? body.adminSearch.trim().replace(/[^a-zA-Z0-9@._' -]/g, '').slice(0, 100)
    : ''
  const action = typeof body.actionType === 'string' && body.actionType.trim()
    ? body.actionType.trim().slice(0, 100)
    : 'all'
  const from = parseDate(body.from)
  const to = parseDate(body.to)
  if (body.from && !from) return jsonResponse({ error: 'Enter a valid start date.' }, 400)
  if (body.to && !to) return jsonResponse({ error: 'Enter a valid end date.' }, 400)
  if (from && to && from > to) return jsonResponse({ error: 'Start date must be before the end date.' }, 400)

  const page = Number.isInteger(body.page) && Number(body.page) > 0 ? Number(body.page) : 1
  const pageSize = Number.isInteger(body.pageSize) ? Math.min(Math.max(Number(body.pageSize), 1), 100) : 20
  const { data, error } = await adminClient.rpc('admin_list_audit_logs', {
    p_actor_id: actor.id,
    p_admin_search: adminSearch,
    p_action: action,
    p_from: from,
    p_to: to,
    p_page: page,
    p_page_size: pageSize,
  })
  if (error) {
    console.error('Admin audit-log list failed:', error.message)
    return jsonResponse({ error: 'Unable to load the administrator audit log.' }, 500)
  }

  return jsonResponse(data)
})
