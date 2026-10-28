create sequence public.account_number_seq start with 100000000001;

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  username text,
  display_name text not null,
  phone_e164 text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_username_lowercase check (username is null or username = lower(username))
);

create unique index users_email_lower_idx on public.users (lower(email));
create unique index users_username_lower_idx on public.users (lower(username)) where username is not null;

create table public.user_profiles (
  user_id uuid primary key references public.users (id) on delete cascade,
  legal_first_name text,
  legal_middle_name text,
  legal_last_name text,
  date_of_birth date,
  tax_id text,
  residential_address jsonb not null default '{}'::jsonb,
  mailing_address jsonb not null default '{}'::jsonb,
  employment_status text,
  employer_name text,
  occupation text,
  annual_income numeric(19, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_annual_income_nonnegative check (annual_income is null or annual_income >= 0)
);

create table public.identity_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  document_type text not null,
  storage_path text not null,
  issuing_country char(2),
  status text not null default 'pending'
    check (status in ('pending', 'under_review', 'verified', 'rejected', 'expired')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  expires_at date,
  reviewer_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint identity_documents_storage_path_nonempty check (length(trim(storage_path)) > 0)
);

create index identity_documents_user_idx on public.identity_documents (user_id, created_at desc);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete restrict,
  account_number text not null unique
    default lpad(nextval('public.account_number_seq')::text, 12, '0'),
  account_type text not null check (account_type in ('checking', 'savings', 'loan', 'cd')),
  name text,
  currency char(3) not null default 'USD',
  balance numeric(19, 2) not null default 0.00,
  status text not null default 'open' check (status in ('open', 'frozen', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_balance_nonnegative check (balance >= 0),
  constraint accounts_closed_at_consistent check (
    (status = 'closed' and closed_at is not null) or
    (status <> 'closed' and closed_at is null)
  ),
  constraint accounts_id_user_unique unique (id, user_id)
);

create index accounts_user_idx on public.accounts (user_id, account_type);
create index accounts_last_four_idx on public.accounts ((right(account_number, 4)));

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete cascade,
  name text not null,
  category_type text not null default 'expense' check (category_type in ('income', 'expense')),
  icon text,
  color text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  constraint categories_system_owner_consistent check (not is_system or user_id is null)
);

create unique index categories_system_name_idx
  on public.categories (lower(name), category_type) where is_system;
create unique index categories_user_name_idx
  on public.categories (user_id, lower(name), category_type) where user_id is not null;

create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  sender_user_id uuid not null references public.users (id) on delete restrict,
  receiver_user_id uuid not null references public.users (id) on delete restrict,
  sender_account_id uuid not null,
  receiver_account_id uuid not null,
  amount numeric(19, 2) not null check (amount > 0),
  currency char(3) not null default 'USD',
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed', 'cancelled')),
  memo text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint transfers_distinct_accounts check (sender_account_id <> receiver_account_id),
  constraint transfers_distinct_users check (sender_user_id <> receiver_user_id),
  constraint transfers_sender_account_owner foreign key (sender_account_id, sender_user_id)
    references public.accounts (id, user_id) on delete restrict,
  constraint transfers_receiver_account_owner foreign key (receiver_account_id, receiver_user_id)
    references public.accounts (id, user_id) on delete restrict,
  constraint transfers_completion_consistent check (
    (status = 'completed' and completed_at is not null) or
    (status <> 'completed' and completed_at is null)
  )
);

create index transfers_sender_idx on public.transfers (sender_user_id, created_at desc);
create index transfers_receiver_idx on public.transfers (receiver_user_id, created_at desc);
create unique index transfers_sender_idempotency_idx
  on public.transfers (sender_user_id, idempotency_key) where idempotency_key is not null;

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  amount numeric(19, 2) not null check (amount >= 0),
  currency char(3) not null default 'USD',
  period_start date not null,
  period_end date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budgets_period_valid check (period_end >= period_start)
);

create index budgets_user_period_idx on public.budgets (user_id, period_start, period_end);

