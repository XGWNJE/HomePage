import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db.js';
import { MANAGE_SUBSCRIPTIONS_PERMISSION } from '../src/internal/permissions.js';

const [action, selector, value, permission = MANAGE_SUBSCRIPTIONS_PERMISSION] = process.argv.slice(2);
if (!['grant', 'revoke'].includes(action) || !['--login', '--user-id'].includes(selector) || !value) {
	fail('Usage: npm run permission:manage -- <grant|revoke> <--login|--user-id> <value> [manage_subscriptions]');
}
if (permission !== MANAGE_SUBSCRIPTIONS_PERMISSION) fail('Unsupported permission');

const config = loadConfig();
const db = createDatabase(config.databasePath);
try {
	const column = selector === '--login' ? 'login' : 'id';
	const user = db.prepare(`SELECT id, login, email, is_admin FROM users WHERE ${column} = ? LIMIT 1`).get(value);
	if (!user) fail('User was not found');
	const recognizedAdmin = Boolean(
		user.is_admin
		|| config.adminGithubLogins.includes(user.login)
		|| (user.email && config.adminEmails.includes(String(user.email).toLowerCase()))
	);
	if (!recognizedAdmin) fail('Permission can only be assigned to an administrator');

	if (action === 'grant') {
		db.prepare(
			`INSERT INTO user_permissions (user_id, permission, granted_at, granted_by)
			 VALUES (?, ?, ?, 'operator')
			 ON CONFLICT(user_id, permission) DO UPDATE SET
			  granted_at = excluded.granted_at,
			  granted_by = excluded.granted_by`
		).run(user.id, permission, Date.now());
		console.log('Permission granted for one administrator.');
	} else {
		db.prepare('DELETE FROM user_permissions WHERE user_id = ? AND permission = ?').run(user.id, permission);
		db.prepare(
			`UPDATE sensitive_sessions
			    SET revoked_at = COALESCE(revoked_at, ?)
			  WHERE user_id = ? AND purpose = 'subscription-access'`
		).run(Date.now(), user.id);
		console.log('Permission revoked for one administrator.');
	}
} finally {
	db.close();
}

function fail(message) {
	console.error(message);
	process.exitCode = 1;
	throw new Error(message);
}
