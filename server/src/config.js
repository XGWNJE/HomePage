import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

function splitList(value) {
	return String(value || '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

export function loadConfig(env = process.env) {
	const dataDir = env.HOMEPAGE_API_DATA_DIR || join(process.cwd(), 'server-data');
	const sessionSecret = env.SESSION_SECRET || env.HOMEPAGE_SESSION_SECRET || randomBytes(32).toString('hex');
	const adminToken = env.ADMIN_TOKEN || env.HOMEPAGE_ADMIN_TOKEN || '';

	return {
		port: Number(env.PORT || 8787),
		host: env.HOST || '127.0.0.1',
		dataDir,
		databasePath: env.DATABASE_PATH || join(dataDir, 'homepage-api.sqlite'),
		baseUrl: env.BASE_URL || 'https://api.xgwnje.cn',
		frontendUrl: env.FRONTEND_URL || 'https://xgwnje.cn',
		allowedOrigins: splitList(env.PUBLIC_ALLOWED_ORIGIN || env.ALLOWED_ORIGINS || 'https://xgwnje.cn'),
		sessionSecret,
		sessionTtlSeconds: Number(env.SESSION_TTL_SECONDS || 30 * 24 * 3600),
		githubClientId: env.GITHUB_CLIENT_ID || '',
		githubClientSecret: env.GITHUB_CLIENT_SECRET || '',
		adminToken,
		adminGithubLogins: splitList(env.ADMIN_GITHUB_LOGINS),
		adminEmails: splitList(env.ADMIN_EMAILS).map((email) => email.toLowerCase()),
		devLogin: env.DEV_LOGIN === 'true' || env.NODE_ENV !== 'production',
		uploadDir: env.UPLOAD_DIR || join(dataDir, 'uploads'),
		uploadPublicBaseUrl: env.UPLOAD_PUBLIC_BASE_URL || 'https://api.xgwnje.cn/uploads',
		contactToEmail: env.CONTACT_TO_EMAIL || '',
		sendmailPath: env.SENDMAIL_PATH || '/usr/sbin/sendmail',
		enableSendmail: env.ENABLE_SENDMAIL === 'true',
	};
}
