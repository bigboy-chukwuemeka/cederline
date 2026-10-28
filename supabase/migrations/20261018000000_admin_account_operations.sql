alter table public.accounts
  add column investigation_hold_reason text,
  add column investigation_hold_at timestamptz,
  add column investigation_hold_by uuid references public.users (id) on delete set null,
  add constraint accounts_investigation_hold_consistent check (
    (investigation_hold_at is null and investigation_hold_reason is null and investigation_hold_by is null)
    or
    (investigation_hold_at is not null and investigation_hold_reason is not null and investigation_hold_by is not null)
  );

create function public.prevent_held_account_debits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.investigation_hold_at is not null and new.balance < old.balance then
    raise exception using errcode = 'P0001', message = 'Debits are blocked while this account is on hold for investigation.';
  end if;
  return new;
end;
$$;

create trigger accounts_prevent_held_account_debits
before update of balance on public.accounts
for each row execute function public.prevent_held_account_debits();

create function public.admin_list_accounts(
  p_actor_id uuid,
  p_search text default '',
  p_status text default 'all',
  p_account_type text default 'all',
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

  with matching_accounts as (
    select
      a.id,
      a.account_type,
      a.name,
      a.account_number,
      a.currency,
      a.balance,
      a.status,
      a.investigation_hold_reason,
      a.investigation_hold_at,
      a.opened_at,
      u.id as user_id,
      u.display_name as user_name,
      u.email as user_email
    from public.accounts a
    join public.users u on u.id = a.user_id
    where (
      normalized_search = ''
      or lower(concat_ws(' ', a.account_number, a.name, u.display_name, u.email, a.account_type)) like '%' || normalized_search || '%'
    )
    and (
      p_status = 'all'
      or (p_status = 'on_hold' and a.investigation_hold_at is not null)
      or (p_status = 'active' and a.status = 'open' and a.investigation_hold_at is null)
      or (p_status = 'frozen' and a.status = 'frozen')
      or (p_status = 'closed' and a.status = 'closed')
    )
    and (p_account_type = 'all' or a.account_type = p_account_type)
  ),
  page_accounts as (
    select *
    from matching_accounts
    order by opened_at desc
    offset (safe_page - 1) * safe_page_size
    limit safe_page_size
  )
  select jsonb_build_object(
    'total', (select count(*) from matching_accounts),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'account_type', account_type,
        'name', name,
        'last_four', right(account_number, 4),
        'currency', trim(currency),
        'balance', balance,
        'status', status,
        'is_on_hold', investigation_hold_at is not null,
        'hold_reason', investigation_hold_reason,
        'opened_at', opened_at,
        'user_id', user_id,
        'user_name', user_name,
        'user_email', user_email
      ) order by opened_at desc)
      from page_accounts
    ), '[]'::jsonb)
  ) into result;

  insert into public.audit_logs (actor_user_id, action, resource_type, metadata)
  values (p_actor_id, 'admin_list_accounts', 'account', jsonb_build_object('search_used', normalized_search <> '', 'status', p_status, 'account_type', p_account_type));

  return result;
end;
$$;

create function public.admin_account_details(p_actor_id uuid, p_account_id uuid)
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
    'id', a.id,
    'account_type', a.account_type,
    'name', a.name,
    'last_four', right(a.account_number, 4),
    'currency', trim(a.currency),
    'balance', a.balance,
    'status', a.status,
    'is_on_hold', a.investigation_hold_at is not null,
    'hold_reason', a.investigation_hold_reason,
    'hold_at', a.investigation_hold_at,
    'opened_at', a.opened_at,
    'user', jsonb_build_object(
      'id', u.id,
      'display_name', u.display_name,
      'email', u.email,
      'is_active', u.is_active
    ),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'transaction_type', t.transaction_type,
        'status', t.status,
        'amount', t.amount,
        'currency', trim(t.currency),
        'description', t.description,
        'occurred_at', t.occurred_at,
        'reference', t.reference
      ) order by t.occurred_at desc)
      from (
        select transactions.*
        from public.transactions
        where transactions.account_id = a.id
        order by transactions.occurred_at desc
        limit 20
      ) t
    ), '[]'::jsonb)
  )
  into result
  from public.accounts a
  join public.users u on u.id = a.user_id
  where a.id = p_account_id;

  if result is null then
    raise exception 'The requested account was not found.';
  end if;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id)
  select p_actor_id, a.user_id, 'admin_view_account', 'account', p_account_id::text
  from public.accounts a
  where a.id = p_account_id;

  return result;
