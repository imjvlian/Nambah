# Nambah Developer Reference

Baseline: Nambah 0.5.0 — Production Candidate  
Repository: https://github.com/imjvlian/Nambah  
Branch: main  
Baseline commit reviewed: 80b08d9c3248a485636b980c44d55d4b24020b9d  
Last reviewed: 2026-09-18

Dokumen ini adalah referensi developer utama untuk memahami, mengubah, dan menambah fitur Nambah tanpa merusak alur pembayaran, fulfillment, loyalty, atau keamanan.

> Source of truth tetap kode di branch main. Jika dokumen ini berbeda dengan implementasi terbaru, baca kode terbaru terlebih dahulu lalu perbarui dokumen ini dalam perubahan yang sama.

---

## 1. Architecture at a Glance

Nambah adalah aplikasi top-up digital berbasis Next.js App Router dengan Supabase PostgreSQL sebagai database/auth backend, Midtrans sebagai payment gateway, Digiflazz sebagai supplier utama, Brevo untuk email receipt, Volsever untuk game-account checking, dan Telegram untuk alert operasional.

Core flow:

~~~text
Catalog
→ Account / target validation
→ Pricing
→ Promo / referral / points
→ Order creation
→ Midtrans payment
→ Server-side payment verification
→ Fulfillment
→ Digiflazz
→ Webhook / reconciliation
→ Receipt
→ Points / promo / affiliate lifecycle
→ Financial reconciliation
→ Admin operations
~~~

Prinsip utama:

1. Browser tidak menjadi sumber kebenaran untuk payment atau supplier status.
2. Harga final dihitung ulang di backend ketika order dibuat.
3. Verified payment dan fulfillment adalah dua state yang berbeda.
4. Supplier failure tidak boleh menghapus fakta bahwa payment sudah paid.
5. Live Digiflazz harus melewati explicit double opt-in.
6. Side effects harus idempotent atau aman dipanggil ulang.
7. Database migration bersifat additive/ordered; jangan menggunakan seed untuk upgrade database existing.

---

## 2. Technology Stack

| Area | Technology |
|---|---|
| Framework | Next.js 16.3.3 |
| UI | React 19.2.8 |
| Language | TypeScript 5.9 |
| Runtime CI | Node 22 |
| Database | Supabase PostgreSQL |
| Customer auth | Supabase Auth melalui server routes + HttpOnly cookies |
| Payment | Midtrans Snap |
| Supplier | Digiflazz |
| Receipt | Brevo transactional email |
| Account checker | Volsever, dengan fallback tertentu melalui Gempay/Mimih |
| Alerts | Telegram |
| CI | GitHub Actions |
| Hosting target | Vercel |

Current npm scripts:

~~~text
npm run dev
npm run build
npm run start
npm run assets:sync
~~~

Current CI hanya menjalankan:

~~~text
npm ci
npm run build
~~~

Belum ada dedicated unit, integration, atau e2e test runner pada baseline 0.5.0.

---

## 3. Repository Ownership Map

~~~text
.
├─ .env.example
├─ .github/
│  └─ workflows/ci.yml
├─ PRODUCTION.md
├─ README.md
├─ DEVELOPER_REFERENCE.md
├─ next.config.ts
├─ package.json
├─ public/
│  ├─ nominal-icons/
│  └─ product-assets/
├─ scripts/
│  ├─ setup-digiflazz.ps1
│  ├─ sync-codashop-product-assets.mjs
│  └─ test-digiflazz.ps1
├─ src/
│  ├─ app/
│  │  ├─ api/
│  │  ├─ account/
│  │  ├─ admin/
│  │  ├─ login/
│  │  ├─ order/
│  │  ├─ product/
│  │  ├─ register/
│  │  ├─ layout.tsx
│  │  └─ page.tsx
│  ├─ components/
│  └─ lib/
└─ supabase/
   ├─ manual/
   ├─ migrations/
   ├─ schema.sql
   └─ seed.sql
~~~

Ownership rule:

- src/app: route/page composition, HTTP route handlers, global CSS.
- src/components: reusable client/server UI behavior.
- src/lib: business logic, provider adapters, repositories, security helpers.
- supabase/migrations: ordered database changes for an existing database.
- supabase/schema.sql: current schema reference/bootstrap baseline.
- supabase/seed.sql: development/bootstrap data only, bukan migration tool.
- public/product-assets: local product artwork synced/resolved by product asset logic.
- scripts: operational/development helpers.

---

## 4. Frontend Page Ownership

### 4.1 Home — src/app/page.tsx

Responsibilities:

- Load public catalog via getPublicCatalog().
- Resolve game artwork.
- Render navigation, hero, trust strip, categorized catalog, how-it-works, footer.
- Main catalog UI is delegated to CategorizedTopupExperience.

Do not put payment, price calculation, or database mutation logic directly here.

### 4.2 Product — src/app/product/[id]/page.tsx

Responsibilities:

- Resolve product by public catalog ID.
- Infer display category.
- Resolve cover/package artwork.
- Render product description/navigation.
- Delegate transaction flow to TopupExperience.

TopupExperience owns most customer checkout interaction.

