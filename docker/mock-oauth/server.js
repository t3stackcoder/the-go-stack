/**
 * A fake OAuth 2.0 authorisation server that plays Google, GitHub and Facebook at once, so that
 * signing in with each of them can be tried, and tested, without an account at any of them.
 *
 * It is for development only. It runs beside the app in a container, on its own port, and the
 * app's OAuth client is pointed at it in place of the real providers. Everything it knows is in
 * this file and in memory, and it takes anyone who asks for a code to be who they say they are.
 * Nothing about it is safe to expose.
 *
 * Each provider has its own client, its own fixed person and its own set of addresses:
 *
 * - GET  /:provider/authorize  Sends the browser straight back to the app with a code.
 * - POST /:provider/token      Swaps a code for tokens.
 * - GET  /:provider/userinfo   Says who a token is for.
 * - GET  /healthz              Answers 200, for a container health check.
 *
 * What it does check is what a real provider checks, so that a mistake in the app's client shows
 * here and not only in production: the client's id and secret, that a code is used once and soon,
 * that the redirect address is the one the code was issued for, and the PKCE verifier. The one
 * place it is stricter than a real provider is the redirect address, which must be on this
 * machine. A real provider has the app's addresses registered. This one has no registry, and
 * checking for a loopback address is what keeps a code from being sent anywhere else.
 *
 * Deliberately not here:
 *
 * - A login or consent page. The authorise address redirects at once, because the person is fixed
 *   and a page would only be one more thing for a test to click through.
 * - A refresh grant. A refresh token is issued, because the client expects one, and is not
 *   accepted: a request for it is refused as an unsupported grant type.
 * - An ID token. The client reads the person from the userinfo address, and a signed token would
 *   need a key set to be published and kept.
 * - Scopes that do anything. Whatever scope is asked for is handed back and has no effect.
 *
 * When authorising goes wrong, where the answer goes depends on whether the redirect address can
 * be trusted yet. A fault with the client or the redirect address is answered here, as JSON with
 * a 400, and never by a redirect: sending a visitor to an address that has not been checked is
 * how an authorisation server becomes an open redirect. Any other fault is sent to the redirect
 * address as `error`, `error_description` and the `state`, which is how a provider tells the app
 * that the visitor's sign-in did not happen.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

/** The providers it plays, and the order they are listed in. */
export const PROVIDERS = /** @type {const} */ (['google', 'github', 'facebook']);

/** @typedef {(typeof PROVIDERS)[number]} Provider */

/** @type {Record<Provider, { clientId: string, clientSecret: string }>} */
export const CLIENTS = {
	google: { clientId: 'mock-google-client', clientSecret: 'mock-google-secret' },
	github: { clientId: 'mock-github-client', clientSecret: 'mock-github-secret' },
	facebook: { clientId: 'mock-facebook-client', clientSecret: 'mock-facebook-secret' }
};

/**
 * The one person each provider knows. They are clearly invented, and have no picture, so that
 * nothing is ever fetched from anywhere.
 *
 * Google and GitHub are the same person, with the same name and address and each provider's own
 * id, because the app links a provider to an existing user only when the addresses match, and that
 * has to be something a developer can try with a click on each. Facebook is somebody else, so that
 * the case where nothing matches can be tried too. Neither should be tidied into the other.
 *
 * @type {Record<Provider, { id: string, name: string, email: string, email_verified: true }>}
 */
export const PEOPLE = {
	google: {
		id: 'google-1001',
		name: 'Alice Mockwell',
		email: 'alice.mockwell@example.com',
		email_verified: true
	},
	github: {
		id: 'github-2002',
		name: 'Alice Mockwell',
		email: 'alice.mockwell@example.com',
		email_verified: true
	},
	facebook: {
		id: 'facebook-3003',
		name: 'Carol Pretendy',
		email: 'carol.pretendy@example.com',
		email_verified: true
	}
};

