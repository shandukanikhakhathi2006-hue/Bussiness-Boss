# Connected Business Workflow Foundation

## Purpose and scope

This document defines the target data and workflow boundaries that connect customers, appointments, invoices, payments, expenses, dashboard summaries and reports. It is an architecture foundation only. It does not migrate data, change client Firestore rules, add writes, deploy Functions, or activate a new production model.

The current product has two distinct models. Legacy records are top-level, owner-scoped browser documents. Invoice v2 is tenant-scoped, callable-only server code under businesses/{businessId}. The target model must replace legacy behaviour deliberately; it must not silently merge these systems or infer relationships from display text.

## Current audit and compatibility boundary

Current legacy paths are /customers, /bookings, /invoices, /payments, /expenses and /messages. They are ownerId-scoped and are created, edited and deleted by browser code. Customers and appointments already use an explicit customerId when a current appointment is created. Appointment customerName is a historical snapshot. Legacy invoice and payment forms still accept customer names and reference strings, use Number monetary values, and generate display numbers in the browser by scanning records. These are not authoritative relationships and cannot safely drive tenant-wide reporting or payment allocation.

Messages are internal notes. They preserve customerId plus a customerName snapshot but do not deliver external messages.

Invoice v2 uses businesses/{businessId}/invoices/{invoiceId}. Its browser calls a trusted Callable Function. Verified identity, business ownership, active membership and owner role are checked server-side. Production Invoice v2 currently rejects customer and catalogue references, so a Customer v2 association is intentionally not yet implemented. This is a contract boundary, not a missing client field.

Reports and Dashboard currently read legacy paid invoices and expenses. Their dates and statuses are legacy display values, so they are not yet canonical cash-basis reporting.

## Canonical tenant model

All future connected records belong to one authoritative business:

    businesses/{businessId}
    businesses/{businessId}/customers/{customerId}
    businesses/{businessId}/appointments/{appointmentId}
    businesses/{businessId}/invoices/{invoiceId}
    businesses/{businessId}/payments/{paymentId}
    businesses/{businessId}/expenses/{expenseId}
    businesses/{businessId}/messages/{messageId}

Every server command derives uid from verified Firebase Auth, loads business membership from businesses/{businessId}/members/{uid}, and authorizes the command from trusted member data. defaultBusinessId is a routing preference only. It never supplies authorization, ownerId, role, active status or tenant access.

The browser may submit a selected businessId and business intent. It never supplies trusted ownerId, membership role, status, totals, timestamps, document numbers or payment state. Clients retain tenant-scoped read access only when production rules are deliberately migrated. Authoritative writes use trusted server access.

## Entities and relationships

A canonical customer has an opaque customerId. A display name is a snapshot and never relationship authority. Duplicate names are valid. A deleted or missing customer must not be remapped by name.

An appointment stores customerId plus customerName snapshot, date/time/service/status, and may later store invoiceId. New appointments select a real customer ID. Legacy name-only appointments remain readable as unlinked history until reviewed.

An invoice stores customerId plus immutable customer display/contact snapshots, and may store appointmentId. A payment stores invoiceId as its authoritative allocation plus a server-validated customerId denormalization. An expense may optionally store a customerId, appointmentId or invoiceId only when a future command validates the relationship and business tenant. Messages keep customerId and snapshot as internal-note context.

A relationship reference must point to a document in the same business. If the referenced entity is missing, the record remains readable with a neutral unavailable label. It is not remapped.

## Money and tax

Canonical money fields use safe integer minor units such as totalMinor, amountPaidMinor and balanceDueMinor. Rates and unit prices use the existing Invoice v2 exact-decimal contract; tax rates use basis points. Invoice v2 Stage 8A calculation rules remain the single source for line subtotal, tax, total and half-up rounding.

Legacy Number values are not canonical money. A future migration must classify them, preserve the original value, convert only with an explicit reviewed rounding rule, and flag malformed/unsafe values for manual resolution. It must not silently coerce floats in browser code.

## Invoice and payment lifecycle

Invoice lifecycle is separate from payment state:

    lifecycleStatus: draft | issued | void
    paymentStatus: not_due | unpaid | partial | paid

Draft and void invoices are not overdue. An issued invoice is overdue only when balanceDueMinor is greater than zero and dueDate is before a trusted business-local asOfDate. Overdue is derived, never a client-writable status.

