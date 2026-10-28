create function public.notify_account_investigation_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.investigation_hold_at is null and new.investigation_hold_at is not null then
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      new.user_id,
      'account_on_hold',
      'Account on hold',
      'Your ' || initcap(replace(new.account_type, '_', ' '))
        || ' account ending in ' || right(new.account_number, 4)
        || ' has been placed on hold for investigation. Reason: '
        || new.investigation_hold_reason
        || ' Contact Evergreen through secure messages if you need assistance.',
      jsonb_build_object(
        'account_id', new.id,
        'account_last_four', right(new.account_number, 4)
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_account_investigation_hold() from public, anon, authenticated;

create trigger accounts_notify_investigation_hold
after update of investigation_hold_at on public.accounts
for each row
when (old.investigation_hold_at is null and new.investigation_hold_at is not null)
execute function public.notify_account_investigation_hold();
