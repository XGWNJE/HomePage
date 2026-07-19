import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseArticleFrontmatter } from '../../scripts/site-release.mjs';
import { randomToken } from '../internal/request.js';
import { adminAuth } from '../internal/session.js';
import { runSiteRelease, syncSiteRepo } from '../internal/site-release.js';

const ARTICLE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*-(?:cn|en)$/;

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
}
