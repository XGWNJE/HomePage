import { appendSetCookie, parseCookies } from '../internal/cookies.js';
import { exchangeGithubIdentity, githubAuthorizeUrl } from '../internal/github-oauth.js';
import { isAllowedOrigin, setNoStoreHeaders } from '../internal/http.js';
import { canManageSubscriptions } from '../internal/permissions.js';
import { randomToken, safeEqual } from '../internal/request.js';
import {
	findSensitiveSession,
	hashSensitiveToken,
	issueSensitiveSession,
	revokeSensitiveSession,
} from '../internal/sensitive-session.js';
import { loadSubscriptionAccess, SubscriptionAccessUnavailableError } from '../internal/subscription-access.js';
import { adminAuth } from '../internal/session.js';

const ALLOWED_KINDS = new Set(['desktop', 'mobile', 'cmfa-import']);
const REAUTH_TTL_SECONDS = 10 * 60;

export function registerAdminSubscriptionRoutes(app, { db, config, fetchImpl, checkRate }) {
	app.use('/api/admin/subscriptions', (_req, res, next) => {
		setNoStoreHeaders(res);
		next();
	});

	app.get('/api/admin/subscriptions/status', (req, res) => {
		const auth = authorizeAccess(db, config, req, res);
		if (!auth || !checkBoundRate(checkRate, req, res, 'subscription-status', auth.userId, 60)) return;
		try {
			const access = loadAccess(config);
			const sensitive = findSensitiveSession(db, config, req, auth.userId);
			res.json({
				ok: true,
				available: access.available,
				unlocked: Boolean(sensitive),
				expiresAt: sensitive?.expiresAt || null,
			});
		} catch (error) {
			respondUnavailable(res, error);
		}
	});

	app.post('/api/admin/subscriptions/unlock', (req, res) => {
		const auth = authorizeAccess(db, config, req, res);
		if (!auth) return;
		if (!validEmptyMutation(config, req)) return res.status(req.headers.origin ? 400 : 403).json({ error: 'Invalid request' });
		if (!checkBoundRate(checkRate, req, res, 'subscription-unlock', auth.userId, 6)) return;
		setSensitiveHeaders(res);

		try {
			if (config.subscriptionAccessFixture && config.nodeEnv !== 'production') {
				recordAudit(db, res, auth.userId, 'unlock', 'success');
				issueSensitiveSession(db, config, res, auth.userId);
				return res.json({ ok: true, unlocked: true });
			}

			if (!config.githubClientId || !config.githubClientSecret) return res.status(503).json({ error: 'Access unavailable' });
			const user = db.prepare('SELECT github_id FROM users WHERE id = ? LIMIT 1').get(auth.userId);
			if (!user?.github_id) return res.status(503).json({ error: 'Access unavailable' });

			const state = randomToken(24);
			const verifier = randomToken(48);
			const now = Date.now();
			db.prepare('DELETE FROM subscription_reauth_challenges WHERE expires_at <= ? OR used = 1').run(now);
			db.prepare(
				`INSERT INTO subscription_reauth_challenges
				 (state_hash, verifier_hash, user_id, created_at, expires_at, used)
				 VALUES (?, ?, ?, ?, ?, 0)`
			).run(
				hashSensitiveToken(state),
				hashSensitiveToken(verifier),
				auth.userId,
				now,
				now + REAUTH_TTL_SECONDS * 1000,
			);
			setReauthCookies(res, config, state, verifier);
			const redirectUri = `${config.baseUrl}/api/auth/github/callback`;
			const authorizeUrl = githubAuthorizeUrl(config, {
				state,
				verifier,
				redirectUri,
				prompt: 'select_account',
				login: auth.login || '',
			}).toString();
			recordAudit(db, res, auth.userId, 'unlock-start', 'success');
			return res.json({ ok: true, unlocked: false, authorizeUrl });
		} catch {
			return res.status(503).json({ error: 'Access unavailable' });
		}
	});

	app.get('/api/auth/github/callback', async (req, res, next) => {
		const names = reauthCookieNames(config);
		const cookies = parseCookies(req.headers.cookie || '');
		if (!cookies[names.state] && !cookies[names.verifier]) return next();
		setSensitiveHeaders(res);
		if (!checkRate(req, res, 'subscription-unlock-callback', 20)) return;
		const state = String(req.query.state || '');
		const code = String(req.query.code || '');
		const cookieState = cookies[names.state] || '';
		const verifier = cookies[names.verifier] || '';
		const row = state
			? db.prepare(
				`SELECT state_hash, verifier_hash, user_id, expires_at, used
				   FROM subscription_reauth_challenges
				  WHERE state_hash = ?
				  LIMIT 1`
			).get(hashSensitiveToken(state))
			: null;

		try {
			if (
				!row
				|| row.used
				|| Number(row.expires_at) <= Date.now()
				|| !state
				|| !code
				|| !cookieState
				|| !verifier
				|| !safeEqual(cookieState, state)
				|| !safeEqual(row.verifier_hash, hashSensitiveToken(verifier))
			) throw new Error('invalid reauthentication challenge');

			const consumed = db.prepare(
				'UPDATE subscription_reauth_challenges SET used = 1 WHERE state_hash = ? AND used = 0'
			).run(row.state_hash);
			if (Number(consumed.changes || 0) !== 1) throw new Error('reauthentication challenge already consumed');

			const redirectUri = `${config.baseUrl}/api/auth/github/callback`;
			const ghUser = await exchangeGithubIdentity(config, fetchImpl, { code, verifier, redirectUri });
			const user = db.prepare('SELECT github_id FROM users WHERE id = ? LIMIT 1').get(row.user_id);
			if (!user?.github_id || !safeEqual(String(user.github_id), String(ghUser.id))) {
				throw new Error('reauthenticated identity mismatch');
			}

			recordAudit(db, res, row.user_id, 'unlock', 'success');
			issueSensitiveSession(db, config, res, row.user_id);
			clearReauthCookies(res, config);
			return res.redirect(subscriptionPageUrl(config));
		} catch {
			if (row?.user_id) {
				try { recordAudit(db, res, row.user_id, 'unlock', 'failure'); } catch {}
			}
			clearReauthCookies(res, config);
			return res.redirect(`${subscriptionPageUrl(config)}?reauth=failed`);
		}
	});

	app.post('/api/admin/subscriptions/lock', (req, res) => {
		const auth = authorizeAccess(db, config, req, res);
		if (!auth) return;
		if (!validEmptyMutation(config, req)) return res.status(req.headers.origin ? 400 : 403).json({ error: 'Invalid request' });
		if (!checkBoundRate(checkRate, req, res, 'subscription-lock', auth.userId, 12)) return;
		setSensitiveHeaders(res);
		revokeSensitiveSession(db, config, req, res, auth.userId);
		recordAudit(db, res, auth.userId, 'lock', 'success');
		res.json({ ok: true, unlocked: false });
	});

	app.post('/api/admin/subscriptions/reveal', (req, res) => {
		const auth = authorizeAccess(db, config, req, res);
		if (!auth) return;
		if (!validRevealRequest(config, req)) return res.status(req.headers.origin ? 400 : 403).json({ error: 'Invalid request' });
		if (!checkBoundRate(checkRate, req, res, 'subscription-reveal', auth.userId, 12)) return;
		if (!findSensitiveSession(db, config, req, auth.userId)) return res.status(403).json({ error: 'Access denied' });
		setSensitiveHeaders(res);
		try {
			const access = loadAccess(config);
			const value = access.reveal(req.body.kind);
			recordAudit(db, res, auth.userId, `reveal:${req.body.kind}`, 'success');
			res.json({ ok: true, kind: req.body.kind, value });
		} catch (error) {
			try { recordAudit(db, res, auth.userId, `reveal:${req.body.kind}`, 'failure'); } catch {}
			respondUnavailable(res, error);
		}
	});

	app.get('/api/admin/subscriptions/mobile-qr', (req, res) => {
		const auth = authorizeAccess(db, config, req, res);
		if (!auth || !checkBoundRate(checkRate, req, res, 'subscription-qr', auth.userId, 12)) return;
		if (!findSensitiveSession(db, config, req, auth.userId)) return res.status(403).json({ error: 'Access denied' });
		setSensitiveHeaders(res);
		try {
			const access = loadAccess(config);
			recordAudit(db, res, auth.userId, 'mobile-qr', 'success');
			res.type('png').send(access.mobileQr);
		} catch (error) {
			try { recordAudit(db, res, auth.userId, 'mobile-qr', 'failure'); } catch {}
			respondUnavailable(res, error);
		}
	});
}

