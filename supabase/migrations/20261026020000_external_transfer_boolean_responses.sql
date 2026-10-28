alter table public.external_transfer_requests
  add column response_prompt text,
  add column customer_response boolean,
  add column customer_responded_at timestamptz,
  add constraint external_transfer_response_prompt_length check (
    response_prompt is null or length(trim(response_prompt)) between 1 and 160
  ),
  add constraint external_transfer_customer_response_consistent check (
    (customer_response is null and customer_responded_at is null)
    or (customer_response is not null and customer_responded_at is not null)
  );

create or replace function public.admin_external_transfer_request_details(p_actor_id uuid, p_request_id uuid)
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
    'response_prompt', request.response_prompt,
    'customer_response', request.customer_response,
    'customer_responded_at', request.customer_responded_at,
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

drop function public.admin_review_external_transfer_request(uuid, uuid, text, text);

create function public.admin_review_external_transfer_request(
  p_actor_id uuid,
  p_request_id uuid,
  p_decision text,
  p_reason text default null,
  p_response_prompt text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.external_transfer_requests%rowtype;
  normalized_reason text := trim(coalesce(p_reason, ''));
  normalized_response_prompt text := trim(coalesce(p_response_prompt, ''));
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
  if p_response_prompt is not null and length(normalized_response_prompt) not between 1 and 160 then
    raise exception 'True / False questions must contain between 1 and 160 characters.';
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
      response_prompt = nullif(normalized_response_prompt, ''),
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
    jsonb_build_object(
      'external_transfer_request_id', request.id,
      'reference', request_reference,
      'status', request.status,
      'response_prompt', request.response_prompt
    )
  );

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
  values (
    p_actor_id,
    request.sender_user_id,
    case when p_decision = 'approve' then 'admin_approve_external_transfer_request' else 'admin_reject_external_transfer_request' end,
    'external_transfer_request',
    request.id::text,
    jsonb_build_object(
      'reference', request_reference,
      'amount', request.amount,
      'reason_provided', normalized_reason <> '',
      'response_prompt_provided', request.response_prompt is not null
    )
  );

  return jsonb_build_object('id', request.id, 'status', request.status, 'reviewed_at', request.reviewed_at);
end;
$$;

create or replace function public.admin_list_external_transfer_requests(p_actor_id uuid)
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
    'response_prompt', request.response_prompt,
    'customer_response', request.customer_response,
    'customer_responded_at', request.customer_responded_at,
    'created_at', request.created_at
  ) order by (request.status = 'pending') desc, request.created_at desc), '[]'::jsonb)
  into result
  from public.external_transfer_requests request
  join public.users sender on sender.id = request.sender_user_id
  join public.accounts sender_account on sender_account.id = request.sender_account_id
  where request.status = 'pending' or request.response_prompt is not null;

  insert into public.audit_logs (actor_user_id, action, resource_type, metadata)
  values (p_actor_id, 'admin_list_external_transfer_requests', 'external_transfer_request', '{}'::jsonb);
  return jsonb_build_object('requests', result);
end;
$$;

create function public.customer_reply_external_transfer_request(p_request_id uuid, p_response boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  request public.external_transfer_requests%rowtype;
  responded_time timestamptz := now();
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Sign in to send your answer.';
  end if;
  if private.current_user_has_verified_mfa()
    and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception using errcode = '42501', message = 'Complete two-step verification before sending your answer.';
  end if;
  if p_request_id is null or p_response is null then
    raise exception using errcode = '22023', message = 'Choose True or False before sending your answer.';
  end if;

  select * into request
  from public.external_transfer_requests
  where id = p_request_id and sender_user_id = current_user_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'This transfer request is not available to your account.';
  end if;
  if request.response_prompt is null then
    raise exception using errcode = '22023', message = 'This transfer request does not include a True / False question.';
  end if;
  if request.status = 'pending' then
    raise exception using errcode = '22023', message = 'Answer this question after the transfer request has been reviewed.';
  end if;
  if request.customer_response is not null then
    raise exception using errcode = '22023', message = 'Your answer has already been sent.';
  end if;

  update public.external_transfer_requests
  set customer_response = p_response,
      customer_responded_at = responded_time
  where id = request.id
  returning * into request;

  update public.notifications
  set read_at = coalesce(read_at, responded_time),
      data = coalesce(data, '{}'::jsonb) || jsonb_build_object('customer_response', p_response)
  where user_id = current_user_id
    and data ->> 'external_transfer_request_id' = request.id::text
    and data ->> 'response_prompt' = request.response_prompt;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
  values (
    current_user_id,
    current_user_id,
    'customer_reply_external_transfer_request',
    'external_transfer_request',
    request.id::text,
    jsonb_build_object('response', p_response)
  );

  return jsonb_build_object(
    'id', request.id,
    'customer_response', request.customer_response,
    'customer_responded_at', request.customer_responded_at
  );
end;
$$;

revoke all on function public.admin_review_external_transfer_request(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_review_external_transfer_request(uuid, uuid, text, text, text) to service_role;
revoke all on function public.customer_reply_external_transfer_request(uuid, boolean) from public, anon;
grant execute on function public.customer_reply_external_transfer_request(uuid, boolean) to authenticated;
