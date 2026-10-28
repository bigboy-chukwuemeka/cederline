create table public.profile_preferences (
  user_id uuid primary key references public.users (id) on delete cascade,
  account_updates_enabled boolean not null default true,
  product_news_enabled boolean not null default false,
  helpful_tips_enabled boolean not null default false,
  language text not null default 'en-US',
  time_zone text not null default 'America/New_York',
  session_timeout_minutes integer not null default 10
    check (session_timeout_minutes in (5, 10, 15, 30)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profile_preferences_set_updated_at
  before update on public.profile_preferences
  for each row execute function public.set_updated_at();

alter table public.profile_preferences enable row level security;

create policy profile_preferences_self
  on public.profile_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create function public.save_customer_profile(
  p_first_name text,
  p_last_name text,
  p_phone_e164 text,
  p_mailing_address text,
  p_account_updates_enabled boolean,
  p_product_news_enabled boolean,
  p_helpful_tips_enabled boolean,
  p_language text,
  p_time_zone text,
  p_session_timeout_minutes integer,
  p_paperless_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text;
  normalized_phone text := nullif(trim(coalesce(p_phone_e164, '')), '');
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Sign in to update your profile.';
  end if;
  if nullif(trim(coalesce(p_first_name, '')), '') is null
    or nullif(trim(coalesce(p_last_name, '')), '') is null then
    raise exception using errcode = '22023', message = 'First and last name are required.';
  end if;
  if normalized_phone is not null and normalized_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception using errcode = '22023', message = 'Enter a phone number in international format, such as +15555550100.';
  end if;
  if coalesce(p_language, '') not in ('en-US', 'es-US') then
    raise exception using errcode = '22023', message = 'Choose a supported language.';
  end if;
  if coalesce(p_time_zone, '') not in (
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles'
  ) then
    raise exception using errcode = '22023', message = 'Choose a supported time zone.';
  end if;
  if p_session_timeout_minutes not in (5, 10, 15, 30) then
    raise exception using errcode = '22023', message = 'Choose a supported session timeout.';
  end if;

  select u.email into current_email
  from public.users u
  where u.id = current_user_id;
  if current_email is null then
    raise exception using errcode = 'P0002', message = 'The signed-in customer profile could not be found.';
  end if;

  update public.users
  set display_name = trim(p_first_name) || ' ' || trim(p_last_name),
      phone_e164 = normalized_phone
  where id = current_user_id;

  insert into public.user_profiles (
    user_id,
    legal_first_name,
    legal_last_name,
    mailing_address
  )
  values (
    current_user_id,
    trim(p_first_name),
    trim(p_last_name),
    jsonb_build_object('formatted', trim(coalesce(p_mailing_address, '')))
  )
  on conflict (user_id) do update
  set legal_first_name = excluded.legal_first_name,
      legal_last_name = excluded.legal_last_name,
      mailing_address = excluded.mailing_address;

  insert into public.profile_preferences (
    user_id,
    account_updates_enabled,
    product_news_enabled,
    helpful_tips_enabled,
    language,
    time_zone,
    session_timeout_minutes
  )
  values (
    current_user_id,
    p_account_updates_enabled,
    p_product_news_enabled,
    p_helpful_tips_enabled,
    p_language,
    p_time_zone,
    p_session_timeout_minutes
  )
  on conflict (user_id) do update
  set account_updates_enabled = excluded.account_updates_enabled,
      product_news_enabled = excluded.product_news_enabled,
      helpful_tips_enabled = excluded.helpful_tips_enabled,
      language = excluded.language,
      time_zone = excluded.time_zone,
      session_timeout_minutes = excluded.session_timeout_minutes;

  insert into public.statement_delivery_preferences (user_id, paperless_enabled, delivery_email)
  values (current_user_id, coalesce(p_paperless_enabled, true), current_email)
  on conflict (user_id) do update
  set paperless_enabled = excluded.paperless_enabled;
end;
$$;

revoke all on function public.save_customer_profile(
  text, text, text, text, boolean, boolean, boolean, text, text, integer, boolean
) from public, anon;
grant execute on function public.save_customer_profile(
  text, text, text, text, boolean, boolean, boolean, text, text, integer, boolean
) to authenticated;