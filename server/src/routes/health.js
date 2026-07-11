import { CURRENT_SCHEMA_VERSION } from '../db.js';

export function registerHealthRoutes(app, { db, config }) {
	const turnstileReadiness = config.turnstileSecretKey ? 'enabled' : 'disabled';
	app.get('/health', (_req, res) => {
		const metadata = {
			service: 'homepage-api',
			version: config.serviceVersion || 'unknown',
			revision: config.serviceRevision || 'unknown',
		};
		try {
			const schemaVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version || 0);
			if (schemaVersion !== CURRENT_SCHEMA_VERSION) {
				return res.status(503).json({
					ok: false,
					...metadata,
					readiness: {
						database: 'schema-mismatch',
						schemaVersion,
						expectedSchemaVersion: CURRENT_SCHEMA_VERSION,
						turnstile: turnstileReadiness,
					},
				});
			}
			res.json({
				ok: true,
				...metadata,
				readiness: { database: 'ready', schemaVersion, turnstile: turnstileReadiness },
			});
		} catch {
			res.status(503).json({
				ok: false,
				...metadata,
				readiness: { database: 'unavailable', schemaVersion: null, turnstile: turnstileReadiness },
			});
		}
	});
}
