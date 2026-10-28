alter table public.transactions
  add column is_flagged boolean not null default false,
  add column flag_reason text,
  add column flagged_at timestamptz,
  add column flagged_by uuid references public.users (id) on delete set null,
  add constraint transactions_flag_consistent check (
    (not is_flagged and flag_reason is null and flagged_at is null and flagged_by is null)
    or
    (is_flagged and flag_reason is not null and flagged_at is not null and flagged_by is not null)
  );

create index transactions_flagged_date_idx
  on public.transactions (flagged_at desc) where is_flagged;

create function public.admin_list_transactions(
  p_actor_id uuid,
  p_search text default '',
  p_status text default 'all',
  p_type text default 'all',
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_min_amount numeric default null,
  p_max_amount numeric default null,
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  normalized_search text := lower(trim(coalesce(p_search, '')));
  safe_page integer := greatest(coalesce(p_page, 1), 1);
  safe_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
begin
  if not exists (
    select 1 from auth.users actor
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
  if p_min_amount is not null and p_min_amount < 0 then
    raise exception 'Minimum amount cannot be negative.';
  end if;
  if p_max_amount is not null and p_max_amount < 0 then
    raise exception 'Maximum amount cannot be negative.';
  end if;
  if p_min_amount is not null and p_max_amount is not null and p_min_amount > p_max_amount then
    raise exception 'Minimum amount must not exceed maximum amount.';
  end if;
  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'Start date must be before the end date.';
  end if;

  with matching as (
    select
      t.id,
      t.account_id,
      t.transaction_type,
      t.status,
      t.amount,
      t.currency,
      t.description,
      t.reference,
      t.occurred_at,
      t.is_flagged,
      a.account_type,
      a.name as account_name,
      right(a.account_number, 4) as account_last_four,
      u.id as user_id,
      u.display_name as user_name,
      u.email as user_email
    from public.transactions t
    join public.accounts a on a.id = t.account_id
    join public.users u on u.id = a.user_id
    where (
      normalized_search = ''
      or lower(concat_ws(' ', u.display_name, u.email, a.account_number, t.description, t.reference, t.counterparty_name)) like '%' || normalized_search || '%'
    )
    and (
      p_status = 'all'
      or (p_status = 'flagged' and t.is_flagged)
      or (p_status in ('pending', 'posted', 'reversed', 'failed') and t.status = p_status)
    )
    and (p_type = 'all' or t.transaction_type = p_type)
    and (p_from is null or t.occurred_at >= p_from)
    and (p_to is null or t.occurred_at <= p_to)
    and (p_min_amount is null or t.amount >= p_min_amount)
    and (p_max_amount is null or t.amount <= p_max_amount)
  ),
  page_rows as (
    select *
    from matching
    order by occurred_at desc, id desc
    offset (safe_page - 1) * safe_page_size
    limit safe_page_size
  )
  select jsonb_build_object(
    'total', (select count(*) from matching),
    'flagged_total', (select count(*) from public.transactions where is_flagged),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'account_id', account_id,
        'transaction_type', transaction_type,
        'status', status,
        'amount', amount,
        'currency', trim(currency),
        'description', description,
        'reference', reference,
        'occurred_at', occurred_at,
        'is_flagged', is_flagged,
        'account_type', account_type,
        'account_name', account_name,
        'account_last_four', account_last_four,
        'user_id', user_id,
        'user_name', user_name,
        'user_email', user_email
      ) order by occurred_at desc, id desc)
      from page_rows
    ), '[]'::jsonb)
  ) into result;

  insert into public.audit_logs (actor_user_id, action, resource_type, metadata)
  values (
    p_actor_id,
    'admin_list_transactions',
    'transaction',
    jsonb_build_object(
      'search_used', normalized_search <> '',
      'status', p_status,
      'type', p_type,
      'date_filtered', p_from is not null or p_to is not null,
      'amount_filtered', p_min_amount is not null or p_max_amount is not null
    )
  );
  return result;
end;
$$;

create function public.admin_transaction_details(p_actor_id uuid, p_transaction_id uuid)
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

  select jsonb_build_object(
    'id', t.id,
    'transaction_type', t.transaction_type,
    'status', t.status,
    'amount', t.amount,
    'currency', trim(t.currency),
    'balance_after', t.balance_after,
    'description', t.description,
    'counterparty_name', t.counterparty_name,
    'counterparty_account_last_four', t.counterparty_account_last_four,
    'reference', t.reference,
    'occurred_at', t.occurred_at,
    'created_at', t.created_at,
    'is_flagged', t.is_flagged,
    'flag_reason', t.flag_reason,
    'flagged_at', t.flagged_at,
    'user', jsonb_build_object(
      'id', u.id,
      'display_name', u.display_name,
      'email', u.email
    ),
    'account', jsonb_build_object(
      'id', a.id,
      'name', a.name,
      'account_type', a.account_type,
      'last_four', right(a.account_number, 4),
      'status', a.status,
      'is_on_hold', a.investigation_hold_at is not null
    ),
    'transfer', case when x.id is null then null else jsonb_build_object(
      'id', x.id,
      'status', x.status,
      'memo', x.memo,
      'completed_at', x.completed_at
    ) end
  )
  into result
  from public.transactions t
  join public.accounts a on a.id = t.account_id
  join public.users u on u.id = a.user_id
  left join public.transfers x on x.id = t.transfer_id
  where t.id = p_transaction_id;

  if result is null then
    raise exception 'The requested transaction was not found.';
  end if;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id)
  select p_actor_id, t.user_id, 'admin_view_transaction', 'transaction', p_transaction_id::text
  from public.transactions tx
  join public.accounts t on t.id = tx.account_id
  where tx.id = p_transaction_id;

  return result;
end;
$$;

create function public.admin_flag_transaction(
  p_actor_id uuid,
  p_transaction_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_row public.transactions%rowtype;
  normalized_reason text := trim(coalesce(p_reason, ''));
begin
  if not exists (
    select 1 from auth.users actor
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
  if length(normalized_reason) < 5 or length(normalized_reason) > 500 then
    raise exception 'Provide a flag reason between 5 and 500 characters.';
  end if;

  select * into transaction_row
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'The requested transaction was not found.';
  end if;
  if transaction_row.is_flagged then
    raise exception 'This transaction is already flagged.';
  end if;

  update public.transactions
  set is_flagged = true,
      flag_reason = normalized_reason,
      flagged_at = now(),
      flagged_by = p_actor_id
  where id = p_transaction_id
  returning * into transaction_row;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
  values (
    p_actor_id,
    (select a.user_id from public.accounts a where a.id = transaction_row.account_id),
    'admin_flag_suspicious_transaction',
    'transaction',
    p_transaction_id::text,
    jsonb_build_object('reason', normalized_reason)
  );

  return jsonb_build_object(
    'id', transaction_row.id,
    'is_flagged', transaction_row.is_flagged,
    'flag_reason', transaction_row.flag_reason,
    'flagged_at', transaction_row.flagged_at,
    'status', transaction_row.status
  );
end;
$$;

revoke all on function public.admin_list_transactions(uuid, text, text, text, timestamptz, timestamptz, numeric, numeric, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_transaction_details(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_flag_transaction(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_list_transactions(uuid, text, text, text, timestamptz, timestamptz, numeric, numeric, integer, integer) to service_role;
grant execute on function public.admin_transaction_details(uuid, uuid) to service_role;
grant execute on function public.admin_flag_transaction(uuid, uuid, text) to service_role;
