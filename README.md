# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## Website routing

The public HTML pages are served from the site root (for example, `/` and
`/about.html`). The React banking app is served from `/account-app/`; public
site login links point there, and its login flow opens the dashboard after
successful authentication. Admin pages are under `/account-app/admin/`. Static
page assets and header links use root-relative paths so they continue to work
from the site's nested legacy page URLs. The build also includes aliases for
those legacy public URLs. Public links to unavailable local pages and unknown
local header destinations lead to the responsive `/coming-soon.html` page;
external sites, existing pages, and asset/download links remain unchanged.

Run `npm run dev` or `npm run build` from this directory. The Vite configuration
uses the parent directory as the site root and includes its static HTML pages in
the production build alongside the React app.

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Supabase database

The initial banking schema migration is in `supabase/migrations`. To apply it to a
Supabase project, install the Supabase CLI, authenticate, link this directory to
the project, then run `supabase db push`. Alternatively, run the migration SQL
in the Supabase SQL Editor. Do not commit project credentials or service-role keys.

The migration uses Supabase Auth (`auth.users`) as the authentication identity
source and creates a corresponding `public.users` row automatically. Account
numbers are generated uniquely, and new accounts default to a `0.00` balance.
The default-account migration creates Checking, Savings, Loan, and CD accounts
for every new user and backfills existing app users without duplicating accounts.
Registered-customer transfers use authenticated database functions in the latest
migration to search recipients without exposing profile-table access and to post
both sides of a transfer atomically.

The Insights page reads posted activity from the signed-in customer's USD deposit
accounts, separates purchase spending from transfer cash flow, and stores monthly
budget targets in `public.budgets`. The monthly budget uniqueness migration makes
repeated saves update the current target instead of creating duplicates.

The Statements page lists only statement records for the signed-in user's
accounts. Statement PDFs belong in the private `bank-statements` Storage bucket;
`public.statements.storage_path` must match the object's path. Storage row-level
security allows reads only when that path is referenced by a statement belonging
to the authenticated account owner. Customers can generate PDF statements for
the previous completed UTC month from their Statements page. The
`customer-statements` Edge Function verifies account ownership, includes posted
ledger activity, stores PDFs privately, and creates an in-app statement-ready
notification. A generic email is sent when paperless delivery is enabled, the
customer's email preferences allow it, and the configured provider succeeds.
Paperless and delivery-email preferences are saved per user in
`public.statement_delivery_preferences`.

Unread rows in `public.notifications` are shown as a banner and the newest
unread notification opens once when the authenticated dashboard is loaded.
Customers can review notifications and mark them read; the browser role can
update only the `read_at` field. Other notification creation and external
email/push delivery must be performed by a trusted server-side service. Alert
preferences are stored per user in `public.alert_preferences`; saving preferences
does not itself generate alerts.

The transfer notification migration creates in-app sent/received notices
transactionally for registered-account transfers when each participant has
transfer updates enabled. No email, SMS, or operating-system push message is
sent by the browser.

External bank requests are persisted by
`20261026010000_persist_external_transfer_requests.sql`. Enable Supabase Vault
before applying the migration. The migration creates a random encryption key
in Vault on first application; do not rotate or delete it while encrypted
requests exist. The migration encrypts full
recipient account numbers at rest, returns them only through the authenticated
admin detail endpoint, reserves the sender's funds while requests are pending,
and adds pending requests to the admin queue and action-alert counts. Admins can
toggle an optional number input when reviewing a request, set its label, and
receive the customer's numeric response in the request details.
`20261026020000_external_transfer_boolean_responses.sql` added the initial
response storage; `20261026030000_external_transfer_numeric_responses.sql`
stores numeric customer responses, and
`20261026040000_external_transfer_input_label.sql` updates the label validation
message.
Deploy the updated function with `supabase functions deploy admin-transactions`.

Profile names, phone numbers, mailing address, paperless preference, contact
preferences, language, time zone, and the requested inactivity-timeout setting
are stored for the authenticated user by `public.save_customer_profile`.
Sensitive profile fields such as tax ID are not read or overwritten by this
profile save function. Password resets use Supabase Auth; signing out other
sessions uses the Auth provider. The customer dashboard enforces the saved
inactivity timeout with a one-minute warning and sign-out action. Two-step
sign-in uses Supabase Auth TOTP authenticator factors. It is opt-in: users with
a verified factor must reach AAL2 at sign-in, and restrictive RLS policies and
the admin Edge Functions enforce that assurance level for enrolled users. Enable
TOTP enrollment and verification in the Supabase Auth settings. The Profile
Manage devices panel records the current browser when opened and can sign out
other active sessions through Supabase Auth. Supabase does not expose a mapping
from these device records to individual Auth sessions, so sessions cannot be
revoked one device at a time.

KYC decisions and new secure messages can also send generic email notices through
Resend. Configure `RESEND_API_KEY`, `EMAIL_FROM` (a sender on a verified Resend
domain), and `APP_BASE_URL` as Supabase Edge Function secrets. Email is skipped
when the customer has disabled Email or Account updates. Secure message contents
and identity details are never included in the email.

## Local Supabase Auth configuration

Copy `.env.example` to `.env.local`, then set `VITE_SUPABASE_ANON_KEY` to the
project's publishable key (or legacy anon key) from Supabase **Settings → API
Keys**. The URL in the example is for this project's ref. Restart `npm run dev`
after changing environment values. These are browser-safe public settings; never
put a service-role key in a `VITE_` variable or commit `.env.local`.

