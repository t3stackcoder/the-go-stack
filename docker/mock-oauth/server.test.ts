// The mock stands in for three providers during development, so what these pin is that it keeps
// the promises a real provider makes: a code that works once, for the client and address it was
// issued to, with the verifier that goes with it. A mock that is too lenient hides a fault in the
// app's own client until production, and one that is too strict fails sign-in for no reason the
// app could find. Each test goes through a real socket, because the redirects, headers and
// status codes are what the client sees.

import { createHash, randomBytes } from 'node:crypto';
import { type AddressInfo, connect } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CLIENTS, createMockOAuth, PEOPLE, PROVIDERS } from './server.js';

type Provider = (typeof PROVIDERS)[number];

const CALLBACK = 'http://localhost:3000/api/auth/oauth2/callback/mock';

let clock = 0;
const server = createMockOAuth({ now: () => clock });
let base = '';

beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
	clock = Date.now();
});

function pkce() {
	const verifier = randomBytes(32).toString('base64url');
	return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** An authorise request that is right in every way, unless `query` says otherwise. */
function authorise(provider: string, query: Record<string, string | undefined> = {}) {
	const params = new URLSearchParams();
	const full = {
		response_type: 'code',
		client_id: CLIENTS[provider as Provider]?.clientId,
		redirect_uri: CALLBACK,
		state: 'state-1',
		code_challenge: pkce().challenge,
		code_challenge_method: 'S256',
		...query
	};
	for (const [name, value] of Object.entries(full)) {
		if (value !== undefined) params.set(name, value);
	}
	return fetch(`${base}/${provider}/authorize?${params}`, { redirect: 'manual' });
}

/** Authorises and returns the code, with the verifier that goes with it. */
async function authorised(provider: Provider, query: Record<string, string | undefined> = {}) {
	const { verifier, challenge } = pkce();
	const response = await authorise(provider, { code_challenge: challenge, ...query });
	expect(response.status).toBe(302);
	const code = new URL(response.headers.get('location') as string).searchParams.get('code');
	return { code: code as string, verifier };
}

/** A token request that is right in every way, unless `form` says otherwise. */
function exchange(
	provider: string,
	form: Record<string, string | undefined>,
	headers: Record<string, string> = {}
) {
	const params = new URLSearchParams();
	const full = {
		grant_type: 'authorization_code',
		client_id: CLIENTS[provider as Provider]?.clientId,
		client_secret: CLIENTS[provider as Provider]?.clientSecret,
		redirect_uri: CALLBACK,
		...form
	};
	for (const [name, value] of Object.entries(full)) {
		if (value !== undefined) params.set(name, value);
	}
	return fetch(`${base}/${provider}/token`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
		body: params
	});
}

/** The whole way to an access token. */
async function signedIn(provider: Provider) {
	const { code, verifier } = await authorised(provider);
	const response = await exchange(provider, { code, code_verifier: verifier });
	expect(response.status).toBe(200);
	return ((await response.json()) as { access_token: string }).access_token;
}

function userinfo(provider: string, token?: string) {
	return fetch(`${base}/${provider}/userinfo`, {
		headers: token === undefined ? {} : { authorization: `Bearer ${token}` }
	});
}

async function error(response: Response) {
	return ((await response.json()) as { error: string }).error;
}

describe('the people', () => {
	// The app links a provider to an existing user only when the email matches, and the demo of that
	// needs two providers that agree and one that does not. Do not make them all distinct, or all alike.
	it('are the same at Google and GitHub, apart from the id, and someone else at Facebook', () => {
		expect(PEOPLE.google.email).toBe(PEOPLE.github.email);
		expect(PEOPLE.google.name).toBe(PEOPLE.github.name);
		expect(PEOPLE.google.id).not.toBe(PEOPLE.github.id);
		expect(PEOPLE.facebook.email).not.toBe(PEOPLE.google.email);
		for (const person of Object.values(PEOPLE)) expect(person.email).toMatch(/@example\.com$/);
	});
});

