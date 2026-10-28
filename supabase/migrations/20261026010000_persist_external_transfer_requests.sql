create extension if not exists pgcrypto with schema extensions;

do $$
begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Enable Supabase Vault before applying external transfer request storage.';
  end if;
  if not exists (
    select 1 from vault.decrypted_secrets
    where name = 'external_transfer_encryption_key'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'external_transfer_encryption_key',
      'Encryption key for external transfer recipient account numbers'
    );
  end if;
end;
$$;

create table public.external_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references public.users (id) on delete restrict,
  sender_account_id uuid not null,
  amount numeric(19, 2) not null check (amount > 0),
  currency char(3) not null default 'USD' check (currency = 'USD'),
  bank_name text not null check (length(trim(bank_name)) between 1 and 80),
  recipient_name text not null check (length(trim(recipient_name)) between 1 and 120),
  account_type text not null check (account_type in ('checking', 'savings', 'loan')),
  routing_number text not null check (routing_number ~ '^[0-9]{9}$'),
  encrypted_account_number bytea not null,
  account_last_four char(4) not null check (account_last_four ~ '^[0-9]{4}$'),
  memo text not null default '' check (length(memo) <= 140),
  idempotency_key text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_reason text,
  reviewed_by uuid references public.users (id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint external_transfer_sender_account_owner
    foreign key (sender_account_id, sender_user_id)
    references public.accounts (id, user_id) on delete restrict,
  constraint external_transfer_idempotency_unique unique (sender_user_id, idempotency_key),
  constraint external_transfer_review_consistent check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null)
    or
    (status <> 'pending' and reviewed_by is not null and reviewed_at is not null)
  )
);

create index external_transfer_requests_pending_idx
  on public.external_transfer_requests (created_at desc) where status = 'pending';

alter table public.external_transfer_requests enable row level security;
revoke all on public.external_transfer_requests from public, anon, authenticated, service_role;

create or replace function public.protect_pending_transfer_reserves()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved_amount numeric(19, 2);
begin
  if new.balance < old.balance then
    select coalesce(sum(reservation.amount), 0)
    into reserved_amount
    from (
      select t.amount
      from public.transfers t
      where t.sender_account_id = new.id and t.status = 'pending'
      union all
      select request.amount
      from public.external_transfer_requests request
      where request.sender_account_id = new.id and request.status = 'pending'
    ) as reservation;

    if new.balance < reserved_amount then
      raise exception using
        errcode = 'P0001',
        message = 'This debit would use funds reserved for transfers awaiting review.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.get_my_pending_transfer_reserves()
