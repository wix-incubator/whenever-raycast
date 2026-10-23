import { MCP_URL, SignInRequired, object } from './api.ts';

export const AUTHORIZE_URL = 'https://app.whenever.dev/_api/whenever-mcp/oauth/authorize';
type Tokens = { access_token: string; refresh_token: string; expires_in: number };
type StoredTokens = { accessToken: string; refreshToken?: string; isExpired(): boolean };
type TokenStore = {
	getTokens(): Promise<StoredTokens | undefined>;
	setTokens(tokens: Tokens): Promise<void>;
	removeTokens(): Promise<void>;
	getClientId(): Promise<string | undefined>;
	setClientId(id: string): Promise<void>;
};
export class Session {
	private store: TokenStore;
	private fetcher: typeof fetch;
	private refreshing?: Promise<string>;
	constructor(store: TokenStore, fetcher: typeof fetch = fetch) {
		this.store = store;
		this.fetcher = fetcher;
	}
	private async exchange(params: Record<string, string>): Promise<string> {
		const clientId = await this.store.getClientId();
		if (!clientId) throw new SignInRequired();
		const response = await this.fetcher(`${MCP_URL}oauth/token`, {
			method: 'POST',
			redirect: 'error',
			signal: AbortSignal.timeout(30000),
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ ...params, client_id: clientId, resource: MCP_URL }),
		});
		const tokens: unknown = await response.json();
		if (!response.ok) {
			if (
				object(tokens) &&
				(tokens.error === 'invalid_grant' || tokens.error === 'invalid_client')
			) {
				await this.store.removeTokens();
				throw new SignInRequired();
			}
			throw new Error('Sign-in is temporarily unavailable. Try again later.');
		}
		if (
			!object(tokens) ||
			typeof tokens.access_token !== 'string' ||
			!tokens.access_token ||
			typeof tokens.refresh_token !== 'string' ||
			!tokens.refresh_token ||
			typeof tokens.expires_in !== 'number' ||
			!Number.isFinite(tokens.expires_in) ||
			tokens.expires_in <= 0
		)
			throw new Error('Whenever returned an invalid token response.');
		await this.store.setTokens({
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token,
			expires_in: tokens.expires_in,
		});
		return tokens.access_token;
	}
	async accessToken(): Promise<string> {
		const tokens = await this.store.getTokens();
		if (!tokens) throw new SignInRequired();
		if (!tokens.isExpired()) return tokens.accessToken;
		if (!tokens.refreshToken) throw new SignInRequired();
		if (!this.refreshing)
			this.refreshing = this.exchange({
				grant_type: 'refresh_token',
				refresh_token: tokens.refreshToken,
			}).finally(() => {
				this.refreshing = undefined;
			});
		return this.refreshing;
	}
	async connect(input: { code: string; verifier: string; redirectURI: string }) {
		await this.exchange({
			grant_type: 'authorization_code',
			code: input.code,
			code_verifier: input.verifier,
			redirect_uri: input.redirectURI,
		});
	}
	async register(redirectURI: string): Promise<string> {
		await this.store.removeTokens();
		const response = await this.fetcher(`${MCP_URL}oauth/register`, {
			method: 'POST',
			redirect: 'error',
			signal: AbortSignal.timeout(30000),
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				client_name: 'Whenever for Raycast',
				redirect_uris: [redirectURI],
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
			}),
		});
		const result: unknown = await response.json();
		if (
			!response.ok ||
			!object(result) ||
			typeof result.client_id !== 'string' ||
			!result.client_id
		)
			throw new Error('Whenever could not register this Raycast connection.');
		await this.store.setClientId(result.client_id);
		return result.client_id;
	}
	async disconnect() {
		const clientId = await this.store.getClientId();
		const tokens = await this.store.getTokens();
		try {
			if (tokens && clientId) {
				const response = await this.fetcher(`${MCP_URL}oauth/revoke`, {
					method: 'POST',
					redirect: 'error',
					signal: AbortSignal.timeout(15000),
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: new URLSearchParams({
						token: tokens.refreshToken ?? tokens.accessToken,
						client_id: clientId,
					}),
				});
				if (!response.ok)
					throw new Error('Signed out locally, but server revocation could not be confirmed.');
			}
		} finally {
			await this.store.removeTokens();
		}
	}
}
