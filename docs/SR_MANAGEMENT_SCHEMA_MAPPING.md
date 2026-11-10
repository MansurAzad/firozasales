# SR Management & Sales Control — Schema and Migration Mapping

**Repository:** `MansurAzad/firozasales`  
**Reviewed baseline:** `main` and the open IMEI/SR hardening work  
**Review type:** Static repository audit; no database connection or live migration was used  
**Status:** Mapping only. No schema or production data changed.

## 1. Source-of-truth and migration chain

The repository contains these ordered SQL migrations:

| Order | File | Responsibility |
|---:|---|---|
| 0000 | `0000_hisab_init.sql` | Core users/roles, products, IMEI, retailers, stock issues, sales, payments, settlements, deposits, returns, initial RPCs and RLS |
| 0001 | `0001_atomic_accounting_integrity.sql` | Idempotent transaction posting, active-account checks, atomic stock/cash validation, accounting snapshot |
| 0002 | `0002_offline_catalog_idempotency.sql` | Idempotent catalog writes for products, retailers and IMEI |
| 0003 | `0003_restrict_catalog_reads_active_staff.sql` | Active-staff read restrictions for products and retailers |
| 0004 | `0004_catalog_history_guards_and_sr_names.sql` | Protect historical products/retailers from deletion; admin SR rename RPC |
| 0005 | `0005_audited_user_access_management.sql` | Access audit, access-control snapshot and guarded role/active-state changes |
| 0006 | `0006_lock_access_management_writes.sql` | Revoke direct writes to roles and access audit |
| 0007 | `0007_inventory_receipts.sql` | Inventory receipt header/items, IMEI receipt linkage, stock guards and receipt RPC |
| 0008 | `0008_signup_approval.sql` | New account provisioning and inactive-by-default SR sign-up |
| 0009 | `0009_financial_corrections.sql` | Dealer return header/items, return/refund/credit posting |
| 0010 | `0010_transaction_reversals.sql` | Immutable reversal audit, reversal RPC and reversal-aware stock/accounting calculations |

The migration journal `drizzle/migrations/meta/_journal.json` lists 0000–0010. However:
- `drizzle/schema.ts` is intentionally blank.
- Snapshot files currently exist only for 0000–0006; snapshots for 0007–0010 are absent.
- Therefore Drizzle's TypeScript schema/snapshot representation is not a complete mirror of the SQL migration head. Do not generate or apply a migration from the blank schema until this is reconciled.
- The reviewed repository tree on `main` contains the same 0000–0010 SQL migration set.

## 2. Existing table map

### Identity and access
- `auth.users`: Supabase Auth identity and credentials (managed by Supabase Auth).
- `public.profiles`: one profile per auth user; current application fields are `id`, `full_name`, `is_active`, `created_at`.
- `public.user_roles`: `user_id` + `app_role` enum (`admin`, `salesman`).
- `public.access_audit`: actor, target, old/new role, old/new active state, reason and timestamp.

SR name/email/password are not all stored in `profiles`: email and credentials are managed through Supabase Auth. The admin server functions use the service-role Auth Admin API only after verifying the caller's admin role.

### Product and stock
- `public.products`: product name/model/category/price/active flag.
- `public.imei_units`: individual IMEI stock; product, status, current SR, issue/sale/return timestamps, damage flag, receipt-item reference and void flag.
- `public.inventory_receipts`, `public.inventory_receipt_items`: opening/purchase stock receipts and unit costs.
- `public.stock_issues`, `public.stock_issue_items`: stock issue header and issued product quantities/IMEI units.
- `public.returns`: SR-to-company stock returns linked to settlement, including damage state.

### Sales and money
- `public.retailers`: retailer master data (name, phone, address, active flag).
- `public.sales`, `public.sale_items`: invoice header and line items; sale stores total and paid amount.
- `public.retailer_payments`: retailer receivable collections; currently amount, retailer, SR, date and note.
- `public.settlements`, `public.deposits`: SR settlement headers and cash deposits.
- `public.dealer_returns`, `public.dealer_return_items`: retailer sales returns; total is split into cash refund and credit.
- `public.posting_requests`: idempotency receipts for posted transactions.
- `public.catalog_requests`: idempotency receipts for catalog changes.
- `public.transaction_reversals`: immutable reversal history and source snapshot.

