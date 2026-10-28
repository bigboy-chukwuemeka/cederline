create function public.admin_dashboard_summary(p_actor_id uuid)
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

  select jsonb_build_object(
    'metrics', jsonb_build_object(
      'total_users', (select count(*) from public.users),
      'pending_applications', (
        select count(*)
        from public.kyc_applications
        where status = 'pending'
      ),
      'accounts_on_hold', (
        select count(*)
        from public.accounts
        where status = 'on_hold'
      ),
      'transactions_today', (
        select count(*)
        from public.transactions
        where status = 'posted'
          and occurred_at >= utc_day_start
          and occurred_at < utc_day_start + interval '1 day'
      ),
      'secure_conversations', (
        select count(distinct recipient_user_id)
        from public.admin_messages
      )
    ),
    'queues', jsonb_build_object(
      'pending_applications', (
        select count(*)
        from public.kyc_applications
        where status = 'pending'
      ),
      'pending_transfers', (
        select count(*)
        from public.transfers
        where status = 'pending'
      ),
      'flagged_transactions', (
        select count(*)
        from public.transactions
        where is_flagged
      ),
      'accounts_on_hold', (
        select count(*)
        from public.accounts
        where status = 'on_hold'
      )
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
