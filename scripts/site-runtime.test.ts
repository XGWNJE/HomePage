import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { getNavigationDirection } from '../src/client/site/polish';
import { formatCompactViewCount, formatFullViewCount } from '../src/client/site/view-count';

const read = (relativePath: string) => readFile(path.resolve(relativePath), 'utf8');

test('view count formatting stays stable after runtime extraction', () => {
	assert.equal(formatCompactViewCount(0), '0');
	assert.equal(formatCompactViewCount(999), '999');
	assert.equal(formatCompactViewCount(1250), '1.3k');
	assert.equal(formatCompactViewCount(12000), '12k');
	assert.equal(formatFullViewCount(1), '1 次浏览');
	assert.equal(formatFullViewCount(12), '12 次浏览');
});

test('directional transitions follow the primary navigation order', () => {
	const origin = 'https://xgwnje.cn';
	assert.equal(getNavigationDirection(new URL('/', origin), new URL('/blog/', origin)), 'forward');
	assert.equal(getNavigationDirection(new URL('/about/', origin), new URL('/tags/', origin)), 'back');
	assert.equal(getNavigationDirection(new URL('/blog/a/', origin), new URL('/blog/b/', origin)), null);
	assert.equal(getNavigationDirection(new URL('/unknown/', origin), new URL('/blog/', origin)), null);
});

test('BaseHead and Header delegate browser behavior to typed runtimes', async () => {
	const [head, header] = await Promise.all([
		read('src/components/BaseHead.astro'),
		read('src/components/Header.astro'),
	]);

	assert.match(head, /startSiteRuntime/);
	assert.match(header, /startHeaderRuntime/);
	assert.match(head, /Apply theme before hydration/);
	assert.doesNotMatch(head, /__cursorScriptInit|__polishScriptInit|__githubLoginLinkBound|__TOKEN_KEY/);
	assert.doesNotMatch(header, /setTimeout\(initAuthButton|window\.__auth|window\.__syncThemeColor/);
	assert.equal((head.match(/<script is:inline>/g) ?? []).length, 1, 'only the pre-paint theme script should stay inline');
});

test('legacy globals are isolated to explicit compatibility bridges', async () => {
	const [auth, i18n, views, cursor, polish] = await Promise.all([
		read('src/client/site/auth.ts'),
		read('src/client/site/i18n.ts'),
		read('src/client/site/view-count.ts'),
		read('src/client/site/cursor.ts'),
		read('src/client/site/polish.ts'),
	]);
	const runtimeSource = [auth, i18n, views, cursor, polish].join('\n');
	const globals = [...runtimeSource.matchAll(/window\.(__[A-Za-z0-9_]+)/g)].map((match) => match[1]);
	assert.deepEqual([...new Set(globals)].sort(), [
		'__API_BASE',
		'__auth',
		'__formatCompactViewCount',
		'__formatFullViewCount',
		'__xgwnjeI18n',
	]);
	assert.match(auth, /from ['"]\.\.\/\.\.\/lib\/auth['"]/);
	assert.match(auth, /getAuthToken: getToken/);
});
