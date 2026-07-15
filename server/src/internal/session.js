import { clientIp, randomToken } from './request.js';

export function bearerToken(req) {
	const header = req.headers.authorization || '';
	const match = String(header).match(/^Bearer\s+(.+)$/i);
	return match ? match[1].trim() : '';
}

export function findSessionUser(db, req) {
	const token = bearerToken(req);
	if (!token) return null;
	const row = db.prepare(
		`SELECT s.user_id, u.login, u.name, u.avatar_url, u.profile_url, u.email, u.is_admin, s.expires_at
		   FROM sessions s
		   JOIN users u ON u.id = s.user_id
		  WHERE s.id = ?
		  LIMIT 1`
	).get(token);
	if (!row || Number(row.expires_at) <= Date.now()) {
		if (row) db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
		return null;
	}
	return row;
}

export function userById(db, id) {
	return db.prepare(
		`SELECT id AS user_id, login, name, avatar_url, profile_url, email, is_admin
		   FROM users WHERE id = ? LIMIT 1`
	).get(id);
}

export function createSession(db, config, req, userId) {
	const token = randomToken(32);
	const now = Date.now();
	db.prepare(
		`INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent)
		 VALUES (?, ?, ?, ?, ?, ?)`
	).run(
		token,
		userId,
		now,
		now + config.sessionTtlSeconds * 1000,
		clientIp(req),
		String(req.headers['user-agent'] || '').slice(0, 256)
	);
	return token;
}

export function toApiUser(row) {
	return {
		id: row.user_id,
		login: row.login,
		name: row.name,
		username: row.name || row.login,
		avatar: row.avatar_url,
		avatarUrl: row.avatar_url,
		profileUrl: row.profile_url,
		isAdmin: Boolean(row.is_admin),
	};
}

export function adminAuth(db, config, req) {
	const token = bearerToken(req);
	if (config.adminToken && token === config.adminToken) {
		return { authorized: true, email: null, login: 'admin-token', userId: null, source: 'admin-token' };
	}
	const user = findSessionUser(db, req);
	if (user?.is_admin) return { authorized: true, email: user.email || null, login: user.login || null, userId: user.user_id, source: 'session' };
	if (user?.login && config.adminGithubLogins.includes(user.login)) return { authorized: true, email: user.email || null, login: user.login, userId: user.user_id, source: 'session' };
	if (user?.email && config.adminEmails.includes(String(user.email).toLowerCase())) {
		return { authorized: true, email: user.email, login: user.login, userId: user.user_id, source: 'session' };
	}
	return { authorized: false, email: null, login: null, userId: null, source: null };
}
