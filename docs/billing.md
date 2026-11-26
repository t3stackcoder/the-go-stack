# Billing

Usage billing through Polar: what was built, what was decided and why, what was left out, and what has still to be checked against a real Polar. The code's own comments say how each part works. This says what the parts are and what is not there.

It was written on 2026-11-25, after the build and a review of it, against the fake Polar only. The design it was built from, with its research and sources, is `polar-usage-billing-plan.md` in commit `618592f`. Much of that design was not built as drafted, and this document is the one to go by.

## What was built

| Piece | Where |
|---|---|
| Two tables, `billing.state` and `billing.usage_event` | `src/lib/server/db/billing-schema.ts`, migration `drizzle/0003_billing.sql` |
| Redis keys and the three Lua scripts | `src/lib/server/billing/redis.ts` |
| Entitlements and usage recording (the request side) | `src/lib/server/billing/service.ts`, exposed to routes only through `index.ts` |
| Polar adapter over the real SDK (`@polar-sh/sdk/2026-10`) | `src/lib/server/billing/polar/` (`checkout.ts` for requests, `sync.ts` for the worker) |
| Webhook ingress | `src/routes/api/webhooks/polar/+server.ts`, `src/lib/server/billing/webhook.ts` |
| Worker: drain, ship, sync, removal of deleted customers, rate budget, lock | `src/lib/server/billing/worker/`, started by `pnpm billing:worker` (`scripts/billing-worker.js`) and by `pnpm launch` |
| Fake Polar: API subset, hosted checkout and portal pages, signed webhooks | `scripts/mock-polar/server.js` |
| Billing pages | `src/routes/billing/` |
| Catalogue (one product, one meter) and configuration | `src/lib/server/billing/catalogue.ts`, `config.ts`, `src/env.ts`, `.env.example` |

To run it: `pnpm launch` starts everything. In development, `pnpm dev` in one terminal and `pnpm billing:worker` in another. The fake Polar listens at `POLAR_MOCK_URL` while that is set.

## Decisions

| Question | Decided | Note |
|---|---|---|
| How to integrate with Polar | The SDK directly | No Better Auth plugin, and no change to the auth configuration. |
| When the Polar customer is created | At first checkout | Usage is only allowed with a subscription, and checkout creates the customer, so nothing can be sent before Polar knows them. Nothing provisions customers ahead of time. |
| Who is billed | A user | `subject_id` is opaque. There is no `kind` column: billing an organisation later is one `ALTER TABLE`. |
| What happens at the limit | Stopped at the period's credits plus an overage | `overage` per meter in the catalogue (100 units for `api_calls`). Polar never stops anybody; this site does. |
| What happens when a payment is past due | Blocked | Polar's customer state does not list a past-due subscription, and that state is the only source. |
| What happens when Redis is down | Usage is refused; entitlements are read from Postgres | Allowing what cannot be counted is how a limit stops being one. |
| Where a use is recorded first | Redis | One script checks, counts and queues. The worker writes the ledger a moment later. |
| How entitlements are read | One hash per person | Entitlements and counters share it, so recording is one round trip and reading is one. |
| Checkout | Polar's hosted page, by redirect | |
| How a webhook is applied | It marks the customer, and the worker asks Polar for the whole state | A webhook's payload is never acted on, so duplicates and wrong order cannot matter. |
| What stands in for Polar locally | An HTTP fake driven by the real SDK | Its own tests are the contract. |
| Where the worker runs | A process of its own | Loaded through Vite like `scripts/seed.js`. One at a time, held by a Postgres advisory lock. |

## Where the build left the first design

- **Two tables, not eight.** A webhook is not stored or interpreted. It marks `billing.state.dirty_at` in one statement, and the worker refetches. That removes the inbox, the outbox, the per-event handlers and every question about duplicates and ordering. Meter configuration is code (`catalogue.ts`), not a table. A period's count is a `SUM` over the ledger, asked only when Redis has lost it. What has been shipped is two columns on the ledger row.
- **The usage script as designed had a defect.** It checked the limit before recognising a duplicate, so a retry of an event that had used the last of an allowance was answered DENY for work that was counted. The script now looks for the event's id first, in a key that lives five minutes, and only then checks the limit. Redis's own `XADD … IDMP` cannot do this, because it can only report a repeat on the append.
- **One hash per person** (`bl:sub:<id>`) and one stream (`bl:usage`). No sharding by hash tag: there is no cluster, and Redis's state can be rebuilt from Postgres when there is.
- **Units are whole numbers.** No float handling in Lua, Postgres or JavaScript.
- **No runtime guard on what a request may call.** The two calls a request may make are in one file and the worker's calls in another, and `boundary.test.ts` walks the import graph and fails if anything that serves a request can reach the worker's side.
- **No `locals.billing`, no change to `hooks.server.ts`.** Routes import the service; a route that does not costs nothing.
- **No session cookie cache and no Redis storage for Better Auth.** The auth configuration already decides against a cookie cache, in writing, so that a revoked session stops at once. Billing needs neither.
- **The fake runs on the host, inside the worker process,** because a container on the development machine could not reach a server on the host on any address. It infers where to send webhooks from the last checkout's success address (loopback only) and keeps its state in `node_modules/.cache/mock-polar/state.json`.
- **The fake is not a billing simulator.** No pricing tiers, caps or invoices: the app reads none of them.
- **Period.** The local period is the subscription's current period, from customer state. A product with a separate, shorter meter cycle is not supported: state does not say when that cycle turns.
- **Reconciliation** is a comparison made on each state refresh between Polar's `consumed_units` and what the ledger has shipped for the period. A difference is logged. Nothing is ever re-sent to make the numbers meet.
- **The fake is not refused in production.** `pnpm launch` runs the production build against it. What guards it is the rule `OAUTH_MOCK_URL` already has: `POLAR_MOCK_URL` is only taken if it names this machine.

