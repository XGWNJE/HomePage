import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('global styles keep tokens and visual polish in explicit modules', async () => {
	const globalStyles = await readFile('src/styles/global.css', 'utf8');
	const tokens = await readFile('src/styles/tokens.css', 'utf8');
	const polish = await readFile('src/styles/polish.css', 'utf8');
	const head = await readFile('src/components/BaseHead.astro', 'utf8');

	assert.match(globalStyles, /@import "\.\/tokens\.css";/);
	assert.doesNotMatch(globalStyles, /polish\.css/);
	assert(head.indexOf("import '../styles/global.css'") < head.indexOf("import '../styles/polish.css'"));
	assert(globalStyles.split(/\r?\n/).length < 1200, 'global.css should remain a focused entry and core component layer');
	assert.match(tokens, /--brand-gold-600-rgb/);
	assert.match(polish, /Design Polish Layer/);
	assert.match(polish, /Reduced motion/);
});
