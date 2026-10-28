create table public.admin_account_funding_requests (
  request_id uuid primary key,
  account_id uuid not null references public.accounts (id) on delete restrict,
  transaction_id uuid not null unique
    references public.transactions (id) on delete restrict deferrable initially deferred,
  amount numeric(19, 2) not null check (amount > 0),
  sender_name text not null,
  memo text,
  reference text not null unique,
  created_at timestamptz not null default now()
);

revoke all on table public.admin_account_funding_requests from public, anon, authenticated;
grant select, insert on table public.admin_account_funding_requests to service_role;

create function public.admin_send_account_funds(
  p_actor_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_sender_name text,
  p_memo text default null,
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_row public.accounts%rowtype;
  funding_request public.admin_account_funding_requests%rowtype;
  recipient_name text;
  normalized_sender_name text := trim(coalesce(p_sender_name, ''));
  normalized_memo text := trim(coalesce(p_memo, ''));
  transaction_id uuid := gen_random_uuid();
  notification_id uuid;
  transaction_reference text := 'EGR-' || upper(substr(replace(transaction_id::text, '-', ''), 1, 12));
begin
  if not exists (
    select 1
    from auth.users actor
    where actor.id = p_actor_id
      and (
        lower(coalesce(actor.raw_app_meta_data ->> 'role', '')) = 'admin'
        or (
          jsonb_typeof(actor.raw_app_meta_data -> 'roles') = 'array'
          and exists (
            select 1
            from jsonb_array_elements_text(
              case
                when jsonb_typeof(actor.raw_app_meta_data -> 'roles') = 'array'
                  then actor.raw_app_meta_data -> 'roles'
                else '[]'::jsonb
              end
            ) as role_values(role_name)
            where lower(role_name) = 'admin'
          )
        )
      )
  ) then
    raise exception 'Administrator access is required.';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 1000000000 or p_amount <> round(p_amount, 2) then
    raise exception 'Enter a valid amount greater than $0.00 with no more than two decimal places.';
  end if;
  if length(normalized_sender_name) < 1 or length(normalized_sender_name) > 80 then
    raise exception 'Enter a sender name of 1 to 80 characters.';
  end if;
  if length(normalized_memo) > 140 then
    raise exception 'Memo must be 140 characters or fewer.';
  end if;
  if p_request_id is null then
    raise exception 'A unique funding request key is required.';
  end if;

  select * into account_row
  from public.accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'The requested account was not found.';
  end if;

  insert into public.admin_account_funding_requests (
    request_id,
    account_id,
    transaction_id,
    amount,
    sender_name,
    memo,
    reference
  )
  values (
    p_request_id,
    p_account_id,
    transaction_id,
    p_amount,
    normalized_sender_name,
    nullif(normalized_memo, ''),
    transaction_reference
  )
  on conflict (request_id) do nothing;

  if not found then
    select * into funding_request
    from public.admin_account_funding_requests
    where request_id = p_request_id;

    if funding_request.account_id <> p_account_id
      or funding_request.amount <> p_amount
      or funding_request.sender_name <> normalized_sender_name
      or funding_request.memo is distinct from nullif(normalized_memo, '') then
      raise exception 'This funding request key was already used for a different request.';
    end if;

    select * into account_row
    from public.accounts
    where id = funding_request.account_id;

    return jsonb_build_object(
      'id', account_row.id,
      'account_type', account_row.account_type,
      'name', account_row.name,
      'last_four', right(account_row.account_number, 4),
      'currency', trim(account_row.currency),
      'balance', account_row.balance,
      'status', account_row.status,
      'is_on_hold', account_row.investigation_hold_at is not null,
      'hold_reason', account_row.investigation_hold_reason,
      'hold_at', account_row.investigation_hold_at,
      'opened_at', account_row.opened_at,
      'transaction_id', funding_request.transaction_id,
      'reference', funding_request.reference,
      'recipient_name', (select display_name from public.users where id = account_row.user_id)
    );
  end if;

  if account_row.status <> 'open' or account_row.investigation_hold_at is not null then
    raise exception 'Only open accounts without an investigation hold can receive funds.';
  end if;
  if account_row.account_type not in ('checking', 'savings', 'cd') or account_row.currency <> 'USD' then
    raise exception 'This account cannot receive supported transfers.';
  end if;

  select display_name into recipient_name
  from public.users
  where id = account_row.user_id;

  update public.accounts
  set balance = balance + p_amount,
      updated_at = now()
  where id = p_account_id
  returning * into account_row;

  insert into public.transactions (
    id,
    account_id,
    transaction_type,
    status,
    amount,
    balance_after,
    currency,
    description,
    counterparty_name,
    reference,
    occurred_at
  )
  values (
    transaction_id,
    account_row.id,
    'credit',
    'posted',
    p_amount,
    account_row.balance,
    account_row.currency,
    'Transfer from ' || normalized_sender_name,
    normalized_sender_name,
    transaction_reference,
    now()
  );

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    account_row.user_id,
    'transfer_received',
    'Transfer received',
    'A deposit of ' || to_char(p_amount, 'FM999,999,999,990.00') || ' ' || trim(account_row.currency)
      || ' was credited to your account from ' || normalized_sender_name || '.'
      || case when normalized_memo <> '' then ' Memo: ' || normalized_memo || '.' else '' end
      || ' Reference: ' || transaction_reference || '.',
    jsonb_build_object(
      'transaction_id', transaction_id,
      'account_id', account_row.id,
      'amount', p_amount,
      'currency', trim(account_row.currency),
      'counterparty_name', normalized_sender_name,
      'memo', nullif(normalized_memo, ''),
      'reference', transaction_reference
    )
  )
  returning id into notification_id;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
  values (
    p_actor_id,
    account_row.user_id,
    'admin_send_account_funds',
    'transaction',
    transaction_id::text,
    jsonb_build_object(
      'account_id', account_row.id,
      'amount', p_amount,
      'currency', trim(account_row.currency),
      'sender_name_shown_to_customer', normalized_sender_name,
      'memo', nullif(normalized_memo, ''),
      'reference', transaction_reference,
      'notification_id', notification_id
    )
  );

  return jsonb_build_object(
    'id', account_row.id,
    'account_type', account_row.account_type,
    'name', account_row.name,
    'last_four', right(account_row.account_number, 4),
    'currency', trim(account_row.currency),
    'balance', account_row.balance,
    'status', account_row.status,
    'is_on_hold', account_row.investigation_hold_at is not null,
    'hold_reason', account_row.investigation_hold_reason,
    'hold_at', account_row.investigation_hold_at,
    'opened_at', account_row.opened_at,
    'transaction_id', transaction_id,
    'reference', transaction_reference,
    'recipient_name', recipient_name
  );
end;
$$;

revoke all on function public.admin_send_account_funds(uuid, uuid, numeric, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.admin_send_account_funds(uuid, uuid, numeric, text, text, uuid)
  to service_role;