Email confirmation and password recovery redirect to the app's current origin.
Add your local development URL and production URL to the allowed redirect URLs
in Supabase **Authentication → URL Configuration**. The enrollment flow creates
the Supabase Auth identity and username/display-name metadata; it does not send
tax IDs or government-ID files to Supabase Auth.

## Admin user directory

The admin Users page calls the `admin-users` Supabase Edge Function for user
directory, profile, identity-document metadata, linked-account summaries, and
login lock/unlock operations. Deploy it with
`supabase functions deploy admin-users` after linking the project. The function
verifies the caller's authenticated `app_metadata.role` or `app_metadata.roles`
admin claim before using its server-side service-role key. Assign admin claims
only through a trusted Supabase administrative process. Never expose the
service-role key to the browser or put it in a `VITE_` variable.

The function requires the standard `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` Edge Function secrets. User-detail reads and
login-lock changes are written to `public.audit_logs`; tax IDs, full account
numbers, and identity-document storage paths are not returned to the browser.

## Admin account directory and operations

Apply the `20261018000000_admin_account_operations.sql` migration before
deploying the `admin-accounts` Supabase Edge Function. Then apply
`20261018050000_account_hold_status.sql` to expose holds as the persisted
`on_hold` account status while retaining and restoring the previous open or
frozen state on release. Apply `20261018060000_account_hold_notifications.sql`
to create an unread customer notification whenever a hold is placed; it appears
as an in-app alert popup and in alert history. The migrations add
investigation-hold metadata, block account debits while a hold is active, and
add service-role-only SQL functions that authorize the admin claim, lock
accounts during sensitive operations, update the ledger and transaction
history together, and write an audit entry. Deploy with
`supabase functions deploy admin-accounts` after the migration succeeds.
Account numbers are masked in admin responses; balance changes require an
administrator-provided reason.
The `20261018130000_admin_send_account_funds.sql` migration adds audited
admin-originated credits with a customer-visible sender name, posted transaction,
and incoming-transfer alert. Apply the `20261018140000_admin_transfer_notification_details.sql`
migration to include the credited account, masked account number, and posting
time in the notification. Deploy the updated `admin-accounts` function after
applying the migrations.

Apply `20261018150000_pending_transfer_review.sql` to hold new customer-initiated
registered transfers for administrator approval before either account balance
changes. Pending requests reserve sender funds, appear in the admin Transactions
page, and can be approved or rejected with an audited decision. Approval posts
both sides atomically and notifies both customers; rejection releases the
reservation without moving funds. Deploy the updated `admin-transactions`
function after applying the migration.

## Admin KYC review

Apply `20261018010000_admin_kyc_review.sql` and
`20261018090000_persist_and_review_kyc_applications.sql`, then deploy the
`admin-applications` and `kyc-submission` Edge Functions. Customer signup now
saves all application fields (excluding passwords), uploads ID files to the
private `identity-documents` bucket, and stores the private storage paths and
document metadata. The application form data is restricted to the service role;
admins access it through the audited detail action and receive short-lived
signed file links.

New users and their accounts remain inactive/frozen until KYC approval. Approval
marks the documents verified, activates the user and opens eligible accounts.
Rejection requires a reason, leaves the user inactive and accounts frozen, and
records the decision and reason in the audit log.

## Admin transaction review

Apply `20261018020000_admin_transaction_review.sql` and deploy the
`admin-transactions` Supabase Edge Function to enable the Transactions page.
The migration adds suspicious-flag metadata and service-role-only functions
for filtered platform transaction search, audited detail reads, and flagging
with a required reason. Apply `20261018110000_admin_unflag_transaction.sql` to
enable audited flag removal, then apply
`20261018120000_transaction_flag_customer_notifications.sql` so flagging and
removal create customer in-app notifications as well as administrator audit
entries. The browser receives only masked account-number suffixes; flagging
does not reverse or block a transaction.

## Admin customer messages

Apply `20261018030000_admin_messages.sql` and
`20261018080000_admin_message_composer_fields.sql`, then deploy the
`admin-messages` Supabase Edge Function to enable the Messages page. The
service verifies the admin claim for recipient search, inbox, thread reads,
and sends. Subjects, message text, priority, optional category, customer
notification, and audit entry are saved together. Customers see the message in
Alerts, with high/urgent notices highlighted and new notices delivered live
while the app is open. No email or SMS is sent. Message sends and thread views
are recorded in `public.audit_logs`.

## Admin audit-log review

Apply `20261018040000_admin_audit_log_review.sql` and deploy the
`admin-audit-logs` Supabase Edge Function to enable the Audit Logs page. The
admin-only query supports administrator, action-type, and date filters with
pagination. It returns recorded IP addresses when available; older audit
entries or operations that did not capture an address display “Not recorded”.

## Admin dashboard summary

Apply `20261022000000_admin_dashboard_summary.sql` and deploy the
`admin-dashboard` Supabase Edge Function to connect dashboard counts, current
KYC/transfer/flag/hold queues, and the latest eight administrator audit events.
The Edge Function verifies the admin claim before calling the service-role-only
summary function. Transaction counts use posted records for the current UTC day;
secure conversation counts represent customers with at least one admin message
because inbound customer replies are not currently supported. Refresh dashboard
data from the activity panel when needed.
