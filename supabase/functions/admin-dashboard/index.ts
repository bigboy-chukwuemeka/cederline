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
    return jsonResponse({ error: 'The admin dashboard service is not configured.' }, 503)
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

  if (body.action !== 'summary') return jsonResponse({ error: 'Unsupported admin dashboard action.' }, 400)

  const { data, error } = await adminClient.rpc('admin_dashboard_summary', {
    p_actor_id: actor.id,
  })
  if (error) {
    console.error('Admin dashboard summary failed:', error.message)
    return jsonResponse({ error: 'Unable to load secured administrator dashboard data.' }, 500)
  }

  return jsonResponse(data)
})
