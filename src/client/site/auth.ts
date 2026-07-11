import {
	getToken,
	getUser,
	logout,
	storeTokenFromHash,
} from '../../lib/auth';
import { API_BASE } from '../../lib/config';

let loginDelegationBound = false;

export const getGithubLoginUrl = (): string => {
	const url = new URL(`${API_BASE}/api/auth/github/start`);
	url.searchParams.set('returnTo', window.location.origin + window.location.pathname + window.location.search);
	url.searchParams.set('t', String(Date.now()));
	return url.toString();
};

export const startGithubLogin = (): void => {
	window.location.assign(getGithubLoginUrl());
};

export const refreshGithubLoginLinks = (): void => {
	document.querySelectorAll<HTMLAnchorElement>('[data-github-login]').forEach((link) => {
		link.href = getGithubLoginUrl();
	});
};

export const authBridge = {
	storeTokenFromHash,
	getAuthToken: getToken,
	getCurrentUser: getUser,
	logout,
	getGithubLoginUrl,
	startGithubLogin,
};

export const initAuthBridge = (): void => {
	window.__API_BASE = API_BASE;
	window.__auth = authBridge;
	storeTokenFromHash();
	refreshGithubLoginLinks();

	if (loginDelegationBound) return;
	loginDelegationBound = true;
	document.addEventListener('click', (event) => {
		const loginLink = event.target instanceof Element
			? event.target.closest('[data-github-login]')
			: null;
		if (!loginLink) return;
		event.preventDefault();
		startGithubLogin();
	});
};
