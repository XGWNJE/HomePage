import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
	SubscriptionAccessUnavailableError,
	loadSubscriptionAccess,
} from '../src/internal/subscription-access.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/subscription-access.v1.json', import.meta.url), 'utf8'));
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function withFixture(callback) {
	const dir = mkdtempSync(join(tmpdir(), 'homepage-subscription-test-'));
	const registryPath = join(dir, 'registry.json');
	const qrPath = join(dir, 'fixture-mobile-import.png');
	writeFileSync(registryPath, JSON.stringify(fixture));
	writeFileSync(qrPath, Buffer.concat([pngSignature, Buffer.from('fixture')]));
	try {
		return callback({ dir, registryPath, qrPath });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test('v1 fixture exposes only validated endpoint kinds and derives CMFA from mobile', () => {
	withFixture(({ registryPath, qrPath }) => {
		const access = loadSubscriptionAccess({ registryPath, qrPathOverride: qrPath });
		assert.equal(access.reveal('desktop'), fixture.endpoints.desktop.url);
		assert.equal(access.reveal('mobile'), fixture.endpoints.mobile.url);
		assert.equal(
			access.reveal('cmfa-import'),
			`clashmeta://install-config?url=${encodeURIComponent(fixture.endpoints.mobile.url)}`,
		);
		assert.deepEqual(access.available, { desktop: true, mobile: true, mobileQr: true });
		assert.deepEqual(access.mobileQr, Buffer.concat([pngSignature, Buffer.from('fixture')]));
		assert.throws(() => access.reveal('unknown'), /unsupported subscription kind/i);
	});
});

test('registry validation rejects unknown fields, unsafe URLs, and identical endpoints generically', () => {
	for (const mutate of [
		(value) => { value.extra = true; },
		(value) => { value.schemaVersion = 2; },
		(value) => { value.generatedAt = 'today'; },
		(value) => { value.endpoints.desktop.url = 'http://sub.xgwnje.cn/0123456789abcdef0123456789abcdef/desktop.yaml'; },
		(value) => { value.endpoints.desktop.url = 'https://example.com/0123456789abcdef0123456789abcdef/desktop.yaml'; },
		(value) => { value.endpoints.desktop.url += '?token=leak'; },
		(value) => { value.endpoints.desktop.url = value.endpoints.mobile.url; },
	]) {
		withFixture(({ registryPath, qrPath }) => {
			const changed = structuredClone(fixture);
			mutate(changed);
			writeFileSync(registryPath, JSON.stringify(changed));
			assert.throws(
				() => loadSubscriptionAccess({ registryPath, qrPathOverride: qrPath }),
				(error) => error instanceof SubscriptionAccessUnavailableError && error.message === 'Subscription access unavailable',
			);
		});
	}
});

test('QR validation rejects non-PNG, oversized, and symbolic-link files', () => {
	withFixture(({ registryPath, qrPath }) => {
		writeFileSync(qrPath, Buffer.from('not-png'));
		assert.throws(() => loadSubscriptionAccess({ registryPath, qrPathOverride: qrPath }), SubscriptionAccessUnavailableError);

		writeFileSync(qrPath, Buffer.concat([pngSignature, Buffer.alloc(2 * 1024 * 1024)]));
		assert.throws(() => loadSubscriptionAccess({ registryPath, qrPathOverride: qrPath }), SubscriptionAccessUnavailableError);
	});

	withFixture(({ registryPath, qrPath, dir }) => {
		const target = join(dir, 'real.png');
		writeFileSync(target, pngSignature);
		rmSync(qrPath);
		symlinkSync(target, qrPath, 'file');
		assert.throws(() => loadSubscriptionAccess({ registryPath, qrPathOverride: qrPath }), SubscriptionAccessUnavailableError);
	});
});
