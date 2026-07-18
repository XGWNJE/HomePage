import { randomBytes } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve, win32 } from 'node:path';

function splitList(value) {
	return String(value || '')
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean);
}

function normalizeOrigin(value) {
	return new URL(String(value)).origin;
}

function positiveInteger(env, name, fallback) {
	const configured = env[name];
	const value = Number(configured === undefined || configured === '' ? fallback : configured);
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive safe integer`);
	}
	return value;
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
	const subscriptionAccessEnabled = env.SUBSCRIPTION_ACCESS_ENABLED === 'true';
	const subscriptionAccessFixture = env.SUBSCRIPTION_ACCESS_FIXTURE === 'true';
	const subscriptionAccessRegistry = env.SUBSCRIPTION_ACCESS_REGISTRY || '';
	const subscriptionAccessFixtureQr = env.SUBSCRIPTION_ACCESS_FIXTURE_QR || '';
	const subscriptionAccessTtlSeconds = Number(env.SUBSCRIPTION_ACCESS_TTL_SECONDS || 300);
	if (!Number.isInteger(subscriptionAccessTtlSeconds) || subscriptionAccessTtlSeconds < 60 || subscriptionAccessTtlSeconds > 300) {
		throw new Error('SUBSCRIPTION_ACCESS_TTL_SECONDS must be an integer between 60 and 300');
	}
	if (nodeEnv === 'production' && subscriptionAccessFixture) {
		throw new Error('Subscription fixture access cannot be enabled in production');
	}
	if (nodeEnv === 'production' && subscriptionAccessEnabled && (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET)) {
		throw new Error('GitHub OAuth must be configured when production subscription access is enabled');
	}
	if (subscriptionAccessFixture && !subscriptionAccessEnabled) {
		throw new Error('SUBSCRIPTION_ACCESS_FIXTURE requires SUBSCRIPTION_ACCESS_ENABLED=true');
	}
	if (subscriptionAccessEnabled && !isAbsoluteOnAnyPlatform(subscriptionAccessRegistry)) {
		throw new Error('SUBSCRIPTION_ACCESS_REGISTRY must be an absolute path when subscription access is enabled');
	}
	if (subscriptionAccessFixture && !isAbsoluteOnAnyPlatform(subscriptionAccessFixtureQr)) {
		throw new Error('SUBSCRIPTION_ACCESS_FIXTURE_QR must be an absolute path in fixture mode');
	}
	const uploadDir = env.UPLOAD_DIR || join(dataDir, 'uploads');
	const resolvedUploadDir = resolve(uploadDir);
	const uploadMaxFileBytes = positiveInteger(env, 'UPLOAD_MAX_FILE_BYTES', 8 * 1024 * 1024);
	const uploadMaxPixels = positiveInteger(env, 'UPLOAD_MAX_PIXELS', 40_000_000);
	const uploadMaxFrames = positiveInteger(env, 'UPLOAD_MAX_FRAMES', 50);
	const uploadUserQuotaBytes = positiveInteger(env, 'UPLOAD_USER_QUOTA_BYTES', 256 * 1024 * 1024);
	const uploadRateLimitPerUser = positiveInteger(env, 'UPLOAD_RATE_LIMIT_PER_USER', 10);
	const uploadRateLimitPerIp = positiveInteger(env, 'UPLOAD_RATE_LIMIT_PER_IP', 30);
	const uploadRateLimitWindowMs = positiveInteger(env, 'UPLOAD_RATE_LIMIT_WINDOW_MS', 60_000);
	const uploadMaxConcurrentDecodes = positiveInteger(env, 'UPLOAD_MAX_CONCURRENT_DECODES', 2);
	if (uploadUserQuotaBytes < uploadMaxFileBytes) {
		throw new Error('UPLOAD_USER_QUOTA_BYTES must be greater than or equal to UPLOAD_MAX_FILE_BYTES');
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
		uploadDir,
		uploadTempDir: join(dirname(resolvedUploadDir), `.${basename(resolvedUploadDir)}-tmp`),
		uploadRecoveryDir: join(dirname(resolvedUploadDir), `.${basename(resolvedUploadDir)}-recovery`),
		uploadPublicBaseUrl: env.UPLOAD_PUBLIC_BASE_URL || 'https://api.xgwnje.cn/uploads',
		uploadMaxFileBytes,
		uploadMaxPixels,
		uploadMaxFrames,
		uploadUserQuotaBytes,
		uploadRateLimitPerUser,
		uploadRateLimitPerIp,
		uploadRateLimitWindowMs,
		uploadMaxConcurrentDecodes,
		contactToEmail: env.CONTACT_TO_EMAIL || '',
		sendmailPath: env.SENDMAIL_PATH || '/usr/sbin/sendmail',
		enableSendmail: env.ENABLE_SENDMAIL === 'true',
		turnstileSiteKey,
		turnstileSecretKey,
		turnstileExpectedHostname: env.TURNSTILE_EXPECTED_HOSTNAME || new URL(frontendUrl).hostname,
		serviceVersion: env.SERVICE_VERSION || '0.1.0',
		serviceRevision: env.SERVICE_REVISION || env.GIT_COMMIT || 'unknown',
		subscriptionAccessEnabled,
		subscriptionAccessFixture,
		subscriptionAccessRegistry,
		subscriptionAccessFixtureQr,
		subscriptionAccessTtlSeconds,
	};
}

function isAbsoluteOnAnyPlatform(value) {
	return typeof value === 'string' && Boolean(value) && (isAbsolute(value) || win32.isAbsolute(value));
}