A payment command accepts an issued invoice with an outstanding balance, a positive integer amountMinor, a trusted business-local receivedDate and a supported method. The server transaction rereads the invoice, validates tenant and customer association, rejects overpayment, creates the payment, and atomically updates invoice amountPaidMinor, balanceDueMinor and paymentStatus. Partial payments are supported. Duplicate retries require a client request id/idempotency key and return the prior result rather than double-applying money.

Existing legacy payment edits and deletes are not the model for canonical payments. Corrections need an explicit future void or reversal command and audit trail; they must not mutate financial history invisibly. Refunds, chargebacks and provider reconciliation are later accounting/payment work.

Invoice numbers are created by a server transaction at issuance, never draft creation. A per-business counter document allocates a unique immutable value. Browser scans and legacy display numbers are not sufficient.

## Appointment-to-invoice policy

Only a completed appointment can initiate a canonical invoice. The command verifies tenant, completion status and customerId, uses the appointment customer as the invoice customer, and may prefill service data as editable draft input.

A transaction prevents more than one active non-void invoice for an appointment. The appointment invoiceId and invoice appointmentId are written atomically. If a voided invoice later needs replacement, a specific replacement workflow must be designed; the system must not overwrite links or silently create duplicates. Cancelled appointments can never be invoiced.

## Reporting and dates

Canonical financial reports use cash basis: received canonical payments are grouped by receivedDate, and expenses by business-local expense date. Revenue is not inferred from an invoice marked paid. Dashboard outstanding and overdue totals derive from issued invoice balances and due dates.

Business timezone is stored on the trusted business document. Calendar fields are exact YYYY-MM-DD values interpreted as business-local dates. Appointments retain date/time as scheduled business-local values. Server commands derive any current date from the business timezone; browser time must not decide overdue or reporting boundaries.

## Customer archive and history

A customer without connected financial or appointment history may be deleted only through a future tenant command with relationship checks. A customer with connected history is archived/inactivated. No historical record is cascaded or relinked. Records retain customer snapshots and customerId so history remains understandable after archive.

## Legacy migration strategy

1. Introduce canonical tenant contracts and server validators without changing legacy reads or writes.
2. Add canonical Customer v2 references to Invoice v2 and server-side issuance.
3. Add transactional canonical payment creation and balance updates.
4. Add controlled appointment-to-invoice linkage.
5. Move reports and dashboard metrics to canonical cash-basis sources with an explicit legacy transition view.
6. Classify and migrate legacy records: confirmed IDs, name-only records requiring review, ambiguous duplicate-name records, missing-reference records, and malformed financial records.
7. Retire legacy write paths only after migration verification, tenant reconciliation and a defined rollback/read-only plan.

Migration never guesses IDs from names. Ambiguous, missing and malformed records remain visible in an exception queue for deliberate operator resolution. There is no permanent dual-write phase: each entity receives one cutover command and one canonical source of truth after validation.

## Concurrency, audit and safeguards

Server transactions protect counter allocation, invoice revision, payment allocation and appointment-to-invoice linking. Commands use idempotency keys for externally retried creations. Invoice revisions reject stale updates. Server-owned audit fields include createdAt, updatedAt, createdBy and updatedBy. Financial state changes need immutable command/audit records before production use.

Production must never compose with local emulator settings. Local commands require explicit emulator configuration; production Admin composition rejects emulator host/project configuration. Invoice v2 production remains blocked until its callable deployment prerequisites are completed.

## App Check operational readiness

Production Callable Functions already require App Check outside local development. BusinessBoss Web is registered in Firebase App Check, and reCAPTCHA Enterprise / Fraud Defense is configured for the production web app. The production web domains have also been registered with the Enterprise key.

The remaining frontend requirement is to supply the public reCAPTCHA Enterprise site key to the deployed BusinessBoss configuration so the browser can initialize App Check in production. Production Callable Function deployment remains postponed while the Firebase project stays on the Spark plan.

Firebase Auth identifies the signed-in user, trusted business membership authorizes the tenant action, and App Check helps establish that requests originate from the genuine BusinessBoss application. App Check does not replace Auth or tenant authorization.

## Non-goals for this foundation

This stage makes no Firestore-rule, persistence, migration, provider, payment, email, Peach, PDF, dashboard, report or UI changes. It does not deploy Functions, enable billing, or make legacy top-level data authoritative.