/** How long a code can be exchanged for, in milliseconds. A real provider allows a minute or so. */
const CODE_LIFE = 60_000;
/** How long an access token lasts, in seconds, as the token response says it. */
const TOKEN_LIFE = 3600;
/** What the token response says the scope was, when the authorise request did not name one. */
const DEFAULT_SCOPE = 'openid profile email';
/** The most a token request may weigh. It is five short fields, and none can be near this. */
const MOST_BODY = 4096;
/** The most of each kind of thing remembered. A dev session cannot come near, so it is a backstop. */
const MOST_REMEMBERED = 1000;

/** The names a browser on this machine can call it by. `URL` writes the address one in brackets. */
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

/** What RFC 7636 allows for a verifier, and what the S256 hash of one always looks like. */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

/**
 * @typedef {object} Code
 * @property {Provider} provider
 * @property {string} clientId
 * @property {string} redirectUri The address as the client wrote it, which the token request must repeat.
 * @property {string} challenge
 * @property {string} scope
 * @property {number} expires
 */

/**
 * Starts a mock server and does not listen: the caller chooses the port.
 *
 * @param {{ now?: () => number }} [options] `now` is the clock, in milliseconds, so that a test can
 *   let a code expire without waiting for it.
 * @returns {import('node:http').Server}
 */
