alter table public.admin_messages
  add column subject text not null default 'Secure message',
  add column priority text not null default 'normal'
    check (priority in ('normal', 'high', 'urgent')),
  add column category text
    check (category is null or category in ('account_alert', 'security', 'general', 'investigation'));

alter table public.admin_messages
  add constraint admin_messages_subject_length
    check (length(trim(subject)) between 1 and 120);

drop function public.admin_send_message(uuid, uuid, text);

create function public.admin_send_message(
  p_actor_id uuid,
  p_recipient_user_id uuid,
  p_subject text,
  p_body text,
  p_priority text,
  p_category text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_subject text := trim(coalesce(p_subject, ''));
  normalized_body text := trim(coalesce(p_body, ''));
  normalized_priority text := lower(trim(coalesce(p_priority, '')));
  normalized_category text := nullif(lower(trim(coalesce(p_category, ''))), '');
  message_row public.admin_messages%rowtype;
  recipient_name text;
  notification_id uuid;
begin
  if not public.admin_messages_actor_is_admin(p_actor_id) then
    raise exception 'Administrator access is required.';
  end if;
  if length(normalized_subject) < 1 or length(normalized_subject) > 120 then
    raise exception 'Subjects must contain between 1 and 120 characters.';
  end if;
  if length(normalized_body) < 1 or length(normalized_body) > 4000 then
    raise exception 'Messages must contain between 1 and 4,000 characters.';
  end if;
  if normalized_priority not in ('normal', 'high', 'urgent') then
    raise exception 'Choose a valid message priority.';
  end if;
  if normalized_category is not null
    and normalized_category not in ('account_alert', 'security', 'general', 'investigation') then
    raise exception 'Choose a valid message category.';
  end if;

  select u.display_name into recipient_name
  from public.users u
  where u.id = p_recipient_user_id;
  if not found then
    raise exception 'The requested user was not found.';
  end if;

  insert into public.admin_messages (
    recipient_user_id,
    sender_user_id,
    subject,
    body,
    priority,
    category
  )
  values (
    p_recipient_user_id,
    p_actor_id,
    normalized_subject,
    normalized_body,
    normalized_priority,
    normalized_category
  )
  returning * into message_row;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    p_recipient_user_id,
    case
      when normalized_category = 'security' or normalized_priority = 'urgent' then 'admin_message_security'
      else 'admin_message'
    end,
    normalized_subject,
    normalized_body,
    jsonb_build_object(
      'admin_message_id', message_row.id,
      'priority', normalized_priority,
      'category', normalized_category,
      'recipient_name', recipient_name
    )
  )
  returning id into notification_id;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
  values (
    p_actor_id,
    p_recipient_user_id,
    'admin_send_customer_message',
    'admin_message',
    message_row.id::text,
    jsonb_build_object(
      'notification_id', notification_id,
      'priority', normalized_priority,
      'category', normalized_category,
      'subject_length', length(normalized_subject),
      'body_length', length(normalized_body)
    )
  );

  return jsonb_build_object(
    'id', message_row.id,
    'recipient_user_id', message_row.recipient_user_id,
    'sender_id', message_row.sender_user_id,
    'subject', message_row.subject,
    'body', message_row.body,
    'priority', message_row.priority,
    'category', message_row.category,
    'created_at', message_row.created_at,
    'notification_id', notification_id,
    'recipient_name', recipient_name
  );
end;
$$;

revoke all on function public.admin_send_message(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_send_message(uuid, uuid, text, text, text, text) to service_role;

create or replace function public.admin_message_inbox(
  p_actor_id uuid,
  p_search text default '',
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  normalized_search text := lower(trim(coalesce(p_search, '')));
  safe_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  if not public.admin_messages_actor_is_admin(p_actor_id) then
    raise exception 'Administrator access is required.';
  end if;

  with stats as (
    select
      m.recipient_user_id,
      count(*)::integer as message_count,
      (array_agg(m.id order by m.created_at desc, m.id desc))[1] as last_message_id,
      (array_agg(m.sender_user_id order by m.created_at desc, m.id desc))[1] as last_sender_id,
      (array_agg(m.subject order by m.created_at desc, m.id desc))[1] as last_subject,
      (array_agg(m.body order by m.created_at desc, m.id desc))[1] as last_body,
      (array_agg(m.priority order by m.created_at desc, m.id desc))[1] as last_priority,
      max(m.created_at) as last_message_at
    from public.admin_messages m
    group by m.recipient_user_id
  ),
  matching as (
    select
      s.recipient_user_id,
      s.message_count,
      s.last_message_id,
      s.last_sender_id,
      s.last_subject,
      s.last_body,
      s.last_priority,
      s.last_message_at,
      u.display_name,
      u.email,
      u.is_active
    from stats s
    join public.users u on u.id = s.recipient_user_id
    where normalized_search = ''
      or lower(concat_ws(' ', u.display_name, u.email, s.last_subject, s.last_body)) like '%' || normalized_search || '%'
    order by s.last_message_at desc
    limit safe_limit
  )
  select jsonb_build_object(
    'conversations',
    coalesce(jsonb_agg(jsonb_build_object(
      'user', jsonb_build_object(
        'id', matching.recipient_user_id,
        'display_name', matching.display_name,
        'email', matching.email,
        'is_active', matching.is_active
      ),
      'last_message', jsonb_build_object(
        'id', matching.last_message_id,
        'sender_id', matching.last_sender_id,
        'subject', matching.last_subject,
        'body', matching.last_body,
        'priority', matching.last_priority,
        'created_at', matching.last_message_at
      ),
      'message_count', matching.message_count
    ) order by matching.last_message_at desc), '[]'::jsonb)
  )
  into result
  from matching;

  return result;
end;
$$;

create or replace function public.admin_message_thread(
  p_actor_id uuid,
  p_recipient_user_id uuid,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  safe_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  if not public.admin_messages_actor_is_admin(p_actor_id) then
    raise exception 'Administrator access is required.';
  end if;

  select jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id,
      'display_name', u.display_name,
      'email', u.email,
      'is_active', u.is_active
    ),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', message_page.id,
        'sender_id', message_page.sender_user_id,
        'subject', message_page.subject,
        'body', message_page.body,
        'priority', message_page.priority,
        'category', message_page.category,
        'created_at', message_page.created_at
      ) order by message_page.created_at, message_page.id)
      from (
        select m.id, m.sender_user_id, m.subject, m.body, m.priority, m.category, m.created_at
        from public.admin_messages m
        where m.recipient_user_id = p_recipient_user_id
        order by m.created_at desc, m.id desc
        limit safe_limit
      ) as message_page
    ), '[]'::jsonb)
  )
  into result
  from public.users u
  where u.id = p_recipient_user_id;

  if result is null then
    raise exception 'The requested user was not found.';
  end if;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id)
  values (p_actor_id, p_recipient_user_id, 'admin_view_message_thread', 'user', p_recipient_user_id::text);

  return result;
end;
$$;

revoke all on function public.admin_message_inbox(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.admin_message_thread(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_message_inbox(uuid, text, integer) to service_role;
grant execute on function public.admin_message_thread(uuid, uuid, integer) to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
