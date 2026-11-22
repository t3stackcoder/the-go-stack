// The pages under /stress exist to push the foundation harder than the chapters do. Each one
// answers a single question about server rendering or hydration, stated at the top of its file.
// They are not part of the site's argument and are not linked from it. All depend on the request.
//
// Not to be deployed as they stand. Anyone can ask one of them to hold a response open for good,
// render twenty thousand rows, or write an error to the log, as often as they like. They also
// take part in how the browser's JavaScript is cut into files (see vite.config.ts), so figures
// for the site itself are measured from a build without them.
export const prerender = false;
