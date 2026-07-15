import { cleanText } from '../internal/request.js';
import { canManageSubscriptions } from '../internal/permissions.js';
import { adminAuth } from '../internal/session.js';

export function registerAdminRoutes(app, { db, config }) {
	app.get('/api/admin/check', (req, res) => {
		const auth = adminAuth(db, config, req);
		res.json({
			isAdmin: auth.authorized,
			email: auth.email,
			login: auth.login,
			permissions: { manageSubscriptions: canManageSubscriptions(db, config, auth) },
		});
	});

	app.get('/api/admin/stats', (req, res) => {
		if (!adminAuth(db, config, req).authorized) return res.status(403).json({ error: 'Unauthorized' });
		res.json({
			total: scalar(db, 'SELECT COUNT(*) FROM comments'),
			pending: scalar(db, "SELECT COUNT(*) FROM comments WHERE status = 'pending'"),
			approved: scalar(db, "SELECT COUNT(*) FROM comments WHERE status = 'approved'"),
			rejected: scalar(db, "SELECT COUNT(*) FROM comments WHERE status = 'rejected'"),
		});
	});

	app.get('/api/admin/comments', (req, res) => {
		if (!adminAuth(db, config, req).authorized) return res.status(403).json({ error: 'Unauthorized' });
		const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
		const rows = status
			? db.prepare(adminCommentSelect('WHERE c.status = ?')).all(status)
			: db.prepare(adminCommentSelect('')).all();
		res.json({ comments: rows });
	});

	app.post('/api/admin/comment/approve', (req, res) => adminCommentAction(db, config, req, res, 'approved'));
	app.post('/api/admin/comment/reject', (req, res) => adminCommentAction(db, config, req, res, 'rejected'));
	app.delete('/api/admin/comment', (req, res) => {
		if (!adminAuth(db, config, req).authorized) return res.status(403).json({ error: 'Unauthorized' });
		const id = cleanText(req.query.id, 80);
		if (!id) return res.status(400).json({ error: 'Missing id' });
		const result = db.prepare('DELETE FROM comments WHERE id = ?').run(id);
		res.json({ success: true, changes: result.changes || 0 });
	});

	app.get('/api/admin/contact-messages', (req, res) => {
		if (!adminAuth(db, config, req).authorized) return res.status(403).json({ error: 'Unauthorized' });
		const messages = db.prepare(
			'SELECT id, name, email, message, status, created_at FROM contact_messages ORDER BY created_at DESC LIMIT 100'
		).all();
		res.json({ messages });
	});

	app.get('/api/admin/outbox', (req, res) => {
		if (!adminAuth(db, config, req).authorized) return res.status(403).json({ error: 'Unauthorized' });
		res.json({
			items: db.prepare('SELECT id, type, recipient, subject, body, status, created_at FROM outbox ORDER BY created_at DESC LIMIT 100').all(),
		});
	});
}

function adminCommentAction(db, config, req, res, status) {
	if (!adminAuth(db, config, req).authorized) return res.status(403).json({ error: 'Unauthorized' });
	const id = cleanText(req.body?.id, 80);
	if (!id) return res.status(400).json({ error: 'Missing id' });
	const result = db.prepare('UPDATE comments SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id);
	res.json({ success: true, changes: result.changes || 0 });
}

function adminCommentSelect(where) {
	return `SELECT c.id, c.post_slug, c.body, c.status, c.created_at, c.updated_at,
	              u.login, u.name, u.avatar_url
	         FROM comments c
	         JOIN users u ON c.user_id = u.id
	         ${where}
	        ORDER BY c.created_at DESC
	        LIMIT 100`;
}

function scalar(db, sql) {
	const row = db.prepare(sql).get();
	return Number(row?.[Object.keys(row)[0]] || 0);
}
