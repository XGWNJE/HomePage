import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';

import { createDatabase } from '../src/db.js';
import { registerPageRoutes } from '../src/routes/pages.js';

let db;
let server;
let baseUrl;
let clock = 1_000;
let tempDir;

before(async () => {
	tempDir = mkdtempSync(join(tmpdir(), 'homepage-pages-test-'));
	db = createDatabase(join(tempDir, 'api.sqlite'));
	const app = express();
	app.use(express.json({ limit: '3mb' }));
	registerPageRoutes(app, {
		db,
		now: () => ++clock,
		authorize: (req) => {
			const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
			if (token === 'admin') return { authorized: true, role: 'admin', login: 'owner' };
			if (token === 'agent') return { authorized: true, role: 'agent', login: 'writer-agent' };
			return { authorized: false };
		},
	});
	server = app.listen(0, '127.0.0.1');
	await new Promise((resolve) => server.once('listening', resolve));
	baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
	if (server) await new Promise((resolve) => server.close(resolve));
	db?.close();
	if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

async function json(path, { token, method = 'GET', body } = {}) {
	const headers = {};
	if (token) headers.Authorization = `Bearer ${token}`;
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
	return { response, body: await response.json() };
}

test('agent can discover site formats and receive the blog starter template', async () => {
	const formats = await json('/api/page-formats');
	assert.equal(formats.response.status, 200);
	assert.equal(formats.body.defaultFormatId, 'blog-article-v1');
	assert.ok(formats.body.items.some((format) => format.id === 'custom'));
	const blog = await json('/api/page-formats/blog-article-v1');
	assert.match(blog.body.format.starter, /<article>/);
	assert.match(blog.body.format.starter, /\{\{content\}\}/);
});

test('preset format is recorded and reports structural conformity', async () => {
	const upload = await json('/api/pages', {
		token: 'agent', method: 'POST',
		body: {
			slug: 'formatted-page', title: 'Formatted', summary: '', formatId: 'blog-article-v1',
			html: '<!doctype html><html><meta name="viewport" content="width=device-width"><style>body{color:black}</style><article><h1>Formatted</h1></article></html>',
		},
	});
	assert.equal(upload.response.status, 201);
	assert.equal(upload.body.formatId, 'blog-article-v1');
	assert.deepEqual(upload.body.review.format, { id: 'blog-article-v1', conforms: true, issues: [] });
	const detail = await json('/api/admin/pages/formatted-page', { token: 'admin' });
	assert.equal(detail.body.versions[0].format_id, 'blog-article-v1');
});

test('agent uploads an immutable draft and cannot use admin review routes', async () => {
	const upload = await json('/api/pages', {
		token: 'agent', method: 'POST',
		body: { slug: 'free-page', title: 'Free page', summary: 'Demo', html: '<!doctype html><h1>Hello</h1>' },
	});
	assert.equal(upload.response.status, 201);
	assert.equal(upload.body.status, 'draft');
	assert.match(upload.body.sha256, /^[a-f0-9]{64}$/);
	assert.equal((await json('/api/admin/pages', { token: 'agent' })).response.status, 403);

	const duplicate = await json('/api/pages', {
		token: 'agent', method: 'POST',
		body: { slug: 'free-page', title: 'Changed metadata', summary: '', html: '<!doctype html><h1>Hello</h1>' },
	});
	assert.equal(duplicate.response.status, 409);
	assert.equal(duplicate.body.versionId, upload.body.versionId);
});

test('draft is private until an admin approves and publishes its exact hash', async () => {
	const listBefore = await json('/api/pages');
	assert.deepEqual(listBefore.body.items, []);
	assert.equal((await json('/api/pages/free-page')).response.status, 404);

	const detail = await json('/api/admin/pages/free-page', { token: 'admin' });
	assert.equal(detail.response.status, 200);
	assert.equal(detail.body.versions.length, 1);
	const version = detail.body.versions[0];

	const premature = await json(`/api/admin/pages/free-page/versions/${version.id}/publish`, {
		token: 'admin', method: 'POST', body: { sha256: version.sha256 },
	});
	assert.equal(premature.response.status, 409);

	const approved = await json(`/api/admin/pages/free-page/versions/${version.id}/approve`, { token: 'admin', method: 'POST' });
	assert.equal(approved.response.status, 200);
	assert.equal(approved.body.sha256, version.sha256);
	const wrongHash = await json(`/api/admin/pages/free-page/versions/${version.id}/publish`, {
		token: 'admin', method: 'POST', body: { sha256: '0'.repeat(64) },
	});
	assert.equal(wrongHash.response.status, 409);

	const published = await json(`/api/admin/pages/free-page/versions/${version.id}/publish`, {
		token: 'admin', method: 'POST', body: { sha256: version.sha256 },
	});
	assert.equal(published.response.status, 200);
	const publicPage = await json('/api/pages/free-page');
	assert.equal(publicPage.response.status, 200);
	assert.equal(publicPage.body.page.html, '<!doctype html><h1>Hello</h1>');
	assert.equal(publicPage.body.page.render_mode, 'sandbox');
});

test('a new upload is a separate draft while the approved version stays public', async () => {
	const upload = await json('/api/pages', {
		token: 'agent', method: 'POST',
		body: { slug: 'free-page', title: 'Version two', summary: '', html: '<h1>Version two</h1>' },
	});
	assert.equal(upload.response.status, 201);
	const detail = await json('/api/admin/pages/free-page', { token: 'admin' });
	assert.equal(detail.body.versions.length, 2);
	assert.equal(detail.body.versions[0].status, 'draft');
	assert.equal((await json('/api/pages/free-page')).body.page.title, 'Free page');
});

test('admin archives the currently published page without deleting versions', async () => {
	const archived = await json('/api/admin/pages/free-page/archive', { token: 'admin', method: 'POST' });
	assert.equal(archived.response.status, 200);
	assert.equal((await json('/api/pages/free-page')).response.status, 404);
	const detail = await json('/api/admin/pages/free-page', { token: 'admin' });
	assert.equal(detail.body.versions.length, 2);
	assert.ok(detail.body.versions.some((version) => version.status === 'archived'));
});

test('upload validation and authentication reject malformed input', async () => {
	assert.equal((await json('/api/pages', { method: 'POST', body: {} })).response.status, 403);
	const invalid = await json('/api/pages', {
		token: 'agent', method: 'POST', body: { slug: '../bad', title: 'x', html: '<p>x</p>' },
	});
	assert.equal(invalid.response.status, 400);
});

test('upload records a lightweight risk report for admin review', async () => {
	const html = `<script src="https://cdn.example/app.js"></script>
		<iframe src="//video.example/embed"></iframe>
		<form action="https://api.example/send"><button onclick="send()">Send</button></form>`;
	const upload = await json('/api/pages', {
		token: 'agent', method: 'POST',
		body: { slug: 'risk-report', title: 'Risk report', summary: '', html },
	});
	assert.equal(upload.response.status, 201);
	assert.deepEqual(upload.body.review.counts, {
		scripts: 1, inlineEventHandlers: 1, iframes: 1, forms: 1, externalUrls: 3,
	});
	assert.deepEqual(upload.body.review.flags, {
		scripts: true, inlineEventHandlers: true, iframes: true, forms: true, externalUrls: true,
	});

	const detail = await json('/api/admin/pages/risk-report', { token: 'admin' });
	assert.deepEqual(detail.body.versions[0].review, upload.body.review);
	assert.equal('review_json' in detail.body.versions[0], false);
	const version = await json(`/api/admin/pages/risk-report/versions/${upload.body.versionId}`, { token: 'admin' });
	assert.deepEqual(version.body.version.review, upload.body.review);
});
