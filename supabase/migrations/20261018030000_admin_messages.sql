create table public.admin_messages (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.users (id) on delete cascade,
  sender_user_id uuid not null references public.users (id) on delete restrict,
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index admin_messages_recipient_date_idx
  on public.admin_messages (recipient_user_id, created_at desc, id desc);

alter table public.admin_messages enable row level security;
revoke all on public.admin_messages from public, anon, authenticated;
grant all on public.admin_messages to service_role;

create function public.admin_messages_actor_is_admin(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
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
  );
$$;

create function public.admin_search_message_recipients(
  p_actor_id uuid,
  p_search text,
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  normalized_search text := lower(trim(coalesce(p_search, '')));
  safe_limit integer := least(greatest(coalesce(p_limit, 10), 1), 20);
begin
  if not public.admin_messages_actor_is_admin(p_actor_id) then
    raise exception 'Administrator access is required.';
  end if;

  if length(normalized_search) < 2 then
    return jsonb_build_object('users', '[]'::jsonb);
  end if;

  select jsonb_build_object(
    'users',
    coalesce(jsonb_agg(jsonb_build_object(
      'id', matching.id,
      'display_name', matching.display_name,
      'email', matching.email,
      'is_active', matching.is_active
    ) order by matching.display_name, matching.email), '[]'::jsonb)
  )
  into result
  from (
    select u.id, u.display_name, u.email, u.is_active
    from public.users u
    where lower(concat_ws(' ', u.display_name, u.email)) like '%' || normalized_search || '%'
    order by u.display_name, u.email
    limit safe_limit
  ) as matching;

  return result;
end;
$$;

create function public.admin_message_inbox(
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
      (array_agg(m.body order by m.created_at desc, m.id desc))[1] as last_body,
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
      s.last_body,
      s.last_message_at,
      u.display_name,
      u.email,
      u.is_active
    from stats s
    join public.users u on u.id = s.recipient_user_id
    where normalized_search = ''
      or lower(concat_ws(' ', u.display_name, u.email, s.last_body)) like '%' || normalized_search || '%'
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
        'body', matching.last_body,
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

create function public.admin_message_thread(
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
        'body', message_page.body,
        'created_at', message_page.created_at
      ) order by message_page.created_at, message_page.id)
      from (
        select m.id, m.sender_user_id, m.body, m.created_at
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

create function public.admin_send_message(
  p_actor_id uuid,
  p_recipient_user_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_body text := trim(coalesce(p_body, ''));
  message_row public.admin_messages%rowtype;
  recipient_name text;
  notification_id uuid;
begin
  if not public.admin_messages_actor_is_admin(p_actor_id) then
    raise exception 'Administrator access is required.';
  end if;
  if length(normalized_body) < 1 or length(normalized_body) > 2000 then
    raise exception 'Messages must contain between 1 and 2,000 characters.';
  end if;

  select u.display_name into recipient_name
  from public.users u
  where u.id = p_recipient_user_id;
  if not found then
    raise exception 'The requested user was not found.';
  end if;

  insert into public.admin_messages (recipient_user_id, sender_user_id, body)
  values (p_recipient_user_id, p_actor_id, normalized_body)
  returning * into message_row;

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    p_recipient_user_id,
    'admin_message',
    'Message from Evergreen',
    normalized_body,
    jsonb_build_object('admin_message_id', message_row.id)
  )
  returning id into notification_id;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
  values (
    p_actor_id,
    p_recipient_user_id,
    'admin_send_customer_message',
    'admin_message',
    message_row.id::text,
    jsonb_build_object('notification_id', notification_id, 'body_length', length(normalized_body))
  );

  return jsonb_build_object(
    'id', message_row.id,
    'recipient_user_id', message_row.recipient_user_id,
    'sender_id', message_row.sender_user_id,
    'body', message_row.body,
    'created_at', message_row.created_at,
    'notification_id', notification_id,
    'recipient_name', recipient_name
  );
end;
$$;

revoke all on function public.admin_messages_actor_is_admin(uuid) from public, anon, authenticated;
revoke all on function public.admin_search_message_recipients(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.admin_message_inbox(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.admin_message_thread(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.admin_send_message(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_messages_actor_is_admin(uuid) to service_role;
grant execute on function public.admin_search_message_recipients(uuid, text, integer) to service_role;
grant execute on function public.admin_message_inbox(uuid, text, integer) to service_role;
grant execute on function public.admin_message_thread(uuid, uuid, integer) to service_role;
grant execute on function public.admin_send_message(uuid, uuid, text) to service_role;