### 4.3 Order — src/app/order/[id]/page.tsx

Thin route wrapper.

Responsibilities:

- Read order ID.
- Render OrderStatusView.

OrderStatusView owns customer-facing order tracking, Snap loading, refresh/payment actions, and status display.

### 4.4 Account — src/app/account/page.tsx

Thin page around AccountDashboard.

AccountDashboard owns profile, customer orders, and Points-related account experience.

### 4.5 Admin — src/app/admin/page.tsx

Thin page around AdminDashboard.

AdminDashboard is the main operations/control-center UI. Digiflazz has a dedicated route at src/app/admin/digiflazz/page.tsx.

### 4.6 Auth

- src/app/login/page.tsx
- src/app/register/page.tsx
- src/components/AuthForm.tsx

Browser auth must continue through Nambah server routes. Do not expose server-side Supabase credentials.

---

## 5. Frontend Component Ownership

| Component | Primary responsibility |
|---|---|
| AccountNav | Login/account navigation and optional Points summary |
| CategorizedTopupExperience | Home catalog browsing/category experience |
| TopupExperience | Product checkout form, target input, pricing preview, promo/referral/points, payment selection, order creation |
| OrderStatusView | Order tracking, Midtrans Snap browser integration, refresh/status UI |
| AccountDashboard | Customer profile, order history, loyalty/account view |
| AdminDashboard | Main admin operations UI |
| AdminCatalogTools | Catalog/admin maintenance tools |
| DigiflazzCatalogBrowser | Digiflazz catalog browsing |
| DigiflazzCatalogBrowserV2 | Current/alternate Digiflazz catalog experience |
| AuthForm | Login/register form behavior |

Change rule:

- UI component may call Nambah API routes.
- UI component should not contain provider server keys, supplier credentials, service-role database keys, webhook secrets, or trusted payment status decisions.

---

## 6. CSS Ownership

All current CSS is imported globally from src/app/layout.tsx. This means class-name collisions are possible even when a stylesheet appears feature-specific.

Current major files:

| CSS file | Area |
|---|---|
| globals.css | global reset/tokens/shared primitives |
| home-v2.css | home/landing UI |
| catalog-categories.css | catalog category UI |
| product-v2.css | product page |
| pricing.css | price presentation |
| product-checkout-v2.css | checkout UI |
| product-checkout-rail-v2.css | checkout side rail |
| product-grouped-nominals.css | grouped nominal cards |
| product-nominal-artwork.css | nominal artwork |
| account-auto-check.css | account target/checker UI |
| order.css | order page/status |
| auth.css | login/register |
| points.css | Points UI |
| admin.css | admin base |
| admin-control-center.css | control center |
| admin-automation.css | automation/ops sections |
| admin-source-of-truth.css | admin source-of-truth UI |
| admin-digiflazz.css | Digiflazz admin |
| admin-digiflazz-v2.css | Digiflazz admin v2 |
| admin-publish-checkbox.css | publish controls |
| admin-supplier-link.css | supplier mapping controls |
| midtrans.css | Midtrans-related UI |

When adding CSS:

1. Prefer an existing feature stylesheet if ownership is obvious.
2. Use feature-prefixed class names to reduce collisions.
3. If a new stylesheet is needed, import it once in layout.tsx.
4. Test desktop and mobile because all styles share one global cascade.
5. Do not add a second styling system casually without an explicit migration plan.

---

## 7. API Endpoint Map

### 7.1 Customer auth/account

| Endpoint | Method | Primary backend |
|---|---|---|
| /api/auth/login | POST | nambah-auth, rate-limit |
| /api/auth/logout | POST | nambah-auth |
| /api/auth/me | GET | nambah-auth |
| /api/auth/signup | POST | nambah-auth, rate-limit |
| /api/account/orders | GET | nambah-auth, Supabase |
| /api/account/points | GET | nambah-auth, loyalty |
| /api/account/profile | GET, PATCH | nambah-auth, customer-contact, Supabase |

### 7.2 Public catalog/pricing/order

| Endpoint | Method | Primary backend |
|---|---|---|
| /api/catalog | GET | catalog-repository |
| /api/pricing/preview | POST | auth, loyalty, pricing, pricing-repository, public-pricing |
| /api/game-account/check | POST | game-account, Volsever, rate-limit, Supabase |
| /api/orders | POST | auth, customer-contact, account validation, loyalty, Midtrans, rate-limit, promotion, order-service, order-access, pricing |
| /api/orders/[id] | GET | order-service, auth, order-access |
| /api/orders/[id]/refresh | POST | Midtrans, order-service, auth, order-access |
| /api/orders/[id]/receipt | GET, POST | auth, order-access, order-service, receipt-service, Brevo |
| /api/orders/[id]/token | GET | order access/browser flow |
| /api/icons/game | GET | game icon proxy/resolution |

### 7.3 Provider webhooks

| Endpoint | Method | Primary backend |
|---|---|---|
| /api/webhooks/midtrans | POST | Midtrans signature/status, order-service |
| /api/webhooks/digiflazz | POST | Digiflazz signature, status-service |

Webhook routes are trusted-provider boundaries. Never weaken signature verification just to make a test easier.

