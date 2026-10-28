create or replace function public.notify_customer_kyc_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending' then
    if not exists (
      select 1
      from public.notifications notification
      where notification.user_id = new.user_id
        and notification.notification_type = 'kyc_review'
        and notification.data ->> 'application_status' = 'pending'
        and notification.created_at >= new.submitted_at
    ) then
      insert into public.notifications (user_id, notification_type, title, body, data)
      values (
        new.user_id,
        'kyc_review',
        'Your application is under review',
        'We received your application and identity documents. Our team is reviewing the information. Account and banking access will be available after your application is approved. We will notify you when there is an update.',
        jsonb_build_object('category', 'general', 'application_status', 'pending')
      );
    end if;
  elsif new.status = 'approved'
    and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      new.user_id,
      'kyc_review_approved',
      'Your application was approved',
      'Your identity verification is complete. Your Cedarline accounts are now active and available to use.',
      jsonb_build_object('category', 'general', 'application_status', 'approved')
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_customer_kyc_submission() from public, anon, authenticated;
grant execute on function public.notify_customer_kyc_submission() to service_role;