export function createMockOAuth({ now = Date.now } = {}) {
	// Each is oldest first, and each kind lives for one length of time, so the ones that have
	// expired are always at the front.
	/** @type {Map<string, Code>} */
	const codes = new Map();
	/** @type {Map<string, { provider: Provider, expires: number }>} */
	const tokens = new Map();

	/**
	 * Forgets what has expired, and the oldest of the rest if there is too much, so that memory
	 * cannot grow over a long session. Called before every lookup and every issue.
	 *
	 * @param {Map<string, { expires: number }>} store
	 */
	function sweep(store) {
		for (const [key, { expires }] of store) {
			if (store.size <= MOST_REMEMBERED && expires > now()) break;
			store.delete(key);
		}
	}

	/**
	 * @param {import('node:http').IncomingMessage} request
	 * @param {import('node:http').ServerResponse} response
	 */
	async function handle(request, response) {
		let url;
		try {
			url = new URL(request.url ?? '', 'http://mock');
		} catch {
			return fail(response, 400, 'invalid_request', 'The request address could not be read.');
		}

		if (url.pathname === '/healthz') {
			if (request.method !== 'GET') return notAllowed(response, 'GET');
			return json(response, 200, { status: 'ok' });
		}

		const [, provider, action, ...rest] = url.pathname.split('/');
		if (!isProvider(provider) || rest.length > 0) {
			return fail(response, 404, 'not_found', 'There is nothing at this address.');
		}

		if (action === 'authorize') {
			if (request.method !== 'GET') return notAllowed(response, 'GET');
			return authorise(response, provider, url.searchParams);
		}
		if (action === 'token') {
			if (request.method !== 'POST') return notAllowed(response, 'POST');
			return exchange(request, response, provider);
		}
		if (action === 'userinfo') {
			if (request.method !== 'GET') return notAllowed(response, 'GET');
			return userinfo(request, response, provider);
		}
		return fail(response, 404, 'not_found', 'There is nothing at this address.');
	}

	/**
	 * @param {import('node:http').ServerResponse} response
	 * @param {Provider} provider
	 * @param {URLSearchParams} query
	 */
	function authorise(response, provider, query) {
		const params = single(query);
		if (!params) return fail(response, 400, 'invalid_request', DUPLICATE);

		// Nothing is redirected until the client and the redirect address are known good.
		if (params.client_id !== CLIENTS[provider].clientId) {
			return fail(response, 400, 'invalid_request', 'client_id is missing or not a known client.');
		}
		const redirect = loopback(params.redirect_uri);
		if (!redirect) {
			return fail(
				response,
				400,
				'invalid_request',
				'redirect_uri is missing, or is not an http or https address on localhost, 127.0.0.1 or [::1].'
			);
		}

		/** @param {string} error @param {string} description */
		const refuse = (error, description) => {
			redirect.searchParams.set('error', error);
			redirect.searchParams.set('error_description', description);
			if (params.state !== undefined) redirect.searchParams.set('state', params.state);
			response.writeHead(302, { location: redirect.href, 'cache-control': 'no-store' }).end();
		};

		if (params.response_type !== 'code') {
			return refuse('unsupported_response_type', 'response_type must be code.');
		}
		if (params.code_challenge_method !== 'S256') {
			return refuse('invalid_request', 'code_challenge_method must be S256.');
		}
		const challenge = params.code_challenge ?? '';
		if (!CHALLENGE.test(challenge)) {
			return refuse(
				'invalid_request',
				'code_challenge is missing, or is not a base64url SHA-256 hash.'
			);
		}

		sweep(codes);
		const code = randomBytes(32).toString('base64url');
		codes.set(code, {
			provider,
			clientId: params.client_id,
			redirectUri: /** @type {string} */ (params.redirect_uri),
			challenge,
			scope: params.scope || DEFAULT_SCOPE,
			expires: now() + CODE_LIFE
		});

		// `set`, so that a code or state the redirect address already carried cannot be put ahead of
		// the real one. Anything else in its query is kept.
		redirect.searchParams.set('code', code);
		if (params.state !== undefined) redirect.searchParams.set('state', params.state);
		response.writeHead(302, { location: redirect.href, 'cache-control': 'no-store' }).end();
	}

	/**
	 * @param {import('node:http').IncomingMessage} request
	 * @param {import('node:http').ServerResponse} response
	 * @param {Provider} provider
	 */
	async function exchange(request, response, provider) {
		const type = (request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
		if (type !== 'application/x-www-form-urlencoded') {
			return fail(
				response,
				400,
				'invalid_request',
				'The body must be application/x-www-form-urlencoded.'
			);
		}

		const text = await readBody(request);
		if (text === null) {
			// The connection is closed, because the rest of the body has been left unread.
			response.setHeader('connection', 'close');
			return fail(response, 413, 'invalid_request', `The body may be at most ${MOST_BODY} bytes.`);
		}
		const params = single(new URLSearchParams(text));
		if (!params) return fail(response, 400, 'invalid_request', DUPLICATE);

		if (params.grant_type !== 'authorization_code') {
			return fail(
				response,
				400,
				'unsupported_grant_type',
				'Only authorization_code is supported. There is no refresh grant.'
			);
		}

		// Taken out of the store first, so that it is used up whatever else is wrong with the request.
		// That includes a request that fails to prove who it is: the code is still the one that was
		// presented, and a real provider that sees a code again treats it as stolen.
		sweep(codes);
		const issued = params.code === undefined ? undefined : codes.get(params.code);
		if (params.code !== undefined) codes.delete(params.code);

		const client = clientOf(request, params);
		if ('error' in client) {
			return fail(
				response,
				client.status,
				client.error,
				client.description,
				client.status === 401 ? BASIC : undefined
			);
		}
		// Both are always compared, so that the time taken does not say which was wrong.
		const knownId = same(client.id, CLIENTS[provider].clientId);
		const knownSecret = same(client.secret, CLIENTS[provider].clientSecret);
		if (!knownId || !knownSecret) {
			return fail(response, 401, 'invalid_client', 'The client id or secret is wrong.', BASIC);
		}

		if (params.code === undefined || params.redirect_uri === undefined) {
			return fail(response, 400, 'invalid_request', 'code and redirect_uri are required.');
		}
		if (params.code_verifier === undefined) {
			return fail(response, 400, 'invalid_request', 'code_verifier is required.');
		}
		if (!issued || issued.provider !== provider || issued.clientId !== client.id) {
			return fail(response, 400, 'invalid_grant', 'The code is not known, or has been used.');
		}
		if (issued.expires <= now()) {
			return fail(response, 400, 'invalid_grant', 'The code has expired.');
		}
		if (params.redirect_uri !== issued.redirectUri) {
			return fail(
				response,
				400,
				'invalid_grant',
				'redirect_uri is not the one the code was issued for.'
			);
		}
		const proof = createHash('sha256').update(params.code_verifier).digest('base64url');
		if (!VERIFIER.test(params.code_verifier) || !same(proof, issued.challenge)) {
			return fail(response, 400, 'invalid_grant', 'code_verifier does not match the challenge.');
		}

		sweep(tokens);
		const accessToken = randomBytes(32).toString('base64url');
		tokens.set(accessToken, { provider, expires: now() + TOKEN_LIFE * 1000 });

		json(response, 200, {
			access_token: accessToken,
			token_type: 'Bearer',
			expires_in: TOKEN_LIFE,
			// Never accepted again: there is no refresh grant. It is here for clients that expect one.
			refresh_token: randomBytes(32).toString('base64url'),
			scope: issued.scope
		});
	}

	/**
	 * @param {import('node:http').IncomingMessage} request
	 * @param {import('node:http').ServerResponse} response
	 * @param {Provider} provider
	 */
	function userinfo(request, response, provider) {
		const given = /^Bearer +([^ ]+)$/i.exec(request.headers.authorization ?? '')?.[1];
		if (given === undefined) {
			return fail(response, 401, 'invalid_request', 'A bearer token is required.', {
				'www-authenticate': 'Bearer realm="mock-oauth"'
			});
		}

		sweep(tokens);
		const token = tokens.get(given);
		// A token is only good at the provider that issued it, as a real one would be.
		if (!token || token.provider !== provider || token.expires <= now()) {
			return fail(response, 401, 'invalid_token', 'The token is not known, or has expired.', {
				'www-authenticate': 'Bearer realm="mock-oauth", error="invalid_token"'
			});
		}
		json(response, 200, PEOPLE[provider]);
	}

	const server = createServer((request, response) => {
		// The handler is async, and a request that throws must not end the process. Its failure is
		// the server's own, so it is recorded here and the caller is told as much.
		handle(request, response).catch((error) => {
			console.error('mock-oauth: a request failed:', error);
			if (response.headersSent) response.destroy();
			else fail(response, 500, 'server_error', 'The mock server failed.');
		});
	});
	return server;
}

/** What a client refused for its credentials is told to authenticate with. */
const BASIC = { 'www-authenticate': 'Basic realm="mock-oauth", charset="UTF-8"' };

/** The one thing said when a parameter is repeated. */
const DUPLICATE = 'A parameter was given more than once.';

/**
 * @param {unknown} value
 * @returns {value is Provider}
 */
function isProvider(value) {
	return PROVIDERS.includes(/** @type {Provider} */ (value));
}

/**
 * The parameters by name, or null if any was given twice. RFC 6749 forbids it, and taking the
 * first or the last is how two parties come to read one request differently.
 *
 * @param {URLSearchParams} search
 * @returns {Record<string, string | undefined> | null}
 */
function single(search) {
	/** @type {Record<string, string | undefined>} */
	const params = Object.create(null);
	for (const [name, value] of search) {
		if (name in params) return null;
		params[name] = value;
	}
	return params;
}

/**
 * The redirect address as a URL, if it is one that is safe to send a code to.
 *
 * @param {string | undefined} value
 * @returns {URL | null}
 */
function loopback(value) {
	if (!value) return null;
	try {
		const url = new URL(value);
		const plain = url.protocol === 'http:' || url.protocol === 'https:';
		// No credentials, which can make an address read as one host and mean another. No fragment,
		// which RFC 6749 forbids and which would swallow the code the redirect adds.
		const bare = !url.username && !url.password && !url.hash;
		return plain && bare && LOOPBACK.includes(url.hostname) ? url : null;
	} catch {
		return null;
	}
}

/**
 * Whether two strings are equal, in time that does not depend on where they first differ. Both are
 * hashed first, which makes them one length, as `timingSafeEqual` needs.
 *
 * @param {string} a
 * @param {string} b
 */
function same(a, b) {
	const hash = (/** @type {string} */ text) => createHash('sha256').update(text).digest();
	return timingSafeEqual(hash(a), hash(b));
}

/**
 * Who the token request says the client is: in the body, or as HTTP Basic, which the client's
 * library may use instead. Both together is refused, as RFC 6749 says, with one allowance: the
 * body may name the client when Basic names the same one, because libraries do.
 *
 * @param {import('node:http').IncomingMessage} request
 * @param {Record<string, string | undefined>} params
 * @returns {{ id: string, secret: string } | { error: string, description: string, status: number }}
 */
function clientOf(request, params) {
	const header = request.headers.authorization;
	const basic = header !== undefined && /^Basic(?: |$)/i.test(header);

	if (!basic) {
		if (params.client_id === undefined || params.client_secret === undefined) {
			return {
				status: 401,
				error: 'invalid_client',
				description: 'Client credentials are required: client_id and client_secret, or HTTP Basic.'
			};
		}
		return { id: params.client_id, secret: params.client_secret };
	}

	if (params.client_secret !== undefined) {
		return {
			status: 400,
			error: 'invalid_request',
			description: 'The client must authenticate by one method only.'
		};
	}
	const decoded = Buffer.from(header.slice(5).trim(), 'base64').toString('utf8');
	const colon = decoded.indexOf(':');
	if (colon < 0) {
		return {
			status: 401,
			error: 'invalid_client',
			description: 'The Basic credentials are malformed.'
		};
	}
	const id = unform(decoded.slice(0, colon));
	const secret = unform(decoded.slice(colon + 1));
	if (params.client_id !== undefined && params.client_id !== id) {
		return {
			status: 400,
			error: 'invalid_request',
			description: 'client_id does not match the Basic credentials.'
		};
	}
	return { id, secret };
}

/**
 * Undoes the form encoding RFC 6749 puts on each half of Basic credentials. Text that is not
 * validly encoded is taken as it stands, because a secret may well contain a `%`.
 *
 * @param {string} text
 */
function unform(text) {
	try {
		return decodeURIComponent(text.replace(/\+/g, ' '));
	} catch {
		return text;
	}
}

/**
 * The body of a request as text, or null if it is more than a token request can be. A declared
 * length is trusted only to refuse early. The bytes are counted as well, because a body sent in
 * chunks declares none.
 *
 * @param {import('node:http').IncomingMessage} request
 * @returns {Promise<string | null>}
 */
function readBody(request) {
	if (Number(request.headers['content-length']) > MOST_BODY) return Promise.resolve(null);

	return new Promise((resolve, reject) => {
		/** @type {Buffer[]} */
		const chunks = [];
		let size = 0;

		request.on('data', (/** @type {Buffer} */ chunk) => {
			size += chunk.length;
			if (size > MOST_BODY) {
				// Stopped, and not destroyed: destroying the request would take the connection with it
				// before the refusal could be sent.
				request.removeAllListeners('data');
				request.pause();
				chunks.length = 0;
				resolve(null);
			} else {
				chunks.push(chunk);
			}
		});
		request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		request.on('error', reject);
	});
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {unknown} body
 * @param {Record<string, string>} [headers]
 */
function json(response, status, body, headers = {}) {
	response
		.writeHead(status, {
			'content-type': 'application/json; charset=utf-8',
			// Tokens and people: nothing a cache should keep.
			'cache-control': 'no-store',
			pragma: 'no-cache',
			...headers
		})
		.end(JSON.stringify(body));
}

/**
 * An error in the shape OAuth gives them.
 *
 * @param {import('node:http').ServerResponse} response
 * @param {number} status
 * @param {string} error
 * @param {string} description
 * @param {Record<string, string>} [headers]
 */
function fail(response, status, error, description, headers) {
	json(response, status, { error, error_description: description }, headers);
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {string} allow The one method the address answers to.
 */
function notAllowed(response, allow) {
	fail(response, 405, 'invalid_request', `Only ${allow} is allowed here.`, { allow });
}

// Run directly, as the container does, and not imported by a test.
if (import.meta.main) {
	const port = Number(process.env.PORT ?? 4000);
	const server = createMockOAuth();

	// 0.0.0.0, because inside a container the loopback address is not reachable from outside it.
	// Docker publishes the port on the host's loopback address only, which is what keeps this
	// from being reachable by anything else.
	server.listen(port, '0.0.0.0', () => {
		console.log(`mock-oauth: listening on 0.0.0.0:${port}`);
	});

	// Docker's stop sends SIGTERM and waits ten seconds for the process to end before it kills it.
	// A server that is only closed waits for every connection kept alive, so those are cut too.
	for (const signal of ['SIGTERM', 'SIGINT']) {
		process.once(signal, () => {
			server.close();
			server.closeAllConnections();
		});
	}
}
