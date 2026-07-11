import { cleanText, cleanUrl, moderateText } from '../internal/request.js';
import { findSessionUser, toApiUser, userById } from '../internal/session.js';

export function registerProfileRoutes(app, { db }) {
	app.get('/api/me', (req, res) => {
		const user = findSessionUser(db, req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		res.json({ user: toApiUser(user) });
	});

	app.post('/api/me', (req, res) => {
		const user = findSessionUser(db, req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		const updates = [];
		const values = [];
		if (req.body?.avatarUrl !== undefined) {
			const avatar = cleanUrl(req.body.avatarUrl);
			if (!avatar) return res.status(400).json({ error: 'Invalid avatar URL' });
			updates.push('avatar_url = ?');
			values.push(avatar);
		}
		if (req.body?.username !== undefined) {
			const username = cleanText(req.body.username, 30);
			if (!username || username.length < 2) return res.status(400).json({ error: 'Username must be 2-30 characters' });
			if (moderateText(username) === 'reject') return res.status(400).json({ error: 'Username rejected by moderation' });
			updates.push('name = ?');
			values.push(username);
		}
		if (updates.length) {
			updates.push('updated_at = ?');
			values.push(Date.now(), user.user_id);
			db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
		}
		const updated = userById(db, user.user_id);
		res.json({ user: toApiUser(updated) });
	});
}
