import { readFileSync } from 'node:fs';

const header = readFileSync('src/components/Header.astro', 'utf8');

const failures = [];
const assert = (condition, message) => {
	if (!condition) failures.push(message);
};
const elementSnippet = (id) => {
	const idIndex = header.indexOf(`id="${id}"`);
	if (idIndex === -1) return '';
	const start = Math.max(0, header.lastIndexOf('<', idIndex));
	const end = header.indexOf('>', idIndex);
	return end === -1 ? header.slice(start, idIndex + id.length) : header.slice(start, end + 1);
};
const hasClass = (id, className) => {
	const snippet = elementSnippet(id);
	const classMatch = snippet.match(/class="([^"]*)"/);
	return Boolean(classMatch?.[1].split(/\s+/).includes(className));
};

assert(!header.includes('BLOG_REPO_URL'), 'Header should not define a blog repository shortcut.');
assert(!header.includes('source.blogRepo'), 'Header should not expose the blog repository shortcut i18n key.');
assert(!header.includes('https://github.com/XGWNJE/HomePage'), 'Header should not link to the blog repository.');

assert(
	hasClass('header-actions', 'min-w-0'),
	'Header actions container should be allowed to shrink on narrow screens.'
);
assert(
	hasClass('rss-dropdown', 'max-[430px]:hidden'),
	'RSS control should fold away on very narrow mobile widths.'
);
assert(
	hasClass('github-link-mobile', 'max-[520px]:hidden'),
	'Mobile GitHub shortcut should fold away before the header becomes cramped.'
);
assert(
	!hasClass('theme-toggle-mobile', 'max-[520px]:hidden'),
	'Theme toggle should stay available on narrow mobile widths.'
);

if (failures.length) {
	console.error('[header-responsive] failed');
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log('[header-responsive] ok');
