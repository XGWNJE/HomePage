import { spawn } from 'node:child_process';

import { randomToken } from './request.js';

export function storeOutbox(db, type, recipient, subject, body) {
	db.prepare(
		`INSERT INTO outbox (id, type, recipient, subject, body, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`
	).run(`out_${randomToken(12)}`, type, recipient || null, subject || null, body, Date.now());
}

export function trySendmail(config, recipient, subject, body) {
	if (!config.enableSendmail || !recipient) return;
	const child = spawn(config.sendmailPath, ['-t'], { stdio: ['pipe', 'ignore', 'ignore'] });
	child.once('error', () => {});
	child.stdin.once('error', () => {});
	child.stdin.end(`To: ${recipient}\nSubject: ${subject}\nContent-Type: text/plain; charset=UTF-8\n\n${body}`);
}
