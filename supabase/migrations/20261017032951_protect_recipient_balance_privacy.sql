revoke all on function public.complete_account_transfer(uuid, uuid, numeric, text, uuid)
  from public, anon, authenticated;

create function public.complete_registered_transfer(
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
  sender_balance_after numeric
)
language sql
security definer
set search_path = ''
as $$
  select
    result.transfer_id,
    result.reference,
    result.completed_at,
    result.sender_balance_after
  from public.complete_account_transfer(
    p_sender_account_id,
    p_recipient_account_id,
    p_amount,
    p_memo,
    p_idempotency_key
  ) as result;
$$;

revoke all on function public.complete_registered_transfer(uuid, uuid, numeric, text, uuid)
  from public, anon;
grant execute on function public.complete_registered_transfer(uuid, uuid, numeric, text, uuid)
  to authenticated;