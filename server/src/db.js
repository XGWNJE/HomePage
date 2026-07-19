import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const DatabaseSync = await loadDatabaseSync();

export function createDatabase(filename) {
	mkdirSync(dirname(filename), { recursive: true });
	const db = new DatabaseSync(filename);
	try {
		db.exec('PRAGMA journal_mode = WAL');
		db.exec('PRAGMA foreign_keys = ON');
		runMigrations(db);
		return db;
	} catch (error) {
		db.close();
		throw error;
	}
}

const migrations = [
	{
		version: 1,
		sql: `
CREATE TABLE IF NOT EXISTS users (
	id TEXT PRIMARY KEY,
	github_id INTEGER UNIQUE,
	login TEXT NOT NULL,
	name TEXT,
	avatar_url TEXT,
	profile_url TEXT,
	email TEXT UNIQUE,
	email_verified INTEGER DEFAULT 0,
	is_admin INTEGER DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	ip TEXT,
	user_agent TEXT,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS comments (
	id TEXT PRIMARY KEY,
	parent_id TEXT,
	post_slug TEXT NOT NULL,
	user_id TEXT NOT NULL,
	body TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE SET NULL,
	CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_comments_post_status_created_at
	ON comments(post_slug, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON comments(user_id);

CREATE TABLE IF NOT EXISTS email_logins (
	id TEXT PRIMARY KEY,
	email TEXT NOT NULL,
	token TEXT NOT NULL UNIQUE,
	expires_at INTEGER NOT NULL,
	used INTEGER DEFAULT 0,
	created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_logins_token ON email_logins(token);
CREATE INDEX IF NOT EXISTS idx_email_logins_email ON email_logins(email);

CREATE TABLE IF NOT EXISTS post_views (
	post_slug TEXT PRIMARY KEY,
	views INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_messages (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	email TEXT NOT NULL,
	message TEXT NOT NULL,
	ip TEXT,
	user_agent TEXT,
	status TEXT NOT NULL DEFAULT 'new',
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	name TEXT NOT NULL,
	url TEXT NOT NULL,
	path TEXT NOT NULL,
	size INTEGER NOT NULL,
	content_type TEXT,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS outbox (
	id TEXT PRIMARY KEY,
	type TEXT NOT NULL,
	recipient TEXT,
	subject TEXT,
	body TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'stored',
	created_at INTEGER NOT NULL
);
`,
	},
	{
		version: 2,
		sql: `
CREATE TABLE IF NOT EXISTS user_permissions (
	user_id TEXT NOT NULL,
	permission TEXT NOT NULL,
	granted_at INTEGER NOT NULL,
	granted_by TEXT,
	PRIMARY KEY (user_id, permission),
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	CHECK (permission IN ('manage_subscriptions'))
);

CREATE TABLE IF NOT EXISTS sensitive_sessions (
	token_hash TEXT PRIMARY KEY,
	user_id TEXT NOT NULL,
	purpose TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	revoked_at INTEGER,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
	CHECK (purpose IN ('subscription-access'))
);

CREATE INDEX IF NOT EXISTS idx_sensitive_sessions_user_purpose
	ON sensitive_sessions(user_id, purpose, expires_at);

CREATE TABLE IF NOT EXISTS subscription_reauth_challenges (
	state_hash TEXT PRIMARY KEY,
	verifier_hash TEXT NOT NULL,
	user_id TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	used INTEGER NOT NULL DEFAULT 0,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subscription_reauth_user
	ON subscription_reauth_challenges(user_id, expires_at);

CREATE TABLE IF NOT EXISTS subscription_audit_events (
	id TEXT PRIMARY KEY,
	user_id TEXT,
	action TEXT NOT NULL,
	result TEXT NOT NULL,
	request_id TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_subscription_audit_created_at
	ON subscription_audit_events(created_at);
`,
	},
	{
		version: 3,
		sql: `
CREATE TABLE IF NOT EXISTS admin_audit (
	id TEXT PRIMARY KEY,
	user_login TEXT,
	action TEXT NOT NULL,
	target TEXT NOT NULL,
	detail TEXT,
	created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at
	ON admin_audit(created_at);
`,
	},
	{
		version: 4,
		sql: `
CREATE TABLE IF NOT EXISTS article_drafts (
	id TEXT PRIMARY KEY,
	slug TEXT NOT NULL,
	title TEXT NOT NULL DEFAULT '',
	description TEXT NOT NULL DEFAULT '',
	tags TEXT NOT NULL DEFAULT '',
	category TEXT NOT NULL DEFAULT '',
	body TEXT NOT NULL DEFAULT '',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	author_user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_article_drafts_updated_at
	ON article_drafts(updated_at);
`,
	},
	{
		version: 5,
		// ALTER TABLE ADD COLUMN 没有 IF NOT EXISTS；列已存在（例如 user_version
		// 被重置后重放迁移）时跳过该列，保证迁移可重入。
		sql: `
ALTER TABLE article_drafts ADD COLUMN en_title TEXT NOT NULL DEFAULT '';
ALTER TABLE article_drafts ADD COLUMN en_description TEXT NOT NULL DEFAULT '';
ALTER TABLE article_drafts ADD COLUMN en_body TEXT NOT NULL DEFAULT '';
`,
		guard: (db) => {
			const columns = new Set(
				db.prepare("SELECT name FROM pragma_table_info('article_drafts')").all().map((row) => row.name),
			);
			return ['en_title', 'en_description', 'en_body'].filter((name) => !columns.has(name))
				.map((name) => `ALTER TABLE article_drafts ADD COLUMN ${name} TEXT NOT NULL DEFAULT '';`)
				.join('\n');
		},
	},
];

export const CURRENT_SCHEMA_VERSION = migrations.at(-1)?.version || 0;

function runMigrations(db) {
	const currentVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version || 0);
	if (currentVersion > CURRENT_SCHEMA_VERSION) {
		throw new Error(
			`Unsupported database schema version ${currentVersion}; this service supports up to ${CURRENT_SCHEMA_VERSION}`,
		);
	}
	for (const migration of migrations) {
		if (migration.version <= currentVersion) continue;
		db.exec('BEGIN IMMEDIATE');
		try {
			const sql = migration.guard ? migration.guard(db) : migration.sql;
			if (sql.trim()) db.exec(sql);
			db.exec(`PRAGMA user_version = ${migration.version}`);
			db.exec('COMMIT');
		} catch (error) {
			db.exec('ROLLBACK');
			throw error;
		}
	}
}

async function loadDatabaseSync() {
	try {
		const sqlite = await import('node:sqlite');
		return sqlite.DatabaseSync;
	} catch {
		const require = createRequire(import.meta.url);
		return require('better-sqlite3');
	}
}
