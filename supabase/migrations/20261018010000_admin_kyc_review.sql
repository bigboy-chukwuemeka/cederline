insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'identity-documents',
  'identity-documents',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create function public.admin_list_kyc_applications(
  p_actor_id uuid,
  p_search text default '',
  p_status text default 'all',
  p_page integer default 1,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  normalized_search text := lower(trim(coalesce(p_search, '')));
  safe_page integer := greatest(coalesce(p_page, 1), 1);
  safe_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
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

  with per_user as (
    select
      u.id as user_id,
      u.display_name,
      u.email,
      min(d.submitted_at) as submitted_at,
      count(d.id)::integer as document_count,
      (count(d.id) filter (where d.status in ('pending', 'under_review')))::integer as pending_count,
      case
        when bool_or(d.status in ('pending', 'under_review')) then 'pending'
        when bool_or(d.status = 'rejected') then 'rejected'
        else 'approved'
      end as review_status
    from public.identity_documents d
    join public.users u on u.id = d.user_id
    where normalized_search = ''
      or lower(concat_ws(' ', u.display_name, u.email)) like '%' || normalized_search || '%'
    group by u.id, u.display_name, u.email
  ),
  matching as (
    select * from per_user
    where p_status = 'all' or review_status = p_status
  ),
  page_rows as (
    select * from matching
    order by submitted_at asc
    offset (safe_page - 1) * safe_page_size
    limit safe_page_size
  )
  select jsonb_build_object(
    'total', (select count(*) from matching),
    'pending_total', (select count(*) from per_user where review_status = 'pending'),
    'applications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', user_id,
        'display_name', display_name,
        'email', email,
        'submitted_at', submitted_at,
        'document_count', document_count,
        'pending_count', pending_count,
        'status', review_status
      ) order by submitted_at asc)
      from page_rows
    ), '[]'::jsonb)
  ) into result;

  insert into public.audit_logs (actor_user_id, action, resource_type, metadata)
  values (
    p_actor_id,
    'admin_list_kyc_applications',
    'identity_document',
    jsonb_build_object('search_used', normalized_search <> '', 'status', p_status)
  );
  return result;
end;
$$;

create function public.admin_kyc_application_details(p_actor_id uuid, p_user_id uuid)
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
    'user', jsonb_build_object(
      'id', u.id,
      'display_name', u.display_name,
      'email', u.email,
      'phone_e164', u.phone_e164,
      'is_active', u.is_active,
      'created_at', u.created_at
    ),
    'profile', case when p.user_id is null then null else jsonb_build_object(
      'legal_first_name', p.legal_first_name,
      'legal_middle_name', p.legal_middle_name,
      'legal_last_name', p.legal_last_name,
      'date_of_birth', p.date_of_birth,
      'tax_id', p.tax_id,
      'residential_address', p.residential_address,
      'mailing_address', p.mailing_address
    ) end,
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'document_type', d.document_type,
        'status', d.status,
        'submitted_at', d.submitted_at,
        'reviewed_at', d.reviewed_at,
        'reviewer_notes', d.reviewer_notes,
        'storage_path', d.storage_path
      ) order by d.submitted_at desc)
      from public.identity_documents d
      where d.user_id = u.id
    ), '[]'::jsonb)
  )
  into result
  from public.users u
  left join public.user_profiles p on p.user_id = u.id
  where u.id = p_user_id;

  if result is null then
    raise exception 'The requested applicant was not found.';
  end if;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id)
  values (p_actor_id, p_user_id, 'admin_view_kyc_application', 'user', p_user_id::text);

  return result;
end;
$$;

create function public.admin_review_kyc_application(
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
  ) then
    raise exception 'Administrator access is required.';
  end if;
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
  where user_id = p_user_id
    and status in ('pending', 'under_review');

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

revoke all on function public.admin_list_kyc_applications(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_kyc_application_details(uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_review_kyc_application(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_list_kyc_applications(uuid, text, text, integer, integer) to service_role;
grant execute on function public.admin_kyc_application_details(uuid, uuid) to service_role;
grant execute on function public.admin_review_kyc_application(uuid, uuid, text, text) to service_role;
