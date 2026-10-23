import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Session } from '../src/session.ts';

function setup({
	expired = false,
	response = { access_token: 'new', refresh_token: 'rotated', expires_in: 3600 },
	status = 200,
} = {}) {
	let stored = { accessToken: 'old', refreshToken: 'refresh', isExpired: () => expired };
	const requests = [];
	const session = new Session(
		{
			getClientId: async () => 'raycast-client',
			setClientId: async () => {},
			getTokens: async () => stored,
			setTokens: async (value) => {
				stored = {
					accessToken: value.access_token,
					refreshToken: value.refresh_token,
					isExpired: () => false,
				};
			},
			removeTokens: async () => {
				stored = undefined;
			},
		},
		async (url, options) => {
			requests.push({ url, body: new URLSearchParams(options.body) });
			return new Response(JSON.stringify(response), { status });
		},
	);
	return { session, requests, stored: () => stored };
}
test('uses a valid stored token without another request', async () => {
	const service = setup();
	assert.equal(await service.session.accessToken(), 'old');
	assert.equal(service.requests.length, 0);
});
test('rotates an expired token with resource and client binding', async () => {
	const service = setup({ expired: true });
	assert.deepEqual(
		await Promise.all([service.session.accessToken(), service.session.accessToken()]),
		['new', 'new'],
	);
	assert.equal(service.requests.length, 1);
	assert.equal(service.stored().refreshToken, 'rotated');
	assert.equal(service.requests[0].body.get('resource'), 'https://mcp.whenever.dev/');
	assert.equal(service.requests[0].body.get('client_id'), 'raycast-client');
});
test('clears a rejected grant and requires browser sign-in', async () => {
	const service = setup({ expired: true, status: 400, response: { error: 'invalid_grant' } });
	await assert.rejects(service.session.accessToken(), /Connect your Whenever account/);
	assert.equal(service.stored(), undefined);
});
test('keeps credentials after a temporary token-service failure', async () => {
	const service = setup({
		expired: true,
		status: 503,
		response: { error: 'temporarily_unavailable' },
	});
	await assert.rejects(service.session.accessToken(), /temporarily/);
	assert.equal(service.stored().refreshToken, 'refresh');
});
test('exchanges the browser authorization using PKCE and the exact redirect', async () => {
	const service = setup();
	await service.session.connect({
		code: 'code',
		verifier: 'verifier',
		redirectURI: 'https://raycast.com/redirect/extension',
	});
	const params = service.requests[0].body;
	assert.equal(params.get('code_verifier'), 'verifier');
	assert.equal(params.get('code'), 'code');
	assert.equal(params.get('redirect_uri'), 'https://raycast.com/redirect/extension');
	assert.equal(service.stored().accessToken, 'new');
});

test('binds PKCE exchange and refresh to the dynamically registered client', async () => {
	let clientId;
	let tokens;
	const requests = [];
	const session = new Session(
		{
			getClientId: async () => clientId,
			setClientId: async (value) => {
				clientId = value;
			},
			getTokens: async () => tokens,
			setTokens: async (value) => {
				tokens = {
					accessToken: value.access_token,
					refreshToken: value.refresh_token,
					isExpired: () => true,
				};
			},
			removeTokens: async () => {
				tokens = undefined;
			},
		},
		async (url, options) => {
			requests.push({ url, body: options.body });
			return new Response(
				JSON.stringify(
					url.endsWith('/register')
						? { client_id: 'registered-raycast' }
						: { access_token: 'new', refresh_token: 'refresh', expires_in: 3600 },
				),
			);
		},
	);
	const redirectURI = 'https://raycast.com/redirect?packageName=Extension';
	assert.equal(await session.register(redirectURI), 'registered-raycast');
	assert.deepEqual(JSON.parse(requests[0].body).redirect_uris, [redirectURI]);
	await session.connect({ code: 'one-use', verifier: 'pkce', redirectURI });
	await session.accessToken();
	assert.equal(requests[1].body.get('client_id'), 'registered-raycast');
	assert.equal(requests[1].body.get('redirect_uri'), redirectURI);
	assert.equal(requests[2].body.get('client_id'), 'registered-raycast');
	assert.equal(requests[2].body.get('grant_type'), 'refresh_token');
});

test('clears native tokens even when remote revocation fails', async () => {
	const service = setup({ status: 503 });
	await assert.rejects(service.session.disconnect(), /revocation/);
	assert.equal(service.stored(), undefined);
});
