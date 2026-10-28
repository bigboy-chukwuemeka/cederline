import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export async function sendCustomerNotificationEmail(
  adminClient: SupabaseClient,
  userId: string,
  subject: string,
  message: string,
  recipientOverride?: string,
) {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('EMAIL_FROM')
  if (!apiKey || !from) return false

  const [userResult, alertPreferencesResult, profilePreferencesResult] = await Promise.all([
    adminClient.from('users').select('email').eq('id', userId).maybeSingle(),
    adminClient.from('alert_preferences').select('email_enabled').eq('user_id', userId).maybeSingle(),
    adminClient.from('profile_preferences').select('account_updates_enabled').eq('user_id', userId).maybeSingle(),
  ])
  if (userResult.error || alertPreferencesResult.error || profilePreferencesResult.error) {
    console.error('Notification email preferences could not be loaded.')
    return false
  }

  const recipient = recipientOverride?.trim() || userResult.data?.email
  const emailEnabled = alertPreferencesResult.data?.email_enabled ?? true
  const accountUpdatesEnabled = profilePreferencesResult.data?.account_updates_enabled ?? true
  if (!recipient || !emailEnabled || !accountUpdatesEnabled) return false

  const appUrl = Deno.env.get('APP_BASE_URL')?.trim()
  const text = [
    message,
    appUrl ? `Sign in to your Cedarline account: ${appUrl}` : 'Sign in to your Cedarline account to view this update.',
    'This automated notice does not include secure account or identity details.',
  ].join('\n\n')

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [recipient], subject, text }),
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) {
      console.error(`Notification email provider returned status ${response.status}.`)
      return false
    }
    return true
  } catch {
    console.error('Notification email request failed.')
    return false
  }
}