create or replace function public.admin_review_external_transfer_request(
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
    raise exception 'The customer input label must contain between 1 and 160 characters.';
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
