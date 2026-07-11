import { storeOutbox } from '../internal/messaging.js';
import { cleanText, containsHtml, moderateText, normalizeSlug, randomToken } from '../internal/request.js';
import { findSessionUser, toApiUser } from '../internal/session.js';

const MAX_COMMENT_LENGTH = 2000;
const COMMENT_DAILY_LIMIT = 30;

export function registerCommentRoutes(app, { db, config, checkRate }) {
	app.get('/api/comments', (req, res) => {
		const post = normalizeSlug(req.query.post_id || req.query.post || req.query.slug);
		if (!post) return res.status(400).json({ error: 'Invalid post slug' });
		res.json({ comments: getComments(db, post) });
	});

	app.post('/api/comments', (req, res) => {
		if (!checkRate(req, res, 'comment_post', 20)) return;
		const user = findSessionUser(db, req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		const post = normalizeSlug(req.body?.post_id || req.body?.postSlug || req.body?.post);
		const body = cleanText(req.body?.content || req.body?.body, MAX_COMMENT_LENGTH);
		if (!post) return res.status(400).json({ error: 'Invalid post slug' });
		if (!body) return res.status(400).json({ error: 'Comment length must be 1-2000' });
		if (containsHtml(body)) return res.status(400).json({ error: 'HTML is not allowed' });
		if (dailyCommentCount(db, user.user_id) >= COMMENT_DAILY_LIMIT) {
			return res.status(429).json({ error: `Daily comment limit reached (${COMMENT_DAILY_LIMIT}/day). Resets at midnight UTC.` });
		}
		const parentId = cleanText(req.body?.parent_id, 80);
		const validParent = parentId
			? db.prepare('SELECT id FROM comments WHERE id = ? AND post_slug = ? LIMIT 1').get(parentId, post)
			: null;
		const now = Date.now();
		const status = moderateText(body) === 'review' ? 'pending' : 'approved';
		const id = `c_${randomToken(12)}`;
		db.prepare(
			`INSERT INTO comments (id, parent_id, post_slug, user_id, body, status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		).run(id, validParent ? parentId : null, post, user.user_id, body, status, now, now);
		if (status === 'pending') {
			storeOutbox(db, 'comment_review', config.contactToEmail, `Comment pending review: ${post}`, body);
		}
		res.status(201).json({
			comment: {
				id,
				parentId: validParent ? parentId : null,
				postSlug: post,
				body,
				status,
				createdAt: now,
				user: toApiUser(user),
			},
		});
	});
}

function getComments(db, post) {
	const rows = db.prepare(
		`SELECT c.id, c.parent_id, c.post_slug, c.body, c.status, c.created_at,
		        u.id AS user_id, u.login, u.name, u.avatar_url, u.profile_url
		   FROM comments c
		   JOIN users u ON u.id = c.user_id
		  WHERE c.post_slug = ? AND c.status = 'approved'
		  ORDER BY c.created_at ASC`
	).all(post);
	const byId = new Map();
	const roots = [];
	for (const row of rows) {
		byId.set(row.id, {
			id: row.id,
			parentId: row.parent_id,
			postSlug: row.post_slug,
			body: row.body,
			status: row.status,
			createdAt: row.created_at,
			replies: [],
			user: {
				id: row.user_id,
				login: row.login,
				name: row.name,
				avatarUrl: row.avatar_url,
				profileUrl: row.profile_url,
			},
		});
	}
	for (const comment of byId.values()) {
		if (comment.parentId && byId.has(comment.parentId)) byId.get(comment.parentId).replies.push(comment);
		else roots.push(comment);
	}
	return roots;
}

function dailyCommentCount(db, userId) {
	const midnight = new Date();
	midnight.setUTCHours(24, 0, 0, 0);
	const dayStart = midnight.getTime() - 24 * 60 * 60 * 1000;
	const row = db.prepare('SELECT COUNT(*) AS count FROM comments WHERE user_id = ? AND created_at >= ?').get(userId, dayStart);
	return Number(row?.count || 0);
}
