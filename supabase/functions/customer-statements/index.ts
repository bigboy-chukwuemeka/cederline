import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'https://esm.sh/pdf-lib@1.17.1'
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

function cleanPdfText(value: unknown) {
  return String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '?')
}

function truncatePdfText(value: unknown, font: PDFFont, size: number, maxWidth: number) {
  const text = cleanPdfText(value)
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text
  let shortened = text
  while (shortened.length > 0 && font.widthOfTextAtSize(`${shortened}...`, size) > maxWidth) {
    shortened = shortened.slice(0, -1)
  }
  return `${shortened}...`
}

function formatPeriodDate(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(value)
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(value)
}

async function buildStatementPdf({
  account,
  periodStart,
  periodEnd,
  transactions,
  openingBalance,
}: {
  account: { name: string | null; account_type: string; account_number: string; currency: string }
  periodStart: Date
  periodEnd: Date
  transactions: Array<{
    occurred_at: string
    transaction_type: 'credit' | 'debit'
    amount: number
    balance_after: number | null
    description: string
    counterparty_name: string | null
    reference: string | null
  }>
  openingBalance: number
}) {
  const document = await PDFDocument.create()
  const regular = await document.embedFont(StandardFonts.Helvetica)
  const bold = await document.embedFont(StandardFonts.HelveticaBold)
  const currency = account.currency.trim() || 'USD'
  const credits = transactions
    .filter((transaction) => transaction.transaction_type === 'credit')
    .reduce((sum, transaction) => sum + Number(transaction.amount), 0)
  const debits = transactions
    .filter((transaction) => transaction.transaction_type === 'debit')
    .reduce((sum, transaction) => sum + Number(transaction.amount), 0)
  const closingBalance = transactions.length
    ? transactions.reduce((balance, transaction) => transaction.balance_after == null
      ? balance + (transaction.transaction_type === 'credit' ? 1 : -1) * Number(transaction.amount)
      : Number(transaction.balance_after), openingBalance)
    : openingBalance

  document.setTitle(`Cedarline statement ${periodStart.toISOString().slice(0, 7)}`)
  document.setAuthor('Cedarline')
  document.setSubject('Monthly account statement')

  const pageSize: [number, number] = [612, 792]
  const margin = 44
  const ink = rgb(0.12, 0.2, 0.16)
  const muted = rgb(0.35, 0.42, 0.38)
  const green = rgb(0.18, 0.38, 0.12)
  const border = rgb(0.83, 0.87, 0.84)
  let page = document.addPage(pageSize)
  let y = 742

  function drawText(text: string, x: number, top: number, size: number, font = regular, color = ink) {
    page.drawText(cleanPdfText(text), { x, y: top - size, size, font, color })
  }

  function drawRule(top: number) {
    page.drawLine({ start: { x: margin, y: top }, end: { x: pageSize[0] - margin, y: top }, thickness: 0.7, color: border })
  }

  function drawTableHeader() {
    drawText('Date', margin, y, 8, bold, muted)
    drawText('Description', 103, y, 8, bold, muted)
    drawText('Debit', 338, y, 8, bold, muted)
    drawText('Credit', 412, y, 8, bold, muted)
    drawText('Balance', 488, y, 8, bold, muted)
    y -= 9
    drawRule(y)
    y -= 14
  }

  drawText('CEDARLINE', margin, y, 12, bold, green)
  drawText('MONTHLY ACCOUNT STATEMENT', margin, y - 19, 16, bold)
  drawText(`${formatPeriodDate(periodStart)} – ${formatPeriodDate(periodEnd)}`, margin, y - 43, 9, regular, muted)
  y -= 76
  drawRule(y)
  y -= 18

  const accountName = account.name || account.account_type.replaceAll('_', ' ')
  drawText(`${accountName} account`, margin, y, 10, bold)
  drawText(`Account ending in ${account.account_number.slice(-4)}`, margin, y - 15, 9, regular, muted)
  y -= 48

  const summary = [
    ['Opening balance', openingBalance],
    ['Credits', credits],
    ['Debits', debits],
    ['Closing balance', closingBalance],
  ] as const
  const summaryWidth = (pageSize[0] - margin * 2) / summary.length
  summary.forEach(([label, amount], index) => {
    const x = margin + summaryWidth * index
    drawText(label, x, y, 8, regular, muted)
    drawText(formatMoney(amount, currency), x, y - 16, 10, bold)
  })
  y -= 51
  drawRule(y)
  y -= 17
  drawTableHeader()

  if (!transactions.length) {
    drawText('No posted transactions during this statement period.', margin, y, 9, regular, muted)
  }

  for (const transaction of transactions) {
    if (y < 62) {
      page = document.addPage(pageSize)
      y = 742
      drawText('CEDARLINE · ACCOUNT STATEMENT', margin, y, 10, bold, green)
      y -= 24
      drawTableHeader()
    }
    const date = new Intl.DateTimeFormat('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(transaction.occurred_at))
    const description = truncatePdfText(
      [transaction.description, transaction.counterparty_name].filter(Boolean).join(' · '),
      regular,
      8,
      225,
    )
    const balance = transaction.balance_after == null
      ? ''
      : formatMoney(Number(transaction.balance_after), currency)
    drawText(date, margin, y, 8)
    drawText(description, 103, y, 8)
    if (transaction.transaction_type === 'debit') drawText(formatMoney(Number(transaction.amount), currency), 338, y, 8)
    if (transaction.transaction_type === 'credit') drawText(formatMoney(Number(transaction.amount), currency), 412, y, 8)
    drawText(balance, 488, y, 8)
    y -= 17
    drawRule(y + 5)
  }

  page.drawText('Keep this statement for your records. Contact Cedarline through secure messages if you have questions.', {
    x: margin,
    y: 28,
    size: 7,
    font: regular,
    color: muted,
  })

  return document.save()
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
    return jsonResponse({ error: 'The statement generation service is not configured.' }, 503)
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: { user }, error: userError } = await authClient.auth.getUser(token)
  if (userError || !user) return jsonResponse({ error: 'Your secure session is invalid or expired. Sign in again.' }, 401)
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const [{ data: claimsData, error: claimsError }, { data: factorsData, error: factorsError }] = await Promise.all([
    authClient.auth.getClaims(token),
    adminClient.auth.admin.mfa.listFactors({ userId: user.id }),
  ])
  if (claimsError) return jsonResponse({ error: 'Unable to verify your secure session. Sign in again.' }, 401)
  if (factorsError) return jsonResponse({ error: 'Unable to verify your sign-in security level.' }, 503)
  if (factorsData.factors.some((factor) => factor.status === 'verified') && claimsData.claims.aal !== 'aal2') {
    return jsonResponse({ error: 'Complete two-step verification before generating a statement.' }, 403)
  }

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
  const requestedIds = Array.isArray(body.accountIds) ? body.accountIds : []
  const accountIds = [...new Set(requestedIds.filter((id): id is string => typeof id === 'string'))]
  if (accountIds.length < 1 || accountIds.length > 10) {
    return jsonResponse({ error: 'Choose between one and ten accounts to generate statements.' }, 400)
  }

  const now = new Date()
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const nextPeriodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const periodEnd = new Date(nextPeriodStart.getTime() - 24 * 60 * 60 * 1000)
  const periodStartText = periodStart.toISOString().slice(0, 10)
  const periodEndText = periodEnd.toISOString().slice(0, 10)
  const periodStartTimestamp = periodStart.toISOString()
  const nextPeriodTimestamp = nextPeriodStart.toISOString()
  const generated: Array<Record<string, unknown>> = []
  let emailSent = false

  const { data: accounts, error: accountsError } = await adminClient
    .from('accounts')
    .select('id, account_type, name, account_number, currency')
    .eq('user_id', user.id)
    .in('id', accountIds)
  if (accountsError) return jsonResponse({ error: 'Unable to verify account ownership.' }, 500)
  if (!accounts || accounts.length !== accountIds.length) {
    return jsonResponse({ error: 'One or more selected accounts are unavailable.' }, 403)
  }

  const [alertPreferencesResult, deliveryPreferencesResult] = await Promise.all([
    adminClient.from('alert_preferences').select('statement_ready_enabled').eq('user_id', user.id).maybeSingle(),
    adminClient.from('statement_delivery_preferences').select('paperless_enabled, delivery_email').eq('user_id', user.id).maybeSingle(),
  ])
  if (alertPreferencesResult.error || deliveryPreferencesResult.error) {
    return jsonResponse({ error: 'Unable to load statement delivery preferences.' }, 500)
  }

  for (const account of accounts) {
    const { data: existing, error: existingError } = await adminClient
      .from('statements')
      .select('id, account_id, period_start, period_end, storage_path, file_type, generated_at')
      .eq('account_id', account.id)
      .eq('period_start', periodStartText)
      .eq('period_end', periodEndText)
      .maybeSingle()
    if (existingError) return jsonResponse({ error: 'Unable to check for an existing statement.' }, 500)
    if (existing) {
      generated.push({ ...existing, alreadyExists: true })
      continue
    }

    const { data: previousTransaction, error: previousError } = await adminClient
      .from('transactions')
      .select('balance_after')
      .eq('account_id', account.id)
      .eq('status', 'posted')
      .lt('occurred_at', periodStartTimestamp)
      .not('balance_after', 'is', null)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (previousError) return jsonResponse({ error: 'Unable to calculate the statement opening balance.' }, 500)
    const openingBalance = Number(previousTransaction?.balance_after || 0)

    const { data: transactions, count, error: transactionsError } = await adminClient
      .from('transactions')
      .select('occurred_at, transaction_type, amount, balance_after, description, counterparty_name, reference', { count: 'exact' })
      .eq('account_id', account.id)
      .eq('status', 'posted')
      .gte('occurred_at', periodStartTimestamp)
      .lt('occurred_at', nextPeriodTimestamp)
      .order('occurred_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(1000)
    if (transactionsError) return jsonResponse({ error: 'Unable to load statement activity.' }, 500)
    if ((count || 0) > 1000) {
      return jsonResponse({ error: 'This account has too much activity for on-demand generation. Contact support for this statement.' }, 413)
    }

    let pdfBytes: Uint8Array
    try {
      pdfBytes = await buildStatementPdf({
        account,
        periodStart,
        periodEnd,
        transactions: transactions || [],
        openingBalance,
      })
    } catch (error) {
      console.error('Statement PDF generation failed:', error.message)
      return jsonResponse({ error: 'Unable to generate this statement PDF.' }, 500)
    }

    const storagePath = `${user.id}/${account.id}/${periodStartText}_${periodEndText}.pdf`
    const { error: uploadError } = await adminClient.storage
      .from('bank-statements')
      .upload(storagePath, pdfBytes, { contentType: 'application/pdf', upsert: true })
    if (uploadError) {
      console.error('Statement PDF upload failed:', uploadError.message)
      return jsonResponse({ error: 'Unable to securely store this statement PDF.' }, 500)
    }

    const { data: statement, error: statementError } = await adminClient
      .from('statements')
      .insert({
        account_id: account.id,
        period_start: periodStartText,
        period_end: periodEndText,
        storage_path: storagePath,
        file_type: 'application/pdf',
      })
      .select('id, account_id, period_start, period_end, storage_path, file_type, generated_at')
      .single()
    if (statementError) {
      if (statementError.code === '23505') {
        const { data: concurrentStatement, error: concurrentLookupError } = await adminClient
          .from('statements')
          .select('id, account_id, period_start, period_end, storage_path, file_type, generated_at')
          .eq('account_id', account.id)
          .eq('period_start', periodStartText)
          .eq('period_end', periodEndText)
          .maybeSingle()
        if (!concurrentLookupError && concurrentStatement) {
          generated.push({ ...concurrentStatement, alreadyExists: true })
          continue
        }
      }
      await adminClient.storage.from('bank-statements').remove([storagePath])
      console.error('Statement record insert failed:', statementError.message)
      return jsonResponse({ error: 'Unable to publish this statement securely.' }, 500)
    }
    generated.push(statement)

    if (alertPreferencesResult.data?.statement_ready_enabled ?? true) {
      const { error: notificationError } = await adminClient.from('notifications').insert({
        user_id: user.id,
        notification_type: 'statement_ready',
        title: 'Your statement is ready',
        body: `Your ${periodStart.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} statement is available in Statements.`,
        data: {
          category: 'general',
          statement_id: statement.id,
          account_id: account.id,
          period_start: periodStartText,
          period_end: periodEndText,
        },
      })
      if (notificationError) console.error('Statement-ready notification failed:', notificationError.message)
    }

    const deliveryPreferences = deliveryPreferencesResult.data
    if (deliveryPreferences?.paperless_enabled && deliveryPreferences.delivery_email) {
      const sent = await sendCustomerNotificationEmail(
        adminClient,
        user.id,
        'A Cedarline statement is ready',
        'A new statement PDF is available in your secure Cedarline account. Sign in and open Statements to view or download it.',
        deliveryPreferences.delivery_email,
      )
      emailSent = emailSent || sent
    }
  }

  return jsonResponse({
    statements: generated,
    emailSent,
    periodStart: periodStartText,
    periodEnd: periodEndText,
  })
})