import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDatabase } from '../src/db.js';

function withTempDatabase(callback) {
	const tempDir = mkdtempSync(join(tmpdir(), 'homepage-db-test-'));
	const filename = join(tempDir, 'api.sqlite');
	try {
		return callback(filename);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

test('fresh database records the applied schema version', () => {
	withTempDatabase((filename) => {
		const db = createDatabase(filename);
		try {
			assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
			assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'users'").get().count, 1);
			assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'user_permissions'").get().count, 1);
		} finally {
			db.close();
		}
	});
});

test('migration runner upgrades an unversioned existing database without losing data', () => {
	withTempDatabase((filename) => {
		let db = createDatabase(filename);
		db.prepare(
			`INSERT INTO users (id, github_id, login, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?)`
		).run('existing-user', 42, 'existing', 1, 1);
		db.exec('PRAGMA user_version = 0');
		db.close();

		db = createDatabase(filename);
		try {
			assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
			assert.equal(db.prepare('SELECT login FROM users WHERE id = ?').get('existing-user').login, 'existing');
		} finally {
			db.close();
		}
	});
});

test('migration runner is idempotent after the current version is applied', () => {
	withTempDatabase((filename) => {
		let db = createDatabase(filename);
		db.close();
		db = createDatabase(filename);
		try {
			assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
		} finally {
			db.close();
		}
	});
});

test('startup rejects a database created by a newer schema version', () => {
	withTempDatabase((filename) => {
		const newer = createDatabase(filename);
		newer.exec('PRAGMA user_version = 4');
		newer.close();

		assert.throws(
			() => {
				const unexpected = createDatabase(filename);
				unexpected.close();
			},
			/unsupported database schema version 4/i,
		);
	});
});
