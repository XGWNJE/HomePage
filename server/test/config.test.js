import assert from 'node:assert/strict';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

import { loadConfig } from '../src/config.js';

test('loadConfig exposes Turnstile and non-sensitive service metadata', () => {
	const config = loadConfig({
		NODE_ENV: 'production',
		TURNSTILE_SITE_KEY: 'turnstile-site',
		TURNSTILE_SECRET_KEY: 'turnstile-secret',
		SERVICE_VERSION: '1.2.3',
		SERVICE_REVISION: 'abcdef1',
	});

	assert.equal(config.turnstileSiteKey, 'turnstile-site');
	assert.equal(config.turnstileSecretKey, 'turnstile-secret');
	assert.equal(config.turnstileExpectedHostname, 'xgwnje.cn');
	assert.equal(config.serviceVersion, '1.2.3');
	assert.equal(config.serviceRevision, 'abcdef1');
});

test('Turnstile site and secret keys must be configured as a pair', () => {
	assert.throws(
		() => loadConfig({ NODE_ENV: 'production', TURNSTILE_SITE_KEY: 'site-only' }),
		/configured together/,
	);
	assert.throws(
		() => loadConfig({ NODE_ENV: 'production', TURNSTILE_SECRET_KEY: 'secret-only' }),
		/configured together/,
	);
});

test('development defaults allow both local Astro hostnames without weakening production CORS', () => {
	const development = loadConfig({ NODE_ENV: 'development' });
	assert.ok(development.allowedOrigins.includes('http://localhost:4321'));
	assert.ok(development.allowedOrigins.includes('http://127.0.0.1:4321'));

	const production = loadConfig({ NODE_ENV: 'production' });
	assert.deepEqual(production.allowedOrigins, ['https://xgwnje.cn']);
});

test('development login is opt-in and forbidden in production', () => {
	assert.equal(loadConfig({ NODE_ENV: 'development' }).devLogin, false);
	assert.equal(loadConfig({ NODE_ENV: 'development', DEV_LOGIN: 'true' }).devLogin, true);
	assert.throws(
		() => loadConfig({ NODE_ENV: 'production', DEV_LOGIN: 'true' }),
		/DEV_LOGIN cannot be enabled in production/,
	);
});

test('frontend and explicit CORS values are normalized to URL origins', () => {
	const config = loadConfig({
		NODE_ENV: 'production',
		FRONTEND_URL: 'https://xgwnje.cn/app/',
		ALLOWED_ORIGINS: 'https://xgwnje.cn/, https://admin.xgwnje.cn/tools',
	});

	assert.equal(config.frontendUrl, 'https://xgwnje.cn');
	assert.deepEqual(config.allowedOrigins, ['https://xgwnje.cn', 'https://admin.xgwnje.cn']);
});

