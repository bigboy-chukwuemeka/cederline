alter table public.accounts
  add constraint accounts_user_account_type_unique unique (user_id, account_type);

create function public.create_default_accounts_for_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.accounts (user_id, account_type, name)
  values
    (new.id, 'checking', 'Checking'),
    (new.id, 'savings', 'Savings'),
    (new.id, 'loan', 'Loan'),
    (new.id, 'cd', 'CD')
  on conflict (user_id, account_type) do nothing;
  return new;
end;
$$;

create trigger users_create_default_accounts
  after insert on public.users
  for each row execute function public.create_default_accounts_for_user();

insert into public.accounts (user_id, account_type, name)
select users.id, account_types.account_type, account_types.name
from public.users
cross join (values
  ('checking', 'Checking'),
  ('savings', 'Savings'),
  ('loan', 'Loan'),
  ('cd', 'CD')
) as account_types(account_type, name)
on conflict (user_id, account_type) do nothing;