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
assert.match(page, /document\.querySelector\('\[data-admin-article-delete-confirm\]'\)/, 'article modals live outside data-admin-root and must be queried from document');
assert.doesNotMatch(page, /root\??\.querySelector(All)?\('[^']*admin-article-(view|delete)/, 'article modal elements must not be queried inside data-admin-root');
assert.match(page, /按 group 把中英文配对稿合并/, 'article list must group cn/en pairs into one entry');
assert.match(page, /data-admin-tab="articles"/, 'admin page must provide section tabs');
assert.match(page, /data-admin-article-filter="draft"/, 'admin page must merge drafts into the article table with a filter');
assert.match(page, /data-admin-tab-count="articles"/, 'admin page must show section counts on tabs');
assert.match(page, /data-admin-auth-error/, 'admin page must keep a dedicated auth error slot');
assert.match(page, /data-admin-panel="subscriptions"/, 'admin page must keep a dedicated subscriptions panel');

const subscriptionCard = read('src/components/admin/AdminSubscriptionCard.astro');
assert.match(subscriptionCard, /data-admin-subscriptions-link/, 'subscription card must keep the entry link contract');
assert.match(subscriptionCard, /data-admin-subscription-state/, 'subscription card must expose a status slot');

const publishProgress = read('src/components/admin/PublishProgress.astro');
for (const contract of ['data-publish-stage="save"', 'data-publish-stage="release"', 'data-publish-stage="done"', 'data-publish-elapsed', 'prefers-reduced-motion']) {
	assert.match(publishProgress, new RegExp(contract), `PublishProgress is missing ${contract}`);
}
assert.match(page, /PublishProgress/, 'admin page must mount PublishProgress for delete releases');

const articlesRoute = read('server/src/routes/articles.js');
assert.match(articlesRoute, /adminAuth/, 'article routes must require admin auth');
assert.match(articlesRoute, /admin_audit/, 'article routes must record admin audit entries');
assert.doesNotMatch(articlesRoute, /adminToken/, 'article routes must not special-case the admin token');

// Phase 2：网页编辑器（草稿 + 预览 + 发表）
const editor = read('src/pages/admin/editor.astro');
for (const contract of [
	'data-editor-root',
	'data-editor-auth-state',
	'data-editor-workspace',
	'data-editor-field="title"',
	'data-editor-field="slug"',
	'data-editor-field="description"',
	'data-editor-field="tags"',
	'data-editor-field="category"',
	'data-editor-field="body"',
	'data-editor-preview',
	'data-editor-save',
	'data-editor-publish',
	'data-editor-upload',
	'data-editor-tab',
	'data-editor-notice',
	'data-editor-en-section',
	'data-editor-field="en_title"',
	'data-editor-field="en_body"',
	'data-editor-en-preview',
]) {
	assert.match(editor, new RegExp(contract), `editor page is missing ${contract}`);
}
assert.match(editor, /params\.get\('article'\)/, 'editor page must support loading a published article');
assert.match(editor, /PublishProgress/, 'editor page must mount PublishProgress for publishes');
assert.match(editor, /from ['"]\.\.\/\.\.\/lib\/admin['"]/, 'editor page must use the shared admin client');
assert.match(editor, /from 'easymde'/, 'editor page must use EasyMDE for the body editor');
assert.match(editor, /checkAdmin/, 'editor page must gate on the admin session');
assert.match(editor, /astro:page-load/, 'editor page must initialize after ClientRouter navigation');
assert.match(editor, /editorInitialized/, 'editor page must guard duplicate listeners on the same DOM');
assert.match(client, /\/api\/admin\/article\/draft/, 'admin client must call the draft endpoint');
assert.match(client, /\/api\/admin\/article\/preview/, 'admin client must call the preview endpoint');
assert.match(client, /\/api\/admin\/article\/publish/, 'admin client must call the publish endpoint');
assert.match(articlesRoute, /article_drafts/, 'article routes must persist drafts');
assert.match(articlesRoute, /article\.publish/, 'article routes must audit publishes');
assert.match(articlesRoute, /marked/, 'preview must render through marked');
// 预览渲染管理员自己的 marked 输出，允许 innerHTML；其余 API 内容仍走 DOM 节点。
for (const match of editor.matchAll(/\.innerHTML\s*=/g)) {
	assert.ok(match.index !== undefined);
	const lineStart = editor.lastIndexOf('\n', match.index);
	const line = editor.slice(lineStart, editor.indexOf('\n', match.index));
	assert.match(line, /pane\.innerHTML/, `editor page must only inject preview HTML through marked: ${line.trim()}`);
}

assert.match(client, /getToken/, 'admin client must read the existing authenticated session token');
assert.match(client, /Authorization/, 'admin client must send a Bearer authorization header');
assert.match(client, /Bearer\s+\$\{token\}/, 'admin client must use the current token as Bearer auth');
assert.doesNotMatch(client, /CF-Access-Authenticated-User-Email|Cloudflare Access|placeholder\.com/i, 'admin client must not retain Cloudflare Access placeholders');

assert.match(settings, /checkAdmin\(\)/, 'settings must check admin status through the authenticated client');
assert.match(settings, /settings-admin-link/, 'settings must keep the guarded admin entry');

console.log('Admin page contract check passed.');
