import { createHash, randomBytes } from 'node:crypto';

import { bearerToken, adminAuth } from '../internal/session.js';

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,119}$/;
const LIMITS = { title: 200, summary: 1000, html: 2_000_000 };

const PAGE_FORMATS = {
	'blog-article-v1': {
		id: 'blog-article-v1',
		label: 'XGWNJE 博客文章',
		description: '接近现有博客的深色长文阅读样式，适合文章、教程与复盘。',
		required: ['完整 HTML 文档', '内嵌 CSS', '一个 article 元素', '一个 h1 标题', '移动端 viewport'],
		constraints: {
			scripts: '不要使用；公开阅读页默认不执行脚本',
			assets: '图片使用可公开访问的绝对 URL；不要依赖 Astro 组件或 Tailwind CDN',
			layout: '正文最大宽度 860px；兼容 390px 移动端；提供深色背景和清晰代码块',
		},
		designTokens: {
			background: '#09090b', surface: '#18181b', text: '#e4e4e7', muted: '#a1a1aa', accent: '#d6b66f', maxWidth: '860px',
		},
		starter: '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{title}}</title><style>body{margin:0;background:#09090b;color:#e4e4e7;font:17px/1.8 system-ui}article{max-width:860px;margin:auto;padding:48px 24px}h1{font-size:clamp(2rem,6vw,3.5rem);line-height:1.15}h2{margin-top:2.5em;color:#f4f4f5}p{color:#d4d4d8}pre{overflow:auto;padding:1rem;border:1px solid #3f3f46;border-radius:12px;background:#18181b}img{max-width:100%;height:auto;border-radius:16px}</style></head><body><article><header><h1>{{title}}</h1><p>{{summary}}</p></header>{{content}}</article></body></html>',
	},
	custom: {
		id: 'custom',
		label: '自由 HTML',
		description: '不套用站点视觉预设，由 Agent 自由设计；仍会进行安全边界扫描并在沙箱中显示。',
		required: ['非空 HTML'],
		constraints: { scripts: '公开阅读页默认不执行脚本' },
	},
};

