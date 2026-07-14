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
const groups = [...source.matchAll(/group:\s*'([^']+)'/g)].map((match) => match[1]);

assert(names.length === 14, `Expected exactly 14 links, found ${names.length}.`);
assert(names.includes('XGWNJE'), 'Missing XGWNJE link.');
assert(names.includes('Dancncn / Dan_Arnoux'), 'Missing original author GitHub link.');
assert(names.includes('Magic UI'), 'Missing Magic UI effect-library link.');
assert(names.includes('Aceternity UI'), 'Missing Aceternity UI effect-library link.');
assert(names.includes('Animata'), 'Missing Animata effect-library link.');
assert(names.includes('Motion Primitives'), 'Missing Motion Primitives effect-library link.');
assert(names.includes('Fancy Components'), 'Missing Fancy Components effect-library link.');
assert(names.includes('Hover.dev'), 'Missing Hover.dev effect-library link.');
assert(names.includes('Codrops'), 'Missing Codrops inspiration link.');
assert(names.includes('21st.dev'), 'Missing 21st.dev inspiration link.');
assert(names.includes('Rive'), 'Missing Rive cross-platform link.');
assert(names.includes('Haze'), 'Missing Haze cross-platform link.');
assert(names.includes('Pow'), 'Missing Pow cross-platform link.');
assert(names.includes('Inferno'), 'Missing Inferno cross-platform link.');
assert(urls.length === 14, `Expected exactly 14 URL fields, found ${urls.length}.`);
assert(urls.includes('https://github.com/XGWNJE'), 'Missing XGWNJE GitHub URL.');
assert(urls.includes('https://github.com/Dancncn'), 'Missing Dancncn GitHub URL.');
assert(new Set(groups).size === 4, `Expected 4 link groups, found ${new Set(groups).size}.`);
for (const group of ['profiles', 'web-effects', 'inspiration', 'cross-platform']) {
	assert(groups.includes(group), `Missing ${group} link group.`);
}
assert(!source.includes('bilibili:'), 'Links data should not keep unused Bilibili fields.');
assert(!source.includes("kind: 'project'"), 'Links data should not keep obsolete project-only entries.');
assert(pageSource.includes('linkGroupDefinitions'), 'Page should define ordered link groups.');
assert(pageSource.includes("id: 'web-effects'"), 'Page should render the web effects group.');
assert(pageSource.includes("id: 'inspiration'"), 'Page should render the inspiration group.');
assert(pageSource.includes("id: 'cross-platform'"), 'Page should render the cross-platform group.');
assert(pageSource.includes('<LinkCard'), 'Page should reuse the shared link card component.');
assert(!pageSource.includes('data-friends-grid'), 'Page should not mix grouped links through the old friends pager.');
assert(!pageSource.includes('Friends & Projects'), 'Page metadata should not describe the page as friends and projects.');
assert(i18nSource.includes("'links.title': '链接'"), 'Chinese links page title should describe the broader links collection.');
assert(i18nSource.includes("'links.title': 'Links'"), 'English links page title should describe the broader links collection.');
assert(i18nSource.includes("'links.webEffects': '网页效果组件'"), 'Chinese web effects group label is missing.');
assert(i18nSource.includes("'links.webEffects': 'Web Effect Components'"), 'English web effects group label is missing.');
assert(pageSource.includes('links-page'), 'Links page should expose a page-level class for scoped responsive fixes.');
assert(pageSource.includes('overflow-wrap: anywhere'), 'Links page should allow long bilingual text to wrap on mobile.');
assert(pageSource.includes('word-break: break-word'), 'Links page should break long names or descriptions on mobile.');

if (failures.length) {
	console.error('[links-page] failed');
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log('[links-page] ok');
