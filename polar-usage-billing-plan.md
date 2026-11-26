# Polar Usage-Based Billing: Performance-Critical Design

**Stack:** SvelteKit (SSR + hydration) · Better Auth · PostgreSQL · Redis 8 · Polar (mocked locally)

| | |
|---|---|
| Status | **Executed 2026-11-25** through P5, against the mock. The execution record below is what was built; where it differs from §1–§19, the record is right and the section is history. |
| Date | 2026-11-25 |
| Scope | Usage metering, enforcement, entitlements, webhooks, checkout/portal, reconciliation, local Polar mock |
| Out of scope | Deployment and hosting, multi-region, tax configuration, live Polar organization setup |

## Execution record (2026-11-25)

Written after the build, by the architect who ran it. Sections 1–19 below are the plan as it was drafted and are kept for their research and sources. This record says what exists.

### What was built

| Piece | Where |
|---|---|
| Two tables, `billing.state` and `billing.usage_event` | `src/lib/server/db/billing-schema.ts`, migration `drizzle/0003_billing.sql` |
| Redis keys and the three Lua scripts | `src/lib/server/billing/redis.ts` |
| Entitlements and usage recording (the request side) | `src/lib/server/billing/service.ts`, exposed to routes only through `index.ts` |
| Polar adapter over the real SDK (`@polar-sh/sdk/2026-10`) | `src/lib/server/billing/polar/` (`checkout.ts` for requests, `sync.ts` for the worker) |
| Webhook ingress | `src/routes/api/webhooks/polar/+server.ts`, `src/lib/server/billing/webhook.ts` |
| Worker: drain, ship, sync, removal of deleted customers, rate budget | `src/lib/server/billing/worker/`, started by `pnpm billing:worker` (`scripts/billing-worker.js`) and by `pnpm launch` |
| Fake Polar: API subset, hosted checkout and portal pages, signed webhooks | `scripts/mock-polar/server.js` |
| Billing pages | `src/routes/billing/` |
| Catalogue (one product, one meter) and configuration | `src/lib/server/billing/catalogue.ts`, `config.ts`, `src/env.ts`, `.env.example` |

To run it: `pnpm launch` starts everything. In development, `pnpm dev` in one terminal and `pnpm billing:worker` in another. The fake Polar listens at `POLAR_MOCK_URL` while that is set.

### Spike results (§18)

Measured on what compose.yaml actually runs: Redis 8.10.3, PostgreSQL 19.0, Node 24.18, `@polar-sh/sdk` 1.3.3.

| # | Result |
|---|---|
| U1 | Still undocumented. The SDK's own Outpost client sends up to 1,000 events per request, so the ship batch of 500 is inside what Polar's own code relies on. |
| U5 | ✅ The SDK takes a `baseUrl`. It has no runtime dependencies and does not validate response bodies. This is what made an HTTP-level mock (D9 = B) possible. |
| U6, U7 | ✅ 1.3.3 exports `./2026-10` and `./2026-10/services/*`. Functions are named `<verb><Service>`, for example `getStateExternalCustomers`, `ingestEvents`, `createCheckouts`. It needs Node ≥ 24. |
| U8 | ✅ From the SDK's types. Customer state has `active_subscriptions` (status `active` or `trialing` only), `granted_benefits` and `active_meters` (`meter_id`, `consumed_units`, `credited_units`, `balance`). A past-due subscription is simply absent. |
| U9 | ✅ `OrderBillingReason` includes `subscription_meter_cycle`. Not used: see "Period" below. |
| U11 | ✅ `XADD … IDMP` works inside Lua, and a repeat returns the original id. ⚠️ It is per producer: the same id from a second producer was added again. Not used in the end: see "The usage script". |
| U12 | Not needed. The drain acknowledges and deletes exactly the entries it wrote. |
| U14 | ✅ Checked against the built server under `pnpm launch`: a signed JSON webhook with no `Origin` header is accepted (202), and the worker had synced the row two seconds later. A tampered body is refused (403). |
| U15 | Not needed. Nothing does get-or-create. |
| U16 | ✅ `customer_portal_url` on the customer session. |
| U19 | ✅ The mock's signing is tested against the example in the Standard Webhooks spec and verified by the SDK's own `validateEvent`, which also rejects timestamps more than five minutes off. |
| U20 | ✅ `crypto.randomUUIDv7` is built into Node 24. No library. |
| U2, U3, U10, U13, U17, U18, U21 | Not resolved. U13 and U18 no longer matter (no Better Auth plugin, no `INCREX`). The rest need a real Polar: see "Still unverified". |

Also measured: `XREADGROUP … CLAIM` and `DELEX … IFEQ` work as §7 writes them. A container on this machine could not reach a server on the host on any address.

### Decisions taken

| | Taken | Note |
|---|---|---|
| D1 | **B**, own integration | The SDK directly. No Better Auth plugin and no change to the auth configuration at all. |
| D2 | **B**, at first checkout | Changed from the "A" I first intended. Usage is only allowed with a subscription, and checkout creates the customer, so nothing can ship before Polar knows them. No provisioner exists. |
| D3 | **A**, per user | `subject_id` is opaque. There is no `kind` column: adding one later is one `ALTER TABLE`. |
| D4 | **B**, soft with a ceiling | `overage` per meter in the catalogue (100 units for `api_calls`). Past due: **(iii)**, blocked, because Polar's state does not list a past-due subscription and state is the only source. Redis down: usage is refused; entitlements are read from Postgres. |
| D5 | **A**, Redis first | No per-meter `sync` mode. |
| D6 | **A**, one hash | Entitlements and counters share one hash per person, so recording is one round trip without client-side caching. Reading is one round trip. B is a measured follow-up if it is ever wanted. |
| D7 | **A**, hosted redirect | |
| D8 | **B**, dirty signal and refetch | Every webhook only marks the customer; the worker asks Polar for the whole state. Simpler than C and always right. |
| D9 | **B + C** | An HTTP mock driven by the real SDK, whose own tests are the contract suite. Not the in-process fake. |
| D10 | **B**, separate process | Loaded through Vite like `scripts/seed.js`. One worker at a time, held by a Postgres advisory lock. |

### What changed from the plan, and why

- **Two tables, not eight.** A webhook is not stored or interpreted. It marks `billing.state.dirty_at` in one statement, and the worker refetches. That removes the inbox, the outbox, the per-event handlers (§9.2) and every question about duplicates and ordering. Meter configuration is code (`catalogue.ts`), not a table. `usage_counter` is a `SUM` over the ledger, asked only when Redis has lost a count. `ship_batch` is two columns on the ledger row.
- **The usage script (§7.4) had a defect.** It checked the limit before recognising a duplicate, so a retry of an event that had used the last of an allowance was answered DENY for work that was counted. The plan called a narrower case acceptable. The script now looks for the event's id first, in a key that lives five minutes, and only then checks the limit. IDMP cannot do this, because it can only report a repeat on the append.
- **One hash per person** (`bl:sub:<id>`) and one stream (`bl:usage`). No 64-shard hash tags: there is no cluster, and Redis state can be rebuilt from Postgres when there is.
- **Units are whole numbers.** No float handling in Lua, Postgres or JavaScript.
- **No request-path guard at runtime (§8.6).** The two calls a request may make are in one file and the worker's calls in another, and `boundary.test.ts` walks the import graph and fails if anything that serves a request can reach the worker's side.
- **No `locals.billing`, no change to `hooks.server.ts`.** Routes import the service; a route that does not costs nothing.
- **No session cookie cache and no Redis secondary storage for Better Auth (§8.1).** The auth configuration already decides against a cookie cache, in writing, so that a revoked session stops at once. Billing does not need either.
- **The mock runs on the host, inside the worker process,** because of the container measurement above. It infers where to send webhooks from the last checkout's success address (loopback only) and keeps its state in `node_modules/.cache/mock-polar/state.json`.
- **The mock is not a billing simulator.** No pricing tiers, caps, invoices, retry schedules or filter engine (§10.4): the app reads none of them.
- **Period.** The local period is the subscription's current period, from customer state. A product with a separate, shorter meter cycle (P12) is not supported: state does not say when that cycle turns.
- **Reconciliation** is a comparison made on each state refresh between Polar's `consumed_units` and what the ledger has shipped for the period. A difference is logged. Nothing is ever re-sent to make numbers meet.

### Not built

| Item | Why |
|---|---|
| Reserve and settle (§8.4) | No variable-cost meter exists. |
| Event metadata beyond the quantity | Nothing uses it. It also removes the question of personal data in immutable events. |
| Ledger partitioning (§6.1) | drizzle-kit cannot express it and there is no data to retire yet. Converting is a migration when retention becomes real. |
| Load, chaos and performance gates in CI (P6, §12) | The round-trip budgets are asserted in tests (one command per record, one per read). Load scenarios and chaos runs are not automated. |
| `Server-Timing` entries for billing | The existing `render` timing covers the page. Add them when a perf run needs them. |
| Per-subject abuse rate limiting (§14) | No metered endpoint of the product's own exists yet to protect. |
| A built worker for deployment | Deployment is out of scope. The worker runs through Vite, as `seed.js` does. |
| Polar Outpost (found during the spike) | SDK 1.x ships Redis-backed local metering with its own sync protocol against `/v1/outpost/*`. Not adopted: a local mock would have to imitate a private protocol, it gives balance reads and not an atomic check-and-count, and it needs `ioredis` and OpenTelemetry. Worth evaluating at P7 as a replacement for ship and reconciliation. |

### Still unverified, for the first run against a real Polar (P7)

- The hosts of Polar's checkout and portal addresses. The content security policy names `polar.sh` and `sandbox.polar.sh` as a guess (`vite.config.ts`); Polar's reference gives no example.
- What Polar answers when a customer session is asked for an unknown customer. The code takes a 404 or a 422 to mean "no customer".
- Whether deleting a customer by external id needs `anonymize`, and what it does to their subscriptions.
- U2 (how long `external_id` deduplication lasts), U3 (ingest for an unknown external customer id), U21 (token scopes).
- The [S2] rate limits, which were read from the 2026-04 page.

### Review, and what it closed (2026-11-25)

The build was reviewed against this document before it was committed. The record above had left out several places where the code departed from §1–§19, and most of the defects found were in those places. This section is what was found, what was done about each, and what is still open. Where it differs from anything above, it is the later word.

**Measured**, on a production build in Chrome against the fake Polar:

| | |
|---|---|
| `/billing` rendered on the server | 19–29 ms warm (`/account`: 41–48 ms) |
| Layout shift | 0 on every load, and through a refused use, a counted use, the waiting page stopping, and paying |
| Hydration | No warning from Svelte's development build. 6 writes inside `<main>` on `/billing` (`/account`: 24), none of which changes what is shown |
| The waiting page | One request of 160 bytes a second, stopped after half a minute. Without JavaScript it refreshes itself and stops the same |
| Pay to the billing page | 1.5 s |
| A counted use, with the reload of the page's data | about 0.1 s |
| JavaScript added to every other page | 113–160 bytes compressed, for the Billing link in the account menu. §12's target was 0 |
| JavaScript on `/billing` over what every page has | about 5.6 KB compressed, of which 3.5 KB is the account pages' file (`vite.config.ts` says why it is left). §12's target was 5 KB |

**Closed.** Each has a test that fails without the change, but for two that have none: the trimming of a pasted value, and the recording of the portal's 422.

| What was wrong | What it is now |
|---|---|
| A buyer whose webhooks never arrived was never asked about (§13 promised a sweep; the sweep only asks about people who subscribe already). They had paid and were refused. | The page a buyer comes back to marks their row, as a webhook does (`requestSync` in `service.ts`), at most once in five seconds for a person. |
| The four values Polar gives were each needed only where used, so a site with no webhook secret could sell a subscription it would never hear about. | All four are needed together (`config.ts`). Without them no checkout can be started, and the error names every one that is missing. Each is trimmed of the space a paste can bring (`src/env.ts`). |
| The sync said a row was up to date before Redis had it. A failure in between left a renewed subscriber refused against the old period for up to six hours. | The row, then Redis, and only then that it was asked about. The first write marks the row, so a failure anywhere leaves it to be done again (`worker/sync.ts`). |
| With Redis down, every billing read waited a second before going to Postgres, and left a listener behind (§8.3 and §13 called for a circuit breaker). | Once a try to connect has failed, a request fails at once, until Redis is back. Requests that arrive while the first connection is being made share one wait (`redis.ts`). Nothing more elaborate than that. |
| A person's hash in Redis ended a week after their subscription last changed, whatever they did (§7.2 had it last to the end of the period and a week more). Its counts were then added up again without what was waiting in the stream. | Each counted use and each write by the worker keeps it another week. |
| Requests that found the same hash missing each asked Postgres for the same sum (§7.5 called for single-flight). | One asks, in a process, and the rest wait for it. There is no lock between processes. |
| An event id of a caller's own could be anything, and was remembered for everybody. One that was not a UUID stopped the ledger being written. One reused by another person was answered as counted already. | It has to be a UUID, it is remembered for the one person, and the drain treats an entry that is not one as unreadable. |
| The worker's budget let it spend its minute's share twice in one minute after a quiet spell, which could refuse a person pressing Upgrade (§9.6 reserved 15% for requests). | It can save up 5% of the limit and earns 80% a minute, so the most in any minute is 85%. |
| One person Polar could not be asked about stopped everyone marked after them. | Each is caught alone and recorded, and waits fifteen seconds to be tried again. A rate limit still ends the pass. |
| A customer was removed from Polar while some of their use had yet to be sent. | Removed only once none is. |
| The worker ended for good when its connection to Postgres failed, and nothing started it again. | It stops its jobs, takes the lock again when it can, and starts them again (`worker/lock.ts`). A Postgres that is not there at the start is waited for. |
| Stopping the worker had no bound: the last drain never ended while the site was busy, and a pause Polar had asked for was sat out. | Two seconds of draining, five of shipping, and a stop cuts a pause short. |
| A Retry-After that was not a number switched pausing off for good. | Anything that is not a number of seconds is a minute. |
| The sync's question read every row of `billing.state` twice a second. | Marked rows are found from their index on every pass. The question that has to read every row is put once a minute. |
| The portal's 422 was taken in silence for "no customer". | Recorded, since the other thing it can mean is this site's own mistake. |

