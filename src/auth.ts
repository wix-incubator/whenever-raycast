import { randomUUID } from 'node:crypto';
import { LocalStorage, OAuth } from '@raycast/api';
import { Session, AUTHORIZE_URL } from './session';
import { MCP_URL, SignInRequired, WheneverClient } from './api';

const oauth = new OAuth.PKCEClient({
	redirectMethod: OAuth.RedirectMethod.Web,
	providerName: 'Whenever',
	providerIcon: 'icon.png',
	description: 'Connect Whenever to find workflows and run the saved versions you select.',
});
export const session = new Session({
	getTokens: () => oauth.getTokens(),
	setTokens: (tokens) => oauth.setTokens(tokens),
	removeTokens: () => oauth.removeTokens(),
	getClientId: () => LocalStorage.getItem<string>('oauth-client-id'),
	setClientId: (id) => LocalStorage.setItem('oauth-client-id', id),
});
export const api = new WheneverClient(() => session.accessToken());
const SESSION_KEY = 'connected-session';
export async function accountKey(): Promise<string> {
	if (!(await oauth.getTokens())) throw new SignInRequired();
	const key = await LocalStorage.getItem<string>(SESSION_KEY);
	if (!key) throw new SignInRequired();
	return key;
}
export async function connect() {
	const preliminary = await oauth.authorizationRequest({
		endpoint: AUTHORIZE_URL,
		clientId: 'registration-preview',
		scope: 'whenever',
	});
	const clientId = await session.register(preliminary.redirectURI);
	const request = await oauth.authorizationRequest({
		clientId,
		endpoint: AUTHORIZE_URL,
		scope: 'whenever',
		extraParameters: { resource: MCP_URL },
	});
	const { authorizationCode } = await oauth.authorize(request);
	await session.connect({
		code: authorizationCode,
		verifier: request.codeVerifier,
		redirectURI: request.redirectURI,
	});
	await LocalStorage.setItem(SESSION_KEY, randomUUID());
}
export async function disconnect() {
	const key = await LocalStorage.getItem<string>(SESSION_KEY);
	try {
		await session.disconnect();
	} finally {
		if (key) await LocalStorage.removeItem(`activity:${key}`);
		await LocalStorage.removeItem(SESSION_KEY);
	}
}
