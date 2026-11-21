# The case for SvelteKit

A site that argues whether SvelteKit is worth adopting, built with SvelteKit so that the argument
can be checked. Every demo runs, every number is measured in the visitor's browser, every code
sample is imported from the file that runs, and one chapter argues against.

SvelteKit 3, Svelte 5, Tailwind CSS 4, TypeScript, the Node adapter, pnpm.

## Running it

```sh
pnpm install
pnpm dev                     # development server
pnpm build && pnpm start     # production build, then the production server on port 3000
```

Judge performance on the production build. The development server sends unbundled modules, and
it re-inserts the stylesheet after load, which can show as a tiny layout shift in the on-page
readout that the production build does not have.

`pnpm start` runs `server.js`, which starts the server the Node adapter built and adds the
security headers. Running `node build` directly serves the same site without them.

## Checking it

```sh
pnpm check       # types
pnpm lint        # formatting and lint rules
pnpm test:unit   # unit tests, re-run on change
pnpm test:e2e    # browser tests (first run: pnpm exec playwright install chromium firefox webkit)
pnpm test        # unit, then browser
```

The browser tests start two servers themselves: the production build on port 4173 and the
development server on port 5173. Both ports must be free. `.github/workflows/ci.yml` runs all of
the above on every push and pull request.

The browser tests run as four projects:

| Project       | What it runs                                                                             |
| ------------- | ---------------------------------------------------------------------------------------- |
| `chromium`    | Everything, against the production build. This is the reference.                         |
| `firefox`     | Everything not tagged `@chromium-only`, against the production build.                    |
| `webkit`      | The same as `firefox`.                                                                   |
| `development` | The hydration and reserved-box diagnostics, in Chromium, against the development server. |

Tests tagged `@chromium-only` need something only Chromium has: the browser's own report of
layout shift, and processor throttling. So a green run in Firefox or WebKit says nothing about
layout shift. It says that what can be measured in any browser holds there too: where every
element is before and after hydration and navigation, which font is showing, and how the pages
behave.

## Where things are

| Path                        | What it is                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/app.html`              | The document shell, with the inline script that settles the theme and the font before first paint.   |
| `src/error.html`            | The last-resort error page, sent when the app's own error page cannot be rendered.                   |
| `src/env.ts`                | The environment variables the app reads, typed and checked when the server starts.                   |
| `src/hooks.server.ts`       | Compression for pages rendered per request, and the record of every server error.                    |
| `src/hooks.client.ts`       | Reports errors that happen in the browser to the server.                                             |
| `src/routes/layout.css`     | Design tokens (OKLCH, a light and a dark value each), fonts, and shared component styles.            |
| `src/routes/+layout.svelte` | The site frame: skip link, navigation, font preload, page transitions, the readout.                  |
| `src/routes/+error.svelte`  | The error page, shown inside the site frame for a missing page or a failure.                         |
| `src/lib/stable/`           | The layer that keeps pages from moving: the hydration flag, reserved boxes, and the image component. |
| `src/lib/hud/`              | The on-page readout and the measurements behind it.                                                  |
| `src/lib/ui/`               | Shared pieces of a chapter page: frame, demo box, code block.                                        |
| `src/lib/demo/`             | The demos, one folder per chapter.                                                                   |
| `src/lib/site/chapters.ts`  | The list of chapters. Navigation, home page and "next" links come from it.                           |
| `plugins/highlight.ts`      | Lets a page import the highlighted source of a real file with `?highlight`.                          |
| `server.js`                 | The production entry point: the built server, plus security headers on every response.               |
| `vite.config.ts`            | Build configuration, including the content security policy.                                          |
| `e2e/`                      | Browser tests. `stability.e2e.ts` is the audit; `support.ts` holds its tools.                        |
| `e2e/budgets.e2e.ts`        | The weight each page is allowed, in bytes and requests.                                              |
| `Dockerfile`                | The production container image.                                                                      |

## Rules for a new page

The stability audit finds pages by reading `src/routes`, so a new page is audited as soon as its
file exists. To pass, a page has to follow three rules:

1. **Render the same thing on the server and in the browser's first render.** Nothing in a
   template may depend on `window`, the clock, randomness, or the visitor's locale. Anything only
   the browser knows goes through `ClientOnly`, or waits for `hydration.done`.
2. **Give late content its space first.** Streamed data goes in `Streamed`, browser-only content in
   `ClientOnly`, and the box's own classes fix its height (`h-48`, `aspect-video`). In development
   the console warns if a reserved box changes height. An image goes through `Image`
   (`src/lib/stable/Image.svelte`), which sizes its box from its dimensions; the lint rule rejects
   an `<img>` written anywhere else.
3. **Do not let changing text push its neighbours.** Use fixed columns or widths, `tabular-nums`,
   and left alignment for anything that updates while the page is open.

Colours are semantic tokens only (`bg-surface`, `text-ink-muted`, `border-line`); Tailwind's
default palette is removed so that every colour has a light and a dark value, and a unit test
(`src/routes/layout.spec.ts`) holds the text tokens to their contrast ratios. For the rare thing
that differs between themes and is not a colour, `dark:` follows the same theme as the tokens.
Pages are prerendered unless they export `prerender = false`.

A new page also needs two entries in the tests:

- **A budget.** `e2e/budgets.e2e.ts` fails for a page with no recorded weight, and prints the
  figures to record.
- **A sample URL, if the route has a `[parameter]`.** Add one to `DYNAMIC_ROUTE_SAMPLES` in
  `e2e/support.ts`; the audit fails until it has one.

`src/app.html` may contain exactly one inline script. The content security policy allows it by a
hash that `vite.config.ts` computes from the file, so the script can be edited freely, but a
second one would be refused by the browser and is refused by the build.

## Deploying it

```sh
docker build -t the-go-stack .
docker run -p 3000:3000 -e ORIGIN=https://example.com the-go-stack
```

| Variable    | Read by      | What it is                                                                                          |
| ----------- | ------------ | --------------------------------------------------------------------------------------------------- |
| `ORIGIN`    | Node adapter | The address visitors use. Required behind a proxy: without it, form posts are refused.              |
| `PORT`      | Node adapter | The port to listen on. 3000 if not set.                                                             |
| `HOST`      | Node adapter | The address to listen on. All interfaces if not set.                                                |
| `LOG_LEVEL` | The app      | `info` (the default) or `error`. Declared in `src/env.ts`; anything else stops the server starting. |

The Node adapter reads [a few more](https://svelte.dev/docs/kit/adapter-node#Environment-variables),
for timeouts and for the headers a proxy uses to pass on the visitor's address.

- **Health.** `GET /healthz` answers 200 with the build's version when the server is up.
- **Logs.** One line of JSON per event: errors on standard error, the rest on standard output.
  An unexpected error is recorded with a reference, and the visitor is shown the same reference.
- **TLS.** The server speaks plain HTTP. Whatever terminates TLS in front of it is also where
  `Strict-Transport-Security` belongs, and where requests to `/api/client-errors` should be
  rate-limited.