### 7.4 Operational/cron

| Endpoint | Method | Primary backend |
|---|---|---|
| /api/health | GET | flow-test, fulfillment, Midtrans, Supabase |
| /api/cron/reconcile | GET | cron-api, reconciliation |
| /api/cron/financial-reconcile | GET | cron-api, financial-reconciliation |
| /api/cron/digiflazz-balance | GET | cron-api, supplier-balance |

Cron routes require CRON_SECRET authorization.

### 7.5 Admin core

| Endpoint | Method | Responsibility |
|---|---|---|
| /api/admin/session | GET, POST, DELETE | signed admin session |
| /api/admin/overview | GET | operational overview |
| /api/admin/readiness | GET | staging/production readiness |
| /api/admin/orders | GET | order listing |
| /api/admin/orders/[id] | GET | order inspection |
| /api/admin/orders/[id]/receipt | POST | receipt retry |
| /api/admin/receipts | GET | receipt status/list |
| /api/admin/reconciliation | POST | manual reconciliation |
| /api/admin/finance | GET, POST | finance reconciliation/admin action |
| /api/admin/users | GET | customer/admin user view |
| /api/admin/points | GET | Points operations view |
| /api/admin/promotions | GET, POST, PATCH | promotion management |
| /api/admin/affiliates | GET | affiliate view |
| /api/admin/telegram/test | POST | Telegram alert test |

### 7.6 Admin catalog / Digiflazz

| Endpoint | Method | Responsibility |
|---|---|---|
| /api/admin/catalog | GET | catalog admin read |
| /api/admin/catalog/[id] | PATCH | product/game catalog update |
| /api/admin/catalog/cleanup | POST | cleanup operation |
| /api/admin/catalog/markup | POST | markup update |
| /api/admin/digiflazz/balance | POST | balance check/snapshot |
| /api/admin/digiflazz/bootstrap | POST | supplier catalog bootstrap |
| /api/admin/digiflazz/catalog | GET | supplier catalog data |
| /api/admin/digiflazz/catalog/publish | POST | publish supplier catalog item |
| /api/admin/digiflazz/map-sku | POST | map Nambah product to supplier SKU |
| /api/admin/digiflazz/price-list | GET | live/test supplier price list |
| /api/admin/digiflazz/sync-prices | POST | sync supplier pricing |
| /api/admin/digiflazz/test-transaction | POST | Digiflazz testing transaction |

---

## 8. Backend Service Map

### Authentication / authorization

- src/lib/nambah-auth.ts  
  Customer Supabase Auth adapter, token refresh, session resolution, HttpOnly auth cookies, public user shape.

- src/lib/admin-account.ts  
  Resolve Nambah admin role/account.

- src/lib/admin-api.ts  
  Signed admin browser session, legacy recovery bearer support, admin authorization.

- src/lib/order-access.ts  
  Create opaque order token, hash/verify token, order-access cookie.

### Catalog / pricing

- src/lib/catalog.ts  
  Domain catalog types/static fallback structures.

- src/lib/catalog-repository.ts  
  Public catalog source/repository.

- src/lib/pricing.ts  
  Pure pricing rules. Important constants include DEFAULT_AFFILIATE_RATE and MINIMUM_NAMBAH_PROFIT.

- src/lib/pricing-repository.ts  
  Load pricing context from persistence/supplier context.

- src/lib/public-pricing.ts  
  Strip trusted/internal pricing details before returning data to browser.

- src/lib/supplier-pricing.ts  
  Attach supplier cost to catalog package data.

- src/lib/product-asset-resolver.ts  
  Resolve local product/nominal artwork.

### Orders / status

- src/lib/order-service.ts  
  Public order retrieval, Midtrans status application, order ownership.

- src/lib/order-public.ts  
  Safe/public order transformations and shared order shape utilities.

- src/lib/order-preview.ts  
  Preview/order UI support.

- src/lib/order-status.ts  
  Status labels, descriptions, CTA, timeline, terminal-state helpers.

### Fulfillment

- src/lib/fulfillment.ts  
  Select fulfillment mode, enforce live safety, submit paid order, invoke post-status side effects.

- src/lib/fulfillment-target.ts  
  Render customer_no/target using explicit templates.

- src/lib/digiflazz/client.ts  
  Raw Digiflazz API adapter, balance, price list, prepaid transaction, test transaction, webhook signature.

- src/lib/digiflazz/status-service.ts  
  Apply supplier transaction status to Nambah state and downstream loyalty/promo/receipt/commission lifecycle.

- src/lib/digiflazz/bootstrap.ts  
  Bootstrap supplier catalog.

### Payment

- src/lib/midtrans/client.ts  
  Environment selection, Snap transaction creation, transaction status query, notification signature verification.

Midtrans environment:

~~~text
sandbox
production
~~~

Server and browser environment variables must point to the same environment.

### Loyalty / growth

- src/lib/loyalty.ts  
  Points calculation, summary, ledger, reserve, restore, earn/reverse lifecycle.

- src/lib/promotion-service.ts  
  Promo reservation/commit/release lifecycle.

- src/lib/commission-service.ts  
  Affiliate commission lifecycle.

