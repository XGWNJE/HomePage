interface TurnstileApi {
	ready(callback: () => void): void;
	render(container: HTMLElement, options: { sitekey: string }): string;
	getResponse(widgetId: string): string;
	reset(widgetId: string): void;
	remove(widgetId: string): void;
}

declare global {
	interface Window {
		turnstile?: TurnstileApi;
	}
}

const SCRIPT_ID = 'xgwnje-turnstile-api';
let scriptPromise: Promise<TurnstileApi> | null = null;
const widgetPromises = new WeakMap<HTMLElement, Promise<string | null>>();

function waitForReady(): Promise<TurnstileApi> {
	return new Promise((resolve, reject) => {
		const turnstile = window.turnstile;
		if (!turnstile) return reject(new Error('Turnstile API is unavailable'));
		turnstile.ready(() => resolve(turnstile));
	});
}

function loadTurnstile(): Promise<TurnstileApi> {
	if (window.turnstile) return waitForReady();
	if (scriptPromise) return scriptPromise;

	scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
		const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
		const script = existing ?? document.createElement('script');
		const onLoad = () => waitForReady().then(resolve, reject);
		const onError = () => {
			script.remove();
			reject(new Error('Unable to load Turnstile'));
		};

		script.addEventListener('load', onLoad, { once: true });
		script.addEventListener('error', onError, { once: true });
		if (!existing) {
			script.id = SCRIPT_ID;
			script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
			script.async = true;
			script.defer = true;
			document.head.append(script);
		}
	}).catch((error) => {
		document.getElementById(SCRIPT_ID)?.remove();
		scriptPromise = null;
		throw error;
	});

	return scriptPromise;
}

export function renderTurnstile(container: HTMLElement): Promise<string | null> {
	const existing = widgetPromises.get(container);
	if (existing) return existing;
	const rendering = renderTurnstileOnce(container).catch((error) => {
		widgetPromises.delete(container);
		throw error;
	});
	widgetPromises.set(container, rendering);
	return rendering;
}

async function renderTurnstileOnce(container: HTMLElement): Promise<string | null> {
	const sitekey = container.dataset.sitekey;
	if (!sitekey || !container.isConnected) return null;
	const turnstile = await loadTurnstile();
	if (!container.isConnected) return null;
	const widgetId = turnstile.render(container, { sitekey });
	if (!container.isConnected) {
		turnstile.remove(widgetId);
		return null;
	}
	return widgetId;
}

export function getTurnstileToken(widgetId: string | null): string {
	return widgetId && window.turnstile ? window.turnstile.getResponse(widgetId) : '';
}

export function resetTurnstile(widgetId: string | null): void {
	if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
}

export function removeTurnstile(widgetId: string | null): void {
	if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
}
