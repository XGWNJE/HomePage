import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { marked } from 'marked';

import { parseArticleFrontmatter } from '../../scripts/site-release.mjs';
import { cleanText, randomToken } from '../internal/request.js';
import { adminAuth } from '../internal/session.js';
import { runSiteRelease, syncSiteRepo } from '../internal/site-release.js';

const ARTICLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*-(?:cn|en)$/;
const DRAFT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*-cn$/;
const UPLOAD_IMAGE_PATTERN = /(?:https?:\/\/[a-z0-9.-]+)?\/uploads\/(img_[A-Za-z0-9_-]+\.(?:gif|jpe?g|png|webp))/gi;
const DRAFT_LIMITS = { title: 200, description: 500, tags: 500, category: 100, body: 200_000 };

function blogDir(config) {
	return join(config.siteRepoDir, 'src', 'content', 'blog');
}

function listArticles(config) {
	const dir = blogDir(config);
	if (!existsSync(dir)) return null;
	return readdirSync(dir)
		.filter((name) => ARTICLE_ID_PATTERN.test(name.replace(/\.mdx?$/, '')) && /\.mdx?$/.test(name))
		.sort()
		.map((name) => {
			const source = readFileSync(join(dir, name), 'utf8');
			const fields = parseArticleFrontmatter(source);
			const id = name.replace(/\.mdx?$/, '');
			return {
				id,
				file: name,
				format: name.endsWith('.mdx') ? 'mdx' : 'md',
				title: fields.title || id,
				lang: fields.lang || '',
				group: fields.group || id.replace(/-(?:cn|en)$/, ''),
				draft: fields.draft === 'true',
				pubDate: fields.pubDate || '',
				category: fields.category || '',
				tags: fields.tags || '',
			};
		});
}

function readArticle(config, id) {
	for (const ext of ['.md', '.mdx']) {
		const file = join(blogDir(config), `${id}${ext}`);
		if (existsSync(file)) {
			const source = readFileSync(file, 'utf8');
			return { id, file: `${id}${ext}`, format: ext === '.mdx' ? 'mdx' : 'md', frontmatter: parseArticleFrontmatter(source), source };
		}
	}
	return null;
}

function recordAudit(db, auth, action, target, detail) {
	db.prepare(
		'INSERT INTO admin_audit (id, user_login, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)'
	).run(randomToken(12), auth.login || auth.email || 'unknown', action, target, JSON.stringify(detail ?? null), Date.now());
}

