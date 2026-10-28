create or replace function public.admin_flag_transaction(
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
  subject_id uuid;
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

  select a.user_id into subject_id
  from public.accounts a
  where a.id = transaction_row.account_id;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
  values (
    p_actor_id,
    subject_id,
    'admin_flag_suspicious_transaction',
    'transaction',
    p_transaction_id::text,
    jsonb_build_object('reason', normalized_reason)
  );

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    subject_id,
    'security_transaction_flagged',
    'A transaction was flagged for review',
    'A transaction on your account has been flagged for review by our team. This review notice does not by itself reverse or block the transaction. If you have questions, contact us through secure messages.',
    jsonb_build_object(
      'category', 'security',
      'priority', 'high',
      'transaction_id', p_transaction_id,
      'event', 'flagged'
    )
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

create or replace function public.admin_unflag_transaction(
  p_actor_id uuid,
  p_transaction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_row public.transactions%rowtype;
  previous_reason text;
  previous_flagged_by uuid;
  subject_id uuid;
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

  select * into transaction_row
  from public.transactions
  where id = p_transaction_id
  for update;
  if not found then
    raise exception 'The requested transaction was not found.';
  end if;
  if not transaction_row.is_flagged then
    raise exception 'This transaction is not flagged.';
  end if;

  previous_reason := transaction_row.flag_reason;
  previous_flagged_by := transaction_row.flagged_by;
  select a.user_id into subject_id
  from public.accounts a
  where a.id = transaction_row.account_id;

  update public.transactions
  set is_flagged = false,
      flag_reason = null,
      flagged_at = null,
      flagged_by = null
  where id = p_transaction_id
  returning * into transaction_row;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
  values (
    p_actor_id,
    subject_id,
    'admin_remove_suspicious_transaction_flag',
    'transaction',
    p_transaction_id::text,
    jsonb_build_object(
      'previous_reason', previous_reason,
      'previous_flagged_by', previous_flagged_by
    )
  );

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    subject_id,
    'transaction_flag_removed',
    'Transaction review updated',
    'Our review of a previously flagged transaction is complete, and the review flag has been removed. No action is needed.',
    jsonb_build_object(
      'category', 'general',
      'transaction_id', p_transaction_id,
      'event', 'flag_removed'
    )
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

revoke all on function public.admin_flag_transaction(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_unflag_transaction(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_flag_transaction(uuid, uuid, text) to service_role;
grant execute on function public.admin_unflag_transaction(uuid, uuid) to service_role;