- src/lib/referrals.ts  
  Referral rules/helpers.

### Customer contact / receipt

- src/lib/customer-contact.ts  
  Customer profile/contact preference resolution.

- src/lib/receipt-service.ts  
  Success receipt delivery state/idempotency.

- src/lib/brevo/client.ts  
  Brevo transactional email adapter.

### Reliability / finance

- src/lib/reconciliation.ts  
  Recover stale paid/processing orders, pending supplier transactions, and receipt states.

- src/lib/financial-reconciliation.ts  
  Detect financial mismatches/invariants. It is a detector, not an automatic money mover.

- src/lib/supplier-balance.ts  
  Supplier balance checks/snapshots and low-balance alert path.

### Security / operations

- src/lib/rate-limit.ts  
  Durable database-backed abuse/rate limiting.

- src/lib/admin-audit.ts  
  Admin audit logging.

- src/lib/cron-api.ts  
  Cron bearer authorization.

- src/lib/telegram.ts  
  Operational Telegram messages.

### Game account checking

- src/lib/game-account.ts  
  Product/game field schema, sanitization, validation.

- src/lib/volsever/client.ts  
  Volsever provider adapter.

Provider-specific fallback logic must stay server-side.

---

## 9. Database Map

Current important tables:

| Domain | Tables |
|---|---|
| Catalog | games, products, payment_methods |
| Supplier | suppliers, supplier_products, supplier_balances, supplier_balance_snapshots, supplier_transactions, supplier_webhook_events |
| Pricing/growth | pricing_rules, promotions, promotion_products, promotion_redemptions, affiliates |
| Orders/payment | orders, payments |
| Customer | customer_profiles |
| Receipt | receipt_deliveries |
| Loyalty | loyalty_accounts, point_ledger |
| Admin/security | admin_users, rate_limit_buckets, admin_audit_logs |
| Finance | financial_reconciliations, commissions, affiliate_withdrawals |

Important RPCs:

### Points

~~~text
nambah_points_reserve
nambah_points_commit_redemption
nambah_points_restore_redemption
nambah_points_earn
nambah_points_reverse_earn
~~~

### Promotion

~~~text
nambah_promotion_reserve
nambah_promotion_commit
nambah_promotion_release
~~~

### Rate limiting

~~~text
nambah_rate_limit_hit
~~~

Why RPC matters:

- reservation/commit/restore operations need database-level atomicity;
- do not replace these with client-side read-then-write flows;
- concurrency-sensitive quota/balance logic belongs in a transaction/RPC.

---

## 10. Migration Rules

Migrations currently run through 018.

Recent feature migrations:

~~~text
012 Nambah Points
013 Affiliate commissions
014 Promotion management
015 Customer profiles
016 Live fulfillment targets
017 Financial reconciliation
018 Production hardening
~~~

Rules for a new migration:

1. Create a new ordered file in supabase/migrations.
2. Never edit an already-applied migration to represent a new production change.
3. Prefer additive/idempotent SQL where practical.
4. Add indexes for new high-frequency lookup paths.
5. Add constraints for status/value invariants.
6. Review RLS/revoke behavior for every new table.
7. If application code depends on the new schema, deploy migration before or atomically with compatible code.
8. Update supabase/schema.sql when it is intended to remain a current bootstrap reference.
9. Do not rerun supabase/seed.sql on an existing production/staging database as an upgrade mechanism.

---

## 11. Authentication Model

### Customer

Customer auth uses Supabase Auth, but browser interaction is proxied through Nambah API routes.

High-level flow:

~~~text
Browser
→ /api/auth/login or /api/auth/signup
→ nambah-auth
→ Supabase Auth
→ Nambah HttpOnly cookies
→ resolveNambahAuth() on trusted server paths
~~~

Do not:

- put SUPABASE_SECRET_KEY in browser code;
- convert trusted server auth to a localStorage-only token model;
- trust a browser-provided user ID without resolving the authenticated session.

### Admin

Admin browser access uses:

1. a normal Nambah account,
2. admin_users role resolution,
3. a signed admin session cookie.

NAMBAH_ADMIN_API_TOKEN exists as legacy/recovery compatibility and should not become the normal browser login mechanism again.

---

## 12. Order Access Model

Guest orders use a per-order opaque access credential.

Flow:

~~~text
random opaque token
→ SHA-256 hash persisted with order
→ raw token returned/stored only for customer access flow
→ cookie/query access checked by server
~~~

Logged-in users can access orders they own.

Do not introduce a global order-access secret as a replacement for per-order credentials.

---

## 13. Order / Payment / Fulfillment State Machine

Current order statuses:

~~~text
pending_payment
paid
processing
success
failed
refunded
cancelled
~~~

Terminal-status logic is centralized in order-status helpers.

Conceptual transition:

~~~text
pending_payment
  ├─ verified Midtrans payment → paid
  ├─ expiry/cancel → cancelled
  └─ payment failure → failed

paid
  └─ fulfillment starts → processing

processing
  ├─ supplier success → success
  ├─ supplier failure → failed
  └─ pending → reconciliation/webhook continues
~~~

