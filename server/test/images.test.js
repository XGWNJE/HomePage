import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

import sharp from 'sharp';

import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';
import { createDecodeLimiter } from '../src/routes/images.js';

const PNG = await sharp({
	create: { width: 2, height: 2, channels: 4, background: { r: 30, g: 120, b: 210, alpha: 1 } },
}).png().toBuffer();
const SECOND_FRAME = await sharp({
	create: { width: 2, height: 2, channels: 4, background: { r: 210, g: 80, b: 30, alpha: 1 } },
}).png().toBuffer();
const ANIMATED_GIF = await sharp([PNG, SECOND_FRAME], { join: { animated: true } })
	.gif({ delay: [100, 100], keepDuplicateFrames: true })
	.toBuffer();

function testConfig(root, overrides = {}) {
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
		uploadDir: join(root, 'uploads'),
		uploadTempDir: join(root, '.uploads-tmp'),
		uploadRecoveryDir: join(root, '.uploads-recovery'),
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
		serviceVersion: 'test',
		serviceRevision: 'test',
		turnstileSiteKey: '',
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

async function withApp(overrides, callback) {
	const root = mkdtempSync(join(tmpdir(), 'homepage-images-test-'));
	const db = createDatabase(join(root, 'api.sqlite'));
	const config = testConfig(root, overrides);
	const app = createApp({ db, config });
	const server = await new Promise((resolve) => {
		const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
	});
	const address = server.address();
	const baseUrl = `http://127.0.0.1:${address.port}`;
	try {
		await callback({ baseUrl, config, db });
	} finally {
		await new Promise((resolve) => server.close(resolve));
		db.close();
		rmSync(root, { recursive: true, force: true });
	}
}

async function jsonRequest(baseUrl, path, options = {}) {
	const response = await fetch(`${baseUrl}${path}`, options);
	const text = await response.text();
	return { response, body: text ? JSON.parse(text) : null };
}

async function login(baseUrl, loginName) {
	const result = await jsonRequest(baseUrl, '/api/auth/dev-login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ login: loginName, name: loginName }),
	});
	assert.equal(result.response.status, 200);
	return result.body.token;
}

async function upload(baseUrl, token, bytes, { filename = 'image.png', mimeType = 'image/png' } = {}) {
	const form = new FormData();
	form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
	return jsonRequest(baseUrl, '/api/images', {
		method: 'POST',
		headers: { authorization: `Bearer ${token}` },
		body: form,
	});
}

function assertNoArtifacts(config) {
	assert.deepEqual(readdirSync(config.uploadDir), []);
	assert.deepEqual(readdirSync(config.uploadTempDir), []);
}

test('strict decoding rejects spoofed PNG data and declared format mismatches without residue', async () => {
	await withApp({}, async ({ baseUrl, config, db }) => {
		const token = await login(baseUrl, 'strict-upload');
		const spoofed = await upload(baseUrl, token, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		assert.equal(spoofed.response.status, 400);

		const mismatch = await upload(baseUrl, token, PNG, {
			filename: 'not-really-jpeg.jpg',
			mimeType: 'image/jpeg',
		});
		assert.equal(mismatch.response.status, 400);
		assert.equal(db.prepare('SELECT COUNT(*) AS count FROM images').get().count, 0);
		assertNoArtifacts(config);
	});
});

test('a decoded image is atomically published with verified metadata and nosniff', async () => {
	await withApp({}, async ({ baseUrl, config, db }) => {
		const token = await login(baseUrl, 'successful-upload');
		const uploaded = await upload(baseUrl, token, PNG);
		assert.equal(uploaded.response.status, 201);
		assert.equal(uploaded.body.ok, true);
		assert.match(uploaded.body.url, /^https:\/\/api\.xgwnje\.cn\/uploads\/img_[A-Za-z0-9_-]+\.png$/);

		const row = db.prepare('SELECT path, size, content_type FROM images').get();
		assert.equal(row.size, PNG.length);
		assert.equal(row.content_type, 'image/png');
		assert.deepEqual(readFileSync(row.path), PNG);
		assert.deepEqual(readdirSync(config.uploadTempDir), []);
		if (process.platform !== 'win32') {
			assert.equal(statSync(config.uploadTempDir).mode & 0o777, 0o700);
		}

		const storedName = new URL(uploaded.body.url).pathname.split('/').at(-1);
		const served = await fetch(`${baseUrl}/uploads/${storedName}`);
		assert.equal(served.status, 200);
		assert.equal(served.headers.get('content-type'), 'image/png');
		assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
		assert.deepEqual(Buffer.from(await served.arrayBuffer()), PNG);
	});
});

test('byte, total-pixel, and frame limits reject images without temporary files', async () => {
	await withApp({ uploadMaxFileBytes: PNG.length - 1 }, async ({ baseUrl, config }) => {
		const token = await login(baseUrl, 'byte-limit');
		assert.equal((await upload(baseUrl, token, PNG)).response.status, 413);
		assertNoArtifacts(config);
	});

	await withApp({ uploadMaxPixels: 3 }, async ({ baseUrl, config }) => {
		const token = await login(baseUrl, 'pixel-limit');
		assert.equal((await upload(baseUrl, token, PNG)).response.status, 413);
		assertNoArtifacts(config);
	});

	await withApp({ uploadMaxFrames: 1 }, async ({ baseUrl, config }) => {
		const token = await login(baseUrl, 'frame-limit');
		assert.equal((await upload(baseUrl, token, ANIMATED_GIF, {
			filename: 'animated.gif',
			mimeType: 'image/gif',
		})).response.status, 413);
		assertNoArtifacts(config);
	});
});

test('per-user quota and both user and IP rate limits are enforced', async () => {
	await withApp({
		uploadMaxFileBytes: PNG.length + 1,
		uploadUserQuotaBytes: PNG.length + 1,
	}, async ({ baseUrl, config, db }) => {
		const token = await login(baseUrl, 'quota-user');
		assert.equal((await upload(baseUrl, token, PNG)).response.status, 201);
		assert.equal((await upload(baseUrl, token, PNG)).response.status, 413);
		assert.equal(db.prepare('SELECT COUNT(*) AS count FROM images').get().count, 1);
		assert.equal(readdirSync(config.uploadDir).length, 1);
		assert.deepEqual(readdirSync(config.uploadTempDir), []);
	});

	await withApp({ uploadRateLimitPerUser: 1 }, async ({ baseUrl, config }) => {
		const token = await login(baseUrl, 'rate-user');
		assert.equal((await upload(baseUrl, token, PNG)).response.status, 201);
		assert.equal((await upload(baseUrl, token, PNG)).response.status, 429);
		assert.equal(readdirSync(config.uploadDir).length, 1);
		assert.deepEqual(readdirSync(config.uploadTempDir), []);
	});

	await withApp({ uploadRateLimitPerIp: 1 }, async ({ baseUrl, config }) => {
		const firstToken = await login(baseUrl, 'rate-ip-one');
		const secondToken = await login(baseUrl, 'rate-ip-two');
		assert.equal((await upload(baseUrl, firstToken, PNG)).response.status, 201);
		assert.equal((await upload(baseUrl, secondToken, PNG)).response.status, 429);
		assert.equal(readdirSync(config.uploadDir).length, 1);
		assert.deepEqual(readdirSync(config.uploadTempDir), []);
	});
});

test('multipart parsing, aborted requests, and database failures leave no uncommitted files', async () => {
	await withApp({}, async ({ baseUrl, config, db }) => {
		const token = await login(baseUrl, 'failure-cleanup');
		const boundary = 'incomplete-test-boundary';
		const malformed = await jsonRequest(baseUrl, '/api/images', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': `multipart/form-data; boundary=${boundary}`,
			},
			body: Buffer.concat([
				Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bad.png"\r\nContent-Type: image/png\r\n\r\n`),
				PNG.subarray(0, 16),
			]),
		});
		assert.equal(malformed.response.status, 400);
		assertNoArtifacts(config);

		await abortMultipartRequest(baseUrl, token);
		await delay(100);
		assertNoArtifacts(config);

		db.exec(`
			CREATE TRIGGER fail_image_insert BEFORE INSERT ON images
			BEGIN
				SELECT RAISE(FAIL, 'private SQLite path failure');
			END;
		`);
		const failed = await upload(baseUrl, token, PNG);
		assert.equal(failed.response.status, 500);
		assert.deepEqual(failed.body, { error: 'Upload failed' });
		assert.doesNotMatch(JSON.stringify(failed.body), /private|sqlite|path/i);
		assert.equal(db.prepare('SELECT COUNT(*) AS count FROM images').get().count, 0);
		assertNoArtifacts(config);
	});
});