create table public.budget_categories (
  budget_id uuid not null references public.budgets (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete restrict,
  amount numeric(19, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  primary key (budget_id, category_id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete restrict,
  transfer_id uuid references public.transfers (id) on delete restrict,
  category_id uuid references public.categories (id) on delete set null,
  transaction_type text not null
    check (transaction_type in ('credit', 'debit')),
  status text not null default 'posted'
    check (status in ('pending', 'posted', 'reversed', 'failed')),
  amount numeric(19, 2) not null check (amount > 0),
  balance_after numeric(19, 2),
  currency char(3) not null default 'USD',
  description text not null,
  counterparty_name text,
  counterparty_account_last_four char(4),
  reference text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint transactions_balance_after_nonnegative check (balance_after is null or balance_after >= 0),
  constraint transactions_transfer_account_unique unique (transfer_id, account_id)
);

create index transactions_account_date_idx on public.transactions (account_id, occurred_at desc);
create index transactions_transfer_idx on public.transactions (transfer_id) where transfer_id is not null;
create index transactions_category_idx on public.transactions (category_id) where category_id is not null;

create table public.statements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete restrict,
  period_start date not null,
  period_end date not null,
  storage_path text not null,
  file_type text not null default 'application/pdf',
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint statements_period_valid check (period_end >= period_start),
  constraint statements_unique_period unique (account_id, period_start, period_end)
);

create index statements_account_period_idx on public.statements (account_id, period_end desc);

create table public.alert_preferences (
  user_id uuid primary key references public.users (id) on delete cascade,
  email_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  push_enabled boolean not null default true,
  low_balance_threshold numeric(19, 2) check (low_balance_threshold is null or low_balance_threshold >= 0),
  large_transaction_threshold numeric(19, 2) check (
    large_transaction_threshold is null or large_transaction_threshold >= 0
  ),
  transaction_alerts boolean not null default true,
  login_alerts boolean not null default true,
  security_alerts boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc) where read_at is null;

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  device_identifier text not null,
  device_name text,
  platform text not null check (platform in ('web', 'ios', 'android', 'other')),
  push_token text,
  last_seen_at timestamptz not null default now(),
  trusted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint devices_user_identifier_unique unique (user_id, device_identifier)
);

create index devices_user_idx on public.devices (user_id, last_seen_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.users (id) on delete set null,
  subject_user_id uuid references public.users (id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id text,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_subject_date_idx on public.audit_logs (subject_user_id, created_at desc);
create index audit_logs_actor_date_idx on public.audit_logs (actor_user_id, created_at desc);

create function public.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, username, display_name)
  values (
    new.id,
    new.email,
    nullif(lower(trim(new.raw_user_meta_data ->> 'username')), ''),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do update
  set email = excluded.email,
      updated_at = now();
  return new;
end;
$$;

create trigger on_auth_user_created_or_updated
  after insert or update of email on auth.users
  for each row execute function public.handle_auth_user_change();

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at before update on public.users
  for each row execute function public.set_updated_at();
create trigger user_profiles_set_updated_at before update on public.user_profiles
  for each row execute function public.set_updated_at();
create trigger identity_documents_set_updated_at before update on public.identity_documents
  for each row execute function public.set_updated_at();
create trigger accounts_set_updated_at before update on public.accounts
  for each row execute function public.set_updated_at();
create trigger budgets_set_updated_at before update on public.budgets
  for each row execute function public.set_updated_at();
create trigger alert_preferences_set_updated_at before update on public.alert_preferences
  for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.user_profiles enable row level security;
alter table public.identity_documents enable row level security;
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transfers enable row level security;
alter table public.budgets enable row level security;
alter table public.budget_categories enable row level security;
alter table public.transactions enable row level security;
alter table public.statements enable row level security;
alter table public.alert_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.devices enable row level security;
alter table public.audit_logs enable row level security;

create policy users_select_self on public.users
  for select to authenticated using (id = (select auth.uid()));

create policy user_profiles_self on public.user_profiles
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy identity_documents_self on public.identity_documents
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy accounts_select_self on public.accounts
  for select to authenticated using (user_id = (select auth.uid()));

create policy categories_select_visible on public.categories
  for select to authenticated using (is_system or user_id = (select auth.uid()));
create policy categories_insert_own on public.categories
  for insert to authenticated with check (user_id = (select auth.uid()) and not is_system);
create policy categories_update_own on public.categories
  for update to authenticated
  using (user_id = (select auth.uid()) and not is_system)
  with check (user_id = (select auth.uid()) and not is_system);
create policy categories_delete_own on public.categories
  for delete to authenticated using (user_id = (select auth.uid()) and not is_system);

create policy transfers_select_participant on public.transfers
  for select to authenticated
  using (sender_user_id = (select auth.uid()) or receiver_user_id = (select auth.uid()));

create policy budgets_self on public.budgets
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy budget_categories_self on public.budget_categories
  for all to authenticated
  using (exists (
    select 1 from public.budgets b
    where b.id = budget_id and b.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.budgets b
    where b.id = budget_id and b.user_id = (select auth.uid())
  ));

create policy transactions_select_owner on public.transactions
  for select to authenticated using (
    exists (
      select 1 from public.accounts a
      where a.id = account_id and a.user_id = (select auth.uid())
    )
  );

create policy statements_select_owner on public.statements
  for select to authenticated using (
    exists (
      select 1 from public.accounts a
      where a.id = account_id and a.user_id = (select auth.uid())
    )
  );

create policy alert_preferences_self on public.alert_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy notifications_select_self on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update_self on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy devices_self on public.devices
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy audit_logs_select_subject on public.audit_logs
  for select to authenticated using (subject_user_id = (select auth.uid()));
