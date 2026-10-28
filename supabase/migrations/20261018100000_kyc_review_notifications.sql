create function public.notify_customer_kyc_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'pending'
    and not exists (
      select 1
      from public.notifications notification
      where notification.user_id = new.user_id
        and notification.notification_type = 'kyc_review'
        and notification.data ->> 'application_status' = 'pending'
        and notification.created_at >= new.submitted_at
    )
  then
    insert into public.notifications (user_id, notification_type, title, body, data)
    values (
      new.user_id,
      'kyc_review',
      'Your application is under review',
      'We received your application and identity documents. Our team is reviewing the information. Account and banking access will be available after your application is approved. We will notify you when there is an update.',
      jsonb_build_object('category', 'general', 'application_status', 'pending')
    );
  end if;
  return new;
end;
$$;

create constraint trigger kyc_application_customer_notification
  after insert or update on public.kyc_applications
  deferrable initially deferred
  for each row
  execute function public.notify_customer_kyc_submission();

revoke all on function public.notify_customer_kyc_submission() from public, anon, authenticated;
grant execute on function public.notify_customer_kyc_submission() to service_role;
