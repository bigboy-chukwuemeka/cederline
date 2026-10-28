create unique index budgets_user_name_period_idx
  on public.budgets (user_id, name, period_start, period_end);
