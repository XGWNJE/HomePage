import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const contentConfig = read('src/content.config.ts');
const loader = read('src/content/blogWithJournalLoader.ts');
const tabs = read('src/components/BlogViewTabs.astro');
const digestedPage = read('src/pages/blog/digested.astro');
const navLinks = read('src/data/navLinks.ts');
const importer = read('scripts/human-agency-import.ts');
const packageFile = read('package.json');

assert.match(contentConfig, /loader: blogWithJournalLoader\(\)/, 'blog collection must include approved Journal articles');
assert.match(loader, /process\.env\.JOURNAL_PREVIEW_PACKAGE/, 'explicit preview environment gate is missing');
assert.match(loader, /markdownBlogLoader\.load\(context\)/, 'normal Markdown blog loader must be preserved');
assert.match(loader, /renderMarkdown\(entry\.body_markdown\)/, 'Journal Markdown must use Astro blog rendering');
assert.match(loader, /category: '消化'/, 'Journal articles must use the 消化 category');
assert.match(loader, /tags: \['消化'\]/, 'Journal articles must expose the 消化 tag');
assert.match(tabs, /blog\/digested\//, 'blog filter is missing the digested route');
assert.match(tabs, /labelKey: 'blog\.digested'/, 'blog filter is missing the digested label');
assert.match(tabs, /hasDigestedPosts/, 'digested filter must be gated by published content');
assert.match(tabs, /post\.data\.category === '消化'/, 'digested visibility must use the published blog category');
assert.match(tabs, /aria-label=\{tab\.label\}/, 'blog filters must keep accessible names at every viewport');
assert.doesNotMatch(tabs, /class="hidden md:inline"/, 'blog filter labels must stay visible on mobile');
assert.match(digestedPage, /post\.data\.category === '消化'/, 'digested page must filter the blog collection');
assert.match(digestedPage, /<PostCard/, 'digested articles must reuse the ordinary blog card');
assert.doesNotMatch(digestedPage, /slot="actions"/, 'four blog filters must stay in the normal reading flow');
assert.doesNotMatch(navLinks, /human-agency|nav\.humanAgency/, 'standalone human-agency navigation must be removed');
assert.equal(existsSync('src/pages/human-agency/index.astro'), false, 'standalone human-agency index route must be removed');
assert.equal(existsSync('src/pages/human-agency/[slug].astro'), false, 'standalone human-agency detail route must be removed');
assert.match(importer, /expectedOldHash/, 'replacement hash guard is missing');
assert.match(importer, /published_at/, 'imported Journal posts must retain a stable publication date');
assert.match(packageFile, /"journal:preview"/, 'journal:preview command is missing');
assert.match(packageFile, /"journal:import"/, 'journal:import command is missing');

console.log('Journal-to-blog page and command contracts passed.');
