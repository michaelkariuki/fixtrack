# FixTrack

![status](https://pulse.waigurumichael252.workers.dev/api/badge/fixtrack.svg)

Repair job management with a React/Vite UI, Hono Worker API and Cloudflare D1. The redesigned UI follows the approved compact CRM reference: solid white panels, fine borders, restrained accents and list-first job management.

## Safety and current limits

**Development preview.** Owner routes require an email/password session, and every workspace-scoped request checks membership. Email verification, password reset, invitations and fixed-window rate limits are implemented. Remaining gaps: no email provider is configured by default, no two-factor authentication, no audit log, and no per-workspace M-Pesa credentials. Public quotation links, M-Pesa STK initiation/callback/status and `/api/health` remain open.

Payments are manual records of independently confirmed M-Pesa/cash/bank payments, plus an optional M-Pesa Daraja STK Push flow that can start a prompt and record a verified callback. STK initiation and account flows use app-level fixed-window rate limits; a Cloudflare edge rule is still recommended. Mismatched callbacks land in a staff review panel that can record the received amount or dismiss the attempt. No live Safaricom run has been performed against this deployment, so the STK path is verified with simulated callbacks only. Neither path sends notifications or marks a device collected. Quotation printouts are not eTIMS fiscal invoices.

## Install and verify

From `fixtrack/`:

```sh
npm ci
npm --prefix frontend ci
npm run check
```

`check` typechecks the Worker, typechecks/builds the frontend, and runs isolated native Node regression tests using the real Miniflare D1 runtime. Test databases are temporary; existing local/remote D1 databases are not touched.

## Local development (only when requested)

```sh
npm run db:migrate:local
npm run dev
```

A single Worker serves the built UI and API on Wrangler's local port. For frontend hot reload, use a separate terminal:

```sh
npm --prefix frontend run dev
```

Vite uses port 5174 with a strict port check and proxies `/api` to `127.0.0.1:8787`. Do not use a process on port 5173 from another project. Local migration commands create/update only Wrangler's local D1 state.

## Database migrations

`migrations/0001_initial.sql` creates missing tables without dropping existing data. `0002_quote_terms.sql` adds snapshotted quotation terms and query indexes. `0005_payment_intents.sql` adds M-Pesa attempts; `0006_auth.sql` adds owner accounts, workspace membership and sessions; `0007_security.sql` adds email verification, reset/invite tokens and rate-limit counters; `0008_notifications.sql` adds notification history and unmatched-payment resolution fields. Use Wrangler migration tracking; do not repeatedly execute the ALTER migration as raw SQL. The previous destructive `src/db/schema.sql` initialization has been removed.

An existing database with the old tables can apply these migrations without deleting its records. Existing legacy payment/quote records are not automatically repaired by a UI redesign.

## Accounts and access

- Sign up or sign in from `/`. Sessions last 30 days in an HttpOnly, SameSite=Lax cookie; only a SHA-256 hash of the token is stored.
- Passwords use PBKDF2-SHA256 with 100,000 iterations and a random salt. Cloudflare Workers rejects iteration counts above 100,000.
- Email verification is required before creating a workspace or accepting an invitation. Verification links expire after 24 hours; resends are capped at three per hour.
- Password reset links expire after one hour, are single-use, and revoke every session for the account.
- Invitations are bound to a workspace and an email address, expire after seven days, and can be revoked by an owner. The invited address must sign in with an account using that email.
- Creating a workspace adds the creator as its `owner`. Any member can read workspace records; only owners can invite, revoke invitations or remove members. A workspace always keeps at least one owner.
- Public routes: `/api/health`, `/api/auth/*` account entry points, `/api/quotes/public/*`, `/api/mpesa/stkpush`, `/api/mpesa/callback`, `/api/mpesa/intent/*`, and `GET /api/invites/:token`.
- Workspaces created before `0006_auth.sql` have no members and are not visible after signup; create a workspace from Settings.
- Fixed-window limits: signup 5/hour/IP; login 20/15min/IP and 10/15min/account; verification resend 3/hour/user; forgot-password 5/hour/IP and 3/hour/account; reset 10/hour/IP; invitations 20/hour/user; STK prompts 5/10min/quote and 3/10min/phone.
- Authenticated mutations reject a mismatched `Origin`. There is no two-factor authentication or audit log.

## Email and SMS delivery

Verification, reset and invitation messages are sent through Resend when `RESEND_API_KEY` is set; `EMAIL_FROM` defaults to `FixTrack <onboarding@resend.dev>`. Quote notifications can also use Africa's Talking SMS when `AT_API_KEY`, `AT_USERNAME` and optionally `AT_SENDER_ID` are set. WhatsApp uses a `wa.me` click-to-chat link and needs no provider.

For local work without a provider, set `AUTH_DEV_LINKS=true`; API responses then include `dev_link` and the UI displays it. Never enable development links in production.

Set `APP_URL` when the public frontend origin differs from the Worker origin (for example Vite on `http://localhost:5174` with the API on `http://127.0.0.1:8787`). It controls email links and the CSRF origin allowlist.

## M-Pesa STK Push (optional)

`src/api/mpesa.ts` implements Daraja STK Push initiation, callback handling and status polling. The public quote page starts a payment for approved quotes when credentials are configured and polls its status.

Worker secrets (set with `wrangler secret put <NAME>`; use a gitignored `.dev.vars` locally):

- `MPESA_ENV` — `sandbox` (default) or `production`
- `MPESA_CONSUMER_KEY`
- `MPESA_CONSUMER_SECRET`
- `MPESA_SHORTCODE`
- `MPESA_PASSKEY`
- `MPESA_CALLBACK_URL` — optional; defaults to `<request origin>/api/mpesa/callback`
- `MPESA_CALLBACK_TOKEN` — random secret appended to the callback URL

Sandbox consumer key/secret, test shortcode, passkey and whitelisted test numbers come from the Daraja portal's test credentials. The callback URL must be public HTTPS; `wrangler dev` alone cannot receive Safaricom callbacks.

Endpoints:

- `POST /api/mpesa/stkpush` with `{quote_token, phone}` — requires an approved quote and charges the remaining balance, capped at 150,000 KES per request.
- `POST /api/mpesa/callback` — Safaricom result. Idempotent; records one `payment_records` row only when the callback amount matches the intent and the remaining balance allows it. Mismatches are stored as `unmatched` with the received amount and receipt.
- `GET /api/mpesa/intent/:id?token=<approval_token>` — customer-facing status.
- `GET /api/mpesa/unmatched?workspace_id=...&job_id=...` — owner view of unmatched attempts.
- `POST /api/mpesa/intents/:id/resolve` with `{workspace_id, action: "record" | "dismiss"}` — records the received amount through the same balance guard or closes the attempt.

Job details show an unmatched-payment panel and a customer notification panel (email, SMS, WhatsApp).

Without credentials, STK initiation returns 503 and manual recording remains available. The credential set is per deployment, not per workspace; do not use it for multiple shops until per-workspace credentials exist. `src/tests/workflow.test.mjs` covers callback replay, failure, mismatch, unknown checkout IDs and callback-token enforcement against the real D1 runtime; no automated test calls Safaricom.

## Cloudflare packaging and deployment

Live on the free Workers plan: `https://fixtrack.waigurumichael252.workers.dev`

- Worker: `fixtrack`
- D1: `fixtrack-db` (`a0d144e9-634c-43d8-8db6-54ef3592f1b2`), all migrations applied remotely
- R2: `fixtrack-attachments`, bound as `ATTACHMENTS`
- Secrets: `MPESA_*`, `RESEND_API_KEY`, `AT_API_KEY`, `AT_USERNAME`
- Deliberately unset in production: `AUTH_DEV_LINKS`, `EMAIL_FROM`, `AT_SENDER_ID`, `APP_URL`

`wrangler.toml` packages `frontend/dist` as SPA assets and routes `/api/*` to the Worker. Direct `/jobs/:id` and `/quote/:token` navigation uses the SPA fallback. Unknown API routes return JSON 404, not HTML.

```sh
npm run check
npx wrangler d1 migrations apply fixtrack-db --remote
npx wrangler deploy
```

Deployment notes:

- Email verification/reset currently use the Resend test sender; add a verified domain and `EMAIL_FROM` before real customer email.
- Africa's Talking is in sandbox mode; production SMS needs a production app, key and approved sender ID.
- Signup is open. Put Cloudflare Access or another gate in front of the owner app before a public launch.
- Cloudflare Workers caps PBKDF2 at 100,000 iterations; the hashing cost fits the free CPU limit in testing.

## Redesigned flows

- Accounts: sign up, sign in/out, email verification, password reset, 30-day sessions, membership-scoped workspaces; public quotation links and M-Pesa routes stay open.
- Team: owner-only invitations by email, pending-invite revocation, member removal, and invite acceptance bound to the invited address.
- Attachments: R2 upload with size/type checks, job-scoped listing and authenticated download.
- Business setup: create/select a real workspace; name/phone/location persist in D1 and appear on customer quotes.
- Overview: actual job counts, pending approvals, approved-quote balances and recent records; no canned metrics.
- Jobs: default list, search, repair-status/scope filtering, sorting, refresh, mobile cards and optional board over the same records.
- Job details: device/customer facts, explicit repair progress, itemized quote editor, version history, customer link and manual payment history.
- Customer quote: itemized line totals, snapshotted terms, approval or change request, paid-to-date and balance once approved, M-Pesa prompt and polling when configured, truthful saved/error state and printing.
- Notifications: send the current quote link by email, SMS or WhatsApp; history and provider errors are recorded per job.
- Payment review: unmatched M-Pesa attempts show the received amount and receipt; staff can record the received money or dismiss the attempt.
- Payments: human-readable job selection, whole-shilling amounts, reference entry, replay-safe payment submissions and actual balance/history.
- Customers: contacts derived from real job records, contact links and filtered job navigation.
- Settings: database-backed business details; browser-local, workspace-specific accent, density, sidebar preference and quotation defaults. Quotation defaults affect new drafts, never accepted versions.

No account profile, automated messaging, logo upload, tax integration or drag-and-drop is advertised as implemented.

## Verification

`npm run check` typechecks the Worker and the frontend, builds the UI, and runs the Miniflare regression suite against a temporary D1 database. The suite covers the quote approval and balance guard, payment replay, M-Pesa callback replay, amount mismatch, unknown checkout IDs, callback-token enforcement, notification history and unmatched-payment resolution.