**Left as it is, on purpose.**

- **§10.9, the fake refused in production.** Not built, and not wanted in that form: `pnpm launch` runs the production build against the fake. What guards it is the rule `OAUTH_MOCK_URL` already has: `POLAR_MOCK_URL` is only taken if it names this machine.
- **Shipping stops on a refusal that is not a 422.** Setting such events aside would throw away everybody's usage on a bad token. Stopping, loudly, is the safe failure.
- **The account pages' file on `/billing`.** See the table above.

**Still open.**

- A buyer who never comes back to the site after paying, and whose every webhook is lost, is still not asked about. Any later webhook about them puts it right.
- A command sent to Redis and never answered (a connection that is dead and does not know it) has no time limit of this code's own. A read waits on it.
- Upgrade checks for an existing subscription in Redis. In the second or so between paying and the subscription arriving, a second tab can start a second checkout.
- Twenty deletions that Polar refuses every time would hold back the removals behind them. Sync has a way round its own; removal has not.
- `usage_event_period` does not hold `units`, so adding up a period reads each of its rows from the table.
- Not built: the alert on the stream's length (§9.3), a bundle-size check in CI (§12), and an automated test of the webhook route itself, which was checked by hand (U14). Firefox and Safari were not measured, nor a slow connection.
- Everything under "Still unverified" above, the hosts in the content security policy first among them.

## How to read this document

| Marker | Meaning |
|---|---|
| ✅ `[S#]` | **Verified** against the cited source on 2026-11-25. Sources are listed in §19. |
| ⚠️ | **Unverified.** Not documented, or not confirmed. Must be settled in the spike (§18) before anything depends on it. |
| 🎯 | **Target.** A budget we set for ourselves. Not a fact about any product. |
| 🧮 | **Derived.** Arithmetic or inference from cited inputs. |
| 💡 | **Design opinion.** Reasoned, but not sourced. |
| **D#** | **A decision for David.** Options and a recommendation are in §4. Nothing in this document decides them silently. |

Code blocks are **sketches**. They show shape and intent. Check exact SDK import paths and option names against the installed versions; §18 lists the ones known to be unverified.

**What was actually executed while writing this:**

- **Lua scripts** (§7.4) ran against a local Redis 7.0, with only the `IDMP` argument removed because 7.0 doesn't have it. COLD, OK, DENY, soft overage, duplicate detection and the entitlement version guard all behaved as described.
- **SQL** (§6) ran against PostgreSQL 16, with `gen_random_uuid()` standing in for `uuidv7()`. The DDL is valid, the drain is idempotent on replay, the ship claim works, and the PG18 get-or-create fallback returns the row both times.
- **Not run:** anything that needs Redis ≥ 8.6, PostgreSQL ≥ 18 or the Polar SDK.

---

## Table of contents

