# Nambah Changelog

## 1.0.0

Stable code baseline for Nambah top-up platform.

Highlights:

- customer catalog, account validation, pricing and checkout;
- Midtrans payment verification;
- Digiflazz test/live fulfillment architecture with double live-money gate;
- deterministic supplier request refs and signed webhook handling;
- reconciliation and operational incident recovery;
- Nambah Points FIFO lots and safe expiry;
- promo reservation/commit/release;
- affiliate commission and withdrawal workflow;
- receipt delivery and retry;
- financial reconciliation;
- role-bound admin sessions and audit logs;
- Staging Test Lab;
- production readiness/catalog coverage gate;
- automated Node regression tests + Next.js build CI;
- Vercel cron configuration;
- environment, production, test and release documentation.

1.0.0 does not automatically enable real-money production mode.

## 0.9.0

Release candidate documentation and operations packaging.

- final environment guide;
- comprehensive manual E2E test guide;
- release/rollback checklist;
- production guide refresh;
- default Vercel cron schedules.

## 0.6.0

Affiliate withdrawal workflow.

- affiliate ownership linked to Nambah account;
- atomic commission allocation;
- customer withdrawal request/cancel;
- admin approve/reject;
- superadmin paid confirmation with external payment reference;
- account and admin payout UI.

## 0.5.8

Production configuration gate.

- catalog supplier-mapping coverage;
- fulfillment-target coverage;
- production readiness blockers.

## 0.5.7

Security and admin hardening.

- role-bound signed admin principal;
- shorter admin session;
- actor user/role audit;
- superadmin-only high-risk supplier/catalog mutations.

## 0.5.6

Customer payment environment UX consistency.

## 0.5.5

Operations and monitoring.

- Operations Center;
- incident detection;
- Telegram critical alert deduplication.

## 0.5.4

Points FIFO lots and expiry.

## 0.5.3

Pending fulfillment reliability.

## 0.5.2

Automated payment/supplier status regression tests.

## 0.5.1

Staging Test Lab and operational indexes.
