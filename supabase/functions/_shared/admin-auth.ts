import { createClient, type SupabaseClient, type User } from 'https://esm.sh/@supabase/supabase-js@2'

type AdminAuthFailure = {
  actor: null
  adminClient: null
  error: string
  status: 401 | 403 | 503
}

type AdminAuthSuccess = {
  actor: User
  adminClient: SupabaseClient
  error: null
  status: 200
}

export async function getVerifiedAdminContext(
  token: string,
  config: { supabaseUrl: string; anonKey: string; serviceRoleKey: string },
): Promise<AdminAuthFailure | AdminAuthSuccess> {
  const authClient = createClient(config.supabaseUrl, config.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user: actor }, error: userError } = await authClient.auth.getUser(token)
  if (userError || !actor) {
    return { actor: null, adminClient: null, error: 'Your secure session is invalid or expired. Sign in again.', status: 401 }
  }

  const role = typeof actor.app_metadata?.role === 'string' ? actor.app_metadata.role.toLowerCase() : ''
  const roles = Array.isArray(actor.app_metadata?.roles) ? actor.app_metadata.roles : []
  if (role !== 'admin' && !roles.some((item) => typeof item === 'string' && item.toLowerCase() === 'admin')) {
    return { actor: null, adminClient: null, error: 'Administrator access is required.', status: 403 }
  }

  const adminClient = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const [{ data: claimsData, error: claimsError }, { data: factorsData, error: factorsError }] = await Promise.all([
    authClient.auth.getClaims(token),
    adminClient.auth.admin.mfa.listFactors({ userId: actor.id }),
  ])
  if (claimsError) {
    return { actor: null, adminClient: null, error: 'Unable to verify the administrator session. Sign in again.', status: 401 }
  }
  if (factorsError) {
    return { actor: null, adminClient: null, error: 'Unable to verify administrator two-step security.', status: 503 }
  }

  const hasVerifiedFactor = factorsData.factors.some((factor) => factor.status === 'verified')
  if (hasVerifiedFactor && claimsData.claims.aal !== 'aal2') {
    return { actor: null, adminClient: null, error: 'Complete two-step verification before using the admin workspace.', status: 403 }
  }

  return { actor, adminClient, error: null, status: 200 }
}