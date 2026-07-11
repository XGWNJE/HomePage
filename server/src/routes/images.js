import { createWriteStream, existsSync, unlinkSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import Busboy from 'busboy';

import { cleanText, randomToken } from '../internal/request.js';
import { findSessionUser } from '../internal/session.js';

const ALLOWED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export function registerImageRoutes(app, { db, config }) {
	app.get('/api/images', (req, res) => {
		const user = findSessionUser(db, req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		const rows = db.prepare(
			'SELECT id, name, url, size, content_type, created_at FROM images WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
		).all(user.user_id);
		res.json({ images: rows });
	});

	app.post(['/api/images', '/api/upload'], (req, res) => {
		const user = findSessionUser(db, req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		if (!req.headers['content-type']?.startsWith('multipart/form-data')) {
			return res.status(415).json({ error: 'Content-Type must be multipart/form-data' });
		}
		const busboy = Busboy({ headers: req.headers, limits: { files: 1, fileSize: 8 * 1024 * 1024 } });
		let uploadPromise = null;
		let uploadError = null;
		busboy.on('file', (_name, file, info) => {
			const originalName = basename(info.filename || 'upload.bin').replace(/[^\w.\-]+/g, '-');
			const ext = extname(originalName).toLowerCase().slice(0, 12);
			if (!ALLOWED_IMAGE_EXTENSIONS.has(ext) || !ALLOWED_IMAGE_MIME_TYPES.has(info.mimeType || '')) {
				file.resume();
				uploadError = new Error('Only jpg, png, gif, and webp images are allowed');
				return;
			}
			const id = `img_${randomToken(12)}`;
			const storedName = `${id}${ext}`;
			const target = join(config.uploadDir, storedName);
			let size = 0;
			uploadPromise = new Promise((resolve, reject) => {
				const stream = createWriteStream(target);
				file.on('data', (chunk) => {
					size += chunk.length;
				});
				file.on('limit', () => reject(new Error('File too large')));
				file.on('error', reject);
				stream.on('error', reject);
				stream.on('finish', () => {
					const url = `${config.uploadPublicBaseUrl.replace(/\/$/, '')}/${storedName}`;
					db.prepare(
						`INSERT INTO images (id, user_id, name, url, path, size, content_type, created_at)
						 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
					).run(id, user.user_id, originalName, url, target, size, info.mimeType || null, Date.now());
					resolve({ id, name: originalName, url, size });
				});
				file.pipe(stream);
			});
		});
		busboy.on('finish', async () => {
			try {
				if (uploadError) return res.status(400).json({ error: uploadError.message });
				if (!uploadPromise) return res.status(400).json({ error: 'Missing file' });
				const image = await uploadPromise;
				res.status(201).json({ ok: true, image, url: image.url });
			} catch (error) {
				res.status(400).json({ error: error.message || 'Upload failed' });
			}
		});
		req.pipe(busboy);
	});

	app.delete('/api/images', (req, res) => {
		const user = findSessionUser(db, req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		const id = cleanText(req.query.id || req.body?.id, 80);
		if (!id) return res.status(400).json({ error: 'Missing id' });
		const row = db.prepare('SELECT path FROM images WHERE id = ? AND user_id = ?').get(id, user.user_id);
		if (!row) return res.status(404).json({ error: 'Image not found' });
		db.prepare('DELETE FROM images WHERE id = ? AND user_id = ?').run(id, user.user_id);
		if (existsSync(row.path)) unlinkSync(row.path);
		res.json({ ok: true });
	});
}
