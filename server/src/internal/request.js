import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_PER_WINDOW = 60;
const SUSPICIOUS_RE = /(https?:\/\/|www\.|telegram|whatsapp|casino|crypto|airdrop|贷款|博彩|发票)/i;

export function createRateLimiter() {
	const rateMap = new Map();
	return (req, res, route, limit = RATE_LIMIT_PER_WINDOW, identity = clientIp(req)) => {
		const now = Date.now();
		const bucket = Math.floor(now / RATE_LIMIT_WINDOW_MS);
		const key = `${identity}:${route}:${bucket}`;
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
	};
}

export function cleanText(value, maxLength) {
	if (typeof value !== 'string') return '';
	return value.trim().replace(/\0/g, '').slice(0, maxLength);
}

export function cleanEmail(value) {
	const email = cleanText(value, 254).toLowerCase();
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export function cleanUrl(value) {
	const raw = cleanText(value, 2048);
	try {
		const url = new URL(raw);
		return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
	} catch {
		return '';
	}
}

export function normalizeSlug(value) {
	const slug = cleanText(value, 180);
	if (!slug || !/^[\p{L}\p{N}_./:%+@#=!,~ -]+$/u.test(slug)) return null;
	return slug;
}

export function containsHtml(value) {
	return /<[^>]+>/.test(value);
}

export function moderateText(value) {
	if (containsHtml(value)) return 'reject';
	if (SUSPICIOUS_RE.test(value)) return 'review';
	return 'allow';
}

export function randomToken(bytes) {
	return base64Url(randomBytes(bytes));
}

export function base64Url(input) {
	return Buffer.from(input).toString('base64url');
}

export function safeEqual(a, b) {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

export function clientIp(req) {
	return String(req.ip || req.socket?.remoteAddress || 'unknown')
		.trim()
		.slice(0, 80);
}

export function syntheticGithubId(value) {
	const digest = createHash('sha256').update(value).digest();
	return Number(digest.readUInt32BE(0));
}
