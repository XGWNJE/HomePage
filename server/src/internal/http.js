export function isAllowedOrigin(config, origin) {
	return config.allowedOrigins.includes(origin) || origin === config.frontendUrl;
}

export function corsMiddleware(config) {
	return (req, res, next) => {
		const origin = req.headers.origin;
		if (origin && isAllowedOrigin(config, origin)) {
			res.setHeader('Access-Control-Allow-Origin', origin);
			res.setHeader('Vary', 'Origin');
			res.setHeader('Access-Control-Allow-Credentials', 'true');
		}
		if (req.method === 'OPTIONS') {
			res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
			res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
			res.status(204).end();
			return;
		}
		next();
	};
}

export function setNoStoreHeaders(res) {
	res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
	res.setHeader('Pragma', 'no-cache');
	res.setHeader('Expires', '0');
}
