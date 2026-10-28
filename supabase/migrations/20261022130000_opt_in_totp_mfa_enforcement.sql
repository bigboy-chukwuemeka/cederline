create schema if not exists private;

create or replace function private.current_user_has_verified_mfa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.mfa_factors factor
    where factor.user_id = (select auth.uid())
      and factor.status = 'verified'
  );
$$;

revoke all on function private.current_user_has_verified_mfa() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.current_user_has_verified_mfa() to authenticated;

create policy mfa_aal2_users on public.users
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_user_profiles on public.user_profiles
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_identity_documents on public.identity_documents
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_accounts on public.accounts
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_categories on public.categories
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_transfers on public.transfers
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_budgets on public.budgets
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_budget_categories on public.budget_categories
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_transactions on public.transactions
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_statements on public.statements
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_alert_preferences on public.alert_preferences
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_notifications on public.notifications
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_devices on public.devices
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_audit_logs on public.audit_logs
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_statement_delivery_preferences on public.statement_delivery_preferences
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_profile_preferences on public.profile_preferences
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create policy mfa_aal2_storage_objects on storage.objects
  as restrictive for all to authenticated
  using (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2')
  with check (not (select private.current_user_has_verified_mfa()) or (select auth.jwt() ->> 'aal') = 'aal2');

create or replace function public.find_transfer_recipients(p_query text)
returns table (
  account_id uuid,
  account_type text,
  recipient_name text,
  account_last_four text,
  account_name text,
  currency char(3)
)
language sql
stable
security definer
set search_path = ''
as $$
  with query_value as (
    select lower(trim(coalesce(p_query, ''))) as value
  )
  select
    a.id,
    a.account_type,
    u.display_name,
    right(a.account_number, 4),
    a.name,
    a.currency
  from public.accounts a
  join public.users u on u.id = a.user_id
  cross join query_value q
  where auth.uid() is not null
    and (not private.current_user_has_verified_mfa() or (auth.jwt() ->> 'aal') = 'aal2')
    and u.id <> (select auth.uid())
    and u.is_active
    and a.status = 'open'
    and a.account_type in ('checking', 'savings', 'loan', 'cd')
    and (
      (q.value ~ '^[0-9]+$' and length(q.value) >= 4)
      or (q.value !~ '^[0-9]+$' and length(q.value) >= 3)
    )
    and (
      a.account_number = q.value
      or (q.value ~ '^[0-9]+$' and left(a.account_number, length(q.value)) = q.value)
      or (q.value ~ '^[0-9]{4}$' and right(a.account_number, 4) = q.value)
      or left(lower(u.email), length(q.value)) = q.value
      or left(lower(coalesce(u.username, '')), length(q.value)) = q.value
    )
  order by
    case
      when a.account_number = q.value then 0
      when lower(u.email) = q.value or lower(coalesce(u.username, '')) = q.value then 1
      when q.value ~ '^[0-9]{4}$' and right(a.account_number, 4) = q.value then 2
      else 3
    end,
    lower(u.display_name),
    a.account_type
  limit 10;
$$;

create or replace function public.get_my_pending_transfer_reserves()
returns table (account_id uuid, reserved_amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select t.sender_account_id, sum(t.amount)
  from public.transfers t
  where t.sender_user_id = (select auth.uid())
    and (not private.current_user_has_verified_mfa() or (auth.jwt() ->> 'aal') = 'aal2')
    and t.status = 'pending'
  group by t.sender_account_id;
$$;

create or replace function public.complete_registered_transfer(
  p_sender_account_id uuid,
  p_recipient_account_id uuid,
  p_amount numeric,
  p_memo text,
  p_idempotency_key uuid
)
returns table (
  transfer_id uuid,
  reference text,
  completed_at timestamptz,
  sender_balance_after numeric
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.current_user_has_verified_mfa()
    and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception using errcode = '42501', message = 'Complete two-step verification before sending a transfer.';
  end if;

  return query
  select result.transfer_id, result.reference, result.completed_at, result.sender_balance_after
  from public.complete_account_transfer(
    p_sender_account_id,
    p_recipient_account_id,
    p_amount,
    p_memo,
    p_idempotency_key
  ) as result;
end;
$$;

create or replace function public.save_customer_profile(
  p_first_name text,
  p_last_name text,
  p_phone_e164 text,
  p_mailing_address text,
  p_account_updates_enabled boolean,
  p_product_news_enabled boolean,
  p_helpful_tips_enabled boolean,
  p_language text,
  p_time_zone text,
  p_session_timeout_minutes integer,
  p_paperless_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text;
  normalized_phone text := nullif(trim(coalesce(p_phone_e164, '')), '');
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Sign in to update your profile.';
  end if;
  if private.current_user_has_verified_mfa()
    and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception using errcode = '42501', message = 'Complete two-step verification before updating your profile.';
  end if;
  if nullif(trim(coalesce(p_first_name, '')), '') is null
    or nullif(trim(coalesce(p_last_name, '')), '') is null then
    raise exception using errcode = '22023', message = 'First and last names are required.';
  end if;
  if normalized_phone is not null and normalized_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception using errcode = '22023', message = 'Enter a phone number in international format, such as +15555550100.';
  end if;
  if coalesce(p_language, '') not in ('en-US', 'es-US') then
    raise exception using errcode = '22023', message = 'Choose a supported language.';
  end if;
  if coalesce(p_time_zone, '') not in (
    'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'
  ) then
    raise exception using errcode = '22023', message = 'Choose a supported time zone.';
  end if;
  if p_session_timeout_minutes not in (5, 10, 15, 30) then
    raise exception using errcode = '22023', message = 'Choose a supported session timeout.';
  end if;

  select u.email into current_email from public.users u where u.id = current_user_id;
  if current_email is null then
    raise exception using errcode = 'P0002', message = 'The signed-in customer profile could not be found.';
  end if;

  update public.users
  set display_name = trim(p_first_name) || ' ' || trim(p_last_name),
      phone_e164 = normalized_phone
  where id = current_user_id;

  insert into public.user_profiles (user_id, legal_first_name, legal_last_name, mailing_address)
  values (
    current_user_id,
    trim(p_first_name),
    trim(p_last_name),
    jsonb_build_object('formatted', trim(coalesce(p_mailing_address, '')))
  )
  on conflict (user_id) do update
  set legal_first_name = excluded.legal_first_name,
      legal_last_name = excluded.legal_last_name,
      mailing_address = excluded.mailing_address;

  insert into public.profile_preferences (
    user_id, account_updates_enabled, product_news_enabled, helpful_tips_enabled,
    language, time_zone, session_timeout_minutes
  )
  values (
    current_user_id, p_account_updates_enabled, p_product_news_enabled, p_helpful_tips_enabled,
    p_language, p_time_zone, p_session_timeout_minutes
  )
  on conflict (user_id) do update
  set account_updates_enabled = excluded.account_updates_enabled,
      product_news_enabled = excluded.product_news_enabled,
      helpful_tips_enabled = excluded.helpful_tips_enabled,
      language = excluded.language,
      time_zone = excluded.time_zone,
      session_timeout_minutes = excluded.session_timeout_minutes;

  insert into public.statement_delivery_preferences (user_id, paperless_enabled, delivery_email)
  values (current_user_id, coalesce(p_paperless_enabled, true), current_email)
  on conflict (user_id) do update
  set paperless_enabled = excluded.paperless_enabled;
end;
$$;