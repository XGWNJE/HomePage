import { readFileSync } from 'node:fs';

const source = readFileSync('src/data/links.ts', 'utf8');
const pageSource = readFileSync('src/pages/links/index.astro', 'utf8');
const i18nSource = readFileSync('src/data/i18n.ts', 'utf8');
const failures = [];
const assert = (condition, message) => {
	if (!condition) failures.push(message);
};

const names = [...source.matchAll(/name:\s*'([^']+)'/g)].map((match) => match[1]);
const urls = [...source.matchAll(/url:\s*'([^']*)'/g)].map((match) => match[1]);
const kinds = [...source.matchAll(/kind:\s*'([^']+)'/g)].map((match) => match[1]);

assert(names.length === 2, `Expected exactly 2 links, found ${names.length}.`);
assert(names.includes('XGWNJE'), 'Missing XGWNJE link.');
assert(names.includes('Dancncn / Dan_Arnoux'), 'Missing original author GitHub link.');
assert(urls.length === 2, `Expected exactly 2 URL fields, found ${urls.length}.`);
assert(urls.includes('https://github.com/XGWNJE'), 'Missing XGWNJE GitHub URL.');
assert(urls.includes('https://github.com/Dancncn'), 'Missing Dancncn GitHub URL.');
assert(kinds.every((kind) => kind === 'github'), 'All remaining links should be GitHub links.');
assert(!source.includes('bilibili:'), 'Links page should not keep Bilibili fields.');
assert(!source.includes("kind: 'project'"), 'Links page should not keep project entries.');
assert(!source.includes('项目'), 'GitHub-only link descriptions should not mention projects.');
assert(pageSource.includes('{projectLinks.length > 0 && ('), 'Projects section should be hidden when empty.');
assert(pageSource.includes('{friendPageCount > 1 && ('), 'Pager should be hidden when there is only one friends page.');
assert(
	pageSource.includes('if (!prevButton || !nextButton || !status) return;'),
	'Friends grid should still render when pager controls are omitted.'
);
assert(!pageSource.includes('Friends & Projects'), 'Page metadata should no longer describe the page as friends and projects.');
assert(!pageSource.includes('interesting projects'), 'Page metadata should not mention generic project recommendations.');
assert(!i18nSource.includes("'links.accent': '与项目'"), 'Chinese links page heading should not mention projects.');
assert(!i18nSource.includes("'links.accent': '& Projects'"), 'English links page heading should not mention projects.');
assert(i18nSource.includes("'links.title': 'GitHub'"), 'Links page title should be GitHub-focused.');
assert(i18nSource.includes("'links.friends': 'GitHub 主页'"), 'Chinese section label should describe GitHub profiles.');
assert(i18nSource.includes("'links.friends': 'GitHub Profiles'"), 'English section label should describe GitHub profiles.');
assert(pageSource.includes('links-page'), 'Links page should expose a page-level class for scoped responsive fixes.');
assert(pageSource.includes('overflow-wrap: anywhere'), 'Links page should allow long bilingual text to wrap on mobile.');
assert(pageSource.includes('word-break: break-word'), 'Links page should break long profile names or descriptions on mobile.');

if (failures.length) {
	console.error('[links-page] failed');
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log('[links-page] ok');
