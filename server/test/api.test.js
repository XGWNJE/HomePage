import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
		nodeEnv: 'test',
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
		uploadTempDir: join(tempDir, '.uploads-tmp'),
		uploadRecoveryDir: join(tempDir, '.uploads-recovery'),
		uploadPublicBaseUrl: 'https://api.xgwnje.cn/uploads',
		uploadMaxFileBytes: 8 * 1024 * 1024,
		uploadMaxPixels: 40_000_000,
		uploadMaxFrames: 50,
		uploadUserQuotaBytes: 256 * 1024 * 1024,
		uploadRateLimitPerUser: 10,
		uploadRateLimitPerIp: 30,
		uploadRateLimitWindowMs: 60_000,
		uploadMaxConcurrentDecodes: 2,
		sessionTtlSeconds: 60 * 60,
		serviceVersion: '0.1.0-test',
		serviceRevision: 'test-revision',
		turnstileSiteKey: overrides.turnstileSecretKey ? 'test-site-key' : '',
		turnstileSecretKey: '',
		turnstileExpectedHostname: 'xgwnje.cn',
		subscriptionAccessEnabled: false,
		subscriptionAccessFixture: false,
		subscriptionAccessRegistry: '',
		subscriptionAccessFixtureQr: '',
		subscriptionAccessTtlSeconds: 300,
		...overrides,
	};
}

function grantSubscriptionPermission(targetDb, login) {
	const user = targetDb.prepare('SELECT id FROM users WHERE login = ? LIMIT 1').get(login);
	assert.ok(user?.id, 'test user must exist before permission is granted');
	targetDb.prepare(
		`INSERT INTO user_permissions (user_id, permission, granted_at, granted_by)
		 VALUES (?, 'manage_subscriptions', ?, 'test')`
	).run(user.id, Date.now());
	return user.id;
}

function responseCookies(response) {
	if (typeof response.headers.getSetCookie === 'function') return response.headers.getSetCookie();
	const value = response.headers.get('set-cookie');
	return value ? [value] : [];
}

function cookieHeader(cookies) {
	return cookies.map((value) => value.split(';', 1)[0]).join('; ');
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
		await callback({ request: isolatedRequest, db: isolatedDb, baseUrl: isolatedBaseUrl });
	} finally {
		if (isolatedServer) await new Promise((resolve) => isolatedServer.close(resolve));
		isolatedDb.close();
		rmSync(isolatedDir, { recursive: true, force: true });
	}
}

