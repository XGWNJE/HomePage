import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const DatabaseSync = await loadDatabaseSync();

export function createDatabase(filename) {
	mkdirSync(dirname(filename), { recursive: true });
	const db = new DatabaseSync(filename);
	db.exec('PRAGMA journal_mode = WAL');
	db.exec('PRAGMA foreign_keys = ON');
	db.exec(schema);
	return db;
}

const schema = `
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
`;

async function loadDatabaseSync() {
	try {
		const sqlite = await import('node:sqlite');
		return sqlite.DatabaseSync;
	} catch {
		const require = createRequire(import.meta.url);
		return require('better-sqlite3');
	}
}
