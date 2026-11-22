// The pages under /stress exist to push the foundation harder than the chapters do. Each one
// answers a single question, stated at the top of its file: about server rendering and hydration,
// and, under /stress/forms and /stress/superforms, about forms. They are not part of the site's
// argument and are not linked from it. All depend on the request.
//
// The pages under /stress/superforms are built with Superforms and zod, which nothing else on the
// site uses. Those under /stress/forms use only what the Forms chapter does, and several are the
// twin of a Superforms page, so the same question can be put to both.
//
// A form on one of these pages repeats the page's query string in its `action`. The answer to a
// form lands on the action's address, with JavaScript as without, so a page that left its query
// out would come back without it: measured, a table of 500 rows came back as the default 100.
//
// Not to be deployed as they stand. Anyone can ask one of them to hold a response or an action
// open for good, render twenty thousand rows, or write an error to the log, as often as they like,
// and two of them keep a little state that every visitor shares. They also take part in how the
// browser's JavaScript is cut into files (see vite.config.ts), so figures for the site itself are
// measured from a build without them.
export const prerender = false;
