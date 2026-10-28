drop function if exists public.find_transfer_recipients(text);

create function public.find_transfer_recipients(p_query text)
returns table (
  account_id uuid,
  account_type text,
  recipient_name text,
  account_last_four text,
  account_name text,
  currency char(3)
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
    right(a.account_number, 4),
    a.name,
    a.currency
  from public.accounts a
  join public.users u on u.id = a.user_id
  cross join query_value q
  where auth.uid() is not null
    and u.id <> (select auth.uid())
    and u.is_active
    and a.status = 'open'
    and a.account_type in ('checking', 'savings', 'loan', 'cd')
    and (
      (q.value ~ '^[0-9]+$' and length(q.value) >= 4)
      or (q.value !~ '^[0-9]+$' and length(q.value) >= 3)
    )
    and (
      a.account_number = q.value
      or (q.value ~ '^[0-9]+$' and left(a.account_number, length(q.value)) = q.value)
      or (q.value ~ '^[0-9]{4}$' and right(a.account_number, 4) = q.value)
      or left(lower(u.email), length(q.value)) = q.value
      or left(lower(coalesce(u.username, '')), length(q.value)) = q.value
    )
  order by
    case
      when a.account_number = q.value then 0
      when lower(u.email) = q.value or lower(coalesce(u.username, '')) = q.value then 1
      when q.value ~ '^[0-9]{4}$' and right(a.account_number, 4) = q.value then 2
      else 3
    end,
    lower(u.display_name),
    a.account_type
  limit 10;
$$;

revoke all on function public.find_transfer_recipients(text) from public, anon;
grant execute on function public.find_transfer_recipients(text) to authenticated;
