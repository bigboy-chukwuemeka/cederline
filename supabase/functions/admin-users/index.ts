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

  const authorization = request.headers.get('Authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return jsonResponse({ error: 'Authentication is required.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: 'The admin user service is not configured.' }, 503)
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
    const page = Number.isInteger(body.page) && Number(body.page) > 0 ? Number(body.page) : 1
    const pageSize = Number.isInteger(body.pageSize) ? Math.min(Math.max(Number(body.pageSize), 1), 50) : 10
    const start = (page - 1) * pageSize
    let query = adminClient
      .from('users')
      .select('id, email, display_name, is_active, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(start, start + pageSize - 1)

    if (body.status === 'active') query = query.eq('is_active', true)
    if (body.status === 'locked') query = query.eq('is_active', false)
    if (typeof body.joinedAfter === 'string' && !Number.isNaN(Date.parse(body.joinedAfter))) {
      query = query.gte('created_at', body.joinedAfter)
    }
    if (typeof body.search === 'string' && body.search.trim()) {
      const safeSearch = body.search.trim().replace(/[^a-zA-Z0-9@._' -]/g, '').slice(0, 80)
      if (safeSearch) query = query.or(`display_name.ilike."*${safeSearch}*",email.ilike."*${safeSearch}*"`)
    }

    const { data: users, count, error } = await query
    if (error) return jsonResponse({ error: 'Unable to load the user directory.' }, 500)
    return jsonResponse({ users: users || [], total: count || 0 })
  }

  if (body.action === 'details') {
    if (typeof body.userId !== 'string') return jsonResponse({ error: 'A valid user ID is required.' }, 400)
    const { data: user, error: userError } = await adminClient
      .from('users')
      .select('id, email, display_name, phone_e164, is_active, created_at')
      .eq('id', body.userId)
      .maybeSingle()
    if (userError) return jsonResponse({ error: 'Unable to load this user.' }, 500)
    if (!user) return jsonResponse({ error: 'The requested user was not found.' }, 404)

    const [profileResult, documentResult, accountResult] = await Promise.all([
      adminClient
        .from('user_profiles')
        .select('legal_first_name, legal_middle_name, legal_last_name')
        .eq('user_id', body.userId)
        .maybeSingle(),
      adminClient
        .from('identity_documents')
        .select('id, document_type, status, submitted_at')
        .eq('user_id', body.userId)
        .order('submitted_at', { ascending: false }),
      adminClient
        .from('accounts')
        .select('id, name, account_type, status, account_number')
        .eq('user_id', body.userId)
        .order('created_at', { ascending: false }),
    ])

    if (profileResult.error || documentResult.error || accountResult.error) {
      return jsonResponse({ error: 'Unable to load all secured details for this user.' }, 500)
    }

    const { error: auditError } = await adminClient.from('audit_logs').insert({
      actor_user_id: actor.id,
      subject_user_id: body.userId,
      action: 'admin_view_user',
      resource_type: 'user',
      resource_id: body.userId,
    })
    if (auditError) return jsonResponse({ error: 'Unable to record the required audit entry. User details were not returned.' }, 500)

    return jsonResponse({
      user,
      profile: profileResult.data,
      documents: documentResult.data || [],
      accounts: (accountResult.data || []).map((account) => ({
        id: account.id,
        name: account.name,
        account_type: account.account_type,
        status: account.status,
        last_four: account.account_number.slice(-4),
      })),
    })
  }

  if (body.action === 'lock' || body.action === 'unlock') {
    if (typeof body.userId !== 'string' || body.userId === actor.id) {
      return jsonResponse({ error: 'A different valid user ID is required.' }, 400)
    }
    const shouldLock = body.action === 'lock'
    const { data: target, error: targetError } = await adminClient.auth.admin.getUserById(body.userId)
    if (targetError || !target.user) return jsonResponse({ error: 'The requested user was not found.' }, 404)

    const { data: currentProfile, error: profileLookupError } = await adminClient
      .from('users')
      .select('id, is_active')
      .eq('id', body.userId)
      .maybeSingle()
    if (profileLookupError || !currentProfile) return jsonResponse({ error: 'Unable to verify the user account status.' }, 500)
    if (currentProfile.is_active === !shouldLock) return jsonResponse({ is_active: !shouldLock })

    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(body.userId, {
      ban_duration: shouldLock ? '876000h' : 'none',
    })
    if (authUpdateError) return jsonResponse({ error: 'Supabase Auth could not update the login restriction.' }, 500)

    const { error: statusUpdateError } = await adminClient
      .from('users')
      .update({ is_active: !shouldLock })
      .eq('id', body.userId)
    if (statusUpdateError) {
      const { error: rollbackError } = await adminClient.auth.admin.updateUserById(body.userId, {
        ban_duration: shouldLock ? 'none' : '876000h',
      })
      return jsonResponse({
        error: rollbackError
          ? 'The profile status update failed and the Auth restriction could not be rolled back. Contact an administrator before changing this account again.'
          : 'The profile status update failed. The Auth change was rolled back.',
      }, 500)
    }

    const { error: auditError } = await adminClient.from('audit_logs').insert({
      actor_user_id: actor.id,
      subject_user_id: body.userId,
      action: shouldLock ? 'admin_lock_user_login' : 'admin_unlock_user_login',
      resource_type: 'user',
      resource_id: body.userId,
    })
    if (auditError) {
      const { error: statusRollbackError } = await adminClient
        .from('users')
        .update({ is_active: currentProfile.is_active })
        .eq('id', body.userId)
      const { error: authRollbackError } = await adminClient.auth.admin.updateUserById(body.userId, {
        ban_duration: shouldLock ? 'none' : '876000h',
      })
      return jsonResponse({
        error: statusRollbackError || authRollbackError
          ? 'The audit entry failed and the login change could not be fully rolled back. Contact an administrator before changing this account again.'
          : 'The audit entry failed. The login change was rolled back.',
      }, 500)
    }
    return jsonResponse({ is_active: !shouldLock })
  }

  return jsonResponse({ error: 'Unsupported admin action.' }, 400)
})
