alter table public.transfers
  add column reviewed_by uuid references public.users (id) on delete set null,
  add column reviewed_at timestamptz,
  add column review_reason text;

create function public.protect_pending_transfer_reserves()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved_amount numeric(19, 2);
begin
  if new.balance < old.balance then
    select coalesce(sum(t.amount), 0)
    into reserved_amount
    from public.transfers t
    where t.sender_account_id = new.id
      and t.status = 'pending';

    if new.balance < reserved_amount then
      raise exception using
        errcode = 'P0001',
        message = 'This debit would use funds reserved for transfers awaiting review.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_pending_transfer_reserves() from public, anon, authenticated;

create trigger accounts_protect_pending_transfer_reserves
  before update of balance on public.accounts
  for each row execute function public.protect_pending_transfer_reserves();

create function public.get_my_pending_transfer_reserves()
returns table (account_id uuid, reserved_amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select t.sender_account_id, sum(t.amount)
  from public.transfers t
  where t.sender_user_id = auth.uid()
    and t.status = 'pending'
  group by t.sender_account_id;
$$;

revoke all on function public.get_my_pending_transfer_reserves() from public, anon;
grant execute on function public.get_my_pending_transfer_reserves() to authenticated;

create or replace function public.complete_account_transfer(
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
  normalized_memo text := nullif(trim(coalesce(p_memo, '')), '');
  existing_transfer public.transfers%rowtype;
  sender_transaction_id uuid := gen_random_uuid();
  receiver_transaction_id uuid := gen_random_uuid();
  reserved_amount numeric(19, 2);
  request_time timestamptz := now();
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

  select * into existing_transfer
  from public.transfers
  where sender_user_id = current_user_id
    and idempotency_key = p_idempotency_key::text;
  if found then
    if existing_transfer.sender_account_id <> p_sender_account_id
      or existing_transfer.receiver_account_id <> p_recipient_account_id
      or existing_transfer.amount <> p_amount
      or existing_transfer.memo is distinct from normalized_memo then
      raise exception using errcode = '22023', message = 'This transfer request key was already used for different transfer details.';
    end if;
    if existing_transfer.status <> 'pending' then
      raise exception using errcode = '22023', message = 'This transfer request has already been decided. Check your transfer activity before retrying.';
    end if;
    return query
    select existing_transfer.id,
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

  select * into sender from public.accounts where id = p_sender_account_id;
  if not found or sender.user_id <> current_user_id then
    raise exception using errcode = '42501', message = 'The selected sender account is not available to you.';
  end if;

  select * into receiver from public.accounts where id = p_recipient_account_id;
  if not found or receiver.user_id = current_user_id then
    raise exception using errcode = '22023', message = 'Choose an account belonging to another registered customer.';
  end if;

  if sender.status <> 'open' or sender.account_type not in ('checking', 'savings') then
    raise exception using errcode = '22023', message = 'The selected sender account cannot send transfers.';
  end if;
  if receiver.status <> 'open' or receiver.account_type not in ('checking', 'savings', 'loan', 'cd') then
    raise exception using errcode = '22023', message = 'The recipient account cannot receive transfers.';
  end if;
  if not exists (select 1 from public.users u where u.id = receiver.user_id and u.is_active) then
    raise exception using errcode = '22023', message = 'The recipient is not eligible to receive transfers.';
  end if;
  if receiver.account_type = 'loan' and receiver.balance < p_amount then
    raise exception using errcode = 'P0001', message = 'The payment amount exceeds the remaining loan balance.';
  end if;
  if sender.currency <> receiver.currency or sender.currency <> 'USD' then
    raise exception using errcode = '22023', message = 'Transfers require matching supported currencies.';
  end if;

  select coalesce(sum(t.amount), 0)
  into reserved_amount
  from public.transfers t
  where t.sender_account_id = sender.id
    and t.status = 'pending';
  if sender.balance - reserved_amount < p_amount then
    raise exception using errcode = 'P0001', message = 'Insufficient available funds after pending transfers. Your balances have not changed.';
  end if;

  new_transfer_id := gen_random_uuid();
  new_reference := 'EGR-' || upper(substr(replace(new_transfer_id::text, '-', ''), 1, 12));

  insert into public.transfers (
    id, sender_user_id, receiver_user_id, sender_account_id, receiver_account_id,
    amount, currency, status, memo, idempotency_key
  ) values (
    new_transfer_id, current_user_id, receiver.user_id, sender.id, receiver.id,
    p_amount, sender.currency, 'pending', normalized_memo, p_idempotency_key::text
  );

  insert into public.transactions (
    id, account_id, transfer_id, transaction_type, status, amount, balance_after,
    currency, description, counterparty_name, counterparty_account_last_four,
    reference, occurred_at
  ) values
    (
      sender_transaction_id, sender.id, new_transfer_id, 'debit', 'pending', p_amount, null,
      sender.currency,
      case when receiver.account_type = 'loan' then 'Loan payment to ' || coalesce(receiver.name, 'loan account')
        else 'Transfer to ' || coalesce(receiver.name, 'account') end,
      (select u.display_name from public.users u where u.id = receiver.user_id),
      right(receiver.account_number, 4), new_reference, request_time
    ),
    (
      receiver_transaction_id, receiver.id, new_transfer_id,
      case when receiver.account_type = 'loan' then 'debit' else 'credit' end,
      'pending', p_amount, null, receiver.currency,
      case when receiver.account_type = 'loan' then 'Loan payment from ' || coalesce(sender.name, 'account')
        else 'Transfer from ' || coalesce(sender.name, 'account') end,
      (select u.display_name from public.users u where u.id = sender.user_id),
      right(sender.account_number, 4), new_reference, request_time
    );

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    current_user_id,
    'transfer_review_pending',
    'Transfer submitted for review',
    'Your transfer of ' || to_char(p_amount, 'FM999,999,999,990.00') || ' ' || trim(sender.currency)
      || ' to ' || (select u.display_name from public.users u where u.id = receiver.user_id)
      || ' is awaiting review. The reserved funds have not been posted.',
    jsonb_build_object(
      'transfer_id', new_transfer_id,
      'transaction_id', sender_transaction_id,
      'amount', p_amount,
      'currency', trim(sender.currency),
      'reference', new_reference,
      'event', 'pending_review'
    )
  );

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
  values (
    current_user_id, receiver.user_id, 'customer_submit_transfer_for_review',
    'transfer', new_transfer_id::text,
    jsonb_build_object('amount', p_amount, 'currency', trim(sender.currency), 'reference', new_reference)
  );

  return query select new_transfer_id, new_reference, null::timestamptz, null::numeric, null::numeric;
end;
$$;

create function public.notify_reviewed_transfer_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender_name text;
  receiver_name text;
  sender_tx public.transactions%rowtype;
  receiver_tx public.transactions%rowtype;
  receiver_account public.accounts%rowtype;
  receiver_account_name text;
  posted_label text;
begin
  if old.status <> 'pending' or new.status <> 'completed' then
    return new;
  end if;

  select display_name into sender_name from public.users where id = new.sender_user_id;
  select display_name into receiver_name from public.users where id = new.receiver_user_id;
  select * into sender_tx from public.transactions
  where transfer_id = new.id and account_id = new.sender_account_id;
  select * into receiver_tx from public.transactions
  where transfer_id = new.id and account_id = new.receiver_account_id;
  select * into receiver_account from public.accounts where id = new.receiver_account_id;
  receiver_account_name := coalesce(nullif(trim(receiver_account.name), ''),
    case receiver_account.account_type when 'checking' then 'Checking' when 'savings' then 'Savings'
      when 'cd' then 'Certificate of Deposit' else 'Account' end);
  posted_label := to_char(new.completed_at at time zone 'UTC', 'Mon DD, YYYY HH12:MI AM "UTC"');

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    new.sender_user_id,
    'transfer_sent',
    'Transfer sent',
    'Your transfer of ' || to_char(new.amount, 'FM999,999,999,990.00') || ' ' || trim(new.currency)
      || ' to ' || coalesce(receiver_name, 'another Cedarline customer') || ' has been approved and posted.',
    jsonb_build_object(
      'transfer_id', new.id,
      'transaction_id', sender_tx.id,
      'account_id', sender_tx.account_id,
      'amount', new.amount,
      'currency', trim(new.currency),
      'reference', sender_tx.reference,
      'posted_at', new.completed_at
    )
  );

  insert into public.notifications (user_id, notification_type, title, body, data)
  values (
    new.receiver_user_id,
    'transfer_received',
    'Transfer received',
    'You received ' || to_char(new.amount, 'FM999,999,999,990.00') || ' ' || trim(new.currency)
      || ' from ' || coalesce(sender_name, 'another Cedarline customer') || '.'
      || E'\n\nCredited to: ' || receiver_account_name
      || ' ending in ' || right(receiver_account.account_number, 4)
      || E'\nPosted: ' || posted_label
      || case when nullif(trim(coalesce(new.memo, '')), '') is null then ''
        else E'\nMemo: ' || trim(new.memo) end
      || E'\nReference: ' || receiver_tx.reference,
    jsonb_build_object(
      'transfer_id', new.id,
      'transaction_id', receiver_tx.id,
      'account_id', receiver_tx.account_id,
      'amount', new.amount,
      'currency', trim(new.currency),
      'counterparty_name', coalesce(sender_name, 'Another Cedarline customer'),
      'reference', receiver_tx.reference,
      'account_name', receiver_account_name,
      'account_last_four', right(receiver_account.account_number, 4),
      'posted_at', new.completed_at,
      'memo', new.memo
    )
  );
  return new;
