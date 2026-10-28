create function public.admin_unflag_transaction(
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

  return jsonb_build_object(
    'id', transaction_row.id,
    'is_flagged', transaction_row.is_flagged,
    'flag_reason', transaction_row.flag_reason,
    'flagged_at', transaction_row.flagged_at,
    'status', transaction_row.status
  );
end;
$$;

revoke all on function public.admin_unflag_transaction(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_unflag_transaction(uuid, uuid) to service_role;
