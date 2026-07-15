import { createHash } from 'node:crypto';

import { base64Url } from './request.js';

export function githubPkceChallenge(verifier) {
	return base64Url(createHash('sha256').update(verifier).digest());
}

export function githubAuthorizeUrl(config, { state, verifier, redirectUri, prompt = '', login = '' }) {
	const authorize = new URL('https://github.com/login/oauth/authorize');
	authorize.searchParams.set('client_id', config.githubClientId);
	authorize.searchParams.set('redirect_uri', redirectUri);
	authorize.searchParams.set('scope', 'read:user user:email');
	authorize.searchParams.set('state', state);
	authorize.searchParams.set('code_challenge', githubPkceChallenge(verifier));
	authorize.searchParams.set('code_challenge_method', 'S256');
	if (prompt) authorize.searchParams.set('prompt', prompt);
	if (login) authorize.searchParams.set('login', login);
	return authorize;
}

export async function exchangeGithubIdentity(config, fetchImpl, { code, verifier, redirectUri }) {
	const tokenPayload = new URLSearchParams({
		client_id: config.githubClientId,
		client_secret: config.githubClientSecret,
		code,
		code_verifier: verifier,
		redirect_uri: redirectUri,
	});
	const tokenResponse = await fetchImpl('https://github.com/login/oauth/access_token', {
		method: 'POST',
		headers: {
			accept: 'application/json',
			'content-type': 'application/x-www-form-urlencoded',
			'user-agent': 'homepage-api',
		},
		body: tokenPayload,
	});
	if (!tokenResponse.ok) throw new Error('GitHub token exchange failed');
	const tokenData = await tokenResponse.json();
	if (!tokenData.access_token) throw new Error('GitHub token missing');

	const ghResponse = await fetchImpl('https://api.github.com/user', {
		headers: {
			accept: 'application/vnd.github+json',
			authorization: `Bearer ${tokenData.access_token}`,
			'user-agent': 'homepage-api',
		},
	});
	if (!ghResponse.ok) throw new Error('GitHub user lookup failed');
	const ghUser = await ghResponse.json();
	if (!ghUser?.id || !ghUser?.login) throw new Error('GitHub user response invalid');
	return ghUser;
}
