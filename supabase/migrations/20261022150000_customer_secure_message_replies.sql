alter table public.admin_messages
  add column reply_to_message_id uuid references public.admin_messages (id) on delete set null;

create index admin_messages_reply_to_idx
  on public.admin_messages (reply_to_message_id)
  where reply_to_message_id is not null;

create function public.customer_reply_admin_message(p_message_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  normalized_body text := trim(coalesce(p_body, ''));
  original_message public.admin_messages%rowtype;
  reply_row public.admin_messages%rowtype;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Sign in to reply to this secure message.';
  end if;
  if private.current_user_has_verified_mfa()
    and (select auth.jwt() ->> 'aal') is distinct from 'aal2' then
    raise exception using errcode = '42501', message = 'Complete two-step verification before sending a secure reply.';
  end if;
  if p_message_id is null then
    raise exception using errcode = '22023', message = 'The secure message could not be found.';
  end if;
  if length(normalized_body) < 1 or length(normalized_body) > 4000 then
    raise exception using errcode = '22023', message = 'Replies must contain between 1 and 4,000 characters.';
  end if;

  select * into original_message
  from public.admin_messages
  where id = p_message_id
    and recipient_user_id = current_user_id
    and sender_user_id <> current_user_id
  for share;

  if not found then
    raise exception using errcode = '42501', message = 'You can only reply to a secure message sent to your account.';
  end if;

  insert into public.admin_messages (
    recipient_user_id,
    sender_user_id,
    subject,
    body,
    priority,
    category,
    reply_to_message_id
  )
  values (
    current_user_id,
    current_user_id,
    'Customer reply',
    normalized_body,
    'normal',
    original_message.category,
    original_message.id
  )
  returning * into reply_row;

  update public.notifications
  set read_at = coalesce(read_at, now())
  where user_id = current_user_id
    and notification_type in ('admin_message', 'admin_message_security')
    and data ->> 'admin_message_id' = original_message.id::text;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
  values (
    current_user_id,
    current_user_id,
    'customer_reply_admin_message',
    'admin_message',
    reply_row.id::text,
    jsonb_build_object('reply_to_message_id', original_message.id, 'body_length', length(normalized_body))
  );

  return jsonb_build_object(
    'id', reply_row.id,
    'recipient_user_id', reply_row.recipient_user_id,
    'sender_id', reply_row.sender_user_id,
    'reply_to_message_id', reply_row.reply_to_message_id,
    'body', reply_row.body,
    'created_at', reply_row.created_at
  );
end;
$$;

revoke all on function public.customer_reply_admin_message(uuid, text) from public, anon;
grant execute on function public.customer_reply_admin_message(uuid, text) to authenticated;