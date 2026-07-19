import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const page = read('src/pages/admin/index.astro');
const client = read('src/lib/admin.ts');
const settings = read('src/components/SettingsModal.astro');

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
	'admin-article-delete-modal',
	'admin-article-view-modal',
	'data-admin-article-delete-pair',
]) {
	assert.match(page, new RegExp(contract), `admin page is missing article contract ${contract}`);
}
assert.match(client, /\/api\/admin\/articles/, 'admin client must call the articles endpoint');
assert.match(client, /pair=1/, 'admin client must support paired article deletion');

const articlesRoute = read('server/src/routes/articles.js');
assert.match(articlesRoute, /adminAuth/, 'article routes must require admin auth');
assert.match(articlesRoute, /admin_audit/, 'article routes must record admin audit entries');
assert.doesNotMatch(articlesRoute, /adminToken/, 'article routes must not special-case the admin token');

assert.match(client, /getToken/, 'admin client must read the existing authenticated session token');
assert.match(client, /Authorization/, 'admin client must send a Bearer authorization header');
assert.match(client, /Bearer\s+\$\{token\}/, 'admin client must use the current token as Bearer auth');
assert.doesNotMatch(client, /CF-Access-Authenticated-User-Email|Cloudflare Access|placeholder\.com/i, 'admin client must not retain Cloudflare Access placeholders');

assert.match(settings, /checkAdmin\(\)/, 'settings must check admin status through the authenticated client');
assert.match(settings, /settings-admin-link/, 'settings must keep the guarded admin entry');

console.log('Admin page contract check passed.');