function formatReview(formatId, html) {
	if (formatId !== 'blog-article-v1') return { id: formatId, conforms: true, issues: [] };
	const checks = [
		[/<!doctype\s+html/i, '缺少 HTML doctype'],
		[/<meta[^>]+name=["']viewport["']/i, '缺少移动端 viewport'],
		[/<style\b/i, '缺少内嵌 CSS'],
		[/<article\b/i, '缺少 article 主体'],
		[/<h1\b/i, '缺少 h1 标题'],
	];
	const issues = checks.filter(([pattern]) => !pattern.test(html)).map(([, message]) => message);
	return { id: formatId, conforms: issues.length === 0, issues };
}

function id() {
	return randomBytes(12).toString('base64url');
}

function sha256(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function recordAudit(db, actor, action, target, detail) {
	db.prepare(
		'INSERT INTO admin_audit (id, user_login, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
	).run(id(), String(actor || 'unknown'), action, target, JSON.stringify(detail), Date.now());
}

function runTransaction(db, operation) {
	db.exec('BEGIN IMMEDIATE');
	try {
		const result = operation();
		db.exec('COMMIT');
		return result;
	} catch (error) {
		db.exec('ROLLBACK');
		throw error;
	}
}

function countMatches(value, pattern) {
	return [...value.matchAll(pattern)].length;
}

export function reviewHtml(html) {
	const source = String(html || '');
	const counts = {
		scripts: countMatches(source, /<script\b/gi),
		inlineEventHandlers: countMatches(source, /\son[a-z][a-z0-9_-]*\s*=/gi),
		iframes: countMatches(source, /<iframe\b/gi),
		forms: countMatches(source, /<form\b/gi),
		externalUrls: countMatches(source, /\b(?:href|src|action)\s*=\s*["'](?:https?:)?\/\//gi),
	};
	return {
		counts,
		flags: Object.fromEntries(Object.entries(counts).map(([name, count]) => [name, count > 0])),
	};
}

function withParsedReview(row) {
	if (!row) return row;
	let review = null;
	try { review = JSON.parse(row.review_json || 'null'); } catch {}
	const { review_json: _reviewJson, ...rest } = row;
	return { ...rest, review };
}

function defaultAuthorize(db, config, req) {
	const admin = adminAuth(db, config, req);
	if (admin.authorized) return { ...admin, role: 'admin' };
	const token = bearerToken(req);
	if (config.pageAgentToken && token === config.pageAgentToken) {
		return { authorized: true, role: 'agent', login: 'page-agent', userId: null };
	}
	return { authorized: false, role: null, login: null, userId: null };
}

function forbidden(res) {
	return res.status(403).json({ error: 'Unauthorized' });
}

function pageVersion(db, slug, versionId) {
	return db.prepare(
		`SELECT v.id, v.page_id, p.slug, v.title, v.summary, v.html, v.sha256, v.status, v.review_json, v.format_id,
		        v.created_at, v.created_by, v.approved_at, v.approved_by
		   FROM page_versions v JOIN pages p ON p.id = v.page_id
		  WHERE p.slug = ? AND v.id = ? LIMIT 1`
	).get(slug, versionId);
}

/**
 * Register the immutable HTML page artifact API.
 *
 * Required database tables are `pages` and `page_versions` (see pages.test.js
 * for the expected schema). `authorize` may be injected for alternate auth and
 * must return { authorized, role: 'agent'|'admin', login?, userId? }.
 */
export function registerPageRoutes(app, { db, config = {}, authorize, now = () => Date.now() }) {
	const authFor = (req) => (authorize || ((request) => defaultAuthorize(db, config, request)))(req);
	const requireAdmin = (req, res) => {
		const auth = authFor(req);
		if (!auth?.authorized || auth.role !== 'admin') {
			forbidden(res);
			return null;
		}
		return auth;
	};

	app.get('/api/page-formats', (_req, res) => {
		res.json({ defaultFormatId: 'blog-article-v1', items: Object.values(PAGE_FORMATS) });
	});

	app.get('/api/page-formats/:formatId', (req, res) => {
		const format = PAGE_FORMATS[req.params.formatId];
		if (!format) return res.status(404).json({ error: 'Page format not found' });
		res.json({ format });
	});

	app.post('/api/pages', (req, res) => {
		const auth = authFor(req);
		if (!auth?.authorized || !['agent', 'admin'].includes(auth.role)) return forbidden(res);
		const input = req.body || {};
		const slug = String(input.slug || '').trim();
		const title = String(input.title || '').trim();
		const summary = String(input.summary || '').trim();
		const html = String(input.html || '');
		const formatId = String(input.formatId || 'custom');
		if (!SLUG_PATTERN.test(slug)) return res.status(400).json({ error: 'Invalid slug' });
		if (!title || title.length > LIMITS.title) return res.status(400).json({ error: 'Invalid title' });
		if (summary.length > LIMITS.summary) return res.status(400).json({ error: 'Invalid summary' });
		if (!html.trim() || html.length > LIMITS.html) return res.status(400).json({ error: 'Invalid html' });
		if (!PAGE_FORMATS[formatId]) return res.status(400).json({ error: 'Invalid formatId' });

		const digest = sha256(html);
		const review = { ...reviewHtml(html), format: formatReview(formatId, html) };
		const existing = db.prepare(
			`SELECT v.id, v.status FROM page_versions v JOIN pages p ON p.id = v.page_id
			  WHERE p.slug = ? AND v.sha256 = ? LIMIT 1`
		).get(slug, digest);
		if (existing) return res.status(409).json({ error: 'This artifact version already exists', versionId: existing.id, sha256: digest });

		const timestamp = now();
		const page = db.prepare('SELECT id FROM pages WHERE slug = ? LIMIT 1').get(slug);
		const pageId = page?.id || id();
		const versionId = id();
		const actor = auth.login || auth.userId || auth.role;
		runTransaction(db, () => {
			if (!page) db.prepare('INSERT INTO pages (id, slug, published_version_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)').run(pageId, slug, timestamp, timestamp);
			db.prepare(
				`INSERT INTO page_versions
				 (id, page_id, title, summary, html, sha256, status, review_json, created_at, created_by, approved_at, approved_by, format_id)
				 VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, NULL, NULL, ?)`
			).run(versionId, pageId, title, summary, html, digest, JSON.stringify(review), timestamp, String(actor || 'unknown'), formatId);
			db.prepare('UPDATE pages SET updated_at = ? WHERE id = ?').run(timestamp, pageId);
			recordAudit(db, actor, 'page.upload', slug, { versionId, sha256: digest, review });
		});
		res.status(201).json({ ok: true, slug, versionId, sha256: digest, status: 'draft', formatId, review });
	});

	app.get('/api/admin/pages', (req, res) => {
		if (!requireAdmin(req, res)) return;
		const items = db.prepare(
			`SELECT p.slug, p.published_version_id, p.created_at, p.updated_at,
			        COUNT(v.id) AS version_count,
			        SUM(CASE WHEN v.status = 'draft' THEN 1 ELSE 0 END) AS draft_count
			   FROM pages p LEFT JOIN page_versions v ON v.page_id = p.id
			  GROUP BY p.id ORDER BY p.updated_at DESC LIMIT 200`
		).all();
		res.json({ items });
	});

	app.get('/api/admin/pages/:slug', (req, res) => {
		if (!requireAdmin(req, res)) return;
		const page = db.prepare('SELECT * FROM pages WHERE slug = ? LIMIT 1').get(req.params.slug);
		if (!page) return res.status(404).json({ error: 'Page not found' });
		const versions = db.prepare(
			`SELECT id, title, summary, sha256, status, review_json, format_id, created_at, created_by, approved_at, approved_by
			   FROM page_versions WHERE page_id = ? ORDER BY created_at DESC`
		).all(page.id).map(withParsedReview);
		res.json({ page, versions });
	});

	app.get('/api/admin/pages/:slug/versions/:versionId', (req, res) => {
		if (!requireAdmin(req, res)) return;
		const version = withParsedReview(pageVersion(db, req.params.slug, req.params.versionId));
		if (!version) return res.status(404).json({ error: 'Page version not found' });
		res.json({ version });
	});

	app.post('/api/admin/pages/:slug/versions/:versionId/approve', (req, res) => {
		const auth = requireAdmin(req, res);
		if (!auth) return;
		const version = pageVersion(db, req.params.slug, req.params.versionId);
		if (!version) return res.status(404).json({ error: 'Page version not found' });
		if (version.status !== 'draft') return res.status(409).json({ error: 'Only draft versions can be approved' });
		const timestamp = now();
		db.prepare("UPDATE page_versions SET status = 'approved', approved_at = ?, approved_by = ? WHERE id = ? AND status = 'draft'")
			.run(timestamp, String(auth.login || auth.userId || 'admin'), version.id);
		recordAudit(db, auth.login || auth.userId, 'page.approve', version.slug, { versionId: version.id, sha256: version.sha256 });
		res.json({ ok: true, slug: version.slug, versionId: version.id, sha256: version.sha256, status: 'approved' });
	});

	app.post('/api/admin/pages/:slug/versions/:versionId/publish', (req, res) => {
		const auth = requireAdmin(req, res);
		if (!auth) return;
		const version = pageVersion(db, req.params.slug, req.params.versionId);
		if (!version) return res.status(404).json({ error: 'Page version not found' });
		if (version.status !== 'approved') return res.status(409).json({ error: 'Only approved versions can be published' });
		if (String(req.body?.sha256 || '') !== version.sha256) return res.status(409).json({ error: 'Approved artifact hash does not match' });
		const timestamp = now();
		runTransaction(db, () => {
			db.prepare("UPDATE page_versions SET status = 'approved' WHERE page_id = ? AND status = 'published'").run(version.page_id);
			db.prepare("UPDATE page_versions SET status = 'published' WHERE id = ?").run(version.id);
			db.prepare('UPDATE pages SET published_version_id = ?, updated_at = ? WHERE id = ?').run(version.id, timestamp, version.page_id);
			recordAudit(db, auth.login || auth.userId, 'page.publish', version.slug, { versionId: version.id, sha256: version.sha256 });
		});
		res.json({ ok: true, slug: version.slug, versionId: version.id, sha256: version.sha256, status: 'published' });
	});

	app.post('/api/admin/pages/:slug/archive', (req, res) => {
		const auth = requireAdmin(req, res);
		if (!auth) return;
		const page = db.prepare('SELECT id, published_version_id FROM pages WHERE slug = ? LIMIT 1').get(req.params.slug);
		if (!page) return res.status(404).json({ error: 'Page not found' });
		const timestamp = now();
		runTransaction(db, () => {
			if (page.published_version_id) db.prepare("UPDATE page_versions SET status = 'archived' WHERE id = ?").run(page.published_version_id);
			db.prepare('UPDATE pages SET published_version_id = NULL, updated_at = ? WHERE id = ?').run(timestamp, page.id);
			recordAudit(db, auth.login || auth.userId, 'page.archive', req.params.slug, { versionId: page.published_version_id });
		});
		res.json({ ok: true, slug: req.params.slug, status: 'archived' });
	});

	app.get('/api/pages', (_req, res) => {
		const items = db.prepare(
			`SELECT p.slug, v.title, v.summary, v.sha256, v.created_at AS published_at,
			        CASE WHEN v.format_id = 'legacy-blog-v1' THEN 'legacy' ELSE 'sandbox' END AS render_mode
			   FROM pages p JOIN page_versions v ON v.id = p.published_version_id
			  WHERE v.status = 'published' ORDER BY v.created_at DESC`
		).all();
		res.json({ items });
	});

	app.get('/api/pages/:slug', (req, res) => {
		const version = db.prepare(
			`SELECT p.slug, v.title, v.summary, v.html, v.sha256, v.created_at AS published_at,
			        CASE WHEN v.format_id = 'legacy-blog-v1' THEN 'legacy' ELSE 'sandbox' END AS render_mode
			   FROM pages p JOIN page_versions v ON v.id = p.published_version_id
			  WHERE p.slug = ? AND v.status = 'published' LIMIT 1`
		).get(req.params.slug);
		if (!version) return res.status(404).json({ error: 'Page not found' });
		res.json({ page: version });
	});
}