test('image decoding concurrency is bounded independently of request rate limits', async () => {
	let releaseFirst;
	let markStarted;
	const started = new Promise((resolve) => { markStarted = resolve; });
	const inspect = createDecodeLimiter(1, async (value) => {
		markStarted();
		await new Promise((resolve) => { releaseFirst = resolve; });
		return value;
	});
	const first = inspect('first');
	await started;
	await assert.rejects(inspect('second'), (error) => error?.status === 429);
	releaseFirst();
	assert.equal(await first, 'first');
});

test('startup reconciliation removes interrupted uploads and unreferenced managed files', () => {
	const root = mkdtempSync(join(tmpdir(), 'homepage-images-reconcile-'));
	const db = createDatabase(join(root, 'api.sqlite'));
	const config = testConfig(root);
	try {
		mkdirSync(config.uploadDir, { recursive: true });
		mkdirSync(config.uploadTempDir, { recursive: true });
		writeFileSync(join(config.uploadTempDir, 'img_interrupted.upload'), PNG);
		writeFileSync(join(config.uploadDir, 'img_orphan.png'), PNG);
		writeFileSync(join(config.uploadDir, 'operator-note.txt'), 'preserve non-managed files');

		createApp({ db, config });

		assert.deepEqual(readdirSync(config.uploadTempDir), []);
		assert.deepEqual(readdirSync(config.uploadDir), ['operator-note.txt']);
		assert.match(readdirSync(config.uploadRecoveryDir).at(0), /-img_orphan\.png$/);
	} finally {
		db.close();
		rmSync(root, { recursive: true, force: true });
	}
});

test('startup rejects a recovery directory inside the public upload tree', () => {
	const root = mkdtempSync(join(tmpdir(), 'homepage-images-paths-'));
	const db = createDatabase(join(root, 'api.sqlite'));
	const config = testConfig(root, {
		uploadRecoveryDir: join(root, 'uploads', '.recovery'),
	});
	try {
		assert.throws(
			() => createApp({ db, config }),
			/temporary and recovery directories must be outside uploads/i,
		);
	} finally {
		db.close();
		rmSync(root, { recursive: true, force: true });
	}
});

async function abortMultipartRequest(baseUrl, token) {
	const boundary = 'aborted-test-boundary';
	await new Promise((resolve) => {
		const request = httpRequest(`${baseUrl}/api/images`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': `multipart/form-data; boundary=${boundary}`,
			},
		});
		request.once('error', resolve);
		request.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="aborted.png"\r\nContent-Type: image/png\r\n\r\n`);
		request.write(Buffer.alloc(64 * 1024, 0x89));
		setTimeout(() => {
			request.destroy();
			resolve();
		}, 30);
	});
}
