import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const page = read('src/pages/admin/index.astro');
const client = read('src/lib/admin.ts');

assert.doesNotMatch(page, /Astro\.response\.status\s*=\s*404/, 'admin page must not return the legacy 404');
for (const contract of [
	'data-admin-root',
	'data-admin-auth-state',
	'data-admin-stats',
	'data-admin-comments',
	'data-admin-contact-messages',
	'data-admin-outbox',
	'data-admin-comment-filter',
	'data-admin-action',
]) {
	assert.match(page, new RegExp(contract), `admin page is missing ${contract}`);
}
assert.match(page, /from ['"]\.\.\/\.\.\/lib\/admin['"]/, 'admin page must use the shared admin client');
assert.match(page, /document\.createElement/, 'admin page must build user-controlled rows with DOM nodes');
assert.doesNotMatch(page, /\.innerHTML\s*=/, 'admin page must not inject API content through innerHTML');
assert.match(page, /astro:page-load/, 'admin page must initialize after ClientRouter navigation');
assert.match(page, /adminInitialized/, 'admin page must guard duplicate listeners on the same DOM');

for (const contract of [
	'data-admin-articles',
	'data-admin-article-action',
	'admin-article-view-modal',
	'data-admin-page-preview',
]) {
	assert.match(page, new RegExp(contract), `admin page is missing page-review contract ${contract}`);
}
assert.match(client, /\/api\/admin\/pages/, 'admin client must call the pages endpoint');
assert.match(client, /\/approve/, 'admin client must support approving a page version');
assert.match(client, /\/publish/, 'admin client must support publishing a page version');
assert.match(client, /sha256/, 'publishing must bind to the approved artifact hash');
assert.match(client, /\/archive/, 'admin client must support archiving a published page');
assert.match(page, /data-admin-tab="articles"/, 'admin page must provide section tabs');
for (const status of ['draft', 'approved', 'published', 'archived']) {
	assert.match(page, new RegExp(`data-admin-article-filter="${status}"`), `admin page must filter ${status} pages`);
}
assert.match(page, /data-admin-tab-count="articles"/, 'admin page must show section counts on tabs');
assert.match(page, /data-admin-auth-error/, 'admin page must keep a dedicated auth error slot');
assert.match(page, /data-admin-panel="subscriptions"/, 'admin page must keep a dedicated subscriptions panel');
assert.doesNotMatch(page, /\/admin\/editor|EasyMDE|新建文章/, 'admin page must not retain the browser article editor');

const subscriptionCard = read('src/components/admin/AdminSubscriptionCard.astro');
assert.match(subscriptionCard, /data-admin-subscriptions-link/, 'subscription card must keep the entry link contract');
assert.match(subscriptionCard, /data-admin-subscription-state/, 'subscription card must expose a status slot');

const articlesRoute = read('server/src/routes/articles.js');
assert.match(articlesRoute, /adminAuth/, 'article routes must require admin auth');
assert.match(articlesRoute, /admin_audit/, 'article routes must record admin audit entries');
assert.doesNotMatch(articlesRoute, /adminToken/, 'article routes must not special-case the admin token');

assert.match(client, /getToken/, 'admin client must read the existing authenticated session token');
assert.match(client, /Authorization/, 'admin client must send a Bearer authorization header');
assert.match(client, /Bearer\s+\$\{token\}/, 'admin client must use the current token as Bearer auth');
assert.doesNotMatch(client, /CF-Access-Authenticated-User-Email|Cloudflare Access|placeholder\.com/i, 'admin client must not retain Cloudflare Access placeholders');

const header = read('src/components/Header.astro');
const headerAuth = read('src/client/site/header-auth.ts');
assert.match(header, /header-admin-link/, 'header dropdown must keep the guarded admin entry');
assert.match(headerAuth, /checkAdmin\(\)/, 'header auth runtime must check admin status through the authenticated client');

console.log('Admin page contract check passed.');
