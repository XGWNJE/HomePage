import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, win32 } from 'node:path';

const EXPECTED_HOST = 'sub.xgwnje.cn';
const MAX_QR_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ENDPOINT_KINDS = new Set(['desktop', 'mobile', 'cmfa-import']);

export class SubscriptionAccessUnavailableError extends Error {
	constructor() {
		super('Subscription access unavailable');
		this.name = 'SubscriptionAccessUnavailableError';
	}
}

export function loadSubscriptionAccess({ registryPath, qrPathOverride = '' }) {
	try {
		const registry = parseRegistry(readFileSync(registryPath, 'utf8'));
		const qrPath = qrPathOverride || registry.artifacts.mobileQrPngPath;
		const allowedRoot = realpathSync(qrPathOverride ? dirname(qrPathOverride) : dirname(registryPath));
		const mobileQr = readValidatedPng(qrPath, allowedRoot);
		const values = {
			desktop: registry.endpoints.desktop.url,
			mobile: registry.endpoints.mobile.url,
			'cmfa-import': `clashmeta://install-config?url=${encodeURIComponent(registry.endpoints.mobile.url)}`,
		};

		return {
			available: Object.freeze({ desktop: true, mobile: true, mobileQr: true }),
			mobileQr: Buffer.from(mobileQr),
			reveal(kind) {
				if (!ENDPOINT_KINDS.has(kind)) throw new TypeError('Unsupported subscription kind');
				return values[kind];
			},
		};
	} catch (error) {
		if (error instanceof TypeError && /unsupported subscription kind/i.test(error.message)) throw error;
		if (error instanceof SubscriptionAccessUnavailableError) throw error;
		throw new SubscriptionAccessUnavailableError();
	}
}

function parseRegistry(source) {
	let value;
	try {
		value = JSON.parse(source);
	} catch {
		throw new SubscriptionAccessUnavailableError();
	}
	requireRecord(value, ['schemaVersion', 'generatedAt', 'endpoints', 'artifacts']);
	if (value.schemaVersion !== 1) throw new SubscriptionAccessUnavailableError();
	if (
		typeof value.generatedAt !== 'string'
		|| !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.generatedAt)
		|| !Number.isFinite(Date.parse(value.generatedAt))
	) {
		throw new SubscriptionAccessUnavailableError();
	}
	requireRecord(value.endpoints, ['desktop', 'mobile']);
	requireRecord(value.endpoints.desktop, ['url']);
	requireRecord(value.endpoints.mobile, ['url']);
	requireRecord(value.artifacts, ['mobileQrPngPath']);

	const desktop = validateEndpoint(value.endpoints.desktop.url);
	const mobile = validateEndpoint(value.endpoints.mobile.url);
	if (desktop === mobile) throw new SubscriptionAccessUnavailableError();
	if (
		typeof value.artifacts.mobileQrPngPath !== 'string'
		|| !/^\/var\/lib\/vps-proxies-subscription\/access\/[a-zA-Z0-9._-]+\.png$/.test(value.artifacts.mobileQrPngPath)
	) {
		throw new SubscriptionAccessUnavailableError();
	}

	return {
		...value,
		endpoints: {
			desktop: { url: desktop },
			mobile: { url: mobile },
		},
	};
}

function requireRecord(value, expectedKeys) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new SubscriptionAccessUnavailableError();
	}
	const actualKeys = Object.keys(value).sort();
	const requiredKeys = [...expectedKeys].sort();
	if (actualKeys.length !== requiredKeys.length || actualKeys.some((key, index) => key !== requiredKeys[index])) {
		throw new SubscriptionAccessUnavailableError();
	}
}

function validateEndpoint(value) {
	if (typeof value !== 'string') throw new SubscriptionAccessUnavailableError();
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new SubscriptionAccessUnavailableError();
	}
	if (
		url.protocol !== 'https:'
		|| url.host !== EXPECTED_HOST
		|| url.username
		|| url.password
		|| url.search
		|| url.hash
		|| !url.pathname.endsWith('.yaml')
		|| !/[0-9a-f]{32,}/.test(url.pathname)
	) {
		throw new SubscriptionAccessUnavailableError();
	}
	return url.toString();
}

function readValidatedPng(path, allowedRoot) {
	if (typeof path !== 'string' || !(isAbsolute(path) || win32.isAbsolute(path))) {
		throw new SubscriptionAccessUnavailableError();
	}
	const stat = lstatSync(path);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_QR_BYTES || stat.size < PNG_SIGNATURE.length) {
		throw new SubscriptionAccessUnavailableError();
	}
	const realPath = realpathSync(path);
	const containment = relative(allowedRoot, realPath);
	if (containment.startsWith('..') || isAbsolute(containment) || win32.isAbsolute(containment)) {
		throw new SubscriptionAccessUnavailableError();
	}
	const bytes = readFileSync(resolve(realPath));
	if (bytes.length > MAX_QR_BYTES || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
		throw new SubscriptionAccessUnavailableError();
	}
	return bytes;
}
