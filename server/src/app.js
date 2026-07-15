import { mkdirSync } from 'node:fs';

import express from 'express';

import { corsMiddleware } from './internal/http.js';
import { createRateLimiter } from './internal/request.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAdminSubscriptionRoutes } from './routes/admin-subscriptions.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCommentRoutes } from './routes/comments.js';
import { registerContactRoutes } from './routes/contact.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerImageRoutes } from './routes/images.js';
import { registerProfileRoutes } from './routes/profile.js';
import { registerViewRoutes } from './routes/views.js';

export function createApp({ db, config, fetchImpl = globalThis.fetch }) {
	if (Boolean(config.turnstileSiteKey) !== Boolean(config.turnstileSecretKey)) {
		throw new Error('Turnstile site and secret keys must be configured together');
	}
	mkdirSync(config.uploadDir, { recursive: true });

	const app = express();
	const checkRate = createRateLimiter();
	const context = { db, config, fetchImpl, checkRate };

	app.disable('x-powered-by');
	// The service only accepts proxied traffic from the local Nginx hop. Trusting
	// arbitrary proxy chains would let clients spoof the IP used for rate limits.
	app.set('trust proxy', 'loopback');
	app.use(express.json({ limit: '1mb' }));
	app.use('/uploads', express.static(config.uploadDir, {
		index: false,
		maxAge: '30d',
		immutable: true,
	}));
	app.use(corsMiddleware(config));

	registerHealthRoutes(app, context);
	// The GitHub OAuth App exposes one callback. The subscription dispatcher
	// handles only requests carrying its own cookies and otherwise falls through.
	registerAdminSubscriptionRoutes(app, context);
	registerAuthRoutes(app, context);
	registerProfileRoutes(app, context);
	registerViewRoutes(app, context);
	registerCommentRoutes(app, context);
	registerContactRoutes(app, context);
	registerImageRoutes(app, context);
	registerAdminRoutes(app, context);

	app.use((_req, res) => {
		res.status(404).json({ error: 'Not Found' });
	});

	return app;
}