test('upload security limits are positive safe integers with quota covering one file', () => {
	const config = loadConfig({
		NODE_ENV: 'production',
		UPLOAD_DIR: '/srv/homepage/uploads',
		UPLOAD_MAX_FILE_BYTES: '1024',
		UPLOAD_MAX_PIXELS: '2000',
		UPLOAD_MAX_FRAMES: '3',
		UPLOAD_USER_QUOTA_BYTES: '4096',
		UPLOAD_RATE_LIMIT_PER_USER: '4',
		UPLOAD_RATE_LIMIT_PER_IP: '5',
		UPLOAD_RATE_LIMIT_WINDOW_MS: '6000',
		UPLOAD_MAX_CONCURRENT_DECODES: '2',
	});

	assert.equal(config.uploadMaxFileBytes, 1024);
	assert.equal(config.uploadMaxPixels, 2000);
	assert.equal(config.uploadMaxFrames, 3);
	assert.equal(config.uploadUserQuotaBytes, 4096);
	assert.equal(config.uploadRateLimitPerUser, 4);
	assert.equal(config.uploadRateLimitPerIp, 5);
	assert.equal(config.uploadRateLimitWindowMs, 6000);
	assert.equal(config.uploadMaxConcurrentDecodes, 2);
	const resolvedUploadDir = resolve(config.uploadDir);
	assert.equal(
		config.uploadTempDir,
		join(dirname(resolvedUploadDir), `.${basename(resolvedUploadDir)}-tmp`),
	);
	assert.equal(
		config.uploadRecoveryDir,
		join(dirname(resolvedUploadDir), `.${basename(resolvedUploadDir)}-recovery`),
	);

	for (const [name, value] of [
		['UPLOAD_MAX_FILE_BYTES', '0'],
		['UPLOAD_MAX_PIXELS', '-1'],
		['UPLOAD_MAX_FRAMES', '1.5'],
		['UPLOAD_USER_QUOTA_BYTES', String(Number.MAX_SAFE_INTEGER + 1)],
		['UPLOAD_RATE_LIMIT_PER_USER', 'not-a-number'],
		['UPLOAD_RATE_LIMIT_PER_IP', '0'],
		['UPLOAD_RATE_LIMIT_WINDOW_MS', '-100'],
		['UPLOAD_MAX_CONCURRENT_DECODES', '0'],
	]) {
		assert.throws(() => loadConfig({ NODE_ENV: 'production', [name]: value }), /positive safe integer/);
	}
	assert.throws(() => loadConfig({
		NODE_ENV: 'production',
		UPLOAD_MAX_FILE_BYTES: '2048',
		UPLOAD_USER_QUOTA_BYTES: '1024',
	}), /greater than or equal/);
});

test('subscription fixture access is explicit, bounded, and forbidden in production', () => {
	const development = loadConfig({
		NODE_ENV: 'development',
		SUBSCRIPTION_ACCESS_ENABLED: 'true',
		SUBSCRIPTION_ACCESS_FIXTURE: 'true',
		SUBSCRIPTION_ACCESS_REGISTRY: 'C:\\fixtures\\subscription-access.v1.json',
		SUBSCRIPTION_ACCESS_FIXTURE_QR: 'C:\\fixtures\\mobile-import.png',
		SUBSCRIPTION_ACCESS_TTL_SECONDS: '120',
	});
	assert.equal(development.subscriptionAccessEnabled, true);
	assert.equal(development.subscriptionAccessFixture, true);
	assert.equal(development.subscriptionAccessTtlSeconds, 120);

	assert.throws(() => loadConfig({
		NODE_ENV: 'production',
		SUBSCRIPTION_ACCESS_ENABLED: 'true',
		SUBSCRIPTION_ACCESS_FIXTURE: 'true',
		SUBSCRIPTION_ACCESS_REGISTRY: '/tmp/fixture.json',
		SUBSCRIPTION_ACCESS_FIXTURE_QR: '/tmp/fixture.png',
	}), /fixture access cannot be enabled in production/i);
	assert.throws(() => loadConfig({
		NODE_ENV: 'development',
		SUBSCRIPTION_ACCESS_TTL_SECONDS: '301',
	}), /60 and 300/);
});

test('production subscription access requires the existing GitHub reauthentication provider', () => {
	assert.throws(() => loadConfig({
		NODE_ENV: 'production',
		SUBSCRIPTION_ACCESS_ENABLED: 'true',
		SUBSCRIPTION_ACCESS_REGISTRY: '/var/lib/vps-proxies-subscription/access/homepage-admin.v1.json',
	}), /GitHub OAuth must be configured/i);

	const config = loadConfig({
		NODE_ENV: 'production',
		SUBSCRIPTION_ACCESS_ENABLED: 'true',
		SUBSCRIPTION_ACCESS_REGISTRY: '/var/lib/vps-proxies-subscription/access/homepage-admin.v1.json',
		GITHUB_CLIENT_ID: 'client-id',
		GITHUB_CLIENT_SECRET: 'client-secret',
	});
	assert.equal(config.subscriptionAccessEnabled, true);
	assert.equal(config.subscriptionAccessFixture, false);
});
