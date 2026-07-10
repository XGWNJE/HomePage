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

function testConfig(overrides = {}) {
	return {
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
		serviceVersion: '0.1.0-test',
		serviceRevision: 'test-revision',
		turnstileSiteKey: overrides.turnstileSecretKey ? 'test-site-key' : '',
		turnstileSecretKey: '',
		turnstileExpectedHostname: 'xgwnje.cn',
		...overrides,
	};
}

async function withIsolatedApp({ config = {}, fetchImpl }, callback) {
	const isolatedDir = mkdtempSync(join(tmpdir(), 'homepage-api-isolated-'));
	const isolatedDb = createDatabase(join(isolatedDir, 'api.sqlite'));
	const app = createApp({
		db: isolatedDb,
		config: testConfig({ uploadDir: join(isolatedDir, 'uploads'), ...config }),
		fetchImpl,
	});
	let isolatedServer;
	try {
		await new Promise((resolve) => {
			isolatedServer = app.listen(0, '127.0.0.1', resolve);
		});
		const address = isolatedServer.address();
		const isolatedBaseUrl = `http://127.0.0.1:${address.port}`;
		const isolatedRequest = async (path, options = {}) => {
			const response = await fetch(`${isolatedBaseUrl}${path}`, options);
			const text = await response.text();
			const contentType = response.headers.get('content-type') || '';
			const body = contentType.includes('application/json') && text ? JSON.parse(text) : text;
			return { response, body };
		};
		await callback({ request: isolatedRequest, db: isolatedDb });
	} finally {
		if (isolatedServer) await new Promise((resolve) => isolatedServer.close(resolve));
		isolatedDb.close();
		rmSync(isolatedDir, { recursive: true, force: true });
	}
}

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
		config: testConfig(),
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
	assert.equal(body.version, '0.1.0-test');
	assert.equal(body.revision, 'test-revision');
	assert.deepEqual(body.readiness, { database: 'ready', schemaVersion: 1, turnstile: 'disabled' });
});

test('health endpoint exposes enabled Turnstile readiness without revealing keys', async () => {
	await withIsolatedApp({
		config: { turnstileSiteKey: 'test-site-key', turnstileSecretKey: 'test-secret' },
	}, async ({ request: isolatedRequest }) => {
		const { response, body } = await isolatedRequest('/health');
		assert.equal(response.status, 200);
		assert.equal(body.readiness.turnstile, 'enabled');
		assert.doesNotMatch(JSON.stringify(body), /test-site-key|test-secret/);
	});
});

test('health endpoint rejects an unexpected database schema version', async () => {
	db.exec('PRAGMA user_version = 2');
	try {
		const { response, body } = await request('/health');
		assert.equal(response.status, 503);
		assert.equal(body.ok, false);
		assert.deepEqual(body.readiness, {
			database: 'schema-mismatch',
			schemaVersion: 2,
			expectedSchemaVersion: 1,
			turnstile: 'disabled',
		});
	} finally {
		db.exec('PRAGMA user_version = 1');
	}
});

test('configured Turnstile rejects missing email-login token before persistence', async () => {
	let fetchCalls = 0;
	await withIsolatedApp({
		config: { turnstileSecretKey: 'test-secret' },
		fetchImpl: async () => {
			fetchCalls += 1;
			return new Response(JSON.stringify({ success: true }), { status: 200 });
		},
	}, async ({ request: isolatedRequest, db: isolatedDb }) => {
		const result = await isolatedRequest('/api/auth/email/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: 'visitor@example.com' }),
		});
		assert.equal(result.response.status, 400);
		assert.deepEqual(result.body, { error: 'Verification failed' });
		assert.equal(fetchCalls, 0);
		assert.equal(isolatedDb.prepare('SELECT COUNT(*) AS count FROM email_logins').get().count, 0);
		assert.equal(isolatedDb.prepare('SELECT COUNT(*) AS count FROM outbox').get().count, 0);
	});
});

test('configured Turnstile rejects invalid contact token without leaking upstream details', async () => {
	await withIsolatedApp({
		config: { turnstileSecretKey: 'test-secret' },
		fetchImpl: async () => new Response(JSON.stringify({
			success: false,
			'error-codes': ['invalid-input-secret', 'internal-error-detail'],
		}), { status: 200, headers: { 'content-type': 'application/json' } }),
	}, async ({ request: isolatedRequest, db: isolatedDb }) => {
		const result = await isolatedRequest('/api/contact', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name: 'Visitor',
				email: 'visitor@example.com',
				message: 'Hello',
				turnstileToken: 'invalid-token',
			}),
		});
		assert.equal(result.response.status, 400);
		assert.deepEqual(result.body, { error: 'Verification failed' });
		assert.doesNotMatch(JSON.stringify(result.body), /secret|internal-error-detail/);
		assert.equal(isolatedDb.prepare('SELECT COUNT(*) AS count FROM contact_messages').get().count, 0);
	});
});