function authorizeAccess(db, config, req, res) {
	const auth = adminAuth(db, config, req);
	if (!canManageSubscriptions(db, config, auth)) {
		res.status(403).json({ error: 'Access denied' });
		return null;
	}
	return auth;
}

function checkBoundRate(checkRate, req, res, action, userId, limit) {
	if (!checkRate(req, res, `${action}:ip`, limit)) return false;
	return checkRate(req, res, `${action}:user`, limit, `user:${userId}`);
}

function validEmptyMutation(config, req) {
	const origin = String(req.headers.origin || '');
	if (!origin || !isAllowedOrigin(config, origin)) return false;
	if (req.is('application/json') !== 'application/json') return false;
	if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return false;
	const contentLength = Number(req.headers['content-length'] || 0);
	if (Number.isFinite(contentLength) && contentLength > 64) return false;
	return Object.keys(req.body).length === 0 && Buffer.byteLength(JSON.stringify(req.body)) <= 16;
}

function validRevealRequest(config, req) {
	const origin = String(req.headers.origin || '');
	if (!origin || !isAllowedOrigin(config, origin)) return false;
	if (req.is('application/json') !== 'application/json') return false;
	if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return false;
	const contentLength = Number(req.headers['content-length'] || 0);
	if ((Number.isFinite(contentLength) && contentLength > 256) || Buffer.byteLength(JSON.stringify(req.body)) > 128) return false;
	const keys = Object.keys(req.body);
	return keys.length === 1 && keys[0] === 'kind' && ALLOWED_KINDS.has(req.body.kind);
}

