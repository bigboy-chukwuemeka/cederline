alter table public.accounts
  add column investigation_hold_previous_status text;

alter table public.accounts
  drop constraint accounts_status_check,
  add constraint accounts_status_check
    check (status in ('open', 'on_hold', 'frozen', 'closed'));

update public.accounts
set investigation_hold_previous_status = status,
    status = 'on_hold'
where investigation_hold_at is not null;

alter table public.accounts
  add constraint accounts_investigation_hold_status_consistent check (
    (investigation_hold_at is null
      and investigation_hold_previous_status is null
      and status <> 'on_hold')
    or
    (investigation_hold_at is not null
      and investigation_hold_previous_status in ('open', 'frozen')
      and status = 'on_hold')
  );

create function public.sync_account_investigation_hold_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.investigation_hold_at is null and new.investigation_hold_at is not null then
    if old.status not in ('open', 'frozen') then
      raise exception 'Only open or frozen accounts can be put on hold.';
    end if;
    new.investigation_hold_previous_status := old.status;
    new.status := 'on_hold';
  elsif old.investigation_hold_at is not null and new.investigation_hold_at is null then
    new.status := coalesce(old.investigation_hold_previous_status, 'open');
    new.investigation_hold_previous_status := null;
  end if;

  return new;
end;
$$;

create trigger accounts_sync_investigation_hold_status
before update of investigation_hold_at on public.accounts
for each row execute function public.sync_account_investigation_hold_status();
