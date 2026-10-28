create table public.kyc_applications (
  user_id uuid primary key references public.users (id) on delete cascade,
  form_data jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_user_id uuid references public.users (id) on delete set null,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.kyc_applications enable row level security;
revoke all on public.kyc_applications from public, anon, authenticated;
grant all on public.kyc_applications to service_role;

drop policy if exists identity_documents_self on public.identity_documents;
create policy identity_documents_select_self on public.identity_documents
  for select to authenticated using (user_id = (select auth.uid()));

alter table public.identity_documents
  add column original_file_name text,
  add column mime_type text,
  add column size_bytes bigint;

create or replace function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, username, display_name, is_active)
  values (
    new.id,
    new.email,
    nullif(lower(trim(new.raw_user_meta_data ->> 'username')), ''),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)),
    false
  )
  on conflict (id) do update
  set email = excluded.email,
      updated_at = now();
  return new;
end;
$$;

create or replace function public.create_default_accounts_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.accounts (user_id, account_type, name, status)
  values
    (new.id, 'checking', 'Checking', 'frozen'),
    (new.id, 'savings', 'Savings', 'frozen'),
    (new.id, 'loan', 'Loan', 'frozen'),
    (new.id, 'cd', 'CD', 'frozen')
  on conflict (user_id, account_type) do nothing;
  return new;
end;
$$;

create function public.submit_customer_kyc_application(
  p_user_id uuid,
  p_form_data jsonb,
  p_documents jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  application_date date;
  residential jsonb;
  mailing jsonb;
  document jsonb;
  phone_digits text;
  phone_value text;
begin
  if p_form_data is null or jsonb_typeof(p_form_data) <> 'object' then
    raise exception 'Application details are required.';
  end if;
  if p_documents is null or jsonb_typeof(p_documents) <> 'array'
    or jsonb_array_length(p_documents) < 1 or jsonb_array_length(p_documents) > 2 then
    raise exception 'One or two identity document files are required.';
  end if;

  application_date := to_date(p_form_data ->> 'dateOfBirth', 'MM/DD/YYYY');
  residential := jsonb_build_object(
    'street', nullif(trim(p_form_data ->> 'streetAddress'), ''),
    'line2', nullif(trim(p_form_data ->> 'addressLine2'), ''),
    'city', nullif(trim(p_form_data ->> 'city'), ''),
    'state', nullif(trim(p_form_data ->> 'state'), ''),
    'postal_code', nullif(trim(p_form_data ->> 'postalCode'), ''),
    'country', 'US'
  );
  mailing := case
    when p_form_data ->> 'mailingAddressDifferent' = 'true' then jsonb_build_object(
      'street', nullif(trim(p_form_data ->> 'mailingStreetAddress'), ''),
      'line2', nullif(trim(p_form_data ->> 'mailingAddressLine2'), ''),
      'city', nullif(trim(p_form_data ->> 'mailingCity'), ''),
      'state', nullif(trim(p_form_data ->> 'mailingState'), ''),
      'postal_code', nullif(trim(p_form_data ->> 'mailingPostalCode'), ''),
      'country', 'US'
    )
    else residential
  end;

  phone_digits := regexp_replace(coalesce(p_form_data ->> 'phone', ''), '[^0-9]', '', 'g');
  phone_value := case
    when length(phone_digits) = 10 then '+1' || phone_digits
    when length(phone_digits) = 11 and left(phone_digits, 1) = '1' then '+' || phone_digits
    else null
  end;

  update public.users
  set is_active = false,
      phone_e164 = coalesce(phone_value, phone_e164),
      updated_at = now()
  where id = p_user_id;
  if not found then
    raise exception 'The applicant account was not found.';
  end if;

  insert into public.user_profiles (
    user_id, legal_first_name, legal_last_name, date_of_birth, tax_id,
    residential_address, mailing_address, employment_status
  )
  values (
    p_user_id,
    nullif(trim(p_form_data ->> 'firstName'), ''),
    nullif(trim(p_form_data ->> 'lastName'), ''),
    application_date,
    nullif(trim(p_form_data ->> 'taxId'), ''),
    residential,
    mailing,
    nullif(trim(p_form_data ->> 'employmentStatus'), '')
  )
  on conflict (user_id) do update set
    legal_first_name = excluded.legal_first_name,
    legal_last_name = excluded.legal_last_name,
    date_of_birth = excluded.date_of_birth,
    tax_id = excluded.tax_id,
    residential_address = excluded.residential_address,
    mailing_address = excluded.mailing_address,
    employment_status = excluded.employment_status,
    updated_at = now();

  insert into public.kyc_applications (user_id, form_data, status, submitted_at, reviewed_at, reviewer_user_id, review_reason)
  values (p_user_id, p_form_data, 'pending', now(), null, null, null)
  on conflict (user_id) do update set
    form_data = excluded.form_data,
    status = 'pending',
    submitted_at = now(),
    reviewed_at = null,
    reviewer_user_id = null,
    review_reason = null,
    updated_at = now();

  delete from public.identity_documents where user_id = p_user_id;
  for document in select value from jsonb_array_elements(p_documents)
  loop
    insert into public.identity_documents (
      user_id, document_type, storage_path, status, expires_at,
      original_file_name, mime_type, size_bytes
    )
    values (
      p_user_id,
      document ->> 'document_type',
      document ->> 'storage_path',
      'pending',
      nullif(document ->> 'expires_at', '')::date,
      document ->> 'original_file_name',
      document ->> 'mime_type',
      nullif(document ->> 'size_bytes', '')::bigint
    );
  end loop;

  update public.accounts
  set status = 'frozen', updated_at = now()
  where user_id = p_user_id and status = 'open';

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    p_user_id,
    'kyc_review',
    'Your application is under review',
    'We received your application and identity documents. Our team is reviewing the information. Account and banking access will be available after your application is approved. We will notify you when there is an update.',
    jsonb_build_object('category', 'general', 'application_status', 'pending')
  );

  return jsonb_build_object('user_id', p_user_id, 'status', 'pending');