Important invariant:

A verified Midtrans payment is historical truth. Supplier failure must not pretend the customer never paid.

Midtrans mapping currently includes:

- settlement → paid
- accepted capture → paid
- pending/deny → pending_payment
- expire/cancel → cancelled
- failure → failed
- refund → refunded

Gross amount is checked against the frozen order amount.

---

## 14. Order Creation Flow

The POST /api/orders route is the main trusted checkout boundary.

Expected responsibilities:

1. Resolve customer auth when present.
2. Apply durable rate limit.
3. Validate product/target/account fields.
4. Load trusted pricing context.
5. Recalculate price server-side.
6. Validate Points request and eligibility.
7. Validate/reserve promotion when applicable.
8. Apply referral/affiliate economics.
9. Enforce minimum Nambah profit guard.
10. Persist frozen order financial snapshot.
11. Create per-order access credential.
12. Create Midtrans Snap transaction.
13. Return only public order/payment data.

Never make TopupExperience the source of truth for final price.

---

## 15. Pricing Rules

Current important constants:

~~~text
DEFAULT_AFFILIATE_RATE = 0.20
MINIMUM_NAMBAH_PROFIT = Rp500
~~~

Points:

~~~text
1 point = Rp10
earn = 1 point per Rp2,000 eligible spend
minimum redeem = 100 points
redeem step = 100 points
maximum redeem value = 20% of subtotal
guest cannot earn/redeem Points
~~~

Pricing can depend on:

- supplier cost,
- pricing rule/markup,
- payment fee,
- promotion,
- referral/customer benefit,
- Points redemption,
- affiliate commission,
- minimum Nambah profit.

When adding a discount/benefit, update both preview and trusted order calculation. A browser-only discount is not a feature; it is a mismatch bug.

---

## 16. Points Lifecycle

Service: src/lib/loyalty.ts

Lifecycle principles:

~~~text
checkout request
→ validate requested Points
→ reserve Points atomically
→ payment/fulfillment lifecycle
→ commit redemption on successful lifecycle
→ restore reservation when order no longer qualifies
→ earn Points only after success
→ reverse earn if a later supported reversal requires it
~~~

Current RPCs are the concurrency boundary. Do not replace them with multiple unrelated updates.

Known baseline gap:

Point ledger can carry expiration timestamps, but a complete automatic points-expiry processor/cron is not part of baseline 0.5.0.

---

## 17. Promotion Lifecycle

Service: src/lib/promotion-service.ts

Lifecycle:

~~~text
eligible checkout
→ nambah_promotion_reserve
→ reserved
→ successful qualifying order → nambah_promotion_commit
→ failed/cancelled/non-qualifying path → nambah_promotion_release
~~~

Reason for reservation:

Promotion quota must not be checked with a race-prone read-count-then-insert sequence.

---

## 18. Affiliate Lifecycle

Service: src/lib/commission-service.ts

Current conceptual lifecycle:

~~~text
paid / processing → pending
success → available
failed / refunded / cancelled → cancelled
withdrawn → preserved
~~~

Commission must be based on trusted order economics, not a browser-supplied margin.

Baseline limitation:

affiliate_withdrawals exists, but a complete customer-facing withdrawal request/approval/payment workflow is not considered complete in 0.5.0.

---

## 19. Midtrans Architecture

Provider adapter: src/lib/midtrans/client.ts  
Webhook: /api/webhooks/midtrans  
Manual/customer refresh: /api/orders/[id]/refresh

Environment variables:

~~~text
MIDTRANS_ENVIRONMENT
NEXT_PUBLIC_MIDTRANS_ENVIRONMENT
MIDTRANS_SERVER_KEY
NEXT_PUBLIC_MIDTRANS_CLIENT_KEY
~~~

Rules:

1. Server verifies Midtrans notification signature.
2. Browser callback is UX only, not payment truth.
3. Server can query Midtrans status for recovery/manual refresh.
4. Gross amount must match frozen order total.
5. Sandbox and production keys must not be mixed.
6. Payment success can trigger fulfillment but should be safe when repeated.

---

## 20. Digiflazz Architecture

Provider adapter: src/lib/digiflazz/client.ts  
Status application: src/lib/digiflazz/status-service.ts  
Fulfillment coordinator: src/lib/fulfillment.ts  
Webhook: /api/webhooks/digiflazz  
Recovery: src/lib/reconciliation.ts

Supported fulfillment modes:

~~~text
disabled
simulate
digiflazz-test
digiflazz-live
~~~

Safe staging configuration:

~~~text
NAMBAH_FLOW_TEST_MODE=true
NAMBAH_FULFILLMENT_MODE=digiflazz-test
NAMBAH_ALLOW_LIVE_FULFILLMENT=false
NAMBAH_LIVE_FULFILLMENT_ACK=
~~~

Live mode additionally requires:

~~~text
NAMBAH_FLOW_TEST_MODE=false
NAMBAH_FULFILLMENT_MODE=digiflazz-live
NAMBAH_ALLOW_LIVE_FULFILLMENT=true
NAMBAH_LIVE_FULFILLMENT_ACK=SPEND_REAL_DIGIFLAZZ_BALANCE
~~~

