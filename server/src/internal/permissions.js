export const MANAGE_SUBSCRIPTIONS_PERMISSION = 'manage_subscriptions';

export function hasPermission(db, userId, permission) {
	if (!userId) return false;
	return Boolean(db.prepare(
		'SELECT 1 FROM user_permissions WHERE user_id = ? AND permission = ? LIMIT 1'
	).get(userId, permission));
}

export function canManageSubscriptions(db, config, auth) {
	return Boolean(
		config.subscriptionAccessEnabled
		&& auth.authorized
		&& auth.source === 'session'
		&& auth.userId
		&& hasPermission(db, auth.userId, MANAGE_SUBSCRIPTIONS_PERMISSION)
	);
}