end;
$$;

create or replace function public.admin_review_kyc_application(
  p_actor_id uuid,
  p_user_id uuid,
  p_decision text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending_documents integer;
  normalized_reason text := trim(coalesce(p_reason, ''));
  next_status text;
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
  ) then raise exception 'Administrator access is required.'; end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Choose an approval or rejection decision.';
  end if;
  if p_decision = 'rejected' and length(normalized_reason) < 5 then
    raise exception 'A rejection reason of at least 5 characters is required.';
  end if;
  if length(normalized_reason) > 1000 then
    raise exception 'The review reason must be 1000 characters or fewer.';
  end if;

  perform d.id
  from public.identity_documents d
  where d.user_id = p_user_id and d.status in ('pending', 'under_review')
  for update;
  get diagnostics pending_documents = row_count;
  if pending_documents = 0 then
    raise exception 'This applicant has no pending identity documents to review.';
  end if;

  update public.identity_documents
  set status = case when p_decision = 'approved' then 'verified' else 'rejected' end,
      reviewed_at = now(),
      reviewer_notes = nullif(normalized_reason, ''),
      updated_at = now()
  where user_id = p_user_id and status in ('pending', 'under_review');

  update public.kyc_applications
  set status = p_decision,
      reviewed_at = now(),
      reviewer_user_id = p_actor_id,
      review_reason = nullif(normalized_reason, ''),
      updated_at = now()
  where user_id = p_user_id;

  update public.users
  set is_active = (p_decision = 'approved'), updated_at = now()
  where id = p_user_id;

  if p_decision = 'approved' then
    update public.accounts
    set status = 'open', updated_at = now()
    where user_id = p_user_id
      and status = 'frozen'
      and exists (select 1 from public.kyc_applications application where application.user_id = p_user_id);
  else
    update public.accounts
    set status = 'frozen', updated_at = now()
    where user_id = p_user_id and status = 'open';
  end if;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
  values (
    p_actor_id,
    p_user_id,
    case when p_decision = 'approved' then 'admin_approve_kyc_application' else 'admin_reject_kyc_application' end,
    'user',
    p_user_id::text,
    jsonb_build_object('decision', p_decision, 'reason', nullif(normalized_reason, ''), 'documents_reviewed', pending_documents)
  );

  select case
    when bool_or(status in ('pending', 'under_review')) then 'pending'
    when bool_or(status = 'rejected') then 'rejected'
    else 'approved'
  end
  into next_status
  from public.identity_documents
  where user_id = p_user_id;

  return jsonb_build_object('user_id', p_user_id, 'status', next_status, 'documents_reviewed', pending_documents);
end;
$$;

revoke all on function public.submit_customer_kyc_application(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.submit_customer_kyc_application(uuid, jsonb, jsonb) to service_role;
