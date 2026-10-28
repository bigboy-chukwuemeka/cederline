create function public.add_admin_transfer_notification_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  transfer_transaction public.transactions%rowtype;
  recipient_account public.accounts%rowtype;
  account_label text;
  posted_label text;
begin
  if new.notification_type <> 'transfer_received'
    or coalesce(new.data ->> 'transaction_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return new;
  end if;

  select * into transfer_transaction
  from public.transactions
  where id = (new.data ->> 'transaction_id')::uuid
    and transaction_type = 'credit'
    and status = 'posted';

  if not found then
    return new;
  end if;

  select * into recipient_account
  from public.accounts
  where id = transfer_transaction.account_id
    and user_id = new.user_id;

  if not found then
    return new;
  end if;

  account_label := coalesce(
    nullif(trim(recipient_account.name), ''),
    case recipient_account.account_type
      when 'checking' then 'Checking'
      when 'savings' then 'Savings'
      when 'cd' then 'Certificate of Deposit'
      else 'Account'
    end
  );
  posted_label := to_char(
    transfer_transaction.occurred_at at time zone 'UTC',
    'Mon DD, YYYY HH12:MI AM "UTC"'
  );

  new.body := rtrim(new.body) || E'\n\nCredited to: ' || account_label
    || ' ending in ' || right(recipient_account.account_number, 4)
    || E'\nPosted: ' || posted_label;
  new.data := new.data || jsonb_build_object(
    'account_name', account_label,
    'account_last_four', right(recipient_account.account_number, 4),
    'posted_at', transfer_transaction.occurred_at
  );

  return new;
end;
$$;

revoke all on function public.add_admin_transfer_notification_details() from public, anon, authenticated;

create trigger notifications_add_admin_transfer_details
  before insert on public.notifications
  for each row execute function public.add_admin_transfer_notification_details();
