import { version } from '$app/env';

/**
 * Answers "is this server up, and which build is it?" for a container's health check, a load
 * balancer, or a person checking a deployment. It touches nothing but the process itself, so it
 * says the server can answer requests, and nothing about services the server may come to depend
 * on. The version is the build's own identifier, which changes with every build.
 */
export function GET() {
	return Response.json({ status: 'ok', version }, { headers: { 'cache-control': 'no-store' } });
}