## 3. Existing RPC / database workflow map

| RPC / function | Current responsibility |
|---|---|
| `has_role`, `is_active_staff`, `require_active_account` | Role, active-account and authorization gates |
| `handle_new_user` | Auth signup profile and initial role provisioning |
| `set_sr_name`, `set_sr_active` | Admin-controlled SR name and active state |
| `access_control_snapshot`, `manage_user_access` | Admin access list and audited role/active-state changes |
| `post_transaction` | Atomic issue, sale, retailer payment and settlement posting |
| `post_catalog` | Idempotent product/retailer/IMEI catalog posting |
| `post_inventory_receipt` | Atomic inventory receipt and IMEI creation |
| `post_dealer_return` | Admin-posted retailer return, refund and credit |
| `accounting_snapshot` | RLS-filtered application accounting snapshot |
| `company_stock_quantity`, `salesman_stock_quantity` | Reversal-aware stock balances |
| `transaction_is_reversed`, `reverse_transaction`, `has_active_followup` | Transaction reversal and downstream-activity guard |
| `guard_catalog_history`, `guard_imei_receipt_insert`, `guard_button_phone_stock_issue` | Historical data and stock integrity triggers |

Transaction writes are intentionally routed through SECURITY DEFINER RPCs. Later migrations revoke direct authenticated writes to core transaction tables. New workflows must preserve this boundary; a UI-only check is not authorization.

## 4. Current SR and Sales workflow: confirmed coverage

| Capability | Existing implementation | Gap / consequence |
|---|---|---|
| SR account creation | Admin server function creates Supabase Auth user; signup trigger assigns salesman role | Basic account only; no structured HR profile |
| SR name and active state | `set_sr_name`, `set_sr_active`, access audit | No territory, joining/exit details, contact/identity or supervisor profile fields |
| SR stock issue | `post_transaction('issue')`; IMEI and button-phone stock validation | No SR receipt/acknowledgement state or discrepancy workflow |
| SR sales | `post_transaction('sale')`; item quantity and unit price checked | Client can submit any non-negative price; server does not compare against product price or require discount authorization |
| Retailer allocation | Retailer master is global; sale/payment accepts active retailer | No territory mapping or SR-to-retailer assignment enforcement |
| Retailer collection | `retailer_payments.amount` | No payment method, transaction reference, instrument/bank/wallet metadata |
| SR cash settlement | Settlement + deposit + stock return posted atomically | No submitted/pending/approved/rejected state, reviewer identity or approval timestamp |
| Audit/reversal | Access audit and transaction reversal history | No dedicated approval decision trail for price, issue acknowledgement or settlement |

## 5. RLS and transaction-safety constraints

- `profiles` and `user_roles` are protected by own/admin read policies; role changes are performed through guarded RPCs.
- Products and retailers are readable by active staff; catalog mutations are admin-only through `post_catalog`.
- Sales, stock issues, payments, deposits, returns and settlements are read through own-SR/admin policies. Later migrations revoke direct authenticated transaction writes.
- `post_transaction`, `post_inventory_receipt`, `post_dealer_return` and `reverse_transaction` enforce role, active status, validation, locks and idempotency at database level.
- Offline outbox currently supports `issue`, `sale`, `payment`, `settlement`, `inventory_receipt`, `dealer_return` and catalog changes. New offline-capable transaction kinds require explicit outbox projection, replay, idempotency and server RPC work. Admin configuration changes should remain online-only unless a separate safe sync design is implemented.
- The accounting snapshot is projected into IndexedDB for offline use. New fields/tables must be added to the SQL snapshot, generated TypeScript types, AccountingSnapshot, offline projection and tests together.

## 6. Additive schema design proposed for the next implementation

These are proposed entities, not existing tables. Final names and constraints will be chosen after the related workflow is implemented and tested.

