# Next steps

The foundation is built and its tests pass. This is what is still open, most important first.
`README.md` describes the repository, and `CLAUDE.md` is binding on how to work in it.

## Verify what has never been verified

1. **Run the CI workflow on GitHub.** `.github/workflows/ci.yml` has never run, because the
   repository has no remote. Its steps have been run by hand in a Linux container (Playwright's
   own image, Node 24): types, unit tests and all 573 browser tests passed there, so the Windows
   budgets and layout results hold on Linux. What is still unproven is the workflow file itself:
   the actions it names, the pnpm setup, and the fonts on GitHub's runner, which need not be the
   ones in that image.
2. **Check Safari on a Mac and an iPhone.** The WebKit in the tests is Playwright's build on
   Windows: the same engine, but not the same fonts or platform. Two things to look at by hand:
   that the font never changes during a visit, including after the first link is followed on a
   slow connection, and that the skip link is the first stop for Option+Tab. The test build never
   moves to a link with Tab, so the test focuses the skip link directly.
3. **Check the font rule on a deployed site.** The page asks for the font before first paint only
   when the server answered within 35 ms (`src/app.html`, reasoning and figures in
   `src/routes/layout.css`). That figure was measured with real network delay between containers
   on one machine, behind one proxy (Caddy) and directly over HTTP/1.1. It was not measured on a
   limited connection, behind a CDN, or over HTTP/3. On a deployed site, look at how often a first
   visit in Chrome starts in Inter, and how long first paint waits when it does.
4. **Put real photographs through the image pipeline.** The demo images are flat generated
   illustrations and compress far better than a photograph does. The weights on
   `/stability/images` say little about what a real page of images will cost.

## Decisions for the owner

5. **Whether the font trade is the right one.** The font is settled at the first frame, so that
   no browser changes it mid-visit. The price is that Firefox shows the fallback on most first
   visits, and Inter only once the file is cached. The alternative is Inter more often and text
   that moves after first paint in Firefox and WebKit. The evidence is in the comment above the
   `@font-face` rules in `src/routes/layout.css`.

   In Chromium the trade now has a figure. A first visit to a server up to about 28 ms away
   still asks for the font before first paint, and Chromium holds the first frame for it. Behind
   an HTTP/2 proxy, first paint in Inter came about 116 ms after the connection opened at a 10 ms
   round trip and about 205 ms at 25 ms. At 30 ms, just past the cut-off, it came at 148 ms in the
   fallback. That wait cannot be removed while a first visit starts in Inter: the font is a
   separate file, three round trips behind the page. Two positions give it up. Never ask on a
   first visit: every first visit paints at once, and none starts in Inter. Or put the font
   inside the page: no wait for the font, and about 50 KB more on every full page load. That was
   not built or measured. By the sizes involved it would cost every first visit one or two more
   round trips before first paint.

6. **Whether `/stability/failure` should ship.** It throws on purpose so that the 500 page can be
   shown and tested. Every visit writes a real error to the production log. Keep it and filter it
   out where logs are read, or remove the page and lose the end-to-end test of a server failure.
7. **What comes after the foundation.** A real application slice (sign-in, a database, lists,
   editing) and a shared component library were both left out on purpose. Neither has been
   started or designed.

## Known gaps

8. **Browser error reports are not filtered.** `src/lib/browser-errors.ts` reports every uncaught
   exception and unhandled rejection, up to ten for each page load. On a public site that will
   include errors thrown by browser extensions, which nothing here tells apart from the app's
   own. A rejection from before hydration is reported one second after hydration, and is lost if
   the visitor leaves in that second.
9. **The font is cached by time, not by name.** The script in `src/app.html` has to name the font
   before anything else on the page is read, and the content security policy fixes that script's
   text, so the address (`/fonts/inter-latin.woff2`) cannot carry a version. `server.js` lets a
   browser keep the file for 30 days and then refresh it in the background. A new cut of the font
   therefore reaches a returning visitor up to a month late. A browser that does not refresh in
   the background asks the server once a month instead, and may start that one visit in the
   fallback. Whether Safari is one was not checked. The
   address also assumes the site is served from the root: a base path would have to be added to
   it by hand. Run with `node build` instead of `server.js`, the font has no cache rule at all.
10. **The second font file is left to the browser.** Inter's Latin Extended file loads on demand
    under `font-display: optional` alone, without the first-frame rule. No page uses those
    characters today, and the one-font budget fails if one starts to. A page that needs them needs
    a decision first.
11. **The fallback font fits body text better than headings.** The header title measured 141 px
    in Inter, against 149 px (Chromium) and 160 px (WebKit) in the fallback. Nothing moves,
    because the font never changes mid-visit, but a visit in the fallback looks different at
    heading sizes. Weight-specific fallback faces would narrow the gap.
12. **Embeds, video and CSS background images have no mechanism.** `Image` covers `<img>` only.
    The first page that needs an embed needs the same treatment: a box sized before the content
    arrives, and a broken case to prove the audit catches one without it.
13. **Three chapters' factual claims were never checked against documentation**: Reactivity,
    Data and Forms. Their tests pass and their pages were reviewed, but the copy was read for
    plausibility only.

## Worth investigating

14. **Over HTTP/1.1 a page's script files queue. Over HTTP/2 they do not.** A page asks for two
    dozen or so script files, and a browser sends six at a time to a server that speaks HTTP/1.1, as
    this one does. Measured on a first visit at a 150 ms round trip: the page could respond about
    790 ms after its HTML began to arrive when the browser reached the server directly, and about
    500 ms behind an HTTP/2 proxy. So the cure is the proxy (see 19). Grouping the files in the
    bundler (`codeSplitting` in `vite.config.ts`) brought a page down to 8 or 9 files of the same
    weight, and was taken out again: with any group of its own in place, an error page reached by
    a link was loaded as a new document instead of being shown by the router, and the cause was
    not found. It made no difference behind the proxy in any case.
15. **Behind a proxy that starts a connection slowly, nothing paints until a second round trip.**
    Nothing can be painted until the whole `<head>` has arrived, and it weighs 9 KB compressed,
    7.5 KB of it the inlined stylesheet. A server sends only so much before it waits to hear from
    the browser: about 14 KB on a new connection, and less behind some proxies. Reached directly,
    this server delivered the page in one piece. Behind the proxy used for these measurements
    (Caddy) the head took two, on every first visit measured, so the first piece there carries
    less than 9 KB. Why was not established. `e2e/budgets.e2e.ts` now holds the head
    under 12 KB, which keeps it inside the larger figure. Getting inside the smaller one means a
    lighter stylesheet, and the stylesheet is nearly all Tailwind utilities for the whole site.
16. **One Verdict test fails about one run in ten in WebKit when the machine is busy.**
    `answering does not add history entries or lose the scroll position`
    (`e2e/verdict.e2e.ts`) failed at least 4 times in 30 on the code as committed, and 3 in 30
    after these changes, with the whole suite's worth of browsers running beside it. Alone it
    passes. It was not investigated.
17. **A Node assertion message appears now and then on Windows** after the test
    `a compressed page still arrives in pieces`
    (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`). The test passes. It was not
    investigated.
18. **The failure demo fills the test output** with the errors it logs on purpose, which makes a
    real server error harder to spot in a failing run.

## Outside the repository

19. **The proxy in front of the server has three jobs the app leaves to it:** sending
    `Strict-Transport-Security`, limiting how often one client may post to `/api/client-errors`
    (the app's own code stops at ten reports for each page load, which does nothing about a client
    that is not the app), and speaking HTTP/2 or HTTP/3 to browsers (see 14).

## Before you start

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