Request reference must remain deterministic for an order so retries do not create duplicate top-up requests.

Current convention:

~~~text
NMB-<orderId>
~~~

Digiflazz test transactions use testing:true and must not consume real supplier balance.

---

## 21. Fulfillment Target Rules

Live fulfillment target templates are explicit and stored at game/product level.

Allowed conceptual forms include:

~~~text
{user_id}
{user_id}{server_id}
{user_id}|{server_id}
~~~

Product template can override game template.

Rules:

- only supported placeholders should be rendered;
- do not concatenate target data ad hoc inside route handlers;
- validate required user_id/server_id fields before payment/fulfillment;
- test each live SKU/template pairing before enabling real-money fulfillment.

---

## 22. Webhook Rules

### Midtrans webhook

Must:

- verify provider signature;
- resolve order by trusted identifier;
- verify amount/status;
- apply status idempotently;
- trigger fulfillment only through trusted server logic.

### Digiflazz webhook

Must:

- verify X-Hub-Signature using DIGIFLAZZ_WEBHOOK_SECRET;
- handle duplicate callbacks safely;
- handle delayed/out-of-order status where supported;
- preserve terminal-state guards;
- synchronize receipt, Points, promo, and commission lifecycle safely.

Never:

- disable webhook signature verification in staging for convenience;
- trust a status sent from the browser;
- create a second fulfillment request just because the first callback is late.

---

## 23. Reconciliation

Service: src/lib/reconciliation.ts  
Manual admin endpoint: POST /api/admin/reconciliation  
Cron endpoint: GET /api/cron/reconcile

Current responsibilities include recovery of:

- paid/processing orders that have been stuck beyond the expected short window;
- pending Digiflazz test/live transactions;
- receipt delivery retry after delay;
- stale sending receipt visibility without blindly duplicating email.

Reconciliation is part of normal reliability design, not only an emergency script.

When adding a new asynchronous provider:

1. define a recoverable provider reference;
2. store enough provider state to query later;
3. add idempotent status application;
4. add reconciliation coverage;
5. test duplicate, delayed, and out-of-order events.

---

## 24. Financial Reconciliation

Service: src/lib/financial-reconciliation.ts  
Admin endpoint: /api/admin/finance  
Cron endpoint: /api/cron/financial-reconcile

Purpose:

- compare frozen order economics against related payment/supplier/points/commission records;
- record mismatches for operators;
- surface critical inconsistencies.

It must not silently move real money to "fix" a mismatch.

When adding a new financial field or discount:

- add it to the frozen order economics;
- update financial reconciliation;
- update admin diagnostics;
- add regression tests once the automated test harness exists.

---

## 25. Receipt Architecture

Service: src/lib/receipt-service.ts  
Provider: src/lib/brevo/client.ts

Receipt is triggered after success and tracked in receipt_deliveries.

Rules:

- successful send must be idempotent;
- receipt failure must never roll back a successful order;
- manual admin retry exists;
- customer profile stores receipt/contact preference;
- do not claim WhatsApp receipt delivery is implemented unless a provider path is actually added.

---

## 26. Rate Limiting

Service: src/lib/rate-limit.ts  
RPC: nambah_rate_limit_hit

Baseline protected flows include:

~~~text
login              10 / 10 minutes
signup               5 / hour
game account check  30 / 10 minutes
order creation      15 / 10 minutes
~~~

NAMBAH_RATE_LIMIT_SECRET is used as a privacy salt for durable keys.

When adding an expensive or abuse-prone public endpoint, add a durable rate-limit policy rather than relying only on in-memory state.

---

## 27. Admin Audit

Service: src/lib/admin-audit.ts  
Table: admin_audit_logs

Important admin mutations should write an audit record containing enough context to answer:

- who performed the action;
- what action happened;
- which entity was affected;
- when it happened;
- relevant before/after or metadata where appropriate.

Do not assume every existing admin mutation is already audited. When touching a mutation, check audit coverage explicitly.

---

## 28. Environment Variable Ownership

Use .env.example as the canonical variable list.

### Supabase

~~~text
SUPABASE_URL
SUPABASE_SECRET_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
~~~

Only NEXT_PUBLIC values may intentionally enter browser bundles.

### Flow / fulfillment

~~~text
NAMBAH_FLOW_TEST_MODE
NAMBAH_FULFILLMENT_MODE
NAMBAH_SIMULATED_FULFILLMENT_OUTCOME
NAMBAH_DIGIFLAZZ_TEST_OUTCOME
NAMBAH_ALLOW_LIVE_FULFILLMENT
NAMBAH_LIVE_FULFILLMENT_ACK
~~~

### Admin / security / cron

~~~text
NAMBAH_ADMIN_SESSION_SECRET
NAMBAH_ADMIN_API_TOKEN
NAMBAH_RATE_LIMIT_SECRET
CRON_SECRET
~~~

### Midtrans

~~~text
MIDTRANS_ENVIRONMENT
NEXT_PUBLIC_MIDTRANS_ENVIRONMENT
MIDTRANS_SERVER_KEY
NEXT_PUBLIC_MIDTRANS_CLIENT_KEY
~~~

