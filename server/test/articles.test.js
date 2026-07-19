import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/app.js';
import { createDatabase } from '../src/db.js';

let tempDir;
let server;
let baseUrl;
let db;
let releaseCalls;

const demoCn = `---
title: "演示文章"
description: "用于文章路由测试。"
pubDate: 2026-07-19
lang: "cn"
group: "demo"
tags: ["Demo"]
category: "Blog"
draft: false
---

## 正文
`;

function seedBlog(dir) {
	const blog = join(dir, 'src', 'content', 'blog');
	mkdirSync(blog, { recursive: true });
	writeFileSync(join(blog, 'demo-cn.md'), demoCn);
	writeFileSync(join(blog, 'demo-en.md'), demoCn.replace('lang: "cn"', 'lang: "en"'));
	writeFileSync(join(blog, 'widget-cn.mdx'), demoCn.replace('演示文章', 'MDX 文章'));
}

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
		turnstileSiteKey: '',
		turnstileSecretKey: '',
		turnstileExpectedHostname: 'xgwnje.cn',
		subscriptionAccessEnabled: false,
		subscriptionAccessFixture: false,
		subscriptionAccessRegistry: '',
		subscriptionAccessFixtureQr: '',
		subscriptionAccessTtlSeconds: 300,
		siteRepoDir: join(tempDir, 'site'),
		siteReleaseNodeBin: '/opt/node22/bin/node',
		siteReleaseUseSudo: false,
		siteRepoSyncCommand: join(tempDir, 'missing-sync'),
		...overrides,
	};
}

async function adminFetch(path, init = {}, token = 'test-admin-token') {
	const headers = new Headers(init.headers);
	if (token) headers.set('Authorization', `Bearer ${token}`);
	return fetch(`${baseUrl}${path}`, { ...init, headers });
}

before(async () => {
	tempDir = mkdtempSync(join(tmpdir(), 'homepage-articles-'));
	seedBlog(join(tempDir, 'site'));
	db = createDatabase(join(tempDir, 'test.sqlite'));
	releaseCalls = [];
	const app = createApp({
		db,
		config: testConfig(),
		releaseRunner: async (job) => {
			releaseCalls.push(job);
			return { releaseId: 'test-release', routes: ['/'] };
		},
	});
	server = app.listen(0, '127.0.0.1');
	await new Promise((resolve) => server.once('listening', resolve));
	baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
	server?.close();
	db?.close();
	rmSync(tempDir, { recursive: true, force: true });
});

test('article admin routes reject unauthenticated requests', async () => {
	for (const [method, path] of [
		['GET', '/api/admin/articles'],
		['GET', '/api/admin/article?id=demo-cn'],
		['DELETE', '/api/admin/article?id=demo-cn'],
		['GET', '/api/admin/article-audit'],
	]) {
		const response = await adminFetch(path, { method }, null);
		assert.equal(response.status, 403, path);
	}
});

test('articles list parses frontmatter from the site repository', async () => {
	const response = await adminFetch('/api/admin/articles');
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.sync, false);
	const demo = body.articles.find((article) => article.id === 'demo-cn');
	assert.ok(demo);
	assert.equal(demo.title, '演示文章');
	assert.equal(demo.lang, 'cn');
	assert.equal(demo.group, 'demo');
	assert.equal(demo.draft, false);
	assert.equal(demo.format, 'md');
	assert.ok(body.articles.some((article) => article.format === 'mdx'));
});

test('article read validates id and returns source', async () => {
	assert.equal((await adminFetch('/api/admin/article?id=../etc')).status, 400);
	assert.equal((await adminFetch('/api/admin/article?id=missing-cn')).status, 404);
	const response = await adminFetch('/api/admin/article?id=demo-cn');
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.frontmatter.title, '演示文章');
	assert.match(body.source, /## 正文/);
});

test('article delete runs a release and records audit', async () => {
	const response = await adminFetch('/api/admin/article?id=demo-cn&pair=1', { method: 'DELETE' });
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.ok, true);
	assert.deepEqual(body.deleted.sort(), [
		'src/content/blog/demo-cn.md',
		'src/content/blog/demo-en.md',
	]);
	assert.equal(releaseCalls.length, 1);
	assert.deepEqual(releaseCalls[0].deletes.sort(), body.deleted.sort());
	assert.match(releaseCalls[0].message, /demo-cn/);

	const audit = await (await adminFetch('/api/admin/article-audit')).json();
	assert.equal(audit.items.length, 1);
	assert.equal(audit.items[0].action, 'article.delete');
	assert.equal(audit.items[0].target, 'demo-cn');
});

test('article delete refuses MDX and missing articles', async () => {
	assert.equal((await adminFetch('/api/admin/article?id=widget-cn', { method: 'DELETE' })).status, 409);
	assert.equal((await adminFetch('/api/admin/article?id=missing-cn', { method: 'DELETE' })).status, 404);
	assert.equal(releaseCalls.length, 1);
});

test('article delete surfaces release failures', async () => {
	const response = await adminFetch('/api/admin/article?id=demo-cn', { method: 'DELETE' });
	assert.equal(response.status, 200);
	const failing = createApp({
		db,
		config: testConfig(),
		releaseRunner: async () => {
			throw new Error('build exploded');
		},
	});
	const failingServer = failing.listen(0, '127.0.0.1');
	await new Promise((resolve) => failingServer.once('listening', resolve));
	try {
		const failingBase = `http://127.0.0.1:${failingServer.address().port}`;
		const failed = await fetch(`${failingBase}/api/admin/article?id=demo-en`, {
			method: 'DELETE',
			headers: { Authorization: 'Bearer test-admin-token' },
		});
		assert.equal(failed.status, 502);
		assert.match((await failed.json()).error, /build exploded/);
	} finally {
		failingServer.close();
	}
});
