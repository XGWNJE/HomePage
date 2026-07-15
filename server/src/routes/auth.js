import { parseCookies, serializeSetCookie } from '../internal/cookies.js';
import { exchangeGithubIdentity, githubAuthorizeUrl } from '../internal/github-oauth.js';
import { isAllowedOrigin, setNoStoreHeaders } from '../internal/http.js';
import { storeOutbox, trySendmail } from '../internal/messaging.js';
import { cleanEmail, cleanText, randomToken, safeEqual, syntheticGithubId } from '../internal/request.js';
import { clearSensitiveSessionCookie, revokeAllSensitiveSessionsForUser } from '../internal/sensitive-session.js';
import { bearerToken, createSession, findSessionUser } from '../internal/session.js';
import { verifyTurnstile } from '../internal/turnstile.js';

const OAUTH_STATE_COOKIE = '__Host-homepage_oauth_state';
const OAUTH_VERIFIER_COOKIE = '__Host-homepage_oauth_verifier';
const OAUTH_RETURN_COOKIE = '__Host-homepage_oauth_return';

export function registerAuthRoutes(app, { db, config, fetchImpl, checkRate }) {
	app.use('/api/auth/github', (_req, res, next) => {
		setNoStoreHeaders(res);
		next();
	});

	app.get('/api/auth/github/start', (req, res) => {
		if (!config.githubClientId) return res.status(500).json({ error: 'GITHUB_CLIENT_ID is required' });
		if (!checkRate(req, res, 'oauth_start', 20)) return;

		const state = randomToken(24);
		const verifier = randomToken(48);
		const returnTo = sanitizeReturnTo(config, req.query.returnTo);
		const redirectUri = `${config.baseUrl}/api/auth/github/callback`;
		const authorize = githubAuthorizeUrl(config, { state, verifier, redirectUri });

		setOauthCookie(res, OAUTH_STATE_COOKIE, state, config.baseUrl);
		setOauthCookie(res, OAUTH_VERIFIER_COOKIE, verifier, config.baseUrl);
		setOauthCookie(res, OAUTH_RETURN_COOKIE, returnTo, config.baseUrl);
		res.redirect(authorize.toString());
	});

	app.get('/api/auth/github/callback', async (req, res) => {
		try {
			if (!config.githubClientId || !config.githubClientSecret) {
				return res.status(500).json({ error: 'OAuth secrets are not configured' });
			}
			const cookies = parseCookies(req.headers.cookie || '');
			const expectedState = cookies[OAUTH_STATE_COOKIE] || '';
			const verifier = cookies[OAUTH_VERIFIER_COOKIE] || '';
			const returnTo = sanitizeReturnTo(config, cookies[OAUTH_RETURN_COOKIE]);
			const state = String(req.query.state || '');
			const code = String(req.query.code || '');

			if (!expectedState || !verifier || !state || !code || !safeEqual(expectedState, state)) {
				clearOauthCookies(res, config.baseUrl);
				return res.redirect(config.frontendUrl);
			}

			const ghUser = await exchangeGithubIdentity(config, fetchImpl, {
				code,
				verifier,
				redirectUri: `${config.baseUrl}/api/auth/github/callback`,
			});

			const now = Date.now();
			const userId = `github:${ghUser.id}`;
			db.prepare(
				`INSERT INTO users (id, github_id, login, name, avatar_url, profile_url, created_at, updated_at, is_admin)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(github_id) DO UPDATE SET
				  login = excluded.login,
				  name = excluded.name,
				  avatar_url = excluded.avatar_url,
				  profile_url = excluded.profile_url,
				  updated_at = excluded.updated_at,
				  is_admin = excluded.is_admin`
			).run(
				userId,
				ghUser.id,
				ghUser.login,
				ghUser.name || null,
				ghUser.avatar_url || null,
				ghUser.html_url || null,
				now,
				now,
				config.adminGithubLogins.includes(String(ghUser.login)) ? 1 : 0
			);

			const sessionToken = createSession(db, config, req, userId);
			clearOauthCookies(res, config.baseUrl);
			res.redirect(`${returnTo || config.frontendUrl}/#token=${encodeURIComponent(sessionToken)}`);
		} catch (error) {
			console.error('github_callback_failed', error);
			clearOauthCookies(res, config.baseUrl);
			res.redirect(config.frontendUrl);
		}
	});

	app.post('/api/auth/dev-login', (req, res) => {
		if (!config.devLogin) return res.status(404).json({ error: 'Not Found' });
		const login = cleanText(req.body?.login || 'dev_user', 40) || 'dev_user';
		const name = cleanText(req.body?.name || 'Dev User', 80) || 'Dev User';
		const now = Date.now();
		const userId = `dev:${login}`;
		db.prepare(
			`INSERT INTO users (id, github_id, login, name, avatar_url, profile_url, created_at, updated_at, is_admin)
			 VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, 1)
			 ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at`
		).run(userId, syntheticGithubId(userId), login, name, now, now);
		res.json({ ok: true, token: createSession(db, config, req, userId) });
	});

	app.post('/api/auth/logout', (req, res) => {
		const token = bearerToken(req);
		const user = findSessionUser(db, req);
		if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
		if (user?.user_id) revokeAllSensitiveSessionsForUser(db, user.user_id);
		clearSensitiveSessionCookie(res, config);
		res.json({ ok: true });
	});

	app.post('/api/auth/email/send', async (req, res) => {
		if (!checkRate(req, res, 'email_send', 10)) return;
		const email = cleanEmail(req.body?.email);
		if (!email) return res.status(400).json({ error: 'Invalid email address' });
		if (!await verifyTurnstile(req, res, config, fetchImpl)) return;
		const token = randomToken(32);
		const now = Date.now();
		db.prepare(
			`INSERT INTO email_logins (id, email, token, expires_at, used, created_at)
			 VALUES (?, ?, ?, ?, 0, ?)`
		).run(`em_${randomToken(10)}`, email, token, now + 15 * 60_000, now);
		const loginUrl = `${config.baseUrl}/api/auth/email/verify?token=${encodeURIComponent(token)}`;
		storeOutbox(db, 'email_login', email, 'Sign in to XGWNJE', loginUrl);
		trySendmail(config, email, 'Sign in to XGWNJE', `Open this link to sign in:\n${loginUrl}\n\nIt expires in 15 minutes.`);
		res.json({ ok: true, delivery: config.enableSendmail ? 'sendmail' : 'stored' });
	});

	app.get('/api/auth/email/verify', (req, res) => {
		const token = String(req.query.token || '');
		const row = db.prepare(
			'SELECT id, email, expires_at, used FROM email_logins WHERE token = ? LIMIT 1'
		).get(token);
		if (!row || row.used || Number(row.expires_at) <= Date.now()) {
			return res.status(400).type('html').send(messagePage(config, 'This login link is invalid or expired.'));
		}
		const email = row.email;
		const now = Date.now();
		const userId = `email:${email}`;
		const login = email.split('@')[0].slice(0, 40);
		db.prepare(
			`INSERT INTO users (id, github_id, login, name, email, email_verified, created_at, updated_at)
			 VALUES (?, ?, ?, NULL, ?, 1, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET email = excluded.email, email_verified = 1, updated_at = excluded.updated_at`
		).run(userId, syntheticGithubId(userId), login, email, now, now);
		db.prepare('UPDATE email_logins SET used = 1 WHERE id = ?').run(row.id);
		const sessionToken = createSession(db, config, req, userId);
		res.redirect(`${config.frontendUrl}/#token=${encodeURIComponent(sessionToken)}`);
	});
}

