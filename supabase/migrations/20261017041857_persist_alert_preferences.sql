alter table public.alert_preferences
  add column if not exists low_balance_enabled boolean not null default true,
  add column if not exists large_transaction_enabled boolean not null default true,
  add column if not exists transfer_updates_enabled boolean not null default true,
  add column if not exists statement_ready_enabled boolean not null default true;

revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;