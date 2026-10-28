create function public.find_transfer_recipients(p_query text)
returns table (
  account_id uuid,
  account_type text,
  recipient_name text,
  account_last_four text
)
language sql
stable
security definer
set search_path = ''
as $$
  with query_value as (
    select lower(trim(coalesce(p_query, ''))) as value
  )
  select
    a.id,
    a.account_type,
    u.display_name,
    right(a.account_number, 4)
  from public.accounts a
  join public.users u on u.id = a.user_id
  cross join query_value q
  where auth.uid() is not null
    and u.id <> (select auth.uid())
    and u.is_active
    and a.status = 'open'
    and a.account_type in ('checking', 'savings', 'cd')
    and (
      lower(u.email) = q.value
      or lower(coalesce(u.username, '')) = q.value
      or a.account_number = q.value
      or (q.value ~ '^[0-9]{4}$' and right(a.account_number, 4) = q.value)
    )
  order by
    case
      when a.account_number = q.value then 0
      when lower(u.email) = q.value or lower(coalesce(u.username, '')) = q.value then 1
      else 2
    end,
    a.account_type
  limit 20;
$$;

create function public.complete_account_transfer(
  p_sender_account_id uuid,
  p_recipient_account_id uuid,
  p_amount numeric,
  p_memo text,
  p_idempotency_key uuid
)
returns table (
  transfer_id uuid,
  reference text,
  completed_at timestamptz,
  sender_balance_after numeric,
  receiver_balance_after numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  sender public.accounts%rowtype;
  receiver public.accounts%rowtype;
  new_transfer_id uuid;
  new_reference text;
  sender_balance numeric(19, 2);
  receiver_balance numeric(19, 2);
  completed_time timestamptz := now();
  existing_transfer public.transfers%rowtype;
begin
  if current_user_id is null then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;
  if p_sender_account_id is null or p_recipient_account_id is null then
    raise exception using errcode = '22023', message = 'Select a sender and recipient account.';
  end if;
  if p_sender_account_id = p_recipient_account_id then
    raise exception using errcode = '22023', message = 'Sender and recipient accounts must be different.';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception using errcode = '22023', message = 'Enter a valid amount greater than $0.00 with no more than two decimal places.';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'A unique transfer request key is required.';
  end if;
  if length(coalesce(p_memo, '')) > 140 then
    raise exception using errcode = '22023', message = 'Memo must be 140 characters or fewer.';
  end if;

  select t.* into existing_transfer
  from public.transfers t
  where t.sender_user_id = current_user_id
    and t.idempotency_key = p_idempotency_key::text;

  if found then
    return query
    select
      existing_transfer.id,
      coalesce(
        (select tx.reference from public.transactions tx
         where tx.transfer_id = existing_transfer.id
           and tx.account_id = existing_transfer.sender_account_id),
        existing_transfer.id::text
      ),
      existing_transfer.completed_at,
      (select tx.balance_after from public.transactions tx
       where tx.transfer_id = existing_transfer.id
         and tx.account_id = existing_transfer.sender_account_id),
      (select tx.balance_after from public.transactions tx
       where tx.transfer_id = existing_transfer.id
         and tx.account_id = existing_transfer.receiver_account_id);
    return;
  end if;

  perform a.id
  from public.accounts a
  where a.id in (p_sender_account_id, p_recipient_account_id)
  order by a.id
  for update;

  select a.* into sender
  from public.accounts a
  where a.id = p_sender_account_id;
  if not found or sender.user_id <> current_user_id then
    raise exception using errcode = '42501', message = 'The selected sender account is not available to you.';
  end if;

  select a.* into receiver
  from public.accounts a
  where a.id = p_recipient_account_id;
  if not found or receiver.user_id = current_user_id then
    raise exception using errcode = '22023', message = 'Choose an account belonging to another registered customer.';
  end if;

  if sender.status <> 'open' or sender.account_type not in ('checking', 'savings') then
    raise exception using errcode = '22023', message = 'The selected sender account cannot send transfers.';
  end if;
  if receiver.status <> 'open' or receiver.account_type not in ('checking', 'savings', 'cd') then
    raise exception using errcode = '22023', message = 'The recipient account cannot receive transfers.';
  end if;
  if sender.currency <> receiver.currency or sender.currency <> 'USD' then
    raise exception using errcode = '22023', message = 'Transfers require matching supported currencies.';
  end if;
  if sender.balance < p_amount then
    raise exception using errcode = 'P0001', message = 'Insufficient funds. The available balance has not changed.';
  end if;

  new_transfer_id := gen_random_uuid();
  new_reference := 'EGR-' || upper(substr(replace(new_transfer_id::text, '-', ''), 1, 12));

  insert into public.transfers (
    id,
    sender_user_id,
    receiver_user_id,
    sender_account_id,
    receiver_account_id,
    amount,
    currency,
    status,
    memo,
    idempotency_key,
    completed_at
  ) values (
    new_transfer_id,
    current_user_id,
    receiver.user_id,
    sender.id,
    receiver.id,
    p_amount,
    sender.currency,
    'completed',
    nullif(trim(coalesce(p_memo, '')), ''),
    p_idempotency_key::text,
    completed_time
  );

  update public.accounts a
  set balance = a.balance - p_amount
  where a.id = sender.id
  returning a.balance into sender_balance;

  update public.accounts a
  set balance = a.balance + p_amount
  where a.id = receiver.id
  returning a.balance into receiver_balance;

  insert into public.transactions (
    account_id,
    transfer_id,
    transaction_type,
    status,
    amount,
    balance_after,
    currency,
    description,
    counterparty_name,
    counterparty_account_last_four,
    reference,
    occurred_at
  ) values
    (
      sender.id,
      new_transfer_id,
      'debit',
      'posted',
      p_amount,
      sender_balance,
      sender.currency,
      'Transfer to ' || receiver.name,
      (select u.display_name from public.users u where u.id = receiver.user_id),
      right(receiver.account_number, 4),
      new_reference,
      completed_time
    ),
    (
      receiver.id,
      new_transfer_id,
      'credit',
      'posted',
      p_amount,
      receiver_balance,
      receiver.currency,
      'Transfer from ' || sender.name,
      (select u.display_name from public.users u where u.id = sender.user_id),
      right(sender.account_number, 4),
      new_reference,
      completed_time
    );

  return query
  select new_transfer_id, new_reference, completed_time, sender_balance, receiver_balance;
end;
$$;

revoke all on function public.find_transfer_recipients(text) from public, anon;
revoke all on function public.complete_account_transfer(uuid, uuid, numeric, text, uuid) from public, anon;
grant execute on function public.find_transfer_recipients(text) to authenticated;
grant execute on function public.complete_account_transfer(uuid, uuid, numeric, text, uuid) to authenticated;