1. **SR profile extension** — add only business-required fields (e.g. phone, employee code, joining date, emergency contact if required, supervisor, notes) to a dedicated SR profile table or carefully additive profile columns. Auth email/password remain in Supabase Auth.
2. **Territories** — territory master with unique code/name, active state and optional parent area.
3. **SR territory assignment history** — SR, territory, effective-from/to, assigned-by, reason; prevent overlapping active assignments where business rules require it.
4. **SR retailer assignment history** — retailer, SR, effective-from/to, assigned-by and reason; retain past ownership rather than overwriting it. Add a database check in sale/payment posting if the business confirms exclusive assignment.
5. **Stock issue acknowledgement** — append-only acknowledgement event linked to issue and SR, received quantity/IMEI reconciliation, status, acknowledged-by/time, discrepancy reason and resolution. Do not mark issued stock as acknowledged merely because the issue RPC succeeded.
6. **Price/discount policy and approval** — per-product or category floor/discount rules, approval request with requested price/discount, decision, approver, reason and timestamps. Enforce policy in `post_transaction` or a dedicated server RPC under row locks; never trust a client-supplied approval flag.
7. **Payment method metadata** — method enum/check constraint, reference number, payer/account details only where needed, received-by and verification state. Keep the canonical amount ledger unchanged and avoid storing sensitive card credentials.
8. **Settlement approval** — submitted/approved/rejected lifecycle, submitted-by/time, reviewed-by/time, decision/reason and immutable approval history. Separate posting/deposit from final approval only after defining how cash and stock custody work.
9. **Audit events** — append-only events for assignments, acknowledgements, price approvals and settlement decisions, with RLS allowing only the intended admin/reviewer visibility.

## 7. Accounting invariants to preserve

- SR stock quantity must reconcile from company receipts, issue, sale, undamaged return, dealer return and transaction reversal.
- SR cash on hand must reconcile consistently across dashboard, settlement and reports:
  `cash sales + retailer cash collections - cash deposits - dealer cash refunds`.
- Dealer return credit reduces retailer due but is not a cash refund and must not reduce SR cash on hand.
- Sale total is calculated from server-validated line quantity × authorized unit price. The client total is display-only.
- Idempotency keys must return the original result for identical retries and reject changed payloads.
- Reversals must remain immutable, require a reason and physical cash/stock confirmation, and reject reversal where downstream activity exists.

## 8. Implementation and migration sequence

1. Reconcile Drizzle metadata/snapshots with SQL migration head; do not run `drizzle-kit generate` from the currently blank schema.
2. Add an additive migration (next available number after 0010) for territory and assignment tables, indexes, constraints, RLS and admin RPCs.
3. Extend the accounting snapshot, Supabase generated types, app TypeScript interfaces and offline projection only for data that must be available offline.
4. Implement SR profile and assignment UI with server-side authorization and audit history.
5. Add stock issue acknowledgement as an explicit state/event; preserve existing issue rows and IMEI ownership semantics.
6. Add server-enforced pricing/discount authorization and approval history.
7. Add payment method capture and validation without changing historic payment rows' meaning.
8. Add settlement submission/approval as a separate lifecycle, with a clear compatibility plan for existing settlements.
9. Add tests for authorization, cross-SR access, overlapping assignments, stale approvals, concurrent stock issue, retry idempotency, offline replay, cash/stock reconciliation and reversals.

## 9. Verification status and limitations

- **Completed:** static read of the 0000–0010 migration chain, migration journal, Drizzle schema/config, current SR/accounting/stock/sales/settlement UI and server posting functions.
- **Not performed:** live Supabase schema introspection, SQL execution, migration dry-run against a disposable database, RLS integration tests, physical scanner/hardware tests, npm test/lint/build, or Vercel deployment verification.
- **Production safety:** no production database was connected to or modified; no migration was applied; no branch was merged or deployed.

This document is a repository-derived mapping and implementation plan, not a claim that the deployed Supabase database has been proven identical to the checked-in migrations.
