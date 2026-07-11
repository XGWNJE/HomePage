import { normalizeSlug } from '../internal/request.js';

export function registerViewRoutes(app, { db, checkRate }) {
	app.get('/api/views', (req, res) => {
		const post = normalizeSlug(req.query.post);
		if (!post) return res.status(400).json({ error: 'Invalid post slug' });
		const row = db.prepare('SELECT views FROM post_views WHERE post_slug = ?').get(post);
		res.json({ post, views: Number(row?.views || 0) });
	});

	app.get('/api/views/batch', (req, res) => {
		const slugs = String(req.query.posts || '')
			.split(',')
			.map(normalizeSlug)
			.filter(Boolean)
			.slice(0, 50);
		const views = {};
		const stmt = db.prepare('SELECT views FROM post_views WHERE post_slug = ?');
		for (const slug of slugs) views[slug] = Number(stmt.get(slug)?.views || 0);
		res.json({ views });
	});

	app.post('/api/views', (req, res) => {
		if (!checkRate(req, res, 'views', 120)) return;
		const post = normalizeSlug(req.body?.post);
		if (!post) return res.status(400).json({ error: 'Invalid post slug' });
		const now = Date.now();
		db.prepare(
			`INSERT INTO post_views (post_slug, views, created_at, updated_at)
			 VALUES (?, 1, ?, ?)
			 ON CONFLICT(post_slug) DO UPDATE SET views = views + 1, updated_at = excluded.updated_at`
		).run(post, now, now);
		const row = db.prepare('SELECT views FROM post_views WHERE post_slug = ?').get(post);
		res.json({ post, views: Number(row?.views || 0), incremented: true });
	});
}
