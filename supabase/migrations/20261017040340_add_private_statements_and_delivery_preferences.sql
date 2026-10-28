create table public.statement_delivery_preferences (
  user_id uuid primary key references public.users (id) on delete cascade,
  paperless_enabled boolean not null default true,
  delivery_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint statement_delivery_email_nonempty check (length(trim(delivery_email)) > 0)
);

create trigger statement_delivery_preferences_set_updated_at
  before update on public.statement_delivery_preferences
  for each row execute function public.set_updated_at();

alter table public.statement_delivery_preferences enable row level security;

create policy statement_delivery_preferences_self
  on public.statement_delivery_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bank-statements', 'bank-statements', false, 20971520, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists bank_statement_documents_select_owner on storage.objects;
create policy bank_statement_documents_select_owner
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'bank-statements'
    and exists (
      select 1
      from public.statements s
      join public.accounts a on a.id = s.account_id
      where s.storage_path = storage.objects.name
        and a.user_id = (select auth.uid())
    )
  );