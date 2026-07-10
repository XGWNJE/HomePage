import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { spawn } from 'node:child_process';

import Busboy from 'busboy';
import * as cookie from 'cookie';
import express from 'express';

import { CURRENT_SCHEMA_VERSION } from './db.js';

const OAUTH_STATE_COOKIE = '__Host-homepage_oauth_state';
const OAUTH_VERIFIER_COOKIE = '__Host-homepage_oauth_verifier';
const OAUTH_RETURN_COOKIE = '__Host-homepage_oauth_return';
const MAX_COMMENT_LENGTH = 2000;
const COMMENT_DAILY_LIMIT = 30;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_WINDOW = 60;
const SUSPICIOUS_RE = /(https?:\/\/|www\.|telegram|whatsapp|casino|crypto|airdrop|贷款|博彩|发票)/i;
const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export function createApp({ db, config, fetchImpl = globalThis.fetch }) {
	if (Boolean(config.turnstileSiteKey) !== Boolean(config.turnstileSecretKey)) {
		throw new Error('Turnstile site and secret keys must be configured together');
	}
	const turnstileReadiness = config.turnstileSecretKey ? 'enabled' : 'disabled';
	mkdirSync(config.uploadDir, { recursive: true });
	const app = express();
	const rateMap = new Map();

	app.disable('x-powered-by');
	// The service only accepts proxied traffic from the local Nginx hop. Trusting
	// arbitrary proxy chains would let clients spoof the IP used for rate limits.
	app.set('trust proxy', 'loopback');
	app.use(express.json({ limit: '1mb' }));
	app.use('/uploads', express.static(config.uploadDir, {
		index: false,
		maxAge: '30d',
		immutable: true,
	}));

	app.use((req, res, next) => {
		const origin = req.headers.origin;
		if (origin && isAllowedOrigin(config, origin)) {
			res.setHeader('Access-Control-Allow-Origin', origin);
			res.setHeader('Vary', 'Origin');
			res.setHeader('Access-Control-Allow-Credentials', 'true');
		}
		if (req.method === 'OPTIONS') {
			res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
			res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
			res.status(204).end();
			return;
		}
		next();
	});

	app.get('/health', (_req, res) => {
		const metadata = {
			service: 'homepage-api',
			version: config.serviceVersion || 'unknown',
			revision: config.serviceRevision || 'unknown',
		};
		try {
			const schemaVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version || 0);
			if (schemaVersion !== CURRENT_SCHEMA_VERSION) {
				return res.status(503).json({
					ok: false,
					...metadata,
					readiness: {
						database: 'schema-mismatch',
						schemaVersion,
						expectedSchemaVersion: CURRENT_SCHEMA_VERSION,
						turnstile: turnstileReadiness,
					},
				});
			}
			res.json({
				ok: true,
				...metadata,
				readiness: { database: 'ready', schemaVersion, turnstile: turnstileReadiness },
			});
		} catch {
			res.status(503).json({
				ok: false,
				...metadata,
				readiness: { database: 'unavailable', schemaVersion: null, turnstile: turnstileReadiness },
			});
		}
	});

	app.use('/api/auth/github', (_req, res, next) => {
		setNoStoreHeaders(res);
		next();
	});

	app.get('/api/auth/github/start', (req, res) => {
		if (!config.githubClientId) return res.status(500).json({ error: 'GITHUB_CLIENT_ID is required' });
		if (!checkRate(req, res, rateMap, 'oauth_start', 20)) return;

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
			const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
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

			const ghResponse = await fetch('https://api.github.com/user', {
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

	app.post('/api/auth/logout', (req, res) => {
		const token = bearerToken(req);
		if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
		res.json({ ok: true });
	});

	app.post('/api/auth/email/send', async (req, res) => {
		if (!checkRate(req, res, rateMap, 'email_send', 10)) return;
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
		for (const slug of slugs) {
			views[slug] = Number(stmt.get(slug)?.views || 0);
		}
		res.json({ views });
	});

	app.post('/api/views', (req, res) => {
		if (!checkRate(req, res, rateMap, 'views', 120)) return;
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

	app.get('/api/comments', (req, res) => {
		const post = normalizeSlug(req.query.post_id || req.query.post || req.query.slug);
		if (!post) return res.status(400).json({ error: 'Invalid post slug' });
		res.json({ comments: getComments(db, post) });
	});

	app.post('/api/comments', (req, res) => {
		if (!checkRate(req, res, rateMap, 'comment_post', 20)) return;
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

	app.post('/api/contact', async (req, res) => {
		if (!checkRate(req, res, rateMap, 'contact', 10)) return;
		const name = cleanText(req.body?.name, 80);
		const email = cleanEmail(req.body?.email);
		const message = cleanText(req.body?.message, 4000);
		if (!name || !email || !message) return res.status(400).json({ error: 'Invalid contact message' });
		if (!await verifyTurnstile(req, res, config, fetchImpl)) return;
		const id = `msg_${randomToken(12)}`;
		db.prepare(
			`INSERT INTO contact_messages (id, name, email, message, ip, user_agent, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run(id, name, email, message, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 256), Date.now());
		storeOutbox(db, 'contact', config.contactToEmail, `Contact from ${name}`, `${name} <${email}>\n\n${message}`);
		trySendmail(config, config.contactToEmail, `Contact from ${name}`, `${name} <${email}>\n\n${message}`);
		res.json({ ok: true, id });
	});

	app.get('/api/images', (req, res) => {
		const user = findSessionUser(db, req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		const rows = db.prepare(
			'SELECT id, name, url, size, content_type, created_at FROM images WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
		).all(user.user_id);
		res.json({ images: rows });
	});

	app.post(['/api/images', '/api/upload'], (req, res) => {
		const user = findSessionUser(db, req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		if (!req.headers['content-type']?.startsWith('multipart/form-data')) {
			return res.status(415).json({ error: 'Content-Type must be multipart/form-data' });
		}
		const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 8 * 1024 * 1024 } });
		let uploadPromise = null;
		let uploadError = null;
		busboy.on('file', (_name, file, info) => {
			const originalName = basename(info.filename || 'upload.bin').replace(/[^\w.\-]+/g, '-');
			const ext = extname(originalName).toLowerCase().slice(0, 12);
			if (!ALLOWED_IMAGE_EXTENSIONS.has(ext) || !ALLOWED_IMAGE_MIME_TYPES.has(info.mimeType || '')) {
				file.resume();
				uploadError = new Error('Only jpg, png, gif, and webp images are allowed');
				return;
			}
			const id = `img_${randomToken(12)}`;
			const storedName = `${id}${ext}`;
			const target = join(config.uploadDir, storedName);
			let size = 0;
			uploadPromise = new Promise((resolve, reject) => {
				const stream = createWriteStream(target);
				file.on('data', (chunk) => {
					size += chunk.length;
				});
				file.on('limit', () => reject(new Error('File too large')));
				file.on('error', reject);
				stream.on('error', reject);
				stream.on('finish', () => {
					const url = `${config.uploadPublicBaseUrl.replace(/\/$/, '')}/${storedName}`;
					db.prepare(
						`INSERT INTO images (id, user_id, name, url, path, size, content_type, created_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
					).run(id, user.user_id, originalName, url, target, size, info.mimeType || null, Date.now());
					resolve({ id, name: originalName, url, size });
				});
				file.pipe(stream);
			});
		});
		busboy.on('finish', async () => {
			try {
				if (uploadError) return res.status(400).json({ error: uploadError.message });
				if (!uploadPromise) return res.status(400).json({ error: 'Missing file' });
				const image = await uploadPromise;
				res.status(201).json({ ok: true, image, url: image.url });
			} catch (error) {
				res.status(400).json({ error: error.message || 'Upload failed' });
			}
		});
		req.pipe(busboy);
	});

	app.delete('/api/images', (req, res) => {
		const user = findSessionUser(db, req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		const id = cleanText(req.query.id || req.body?.id, 80);
		if (!id) return res.status(400).json({ error: 'Missing id' });
		const row = db.prepare('SELECT path FROM images WHERE id = ? AND user_id = ?').get(id, user.user_id);
		if (!row) return res.status(404).json({ error: 'Image not found' });
		db.prepare('DELETE FROM images WHERE id = ? AND user_id = ?').run(id, user.user_id);
		if (existsSync(row.path)) unlinkSync(row.path);
		res.json({ ok: true });
	});

	app.get('/api/admin/check', (req, res) => {
		const auth = adminAuth(db, config, req);
		res.json({ isAdmin: auth.authorized, email: auth.email, login: auth.login });
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

	app.use((_req, res) => {
		res.status(404).json({ error: 'Not Found' });
	});

	return app;
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

function adminAuth(db, config, req) {
	const token = bearerToken(req);
	if (config.adminToken && token === config.adminToken) {
		return { authorized: true, email: null, login: 'admin-token' };
	}
	const user = findSessionUser(db, req);
	if (user?.is_admin) return { authorized: true, email: user.email || null, login: user.login || null };
	if (user?.login && config.adminGithubLogins.includes(user.login)) return { authorized: true, email: user.email || null, login: user.login };
	if (user?.email && config.adminEmails.includes(String(user.email).toLowerCase())) {
		return { authorized: true, email: user.email, login: user.login };
	}
	return { authorized: false, email: null, login: null };
}

function findSessionUser(db, req) {
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

function userById(db, id) {
	return db.prepare(
		`SELECT id AS user_id, login, name, avatar_url, profile_url, email, is_admin
		   FROM users WHERE id = ? LIMIT 1`
	).get(id);
}

function createSession(db, config, req, userId) {
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

function toApiUser(row) {
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

function scalar(db, sql) {
	const row = db.prepare(sql).get();
	return Number(row?.[Object.keys(row)[0]] || 0);
}

function storeOutbox(db, type, recipient, subject, body) {
	db.prepare(
		`INSERT INTO outbox (id, type, recipient, subject, body, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	).run(`out_${randomToken(12)}`, type, recipient || null, subject || null, body, Date.now());
}

function trySendmail(config, recipient, subject, body) {
	if (!config.enableSendmail || !recipient) return;
	const child = spawn(config.sendmailPath, ['-t'], { stdio: ['pipe', 'ignore', 'ignore'] });
	child.stdin.end(`To: ${recipient}\nSubject: ${subject}\nContent-Type: text/plain; charset=UTF-8\n\n${body}`);
}

async function verifyTurnstile(req, res, config, fetchImpl) {
	if (!config.turnstileSecretKey) return true;
	const token = cleanText(req.body?.turnstileToken || req.body?.['cf-turnstile-response'], 2048);
	if (!token) {
		res.status(400).json({ error: 'Verification failed' });
		return false;
	}

	try {
		const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			signal: AbortSignal.timeout(5_000),
			body: JSON.stringify({
				secret: config.turnstileSecretKey,
				response: token,
				remoteip: clientIp(req),
			}),
		});
		if (!response.ok) {
			res.status(503).json({ error: 'Verification unavailable' });
			return false;
		}
		const result = await response.json();
		if (
			result?.success !== true
			|| (config.turnstileExpectedHostname && result?.hostname !== config.turnstileExpectedHostname)
		) {
			res.status(400).json({ error: 'Verification failed' });
			return false;
		}
		return true;
	} catch {
		res.status(503).json({ error: 'Verification unavailable' });
		return false;
	}
}

function checkRate(req, res, rateMap, route, limit = RATE_LIMIT_PER_WINDOW) {
	const now = Date.now();
	const bucket = Math.floor(now / RATE_LIMIT_WINDOW_MS);
	const key = `${clientIp(req)}:${route}:${bucket}`;
	const count = rateMap.get(key) || 0;
	if (count >= limit) {
		res.status(429).json({ error: 'Too Many Requests' });
		return false;
	}
	rateMap.set(key, count + 1);
	if (rateMap.size > 10_000) {
		for (const storedKey of rateMap.keys()) {
			if (!storedKey.endsWith(`:${bucket}`)) rateMap.delete(storedKey);
		}
	}
	return true;
}

function dailyCommentCount(db, userId) {
	const midnight = new Date();
	midnight.setUTCHours(24, 0, 0, 0);
	const dayStart = midnight.getTime() - 24 * 60 * 60 * 1000;
	const row = db.prepare('SELECT COUNT(*) AS count FROM comments WHERE user_id = ? AND created_at >= ?').get(userId, dayStart);
	return Number(row?.count || 0);
}

function isAllowedOrigin(config, origin) {
	return config.allowedOrigins.includes(origin) || origin === config.frontendUrl;
}

function setNoStoreHeaders(res) {
	res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
	res.setHeader('Pragma', 'no-cache');
	res.setHeader('Expires', '0');
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

function bearerToken(req) {
	const header = req.headers.authorization || '';
	const match = String(header).match(/^Bearer\s+(.+)$/i);
	return match ? match[1].trim() : '';
}

function cleanText(value, maxLength) {
	if (typeof value !== 'string') return '';
	return value.trim().replace(/\0/g, '').slice(0, maxLength);
}

function cleanEmail(value) {
	const email = cleanText(value, 254).toLowerCase();
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function cleanUrl(value) {
	const raw = cleanText(value, 2048);
	try {
		const url = new URL(raw);
		return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
	} catch {
		return '';
	}
}

function normalizeSlug(value) {
	const slug = cleanText(value, 180);
	if (!slug || !/^[\p{L}\p{N}_./:%+@#=!,~ -]+$/u.test(slug)) return null;
	return slug;
}

function containsHtml(value) {
	return /<[^>]+>/.test(value);
}

function moderateText(value) {
	if (containsHtml(value)) return 'reject';
	if (SUSPICIOUS_RE.test(value)) return 'review';
	return 'allow';
}

function randomToken(bytes) {
	return base64Url(randomBytes(bytes));
}

function base64Url(input) {
	return Buffer.from(input).toString('base64url');
}

function safeEqual(a, b) {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

function clientIp(req) {
	return String(req.ip || req.socket?.remoteAddress || 'unknown')
		.trim()
		.slice(0, 80);
}

function syntheticGithubId(value) {
	const digest = createHash('sha256').update(value).digest();
	return Number(digest.readUInt32BE(0));
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
