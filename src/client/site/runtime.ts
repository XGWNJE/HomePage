import { initAuthBridge, refreshGithubLoginLinks } from './auth';
import { initCursor } from './cursor';
import { initI18n } from './i18n';
import { initPolish } from './polish';
import { installViewCountBridge } from './view-count';

let started = false;

const refreshRouteState = (): void => {
	initAuthBridge();
	initI18n();
	installViewCountBridge();
	refreshGithubLoginLinks();
};

export const startSiteRuntime = (): void => {
	refreshRouteState();
	initCursor();
	initPolish();
	if (started) return;
	started = true;
	document.addEventListener('astro:page-load', refreshRouteState);
	document.addEventListener('astro:after-swap', refreshRouteState);
};
