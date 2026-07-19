import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
	// body 字段供编辑器加载：不含 frontmatter 块。
	assert.match(body.body, /## 正文/);
	assert.doesNotMatch(body.body, /^---/);
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

// ---- 草稿 / 预览 / 发表 ----

async function adminJson(path, init = {}) {
	const headers = new Headers(init.headers);
	headers.set('Authorization', 'Bearer test-admin-token');
	if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
	const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
	return { response, body: await response.json() };
}

test('draft routes reject unauthenticated requests', async () => {
	for (const [method, path, init] of [
		['POST', '/api/admin/article/draft', { body: '{}' }],
		['GET', '/api/admin/article/drafts', {}],
		['GET', '/api/admin/article/draft?id=x', {}],
		['DELETE', '/api/admin/article/draft?id=x', {}],
		['POST', '/api/admin/article/preview', { body: '{}' }],
		['POST', '/api/admin/article/publish', { body: '{}' }],
	]) {
		const headers = new Headers({ 'Content-Type': 'application/json' });
		const response = await fetch(`${baseUrl}${path}`, { method, headers, body: init.body });
		assert.equal(response.status, 403, path);
	}
});

test('draft create validates slug and supports full lifecycle', async () => {
	const bad = await adminJson('/api/admin/article/draft', {
		method: 'POST',
		body: JSON.stringify({ slug: 'Bad Slug', title: 'x' }),
	});
	assert.equal(bad.response.status, 400);
	assert.match(bad.body.error, /-cn/);

	const created = await adminJson('/api/admin/article/draft', {
		method: 'POST',
		body: JSON.stringify({ slug: 'web-editor-demo-cn', title: '网页编辑器演示', body: '## 你好' }),
	});
	assert.equal(created.response.status, 201);
	const draftId = created.body.draft.id;
	assert.ok(draftId);

	const updated = await adminJson('/api/admin/article/draft', {
		method: 'POST',
		body: JSON.stringify({ id: draftId, slug: 'web-editor-demo-cn', title: '网页编辑器演示 v2', description: '描述' }),
	});
	assert.equal(updated.response.status, 200);
	assert.equal(updated.body.draft.title, '网页编辑器演示 v2');

	const list = await adminJson('/api/admin/article/drafts');
	assert.ok(list.body.drafts.some((draft) => draft.id === draftId && draft.title === '网页编辑器演示 v2'));

	const got = await adminJson(`/api/admin/article/draft?id=${draftId}`);
	assert.equal(got.body.draft.slug, 'web-editor-demo-cn');
	assert.equal(got.body.draft.description, '描述');

	const removed = await adminJson(`/api/admin/article/draft?id=${draftId}`, { method: 'DELETE' });
	assert.equal(removed.body.ok, true);
	assert.equal((await adminJson(`/api/admin/article/draft?id=${draftId}`)).response.status, 404);
});

test('preview renders markdown to html', async () => {
	const { response, body } = await adminJson('/api/admin/article/preview', {
		method: 'POST',
		body: JSON.stringify({ markdown: '## 标题\n\n**加粗** 文本' }),
	});
	assert.equal(response.status, 200);
	assert.match(body.html, /<h2/);
	assert.match(body.html, /<strong>加粗<\/strong>/);
});

test('publish rejects incomplete drafts and MDX conflicts', async () => {
	const created = await adminJson('/api/admin/article/draft', {
		method: 'POST',
		body: JSON.stringify({ slug: 'incomplete-demo-cn', title: '缺描述', body: '正文' }),
	});
	const draftId = created.body.draft.id;
	const incomplete = await adminJson('/api/admin/article/publish', {
		method: 'POST',
		body: JSON.stringify({ id: draftId }),
	});
	assert.equal(incomplete.response.status, 400);
	assert.match(incomplete.body.error, /缺少描述/);

	const conflict = await adminJson('/api/admin/article/draft', {
		method: 'POST',
		body: JSON.stringify({ slug: 'widget-cn', title: '冲突', description: '描述', body: '正文' }),
	});
	const conflicted = await adminJson('/api/admin/article/publish', {
		method: 'POST',
		body: JSON.stringify({ id: conflict.body.draft.id }),
	});
	assert.equal(conflicted.response.status, 409);
	assert.match(conflicted.body.error, /MDX/);

	const missing = await adminJson('/api/admin/article/publish', {
		method: 'POST',
		body: JSON.stringify({ id: 'missing-draft' }),
	});
	assert.equal(missing.response.status, 404);
});

test('publish overwrites an existing md article, keeps pubDate and sets updatedDate', async () => {
	let captured = null;
	const capturing = createApp({
		db,
		config: testConfig(),
		releaseRunner: async (job) => {
			captured = job.writes.map(({ repoPath, contentPath }) => ({
				repoPath,
				source: readFileSync(contentPath, 'utf8'),
			}));
			return { releaseId: 'test-release', routes: [] };
		},
	});
	const capturingServer = capturing.listen(0, '127.0.0.1');
	await new Promise((resolve) => capturingServer.once('listening', resolve));
	try {
		const capturingBase = `http://127.0.0.1:${capturingServer.address().port}`;
		const call = async (path, payload) => {
			const response = await fetch(`${capturingBase}${path}`, {
				method: 'POST',
				headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			return { response, body: await response.json() };
		};
		const created = await call('/api/admin/article/draft', {
			slug: 'demo-cn',
			title: '演示文章（修订）',
			description: '修订后的描述。',
			body: '## 修订正文',
		});
		const published = await call('/api/admin/article/publish', { id: created.body.draft.id });
		assert.equal(published.response.status, 200);
		const article = captured.find((write) => write.repoPath === 'src/content/blog/demo-cn.md');
		assert.ok(article);
		// demo-cn 的原始 pubDate 是 2026-07-19；覆盖时保留并追加 updatedDate。
		assert.match(article.source, /pubDate: 2026-07-19/);
		assert.match(article.source, /updatedDate: \d{4}-\d{2}-\d{2}/);
		assert.match(article.source, /title: "演示文章（修订）"/);
	} finally {
		capturingServer.close();
	}
});

test('publish writes the English pair when en_body is present', async () => {
	let captured = null;
	const capturing = createApp({
		db,
		config: testConfig(),
		releaseRunner: async (job) => {
			captured = job.writes.map(({ repoPath, contentPath }) => ({
				repoPath,
				source: readFileSync(contentPath, 'utf8'),
			}));
			return { releaseId: 'test-release', routes: [] };
		},
	});
	const capturingServer = capturing.listen(0, '127.0.0.1');
	await new Promise((resolve) => capturingServer.once('listening', resolve));
	try {
		const capturingBase = `http://127.0.0.1:${capturingServer.address().port}`;
		const call = async (path, payload) => {
			const response = await fetch(`${capturingBase}${path}`, {
				method: 'POST',
				headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			return { response, body: await response.json() };
		};
		const created = await call('/api/admin/article/draft', {
			slug: 'bilingual-demo-cn',
			title: '双语演示',
			description: '中文描述。',
			tags: 'Demo, 双语',
			category: 'Notes',
			body: '## 中文正文',
			en_title: 'Bilingual Demo',
			en_body: '## English body',
		});
		const published = await call('/api/admin/article/publish', { id: created.body.draft.id });
		assert.equal(published.response.status, 200);
		assert.equal(published.body.enSlug, 'bilingual-demo-en');

		const cn = captured.find((write) => write.repoPath === 'src/content/blog/bilingual-demo-cn.md');
		const en = captured.find((write) => write.repoPath === 'src/content/blog/bilingual-demo-en.md');
		assert.ok(cn && en);
		assert.match(en.source, /lang: "en"/);
		assert.match(en.source, /title: "Bilingual Demo"/);
		// en_description 留空时回退中文描述；group/tags/category 与中文版一致。
		assert.match(en.source, /description: "中文描述。"/);
		assert.match(en.source, /group: "bilingual-demo"/);
		assert.match(en.source, /tags: \["Demo", "双语"\]/);
		assert.match(en.source, /## English body/);
		const cnPubDate = cn.source.match(/pubDate: (.+)/)?.[1];
		const enPubDate = en.source.match(/pubDate: (.+)/)?.[1];
		assert.equal(enPubDate, cnPubDate);
		assert.doesNotMatch(en.source, /updatedDate/);
	} finally {
		capturingServer.close();
	}
});

test('publish writes article plus upload images, rewrites URLs and removes the draft', async () => {
	mkdirSync(join(tempDir, 'uploads'), { recursive: true });
	writeFileSync(join(tempDir, 'uploads', 'img_demo01.webp'), 'fake-webp');
	db.prepare(
		'INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
	).run('test-user', 4242, 'test-user', 1, 1);
	db.prepare(
		'INSERT INTO images (id, user_id, name, url, path, size, content_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	).run(
		'img_demo01',
		'test-user',
		'demo.webp',
		'https://api.xgwnje.cn/uploads/img_demo01.webp',
		join(tempDir, 'uploads', 'img_demo01.webp'),
		9,
		'image/webp',
		Date.now(),
	);

	let captured = null;
	const capturing = createApp({
		db,
		config: testConfig(),
		releaseRunner: async (job) => {
			captured = job.writes.map(({ repoPath, contentPath }) => ({
				repoPath,
				source: readFileSync(contentPath, 'utf8'),
			}));
			return { releaseId: 'test-release', routes: ['/blog/web-editor-demo-cn/'] };
		},
	});
	const capturingServer = capturing.listen(0, '127.0.0.1');
	await new Promise((resolve) => capturingServer.once('listening', resolve));
	try {
		const capturingBase = `http://127.0.0.1:${capturingServer.address().port}`;
		const call = async (path, payload) => {
			const response = await fetch(`${capturingBase}${path}`, {
				method: 'POST',
				headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			return { response, body: await response.json() };
		};
		const created = await call('/api/admin/article/draft', {
			slug: 'web-editor-demo-cn',
			title: '网页编辑器演示',
			description: '从后台发表的测试文章。',
			tags: 'Demo, 后台',
			category: 'Notes',
			body: '## 正文\n\n![演示图](https://api.xgwnje.cn/uploads/img_demo01.webp)\n',
		});
		const draftId = created.body.draft.id;

		const published = await call('/api/admin/article/publish', { id: draftId });
		assert.equal(published.response.status, 200);
		assert.equal(published.body.ok, true);
		assert.equal(published.body.slug, 'web-editor-demo-cn');

		assert.ok(captured);
		const article = captured.find((write) => write.repoPath === 'src/content/blog/web-editor-demo-cn.md');
		const image = captured.find((write) => write.repoPath === 'public/image/blog/web-editor-demo/img_demo01.webp');
		assert.ok(article, 'article write');
		assert.ok(image, 'image write');
		assert.equal(image.source, 'fake-webp');
		assert.match(article.source, /title: "网页编辑器演示"/);
		assert.match(article.source, /tags: \["Demo", "后台"\]/);
		assert.match(article.source, /group: "web-editor-demo"/);
		assert.match(article.source, /lang: "cn"/);
		assert.match(article.source, /!\[演示图\]\(\/image\/blog\/web-editor-demo\/img_demo01\.webp\)/);
		assert.doesNotMatch(article.source, /api\.xgwnje\.cn\/uploads/);

		const drafts = db.prepare('SELECT COUNT(*) AS count FROM article_drafts WHERE id = ?').get(draftId);
		assert.equal(drafts.count, 0);
		const audit = db.prepare("SELECT action FROM admin_audit WHERE action = 'article.publish' AND target = 'web-editor-demo-cn'").all();
		assert.equal(audit.length, 1);
	} finally {
		capturingServer.close();
	}
});

test('publish keeps the draft when the release fails', async () => {
	const failing = createApp({
		db,
		config: testConfig(),
		releaseRunner: async () => {
			throw new Error('lock conflict');
		},
	});
	const failingServer = failing.listen(0, '127.0.0.1');
	await new Promise((resolve) => failingServer.once('listening', resolve));
	try {
		const failingBase = `http://127.0.0.1:${failingServer.address().port}`;
		const call = async (path, payload) => {
			const response = await fetch(`${failingBase}${path}`, {
				method: 'POST',
				headers: { Authorization: 'Bearer test-admin-token', 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
			});
			return { response, body: await response.json() };
		};
		const created = await call('/api/admin/article/draft', {
			slug: 'failing-demo-cn',
			title: '失败保留',
			description: '描述',
			body: '正文',
		});
		const draftId = created.body.draft.id;
		const published = await call('/api/admin/article/publish', { id: draftId });
		assert.equal(published.response.status, 502);
		assert.match(published.body.error, /lock conflict/);
		const kept = db.prepare('SELECT id FROM article_drafts WHERE id = ?').get(draftId);
		assert.ok(kept, 'draft should survive a failed release');
		db.prepare('DELETE FROM article_drafts WHERE id = ?').run(draftId);
	} finally {
		failingServer.close();
	}
});
