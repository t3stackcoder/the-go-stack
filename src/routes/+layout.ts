// Pages are built once, at build time, and served as compressed static files unless they say
// otherwise. Pages that genuinely depend on the request (the rendering, data and form demos) opt
// out with `export const prerender = false`.
export const prerender = true;