end;
$$;

create function public.admin_account_operation(
  p_actor_id uuid,
  p_account_id uuid,
  p_action text,
  p_reason text default null,
  p_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_row public.accounts%rowtype;
  normalized_reason text := trim(coalesce(p_reason, ''));
  adjustment numeric(19, 2);
  audit_action text;
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

  select * into account_row
  from public.accounts
  where id = p_account_id
  for update;

  if not found then
    raise exception 'The requested account was not found.';
  end if;

  if p_action in ('hold', 'freeze', 'adjust_balance') and account_row.status = 'closed' then
    raise exception 'Closed accounts cannot be changed.';
  end if;

  if p_action in ('hold', 'release_hold', 'freeze', 'unfreeze', 'adjust_balance')
    and length(normalized_reason) < 5 then
    raise exception 'Provide a reason of at least 5 characters.';
  end if;

  if p_action = 'hold' then
    if account_row.investigation_hold_at is not null then
      raise exception 'This account is already on hold.';
    end if;
    update public.accounts
    set investigation_hold_reason = normalized_reason,
        investigation_hold_at = now(),
        investigation_hold_by = p_actor_id,
        updated_at = now()
    where id = p_account_id
    returning * into account_row;
    audit_action := 'admin_place_investigation_hold';
  elsif p_action = 'release_hold' then
    if account_row.investigation_hold_at is null then
      raise exception 'This account is not on hold.';
    end if;
    update public.accounts
    set investigation_hold_reason = null,
        investigation_hold_at = null,
        investigation_hold_by = null,
        updated_at = now()
    where id = p_account_id
    returning * into account_row;
    audit_action := 'admin_release_investigation_hold';
  elsif p_action = 'freeze' then
    if account_row.status <> 'open' or account_row.investigation_hold_at is not null then
      raise exception 'Only open accounts without an investigation hold can be frozen.';
    end if;
    update public.accounts
    set status = 'frozen', updated_at = now()
    where id = p_account_id
    returning * into account_row;
    audit_action := 'admin_freeze_account';
  elsif p_action = 'unfreeze' then
    if account_row.status <> 'frozen' then
      raise exception 'This account is not frozen.';
    end if;
    update public.accounts
    set status = 'open', updated_at = now()
    where id = p_account_id
    returning * into account_row;
    audit_action := 'admin_unfreeze_account';
  elsif p_action = 'adjust_balance' then
    if account_row.status <> 'open' or account_row.investigation_hold_at is not null then
      raise exception 'Only open accounts without an investigation hold can have a balance adjustment.';
    end if;
    if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000000 then
      raise exception 'Enter a non-zero adjustment amount within the supported range.';
    end if;
    adjustment := round(p_amount, 2);
    if adjustment = 0 or account_row.balance + adjustment < 0 then
      raise exception 'The adjustment cannot reduce the account balance below zero.';
    end if;

    update public.accounts
    set balance = balance + adjustment, updated_at = now()
    where id = p_account_id
    returning * into account_row;

    insert into public.transactions (
      account_id,
      transaction_type,
      status,
      amount,
      balance_after,
      currency,
      description,
      reference
    )
    values (
      p_account_id,
      case when adjustment > 0 then 'credit' else 'debit' end,
      'posted',
      abs(adjustment),
      account_row.balance,
      account_row.currency,
      'Admin balance adjustment: ' || normalized_reason,
      'ADMIN-' || replace(p_account_id::text, '-', '')
    );
    audit_action := 'admin_adjust_account_balance';
  else
    raise exception 'Unsupported account operation.';
  end if;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
  values (
    p_actor_id,
    account_row.user_id,
    audit_action,
    'account',
    p_account_id::text,
    jsonb_build_object(
      'reason', normalized_reason,
      'adjustment', case when p_action = 'adjust_balance' then adjustment else null end
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
    'opened_at', account_row.opened_at
  );
end;
$$;

revoke all on function public.admin_list_accounts(uuid, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_account_details(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_account_operation(uuid, uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.admin_list_accounts(uuid, text, text, text, integer, integer) to service_role;
grant execute on function public.admin_account_details(uuid, uuid) to service_role;
grant execute on function public.admin_account_operation(uuid, uuid, text, text, numeric) to service_role;