function sanitizeReturnTo(config, raw) {
	if (!raw || typeof raw !== 'string') return config.frontendUrl;
	try {
		const url = new URL(raw, config.frontendUrl);
		if (isAllowedOrigin(config, url.origin)) return url.origin + url.pathname + url.search;
	} catch {}
	return config.frontendUrl;
}

function setOauthCookie(res, name, value, baseUrl) {
	const secure = new URL(baseUrl).protocol === 'https:';
	res.append('set-cookie', serializeSetCookie(name, value, {
		httpOnly: true,
		secure,
		sameSite: 'lax',
		path: '/',
		maxAge: 600,
	}));
}

function clearOauthCookies(res, baseUrl) {
	for (const name of [OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, OAUTH_RETURN_COOKIE]) {
		res.append('set-cookie', serializeSetCookie(name, '', {
			httpOnly: true,
			secure: new URL(baseUrl).protocol === 'https:',
			sameSite: 'lax',
			path: '/',
			maxAge: 0,
		}));
	}
}

function messagePage(config, message) {
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email Sign In</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#fafafa;color:#18181b"><main style="max-width:420px;padding:32px;text-align:center"><h1>Sign in failed</h1><p>${escapeHtml(message)}</p><a href="${config.frontendUrl}">Return home</a></main></body></html>`;
}

function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