1. [TL;DR: the rules](#1-tldr-the-rules)
2. [Assumptions and version floor](#2-assumptions-and-version-floor)
3. [Verified platform facts that drive the design](#3-verified-platform-facts-that-drive-the-design)
4. [Decisions for David](#4-decisions-for-david)
5. [Architecture](#5-architecture)
6. [Data model (PostgreSQL)](#6-data-model-postgresql)
7. [Redis design](#7-redis-design)
8. [Request-path flows](#8-request-path-flows)
9. [Async pipelines (workers)](#9-async-pipelines-workers)
10. [The mock Polar layer](#10-the-mock-polar-layer)
11. [SvelteKit SSR and hydration rules](#11-sveltekit-ssr-and-hydration-rules)
12. [Performance budgets and measurement](#12-performance-budgets-and-measurement)
13. [Failure modes and degradation](#13-failure-modes-and-degradation)
14. [Security and data handling](#14-security-and-data-handling)
15. [Polar API version lifecycle](#15-polar-api-version-lifecycle)
16. [Testing strategy](#16-testing-strategy)
17. [Implementation plan](#17-implementation-plan)
18. [Unverified items: spike checklist](#18-unverified-items-spike-checklist)
19. [Sources](#19-sources)

---

## 1. TL;DR: the rules

1. **No Polar calls while serving a request.** The only exceptions are two user-initiated redirects: creating a checkout session and creating a portal session. A runtime guard and a lint rule enforce this (§8.6).
2. **A billing read costs at most one Redis round trip, and none on a client-side-cache hit** (D6). Routes that don't touch billing pay nothing, because billing locals are lazy.
3. **Recording usage costs exactly one Redis round trip.** One atomic script checks the limit, increments the counter, and appends the event to a stream.
4. **We enforce limits; Polar doesn't.** Polar never blocks a customer's action because of their meter balance, so enforcement is the integrator's job ✅ [S4][S8]. Enforcement lives in Redis.
5. **PostgreSQL is never on the billing read path.** It is the durable ledger and state store, written by workers.
6. **Webhooks are verified, persisted and answered with 202 in milliseconds. Processing happens async.** Polar times out after 10 s and recommends answering within 2 s ✅ [S1]. 🎯 We target p99 ≤ 50 ms.
7. **Every side effect carries an idempotency key that we generate**: event `external_id`, `webhook-id`, outbox row id.
8. **No billing code or Polar SDK in client bundles.** 🎯 0 bytes added to non-billing routes.
9. **Polar is the system of record for billing** (orders, payments, credits). **Our ledger is the system of record for usage** and the enforcement authority. A reconciler keeps the two in agreement.
10. **Polar can be swapped for a contract-faithful local mock** (§10) behind one port, selected by an environment variable.

---

## 2. Assumptions and version floor

| Component | Floor | Why |
|---|---|---|
| Node.js | 22 (22.17 if on SvelteKit 3) | Polar SDK ≥ 1.0 needs Node 22+ ✅ [S13]. The Better Auth Polar plugin needs Node 22+ ✅ [S15]. SvelteKit 3 needs Node 22.17 ✅ [S25]. |
| SvelteKit | 2.x or 3.x | SvelteKit 3 shipped in October 2026 ✅ [S26]. Code here uses SvelteKit 2 aliases. On SvelteKit 3, `$lib` becomes `#lib` and `$app/environment` becomes `$app/env` ✅ [S25][S26]. |
| Better Auth | 1.7+ (only needed if D1 = A) | The Polar plugin needs Better Auth 1.7 or later ✅ [S15]. |
| `@polar-sh/sdk` | ≥ 1.0, a release that exports the `2026-10` entrypoint | The import path pins the API version ✅ [S12]. ⚠️ Polar's Better Auth page installs `@polar-sh/sdk@1.0.0` but imports from `/2026-10` [S15]. Confirm which release exports that path. |
| PostgreSQL | 18 minimum; 19 optional | 18 added `uuidv7()` ✅ [S40]. 19 (released 2026-11-19) adds `INSERT … ON CONFLICT DO SELECT` and `REPACK (CONCURRENTLY)` ✅ [S39]. |
| Redis | 8.6 minimum; 8.8 recommended | `XADD … IDMP` needs 8.6 ✅ [S30]. `SET IFEQ`/`DELEX` and `XREADGROUP … CLAIM` need 8.4 ✅ [S27][S28]. 8.8 (GA May 2026) is the newest GA I found ✅ [S32]. |
| Redis client | node-redis (`redis` on npm) ≥ 5.1 | Redis recommends node-redis for Node.js ✅ [S34]. Client-side caching needs node-redis ≥ 5.1.0 ✅ [S35]. |

**One Redis client, not two.** Better Auth's official Redis storage package uses ioredis. Better Auth also documents a small custom adapter for node-redis ✅ [S20]. 💡 Use the node-redis adapter so the app runs one client library.

**Assumption about the product model.** Polar products carry one or more metered prices (unit, volume or graduated, optionally capped) attached to meters. A Credits benefit may grant prepaid units each cycle ✅ [S7][S8].

---

## 3. Verified platform facts that drive the design

Each row is a fact from the source, followed by what it forces in this design.

### 3.1 Polar: metering and billing

| # | Fact | Design consequence | Src |
|---|---|---|---|
| P1 | Polar never blocks usage when a balance runs out. Stopping usage is the integrator's job. | Local, real-time enforcement in Redis (§7, §8.4). | ✅ [S4][S8] |
| P2 | Ingested events can't be changed or deleted. | Validate before shipping. Never put PII in metadata (§14). | ✅ [S4] |
| P3 | Polar assigns events to billing periods by **when it receives them**, not by `timestamp`. Late events land in the current cycle, and Polar issues no retroactive invoices or credits for them. | Ship lag affects billing accuracy. Keep the flush interval short and flush on shutdown (§9.4). | ✅ [S4] |
| P4 | Ingest is `POST /v1/events/ingest` with scope `events:write`. Each event carries `name` (≤ 128 chars), `customer_id` or `external_customer_id`, an optional `timestamp`, an optional `external_id` (used for deduplication), and `metadata`. | Edge validation (§8.4). `external_id` = our UUIDv7 event id. | ✅ [S5] |
| P5 | Metadata limits: ≤ 50 pairs; keys ≤ 40 chars; values are strings of 1–500 chars, integers, floats or booleans. `_cost` and `_llm` are reserved keys. | Validate at record time, not at ship time. | ✅ [S5] |
| P6 | The ingest response returns `inserted` and `duplicates`. A maximum events-per-request isn't specified. | Batch size is configurable. ⚠️ Find the limit (§18). | ✅ [S5] |
| P7 | Meters filter events with clauses (equals, not equals, >, ≥, <, ≤, contains, does not contain) joined by and/or. They aggregate with Count, Sum, Average, Minimum, Maximum or Unique. Filter values are parsed as number, then boolean, then string. | The mock implements exactly this (§10.4). | ✅ [S6] |
| P8 | A meter's filters and aggregation can only be edited while it has no processed events and no linked purchase. | Settle meter definitions in the mock first. | ✅ [S6] |
| P9 | A customer meter exposes `consumed_units` (number), `credited_units` (integer) and `balance` (credited − consumed). The list endpoint sorts by `-modified_at` by default, with `limit` ≤ 100. | The reconciler pages newest-modified first and stops at a watermark (§9.5). | ✅ [S10] |
| P10 | The 2026-10 webhook catalogue has **no meter webhook**. `customer.state_changed` fires on customer create/update/delete, subscription create/update, and benefit grant/revoke. | Balances are never pushed to us. Local counters are authoritative in real time, and reconciliation polls (§9.5). | ✅ [S11][S9] |
| P11 | Pricing models are unit, volume and graduated. An optional **cap** charges the cap amount once usage exceeds it, regardless of further usage. | With a cap, usage past the cap is free to the customer. Enforce a local stop if that's unintended (D4). | ✅ [S7] |
| P12 | Usage is invoiced at renewal with the base price by default. A separate **meter cycle** can invoice more often. At each meter-period end, Polar invoices usage as a separate order, resets meters and re-grants credits, even with zero usage. | Local counter periods follow the **meter cycle**, not the subscription period (§9.8). | ✅ [S7] |
| P13 | Meter-cycle orders emit `order.created` and `order.paid` and are told apart by `billing_reason`. They don't emit `subscription.cycled`. | These are the period-rollover triggers. ⚠️ Exact `billing_reason` values (§18). | ✅ [S7] |
| P14 | While a subscription is past due, the meter cycle pauses but usage is still recorded. Accrued usage is invoiced on recovery. No credits are granted while past due. | Past-due policy (D4). | ✅ [S7][S8] |
| P15 | Failed meter-cycle orders are retried after 2, 7, 14 and 21 days. The subscription stays active, and the order is voided if every retry fails. | The mock simulates the same schedule. | ✅ [S7] |
| P16 | Credits are deducted first. Overage is charged once the balance reaches 0, if a metered price exists. With no metered price, no overage can happen. Via the API, rollover defaults to `false`; in the dashboard it defaults to on. Non-rollover credits are used before rollover credits. | D4 options. Mock credit rules (§10.4). | ✅ [S8] |
| P17 | Manual credits (`POST /v1/customer-meters/credits`) need API version **2027-01**. | Don't depend on it while 2027-01 is "Next" (§15). | ✅ [S8] |
| P18 | Customers can see estimated per-meter charges in the Customer Portal. | v1 can link to the portal for invoices. In-app usage comes from local counters. | ✅ [S7] |

### 3.2 Polar: platform

| # | Fact | Design consequence | Src |
|---|---|---|---|
| P19 | Rate limits: 500 req/min in production and 100 req/min in sandbox, per organization/customer or OAuth2 client. A 429 response carries `Retry-After`. | One token-bucket budgeter for every Polar call (§9.6). | ✅ [S2] |
| P20 | Pagination is `page` + `limit`, with `limit` ≤ 100. | Reconciler maths (§9.6). | ✅ [S2] |
| P21 | Versions are chosen with the `Polar-Version: YYYY-MM` header; without it, Polar uses Current. New versions ship in January, April, July and October. Each version spends about 3 months each as Next, Current and Deprecated. Webhook endpoints are versioned separately (`api_version`), and each delivery carries a `webhook-api-version` header. | Pin and upgrade quarterly (§15). | ✅ [S3] |
| P22 | The SDK pins the version through its import path (`@polar-sh/sdk/2026-10`). `createPolarCore` plus individual functions enables tree-shaking. Don't mix pre-1.0 conventions with new ones. | Adapter imports only the functions it uses (§10.2). | ✅ [S12][S14][S13] |
| P23 | The `@polar-sh/sveltekit` adapter (and other framework adapters) is deprecated. `@polar-sh/better-auth` is maintained. | Use the SDK directly (D1). | ✅ [S13] |
| P24 | Webhooks time out after 10 s, and Polar recommends answering within 2 s and processing in a background worker. Up to 10 delivery attempts with exponential backoff. An endpoint is disabled after 10 consecutive failed events. Redirects count as failures. | Persist-then-ack ingress (§9.1). Exact final URL, no redirects. | ✅ [S1] |
| P25 | Polar's delivery page doesn't document duplicate or ordering guarantees. | Design for both duplicates and reordering (D8). | ⚠️ [S1] |
| P26 | Secrets created on or after 8 September 2026 follow Standard Webhooks. SDK ≥ 1.0.0-alpha.19 tries both key schemes. JS verifies with `webhooks.validateEvent(body, headers, secret)` from `@polar-sh/sdk/2026-10`. Verification errors map to 403. Unknown event types map to 202, so Polar won't retry. | Ingress code (§9.1). The mock signs with Standard Webhooks (§10.5). | ✅ [S1] |
| P27 | At checkout, `external_customer_id` links the order to an existing customer, or creates one with that id. `success_url` can include `{CHECKOUT_ID}`. `embed_origin` is needed for embedded checkout. | D2, D7, checkout flow (§8.5). | ✅ [S16][S17] |
| P28 | Organization access tokens must stay out of browsers. The Customer Portal API uses customer access tokens created server-side via `/v1/customer-sessions/`. | Portal flow (§8.5), security (§14). | ✅ [S2][S12] |
| P29 | `polar webhook trigger <event> --dry-run` prints a payload without sending it, and `--seed` makes payloads repeatable. | Real-shape fixtures for the mock (§10.8). | ✅ [S18] |

### 3.3 Better Auth

| # | Fact | Design consequence | Src |
|---|---|---|---|
| B1 | `session.cookieCache` validates a short-lived signed cookie without a database hit. Strategies are `compact` (default), `jwt` and `jwe`. A revoked session can stay active until the cache expires. | Use it. Choose `maxAge` knowing the revocation lag. | ✅ [S19] |
| B2 | Cached sessions don't include custom fields, so `customSession` runs on every fetch. | **Never put billing data in `customSession`.** | ✅ [S19] |
| B3 | `databaseHooks.user.create.after` runs after the commit and is skipped on rollback. | The provisioning outbox write isn't in the user's transaction, so a sweeper closes the crash gap (§9.7). | ✅ [S20] |
| B4 | `svelteKitHandler` doesn't populate `event.locals`. Call `auth.api.getSession` in `handle`. `getRequestEvent` needs SvelteKit ≥ 2.20. | `hooks.server.ts` (§8.1). | ✅ [S21] |
| B5 | The Polar plugin exposes a client-callable `usage.ingest` that trusts whatever the client sends. Polar advises ingesting from the server. If a plugin webhook handler throws, the request fails and Polar retries. | D1. Never expose client ingestion. | ✅ [S15] |

### 3.4 SvelteKit

| # | Fact | Design consequence | Src |
|---|---|---|---|
| K1 | Promises returned from a server `load` are streamed as they resolve. A lazy promise that rejects before rendering can crash the server unless it has a `catch`. | Stream non-critical billing data; always attach `.catch` (§11). | ✅ [S23] |
| K2 | Server `load` data is serialized with devalue. | Keep billing DTOs tiny (§11). | ✅ [S23] |
| K3 | Setting the same header more than once, even from separate `load` functions, is an error. | Set cache headers in one place. | ✅ [S23] |
| K4 | `init` in `hooks.server` runs once when the server is created. | Option for in-process workers (D10). | ✅ [S24] |
| K5 | `tracing.server` (OpenTelemetry) carries noticeable overhead; the docs suggest dev and preview only. | Use `Server-Timing` in perf runs (§12). | ✅ [S22] |
| K6 | SvelteKit 3: any `server` directory (outside `src/routes`) or a `server` filename segment is server-only. `$env/*` is deprecated in favor of `$app/env/private` and `$app/env/public`. CSRF protection is always on, and cross-origin mutative requests with no `Content-Type` are rejected. | Module layout (§8). Webhook CSRF test (§16). | ✅ [S25] |
| K7 | SvelteKit 2 treats anything under `src/lib/server` as server-only. | Same layout works on 2 and 3. | ✅ [S25] |

### 3.5 Redis 8

| # | Fact | Design consequence | Src |
|---|---|---|---|
| R1 | Scripts run atomically and block the server for their duration. All keys a script touches must be passed as key arguments. Scripts with a `#!` header (and Functions) can't touch keys in different cluster slots. | Every key in one script shares a hash tag (§7.2). Keep scripts O(1). | ✅ [S37] |
| R2 | The script cache is volatile, so use `EVALSHA` and fall back on `NOSCRIPT`. | Client wrapper (§7.4). | ✅ [S37] |
| R3 | Lua numbers come back as integers with the decimal part dropped. Return floats as strings. | Scripts return `tostring(...)` (§7.4). | ✅ [S38] |
| R4 | `XADD … IDMP pid iid` (8.6+): a repeated (pid, iid) returns the original entry's id and adds nothing. Retention defaults are 100 s and 100 ids per producer, configurable to 86 400 s and 10 000. The id map survives RDB/AOF restarts. | Idempotent stream production (§7.4). | ✅ [S30][S31] |
| R5 | 8.6 note: avoid IDMP with `appendonly yes` + `aof-use-rdb-preamble no`, a non-default setting. | Keep the default preamble. | ✅ [S29] |
| R6 | `XREADGROUP … CLAIM min-idle-time` (8.4) reclaims idle pending entries and reads new ones in one call. | Single-call drain loop (§9.3). | ✅ [S28] |
| R7 | `SET … IFEQ` and `DELEX … IFEQ` (8.4) give atomic compare-and-set and compare-and-delete. | Lock release without Lua (§7.5). | ✅ [S27] |
| R8 | AOF `everysec` (the default) can lose up to about 1 s of writes in a crash. `always` is very slow but uses group commit. RDB plus AOF is the recommended mix for Postgres-like safety. | D5. Persistence config (§7.6). | ✅ [S33] |
| R9 | Client-side caching: node-redis ≥ 5.1 with RESP3 and the `clientSideCache` option. The server tracks keys and sends invalidations, and a disconnect flushes the cache. For frequently updated keys such as counters, use a separate connection without caching. | D6. Two connections (§7.1). | ✅ [S35][S36] |
| R10 | 8.8 adds `INCREX`, a window-counter rate limiter, and field-level notifications for hashes. | Optional abuse limiting (§14). ⚠️ `INCREX` syntax changed during the RC. | ✅ [S32] |

### 3.6 PostgreSQL

| # | Fact | Design consequence | Src |
|---|---|---|---|
| G1 | `uuidv7()` is built in from 18. | Time-ordered ids, good B-tree locality. | ✅ [S40] |
| G2 | 19 adds `INSERT … ON CONFLICT DO SELECT` (get-or-create in one round trip) and `REPACK (CONCURRENTLY)`. In testing, faster foreign-key checks made bulk inserts nearly 2× faster. | Get-or-create subject (§6.3). Bloat maintenance. | ✅ [S39] |
| G3 | A unique or primary key on a partitioned table must include every partition-key column. | The ledger PK is `(id, recorded_at)` (§6.1). | ✅ [S43] |
| G4 | Dropping or detaching a partition is far faster than bulk `DELETE` and avoids its `VACUUM` cost. | Retention by partition drop. | ✅ [S43] |
| G5 | `synchronous_commit = off` can be set per transaction. The loss window is at most 3 × `wal_writer_delay` (default 200 ms), and it risks data loss, not corruption. | D5 option C: 🧮 ≤ 600 ms window at defaults. | ✅ [S41][S42] |
| G6 | A HOT update needs two things: no indexed column changes, and free space on the page. A lower `fillfactor` helps. | Hot tables don't index columns that change, and use fillfactor 70–80 (§6.1). | ✅ [S44] |

---

## 4. Decisions for David

Each decision lists options, trade-offs and a recommendation. Pick one per decision. The rest of the document notes where each choice changes the design.

### D1: How to integrate with Polar

| Option | Pros | Cons |
|---|---|---|
| **A. Better Auth Polar plugin** (`@polar-sh/better-auth`) | Less code, maintained by Polar ✅ [S13]. Syncs customers on sign-up, update and delete ✅ [S15]. | The plugin calls the SDK directly, so the mock would have to intercept HTTP (see D9). Webhook handlers run inside the HTTP request, and a throw triggers a Polar retry ✅ [S15], so they would still need to be enqueue-only. It ships a client-callable ingest that must never be used ✅ [S15]. Whether customer creation blocks sign-up isn't documented ⚠️ [S15]. |
| **B. Own integration**: Better Auth `databaseHooks`, a `BillingProvider` port and our own webhook route | Full control of the hot path. The mock drops in. No Polar work in sign-up latency. | A few hundred more lines to own (customer sync, webhook routing). |
| C. Hybrid: B for everything, plugin only for the portal helper | Reuses the portal glue. | Two integration surfaces to keep in sync. |

**Recommendation: B.** It's the only option where the mock is a clean drop-in and the hot path has no third-party code. It is reversible, because the port lets A be added later.

### D2: When the Polar customer is created

| Option | Pros | Cons |
|---|---|---|
| **A. Async after sign-up.** The `after` hook inserts one outbox row; a worker creates the customer with `external_id = user.id`. | The customer always exists before any usage ships. Sign-up gains one local `INSERT`. | Every user becomes a Polar customer. |
| B. Lazily at first checkout, via `external_customer_id` ✅ [S16] | Free users never touch Polar. Leanest. | ⚠️ Ingest behaviour for an unknown `external_customer_id` is undocumented, so events for unprovisioned users would have to stay local. |
| C. Synchronously during sign-up | Simple. | Adds a Polar round trip to sign-up latency. **Rejected.** |

**Recommendation: A** if free-tier usage should be visible in Polar. **B** if only paying customers are metered in Polar.

### D3: Who is billed: a user or an organization

| Option | Notes |
|---|---|
| **A. Per user now**, with the schema keyed by `subject_id` + `subject_kind` | Moving to organizations later is a data migration, not a rewrite. |
| B. Per organization now | Polar supports team customers ✅ [S10]. The plugin's organization sync is experimental ✅ [S15]. |

**Recommendation: A**, with the subject abstraction in place from day one.

### D4: Enforcement policy, set per meter

| Option | Behaviour | Notes |
|---|---|---|
| A. `hard` | Deny once the balance (credits) would go below 0. | Matches a credits-only product with no metered price, where overage is impossible ✅ [S8]. |
| **B. `soft` + optional `ceiling`** | Allow overage, billed through the metered price; deny past a local spend ceiling. | Most flexible. |
| C. Polar cap + local stop at the cap | Deny once usage reaches the cap. | Past a Polar cap, extra usage is free to the customer ✅ [S7], so stopping there protects margin. |

Past-due sub-choice: (i) keep serving, because Polar keeps recording usage ✅ [S7]; (ii) drop to `hard` at remaining credits; (iii) block metered features.

What happens when Redis is down, per meter: `open_sync_pg` (record synchronously in Postgres) or `closed` (return 503).

**Recommendation:** a `policy` column per meter. Default to **B** with a ceiling. Past due → (ii). Redis down → `closed` for expensive meters, `open_sync_pg` for cheap ones.

### D5: How durable usage recording is on the hot path

| Option | Request cost | Loss window if a server crashes |
|---|---|---|
| **A. Redis first.** One atomic script (check + increment + `XADD IDMP`); workers drain to Postgres and then ship to Polar. | 1 Redis round trip | Up to about 1 s with AOF `everysec` ✅ [S33] |
| B. Postgres first: synchronous `INSERT` per event | +1 database round trip and a WAL flush per metered request | None |
| C. Postgres with `SET LOCAL synchronous_commit = off` | +1 database round trip; enforcement still needs another store | 🧮 ≤ 600 ms at default settings ✅ [S41][S42] |
| D. Redis first with `appendfsync always` | 1 round trip, but Redis documents this mode as very slow (group commit helps) ✅ [S33] | ~0 |

**Recommendation: A.** The worst case is under-billing the last second of events before a Redis crash. For any meter where that's unacceptable, set `durability = 'sync'` and use B for that meter only.

### D6: How entitlements are read

| Option | Cost per read | Notes |
|---|---|---|
| A. One Redis hash per subject | 1 round trip | Simple. |
| **B. A plus node-redis client-side caching** on a dedicated read connection | 0 on a hit, 1 on a miss | The server pushes invalidations, and a disconnect flushes the cache ✅ [S35]. |
| C. In-process LRU plus hand-rolled pub/sub invalidation | 0 on a hit | Reinvents B. |

**Recommendation: B** for entitlements. Counters use a separate connection without caching, as Redis advises for frequently updated keys ✅ [S35].

### D7: Checkout UX

| Option | Client JS | Notes |
|---|---|---|
| **A. Hosted redirect** | 0 KB | |
| B. Embedded via `@polar-sh/checkout`, loaded with dynamic `import()` only when the user clicks | Paid only on click | Needs `embed_origin` ✅ [S16][S17]. |

**Recommendation: A** for v1. In the mock, both point at `/__mock/polar/checkout/[id]`.

### D8: How `customer.state_changed` is applied

| Option | Correct if events arrive out of order? | Polar API cost |
|---|---|---|
| A. Trust the payload | ⚠️ No; ordering is undocumented [S1] | 0 |
| B. Treat it as a "dirty" signal and refetch state, debounced | Yes | ≤ 1 call per subject per debounce window |
| **C. Apply then confirm**: apply the payload now, then a debounced refetch overwrites it | Yes, eventually; usually right at once | Same as B |

**Recommendation: C.** 🧮 With a 5 s debounce, a subject costs at most 12 calls/min while it changes, and the budgeter (§9.6) caps the total.

### D9: How faithful the mock is

| Option | Notes |
|---|---|
| **A. In-process fake implementing the port**, plus a signed webhook emitter and mock checkout/portal pages | Offline, fast, deterministic. |
| B. A plus an HTTP-level mock server so the real SDK runs end to end | ⚠️ Needs the SDK to accept a custom base URL or `fetch`. Polar's TS SDK page doesn't document either [S12]. |
| **C. A plus a shared contract test suite** that later also runs against the Polar sandbox (100 rpm ✅ [S2]) | Guards against drift between mock and real. |

**Recommendation: A + C now.** Add B only if the spike shows the SDK supports it.

### D10: Where workers run (local only; deployment is out of scope)

| Option | Notes |
|---|---|
| A. Inside the SvelteKit process, started from `init` ✅ [S24] | Quickest to set up. |
| **B. A separate Node process** (`pnpm billing:worker`) | Keeps batch JSON work and database I/O off the request event loop. |

**Recommendation: B.** A is fine for a quick local session. **Note:** with B, the mock's state must live in Postgres (§10.3), because two processes share it.

---

## 5. Architecture

```
┌──────────────────────────── REQUEST PATH (latency-critical) ────────────────────────────┐
│ Browser ─SSR/hydrate─▶ SvelteKit server                                                  │
│   hooks.server.ts ─▶ Better Auth getSession (signed cookie cache, no DB)                │
│                     locals.billing = lazy accessors (no I/O until a route asks)          │
│   BillingService                                                                         │
│     entitlements(sid) ─▶ Redis HGETALL (client-side cached)          0–1 RTT            │
│     recordUsage(...)  ─▶ Redis EVALSHA record_usage                  exactly 1 RTT      │
│     createCheckout()  ─▶ BillingProvider (the only allowed sync call)  user-initiated    │
│   POST /api/webhooks/polar ─▶ verify ─▶ INSERT webhook_inbox ─▶ 202                     │
└──────────────────────────────────────────────────────────────────────────────────────────┘
            │ Redis Streams                │ Postgres                 ▲ signed webhooks
            ▼                              ▼                          │
┌──────────────────────────── ASYNC PATH (throughput, separate process, D10) ─────────────┐
│ drain       : XREADGROUP CLAIM ─▶ ledger INSERT (idempotent) + counters ─▶ XACK          │
│ ship        : claim ledger batch ─▶ provider.ingestEvents(external_id) ─▶ mark accepted  │
│ webhook-proc: inbox (SKIP LOCKED) ─▶ billing.state (version++) ─▶ Redis write-through   │
│ reconciler  : provider customer meters (-modified_at) ⇄ local counters ─▶ drift alerts   │
│ provisioner : outbox ─▶ provider.createCustomer(external_id = subject id)               │
│ budgeter    : one token bucket over every provider call (500 rpm prod)                   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
            │ BillingProvider port
            ▼
   PolarProvider (createPolarCore, @polar-sh/sdk/2026-10)   │   MockPolarProvider (§10)
                                                            │   + simulator, clock, webhook emitter,
                                                            │     dev-only checkout/portal pages
```

### 5.1 Module layout

```
src/
  hooks.server.ts
  lib/server/billing/              # server-only on SvelteKit 2 and 3 (K6, K7)
    index.ts                       # BillingService: the only API routes use
    locals.ts                      # lazy per-request accessors
    guard.ts                       # request-path guard (AsyncLocalStorage)
    meters.ts                      # meter config cached in process memory
    provider/
      port.ts                      # BillingProvider + domain types (ours, camelCase)
      polar.ts                     # PolarProvider: maps Polar snake_case ⇄ domain
      mock/                        # MockPolarProvider, simulator, emitter (dev/test only)
    redis/
      clients.ts                   # redisRead (RESP3 + client-side cache), redisHot (no cache)
      keys.ts
      scripts/record_usage.lua
      scripts/hydrate_usage.lua
      scripts/set_entitlements.lua
    db/
      schema.sql
      queries.ts
    workers/
      main.ts                      # entry point for `pnpm billing:worker` (D10 = B)
      drain.ts  ship.ts  webhooks.ts  reconcile.ts  provision.ts  budget.ts
  routes/
    api/webhooks/polar/+server.ts
    api/billing/status/+server.ts  # cheap activation poll (Redis only)
    (app)/billing/...              # the only routes that load billing data
    __mock/polar/...               # dev-only; 404 unless BILLING_PROVIDER=mock and dev
```

---

## 6. Data model (PostgreSQL)

Everything lives in a `billing` schema, beside Better Auth's tables (Better Auth migrations come from its CLI ✅ [S20]). The mock's state lives in a separate `polar_mock` schema (§10.3).

### 6.1 DDL

```sql
CREATE SCHEMA IF NOT EXISTS billing;

-- A billable subject: a Better Auth user today, possibly an organization later (D3).
CREATE TABLE billing.subject (
  id                text PRIMARY KEY,            -- Better Auth user.id = Polar external_customer_id
  kind              text NOT NULL DEFAULT 'user' CHECK (kind IN ('user','org')),
  polar_customer_id uuid UNIQUE,
  provisioned_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Billing state, one row per subject. Columns that change are NOT indexed,
-- so updates stay HOT (G6).
CREATE TABLE billing.state (
  subject_id   text PRIMARY KEY REFERENCES billing.subject(id) ON DELETE CASCADE,
  version      bigint      NOT NULL DEFAULT 0,      -- incremented on every write; guards Redis
  status       text        NOT NULL DEFAULT 'none', -- none | active | past_due | canceled | ...
  plan_key     text,
  meter_period_start timestamptz,                   -- meter cycle, not the subscription period (P12)
  meter_period_end   timestamptz,
  entitlements jsonb       NOT NULL DEFAULT '{}'::jsonb,  -- compact; what the app reads
  snapshot     jsonb,                                    -- full provider state; audit and debug only
  synced_at    timestamptz NOT NULL DEFAULT now()
) WITH (fillfactor = 80);

-- Meter configuration. Changes rarely; cached in process memory.
CREATE TABLE billing.meter (
  key            text PRIMARY KEY,                       -- e.g. 'ai_tokens'
  polar_meter_id uuid,
  event_name     text NOT NULL CHECK (length(event_name) <= 128),   -- P4
  quantity_key   text NOT NULL DEFAULT 'units' CHECK (length(quantity_key) <= 40), -- P5
  policy         text NOT NULL CHECK (policy IN ('hard','soft','ceiling')),         -- D4
  ceiling_units  numeric,
  durability     text NOT NULL DEFAULT 'async' CHECK (durability IN ('async','sync')), -- D5
  on_redis_down  text NOT NULL DEFAULT 'closed' CHECK (on_redis_down IN ('closed','open_sync_pg'))
);

-- Append-mostly usage ledger. The system of record for usage.
-- No foreign keys on purpose: insert cost stays flat (💡).
CREATE TABLE billing.usage_event (
  id            uuid        NOT NULL,   -- UUIDv7 minted on the hot path = Polar external_id
  recorded_at   timestamptz NOT NULL,   -- from the Redis stream entry id, never DEFAULT now()
  subject_id    text        NOT NULL,
  meter_key     text        NOT NULL,
  period_start  timestamptz NOT NULL,
  units         numeric     NOT NULL CHECK (units >= 0),
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ship_batch_id uuid,
  PRIMARY KEY (id, recorded_at)         -- must include the partition key (G3)
) PARTITION BY RANGE (recorded_at);

CREATE INDEX usage_event_unshipped
  ON billing.usage_event (recorded_at) WHERE ship_batch_id IS NULL;
-- A maintenance job creates monthly partitions ahead of time and drops expired ones (G4).

CREATE TABLE billing.ship_batch (
  id              uuid PRIMARY KEY,
  status          text NOT NULL CHECK (status IN ('sending','accepted','dead')),
  event_count     int  NOT NULL,
  attempts        int  NOT NULL DEFAULT 0,
  inserted        int,
  duplicates      int,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz,
  last_error      text
);
CREATE INDEX ship_batch_due ON billing.ship_batch (next_attempt_at) WHERE status = 'sending';

-- Per-period aggregates: rebuilds Redis counters and detects drift.
CREATE TABLE billing.usage_counter (
  subject_id        text        NOT NULL,
  meter_key         text        NOT NULL,
  period_start      timestamptz NOT NULL,
  consumed          numeric     NOT NULL DEFAULT 0,  -- sum of drained ledger rows
  credited          numeric,                         -- last known from the provider
  provider_consumed numeric,                         -- last seen in provider customer meter
  reconciled_at     timestamptz,
  PRIMARY KEY (subject_id, meter_key, period_start)
) WITH (fillfactor = 70);

CREATE TABLE billing.webhook_inbox (
  webhook_id   text PRIMARY KEY,              -- Standard Webhooks `webhook-id`
  event_type   text NOT NULL,
  api_version  text,                          -- `webhook-api-version` header (P21)
  payload      jsonb NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts     int NOT NULL DEFAULT 0,
  last_error   text
);
CREATE INDEX webhook_inbox_pending ON billing.webhook_inbox (received_at) WHERE processed_at IS NULL;

CREATE TABLE billing.outbox (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),          -- G1
  kind         text NOT NULL,          -- provision_customer | refresh_state | delete_customer
  subject_id   text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts     int NOT NULL DEFAULT 0,
  done_at      timestamptz
);
CREATE UNIQUE INDEX outbox_one_open ON billing.outbox (kind, subject_id) WHERE done_at IS NULL;
CREATE INDEX outbox_ready ON billing.outbox (available_at) WHERE done_at IS NULL;
```

### 6.2 Hot statements

**Drain: idempotent ledger insert plus counter update in one round trip.** Only rows actually inserted add to the counter, so replaying a stream batch changes nothing.

```sql
WITH incoming AS (
  SELECT * FROM unnest($1::uuid[], $2::timestamptz[], $3::text[], $4::text[],
                       $5::timestamptz[], $6::numeric[], $7::jsonb[])
    AS t(id, recorded_at, subject_id, meter_key, period_start, units, metadata)
), ins AS (
  INSERT INTO billing.usage_event (id, recorded_at, subject_id, meter_key, period_start, units, metadata)
  SELECT * FROM incoming
  ON CONFLICT (id, recorded_at) DO NOTHING
  RETURNING subject_id, meter_key, period_start, units
)
INSERT INTO billing.usage_counter AS c (subject_id, meter_key, period_start, consumed)
SELECT subject_id, meter_key, period_start, sum(units) FROM ins GROUP BY 1, 2, 3
ON CONFLICT (subject_id, meter_key, period_start)
DO UPDATE SET consumed = c.consumed + EXCLUDED.consumed;
```

**Claim a ship batch.** Each row is updated exactly once.

```sql
WITH picked AS (
  SELECT id, recorded_at FROM billing.usage_event
  WHERE ship_batch_id IS NULL
  ORDER BY recorded_at
  LIMIT $2
  FOR UPDATE SKIP LOCKED
)
UPDATE billing.usage_event e SET ship_batch_id = $1
FROM picked p WHERE e.id = p.id AND e.recorded_at = p.recorded_at
RETURNING e.*;
-- Same transaction: INSERT INTO billing.ship_batch (id, status, event_count) VALUES ($1, 'sending', <n>);
```

**Claim inbox and outbox work** with `… WHERE processed_at IS NULL ORDER BY received_at LIMIT $n FOR UPDATE SKIP LOCKED`. Commit the claim before calling Polar. 💡 Never hold a transaction open across an HTTP call.

### 6.3 Get-or-create a subject

- **PostgreSQL 19:** `INSERT … ON CONFLICT DO SELECT … RETURNING …` returns the existing row in the same round trip ✅ [S39]. ⚠️ Check the exact clause syntax against the PG19 docs (§18).
- **PostgreSQL 18 fallback:**

```sql
WITH ins AS (
  INSERT INTO billing.subject (id) VALUES ($1)
  ON CONFLICT (id) DO NOTHING
  RETURNING id, polar_customer_id
)
SELECT * FROM ins
UNION ALL
SELECT id, polar_customer_id FROM billing.subject WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM ins);
```

### 6.4 Postgres performance notes

- 💡 Use batched writes with `unnest` arrays (as above). Switch to `COPY` for backfills.
- Keep queue indexes small with partial indexes (`WHERE … IS NULL`).
- Remove old data by dropping partitions, never by `DELETE` ✅ [S43].
- `billing.state` and `usage_counter` use `fillfactor` 80/70 and don't index columns that change, so updates stay HOT ✅ [S44]. Watch the HOT ratio in `pg_stat_all_tables` ✅ [S44].
- On PostgreSQL 19, use `REPACK (CONCURRENTLY)` for bloat, without blocking reads or writes ✅ [S39].

---

## 7. Redis design

### 7.1 Connections

| Client | Protocol | Used for | Why |
|---|---|---|---|
| `redisRead` | RESP3 + `clientSideCache` | Entitlement hashes only | Hits cost no network ✅ [S35][S36] |
| `redisHot` | No client-side cache | Counters, streams, locks, Better Auth secondary storage | Frequently updated keys belong on a connection without caching ✅ [S35] |

### 7.2 Key schema

Usage keys carry a shard **hash tag** `{u:NN}`, so a script's counters and the stream it writes share a slot (R1). 🧮 With `NN = crc32(subject_id) mod 64`, all usage for one subject lands on one shard.

| Key | Type | Fields / content | TTL |
|---|---|---|---|
| `bl:ent:<sid>` | HASH | `v` (state version), `st` (status), `pl` (plan), `ps`/`pe` (meter period), compact flags | 24 h safety TTL, refreshed on write |
| `bl:use:{u:NN}:<sid>:<periodMs>` | HASH | `h`=1 (hydrated), `c:<meter>` consumed, `l:<meter>` effective limit (−1 = none) | period end + 7 d |
| `bl:usage:{u:NN}` | STREAM | one entry per usage event | trimmed after drain |
| `bl:usage:last:{u:NN}` | STRING | last stream id this shard generated (duplicate detection) | none |
| `bl:rsv:{u:NN}:<sid>` | HASH | reservation token → `units:expiresAtMs` (§8.4) | 1 h |
| `bl:lock:<purpose>:<sid>` | STRING | random token | PX 2000 |
| `bl:dirty:<sid>` | STRING | D8 debounce marker | EX 5 |

### 7.3 Configuration

- **Persistence:** `appendonly yes`, `appendfsync everysec`, plus RDB snapshots ✅ [S33]. Keep `aof-use-rdb-preamble` at its default, because of the 8.6 IDMP note ✅ [S29].
- **Eviction:** 💡 billing keys must never be evicted. Run billing on a dedicated instance or database with a no-eviction policy, so memory pressure shows up as errors rather than lost counters. App caches can sit elsewhere with LRU, or with the new LRM policies from 8.6 ✅ [S29].
- **Idempotency window:** `XCFGSET bl:usage:{u:NN} IDMP-DURATION 300 IDMP-MAXSIZE 10000` ✅ [S31]. 🧮 At 1 000 events/s per process, 10 000 ids cover about 10 s of retries per producer. Raise the shard count if one producer runs hotter. Changing either value clears the map ✅ [S31], so set them once, at stream creation.

### 7.4 Scripts

**`record_usage.lua`: one round trip that checks the limit, appends the event idempotently, and increments.** The `XADD` goes **before** the increment, so a duplicate (a retried call) is detected and never double-counted.

```lua
-- KEYS[1] usage hash   bl:use:{u:NN}:<sid>:<periodMs>
-- KEYS[2] stream       bl:usage:{u:NN}
-- KEYS[3] last id      bl:usage:last:{u:NN}
-- ARGV[1] meter  ARGV[2] units (decimal string)  ARGV[3] policy hard|soft|ceiling
-- ARGV[4] event id (UUIDv7)  ARGV[5] subject id  ARGV[6] period start ms
-- ARGV[7] producer id (stable per process)  ARGV[8] metadata JSON (already validated)
local function gt(a, b)            -- compare stream ids 'ms-seq'
  local am, as = string.match(a, '(%d+)%-(%d+)')   -- '%-' escapes Lua's lazy quantifier
  local bm, bs = string.match(b, '(%d+)%-(%d+)')
  am, as, bm, bs = tonumber(am), tonumber(as), tonumber(bm), tonumber(bs)
  return am > bm or (am == bm and as > bs)
end

if redis.call('HEXISTS', KEYS[1], 'h') == 0 then
  return {'COLD'}                                   -- caller hydrates, then retries once
end
local cf, lf = 'c:' .. ARGV[1], 'l:' .. ARGV[1]
local consumed = tonumber(redis.call('HGET', KEYS[1], cf) or '0')
local limit    = tonumber(redis.call('HGET', KEYS[1], lf) or '-1')
local units    = tonumber(ARGV[2])

if ARGV[3] ~= 'soft' and limit >= 0 and consumed + units > limit then
  return {'DENY', tostring(limit - consumed)}       -- floats as strings (R3)
end

local id = redis.call('XADD', KEYS[2], 'IDMP', ARGV[7], ARGV[4], '*',
  'id', ARGV[4], 's', ARGV[5], 'm', ARGV[1], 'u', ARGV[2], 'p', ARGV[6], 'md', ARGV[8])
local last = redis.call('GET', KEYS[3]) or '0-0'
if not gt(id, last) then                            -- IDMP returned the original entry (R4)
  return {'DUP', tostring(limit >= 0 and (limit - consumed) or -1)}
end
redis.call('SET', KEYS[3], id)
local nc = tonumber(redis.call('HINCRBYFLOAT', KEYS[1], cf, ARGV[2]))
return {'OK', tostring(limit >= 0 and (limit - nc) or -1), id}
```

> **Edge case:** a retry that arrives after the limit has since been used up gets `DENY`, even if the original call was recorded. The original still counts exactly once.
>
> ⚠️ **Spike item.** That `XADD … IDMP` is allowed inside a script is unverified (§18). **Fallback:** replace the IDMP check with `SET bl:evt:{u:NN}:<eventId> 1 NX EX 30`, run before the `XADD`. This adds a short-lived key per event, but works on any Redis 8.

**`hydrate_usage.lua`** (runs after a `COLD` answer). It loads `c:*` from `usage_counter.consumed` and `l:*` from credits or ceiling (via `billing.state` and meter config). It writes `h`=1 and sets `PEXPIRE` to period end + 7 d. It's a no-op if another caller hydrated first (`HEXISTS h`).

**`set_entitlements.lua`** (worker write-through). It writes only when the incoming `version` is newer. Then it runs `DEL` + `HSET` so removed fields vanish. Because the write is atomic, client-side-cache readers get one invalidation ✅ [S35].

```lua
-- KEYS[1] bl:ent:<sid>   ARGV[1] version  ARGV[2] ttl ms  ARGV[3..] field, value pairs
local cur = tonumber(redis.call('HGET', KEYS[1], 'v') or '-1')
if cur >= tonumber(ARGV[1]) then return 0 end
redis.call('DEL', KEYS[1])
redis.call('HSET', KEYS[1], 'v', ARGV[1], unpack(ARGV, 3))
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
```

**Client wrapper:** load scripts at startup, call `EVALSHA`, and on `NOSCRIPT` reload and retry once ✅ [S37].

### 7.5 Locks and single-flight

On an entitlement cache miss:

1. Deduplicate in-process with a `Map<sid, Promise>`.
2. Across processes, `SET bl:lock:ent:<sid> <token> NX PX 2000`.
3. Load from Postgres, write through with `set_entitlements.lua`, then release with `DELEX bl:lock:ent:<sid> IFEQ <token>` ✅ [S27].

A process that loses the lock race waits briefly (🎯 ≤ 20 ms), re-reads, then falls back to a direct Postgres primary-key read.

### 7.6 Draining the stream

```
XREADGROUP GROUP drain <consumer> COUNT 500 BLOCK 250 CLAIM 30000 STREAMS bl:usage:{u:NN} >
```

`CLAIM` picks up entries left pending by a crashed consumer in the same call ✅ [S28]. After the Postgres commit (§6.2), run `XACK`. Trim with `XTRIM … MINID ~ <oldest still-pending id>` ✅ [S30]. ⚠️ Redis 8.2 added `KEEPREF | DELREF | ACKED` to `XADD` ✅ [S30]. Its exact trimming semantics weren't verified, so test them before relying on them.

---

## 8. Request-path flows

### 8.1 `hooks.server.ts`

```ts
// src/hooks.server.ts   (SvelteKit 3: '#lib/...' and '$app/env')
import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '$lib/server/auth';
import { billingLocals } from '$lib/server/billing/locals';
import { requestScope } from '$lib/server/billing/guard';

export const handle: Handle = ({ event, resolve }) =>
  requestScope.run({ route: event.route.id }, async () => {
    // With session.cookieCache on, this validates a signed cookie: no DB or Redis hit (B1).
    const s = await auth.api.getSession({ headers: event.request.headers });
    event.locals.user = s?.user ?? null;
    event.locals.session = s?.session ?? null;
    event.locals.billing = billingLocals(s?.user.id ?? null); // creates closures only; no I/O
    return svelteKitHandler({ event, resolve, auth, building }); // (B4)
  });
```

💡 If most traffic is anonymous, skip `getSession` when the Better Auth session cookie is absent. Take the cookie name from your config.

**Better Auth configuration (relevant parts):**

```ts
export const auth = betterAuth({
  database: /* your Postgres adapter (Kysely/pg or Drizzle) */,
  secondaryStorage: nodeRedisStorage(redisHot),          // custom node-redis adapter (§2, [S20])
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60, strategy: 'compact' }, // trade-off: revocation lag (B1)
  },
  databaseHooks: {
    user: {
      create: {
        // Runs after commit (B3). One local INSERT; no Polar call. D2 = A.
        after: async (user) => { await outbox.enqueue('provision_customer', user.id); },
      },
    },
  },
  plugins: [/* sveltekitCookies(getRequestEvent) — last in the array, per Better Auth docs [S21] */],
});
```

### 8.2 Lazy billing locals

```ts
// $lib/server/billing/locals.ts
export function billingLocals(subjectId: string | null) {
  let ent: Promise<Entitlements> | undefined;
  return {
    subjectId,
    entitlements(): Promise<Entitlements> {
      if (!subjectId) return Promise.resolve(ANONYMOUS);
      return (ent ??= billing.entitlements(subjectId)); // at most once per request
    },
  };
}
```

A route that never calls `locals.billing.entitlements()` makes **zero** billing I/O.

### 8.3 Entitlement check

```ts
async entitlements(sid: string): Promise<Entitlements> {
  const h = await redisRead.hGetAll(keys.ent(sid));       // hit in the client-side cache → no network
  if (h.v !== undefined) return decodeEntitlements(h);
  return singleFlight(`ent:${sid}`, () => this.loadAndWriteThrough(sid)); // §7.5
}
```

| Case | Cost |
|---|---|
| Client-side cache hit (D6 = B) | In-process lookup |
| Cache miss, Redis hit | 1 Redis round trip |
| Redis miss | Postgres primary-key read + write-through, single-flighted |
| Redis down | Postgres primary-key read behind a circuit breaker |

### 8.4 Recording usage

```ts
// e.g. src/routes/api/generate/+server.ts
export const POST: RequestHandler = async ({ locals }) => {
  const sid = locals.user?.id ?? error(401);
  const r = await billing.recordUsage({ subjectId: sid, meter: 'api_calls', units: 1 });
  if (r.status === 'DENY') return json({ error: 'quota_exceeded', remaining: r.remaining }, { status: 402 });
  // ... do the work
};
```

`recordUsage` runs these steps:

1. Look up the meter config in memory.
2. Read the subject's meter period from entitlements, normally a client-side-cache hit.
3. Validate metadata against P5.
4. Mint a UUIDv7 event id in-process. ⚠️ Confirm the library; for example, the `uuid` package's v7.
5. Call `EVALSHA record_usage`.
6. On `COLD`, hydrate and retry once.

The handler then sees `OK`, `DUP` or `DENY`. Total: **1 Redis round trip** in the steady state.

**Variable-cost operations** (for example, LLM tokens) use **reserve → settle** so that a long call can't overspend:

- `reserve(meter, estimate)`: a script prunes expired entries in `bl:rsv:{u:NN}:<sid>` and checks `consumed + Σlive reservations + estimate ≤ limit`. It stores the reservation with a TTL timestamp and adds nothing to the stream.
- `settle(token, actual)`: a script deletes the reservation, increments `consumed` by `actual`, and runs the same `XADD IDMP` step with `actual` units.
- 💡 This assumes only a handful of in-flight reservations per subject, which makes the summing loop O(small). Polar only ever sees the final, actual quantity, which matters because events are immutable (P2).

### 8.5 Checkout and portal: the only request-time provider calls

```ts
// src/routes/(app)/billing/upgrade/+page.server.ts
export const actions = {
  default: async ({ locals, url }) => {
    const sid = locals.user?.id;
    if (!sid) redirect(303, '/login');
    const { url: checkoutUrl } = await billing.createCheckout({
      subjectId: sid,                                         // → external_customer_id (P27)
      productKey: 'usage_pro',
      successUrl: `${url.origin}/billing/activating?checkout_id={CHECKOUT_ID}`, // (P27)
    });
    redirect(303, checkoutUrl);
  },
};
```

- **Activation page:** never trust the success URL. It polls `/api/billing/status`, which reads only the Redis entitlement hash, every 1 s for up to 30 s 🎯. Once the webhook-driven state flips, it re-runs the page's `load` with SvelteKit's invalidation API. ⚠️ Check the API name on SvelteKit 3.
- **Portal:** the server creates a customer session through the provider ✅ [S2], then answers with a 303 to the returned URL. ⚠️ Response field name (§18).

### 8.6 Request-path guard

```ts
// $lib/server/billing/guard.ts
import { AsyncLocalStorage } from 'node:async_hooks';
export const requestScope = new AsyncLocalStorage<{ route: string | null }>();
const ALLOWED = new Set(['createCheckoutSession', 'createPortalSession']);

export function guard(p: BillingProvider): BillingProvider {
  return new Proxy(p, {
    get(t, prop, recv) {
      const v = Reflect.get(t, prop, recv);
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        const scope = requestScope.getStore();
        if (scope && !ALLOWED.has(String(prop))) {
          const msg = `Provider call "${String(prop)}" on request path (${scope.route})`;
          if (process.env.NODE_ENV !== 'production') throw new Error(msg);
          metrics.inc('billing.request_path_violation', { op: String(prop) });
        }
        return v.apply(t, args);
      };
    },
  });
}
```

Add a lint rule as well: `no-restricted-imports` forbids importing `$lib/server/billing/provider/*` from `src/routes/**`, except the checkout and portal handlers.

### 8.7 What never happens on the request path

- A Polar call inside `load`, `handle`, or any metered endpoint.
- Billing data in `customSession` (B2) or in the root layout's `load`.
- Synchronous webhook processing.
- Synchronous Postgres writes for usage, unless a meter is `durability = 'sync'` (D5).
- Client-side usage ingestion (B5).

---

## 9. Async pipelines (workers)

### 9.1 Webhook ingress

```ts
// src/routes/api/webhooks/polar/+server.ts
import { webhooks } from '@polar-sh/sdk/2026-10';           // (P26)
import { env } from '$env/dynamic/private';                 // SvelteKit 3: $app/env/private

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.text();                         // raw body: verify before parsing
  const headers = Object.fromEntries(request.headers);       // ⚠️ confirm expected header type
  let evt;
  try {
    evt = webhooks.validateEvent(body, headers, env.POLAR_WEBHOOK_SECRET);
  } catch (e) {
    if (e instanceof webhooks.PolarWebhookVerificationError) return new Response(null, { status: 403 });
    if (e instanceof webhooks.PolarWebhookUnknownTypeError)  return new Response(null, { status: 202 });
    throw e;
  }
  await inbox.insert({                                       // ON CONFLICT (webhook_id) DO NOTHING
    webhookId: headers['webhook-id'],
    type: evt.type,
    apiVersion: headers['webhook-api-version'] ?? null,      // (P21) alert if ≠ pinned version
    payload: body,
  });
  wakeWebhookWorker();                                       // XADD to a tiny Redis stream, or pg NOTIFY
  return new Response(null, { status: 202 });
};
```

- 🎯 p99 ≤ 50 ms: one HMAC check plus one primary-key insert.
- Register the **exact final URL** with Polar. Redirects count as failures (P24).
- If the version header doesn't match, store the event anyway and raise an alert. 💡 Rejecting it would only pile up retries.
- The mock signs with Standard Webhooks and hits this same route, so the real SDK verifier is exercised offline (§10.5).

### 9.2 Webhook processor

| Event | Action |
|---|---|
| `customer.state_changed` | D8 = C. Map the payload to `billing.state` (`version++`), then `set_entitlements.lua`. `SET bl:dirty:<sid> NX EX 5`; if set, enqueue `refresh_state`. |
| `order.created` / `order.paid` (meter-cycle `billing_reason`) | Period rollover (§9.8). Record the order for audit. |
| `benefit_grant.created` / `cycled` / `revoked` (credits) | Recompute the effective limit and update `l:<meter>` in the current period hash. |
| `subscription.*` | Status changes also arrive via `customer.state_changed` (P10). Use these for audit and notifications only. |
| `customer.created` / `updated` / `deleted` | Link or unlink `polar_customer_id`. A delete disables billing for the subject. |
| `checkout.updated` | Optional: show "payment processing" sooner. Entitlements still wait for state. |
| anything else | Store and acknowledge. |

Each handler is idempotent and keyed by `webhook_id` + `subject_id` + `version`. Failures back off exponentially. After N attempts the row moves to a dead-letter view, with an alert.

### 9.3 Usage drain (Redis → Postgres)

- Loop: `XREADGROUP … CLAIM` (§7.6) → the drain SQL (§6.2) in one transaction → `XACK`.
- `recorded_at` comes from the stream entry id (milliseconds), so a replay always yields the same `(id, recorded_at)` and conflicts harmlessly. All timestamps for a shard come from the Redis server's clock 💡.
- 🎯 Drain cadence ≤ 250 ms. 🎯 Stream length alert at 100 000 entries per shard, meaning Postgres is falling behind.

### 9.4 Usage ship (Postgres → Polar)

```ts
for (;;) {
  const batch = await db.claimShipBatch(cfg.batchSize);           // §6.2
  if (!batch) { await sleep(cfg.idleMs); continue; }
  await budget.take('ingest');                                    // §9.6
  try {
    const r = await provider.ingestEvents(batch.events.map(toProviderEvent));
    await db.markBatchAccepted(batch.id, r);                      // stores inserted/duplicates
    if (r.inserted + r.duplicates !== batch.events.length) alert('ingest_count_mismatch', batch.id);
  } catch (e) {
    await db.scheduleBatchRetry(batch.id, retryDelay(e));         // honour Retry-After on 429 (P19)
  }
}

const toProviderEvent = (e: LedgerRow) => ({
  name: meters.get(e.meter_key).event_name,
  externalCustomerId: e.subject_id,
  externalId: e.id,                         // dedup key (P4, P6): retries are safe
  timestamp: e.recorded_at.toISOString(),   // display only; billing uses receipt time (P3)
  metadata: { [meters.get(e.meter_key).quantity_key]: Number(e.units), ...e.metadata },
});
```

- Batches marked `sending` are retried with the **same** `external_id`s, so a crash mid-call can't double-bill (P6).
- 🎯 Flush when the batch is full or 1 s has passed. Flush on `SIGTERM`. Ship lag p99 ≤ 5 s, because billing period is decided by receipt time (P3).
- Default `batchSize` 🎯 500. ⚠️ The real maximum is undocumented (P6).

### 9.5 Reconciler

1. Page through `listCustomerMeters` sorted `-modified_at`, `limit` 100 (P9). Stop once `modified_at` is older than the last watermark.
2. For each customer meter, compare `consumed_units` with local `usage_counter.consumed` for that period, allowing for unshipped in-flight rows. Store `credited` and `provider_consumed`.
3. If `credited` changed, update `l:<meter>` in the period hash and bump `billing.state.version`.
4. If drift exceeds tolerance (🎯 0.5% or 10 units after ship lag), emit a metric and an alert. **Never "fix" Polar by re-sending events**; events are immutable (P2), so investigate instead.
5. **Provisioning sweep:** subjects with `provisioned_at IS NULL` and older than 1 minute get a `provision_customer` job. This closes the after-hook crash gap (B3).
6. **Staleness sweep:** active subjects whose `synced_at` is older than 🎯 6 h get a budgeted `refresh_state`.

### 9.6 Polar API budget

🧮 This splits production's 500 req/min (P19). The mock enforces the same budget, so regressions show up locally.

| Bucket | Share | req/min | What it buys |
|---|---|---|---|
| Request path (checkout, portal) | 15% | 75 | Reserved: background work can never starve it |
| Ingest | 50% | 250 | At 500 events per batch: 125 000 events/min ceiling (⚠️ if Polar accepts 500 per batch) |
| State refresh (D8 confirm) | 20% | 100 | 100 subjects/min under churn |
| Reconciler | 10% | 50 | 5 000 customer-meter rows/min at 100 per page |
| Headroom | 5% | 25 | Retries, provisioning |

### 9.7 Provisioner

- `provision_customer`: `createCustomer({ externalId: sid, email, name })`.
- On an "already exists" conflict, look the customer up by external id and link it. ⚠️ Conflict error shape (§18).
- Under D2 = B, nothing ships for a subject until `provisioned_at` is set.
- `delete_customer` runs when a Better Auth user is deleted, from a `user.delete.after` hook ✅ [S20].

### 9.8 Period rollover

- Usage hashes are keyed by meter-period start. A new period's hash hydrates lazily on the first `COLD`, with consumed = 0 and the limit taken from the credits granted for that period (P12).
- Triggers: meter-cycle `order.created`/`order.paid` (P13) and credit `benefit_grant.cycled` (the event exists ✅ [S11]; ⚠️ confirm it fires at meter-period end). Once the boundary passes, the reconciler can also infer the rollover.
- Old period hashes live until period end + 7 d, for late reconciliation.
- 💡 **Boundary skew:** an event recorded locally just before the boundary but received by Polar just after it lands in the next Polar period (P3). The reconciler allows one ship-lag window of tolerance at boundaries.

---

## 10. The mock Polar layer

### 10.1 Goals

1. **Offline:** no network, no Polar account.
2. **Deterministic:** an injectable clock and seeded ids.
3. **Contract-faithful:** reproduces every verified behaviour in §3.1–3.2 that this design relies on.
4. **Hostile on demand:** fault injection for latency, errors, 429s, duplicates and reordering.
5. **Zero production footprint:** it can't load in a production build.

### 10.2 The port

```ts
// $lib/server/billing/provider/port.ts — our domain types; adapters map to and from Polar
export interface BillingProvider {
  createCustomer(i: { externalId: string; email: string; name?: string | null }): Promise<{ providerCustomerId: string }>;
  getCustomerState(externalId: string): Promise<ProviderCustomerState>;
  ingestEvents(events: ProviderUsageEvent[]): Promise<{ inserted: number; duplicates: number }>;
  listCustomerMeters(q: { page: number; limit: number }): Promise<{ items: ProviderCustomerMeter[]; maxPage: number }>; // sorted -modified_at
  createCheckoutSession(i: { externalCustomerId: string; productIds: string[]; successUrl: string; returnUrl?: string }): Promise<{ id: string; url: string; expiresAt: string }>;
  createPortalSession(externalCustomerId: string): Promise<{ url: string }>;
  deleteCustomer(externalId: string): Promise<void>;
}

export interface ProviderCustomerMeter {
  meterId: string; externalCustomerId: string;
  consumedUnits: number; creditedUnits: number; balance: number;   // P9
  modifiedAt: string | null;
}
```

**PolarProvider** builds one core client and binds only the functions it uses, for tree-shaking ✅ [S14]:

```ts
import { createPolarCore } from '@polar-sh/sdk/2026-10';
// Polar documents per-function imports like '@polar-sh/sdk/2026-04/services/customers' [S14].
// ⚠️ Confirm the 2026-10 equivalents in the installed SDK (§18).
const core = createPolarCore({ accessToken: env.POLAR_ACCESS_TOKEN });
```

### 10.3 Components

| Component | Responsibility |
|---|---|
| **Store** | Postgres schema `polar_mock`: customers, products, prices, meters, events, credit grants, subscriptions, orders, checkouts, webhook endpoints, deliveries. It is shared by the app and worker processes (D10 = B) and can be inspected with SQL. Unit tests use an in-memory store behind the same repository interface. |
| **Clock** | Injectable. Moved by a dev endpoint (`POST /__mock/polar/clock/advance`) or by tests. |
| **Meter engine** | Filters and aggregations exactly as P7. |
| **Billing engine** | Unit, volume and graduated pricing, plus cap (P11). Meter cycles, resets and credit grants (P12, P16). Past-due pauses (P14). Payment retries (P15). |
| **API facade** | Implements `BillingProvider`. Validates like Polar (P4, P5 → 422). Enforces the rate limit (P19 → 429 + `Retry-After`). |
| **Webhook emitter** | Outbox-driven delivery with Polar's semantics (§10.5). |
| **Dev pages** | `/__mock/polar/checkout/[id]` (Pay / Fail / Expire), `/__mock/polar/portal/[token]`, `/__mock/polar/console` (clock, faults, state). |

### 10.4 Behavioural spec and verified test vectors

Each line is a required mock test.

- **Aggregation vector** ✅ [S6]: events with units 10, 20, 30, 30 → Count 4, Sum 90, Average 22.5, Min 10, Max 30, Unique 3.
- **Pricing vector** ✅ [S7]: tiers ≤ 1 000 at $0.10 and > 1 000 at $0.08; 1 400 units → volume **$112**, graduated **$132**. 🧮 Volume: 1 400 × 0.08. Graduated: 1 000 × 0.10 + 400 × 0.08.
- **Filter value parsing:** number, then boolean, then string ✅ [S6].
- **Ingest:** deduplicates by `external_id` and reports `inserted` and `duplicates` ✅ [S5]. Provides no update or delete endpoint ✅ [S4]. Validates name ≤ 128 chars, metadata ≤ 50 pairs, keys ≤ 40 chars, string values 1–500 chars, and value types, returning 422 otherwise ✅ [S5].
- **Period attribution:** by the mock clock's receipt time, not by `timestamp` ✅ [S4].
- **Balance:** `balance = credited − consumed` ✅ [S10]. Credits are used before overage; non-rollover credits before rollover credits; API rollover defaults to `false` ✅ [S8].
- **Meter-period end:** invoice usage as a separate order, reset meters and re-grant credits, even with zero usage ✅ [S7]. Emit `order.created` + `order.paid` with a meter-cycle `billing_reason`, and no `subscription.cycled` ✅ [S7].
- **Past due:** pause the meter cycle and keep recording. Invoice accrued usage on recovery ✅ [S7]. Grant no credits ✅ [S8].
- **Failed meter-cycle orders:** retry at +2, +7, +14 and +21 days, keep the subscription active, and void the order after the last failure ✅ [S7].
- **Cap:** charge the cap amount once usage exceeds it ✅ [S7].
- **Checkout:** `external_customer_id` links or creates the customer. `{CHECKOUT_ID}` is substituted in `success_url`. Status is one of open, expired, confirmed, succeeded, failed ✅ [S16].
- **`customer.state_changed`:** emitted only on customer, subscription and benefit changes, never on usage ✅ [S9][S11].
- **Rate limit:** default 500 rpm, configurable. Over the limit → 429 + `Retry-After` ✅ [S2].

### 10.5 Webhook emitter (Standard Webhooks)

```ts
import { createHmac, randomBytes } from 'node:crypto';

export const newWebhookSecret = () => `whsec_${randomBytes(32).toString('base64')}`;

// Signed content is `${id}.${timestamp}.${body}`; the key is the base64-decoded
// secret with the `whsec_` prefix removed; the header value is `v1,<base64 sig>` [S45].
export function signStandardWebhook(secret: string, id: string, tsSec: number, body: string) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${tsSec}.${body}`).digest('base64');
  return {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': String(tsSec),
    'webhook-signature': `v1,${sig}`,
    'webhook-api-version': '2026-10',          // (P21)
  };
}
```

Delivery semantics copied from Polar ✅ [S1]:

- 10 s timeout.
- Up to 10 attempts with exponential backoff.
- 3xx counts as a failure.
- The endpoint is disabled after 10 consecutive failed events. Re-enable it from the mock console.

Payload bodies come from committed fixtures (§10.8), so field names match reality.

⚠️ That the SDK's `validateEvent` accepts a mock-generated `whsec_` secret is expected, because new secrets follow Standard Webhooks (P26). The contract suite asserts it (§16).

### 10.6 Fault-injection knobs

| Knob | Default | Exercises |
|---|---|---|
| `api.latency_ms` (p50 / p99) | 0 / 0 | Timeouts, budgets |
| `api.error_rate_5xx` | 0 | Retry and backoff |
| `api.rpm_limit` | 500 | 429 + `Retry-After` handling |
| `ingest.max_batch` | 1000 (⚠️ placeholder until P6 is known) | 413/422 splitting |
| `webhook.duplicate_p` | 0 | Inbox idempotency |
| `webhook.reorder_window_ms` | 0 | D8 correctness |
| `webhook.delay_ms` | 0 | Activation-page timeouts |
| `webhook.fail_first_attempts` | 0 | Retry path, endpoint disabling |
| `webhook.stale_timestamp` | false | Signature tolerance (Standard Webhooks suggests 5 min [S46]) |
| `checkout.outcome` | `succeed` | Failure and expiry flows |
| `payment.fail_meter_cycle` | false | P15 retry schedule |

### 10.7 Dev-only routes and wiring

- `src/routes/__mock/polar/**` returns 404 unless **both** `dev` is true and `BILLING_PROVIDER=mock`.
- `BILLING_PROVIDER=mock|polar` selects the adapter at startup. The mock loads with dynamic `import()` only in mock mode.
- The emitter posts to `http://localhost:<port>/api/webhooks/polar` with the mock's secret, which is also set as `POLAR_WEBHOOK_SECRET`.

### 10.8 Fixtures and contract tests

- **Fixtures:** run `polar webhook trigger <event> --dry-run --seed <n>` once per event type ✅ [S18], commit the JSON under `mock/fixtures/2026-10/`, and refresh it on each API-version upgrade (§15). This needs the CLI and network once; after that, everything is offline.
- **Contract suite** (`billing-provider.contract.test.ts`) runs against `MockPolarProvider` in CI and, later, `PolarProvider` against sandbox. It asserts:
  - deduplication;
  - balance maths;
  - 422 validation;
  - 429 + `Retry-After`;
  - checkout linking;
  - webhook signature verification through the real `validateEvent`.

### 10.9 Production safety

- Startup refuses `BILLING_PROVIDER=mock` when `NODE_ENV=production`.
- A CI check builds production and asserts the mock module isn't reachable from any route chunk.
- The mock's `polar_mock` schema is never created by production migrations.

---

## 11. SvelteKit SSR and hydration rules

1. **Only billing routes load billing data.** Keep them in a `(app)/billing` group with its own layout; never use the root layout.
2. **Return tiny DTOs.** Server `load` output is devalue-serialized into the page (K2). 🎯 ≤ 1 KB of billing data per page; a test asserts the serialized size.
3. **Stream what isn't critical.** Usage history and charts are returned as un-awaited promises and render with `{#await}`. Each gets a no-op `.catch` (K1).
4. **No waterfalls.** Start independent billing reads before any `await parent()` (K1, [S23]).
5. **Keep billing code server-only:** `src/lib/server/billing/**` on SvelteKit 2, and any `server` directory on SvelteKit 3 (K6, K7). Secrets come from private env modules (`$env/*/private` on 2, `$app/env/private` on 3 ✅ [S25]).
6. **Zero billing JS on non-billing routes.** Embedded checkout (D7 = B) is a dynamic `import('@polar-sh/checkout/embed')` in the click handler ✅ [S17]. Charting libraries are lazy-loaded.
7. **The pricing page** is prerendered if prices only change with a deploy; otherwise it sets `cache-control` in **one** place (K3).
8. **In-app usage meters** read local counters, which are instant and cost no Polar call. Invoices and estimated charges link to the Polar portal (P18).
9. **After activation,** re-run `load` with SvelteKit's invalidation API instead of reloading the whole page.
10. **Tracing:** `tracing.server` only in dev and preview (K5). Production perf runs use `Server-Timing`.
11. **CSRF on SvelteKit 3:** the webhook is a cross-origin, server-to-server JSON `POST`. SvelteKit 3 rejects cross-origin mutative requests without a `Content-Type` (K6), so the mock always sends `application/json`. An integration test confirms the route accepts both the mock and a captured real request (§16).

---

## 12. Performance budgets and measurement

🎯 All targets are ours, for local runs with Redis and Postgres on the same host. CI fails if any regresses by more than 10%.

| Metric | Target | Measured by |
|---|---|---|
| Billing I/O on non-billing routes | 0 Redis calls, 0 provider calls | Instrumented client counters in integration tests |
| Client JS added to non-billing routes | 0 B | Bundle diff in CI |
| Client JS added to billing routes (hosted checkout) | ≤ 5 KB gzip | size-limit |
| `entitlements()` client-side cache hit | No network I/O | Cache hit-ratio metric (🎯 ≥ 95% steady state) |
| `entitlements()` miss | 1 Redis round trip; p99 ≤ 1 ms server time | `Server-Timing: billing;dur=…` |
| `recordUsage()` | Exactly 1 Redis round trip; p99 ≤ 2 ms | `Server-Timing` + load test |
| Webhook ingress | p99 ≤ 50 ms (Polar recommends < 2 s, P24) | Mock emitter timings |
| Record → provider accepted (ship lag) | p99 ≤ 5 s | `recorded_at` vs `ship_batch.accepted_at` |
| Webhook → entitlement visible | p99 ≤ 1 s | `received_at` → Redis write |
| Provider API usage | ≤ 95% of each bucket | Budgeter metrics |
| Consumed drift after reconciliation | 0 beyond in-flight | Reconciler metric |
| Billing DTO in page data | ≤ 1 KB | Unit test on serialized size |

**Load scenarios** (k6 or autocannon, against the mock with faults on):

1. Anonymous pages.
2. Signed-in pages that read entitlements.
3. A metered endpoint at increasing rps.
4. A webhook storm: 1 000/s, 10% duplicates, 2 s reorder window.
5. A Polar 429 storm.
6. Restarting Redis under load.
7. Restarting Postgres under load.
8. Killing the worker mid-batch.

**Instrumentation:**

- `Server-Timing` per request: `billing`, `redis`, `pg`.
- Redis: slowlog and latency monitor.
- Postgres: `pg_stat_statements`, HOT ratio (G6), and `pg_stat_lock` on 19 ✅ [S39].

---

## 13. Failure modes and degradation

| Failure | Detection | Behaviour | Recovery |
|---|---|---|---|
| Polar API down or slow | Ship errors, ship-lag metric | The app is unaffected. Checkout shows a friendly error. | Batches retry with the same `external_id`s (P6). Alert if ship lag > 5 min 🎯. |
| Polar returns 429 | Status code | Wait per `Retry-After` (P19); the token buckets back off. | Automatic. |
| Webhooks failing at our end | 5xx rate on ingress | Polar retries (10 attempts) and disables the endpoint after 10 consecutive failed events (P24). | Alert well before that point. Staleness and reconciliation sweeps cover missed events. Re-enabling is manual (P24). |
| Duplicate webhook | Inbox primary key | Ignored. | — |
| Out-of-order webhook | D8 | The confirm refetch converges state. | Automatic. |
| Redis down | Connection errors | Entitlements fall back to a Postgres primary-key read (circuit breaker). Usage follows `on_redis_down` per meter (D4). | Hydrate counters from `usage_counter` when Redis returns. |
| Redis crash (AOF `everysec`) | Restart | Up to about 1 s of usage may be lost ✅ [S33], under-billing that interval. Stream and counters stay consistent, because both replay from the same AOF. | None needed. |
| Postgres down | Connection errors | The hot path keeps working (Redis). Drain stalls and the stream grows. Webhook ingress returns 5xx, so Polar retries. | Stream-length alert. Drain catches up. |
| Worker crash mid-batch | Pending entries, `sending` batches | `CLAIM` reclaims stream entries (R6); batches retry idempotently. | Automatic. |
| Period-boundary skew | Reconciler | Tolerance window at boundaries (§9.8). | — |
| New event type from Polar | SDK unknown-type error | Ingress returns 202 (P26). | Add a handler at the next version upgrade. |
| API version removed | Calendar (§15) | — | Quarterly upgrade runbook. |

---

## 14. Security and data handling

- **Tokens:** the organization access token is used server-side only and never reaches a browser bundle (P28). Scopes follow least privilege, for example `events:write` for ingest ✅ [S5] and `customer_meters:read` for the reconciler ✅ [S10]. ⚠️ Confirm the scopes for customer, checkout and session endpoints in the API reference.
- **Webhooks:** verify the signature over the **raw** body before parsing (§9.1). Stale timestamps are rejected by the verifier; the Standard Webhooks tolerance is 5 minutes [S46]. Polar publishes source IPs, but the list is changing, with a new IP being added ✅ [S1]. 💡 Treat an IP allowlist as optional defence in depth; the signature is the real control.
- **No client-callable ingestion,** ever (B5).
- **No PII or secrets in event metadata:** events can't be edited or deleted (P2). Use ids, not emails or prompts. For LLM metering, Polar's `_llm` reserved key has an optional `prompt` field ✅ [S5]; 💡 leave it empty unless there's a deliberate reason.
- **User deletion:** enqueue `delete_customer` (§9.7). Document that usage events already ingested into Polar stay there, because they're immutable (P2).
- **Abuse:** rate-limit metered endpoints per subject before `recordUsage`, so a runaway client can't burn credits. `INCREX` (Redis 8.8) fits ✅ [S32]; ⚠️ verify its final syntax.
- **The mock is unreachable in production** (§10.9).

---

## 15. Polar API version lifecycle

- **Pin:** SDK import `@polar-sh/sdk/2026-10`, the webhook endpoint's `api_version` = `2026-10`, and the mock's `webhook-api-version` = `2026-10` (P21, P22).
- 🧮 **Calendar,** from Polar's published schedule (P21): 2026-10 became Current with the October 2026 release. It becomes Deprecated with the January 2027 release and is removed with the April 2027 release. 2027-01 is listed in Polar's docs index today ✅ [S11], consistent with it being Next.
- **Quarterly upgrade runbook:**
  1. Read the changelog.
  2. Bump the import path.
  3. Regenerate fixtures (§10.8).
  4. Run the contract suite against the mock (and sandbox, once used).
  5. Update the webhook endpoint's `api_version`. The change only affects events created afterwards ✅ [S3], so the processor handles both versions for a while. Branch on `webhook_inbox.api_version`.
- **Avoid Next-only features** such as manual credits on 2027-01 (P17) until they're Current.

---

## 16. Testing strategy

| Layer | What | How |
|---|---|---|
| Unit | Meter engine, pricing, credit ordering (§10.4 vectors) | Vitest |
| Scripts | `record_usage`, `hydrate`, `set_entitlements`, reserve/settle | **Real** Redis 8.8 in a container; Redis isn't mocked for scripts |
| SQL | Drain idempotency, ship claim, partition-key PK | Real Postgres 18 and 19 in containers |
| Contract | `BillingProvider` suite | Mock in CI; sandbox later (D9 = C) |
| Integration | Sign-up → provision → usage → limit hit → checkout → webhook → entitlement → cycle end → order webhooks → reset | App + worker + mock |
| Property | Any interleaving of duplicate or reordered webhooks ends at the provider's state | fast-check against the mock emitter |
| Idempotency | Replaying every stream entry and webhook twice leaves the database unchanged | Snapshot diff |
| Chaos | Kill Redis, Postgres or the worker mid-flow | Scenarios 6–8 in §12 |
| Security | Bad signature → 403; unknown type → 202; stale timestamp → 403; CSRF behaviour of the webhook route on SvelteKit 3 | Integration |
| Perf gates | §12 budgets | CI |
| Request-path guard | Every route exercised in tests with the guard set to throw | Integration |

---

## 17. Implementation plan

| Phase | Deliverable | Exit criteria |
|---|---|---|
| **P0 Spike** | Resolve the blocking ⚠️ items in §18: IDMP inside scripts, SDK `2026-10` entrypoint and function paths, `validateEvent` with a mock `whsec_` secret, fixtures via the CLI, PG19 `DO SELECT` syntax | Each item marked ✅ or replaced with its fallback in this document |
| **P1 Port + mock core** | Port, mock store, meter and pricing engines, ingest, customer meters, contract suite | §10.4 vectors pass. Contract suite is green against the mock. |
| **P2 Hot path** | Redis clients, scripts, entitlements, lazy locals, guard, `Server-Timing` | §12 hot-path budgets met under load scenarios 2–3 |
| **P3 Ledger** | Drain, ship, reconciler, budgeter | Idempotency tests pass. Ship lag p99 ≤ 5 s. |
| **P4 Webhooks** | Ingress, processor, emitter with faults | Property test passes. Ingress p99 ≤ 50 ms under scenario 4. |
| **P5 Checkout/portal** | Mock pages, activation UX | End-to-end integration scenario passes |
| **P6 Gates** | Perf and chaos in CI | Scenarios 1–8 automated |
| P7 (later) | Sandbox run, then swap to `polar` | Contract suite green against sandbox |

---

## 18. Unverified items: spike checklist

| # | Item | Why it matters | How to resolve |
|---|---|---|---|
| U1 | Maximum events per ingest request [S5] | Batch size and throughput ceiling (§9.6) | Ask Polar or probe the sandbox |
| U2 | Scope and time window of `external_id` deduplication [S5] | Retry safety over long outages | Sandbox: re-send after 1 h and 1 day |
| U3 | Ingest with an unknown `external_customer_id` | D2 = B safety | Sandbox |
| U4 | Webhook duplicates and ordering (undocumented on Polar's page [S1]; a third-party mirror describes at-least-once delivery [S47]) | Design already assumes both | Keep the assumption |
| U5 | SDK custom base URL or `fetch` injection [S12] | D9 = B | Read the SDK source |
| U6 | Per-function import paths for `2026-10` (documented pattern is for 2026-04 [S14]) | Tree-shaken adapter | Inspect the installed package |
| U7 | `@polar-sh/sdk@1.0.0` pin vs the `/2026-10` import on Polar's Better Auth page [S15] | Install the right version | npm registry |
| U8 | Exact customer-state field names (subscriptions, benefits, meters) [S9] | State mapper | Fixtures (§10.8) |
| U9 | `billing_reason` values for meter-cycle orders [S7] | Rollover trigger | Fixtures |
| U10 | Whether `meter.credited` system events arrive as webhooks [S8] | A cheaper credits signal | Sandbox |
| U11 | `XADD … IDMP` inside a Lua script | `record_usage.lua` | Test on Redis 8.8; else use the `SET NX` fallback (§7.4) |
| U12 | `KEEPREF / DELREF / ACKED` trimming semantics [S30] | Stream trimming | Read the XADD/XTRIM docs and test |
| U13 | Whether `createCustomerOnSignUp` is awaited, and what happens on failure [S15] | Only if D1 = A | Read the plugin source |
| U14 | SvelteKit 3 CSRF behaviour for server-to-server JSON with no `Origin` [S25] | Webhook route | Integration test |
| U15 | PG19 `ON CONFLICT DO SELECT` exact syntax [S39] | §6.3 | PG19 docs |
| U16 | Response field holding the portal URL from customer sessions | §8.5 | Fixture or API reference |
| U17 | Minimum chargeable amount, which Polar doesn't document [S7] | Mock invoice edge cases | Ask Polar |
| U18 | `INCREX` final syntax (changed during the 8.8 RC [S32]) | Optional rate limiter | Command reference |
| U19 | Standard Webhooks spec text (signing verified through implementer docs [S45][S46], not the spec page) | Mock signing | Read standardwebhooks.com |
| U20 | UUIDv7 library choice and monotonicity in Node | Event ids | Pick a library and test ordering |
| U21 | Scopes for customers, checkouts and customer sessions | Least privilege | API reference per endpoint |

---

## 19. Sources

All accessed 2026-11-25. Polar pages are the 2026-10 API version unless noted.

**Polar**
- [S1] Webhook delivery — https://polar.sh/docs/integrate/webhooks/delivery.md
- [S2] API introduction: base URLs, rate limits, pagination, Core vs Customer Portal API — https://polar.sh/docs/api-reference/2026-04/introduction.md
- [S3] API versioning — https://polar.sh/docs/api-reference/2026-10/versioning.md
- [S4] Event ingestion — https://polar.sh/docs/features/usage-based-billing/event-ingestion.md
- [S5] Ingest events (API reference) — https://polar.sh/docs/api-reference/2026-10/events/ingest-events.md
- [S6] Meters — https://polar.sh/docs/features/usage-based-billing/meters.md
- [S7] Usage-based pricing — https://polar.sh/docs/features/usage-based-billing/billing.md
- [S8] Credits — https://polar.sh/docs/features/usage-based-billing/credits.md
- [S9] Customer state — https://polar.sh/docs/integrate/customer-state.md
- [S10] List customer meters — https://polar.sh/docs/api-reference/2026-10/customer_meters/list-customer-meters.md
- [S11] API index for 2026-10 (endpoints, webhook catalogue) — https://polar.sh/docs/_llms/api/2026-10.txt ; docs index — https://polar.sh/docs/llms.txt
- [S12] TypeScript SDK — https://polar.sh/docs/integrate/sdk/typescript.md
- [S13] `polar-integration` skill (polarsource/skills): deprecated adapters, Node 22 — https://skills.sh/polarsource/skills/polar-integration
- [S14] Polar TypeScript SDK agent skill (`createPolarCore`, tree-shaking), mirrored from polarsource/polar — https://skillsmp.com/creators/polarsource/polar/sdk-typescript-agents-skills-polar-typescript-sdk
- [S15] Better Auth adapter — https://polar.sh/docs/integrate/sdk/adapters/better-auth.md
- [S16] Create checkout session — https://polar.sh/docs/api-reference/2026-10/checkouts/create-checkout-session.md
- [S17] Embedded checkout — https://polar.sh/docs/features/checkout/embed.md
- [S18] CLI: webhooks on your machine — https://polar.sh/docs/integrate/cli/webhooks.md

**Better Auth**
- [S19] Session management — https://better-auth.com/docs/concepts/session-management
- [S20] Database: secondary storage, database hooks — https://better-auth.com/docs/concepts/database
- [S21] SvelteKit integration — https://better-auth.com/docs/integrations/svelte-kit

**SvelteKit**
- [S22] Configuration — https://svelte.dev/docs/kit/configuration
- [S23] Loading data — https://svelte.dev/docs/kit/load
- [S24] Hooks — https://svelte.dev/docs/kit/hooks
- [S25] Migrating to SvelteKit 3 — https://svelte.dev/docs/kit/migrating-to-sveltekit-3
- [S26] SvelteKit 3 release post — https://svelte.dev/blog/sveltekit-3-is-here ; release date — https://www.netlify.com/changelog/2026-10-01-sveltekit-3/

**Redis**
- [S27] Redis 8.4 GA (SET IFEQ, DELEX, MSETEX) — https://redis.io/blog/redis-8-4-open-source-ga/ ; 8.4 commands — https://redis.io/docs/latest/commands/redis-8-4-commands/
- [S28] XREADGROUP CLAIM (8.4) — https://redis.io/blog/single-shot-reliable-consumers-with-xreadgroup-claim-in-redis-84/
- [S29] What's new in Redis 8.6 — https://redis.io/docs/latest/develop/whats-new/8-6/
- [S30] XADD — https://redis.io/docs/latest/commands/xadd/
- [S31] Streams idempotency — https://redis.io/docs/latest/develop/data-types/streams/idempotency/
- [S32] What's new in Redis 8.8 — https://redis.io/docs/latest/develop/whats-new/8-8/ ; 8.8 release notes — https://redis.io/docs/latest/operate/oss_and_stack/stack-with-enterprise/release-notes/redisce/redisos-8.8-release-notes/
- [S33] Persistence — https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/
- [S34] Node.js client guide — https://redis.io/docs/latest/develop/clients/nodejs/
- [S35] Client-side caching — https://redis.io/docs/latest/develop/clients/client-side-caching/
- [S36] node-redis connect (RESP3, `clientSideCache`) — https://redis.io/docs/latest/develop/clients/nodejs/connect/
- [S37] Scripting with Lua (EVAL intro) — https://redis.io/docs/latest/develop/programmability/eval-intro/
- [S38] Lua API (data type conversion) — https://redis.io/docs/latest/develop/programmability/lua-api/

**PostgreSQL**
- [S39] PostgreSQL 19 released — https://postgresql.org/about/news/postgresql-19-released-3449
- [S40] PostgreSQL 18 released (uuidv7) — https://postgresql.org/about/news/postgresql-18-released-3142/
- [S41] Asynchronous commit — https://www.postgresql.org/docs/current/wal-async-commit.html
- [S42] WAL configuration (`wal_writer_delay` default) — https://www.postgresql.org/docs/current/runtime-config-wal.html
- [S43] Table partitioning — https://www.postgresql.org/docs/current/ddl-partitioning.html
- [S44] Heap-only tuples (HOT) — https://www.postgresql.org/docs/current/storage-hot.html

**Secondary sources** (used only where the primary spec wasn't fetched)
- [S45] Standard Webhooks signing, as implemented in Zapier's docs — https://docs.zapier.com/white-label/connection-webhooks/verify-signatures
- [S46] Standard Webhooks timestamp tolerance (Svix glossary) — https://www.svix.com/resources/glossary/webhook-signature/
- [S47] Mirror of Polar docs describing at-least-once delivery (third-party) — https://www.mintlify.com/polarsource/polar/integrate/webhooks/delivery
