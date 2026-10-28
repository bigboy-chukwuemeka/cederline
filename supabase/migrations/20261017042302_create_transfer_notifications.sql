create function public.notify_completed_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sender_name text;
  receiver_name text;
begin
  if new.status <> 'completed' then
    return new;
  end if;

  select u.display_name into sender_name
  from public.users u
  where u.id = new.sender_user_id;

  select u.display_name into receiver_name
  from public.users u
  where u.id = new.receiver_user_id;

  if coalesce((
    select p.transfer_updates_enabled
    from public.alert_preferences p
    where p.user_id = new.sender_user_id
  ), true) then
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      new.sender_user_id,
      'transfer_sent',
      'Transfer sent',
      'Your transfer of ' || new.amount::text || ' ' || trim(new.currency) || ' to '
        || coalesce(receiver_name, 'another Cedarline customer') || ' is complete.',
      jsonb_build_object('transfer_id', new.id)
    );
  end if;

  if coalesce((
    select p.transfer_updates_enabled
    from public.alert_preferences p
    where p.user_id = new.receiver_user_id
  ), true) then
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      new.receiver_user_id,
      'transfer_received',
      'Transfer received',
      'You received ' || new.amount::text || ' ' || trim(new.currency) || ' from '
        || coalesce(sender_name, 'another Cedarline customer') || '.',
      jsonb_build_object('transfer_id', new.id)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_completed_transfer() from public, anon, authenticated;

create trigger transfers_notify_participants
  after insert on public.transfers
  for each row execute function public.notify_completed_transfer();