### Digiflazz

~~~text
DIGIFLAZZ_USERNAME
DIGIFLAZZ_API_KEY
DIGIFLAZZ_WEBHOOK_SECRET
DIGIFLAZZ_CALLBACK_URL
~~~

### Account checking

~~~text
VOLSEVER_API_KEY
VOLSEVER_GAME_ROUTES_JSON
GEMPAY_API_USERNAME
GEMPAY_API_SECRET
~~~

### Receipt / alert

~~~text
BREVO_RECEIPT_ENABLED
BREVO_API_KEY
BREVO_SENDER_EMAIL
BREVO_SENDER_NAME
TELEGRAM_BOT_TOKEN
TELEGRAM_ADMIN_CHAT_ID
~~~

Rules:

1. Never invent a NEXT_PUBLIC copy of a secret.
2. Never log raw credentials.
3. Do not commit .env files.
4. Keep sandbox and production provider credentials separated.
5. Rotate any server-side secret that has been exposed outside the intended secret store.

---

## 29. How to Add a Frontend Feature

Example: new checkout field, customer widget, account panel.

Process:

1. Identify the owning page/component.
2. Decide whether the value is display-only or trusted business input.
3. If trusted input changes price/order/provider behavior, add server validation/API support first.
4. Add TypeScript types near the owning domain.
5. Reuse existing API routes/services where possible.
6. Add or extend CSS in the owning feature stylesheet.
7. Test loading, success, empty, validation, and error states.
8. Test narrow mobile width and desktop.
9. Confirm no secret/internal supplier cost is serialized to the browser.
10. Run npm run build.
11. Update this document if ownership or flow changes.

Do not add a business-critical rule only in React state.

---

## 30. How to Add a Backend/API Feature

Process:

1. Define the domain invariant first.
2. Put reusable business logic in src/lib, not inside route.ts.
3. Keep route.ts focused on:
   - method/request parsing,
   - auth/authorization,
   - rate limit,
   - validation,
   - calling domain service,
   - safe response mapping.
4. Add database migration if persistence changes.
5. Use server-side trusted values for user/order identity.
6. Add audit logging for important admin mutations.
7. Add reconciliation if the feature is asynchronous.
8. Ensure retry/idempotency behavior is defined.
9. Return public-safe shapes only.
10. Run npm run build and relevant manual flow tests.

---

## 31. How to Add a Database Feature

Process:

1. Create the next numbered migration.
2. Define columns with explicit defaults/nullability.
3. Add CHECK/FOREIGN KEY/UNIQUE constraints for real invariants.
4. Add indexes for expected query paths.
5. Enable/review RLS.
6. Revoke direct anon/authenticated access for server-owned internal tables where appropriate.
7. Use RPC for atomic balance/quota/reservation changes.
8. Update schema.sql when maintaining the bootstrap schema.
9. Update repository/service code after schema design is stable.
10. Add finance/reconciliation coverage for monetary state.

---

## 32. How to Add a Payment Provider

Do not wire a second payment provider directly into TopupExperience.

Recommended structure:

~~~text
src/lib/<provider>/client.ts
→ create transaction
→ query transaction
→ verify webhook signature
→ normalized internal payment status
~~~

Then add:

1. environment/config validation;
2. order payment-provider snapshot;
3. API order creation integration;
4. webhook route;
5. manual/status refresh;
6. idempotent status mapping;
7. gross-amount verification;
8. reconciliation support;
9. admin diagnostics/readiness;
10. sandbox regression tests.

Provider-specific statuses should be normalized before they modify the Nambah order lifecycle.

---

## 33. How to Add a Supplier

Recommended structure:

~~~text
src/lib/<supplier>/client.ts
src/lib/<supplier>/status-service.ts
fulfillment coordinator integration
webhook route
reconciliation query
admin mapping/diagnostics
~~~

Requirements:

- deterministic external reference;
- explicit SKU mapping;
- frozen supplier-cost safety;
- target-format validation;
- no duplicate top-up on retry;
- signed webhook verification when supported;
- pending recovery;
- balance/health visibility;
- live-money kill switch.

---

## 34. How to Add a Game / Account Checker

Do not hardcode target validation only in the UI.

Process:

1. Extend domain account schema in game-account logic.
2. Define required fields and sanitization.
3. Add provider route mapping.
4. Add provider adapter only in server-side src/lib.
5. Keep API key server-only.
6. Apply rate limiting.
7. Normalize provider response to Nambah account validation result.
8. Decide fallback behavior explicitly.
9. Ensure order creation revalidates what must be trusted.
10. Add tests for valid, invalid, timeout, provider failure, and fallback.

---

## 35. How to Add an Admin Module

Process:

1. Add UI section in AdminDashboard or a dedicated admin route when large.
2. Add /api/admin/... route.
3. Authorize through admin-api.
4. Resolve role/permission requirements.
5. Put reusable logic in src/lib.
6. Add audit event for mutation.
7. Add loading/error/success feedback.
8. Avoid exposing raw secrets in API responses.
9. Add readiness/diagnostic signal if operationally important.
10. Document ownership here.

---

## 36. Naming and Code Conventions

