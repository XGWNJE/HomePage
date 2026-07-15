import { createHash } from 'node:crypto';

import { appendSetCookie, parseCookies } from './cookies.js';
import { randomToken } from './request.js';

export const SUBSCRIPTION_ACCESS_PURPOSE = 'subscription-access';

export function hashSensitiveToken(value) {
	return createHash('sha256').update(String(value)).digest('hex');
}

export function issueSensitiveSession(db, config, res, userId) {
	const token = randomToken(32);
	const now = Date.now();
	const expiresAt = now + config.subscriptionAccessTtlSeconds * 1000;
	db.prepare('DELETE FROM sensitive_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL').run(now);
	db.prepare(
		`INSERT INTO sensitive_sessions (token_hash, user_id, purpose, created_at, expires_at, revoked_at)
		 VALUES (?, ?, ?, ?, ?, NULL)`
	).run(hashSensitiveToken(token), userId, SUBSCRIPTION_ACCESS_PURPOSE, now, expiresAt);
	appendSetCookie(res, sensitiveCookieName(config), token, sensitiveCookieOptions(config, config.subscriptionAccessTtlSeconds));
	return { expiresAt };
}

export function findSensitiveSession(db, config, req, userId) {
	const token = parseCookies(req.headers.cookie || '')[sensitiveCookieName(config)] || '';
	if (!token) return null;
	const tokenHash = hashSensitiveToken(token);
	const row = db.prepare(
		`SELECT user_id, purpose, expires_at, revoked_at
		   FROM sensitive_sessions
		  WHERE token_hash = ?
		  LIMIT 1`
	).get(tokenHash);
	if (
		!row
		|| row.user_id !== userId
		|| row.purpose !== SUBSCRIPTION_ACCESS_PURPOSE
		|| row.revoked_at
		|| Number(row.expires_at) <= Date.now()
	) {
		if (row) db.prepare('UPDATE sensitive_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?').run(Date.now(), tokenHash);
		return null;
	}
	return { userId: row.user_id, expiresAt: Number(row.expires_at) };
}

export function revokeSensitiveSession(db, config, req, res, userId) {
	const token = parseCookies(req.headers.cookie || '')[sensitiveCookieName(config)] || '';
	if (token) {
		db.prepare(
			`UPDATE sensitive_sessions
			    SET revoked_at = COALESCE(revoked_at, ?)
			  WHERE token_hash = ? AND user_id = ? AND purpose = ?`
		).run(Date.now(), hashSensitiveToken(token), userId, SUBSCRIPTION_ACCESS_PURPOSE);
	}
	clearSensitiveSessionCookie(res, config);
}

export function revokeAllSensitiveSessionsForUser(db, userId) {
	db.prepare(
		`UPDATE sensitive_sessions
		    SET revoked_at = COALESCE(revoked_at, ?)
		  WHERE user_id = ? AND purpose = ?`
	).run(Date.now(), userId, SUBSCRIPTION_ACCESS_PURPOSE);
}

export function clearSensitiveSessionCookie(res, config) {
	appendSetCookie(res, sensitiveCookieName(config), '', sensitiveCookieOptions(config, 0));
}

function sensitiveCookieName(config) {
	return isSecure(config) ? '__Host-homepage_subscription_access' : 'homepage_subscription_access_dev';
}

function sensitiveCookieOptions(config, maxAge) {
	return {
		httpOnly: true,
		secure: isSecure(config),
		sameSite: 'strict',
		path: '/',
		maxAge,
	};
}

function isSecure(config) {
	return new URL(config.baseUrl).protocol === 'https:';
}
