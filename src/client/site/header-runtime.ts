import { initHeaderAuth } from './header-auth';
import { initRssDropdown, initThemeControls } from './header-controls';

let started = false;

const initializeHeader = (): void => {
	void initHeaderAuth();
	initThemeControls();
	initRssDropdown();
};

export const startHeaderRuntime = (): void => {
	initializeHeader();
	if (started) return;
	started = true;
	document.addEventListener('astro:page-load', initializeHeader);
	document.addEventListener('astro:after-swap', initializeHeader);
};