function loadAccess(config) {
	return loadSubscriptionAccess({
		registryPath: config.subscriptionAccessRegistry,
		qrPathOverride: config.subscriptionAccessFixtureQr,
	});
}

function setSensitiveHeaders(res) {
	res.setHeader('Cache-Control', 'private, no-store, max-age=0');
	res.setHeader('Pragma', 'no-cache');
	res.setHeader('Expires', '0');
	res.setHeader('X-Content-Type-Options', 'nosniff');
}

function recordAudit(db, res, userId, action, result) {
	const requestId = randomToken(12);
	db.prepare(
		`INSERT INTO subscription_audit_events (id, user_id, action, result, request_id, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	).run(`sa_${randomToken(12)}`, userId, action, result, requestId, Date.now());
	res.setHeader('X-Request-Id', requestId);
}

function respondUnavailable(res, error) {
	if (!(error instanceof SubscriptionAccessUnavailableError)) {
		return res.status(500).json({ error: 'Access unavailable' });
	}
	return res.status(503).json({ error: 'Access unavailable' });
}

function reauthCookieNames(config) {
	const secure = new URL(config.baseUrl).protocol === 'https:';
	return secure
		? { state: '__Host-homepage_subscription_state', verifier: '__Host-homepage_subscription_verifier' }
		: { state: 'homepage_subscription_state_dev', verifier: 'homepage_subscription_verifier_dev' };
}

function setReauthCookies(res, config, state, verifier) {
	const secure = new URL(config.baseUrl).protocol === 'https:';
	const names = reauthCookieNames(config);
	const options = { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: REAUTH_TTL_SECONDS };
	appendSetCookie(res, names.state, state, options);
	appendSetCookie(res, names.verifier, verifier, options);
}

function clearReauthCookies(res, config) {
	const secure = new URL(config.baseUrl).protocol === 'https:';
	const names = reauthCookieNames(config);
	const options = { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 0 };
	appendSetCookie(res, names.state, '', options);
	appendSetCookie(res, names.verifier, '', options);
}

function subscriptionPageUrl(config) {
	return new URL('/admin/subscriptions/', config.frontendUrl).toString();
}