end;
$$;

revoke all on function public.notify_reviewed_transfer_completion() from public, anon, authenticated;

create trigger transfers_notify_reviewed_completion
  after update of status on public.transfers
  for each row execute function public.notify_reviewed_transfer_completion();

create function public.admin_review_pending_transfer(
  p_actor_id uuid,
  p_transfer_id uuid,
  p_decision text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  transfer_row public.transfers%rowtype;
  sender public.accounts%rowtype;
  receiver public.accounts%rowtype;
  sender_balance numeric(19, 2);
  receiver_balance numeric(19, 2);
  normalized_reason text := trim(coalesce(p_reason, ''));
  reviewed_time timestamptz := now();
  action_name text;
  pending_transaction_count integer;
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
              case when jsonb_typeof(actor.raw_app_meta_data -> 'roles') = 'array'
                then actor.raw_app_meta_data -> 'roles' else '[]'::jsonb end
            ) as role_values(role_name)
            where lower(role_name) = 'admin'
          )
        )
      )
  ) then
    raise exception 'Administrator access is required.';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'Choose approve or reject.';
  end if;
  if p_decision = 'reject' and (length(normalized_reason) < 5 or length(normalized_reason) > 500) then
    raise exception 'Provide a rejection reason between 5 and 500 characters.';
  end if;
  if p_decision = 'approve' and length(normalized_reason) > 500 then
    raise exception 'Approval note must be 500 characters or fewer.';
  end if;

  select * into transfer_row from public.transfers where id = p_transfer_id for update;
  if not found then
    raise exception 'The requested transfer was not found.';
  end if;
  if transfer_row.status <> 'pending' then
    raise exception 'This transfer is no longer awaiting review.';
  end if;
  select count(*) into pending_transaction_count
  from public.transactions
  where transfer_id = p_transfer_id and status = 'pending';
  if pending_transaction_count <> 2 then
    raise exception 'This transfer does not have a complete pair of pending transaction records.';
  end if;

  perform a.id
  from public.accounts a
  where a.id in (transfer_row.sender_account_id, transfer_row.receiver_account_id)
  order by a.id
  for update;
  select * into sender from public.accounts where id = transfer_row.sender_account_id;
  select * into receiver from public.accounts where id = transfer_row.receiver_account_id;

  if p_decision = 'approve' then
    if sender.status <> 'open' or receiver.status <> 'open'
      or sender.investigation_hold_at is not null
      or receiver.investigation_hold_at is not null
      or not exists (select 1 from public.users u where u.id = sender.user_id and u.is_active)
      or not exists (select 1 from public.users u where u.id = receiver.user_id and u.is_active) then
      raise exception 'The sender or recipient account is no longer eligible for this transfer.';
    end if;
    if sender.balance < transfer_row.amount then
      raise exception 'The sender account no longer has enough funds for this transfer.';
    end if;
    if receiver.account_type = 'loan' and receiver.balance < transfer_row.amount then
      raise exception 'The loan balance is no longer sufficient for this payment.';
    end if;

    update public.transfers
    set status = 'completed', completed_at = reviewed_time,
        reviewed_by = p_actor_id, reviewed_at = reviewed_time,
        review_reason = nullif(normalized_reason, '')
    where id = p_transfer_id
    returning * into transfer_row;

    update public.accounts set balance = balance - transfer_row.amount, updated_at = reviewed_time
    where id = transfer_row.sender_account_id returning balance into sender_balance;
    update public.accounts
    set balance = case when receiver.account_type = 'loan' then balance - transfer_row.amount
      else balance + transfer_row.amount end,
      updated_at = reviewed_time
    where id = transfer_row.receiver_account_id returning balance into receiver_balance;

    update public.transactions
    set status = 'posted',
        balance_after = case when account_id = transfer_row.sender_account_id then sender_balance else receiver_balance end,
        occurred_at = reviewed_time
    where transfer_id = p_transfer_id and status = 'pending';
    action_name := 'admin_approve_pending_transfer';
  else
    update public.transfers
    set status = 'failed', reviewed_by = p_actor_id, reviewed_at = reviewed_time,
        review_reason = normalized_reason
    where id = p_transfer_id
    returning * into transfer_row;

    update public.transactions
    set status = 'failed', occurred_at = reviewed_time
    where transfer_id = p_transfer_id and status = 'pending';

    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      transfer_row.sender_user_id,
      'transfer_review_rejected',
      'Transfer not approved',
      'Your transfer request of ' || to_char(transfer_row.amount, 'FM999,999,999,990.00') || ' '
        || trim(transfer_row.currency) || ' was not approved. No funds were moved. Reason: ' || normalized_reason,
      jsonb_build_object('transfer_id', p_transfer_id, 'reference', (
        select reference from public.transactions where transfer_id = p_transfer_id and account_id = transfer_row.sender_account_id
      ), 'event', 'rejected')
    );
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      transfer_row.receiver_user_id,
      'transfer_review_rejected',
      'Transfer request not completed',
      'A transfer request addressed to your account was not approved. No funds were posted.',
      jsonb_build_object('transfer_id', p_transfer_id, 'event', 'rejected')
    );
    action_name := 'admin_reject_pending_transfer';
  end if;

  insert into public.audit_logs (actor_user_id, subject_user_id, action, resource_type, resource_id, metadata)
  values (
    p_actor_id, transfer_row.sender_user_id, action_name, 'transfer', p_transfer_id::text,
    jsonb_build_object(
      'amount', transfer_row.amount,
      'currency', trim(transfer_row.currency),
      'sender_user_id', transfer_row.sender_user_id,
      'receiver_user_id', transfer_row.receiver_user_id,
      'decision', p_decision,
      'reason', nullif(normalized_reason, '')
    )
  );

  return jsonb_build_object(
    'transfer_id', transfer_row.id,
    'status', transfer_row.status,
    'reviewed_at', transfer_row.reviewed_at,
    'reason', transfer_row.review_reason
  );
end;
$$;

revoke all on function public.admin_review_pending_transfer(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_review_pending_transfer(uuid, uuid, text, text) to service_role;

create function public.prevent_flagging_pending_transfers()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_flagged and not old.is_flagged and new.transfer_id is not null and new.status = 'pending' then
    raise exception 'Transfers awaiting approval must be reviewed, not flagged as posted transactions.';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_flagging_pending_transfers() from public, anon, authenticated;

create trigger transactions_prevent_flagging_pending_transfer
  before update of is_flagged on public.transactions
  for each row execute function public.prevent_flagging_pending_transfers();
