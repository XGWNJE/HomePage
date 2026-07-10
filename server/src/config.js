import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

function splitList(value) {
	return String(value || '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

function normalizeOrigin(value) {
	return new URL(String(value)).origin;
}

export function loadConfig(env = process.env) {
	const nodeEnv = env.NODE_ENV || '';
	const dataDir = env.HOMEPAGE_API_DATA_DIR || join(process.cwd(), 'server-data');
	const sessionSecret = env.SESSION_SECRET || env.HOMEPAGE_SESSION_SECRET || randomBytes(32).toString('hex');
	const adminToken = env.ADMIN_TOKEN || env.HOMEPAGE_ADMIN_TOKEN || '';
	const frontendUrl = normalizeOrigin(env.FRONTEND_URL || 'https://xgwnje.cn');
	const defaultAllowedOrigins = env.NODE_ENV === 'production'
		? frontendUrl
		: `${frontendUrl},http://localhost:4321,http://127.0.0.1:4321`;
	const allowedOrigins = [...new Set(
		splitList(env.PUBLIC_ALLOWED_ORIGIN || env.ALLOWED_ORIGINS || defaultAllowedOrigins).map(normalizeOrigin),
	)];
	const turnstileSiteKey = env.TURNSTILE_SITE_KEY || '';
	const turnstileSecretKey = env.TURNSTILE_SECRET_KEY || '';
	if (Boolean(turnstileSiteKey) !== Boolean(turnstileSecretKey)) {
		throw new Error('TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be configured together');
	}
	const devLogin = env.DEV_LOGIN === 'true';
	if (nodeEnv === 'production' && devLogin) {
		throw new Error('DEV_LOGIN cannot be enabled in production');
	}

	return {
		nodeEnv,
		port: Number(env.PORT || 8787),
		host: env.HOST || '127.0.0.1',
		dataDir,
		databasePath: env.DATABASE_PATH || join(dataDir, 'homepage-api.sqlite'),
		baseUrl: env.BASE_URL || 'https://api.xgwnje.cn',
		frontendUrl,
		allowedOrigins,
		sessionSecret,
		sessionTtlSeconds: Number(env.SESSION_TTL_SECONDS || 30 * 24 * 3600),
		githubClientId: env.GITHUB_CLIENT_ID || '',
		githubClientSecret: env.GITHUB_CLIENT_SECRET || '',
		adminToken,
		adminGithubLogins: splitList(env.ADMIN_GITHUB_LOGINS),
		adminEmails: splitList(env.ADMIN_EMAILS).map((email) => email.toLowerCase()),
		devLogin,
		uploadDir: env.UPLOAD_DIR || join(dataDir, 'uploads'),
		uploadPublicBaseUrl: env.UPLOAD_PUBLIC_BASE_URL || 'https://api.xgwnje.cn/uploads',
		contactToEmail: env.CONTACT_TO_EMAIL || '',
		sendmailPath: env.SENDMAIL_PATH || '/usr/sbin/sendmail',
		enableSendmail: env.ENABLE_SENDMAIL === 'true',
		turnstileSiteKey,
		turnstileSecretKey,
		turnstileExpectedHostname: env.TURNSTILE_EXPECTED_HOSTNAME || new URL(frontendUrl).hostname,
		serviceVersion: env.SERVICE_VERSION || '0.1.0',
		serviceRevision: env.SERVICE_REVISION || env.GIT_COMMIT || 'unknown',
	};
}
