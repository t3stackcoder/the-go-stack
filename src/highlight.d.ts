// This file must stay a script (no imports or exports) for the wildcard declaration to be global.

/** Highlighted source of a real file, as HTML. See plugins/highlight.ts. */
declare module '*?highlight' {
	const html: string;
	export default html;
}
