create function public.notify_account_investigation_hold_released()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_name text := initcap(replace(new.account_type, '_', ' '));
  status_message text;
begin
  if old.investigation_hold_at is not null and new.investigation_hold_at is null then
    status_message := case
      when new.status = 'open' then 'The investigation hold has been released and your account is active.'
      when new.status = 'frozen' then 'The investigation hold has been released, but your account remains frozen.'
      else 'The investigation hold has been released. Your account status is ' || new.status || '.'
    end;

    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      new.user_id,
      'account_hold_released',
      'Account hold released',
      'The investigation hold on your ' || account_name
        || ' account ending in ' || right(new.account_number, 4)
        || ' has been released. ' || status_message
        || ' Contact Evergreen through secure messages if you need assistance.',
      jsonb_build_object(
        'account_id', new.id,
        'account_last_four', right(new.account_number, 4),
        'account_status', new.status
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_account_investigation_hold_released() from public, anon, authenticated;

create trigger accounts_notify_investigation_hold_released
after update of investigation_hold_at on public.accounts
for each row
when (old.investigation_hold_at is not null and new.investigation_hold_at is null)
execute function public.notify_account_investigation_hold_released();