## What was measured before building

On what `compose.yaml` runs: Redis 8.10.3, PostgreSQL 19.0, Node 24.18, `@polar-sh/sdk` 1.3.3.

- The SDK takes a `baseUrl`, has no runtime dependencies and does not validate response bodies, which is what made an HTTP-level fake possible. Version 1.3.3 exports `./2026-10` and `./2026-10/services/*`, with functions named `<verb><Service>` (`getStateExternalCustomers`, `ingestEvents`, `createCheckouts`). It needs Node 24 or later.
- From the SDK's types: customer state has `active_subscriptions` (status `active` or `trialing` only), `granted_benefits` and `active_meters` (`meter_id`, `consumed_units`, `credited_units`, `balance`). A past-due subscription is simply absent. The portal's address is `customer_portal_url` on the customer session.
- `XADD … IDMP` works inside Lua, and a repeat returns the original id, but it is per producer: the same id from a second producer was added again. It is not used. `XREADGROUP … CLAIM` works as the drain uses it.
- The fake's webhook signing is tested against the example in the Standard Webhooks specification and verified by the SDK's own `validateEvent`, which also rejects timestamps more than five minutes off.
- Against the built server under `pnpm launch`: a signed JSON webhook with no `Origin` header is accepted (202), and the worker had synced the row two seconds later. A tampered body is refused (403). This was checked by hand; the route has no automated test of its own.
- `crypto.randomUUIDv7` is built into Node 24.
- How many events Polar takes in one ingest request is undocumented. The SDK's own Outpost client sends up to 1,000, so the ship batch of 500 is inside what Polar's own code relies on.

## What the review measured

On a production build in Chrome against the fake:

| | |
|---|---|
| `/billing` rendered on the server | 19–29 ms warm (`/account`: 41–48 ms) |
| Layout shift | 0 on every load, and through a refused use, a counted use, the waiting page stopping, and paying |
| Hydration | No warning from Svelte's development build. 6 writes inside `<main>` on `/billing` (`/account`: 24), none of which changes what is shown |
| The waiting page | One request of 160 bytes a second, stopped after half a minute. Without JavaScript it refreshes itself and stops the same |
| Pay to the billing page | 1.5 s |
| A counted use, with the reload of the page's data | about 0.1 s |
| JavaScript added to every other page | 113–160 bytes compressed, for the Billing link in the account menu. The design's target was none |
| JavaScript on `/billing` over what every page has | about 5.6 KB compressed, of which 3.5 KB is the account pages' file (`vite.config.ts` says why it is left). The design's target was 5 KB |

Firefox and Safari were not measured, nor a slow connection.

## What the review closed

Each has a test that fails without the change, but for two that have none: the trimming of a pasted value, and the recording of the portal's 422.

