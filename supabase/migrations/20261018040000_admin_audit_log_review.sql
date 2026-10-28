create index audit_logs_action_date_idx
  on public.audit_logs (action, created_at desc);

create function public.admin_list_audit_logs(
  p_actor_id uuid,
  p_admin_search text default '',
  p_action text default 'all',
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_page integer default 1,
  p_page_size integer default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  normalized_admin_search text := lower(trim(coalesce(p_admin_search, '')));
  normalized_action text := coalesce(p_action, 'all');
  safe_page integer := greatest(coalesce(p_page, 1), 1);
  safe_page_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
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

  if p_from is not null and p_to is not null and p_from > p_to then
    raise exception 'Start date must be before the end date.';
  end if;

  with matching as (
    select
      log.id,
      log.actor_user_id,
      log.subject_user_id,
      log.action,
      log.resource_type,
      log.resource_id,
      log.ip_address::text as ip_address,
      log.metadata,
      log.created_at,
      actor.display_name as admin_name,
      actor.email as admin_email,
      subject.display_name as subject_name,
      subject.email as subject_email,
      coalesce(account_target.name, transaction_account.name) as account_name,
      right(coalesce(account_target.account_number, transaction_account.account_number), 4) as account_last_four
    from public.audit_logs log
    left join public.users actor on actor.id = log.actor_user_id
    left join public.users subject on subject.id = log.subject_user_id
    left join public.accounts account_target
      on log.resource_type = 'account'
      and account_target.id = case
        when log.resource_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then log.resource_id::uuid
        else null
      end
    left join public.transactions transaction_target
      on log.resource_type = 'transaction'
      and transaction_target.id = case
        when log.resource_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then log.resource_id::uuid
        else null
      end
    left join public.accounts transaction_account on transaction_account.id = transaction_target.account_id
    where (
      normalized_admin_search = ''
      or lower(concat_ws(' ', actor.display_name, actor.email)) like '%' || normalized_admin_search || '%'
    )
    and (normalized_action = 'all' or log.action = normalized_action)
    and (p_from is null or log.created_at >= p_from)
    and (p_to is null or log.created_at <= p_to)
  ),
  page_rows as (
    select *
    from matching
    order by created_at desc, id desc
    offset (safe_page - 1) * safe_page_size
    limit safe_page_size
  )
  select jsonb_build_object(
    'total', (select count(*) from matching),
    'actions', coalesce((
      select jsonb_agg(action_values.action order by action_values.action)
      from (
        select distinct log.action
        from public.audit_logs log
      ) as action_values
    ), '[]'::jsonb),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', page_rows.id,
        'actor_user_id', page_rows.actor_user_id,
        'admin_name', page_rows.admin_name,
        'admin_email', page_rows.admin_email,
        'subject_user_id', page_rows.subject_user_id,
        'subject_name', page_rows.subject_name,
        'subject_email', page_rows.subject_email,
        'action', page_rows.action,
        'resource_type', page_rows.resource_type,
        'resource_id', page_rows.resource_id,
        'account_name', page_rows.account_name,
        'account_last_four', page_rows.account_last_four,
        'ip_address', page_rows.ip_address,
        'metadata', page_rows.metadata,
        'created_at', page_rows.created_at
      ) order by page_rows.created_at desc, page_rows.id desc)
      from page_rows
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_list_audit_logs(uuid, text, text, timestamptz, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_list_audit_logs(uuid, text, text, timestamptz, timestamptz, integer, integer) to service_role;