function yamlString(value) {
	return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function todayIso() {
	return new Date().toISOString().slice(0, 10);
}

function buildArticleSource(draft) {
	const group = draft.slug.slice(0, -3);
	const tags = String(draft.tags || '')
		.split(',')
		.map((tag) => tag.trim())
		.filter(Boolean);
	const lines = [
		'---',
		`title: ${yamlString(draft.title.trim())}`,
		`description: ${yamlString(draft.description.trim())}`,
		`pubDate: ${todayIso()}`,
		'lang: "cn"',
		'author: "XGWNJE"',
		`group: ${yamlString(group)}`,
		`tags: [${tags.map(yamlString).join(', ')}]`,
		`category: ${yamlString(draft.category.trim() || 'Notes')}`,
		'draft: false',
		'---',
		'',
		String(draft.body || '').replaceAll('\r\n', '\n').trim(),
		'',
	];
	return lines.join('\n');
}

function validateDraftForPublish(draft) {
	const problems = [];
	if (!DRAFT_SLUG_PATTERN.test(draft.slug)) problems.push('slug 必须是小写字母/数字/连字符并以 -cn 结尾');
	if (!String(draft.title || '').trim()) problems.push('缺少标题');
	if (!String(draft.description || '').trim()) problems.push('缺少描述');
	if (!String(draft.body || '').trim()) problems.push('正文为空');
	return problems;
}

// 把正文中引用的本站上传图片（/uploads/img_*）复制到临时目录，
// 映射为文章专属资产 public/image/blog/<group>/，并把正文 URL 改写为站内路径。
function materializeUploadImages(body, config, group, tempDir) {
	const seen = new Map();
	const rewritten = String(body).replace(UPLOAD_IMAGE_PATTERN, (match, name) => {
		const lower = name.toLowerCase();
		if (!seen.has(lower)) {
			const sourcePath = join(config.uploadDir, name);
			if (!existsSync(sourcePath)) throw new Error(`正文引用的上传图片不存在：${name}`);
			const contentPath = join(tempDir, name);
			copyFileSync(sourcePath, contentPath);
			seen.set(lower, { repoPath: `public/image/blog/${group}/${lower}`, contentPath });
		}
		return `/image/blog/${group}/${lower}`;
	});
	return { body: rewritten, images: [...seen.values()] };
}

export function registerArticleRoutes(app, { db, config, releaseRunner }) {
	const release = releaseRunner ?? ((job) => runSiteRelease(config, job));

	app.get('/api/admin/articles', (req, res) => {
		if (!adminAuth(db, config, req).authorized) return res.status(403).json({ error: 'Unauthorized' });
		const sync = syncSiteRepo(config);
		const articles = listArticles(config);
		if (!articles) return res.status(503).json({ error: 'Site repository is not available on this host' });
		res.json({ articles, sync: sync.synced });
	});

	app.get('/api/admin/article', (req, res) => {
		if (!adminAuth(db, config, req).authorized) return res.status(403).json({ error: 'Unauthorized' });
		const id = String(req.query.id || '');
		if (!ARTICLE_ID_PATTERN.test(id)) return res.status(400).json({ error: 'Invalid article id' });
		const article = readArticle(config, id);
		if (!article) return res.status(404).json({ error: 'Article not found' });
		res.json(article);
	});

	app.delete('/api/admin/article', async (req, res) => {
		const auth = adminAuth(db, config, req);
		if (!auth.authorized) return res.status(403).json({ error: 'Unauthorized' });
		const id = String(req.query.id || '');
		if (!ARTICLE_ID_PATTERN.test(id)) return res.status(400).json({ error: 'Invalid article id' });
		const withPair = req.query.pair === '1' || req.query.pair === 'true';

		const target = readArticle(config, id);
		if (!target) return res.status(404).json({ error: 'Article not found' });
		if (target.format !== 'md') return res.status(409).json({ error: 'Only plain Markdown articles can be deleted through this channel' });

		const deletes = [target.file.startsWith('src/') ? target.file : `src/content/blog/${target.file}`];
		if (withPair) {
			const pairId = id.endsWith('-cn') ? `${id.slice(0, -3)}-en` : `${id.slice(0, -3)}-cn`;
			const pair = readArticle(config, pairId);
			if (pair && pair.format === 'md') deletes.push(`src/content/blog/${pair.file}`);
		}

		recordAudit(db, auth, 'article.delete', id, { deletes, withPair });
		try {
			const summary = await release({ deletes, message: `admin: 删除文章 ${deletes.join('、')}` });
			res.json({ ok: true, deleted: deletes, release: summary });
		} catch (error) {
			res.status(502).json({ error: `Release failed: ${error.message}` });
		}
	});

	app.get('/api/admin/article-audit', (req, res) => {
		if (!adminAuth(db, config, req).authorized) return res.status(403).json({ error: 'Unauthorized' });
		const items = db.prepare(
			'SELECT id, user_login, action, target, detail, created_at FROM admin_audit ORDER BY created_at DESC LIMIT 100'
		).all();
		res.json({ items });
	});

	// ---- 网页编辑器：草稿 + 预览 + 发表 ----

	app.post('/api/admin/article/draft', (req, res) => {
		const auth = adminAuth(db, config, req);
		if (!auth.authorized) return res.status(403).json({ error: 'Unauthorized' });
		const input = req.body || {};
		const slug = cleanText(input.slug || '', 120);
		if (!DRAFT_SLUG_PATTERN.test(slug)) {
			return res.status(400).json({ error: 'slug 必须是小写字母/数字/连字符，并以 -cn 结尾' });
		}
		const fields = {
			slug,
			title: cleanText(input.title || '', DRAFT_LIMITS.title),
			description: cleanText(input.description || '', DRAFT_LIMITS.description),
			tags: cleanText(input.tags || '', DRAFT_LIMITS.tags),
			category: cleanText(input.category || '', DRAFT_LIMITS.category),
			body: String(input.body || '').slice(0, DRAFT_LIMITS.body),
		};
		const now = Date.now();
		const id = cleanText(input.id || '', 64);
		if (id) {
			const existing = db.prepare('SELECT id, created_at FROM article_drafts WHERE id = ?').get(id);
			if (!existing) return res.status(404).json({ error: 'Draft not found' });
			db.prepare(
				`UPDATE article_drafts SET slug = ?, title = ?, description = ?, tags = ?, category = ?, body = ?, updated_at = ?
				 WHERE id = ?`
			).run(fields.slug, fields.title, fields.description, fields.tags, fields.category, fields.body, now, id);
			return res.json({ ok: true, draft: { id, ...fields, created_at: existing.created_at, updated_at: now } });
		}
		const newId = randomToken(12);
		db.prepare(
			`INSERT INTO article_drafts (id, slug, title, description, tags, category, body, created_at, updated_at, author_user_id)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		).run(newId, fields.slug, fields.title, fields.description, fields.tags, fields.category, fields.body, now, now, auth.userId || null);
		res.status(201).json({ ok: true, draft: { id: newId, ...fields, created_at: now, updated_at: now } });
	});

	app.get('/api/admin/article/drafts', (req, res) => {
		if (!adminAuth(db, config, req).authorized) return res.status(403).json({ error: 'Unauthorized' });
		const drafts = db.prepare(
			'SELECT id, slug, title, category, updated_at, created_at FROM article_drafts ORDER BY updated_at DESC LIMIT 200'
		).all();
		res.json({ drafts });
	});

	app.get('/api/admin/article/draft', (req, res) => {
		if (!adminAuth(db, config, req).authorized) return res.status(403).json({ error: 'Unauthorized' });
		const draft = db.prepare('SELECT * FROM article_drafts WHERE id = ?').get(String(req.query.id || ''));
		if (!draft) return res.status(404).json({ error: 'Draft not found' });
		res.json({ draft });
	});

	app.delete('/api/admin/article/draft', (req, res) => {
		const auth = adminAuth(db, config, req);
		if (!auth.authorized) return res.status(403).json({ error: 'Unauthorized' });
		const id = String(req.query.id || '');
		const existing = db.prepare('SELECT id, slug FROM article_drafts WHERE id = ?').get(id);
		if (!existing) return res.status(404).json({ error: 'Draft not found' });
		db.prepare('DELETE FROM article_drafts WHERE id = ?').run(id);
		recordAudit(db, auth, 'article.draft-delete', existing.slug || id, { id });
		res.json({ ok: true, deleted: id });
	});

	app.post('/api/admin/article/preview', (req, res) => {
		if (!adminAuth(db, config, req).authorized) return res.status(403).json({ error: 'Unauthorized' });
		const markdown = String(req.body?.markdown || '').slice(0, DRAFT_LIMITS.body);
		// 预览由 marked 渲染，与 Astro 的内容管线并非逐字一致；仅用于编辑时校对。
		const html = marked.parse(markdown, { async: false });
		res.json({ ok: true, html });
	});

	app.post('/api/admin/article/publish', async (req, res) => {
		const auth = adminAuth(db, config, req);
		if (!auth.authorized) return res.status(403).json({ error: 'Unauthorized' });
		const id = String(req.body?.id || '');
		const draft = db.prepare('SELECT * FROM article_drafts WHERE id = ?').get(id);
		if (!draft) return res.status(404).json({ error: 'Draft not found' });
		const problems = validateDraftForPublish(draft);
		if (problems.length > 0) return res.status(400).json({ error: `草稿不完整：${problems.join('；')}`, problems });
		if (readArticle(config, draft.slug)) {
			return res.status(409).json({ error: `已存在同名文章：${draft.slug}` });
		}

		const group = draft.slug.slice(0, -3);
		const tempDir = mkdtempSync(join(tmpdir(), 'article-publish-'));
		recordAudit(db, auth, 'article.publish', draft.slug, { id });
		try {
			const { body, images } = materializeUploadImages(draft.body, config, group, tempDir);
			const articlePath = join(tempDir, `${draft.slug}.md`);
			writeFileSync(articlePath, buildArticleSource({ ...draft, body }), 'utf8');
			const writes = [{ repoPath: `src/content/blog/${draft.slug}.md`, contentPath: articlePath }, ...images];
			const summary = await release({ writes, message: `admin: 发表文章 ${draft.slug}` });
			db.prepare('DELETE FROM article_drafts WHERE id = ?').run(id);
			res.json({ ok: true, slug: draft.slug, release: summary });
		} catch (error) {
			// 发布失败时草稿保留，管理员可修正后重试。
			res.status(502).json({ error: `发布失败：${error.message}` });
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
}