returns table (account_id uuid, reserved_amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select reservations.account_id, sum(reservations.amount)
  from (
    select t.sender_account_id as account_id, t.amount
    from public.transfers t
    where t.sender_user_id = auth.uid() and t.status = 'pending'
    union all
    select request.sender_account_id, request.amount
    from public.external_transfer_requests request
    where request.sender_user_id = auth.uid() and request.status = 'pending'
  ) as reservations
  group by reservations.account_id;
$$;

create or replace function public.submit_external_transfer_request(
  p_sender_account_id uuid,
  p_amount numeric,
  p_memo text,
  p_bank_name text,
  p_recipient_name text,
  p_account_type text,
  p_routing_number text,
  p_account_number text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  sender public.accounts%rowtype;
  existing_request public.external_transfer_requests%rowtype;
  encryption_key text;
  normalized_memo text := nullif(trim(coalesce(p_memo, '')), '');
  normalized_bank_name text := trim(coalesce(p_bank_name, ''));
  normalized_recipient_name text := trim(coalesce(p_recipient_name, ''));
  normalized_routing text := trim(coalesce(p_routing_number, ''));
  normalized_account_number text := trim(coalesce(p_account_number, ''));
  normalized_account_type text := lower(trim(coalesce(p_account_type, '')));
  reserved_amount numeric(19, 2);
  request_id uuid;
  request_reference text;
  request_time timestamptz := now();
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;
  if p_sender_account_id is null then
    raise exception using errcode = '22023', message = 'Choose a sender account.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 or p_amount <> round(p_amount, 2) then
    raise exception using errcode = '22023', message = 'Enter a valid amount greater than $0.00 with no more than two decimal places.';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'A unique transfer request key is required.';
  end if;
  if length(normalized_memo) > 140 then
    raise exception using errcode = '22023', message = 'Memo must be 140 characters or fewer.';
  end if;
  if length(normalized_bank_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'Bank name must contain between 1 and 80 characters.';
  end if;
  if length(normalized_recipient_name) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Recipient name must contain between 1 and 120 characters.';
  end if;
  if normalized_account_type not in ('checking', 'savings', 'loan') then
    raise exception using errcode = '22023', message = 'Choose a valid recipient account type.';
  end if;
  if normalized_routing !~ '^[0-9]{9}$' then
    raise exception using errcode = '22023', message = 'Routing number must contain exactly 9 digits.';
  end if;
  if normalized_account_number !~ '^[0-9]{4,17}$' then
    raise exception using errcode = '22023', message = 'Account number must contain 4 to 17 digits.';
  end if;

  select decrypted_secret into encryption_key
  from vault.decrypted_secrets
  where name = 'external_transfer_encryption_key'
  order by created_at desc
  limit 1;
  if encryption_key is null or length(encryption_key) < 32 then
    raise exception using
      errcode = '55000',
      message = 'Secure external transfer storage is not configured. Contact support before submitting this request.';
  end if;

  select * into existing_request
  from public.external_transfer_requests
  where sender_user_id = current_user_id and idempotency_key = p_idempotency_key::text
  for update;
  if found then
    if existing_request.sender_account_id <> p_sender_account_id
      or existing_request.amount <> p_amount
      or existing_request.memo is distinct from coalesce(normalized_memo, '')
      or existing_request.bank_name <> normalized_bank_name
      or existing_request.recipient_name <> normalized_recipient_name
      or existing_request.account_type <> normalized_account_type
      or existing_request.routing_number <> normalized_routing
      or extensions.pgp_sym_decrypt(existing_request.encrypted_account_number, encryption_key) <> normalized_account_number then
      raise exception using errcode = '22023', message = 'This transfer request key was already used for different transfer details.';
    end if;
    return jsonb_build_object(
      'request_id', existing_request.id,
      'reference', 'EXT-' || upper(substr(replace(existing_request.id::text, '-', ''), 1, 12)),
      'submitted_at', existing_request.created_at,
      'status', existing_request.status
    );
  end if;

  select * into sender
  from public.accounts
  where id = p_sender_account_id
  for update;
  if not found or sender.user_id <> current_user_id then
    raise exception using errcode = '42501', message = 'The selected sender account is not available to you.';
  end if;
  if not exists (
    select 1 from public.users
    where id = current_user_id and is_active
  ) then
    raise exception using errcode = '42501', message = 'Your account is not eligible to submit transfer requests.';
  end if;
  if sender.status <> 'open' or sender.account_type not in ('checking', 'savings') or sender.currency <> 'USD' then
    raise exception using errcode = '22023', message = 'The selected sender account cannot send this transfer.';
  end if;

  select coalesce(sum(reservation.amount), 0)
  into reserved_amount
  from (
    select t.amount from public.transfers t
    where t.sender_account_id = sender.id and t.status = 'pending'
    union all
    select request.amount from public.external_transfer_requests request
    where request.sender_account_id = sender.id and request.status = 'pending'
  ) as reservation;
  if sender.balance - reserved_amount < p_amount then
    raise exception using errcode = 'P0001', message = 'Insufficient available funds after pending transfers. Your balances have not changed.';
  end if;

  request_id := gen_random_uuid();
  request_reference := 'EXT-' || upper(substr(replace(request_id::text, '-', ''), 1, 12));
  insert into public.external_transfer_requests (
    id, sender_user_id, sender_account_id, amount, bank_name, recipient_name,
    account_type, routing_number, encrypted_account_number, account_last_four,
    memo, idempotency_key, created_at
  ) values (
    request_id, current_user_id, sender.id, p_amount, normalized_bank_name,
    normalized_recipient_name, normalized_account_type, normalized_routing,
    extensions.pgp_sym_encrypt(normalized_account_number, encryption_key, 'cipher-algo=aes256'),
    right(normalized_account_number, 4), coalesce(normalized_memo, ''),
    p_idempotency_key::text, request_time
  );

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    current_user_id,
    'transfer_pending_review',
    'External transfer request submitted',
    'Your request to send ' || to_char(p_amount, 'FM999,999,999,990.00') || ' USD to '
      || normalized_recipient_name || ' is awaiting administrator review. Reference: ' || request_reference || '.',
    jsonb_build_object('external_transfer_request_id', request_id, 'reference', request_reference)
  );

  return jsonb_build_object(
    'request_id', request_id,
    'reference', request_reference,
    'submitted_at', request_time,
    'status', 'pending'
  );
end;
$$;

revoke all on function public.submit_external_transfer_request(uuid, numeric, text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.submit_external_transfer_request(uuid, numeric, text, text, text, text, text, text, uuid) to authenticated;

create function public.admin_list_external_transfer_requests(p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not exists (
    select 1 from auth.users actor
    where actor.id = p_actor_id
      and (
        lower(coalesce(actor.raw_app_meta_data ->> 'role', '')) = 'admin'
        or (
          jsonb_typeof(actor.raw_app_meta_data -> 'roles') = 'array'
          and exists (
            select 1 from jsonb_array_elements_text(
              case when jsonb_typeof(actor.raw_app_meta_data -> 'roles') = 'array'
                then actor.raw_app_meta_data -> 'roles' else '[]'::jsonb end
            ) role_values(role_name)
            where lower(role_name) = 'admin'
          )
        )
      )
  ) then
    raise exception 'Administrator access is required.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id,
    'reference', 'EXT-' || upper(substr(replace(request.id::text, '-', ''), 1, 12)),
    'sender_user_id', request.sender_user_id,
    'sender_name', sender.display_name,
    'sender_email', sender.email,
    'sender_account_type', sender_account.account_type,
    'sender_account_last_four', right(sender_account.account_number, 4),
    'amount', request.amount,
    'currency', trim(request.currency),
    'bank_name', request.bank_name,
    'recipient_name', request.recipient_name,
    'account_type', request.account_type,
    'account_last_four', request.account_last_four,
    'status', request.status,
    'created_at', request.created_at
  ) order by request.created_at asc), '[]'::jsonb)
  into result
  from public.external_transfer_requests request
  join public.users sender on sender.id = request.sender_user_id
  join public.accounts sender_account on sender_account.id = request.sender_account_id
  where request.status = 'pending';

  insert into public.audit_logs (actor_user_id, action, resource_type, metadata)
  values (p_actor_id, 'admin_list_external_transfer_requests', 'external_transfer_request', '{}'::jsonb);
  return jsonb_build_object('requests', result);
end;
$$;

create function public.admin_external_transfer_request_details(p_actor_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.external_transfer_requests%rowtype;
  encryption_key text;
  result jsonb;
begin
  if not exists (
    select 1 from auth.users actor
    where actor.id = p_actor_id
      and (
        lower(coalesce(actor.raw_app_meta_data ->> 'role', '')) = 'admin'
        or (
          jsonb_typeof(actor.raw_app_meta_data -> 'roles') = 'array'
          and exists (
            select 1 from jsonb_array_elements_text(
              case when jsonb_typeof(actor.raw_app_meta_data -> 'roles') = 'array'
                then actor.raw_app_meta_data -> 'roles' else '[]'::jsonb end
            ) role_values(role_name)
            where lower(role_name) = 'admin'
          )
        )
      )
  ) then
    raise exception 'Administrator access is required.';
  end if;

  select * into request from public.external_transfer_requests where id = p_request_id;
  if not found then
    raise exception 'The requested external transfer was not found.';
  end if;

  select decrypted_secret into encryption_key
  from vault.decrypted_secrets
  where name = 'external_transfer_encryption_key'
  order by created_at desc
  limit 1;
  if encryption_key is null or length(encryption_key) < 32 then
    raise exception 'Secure external transfer storage is not configured.';
  end if;

  select jsonb_build_object(
    'id', request.id,
    'reference', 'EXT-' || upper(substr(replace(request.id::text, '-', ''), 1, 12)),
    'sender_user_id', sender.id,
    'sender_name', sender.display_name,
    'sender_email', sender.email,
    'sender_account_name', coalesce(nullif(sender_account.name, ''), initcap(sender_account.account_type)),
    'sender_account_type', sender_account.account_type,
    'sender_account_last_four', right(sender_account.account_number, 4),
    'amount', request.amount,
    'currency', trim(request.currency),
    'bank_name', request.bank_name,
    'recipient_name', request.recipient_name,
    'account_type', request.account_type,
    'routing_number', request.routing_number,
    'account_number', extensions.pgp_sym_decrypt(request.encrypted_account_number, encryption_key),
    'account_last_four', request.account_last_four,
    'memo', request.memo,
    'status', request.status,
    'review_reason', request.review_reason,
    'reviewed_at', request.reviewed_at,
    'created_at', request.created_at
  )
  into result
  from public.users sender
  join public.accounts sender_account on sender_account.id = request.sender_account_id
  where sender.id = request.sender_user_id;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id)
  values (p_actor_id, request.sender_user_id, 'admin_view_external_transfer_request', 'external_transfer_request', request.id::text);
  return result;
end;
$$;

create function public.admin_review_external_transfer_request(
  p_actor_id uuid,
  p_request_id uuid,
  p_decision text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.external_transfer_requests%rowtype;
  normalized_reason text := trim(coalesce(p_reason, ''));
  reviewed_time timestamptz := now();
  request_reference text;
  notification_title text;
  notification_body text;
begin
  if not exists (
    select 1 from auth.users actor
    where actor.id = p_actor_id
      and (
        lower(coalesce(actor.raw_app_meta_data ->> 'role', '')) = 'admin'
        or (
          jsonb_typeof(actor.raw_app_meta_data -> 'roles') = 'array'
          and exists (
            select 1 from jsonb_array_elements_text(
              case when jsonb_typeof(actor.raw_app_meta_data -> 'roles') = 'array'
                then actor.raw_app_meta_data -> 'roles' else '[]'::jsonb end
            ) role_values(role_name)
            where lower(role_name) = 'admin'
          )
        )
      )
  ) then
    raise exception 'Administrator access is required.';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'Choose approve or reject.';
  end if;
  if (p_decision = 'reject' and length(normalized_reason) not between 5 and 500)
    or (p_decision = 'approve' and length(normalized_reason) > 500) then
    raise exception 'Provide a rejection reason between 5 and 500 characters, or an approval note of up to 500 characters.';
  end if;

  select * into request from public.external_transfer_requests where id = p_request_id for update;
  if not found then
    raise exception 'The requested external transfer was not found.';
  end if;
  if request.status <> 'pending' then
    raise exception 'This external transfer request is no longer awaiting review.';
  end if;

  request_reference := 'EXT-' || upper(substr(replace(request.id::text, '-', ''), 1, 12));
  update public.external_transfer_requests
  set status = case when p_decision = 'approve' then 'approved' else 'rejected' end,
      review_reason = nullif(normalized_reason, ''),
      reviewed_by = p_actor_id,
      reviewed_at = reviewed_time
  where id = request.id
  returning * into request;

  notification_title := case when p_decision = 'approve'
    then 'External transfer request approved'
    else 'External transfer request declined' end;
  notification_body := case when p_decision = 'approve'
    then 'Your external transfer request ' || request_reference || ' was approved. The reserved amount has been released.'
    else 'Your external transfer request ' || request_reference || ' was declined. Reserved funds have been released.' end;
  if normalized_reason <> '' then
    notification_body := notification_body || E'\n\nAdministrator message: ' || normalized_reason;
  end if;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    request.sender_user_id,
    case when p_decision = 'approve' then 'transfer_request_approved' else 'transfer_request_rejected' end,
    notification_title,
    notification_body,
    jsonb_build_object('external_transfer_request_id', request.id, 'reference', request_reference, 'status', request.status)
  );

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
  values (
    p_actor_id,
    request.sender_user_id,
    case when p_decision = 'approve' then 'admin_approve_external_transfer_request' else 'admin_reject_external_transfer_request' end,
    'external_transfer_request',
    request.id::text,
    jsonb_build_object('reference', request_reference, 'amount', request.amount, 'reason_provided', normalized_reason <> '')
  );

  return jsonb_build_object('id', request.id, 'status', request.status, 'reviewed_at', request.reviewed_at);
end;
$$;

revoke all on function public.admin_list_external_transfer_requests(uuid) from public, anon, authenticated;
revoke all on function public.admin_external_transfer_request_details(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_review_external_transfer_request(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_list_external_transfer_requests(uuid) to service_role;
grant execute on function public.admin_external_transfer_request_details(uuid, uuid) to service_role;
grant execute on function public.admin_review_external_transfer_request(uuid, uuid, text, text) to service_role;

create or replace function public.admin_dashboard_summary(p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  utc_day_start timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
begin
  if not exists (
    select 1 from auth.users actor
    where actor.id = p_actor_id
      and (
        lower(coalesce(actor.raw_app_meta_data ->> 'role', '')) = 'admin'
        or (
          jsonb_typeof(actor.raw_app_meta_data -> 'roles') = 'array'
          and exists (
            select 1 from jsonb_array_elements_text(
              case when jsonb_typeof(actor.raw_app_meta_data -> 'roles') = 'array'
                then actor.raw_app_meta_data -> 'roles' else '[]'::jsonb end
            ) role_values(role_name)
            where lower(role_name) = 'admin'
          )
        )
      )
  ) then
    raise exception 'Administrator access is required.';
  end if;

  select jsonb_build_object(
    'metrics', jsonb_build_object(
      'total_users', (select count(*) from public.users),
      'pending_applications', (select count(*) from public.kyc_applications where status = 'pending'),
      'accounts_on_hold', (select count(*) from public.accounts where status = 'on_hold'),
      'transactions_today', (
        select count(*) from public.transactions
        where status = 'posted' and occurred_at >= utc_day_start and occurred_at < utc_day_start + interval '1 day'
      ),
      'secure_conversations', (select count(distinct recipient_user_id) from public.admin_messages)
    ),
    'queues', jsonb_build_object(
      'pending_applications', (select count(*) from public.kyc_applications where status = 'pending'),
      'pending_transfers', (select count(*) from public.transfers where status = 'pending'),
      'pending_external_transfers', (
        select count(*) from public.external_transfer_requests where status = 'pending'
      ),
      'flagged_transactions', (select count(*) from public.transactions where is_flagged),
      'accounts_on_hold', (select count(*) from public.accounts where status = 'on_hold')
    ),
    'activity', coalesce((
      select jsonb_agg(activity_rows.activity order by activity_rows.created_at desc, activity_rows.id desc)
      from (
        select
          log.id,
          log.created_at,
          jsonb_build_object(
            'id', log.id,
            'action', log.action,
            'resource_type', log.resource_type,
            'created_at', log.created_at,
            'admin_name', actor.display_name,
            'subject_name', subject.display_name
          ) as activity
        from public.audit_logs log
        left join public.users actor on actor.id = log.actor_user_id
        left join public.users subject on subject.id = log.subject_user_id
        order by log.created_at desc, log.id desc
        limit 8
      ) as activity_rows
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.admin_dashboard_summary(uuid) from public, anon, authenticated;
grant execute on function public.admin_dashboard_summary(uuid) to service_role;

notify pgrst, 'reload schema';
