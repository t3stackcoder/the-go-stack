/**
 * The data set behind the search demo: the HTTP status codes in the IANA registry, with their
 * reason phrases as RFC 9110 gives them. Unassigned and unused codes are left out.
 *
 * It lives in a `server` directory, which SvelteKit refuses to bundle for the browser: the whole
 * list stays on the server, and only the matches for a query are ever sent to the page.
 */
export type StatusKind =
	| 'Informational'
	| 'Success'
	| 'Redirection'
	| 'Client error'
	| 'Server error';

export interface StatusCode {
	code: number;
	phrase: string;
	kind: StatusKind;
}

const KINDS: Record<number, StatusKind> = {
	1: 'Informational',
	2: 'Success',
	3: 'Redirection',
	4: 'Client error',
	5: 'Server error'
};

const PHRASES: [number, string][] = [
	[100, 'Continue'],
	[101, 'Switching Protocols'],
	[102, 'Processing'],
	[103, 'Early Hints'],
	[200, 'OK'],
	[201, 'Created'],
	[202, 'Accepted'],
	[203, 'Non-Authoritative Information'],
	[204, 'No Content'],
	[205, 'Reset Content'],
	[206, 'Partial Content'],
	[207, 'Multi-Status'],
	[208, 'Already Reported'],
	[226, 'IM Used'],
	[300, 'Multiple Choices'],
	[301, 'Moved Permanently'],
	[302, 'Found'],
	[303, 'See Other'],
	[304, 'Not Modified'],
	[305, 'Use Proxy'],
	[307, 'Temporary Redirect'],
	[308, 'Permanent Redirect'],
	[400, 'Bad Request'],
	[401, 'Unauthorized'],
	[402, 'Payment Required'],
	[403, 'Forbidden'],
	[404, 'Not Found'],
	[405, 'Method Not Allowed'],
	[406, 'Not Acceptable'],
	[407, 'Proxy Authentication Required'],
	[408, 'Request Timeout'],
	[409, 'Conflict'],
	[410, 'Gone'],
	[411, 'Length Required'],
	[412, 'Precondition Failed'],
	[413, 'Content Too Large'],
	[414, 'URI Too Long'],
	[415, 'Unsupported Media Type'],
	[416, 'Range Not Satisfiable'],
	[417, 'Expectation Failed'],
	[421, 'Misdirected Request'],
	[422, 'Unprocessable Content'],
	[423, 'Locked'],
	[424, 'Failed Dependency'],
	[425, 'Too Early'],
	[426, 'Upgrade Required'],
	[428, 'Precondition Required'],
	[429, 'Too Many Requests'],
	[431, 'Request Header Fields Too Large'],
	[451, 'Unavailable For Legal Reasons'],
	[500, 'Internal Server Error'],
	[501, 'Not Implemented'],
	[502, 'Bad Gateway'],
	[503, 'Service Unavailable'],
	[504, 'Gateway Timeout'],
	[505, 'HTTP Version Not Supported'],
	[506, 'Variant Also Negotiates'],
	[507, 'Insufficient Storage'],
	[508, 'Loop Detected'],
	[510, 'Not Extended'],
	[511, 'Network Authentication Required']
];

export const STATUS_CODES: readonly StatusCode[] = PHRASES.map(([code, phrase]) => ({
	code,
	phrase,
	kind: KINDS[Math.floor(code / 100)]
}));

/**
 * Every status code matching all the words of `query`. A word matches the start of the code
 * ("40" finds 400 to 409) or any part of the phrase or kind ("redirect", "too"), ignoring case.
 * An empty query matches everything.
 */
export function searchStatusCodes(query: string): StatusCode[] {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean);

	return STATUS_CODES.filter(({ code, phrase, kind }) => {
		const text = `${phrase} ${kind}`.toLowerCase();
		return words.every((word) => String(code).startsWith(word) || text.includes(word));
	});
}