Current practical conventions:

- Route handlers: src/app/api/<domain>/.../route.ts
- Provider adapter: src/lib/<provider>/client.ts
- Lifecycle/orchestration: descriptive service modules such as receipt-service.ts, promotion-service.ts, commission-service.ts.
- Repository/data loading: *-repository.ts.
- Admin endpoints live under /api/admin.
- Cron endpoints live under /api/cron.
- Provider callbacks live under /api/webhooks.
- Customer-facing internal API responses should use public/sanitized models.

Prefer explicit domain names over generic utils.ts.

---

## 37. Regression Checklist for Every Meaningful Change

### Build

- npm ci succeeds when dependency lock changes.
- npm run build succeeds.
- GitHub Actions CI is green.

### Customer UI

- Home catalog loads.
- Product page loads correct product.
- Account field validation works.
- Pricing preview matches selected product/payment.
- Mobile layout is usable.

### Pricing

- Supplier cost is not exposed publicly.
- Final backend price matches expected preview.
- Promo/referral/Points stack correctly.
- Minimum Nambah profit guard still holds.

### Auth/access

- Guest checkout works where intended.
- Logged-in checkout works.
- Order access token works.
- User cannot access another user's order.
- Admin endpoint rejects non-admin.

### Payment

- Sandbox Snap can be created.
- Valid payment notification is accepted.
- Invalid signature is rejected.
- Duplicate notification is safe.
- Gross amount mismatch is rejected/flagged.

### Fulfillment

- simulate path works if used.
- digiflazz-test success works.
- digiflazz-test failure works.
- pending recovery works.
- repeated trigger does not double top-up.
- digiflazz-live remains blocked unless explicitly enabled.

### Side effects

- success receipt is not duplicated.
- Points reserve/commit/restore remains consistent.
- promo reservation lifecycle remains consistent.
- affiliate commission status matches order lifecycle.
- financial reconciliation has no unexpected critical mismatch.

### Operations

- /api/health responds.
- admin readiness is reviewed.
- reconciliation runs.
- finance reconciliation runs.
- supplier balance monitoring runs where configured.

---

## 38. Release / Version Workflow

Repository workflow preference:

1. Read latest main before changing code.
2. Make one cohesive/atomic change.
3. Commit message is the release version only.
4. Push directly to main when that is the chosen workflow.
5. User pulls with:

~~~powershell
git pull origin main
~~~

If Next.js cache needs reset in Windows PowerShell:

~~~powershell
Ctrl+C
Remove-Item -Recurse -Force .next
npm run dev
~~~

Version rule:

- Do not consume a planned feature version for a docs-only change unless package/release version is intentionally being advanced.
- Keep package.json, README/PRODUCTION status, and functional release scope aligned when a real version bump happens.

---

## 39. Anti-Patterns / Do Not Change Casually

Avoid these unless there is a deliberate architecture decision:

1. Trusting browser payment success as payment truth.
2. Trusting browser-calculated final price.
3. Sending SUPABASE_SECRET_KEY, Midtrans server key, Digiflazz key, Brevo key, or webhook secrets to the browser.
4. Disabling webhook signatures to make staging easier.
5. Using seed.sql to upgrade an existing database.
6. Replacing atomic Points/promo RPCs with read-then-write code.
7. Treating supplier failure as if payment never happened.
8. Generating a new supplier ref on every retry.
9. Enabling digiflazz-live from customer/admin test UI.
10. Removing the live fulfillment double opt-in.
11. Retrying receipt/email blindly without idempotency.
12. Mixing sandbox keys with production environment.
13. Hardcoding fulfillment target concatenation in multiple route handlers.
14. Putting large business logic directly inside route.ts.
15. Adding monetary fields without updating financial reconciliation.
16. Returning raw internal DB/provider objects to public endpoints.
17. Assuming every admin mutation is audited without checking.
18. Creating a new styling system for one screen while all current CSS remains global.
19. Editing an already-applied migration to represent a new change.
20. Reintroducing old/deprecated environment variables without a feature decision.

---

## 40. Production Safety Gate

Before any real transaction:

- all required migrations are applied;
- staging readiness checks pass;
- webhook signature and duplicate tests pass;
- financial reconciliation shows no critical mismatch;
- live SKU mappings are checked one by one;
- fulfillment target templates are verified;
- provider dashboards/callbacks are configured;
- production secrets are rotated and stored safely;
- monitoring/reconciliation is active;
- rollback plan is ready.

Only after an explicit operational decision should real fulfillment be enabled.

See PRODUCTION.md for the deployment/launch checklist.

---

## 41. Keeping This Document Current

Update DEVELOPER_REFERENCE.md in the same change whenever any of these occur:

- new page or major component ownership;
- new API endpoint;
- new src/lib service;
- new provider;
- new database table/RPC;
- new order status or state transition;
- new pricing/Points/promo/affiliate rule;
- new webhook/reconciliation path;
- new environment variable;
- new security boundary;
- new release/deployment rule.

The goal is not to document every line of code. The goal is to keep the system boundaries, ownership, invariants, and safe extension paths accurate enough that future feature work starts from the correct architecture.