test('configured Turnstile rejects a token issued for another hostname', async () => {
	await withIsolatedApp({
		config: {
			turnstileSecretKey: 'test-secret',
			turnstileExpectedHostname: 'xgwnje.cn',
		},
		fetchImpl: async () => new Response(JSON.stringify({
			success: true,
			hostname: 'attacker.example',
		}), { status: 200, headers: { 'content-type': 'application/json' } }),
	}, async ({ request: isolatedRequest, db: isolatedDb }) => {
		const result = await isolatedRequest('/api/contact', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name: 'Visitor',
				email: 'visitor@example.com',
				message: 'Hello',
				turnstileToken: 'wrong-host-token',
			}),
		});
		assert.equal(result.response.status, 400);
		assert.deepEqual(result.body, { error: 'Verification failed' });
		assert.equal(isolatedDb.prepare('SELECT COUNT(*) AS count FROM contact_messages').get().count, 0);
	});
});

test('configured Turnstile fails closed when verification is unavailable', async () => {
	await withIsolatedApp({
		config: { turnstileSecretKey: 'test-secret' },
		fetchImpl: async () => { throw new Error('upstream exposed detail'); },
	}, async ({ request: isolatedRequest, db: isolatedDb }) => {
		const result = await isolatedRequest('/api/auth/email/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: 'visitor@example.com', turnstileToken: 'token' }),
		});
		assert.equal(result.response.status, 503);
		assert.deepEqual(result.body, { error: 'Verification unavailable' });
		assert.doesNotMatch(JSON.stringify(result.body), /upstream exposed detail/);
		assert.equal(isolatedDb.prepare('SELECT COUNT(*) AS count FROM email_logins').get().count, 0);
	});
});

test('configured Turnstile validates token and remote address before contact persistence', async () => {
	let verificationRequest;
	await withIsolatedApp({
		config: { turnstileSecretKey: 'test-secret' },
		fetchImpl: async (url, options) => {
			verificationRequest = { url, options };
			return new Response(JSON.stringify({ success: true, hostname: 'xgwnje.cn' }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		},
	}, async ({ request: isolatedRequest, db: isolatedDb }) => {
		const result = await isolatedRequest('/api/contact', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-forwarded-for': '198.51.100.9, 203.0.113.8',
			},
			body: JSON.stringify({
				name: 'Visitor',
				email: 'visitor@example.com',
				message: 'Hello',
				turnstileToken: 'valid-token',
			}),
		});
		assert.equal(result.response.status, 200);
		assert.equal(isolatedDb.prepare('SELECT COUNT(*) AS count FROM contact_messages').get().count, 1);
		assert.ok(verificationRequest, 'expected Turnstile Siteverify to be called');
		assert.equal(verificationRequest.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
		assert.equal(verificationRequest.options.method, 'POST');
		assert.ok(verificationRequest.options.signal instanceof AbortSignal, 'expected Siteverify request timeout signal');
		const payload = JSON.parse(verificationRequest.options.body);
		assert.deepEqual(payload, {
			secret: 'test-secret',
			response: 'valid-token',
			remoteip: '203.0.113.8',
		});
	});
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

test('legacy browser admin header is rejected while Bearer admin tokens remain valid', async () => {
	const legacy = await request('/api/admin/stats', {
		headers: { 'x-admin-token': 'test-admin-token' },
	});
	assert.equal(legacy.response.status, 403);

	const bearer = await request('/api/admin/stats', {
		headers: { authorization: 'Bearer test-admin-token' },
	});
	assert.equal(bearer.response.status, 200);
});

test('session-backed admin access accepts administrators and rejects ordinary or expired sessions', async () => {
	const adminLogin = await request('/api/auth/dev-login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ login: 'session-admin', name: 'Session Admin' }),
	});
	const adminToken = adminLogin.body.token;
	const adminHeaders = { authorization: `Bearer ${adminToken}` };
	const check = await request('/api/admin/check', { headers: adminHeaders });
	assert.equal(check.response.status, 200);
	assert.equal(check.body.isAdmin, true);
	assert.equal((await request('/api/admin/stats', { headers: adminHeaders })).response.status, 200);
	assert.equal((await request('/api/admin/comments', { headers: adminHeaders })).response.status, 200);

	const pending = await request('/api/comments', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...adminHeaders },
		body: JSON.stringify({ post_id: 'session-admin-review', body: 'Review with a real admin session.' }),
	});
	const moderated = await request('/api/admin/comment/approve', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...adminHeaders },
		body: JSON.stringify({ id: pending.body.comment.id }),
	});
	assert.equal(moderated.response.status, 200);

	const ordinaryLogin = await request('/api/auth/dev-login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ login: 'session-user', name: 'Session User' }),
	});
	db.prepare("UPDATE users SET is_admin = 0 WHERE login = 'session-user'").run();
	const ordinaryHeaders = { authorization: `Bearer ${ordinaryLogin.body.token}` };
	assert.equal((await request('/api/admin/check', { headers: ordinaryHeaders })).body.isAdmin, false);
	assert.equal((await request('/api/admin/stats', { headers: ordinaryHeaders })).response.status, 403);

	const expiredLogin = await request('/api/auth/dev-login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ login: 'expired-admin', name: 'Expired Admin' }),
	});
	db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(Date.now() - 1, expiredLogin.body.token);
	const expiredHeaders = { authorization: `Bearer ${expiredLogin.body.token}` };
	assert.equal((await request('/api/admin/check', { headers: expiredHeaders })).body.isAdmin, false);
	assert.equal((await request('/api/admin/stats', { headers: expiredHeaders })).response.status, 403);
	assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE id = ?').get(expiredLogin.body.token).count, 0);
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