describe('the code flow', () => {
	it.each(PROVIDERS)('signs a person in at %s', async (provider) => {
		const { verifier, challenge } = pkce();
		const authorising = await authorise(provider, { code_challenge: challenge });

		expect(authorising.status).toBe(302);
		const location = new URL(authorising.headers.get('location') as string);
		expect(`${location.origin}${location.pathname}`).toBe(CALLBACK);
		expect(location.searchParams.get('state')).toBe('state-1');
		const code = location.searchParams.get('code') as string;
		expect(code).toBeTruthy();

		const exchanging = await exchange(provider, { code, code_verifier: verifier });
		expect(exchanging.status).toBe(200);
		expect(exchanging.headers.get('cache-control')).toBe('no-store');
		const tokens = (await exchanging.json()) as Record<string, unknown>;
		expect(tokens).toMatchObject({
			token_type: 'Bearer',
			expires_in: 3600,
			scope: 'openid profile email'
		});
		expect(tokens.access_token).toBeTruthy();
		expect(tokens.refresh_token).toBeTruthy();

		const person = await userinfo(provider, tokens.access_token as string);
		expect(person.status).toBe(200);
		expect(await person.json()).toEqual(PEOPLE[provider]);
	});

	it('keeps what the redirect address already carries, and hands back the scope asked for', async () => {
		const redirect = `${CALLBACK}?next=%2Fhome`;
		const { verifier, challenge } = pkce();
		const response = await authorise('google', {
			redirect_uri: redirect,
			code_challenge: challenge,
			scope: 'email'
		});
		const location = new URL(response.headers.get('location') as string);
		expect(location.searchParams.get('next')).toBe('/home');

		const tokens = await exchange('google', {
			code: location.searchParams.get('code') as string,
			code_verifier: verifier,
			redirect_uri: redirect
		});
		expect(await tokens.json()).toMatchObject({ scope: 'email' });
	});

	it('accepts the client secret as HTTP Basic, and refuses it given both ways', async () => {
		const { clientId, clientSecret } = CLIENTS.github;
		const basic = { authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` };
		const none = { client_id: undefined, client_secret: undefined };

		const first = await authorised('github');
		const accepted = await exchange(
			'github',
			{ ...none, code: first.code, code_verifier: first.verifier },
			basic
		);
		expect(accepted.status).toBe(200);

		const second = await authorised('github');
		const both = await exchange(
			'github',
			{ ...none, client_secret: clientSecret, code: second.code, code_verifier: second.verifier },
			basic
		);
		expect(both.status).toBe(400);
		expect(await error(both)).toBe('invalid_request');
	});
});

describe('the token endpoint refuses', () => {
	it('a wrong client secret, and spends the code on it', async () => {
		const { code, verifier } = await authorised('google');

		const wrong = await exchange('google', {
			code,
			code_verifier: verifier,
			client_secret: 'not-the-secret'
		});
		expect(wrong.status).toBe(401);
		expect(wrong.headers.get('www-authenticate')).toMatch(/^Basic /);
		expect(await error(wrong)).toBe('invalid_client');

		const retry = await exchange('google', { code, code_verifier: verifier });
		expect(await error(retry)).toBe('invalid_grant');
	});

	it('a code that has been used', async () => {
		const { code, verifier } = await authorised('google');
		const first = await exchange('google', { code, code_verifier: verifier });
		expect(first.status).toBe(200);

		const again = await exchange('google', { code, code_verifier: verifier });
		expect(again.status).toBe(400);
		expect(await error(again)).toBe('invalid_grant');
	});

	it('a code that has expired, at a minute and not before', async () => {
		const early = await authorised('google');
		const late = await authorised('google');

		clock += 59_999;
		const inTime = await exchange('google', { code: early.code, code_verifier: early.verifier });
		expect(inTime.status).toBe(200);

		clock += 1;
		const expired = await exchange('google', { code: late.code, code_verifier: late.verifier });
		expect(expired.status).toBe(400);
		expect(await error(expired)).toBe('invalid_grant');
	});

	it('a wrong PKCE verifier, and spends the code on it', async () => {
		const { code, verifier } = await authorised('facebook');

		const wrong = await exchange('facebook', { code, code_verifier: pkce().verifier });
		expect(wrong.status).toBe(400);
		expect(await error(wrong)).toBe('invalid_grant');

		const retry = await exchange('facebook', { code, code_verifier: verifier });
		expect(await error(retry)).toBe('invalid_grant');
	});

	it('a redirect address that is not the one the code was issued for', async () => {
		const { code, verifier } = await authorised('google');
		const response = await exchange('google', {
			code,
			code_verifier: verifier,
			redirect_uri: 'http://localhost:3000/somewhere/else'
		});
		expect(response.status).toBe(400);
		expect(await error(response)).toBe('invalid_grant');
	});

	it('a code that another provider issued', async () => {
		const { code, verifier } = await authorised('google');
		const response = await exchange('github', { code, code_verifier: verifier });
		expect(await error(response)).toBe('invalid_grant');
	});

	it('any grant but the code grant, a repeated parameter and a body that is too big', async () => {
		const refresh = await exchange('google', { grant_type: 'refresh_token' });
		expect(refresh.status).toBe(400);
		expect(await error(refresh)).toBe('unsupported_grant_type');

		const twice = await fetch(`${base}/google/token`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: 'grant_type=authorization_code&grant_type=authorization_code'
		});
		expect(twice.status).toBe(400);
		expect(await error(twice)).toBe('invalid_request');

		const big = await exchange('google', { padding: 'x'.repeat(5000) });
		expect(big.status).toBe(413);
	});

	it('a body that is too big when it does not say how big it is going to be', async () => {
		const chunks = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('x'.repeat(3000)));
				controller.enqueue(new TextEncoder().encode('x'.repeat(3000)));
				controller.close();
			}
		});
		const response = await fetch(`${base}/google/token`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: chunks,
			duplex: 'half'
		} as RequestInit);
		expect(response.status).toBe(413);
	});
});

describe('the authorise endpoint', () => {
	it.each([
		['another host', 'https://evil.example/callback'],
		['a look-alike host', 'http://localhost.evil.example/callback'],
		['a host hidden behind credentials', 'http://localhost@evil.example/callback'],
		['another scheme', 'myapp://localhost/callback'],
		['a fragment', `${CALLBACK}#fragment`],
		['nothing at all', '']
	])('does not redirect to %s, and says why in its own response', async (_, redirect) => {
		const response = await authorise('google', { redirect_uri: redirect });
		expect(response.status).toBe(400);
		expect(response.headers.get('location')).toBeNull();
		expect(await error(response)).toBe('invalid_request');
	});

	it.each([
		'http://localhost:5173/callback',
		'https://127.0.0.1/callback',
		'http://[::1]:8080/callback'
	])('redirects to the loopback address %s', async (redirect) => {
		const response = await authorise('google', { redirect_uri: redirect });
		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toMatch(
			/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/
		);
	});

	it('does not redirect for a client it does not know', async () => {
		const response = await authorise('google', { client_id: CLIENTS.github.clientId });
		expect(response.status).toBe(400);
		expect(response.headers.get('location')).toBeNull();
	});

	// The redirect address is trusted by now, so these go back to the app, with the state, and the
	// app is told its visitor's sign-in did not happen.
	it.each([
		['no PKCE challenge', { code_challenge: undefined }, 'invalid_request'],
		['a PKCE challenge that is not S256', { code_challenge_method: 'plain' }, 'invalid_request'],
		['a response type that is not code', { response_type: 'token' }, 'unsupported_response_type']
	])('sends %s back to the app as an error', async (_, query, expected) => {
		const response = await authorise('google', query);
		expect(response.status).toBe(302);
		const location = new URL(response.headers.get('location') as string);
		expect(`${location.origin}${location.pathname}`).toBe(CALLBACK);
		expect(location.searchParams.get('error')).toBe(expected);
		expect(location.searchParams.get('state')).toBe('state-1');
		expect(location.searchParams.has('code')).toBe(false);
	});
});

describe('the userinfo endpoint', () => {
	it('does not take one provider’s token at another', async () => {
		const token = await signedIn('google');
		expect((await userinfo('google', token)).status).toBe(200);

		const response = await userinfo('github', token);
		expect(response.status).toBe(401);
		expect(response.headers.get('www-authenticate')).toBe(
			'Bearer realm="mock-oauth", error="invalid_token"'
		);
	});

	it('refuses a token it does not know, and one that has expired', async () => {
		const unknown = await userinfo('google', 'made-up');
		expect(unknown.status).toBe(401);
		expect(await error(unknown)).toBe('invalid_token');

		const token = await signedIn('google');
		clock += 3_600_000;
		const expired = await userinfo('google', token);
		expect(expired.status).toBe(401);
		expect(await error(expired)).toBe('invalid_token');
	});

	it('refuses a request with no token', async () => {
		const response = await userinfo('google');
		expect(response.status).toBe(401);
		expect(response.headers.get('www-authenticate')).toBe('Bearer realm="mock-oauth"');
	});
});

describe('everything else', () => {
	it('is refused in the OAuth error shape', async () => {
		const provider = await fetch(`${base}/twitter/authorize`, { redirect: 'manual' });
		expect(provider.status).toBe(404);
		expect(await provider.json()).toEqual({
			error: 'not_found',
			error_description: expect.any(String)
		});

		expect((await fetch(`${base}/twitter/token`, { method: 'POST' })).status).toBe(404);
		expect((await userinfo('twitter', 'token')).status).toBe(404);
		expect((await fetch(`${base}/google/nowhere`)).status).toBe(404);
		expect((await fetch(`${base}/google/token/extra`)).status).toBe(404);

		const method = await fetch(`${base}/google/token`);
		expect(method.status).toBe(405);
		expect(method.headers.get('allow')).toBe('POST');
		expect(await error(method)).toBe('invalid_request');
		expect((await fetch(`${base}/google/userinfo`, { method: 'POST' })).headers.get('allow')).toBe(
			'GET'
		);
	});

	it('does not stop for an address or an encoding it cannot read', async () => {
		// A raw request, because `fetch` would tidy both before sending.
		const raw = (path: string) =>
			new Promise<string>((resolve, reject) => {
				const socket = connect(Number(new URL(base).port), '127.0.0.1', () =>
					socket.write(`GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`)
				);
				let text = '';
				socket.on('data', (data) => {
					text += data;
				});
				socket.on('end', () => resolve(text));
				socket.on('error', reject);
			});

		expect(await raw('/google/authorize?state=%E0%A4%A&client_id=%')).toMatch(/^HTTP\/1.1 400 /);
		expect(await raw('//%zz')).toMatch(/^HTTP\/1.1 400 /);
		expect((await fetch(`${base}/healthz`)).status).toBe(200);
	});

	it('answers a health check', async () => {
		const response = await fetch(`${base}/healthz`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'ok' });
	});
});
