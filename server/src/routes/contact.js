import { storeOutbox, trySendmail } from '../internal/messaging.js';
import { cleanEmail, cleanText, clientIp, randomToken } from '../internal/request.js';
import { verifyTurnstile } from '../internal/turnstile.js';

export function registerContactRoutes(app, { db, config, fetchImpl, checkRate }) {
	app.post('/api/contact', async (req, res) => {
		if (!checkRate(req, res, 'contact', 10)) return;
		const name = cleanText(req.body?.name, 80);
		const email = cleanEmail(req.body?.email);
		const message = cleanText(req.body?.message, 4000);
		if (!name || !email || !message) return res.status(400).json({ error: 'Invalid contact message' });
		if (!await verifyTurnstile(req, res, config, fetchImpl)) return;
		const id = `msg_${randomToken(12)}`;
		db.prepare(
			`INSERT INTO contact_messages (id, name, email, message, ip, user_agent, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`
		).run(id, name, email, message, clientIp(req), String(req.headers['user-agent'] || '').slice(0, 256), Date.now());
		storeOutbox(db, 'contact', config.contactToEmail, `Contact from ${name}`, `${name} <${email}>\n\n${message}`);
		trySendmail(config, config.contactToEmail, `Contact from ${name}`, `${name} <${email}>\n\n${message}`);
		res.json({ ok: true, id });
	});
}
