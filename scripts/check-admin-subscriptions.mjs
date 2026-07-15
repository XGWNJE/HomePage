import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const page = read('src/pages/admin/subscriptions/index.astro');
const adminPage = read('src/pages/admin/index.astro');
const client = read('src/lib/admin.ts');
const fixture = read('server/test/fixtures/subscription-access.v1.json');
const fixtureValues = Object.values(JSON.parse(fixture).endpoints).map((entry) => entry.url);

assert.match(page, /SiteLayout/, 'subscription page must reuse SiteLayout');
assert.match(page, /PageHeading/, 'subscription page must reuse PageHeading');
assert.match(page, /ModalShell/, 'QR dialog must reuse ModalShell');
for (const contract of [
	'data-subscription-root',
	'data-subscription-auth-state',
	'data-subscription-workspace',
	'data-subscription-card',
	'data-subscription-copy',
	'data-subscription-qr',
	'data-subscription-lock-state',
	'data-subscription-active-state',
	'data-subscription-unlock',
	'data-subscription-lock',
]) {
	assert.match(page, new RegExp(contract), `subscription page is missing ${contract}`);
}
assert.match(adminPage, /manageSubscriptions/, 'admin dashboard must gate the subscription entry by fine-grained permission');
assert.match(client, /navigator\.clipboard\.writeText/, 'subscription values must go directly to the clipboard');
assert.match(client, /response\.blob\(\)/, 'QR must be fetched as a protected blob');
assert.match(client, /URL\.createObjectURL/, 'QR must use a temporary object URL');
assert.match(client, /URL\.revokeObjectURL/, 'QR object URLs must be revoked');
assert.match(client, /beginSubscriptionUnlock/, 'subscription access must use explicit reauthentication');
assert.match(client, /lockSubscriptionAccess/, 'subscription access must support explicit locking');
assert.doesNotMatch(page, /localStorage|sessionStorage|indexedDB/i, 'subscription page must not persist revealed values');
assert.doesNotMatch(client, /localStorage\.setItem|sessionStorage\.setItem|indexedDB/i, 'admin client must not persist revealed values');
for (const value of fixtureValues) {
	assert.doesNotMatch(page, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'static HTML must not contain fixture URLs');
}

console.log('Admin subscription page contract check passed.');
