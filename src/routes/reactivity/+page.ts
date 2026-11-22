// Built once, when the site is built, and served as a compressed static file. A page is rendered
// per request unless it says this, so one that reads live data cannot be frozen by accident.
export const prerender = true;
