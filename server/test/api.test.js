import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

let tempDir;
let server;
let baseUrl;
let db;

async function request(path, options = {}) {
	const response = await fetch(`${baseUrl}${path}`, options);
	const text = await response.text();
	const contentType = response.headers.get('content-type') || '';
	const body = contentType.includes('application/json') && text ? JSON.parse(text) : text;
	return { response, body };
}

before(async () => {
	tempDir = mkdtempSync(join(tmpdir(), 'homepage-api-test-'));
	db = createDatabase(join(tempDir, 'api.sqlite'));
	const app = createApp({
		db,
		config: {
			baseUrl: 'http://127.0.0.1:0',
			frontendUrl: 'https://xgwnje.cn',
			allowedOrigins: ['https://xgwnje.cn'],
			githubClientId: 'test-client-id',
			githubClientSecret: 'test-client-secret',
			devLogin: true,
			adminToken: 'test-admin-token',
			adminEmails: [],
			adminGithubLogins: [],
			uploadDir: join(tempDir, 'uploads'),
			uploadPublicBaseUrl: 'https://api.xgwnje.cn/uploads',
			sessionTtlSeconds: 60 * 60,
		},
	});

	await new Promise((resolve) => {
		server = app.listen(0, '127.0.0.1', resolve);
	});
	const address = server.address();
	baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
	await new Promise((resolve) => server.close(resolve));
	db.close();
	rmSync(tempDir, { recursive: true, force: true });
});

test('health endpoint reports service status', async () => {
	const { response, body } = await request('/health');
	assert.equal(response.status, 200);
	assert.equal(body.ok, true);
	assert.equal(body.service, 'homepage-api');
});

test('view counters start at zero and increment per post slug', async () => {
	let result = await request('/api/views?post=example-post');
	assert.equal(result.response.status, 200);
	assert.deepEqual(result.body, { post: 'example-post', views: 0 });

	result = await request('/api/views', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ post: 'example-post' }),
	});
	assert.equal(result.response.status, 200);
	assert.equal(result.body.views, 1);
	assert.equal(result.body.incremented, true);

	result = await request('/api/views/batch?posts=example-post,missing-post');
	assert.equal(result.response.status, 200);
	assert.deepEqual(result.body.views, {
		'example-post': 1,
		'missing-post': 0,
	});
});

test('dev login creates a session usable by /api/me', async () => {
	const login = await request('/api/auth/dev-login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ login: 'tester', name: 'Test User' }),
	});
	assert.equal(login.response.status, 200);
	assert.match(login.body.token, /^[A-Za-z0-9_-]+$/);

	const me = await request('/api/me', {
		headers: { authorization: `Bearer ${login.body.token}` },
	});
	assert.equal(me.response.status, 200);
	assert.equal(me.body.user.login, 'tester');
	assert.equal(me.body.user.name, 'Test User');
});

test('github oauth redirects are not cacheable', async () => {
	const start = await request('/api/auth/github/start?returnTo=https%3A%2F%2Fxgwnje.cn%2Fblog%2Fdemo%2F&t=123', {
		redirect: 'manual',
	});
	assert.equal(start.response.status, 302);
	assert.match(start.response.headers.get('location') || '', /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
	assert.match(start.response.headers.get('location') || '', /client_id=test-client-id/);
	assert.match(start.response.headers.get('cache-control') || '', /no-store/);
	assert.equal(start.response.headers.get('pragma'), 'no-cache');
	assert.equal(start.response.headers.get('expires'), '0');

	const callback = await request('/api/auth/github/callback?state=missing&code=bad', {
		redirect: 'manual',
	});
	assert.equal(callback.response.status, 302);
	assert.equal(callback.response.headers.get('location'), 'https://xgwnje.cn');
	assert.match(callback.response.headers.get('cache-control') || '', /no-store/);
});

test('comments require auth, approve clean text, and hide rejected html', async () => {
	const anonymous = await request('/api/comments', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ post_id: 'post-a', content: 'hello' }),
	});
	assert.equal(anonymous.response.status, 401);

	const login = await request('/api/auth/dev-login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ login: 'commenter', name: 'Commenter' }),
	});
	const token = login.body.token;

	const clean = await request('/api/comments', {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
		body: JSON.stringify({ post_id: 'post-a', content: 'A useful thought.' }),
	});
	assert.equal(clean.response.status, 201);
	assert.equal(clean.body.comment.status, 'approved');

	const html = await request('/api/comments', {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
		body: JSON.stringify({ post_id: 'post-a', content: '<script>alert(1)</script>' }),
	});
	assert.equal(html.response.status, 400);

	const list = await request('/api/comments?post_id=post-a');
	assert.equal(list.response.status, 200);
	assert.equal(list.body.comments.length, 1);
	assert.equal(list.body.comments[0].body, 'A useful thought.');
});

test('contact messages are stored without paid email provider', async () => {
	const result = await request('/api/contact', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			name: 'Visitor',
			email: 'visitor@example.com',
			message: 'Hello from the contact form',
		}),
	});
	assert.equal(result.response.status, 200);
	assert.equal(result.body.ok, true);

	const admin = await request('/api/admin/contact-messages', {
		headers: { authorization: 'Bearer test-admin-token' },
	});
	assert.equal(admin.response.status, 200);
	assert.equal(admin.body.messages.length, 1);
	assert.equal(admin.body.messages[0].email, 'visitor@example.com');
});

test('admin token can approve pending comments', async () => {
	const login = await request('/api/auth/dev-login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ login: 'reviewed', name: 'Reviewed User' }),
	});

	const pending = await request('/api/comments', {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${login.body.token}` },
		body: JSON.stringify({
			post_id: 'post-review',
			content: 'Please review this suspicious http://example.com link',
		}),
	});
	assert.equal(pending.response.status, 201);
	assert.equal(pending.body.comment.status, 'pending');

	let list = await request('/api/comments?post_id=post-review');
	assert.equal(list.body.comments.length, 0);

	const approved = await request('/api/admin/comment/approve', {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: 'Bearer test-admin-token' },
		body: JSON.stringify({ id: pending.body.comment.id }),
	});
	assert.equal(approved.response.status, 200);
	assert.equal(approved.body.success, true);

	list = await request('/api/comments?post_id=post-review');
	assert.equal(list.body.comments.length, 1);
});

test('image uploads require auth and reject non-image files', async () => {
	const anonymous = await fetch(`${baseUrl}/api/images`, {
		method: 'POST',
		body: new FormData(),
	});
	assert.equal(anonymous.status, 401);

	const login = await request('/api/auth/dev-login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ login: 'uploader', name: 'Uploader' }),
	});
	const token = login.body.token;

	const invalid = new FormData();
	invalid.append('file', new Blob(['not an image'], { type: 'text/plain' }), 'note.txt');
	const rejected = await fetch(`${baseUrl}/api/images`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}` },
		body: invalid,
	});
	assert.equal(rejected.status, 400);

	const valid = new FormData();
	valid.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'pixel.png');
	const uploaded = await fetch(`${baseUrl}/api/images`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}` },
		body: valid,
	});
	const body = await uploaded.json();
	assert.equal(uploaded.status, 201);
	assert.equal(body.ok, true);
	assert.match(body.url, /^https:\/\/api\.xgwnje\.cn\/uploads\/img_/);
});
