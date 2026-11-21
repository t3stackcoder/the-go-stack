# Next steps

The foundation is built and its tests pass. This is what is still open, most important first.
`README.md` describes the repository, and `CLAUDE.md` is binding on how to work in it.

## Verify what has never been verified

1. **Run the CI workflow.** `.github/workflows/ci.yml` has never run, because the repository has
   no remote. It runs on Linux, and every budget and every layout result was measured on Windows.
   The fallback font is found by name (`Arial`, then `Liberation Sans`), so text may be laid out
   differently there. Expect to investigate the first run, not just to watch it pass.
2. **Check Safari on a Mac and an iPhone.** The WebKit in the tests is Playwright's build on
   Windows: the same engine, but not the same fonts or platform. Two things to look at by hand:
   that the font never changes during a visit, including after the first link is followed on a
   slow connection, and that the skip link is the first stop for Option+Tab. The test build never
   moves to a link with Tab, so the test focuses the skip link directly.
3. **Put real photographs through the image pipeline.** The demo images are flat generated
   illustrations and compress far better than a photograph does. The weights on
   `/stability/images` say little about what a real page of images will cost.

## Decisions for the owner

4. **Whether the font trade is the right one.** The font is settled at the first frame, so that
   no browser changes it mid-visit. The price is that Firefox shows the fallback on most first
   visits, and Inter only once the file is cached. The alternative is Inter more often and text
   that moves after first paint in Firefox and WebKit. The evidence is in the comment above the
   `@font-face` rules in `src/routes/layout.css`.
5. **Whether `/stability/failure` should ship.** It throws on purpose so that the 500 page can be
   shown and tested. Every visit writes a real error to the production log. Keep it and filter it
   out where logs are read, or remove the page and lose the end-to-end test of a server failure.
6. **What comes after the foundation.** A real application slice (sign-in, a database, lists,
   editing) and a shared component library were both left out on purpose. Neither has been
   started or designed.

## Known gaps

7. **Browser errors outside navigation are not recorded.** `src/hooks.client.ts` only sees
   errors thrown while a page is loading. An exception in an event handler, or a promise nobody
   awaited, reaches nothing but the visitor's console. Listening for `error` and
   `unhandledrejection` and sending them to the same endpoint would close it.
8. **A streamed promise that rejects before hydration logs an unhandled rejection in the
   browser.** SvelteKit 3.4 creates the deferred promise with no handler attached.
   `/data/streaming` has one panel that rejects on purpose at 2000 ms, which is normally after
   hydration, so `e2e/hydration.dev.e2e.ts` could catch it on a heavily loaded machine. If it
   becomes flaky, fix the cause (for example, resolve to an error value instead of rejecting) and
   update the chapter's copy. Do not loosen the test.
9. **The second font file is left to the browser.** Inter's Latin Extended file loads on demand
   under `font-display: optional` alone, without the first-frame rule. No page uses those
   characters today, and the one-font budget fails if one starts to. A page that needs them needs
   a decision first.
10. **The fallback font fits body text better than headings.** The header title measured 141 px
    in Inter, against 149 px (Chromium) and 160 px (WebKit) in the fallback. Nothing moves,
    because the font never changes mid-visit, but a visit in the fallback looks different at
    heading sizes. Weight-specific fallback faces would narrow the gap.
11. **Embeds, video and CSS background images have no mechanism.** `Image` covers `<img>` only.
    The first page that needs an embed needs the same treatment: a box sized before the content
    arrives, and a broken case to prove the audit catches one without it.
12. **Three chapters' factual claims were never checked against documentation**: Reactivity,
    Data and Forms. Their tests pass and their pages were reviewed, but the copy was read for
    plausibility only.

## Worth investigating

13. **Chromium may be holding first paint for a font it then does not use.** On a 150 ms,
    9 Mbit/s connection the HTML had arrived by about 165 ms and first paint came at about
    315 ms, in the fallback. The gap looks like Chromium waiting for the preloaded font. If it
    is, a slow first visit could paint about 150 ms sooner. Untested.
14. **A Node assertion message appears now and then on Windows** after the test
    `a compressed page still arrives in pieces`
    (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`). The test passes. It was not
    investigated.
15. **The failure demo fills the test output** with the errors it logs on purpose, which makes a
    real server error harder to spot in a failing run.

## Outside the repository

16. **The proxy in front of the server has two jobs the app leaves to it:** sending
    `Strict-Transport-Security`, and limiting how often one client may post to
    `/api/client-errors`.

## Before you start

- **Nothing is committed.** The whole tree is untracked. Commit only if the owner asks.
- **Confirm green first:** `pnpm check`, `pnpm lint`, `pnpm exec vitest --run`,
  `pnpm exec playwright test`.
- **One build at a time.** The browser suite builds the project and starts servers on ports 4173
  and 5173. Two builds or two suites in the same directory share `.svelte-kit/` and `build/`.
- **Every new check must be seen to fail.** Write a deliberately broken page
  (`src/routes/zz-broken/+page.svelte`), confirm the check fails on it for the right reason, then
  delete the page. Several checks in this project passed at first while the thing they guarded
  was broken.
- **Measure in production, with a warm browser.** The development server re-inserts the
  stylesheet after load and shows a shift of its own. A browser process that has just started
  adds about 650 ms to the first page load on this machine: load any small file from the site
  first, or the figure is wrong.
- **SvelteKit 3 is not SvelteKit 2.** Options go in `sveltekit({...})` in `vite.config.ts`; there
  is no `svelte.config.js`. Imports are `#lib/...` with an explicit extension. When unsure, read
  `node_modules/@sveltejs/kit/types/index.d.ts` or the installed source, not memory.
- **The shell is Windows.** PowerShell 5.1 has no `&&`. In Git Bash a bare `/path` argument is
  rewritten to a Windows path unless `MSYS_NO_PATHCONV=1` is set, which matters for
  `playwright test -g "/some/route"`. Create files with a file-writing tool, not a shell heredoc.
