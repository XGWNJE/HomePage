import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const read = (file: string) => readFile(path.resolve(file), 'utf8');

test('Turnstile uses one explicit-render lifecycle shared by login and contact forms', async () => {
	const [lifecycle, login, contact] = await Promise.all([
		read('src/lib/turnstile.ts'),
		read('src/components/LoginModal.astro'),
		read('src/components/ContactModal.astro'),
	]);

	assert.match(lifecycle, /api\.js\?render=explicit/);
	assert.match(lifecycle, /turnstile\.render/);
	assert.match(lifecycle, /turnstile\.reset/);
	assert.match(lifecycle, /turnstile\.remove/);
	for (const component of [login, contact]) {
		assert.match(component, /astro:page-load/);
		assert.match(component, /astro:before-swap/);
		assert.match(component, /resetTurnstile/);
		assert.doesNotMatch(component, /getResponse\(i\)/);
	}
});

test('Turnstile removes a failed script so the next render can retry', async () => {
	const globals = globalThis as any;
	const originalWindow = globals.window;
	const originalDocument = globals.document;
	const scripts: any[] = [];
	let activeScript: any = null;
	const createScript = () => {
		const listeners = new Map<string, (event?: unknown) => void>();
		return {
			id: '', src: '', async: false, defer: false, removed: false,
			addEventListener(type: string, listener: (event?: unknown) => void) { listeners.set(type, listener); },
			dispatch(type: string) { listeners.get(type)?.(); },
			remove() { this.removed = true; if (activeScript === this) activeScript = null; },
		};
	};

	try {
		globals.window = {};
		globals.document = {
			getElementById: () => activeScript,
			createElement: () => createScript(),
			head: { append(script: any) { activeScript = script; scripts.push(script); } },
		};
		const { renderTurnstile } = await import('../src/lib/turnstile');
		const container = { dataset: { sitekey: 'test-site' }, isConnected: true } as unknown as HTMLElement;
		const first = renderTurnstile(container);
		scripts[0].dispatch('load');
		await assert.rejects(first, /Turnstile API is unavailable/);
		assert.equal(scripts[0].removed, true);

		const second = renderTurnstile(container);
		globals.window.turnstile = {
			ready(callback: () => void) { callback(); },
			render() { return 'widget-after-retry'; },
			getResponse() { return ''; },
			reset() {},
			remove() {},
		};
		scripts[1].dispatch('load');
		assert.equal(await second, 'widget-after-retry');
	} finally {
		globals.window = originalWindow;
		globals.document = originalDocument;
	}
});