| What was wrong | What it is now |
|---|---|
| A buyer whose webhooks never arrived was never asked about: the worker asked Polar of its own accord only about people who subscribed already. They had paid and were refused. | The page a buyer comes back to marks their row, as a webhook does (`requestSync` in `service.ts`), at most once in five seconds for a person. |
| The four values Polar gives were each needed only where used, so a site with no webhook secret could sell a subscription it would never hear about. | All four are needed together (`config.ts`). Without them no checkout can be started, and the error names every one that is missing. Each is trimmed of the space a paste can bring (`src/env.ts`). |
| The sync said a row was up to date before Redis had it. A failure in between left a renewed subscriber refused against the old period for up to six hours. | The row, then Redis, and only then that it was asked about. The first write marks the row, so a failure anywhere leaves it to be done again (`worker/sync.ts`). |
| With Redis down, every billing read waited a second before going to Postgres, and left a listener behind. | Once a try to connect has failed, a request fails at once, until Redis is back. Requests that arrive while the first connection is being made share one wait (`redis.ts`). It is not a circuit breaker, and nothing more elaborate than that. |
| A person's hash in Redis ended a week after their subscription last changed, whatever they did. Its counts were then added up again without what was waiting in the stream. | Each counted use and each write by the worker keeps it another week. |
| Requests that found the same hash missing each asked Postgres for the same sum. | One asks, in a process, and the rest wait for it. There is no lock between processes. |
| An event id of a caller's own could be anything, and was remembered for everybody. One that was not a UUID stopped the ledger being written. One reused by another person was answered as counted already. | It has to be a UUID, it is remembered for the one person, and the drain treats an entry that is not one as unreadable. |
| The worker's budget let it spend its minute's share twice in one minute after a quiet spell, which could refuse a person pressing Upgrade. | It can save up 5% of the limit and earns 80% a minute, so the most in any minute is 85%, and requests keep 15%. |
| One person Polar could not be asked about stopped everyone marked after them. | Each is caught alone and recorded, and waits fifteen seconds to be tried again. A rate limit still ends the pass. |
| A customer was removed from Polar while some of their use had yet to be sent. | Removed only once none is. |
| The worker ended for good when its connection to Postgres failed, and nothing started it again. | It stops its jobs, takes the lock again when it can, and starts them again (`worker/lock.ts`). A Postgres that is not there at the start is waited for. |
| Stopping the worker had no bound: the last drain never ended while the site was busy, and a pause Polar had asked for was sat out. | Two seconds of draining, five of shipping, and a stop cuts a pause short. |
| A Retry-After that was not a number switched pausing off for good. | Anything that is not a number of seconds is a minute. |
| The sync's question read every row of `billing.state` twice a second. | Marked rows are found from their index on every pass. The question that has to read every row is put once a minute. |
| The portal's 422 was taken in silence for "no customer". | Recorded, since the other thing it can mean is this site's own mistake. |

Left as it is, on purpose: **shipping stops on a refusal that is not a 422.** Setting such events aside would throw away everybody's usage on a bad token. Stopping, loudly, is the safe failure.

## Not built

| Item | Why |
|---|---|
| Reserve and settle, for a use whose cost is not known until it is done | No variable-cost meter exists. |
| Event metadata beyond the quantity | Nothing uses it. It also removes the question of personal data in events that cannot be changed. |
| Ledger partitioning | drizzle-kit cannot express it and there is no data to retire yet. Converting is a migration when retention becomes real. |
| Load, chaos and performance gates in CI | The round-trip budgets are asserted in tests (one command per record, one per read). Load scenarios and chaos runs are not automated. |
| A bundle-size check in CI | The sizes above were measured by hand. |
| `Server-Timing` entries for billing | The existing `render` timing covers the page. Add them when a performance run needs them. |
| An alert on the length of the usage stream | Nothing says so when the worker has stopped and usage is piling up in Redis. |
| Rate limiting of metered endpoints for each person | No metered endpoint of the product's own exists yet to protect. |
| A built worker for deployment | Deployment is out of scope. The worker runs through Vite, as `seed.js` does. |
| Polar Outpost | SDK 1.x ships Redis-backed local metering with its own sync protocol against `/v1/outpost/*`. Not adopted: a local fake would have to imitate a private protocol, it gives balance reads and not an atomic check-and-count, and it needs `ioredis` and OpenTelemetry. Worth evaluating at the first real run as a replacement for ship and reconciliation. |

## Still open

- A buyer who never comes back to the site after paying, and whose every webhook is lost, is still not asked about. Any later webhook about them puts it right.
- A command sent to Redis and never answered (a connection that is dead and does not know it) has no time limit of this code's own. A read waits on it.
- Upgrade checks for an existing subscription in Redis. In the second or so between paying and the subscription arriving, a second tab can start a second checkout.
- Twenty deletions that Polar refuses every time would hold back the removals behind them. Sync has a way round its own; removal has not.
- `usage_event_period` does not hold `units`, so adding up a period reads each of its rows from the table.
- The fake Polar and its tests are about 2,900 lines, more than the billing code they stand in for.

## To check on the first run against a real Polar

Nothing here has been run against Polar itself, sandbox or production.

- **The hosts of Polar's checkout and portal addresses.** The content security policy names `polar.sh` and `sandbox.polar.sh` as a guess (`vite.config.ts`); Polar's reference gives no example. Read the host off the address the first sandbox checkout hands back, and correct the policy if it differs. A button that does nothing when pressed, in Chromium or Safari, is what a wrong host looks like.
- **What Polar answers when a customer session is asked for an unknown customer.** The code takes a 404 or a 422 to mean "no customer", and records the 422.
- **Whether deleting a customer by external id needs `anonymize`,** and what it does to their subscriptions.
- **How long Polar remembers an event's `external_id`.** Sending a batch twice is safe only while it does. A resend after a long outage relies on it.
- **What Polar answers to ingest for an external customer id it does not know.** It decides whether shipping stops or the event is set aside.
- **Which scopes the access token needs.**
- **Polar's rate limits.** The budget assumes 500 requests a minute in production and 100 in the sandbox, read from the 2026-04 version of Polar's page on them.
