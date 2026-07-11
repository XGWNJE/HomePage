import { cleanText, clientIp } from './request.js';

export async function verifyTurnstile(req, res, config, fetchImpl) {
	if (!config.turnstileSecretKey) return true;
	const token = cleanText(req.body?.turnstileToken || req.body?.['cf-turnstile-response'], 2048);
	if (!token) {
		res.status(400).json({ error: 'Verification failed' });
		return false;
	}

	try {
		const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			signal: AbortSignal.timeout(5_000),
			body: JSON.stringify({
				secret: config.turnstileSecretKey,
				response: token,
				remoteip: clientIp(req),
			}),
		});
		if (!response.ok) {
			res.status(503).json({ error: 'Verification unavailable' });
			return false;
		}
		const result = await response.json();
		if (
			result?.success !== true
			|| (config.turnstileExpectedHostname && result?.hostname !== config.turnstileExpectedHostname)
		) {
			res.status(400).json({ error: 'Verification failed' });
			return false;
		}
		return true;
	} catch {
		res.status(503).json({ error: 'Verification unavailable' });
		return false;
	}
}