async function withSubscriptionFixture(callback) {
	const fixtureDir = mkdtempSync(join(tmpdir(), 'homepage-subscription-api-test-'));
	const registryPath = join(fixtureDir, 'subscription-access.v1.json');
	const qrPath = join(fixtureDir, 'fixture-mobile-import.png');
	writeFileSync(registryPath, readFileSync(new URL('./fixtures/subscription-access.v1.json', import.meta.url)));
	writeFileSync(qrPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]));
	try {
		await callback({ registryPath, qrPath });
	} finally {
		rmSync(fixtureDir, { recursive: true, force: true });
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
	assert.deepEqual(body.readiness, { database: 'ready', schemaVersion: 2, turnstile: 'disabled' });
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
	db.exec('PRAGMA user_version = 3');
	try {
		const { response, body } = await request('/health');
		assert.equal(response.status, 503);
		assert.equal(body.ok, false);
		assert.deepEqual(body.readiness, {
			database: 'schema-mismatch',
			schemaVersion: 3,
			expectedSchemaVersion: 2,
			turnstile: 'disabled',
		});
	} finally {
		db.exec('PRAGMA user_version = 2');
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

test('github oauth exchanges PKCE state for a local session without exposing the provider token', async () => {
	const providerToken = 'github-provider-secret';
	const exchangeCalls = [];
	await withIsolatedApp({
		fetchImpl: async (url, options = {}) => {
			exchangeCalls.push({ url: String(url), options });
			if (url === 'https://github.com/login/oauth/access_token') {
				return new Response(JSON.stringify({ access_token: providerToken }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			}
			if (url === 'https://api.github.com/user') {
				return new Response(JSON.stringify({
					id: 4242,
					login: 'oauth-user',
					name: 'OAuth User',
					avatar_url: 'https://avatars.example/oauth-user.png',
					html_url: 'https://github.com/oauth-user',
				}), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			}
			throw new Error(`Unexpected OAuth request: ${url}`);
		},
	}, async ({ request: isolatedRequest, db: isolatedDb }) => {
		const start = await isolatedRequest('/api/auth/github/start?returnTo=https%3A%2F%2Fxgwnje.cn%2Fblog%2Fdemo', {
			redirect: 'manual',
		});
		assert.equal(start.response.status, 302);

		const authorizeUrl = new URL(start.response.headers.get('location'));
		const state = authorizeUrl.searchParams.get('state');
		assert.ok(state);
		assert.equal(authorizeUrl.searchParams.get('code_challenge_method'), 'S256');

		const setCookie = start.response.headers.get('set-cookie') || '';
		const cookieValues = Object.fromEntries(
			[...setCookie.matchAll(/(__Host-homepage_oauth_(?:state|verifier|return))=([^;,]+)/g)]
				.map((match) => [match[1], match[2]])
		);
		assert.equal(decodeURIComponent(cookieValues['__Host-homepage_oauth_state']), state);
		assert.ok(cookieValues['__Host-homepage_oauth_verifier']);
		assert.equal(
			decodeURIComponent(cookieValues['__Host-homepage_oauth_return']),
			'https://xgwnje.cn/blog/demo'
		);
		const callbackCookie = Object.entries(cookieValues)
			.map(([name, value]) => `${name}=${value}`)
			.join('; ');

		const callback = await isolatedRequest(`/api/auth/github/callback?state=${encodeURIComponent(state)}&code=valid-code`, {
			redirect: 'manual',
			headers: { cookie: callbackCookie },
		});
		assert.equal(callback.response.status, 302);
		const location = callback.response.headers.get('location') || '';
		assert.match(location, /^https:\/\/xgwnje\.cn\/blog\/demo\/#token=[A-Za-z0-9_-]+$/);
		assert.doesNotMatch(location, new RegExp(providerToken));
		assert.doesNotMatch(String(callback.body), new RegExp(providerToken));

		assert.equal(exchangeCalls.length, 2);
		assert.equal(exchangeCalls[0].url, 'https://github.com/login/oauth/access_token');
		const tokenPayload = new URLSearchParams(exchangeCalls[0].options.body);
		assert.equal(tokenPayload.get('code'), 'valid-code');
		assert.equal(
			tokenPayload.get('code_verifier'),
			decodeURIComponent(cookieValues['__Host-homepage_oauth_verifier'])
		);
		assert.equal(exchangeCalls[1].url, 'https://api.github.com/user');
		assert.equal(exchangeCalls[1].options.headers.authorization, `Bearer ${providerToken}`);

		const sessionToken = new URL(location).hash.replace(/^#token=/, '');
		assert.notEqual(sessionToken, providerToken);
		const session = isolatedDb.prepare(
			`SELECT s.id, s.user_id, u.login, u.name
			   FROM sessions s
			   JOIN users u ON u.id = s.user_id
			  WHERE s.id = ?`
		).get(sessionToken);
		assert.deepEqual({ ...session }, {
			id: sessionToken,
			user_id: 'github:4242',
			login: 'oauth-user',
			name: 'OAuth User',
		});
	});
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

	const spoofed = new FormData();
	spoofed.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'pixel.png');
	const rejectedSpoof = await fetch(`${baseUrl}/api/images`, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}` },
		body: spoofed,
	});
	assert.equal(rejectedSpoof.status, 400);
	assert.equal(db.prepare('SELECT COUNT(*) AS count FROM images WHERE user_id = ?').get('dev:uploader').count, 0);
});

test('subscription API hides capability from unauthorized callers, ungranted admins, and ADMIN_TOKEN', async () => {
	await withSubscriptionFixture(async ({ registryPath, qrPath }) => {
		await withIsolatedApp({
			config: {
				nodeEnv: 'test',
				subscriptionAccessEnabled: true,
				subscriptionAccessFixture: true,
				subscriptionAccessRegistry: registryPath,
				subscriptionAccessFixtureQr: qrPath,
			},
		}, async ({ request: isolatedRequest, db: isolatedDb }) => {
			const anonymous = await isolatedRequest('/api/admin/subscriptions/status');
			assert.equal(anonymous.response.status, 403);
			assert.deepEqual(anonymous.body, { error: 'Access denied' });

			const tokenOnly = await isolatedRequest('/api/admin/subscriptions/status', {
				headers: { authorization: 'Bearer test-admin-token' },
			});
			assert.equal(tokenOnly.response.status, 403);
			assert.deepEqual(tokenOnly.body, { error: 'Access denied' });

			const ordinaryLogin = await isolatedRequest('/api/auth/dev-login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ login: 'subscription-user', name: 'Subscription User' }),
			});
			isolatedDb.prepare("UPDATE users SET is_admin = 0 WHERE login = 'subscription-user'").run();
			const ordinary = await isolatedRequest('/api/admin/subscriptions/status', {
				headers: { authorization: `Bearer ${ordinaryLogin.body.token}` },
			});
			assert.equal(ordinary.response.status, 403);
			assert.deepEqual(ordinary.body, { error: 'Access denied' });

			const ungrantedAdmin = await isolatedRequest('/api/auth/dev-login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ login: 'ungranted-admin', name: 'Ungranted Admin' }),
			});
			const ungranted = await isolatedRequest('/api/admin/subscriptions/status', {
				headers: { authorization: `Bearer ${ungrantedAdmin.body.token}` },
			});
			assert.equal(ungranted.response.status, 403);
			assert.equal((await isolatedRequest('/api/admin/check', {
				headers: { authorization: `Bearer ${ungrantedAdmin.body.token}` },
			})).body.permissions.manageSubscriptions, false);
		});
	});
});

test('fixture subscription API requires an explicit short session and enforces lock, expiry, and cache boundaries', async () => {
	await withSubscriptionFixture(async ({ registryPath, qrPath }) => {
		const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
		await withIsolatedApp({
			config: {
				nodeEnv: 'test',
				subscriptionAccessEnabled: true,
				subscriptionAccessFixture: true,
				subscriptionAccessRegistry: registryPath,
				subscriptionAccessFixtureQr: qrPath,
			},
		}, async ({ request: isolatedRequest, baseUrl: isolatedBaseUrl, db: isolatedDb }) => {
			const login = await isolatedRequest('/api/auth/dev-login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ login: 'subscription-admin', name: 'Subscription Admin' }),
			});
			const userId = grantSubscriptionPermission(isolatedDb, 'subscription-admin');
			const headers = { authorization: `Bearer ${login.body.token}` };

			const check = await isolatedRequest('/api/admin/check', { headers });
			assert.equal(check.body.permissions.manageSubscriptions, true);

			const status = await isolatedRequest('/api/admin/subscriptions/status', { headers });
			assert.equal(status.response.status, 200);
			assert.deepEqual(status.body, {
				ok: true,
				available: { desktop: true, mobile: true, mobileQr: true },
				unlocked: false,
				expiresAt: null,
			});
			assert.doesNotMatch(JSON.stringify(status.body), /sub\.xgwnje\.cn|\.yaml|fixture-mobile-import/);

			const lockedReveal = await isolatedRequest('/api/admin/subscriptions/reveal', {
				method: 'POST',
				headers: { ...headers, origin: 'https://xgwnje.cn', 'content-type': 'application/json' },
				body: JSON.stringify({ kind: 'desktop' }),
			});
			assert.equal(lockedReveal.response.status, 403);

			const unlock = await isolatedRequest('/api/admin/subscriptions/unlock', {
				method: 'POST',
				headers: { ...headers, origin: 'https://xgwnje.cn', 'content-type': 'application/json' },
				body: JSON.stringify({}),
			});
			assert.equal(unlock.response.status, 200);
			assert.deepEqual(unlock.body, { ok: true, unlocked: true });
			const sensitiveCookie = cookieHeader(responseCookies(unlock.response));
			assert.match(sensitiveCookie, /homepage_subscription_access_dev=/);
			const unlockedHeaders = { ...headers, cookie: sensitiveCookie };

			const unlockedStatus = await isolatedRequest('/api/admin/subscriptions/status', { headers: unlockedHeaders });
			assert.equal(unlockedStatus.body.unlocked, true);
			assert.ok(unlockedStatus.body.expiresAt > Date.now());

			const reveal = await isolatedRequest('/api/admin/subscriptions/reveal', {
				method: 'POST',
				headers: { ...unlockedHeaders, origin: 'https://xgwnje.cn', 'content-type': 'application/json' },
				body: JSON.stringify({ kind: 'desktop' }),
			});
			assert.equal(reveal.response.status, 200);
			assert.deepEqual(reveal.body, { ok: true, kind: 'desktop', value: registry.endpoints.desktop.url });
			assert.equal(reveal.response.headers.get('cache-control'), 'private, no-store, max-age=0');
			assert.equal(reveal.response.headers.get('pragma'), 'no-cache');
			assert.equal(reveal.response.headers.get('x-content-type-options'), 'nosniff');

			for (const options of [
				{ headers: { ...unlockedHeaders, 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'mobile' }) },
				{ headers: { ...unlockedHeaders, origin: 'https://xgwnje.cn', 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'unknown' }) },
				{ headers: { ...unlockedHeaders, origin: 'https://xgwnje.cn', 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'mobile', extra: true }) },
				{ headers: { ...unlockedHeaders, origin: 'https://xgwnje.cn', 'content-type': 'application/json' }, body: `${JSON.stringify({ kind: 'mobile' })}${' '.repeat(300)}` },
			]) {
				const invalid = await isolatedRequest('/api/admin/subscriptions/reveal', { method: 'POST', ...options });
				assert.ok([400, 403].includes(invalid.response.status));
				assert.deepEqual(invalid.body, { error: 'Invalid request' });
			}

			const qrResponse = await fetch(`${isolatedBaseUrl}/api/admin/subscriptions/mobile-qr`, { headers: unlockedHeaders });
			assert.equal(qrResponse.status, 200);
			assert.equal(qrResponse.headers.get('content-type'), 'image/png');
			assert.equal(qrResponse.headers.get('cache-control'), 'private, no-store, max-age=0');
			const qr = Buffer.from(await qrResponse.arrayBuffer());
			assert.deepEqual(qr.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

			const auditText = JSON.stringify(isolatedDb.prepare(
				'SELECT user_id, action, result, request_id, created_at FROM subscription_audit_events ORDER BY created_at'
			).all());
			assert.match(auditText, /reveal:desktop/);
			assert.doesNotMatch(auditText, /sub\.xgwnje\.cn|\.yaml|clashmeta:/);

			const lock = await isolatedRequest('/api/admin/subscriptions/lock', {
				method: 'POST',
				headers: { ...unlockedHeaders, origin: 'https://xgwnje.cn', 'content-type': 'application/json' },
				body: JSON.stringify({}),
			});
			assert.equal(lock.response.status, 200);
			assert.equal((await isolatedRequest('/api/admin/subscriptions/status', { headers: unlockedHeaders })).body.unlocked, false);

			const unlockAgain = await isolatedRequest('/api/admin/subscriptions/unlock', {
				method: 'POST',
				headers: { ...headers, origin: 'https://xgwnje.cn', 'content-type': 'application/json' },
				body: JSON.stringify({}),
			});
			const expiringCookie = cookieHeader(responseCookies(unlockAgain.response));
			isolatedDb.prepare(
				"UPDATE sensitive_sessions SET expires_at = ? WHERE user_id = ? AND purpose = 'subscription-access'"
			).run(Date.now() - 1, userId);
			assert.equal((await isolatedRequest('/api/admin/subscriptions/status', {
				headers: { ...headers, cookie: expiringCookie },
			})).body.unlocked, false);
		});
	});
});

test('GitHub reauthentication is one-time, identity-bound, and issues only a hashed short session', async () => {
	await withSubscriptionFixture(async ({ registryPath, qrPath }) => {
		let githubIdentityId = 9999;
		const fetchImpl = async (url) => {
			if (url === 'https://github.com/login/oauth/access_token') {
				return new Response(JSON.stringify({ access_token: 'reauth-provider-token' }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			}
			if (url === 'https://api.github.com/user') {
				return new Response(JSON.stringify({ id: githubIdentityId, login: 'subscription-owner' }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			}
			throw new Error('unexpected reauthentication request');
		};

		await withIsolatedApp({
			fetchImpl,
			config: {
				subscriptionAccessEnabled: true,
				subscriptionAccessFixture: false,
				subscriptionAccessRegistry: registryPath,
				subscriptionAccessFixtureQr: qrPath,
			},
		}, async ({ request: isolatedRequest, db: isolatedDb }) => {
			const login = await isolatedRequest('/api/auth/dev-login', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ login: 'subscription-owner', name: 'Subscription Owner' }),
			});
			const userId = grantSubscriptionPermission(isolatedDb, 'subscription-owner');
			isolatedDb.prepare('UPDATE users SET github_id = ? WHERE id = ?').run(4242, userId);
			const authHeaders = { authorization: `Bearer ${login.body.token}` };

			const runReauth = async () => {
				const start = await isolatedRequest('/api/admin/subscriptions/unlock', {
					method: 'POST',
					headers: { ...authHeaders, origin: 'https://xgwnje.cn', 'content-type': 'application/json' },
					body: JSON.stringify({}),
				});
				assert.equal(start.response.status, 200);
				assert.match(start.body.authorizeUrl, /^https:\/\/github\.com\/login\/oauth\/authorize\?/);
				const authorize = new URL(start.body.authorizeUrl);
				assert.equal(authorize.searchParams.get('prompt'), 'select_account');
				assert.equal(authorize.searchParams.get('login'), 'subscription-owner');
				assert.equal(new URL(authorize.searchParams.get('redirect_uri')).pathname, '/api/auth/github/callback');
				const state = authorize.searchParams.get('state');
				assert.ok(state);
				const challengeCookie = cookieHeader(responseCookies(start.response));
				assert.match(challengeCookie, /homepage_subscription_state_dev=/);
				assert.match(challengeCookie, /homepage_subscription_verifier_dev=/);
				return isolatedRequest(`/api/auth/github/callback?state=${encodeURIComponent(state)}&code=test-code`, {
					headers: { cookie: challengeCookie },
					redirect: 'manual',
				});
			};

			const mismatch = await runReauth();
			assert.equal(mismatch.response.status, 302);
			assert.match(mismatch.response.headers.get('location') || '', /reauth=failed/);
			assert.equal(isolatedDb.prepare('SELECT COUNT(*) AS count FROM sensitive_sessions').get().count, 0);

			githubIdentityId = 4242;
			const verified = await runReauth();
			assert.equal(verified.response.status, 302);
			assert.equal(verified.response.headers.get('location'), 'https://xgwnje.cn/admin/subscriptions/');
			const sensitiveCookie = cookieHeader(responseCookies(verified.response));
			assert.match(sensitiveCookie, /homepage_subscription_access_dev=/);
			const stored = isolatedDb.prepare(
				"SELECT token_hash, user_id, purpose, expires_at, revoked_at FROM sensitive_sessions WHERE user_id = ?"
			).get(userId);
			assert.equal(stored.user_id, userId);
			assert.equal(stored.purpose, 'subscription-access');
			assert.match(stored.token_hash, /^[0-9a-f]{64}$/);
			assert.doesNotMatch(sensitiveCookie, new RegExp(stored.token_hash));

			const status = await isolatedRequest('/api/admin/subscriptions/status', {
				headers: { ...authHeaders, cookie: sensitiveCookie },
			});
			assert.equal(status.body.unlocked, true);

			const logout = await isolatedRequest('/api/auth/logout', {
				method: 'POST',
				headers: { ...authHeaders, cookie: sensitiveCookie },
			});
			assert.equal(logout.response.status, 200);
			assert.ok(isolatedDb.prepare(
				"SELECT revoked_at FROM sensitive_sessions WHERE user_id = ? AND purpose = 'subscription-access'"
			).get(userId).revoked_at);
		});
	});
});
