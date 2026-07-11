import { createHash } from 'node:crypto';

import * as cookie from 'cookie';

import { isAllowedOrigin, setNoStoreHeaders } from '../internal/http.js';
import { storeOutbox, trySendmail } from '../internal/messaging.js';
import { base64Url, cleanEmail, cleanText, randomToken, safeEqual, syntheticGithubId } from '../internal/request.js';
import { bearerToken, createSession } from '../internal/session.js';
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
		const challenge = base64Url(createHash('sha256').update(verifier).digest());
		const returnTo = sanitizeReturnTo(config, req.query.returnTo);
		const redirectUri = `${config.baseUrl}/api/auth/github/callback`;
		const authorize = new URL('https://github.com/login/oauth/authorize');
		authorize.searchParams.set('client_id', config.githubClientId);
		authorize.searchParams.set('redirect_uri', redirectUri);
		authorize.searchParams.set('scope', 'read:user user:email');
		authorize.searchParams.set('state', state);
		authorize.searchParams.set('code_challenge', challenge);
		authorize.searchParams.set('code_challenge_method', 'S256');

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

			const tokenPayload = new URLSearchParams({
				client_id: config.githubClientId,
				client_secret: config.githubClientSecret,
				code,
				code_verifier: verifier,
				redirect_uri: `${config.baseUrl}/api/auth/github/callback`,
			});
			const tokenResponse = await fetchImpl('https://github.com/login/oauth/access_token', {
				method: 'POST',
				headers: {
					accept: 'application/json',
					'content-type': 'application/x-www-form-urlencoded',
					'user-agent': 'homepage-api',
				},
				body: tokenPayload,
			});
			if (!tokenResponse.ok) throw new Error('GitHub token exchange failed');
			const tokenData = await tokenResponse.json();
			if (!tokenData.access_token) throw new Error('GitHub token missing');

			const ghResponse = await fetchImpl('https://api.github.com/user', {
				headers: {
					accept: 'application/vnd.github+json',
					authorization: `Bearer ${tokenData.access_token}`,
					'user-agent': 'homepage-api',
				},
			});
			if (!ghResponse.ok) throw new Error('GitHub user lookup failed');
			const ghUser = await ghResponse.json();
			if (!ghUser?.id || !ghUser?.login) throw new Error('GitHub user response invalid');

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
		if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
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

function parseCookies(header) {
	const parse = cookie.parse || cookie.parseCookie;
	if (!parse) throw new Error('cookie parser is unavailable');
	return parse(header || '');
}

function serializeSetCookie(name, value, options) {
	if (cookie.serialize) return cookie.serialize(name, value, options);
	if (cookie.stringifySetCookie) return cookie.stringifySetCookie({ name, value, ...options });
	throw new Error('cookie serializer is unavailable');
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
