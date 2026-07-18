import { createWriteStream, existsSync, linkSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

import Busboy from 'busboy';
import sharp from 'sharp';

import { cleanText, clientIp, randomToken } from '../internal/request.js';
import { findSessionUser } from '../internal/session.js';

const IMAGE_TYPES = new Map([
	['jpeg', { mimeType: 'image/jpeg', extensions: new Set(['.jpg', '.jpeg']), storedExtension: '.jpg' }],
	['png', { mimeType: 'image/png', extensions: new Set(['.png']), storedExtension: '.png' }],
	['gif', { mimeType: 'image/gif', extensions: new Set(['.gif']), storedExtension: '.gif' }],
	['webp', { mimeType: 'image/webp', extensions: new Set(['.webp']), storedExtension: '.webp' }],
]);
const MANAGED_IMAGE_NAME = /^img_[A-Za-z0-9_-]+\.(?:gif|jpe?g|png|webp)$/;

class UploadError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

export function reconcileImageStorage(db, config) {
	const uploadRoot = resolve(config.uploadDir);
	const recordedNames = new Set(db.prepare('SELECT path FROM images').all()
		.map((row) => resolve(String(row.path || '')))
		.filter((filePath) => dirname(filePath) === uploadRoot)
		.map((filePath) => basename(filePath)));

	for (const entry of readdirSync(config.uploadTempDir, { withFileTypes: true })) {
		rmSync(join(config.uploadTempDir, entry.name), { recursive: true, force: true });
	}
	for (const entry of readdirSync(config.uploadDir, { withFileTypes: true })) {
		if (MANAGED_IMAGE_NAME.test(entry.name) && !recordedNames.has(entry.name)) {
			renameSync(
				join(config.uploadDir, entry.name),
				join(config.uploadRecoveryDir, `${Date.now()}-${randomToken(6)}-${entry.name}`),
			);
		}
	}
}

export function registerImageRoutes(app, { db, config }) {
	const allowUpload = createUploadRateLimiter(config);
	const inspectUploadedImage = createDecodeLimiter(config.uploadMaxConcurrentDecodes, inspectImage);
	const usageStatement = db.prepare(
		'SELECT COALESCE(SUM(size), 0) AS size FROM images WHERE user_id = ?'
	);
	const insertStatement = db.prepare(
		`INSERT INTO images (id, user_id, name, url, path, size, content_type, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const commitUpload = (upload, userId) => {
		db.exec('BEGIN IMMEDIATE');
		try {
			const usage = Number(usageStatement.get(userId)?.size || 0);
			if (!Number.isSafeInteger(usage) || usage < 0) throw new Error('Invalid stored upload usage');
			if (upload.size > config.uploadUserQuotaBytes - usage) {
				throw new UploadError(413, 'Upload quota exceeded');
			}
			// A hard link publishes atomically without allowing an ID collision to
			// overwrite an existing user's file. Both directories share a filesystem.
			linkSync(upload.tempPath, upload.finalPath);
			unlinkSync(upload.tempPath);
			insertStatement.run(
				upload.id,
				userId,
				upload.originalName,
				upload.url,
				upload.finalPath,
				upload.size,
				upload.mimeType,
				Date.now()
			);
			db.exec('COMMIT');
		} catch (error) {
			try { db.exec('ROLLBACK'); } catch {}
			throw error;
		}
	};

	app.get('/api/images', (req, res) => {
		const user = findSessionUser(db, req);
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		const rows = db.prepare(
			'SELECT id, name, url, size, content_type, created_at FROM images WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
		).all(user.user_id);
		res.json({ images: rows });
	});

	app.post(['/api/images', '/api/upload'], (req, res) => {
		let user;
		try {
			user = findSessionUser(db, req);
		} catch {
			return res.status(500).json({ error: 'Upload failed' });
		}
		if (!user) return res.status(401).json({ error: 'Unauthorized' });
		if (!allowUpload(user.user_id, clientIp(req))) {
			return res.status(429).json({ error: 'Too Many Requests' });
		}
		if (!req.headers['content-type']?.startsWith('multipart/form-data')) {
			return res.status(415).json({ error: 'Content-Type must be multipart/form-data' });
		}

		let busboy;
		try {
			busboy = Busboy({
				headers: req.headers,
				limits: {
					files: 1,
					fileSize: config.uploadMaxFileBytes,
					fields: 20,
					parts: 21,
					headerPairs: 100,
				},
			});
		} catch {
			return res.status(400).json({ error: 'Invalid multipart upload' });
		}

		const artifact = { tempPath: null, finalPath: null, committed: false };
		let uploadPromise = Promise.resolve(null);
		let fileSeen = false;
		let parseFailure = null;
		let completionStarted = false;
		let requestAborted = false;

		const rememberFailure = (error) => {
			if (!parseFailure) parseFailure = error;
		};
		const cleanup = () => {
			try {
				if (artifact.tempPath) rmSync(artifact.tempPath, { force: true });
			} catch {}
			try {
				if (!artifact.committed && artifact.finalPath) rmSync(artifact.finalPath, { force: true });
			} catch {}
		};
		const complete = async (parserError = null) => {
			if (completionStarted) return;
			completionStarted = true;
			if (parserError) rememberFailure(new UploadError(400, 'Invalid multipart upload'));
			try {
				let upload;
				try {
					upload = await uploadPromise;
				} catch (error) {
					if (parseFailure) throw parseFailure;
					throw error;
				}
				if (requestAborted) return;
				if (parseFailure) throw parseFailure;
				if (!upload) throw new UploadError(400, 'Missing file');

				const imageType = await inspectUploadedImage(upload.tempPath, upload.declaredType, config);
				if (requestAborted) return;
				upload.mimeType = imageType.mimeType;
				upload.finalPath = join(config.uploadDir, `${upload.id}${imageType.storedExtension}`);
				upload.url = `${config.uploadPublicBaseUrl.replace(/\/$/, '')}/${upload.id}${imageType.storedExtension}`;
				artifact.finalPath = upload.finalPath;
				commitUpload(upload, user.user_id);
				artifact.committed = true;

				const image = {
					id: upload.id,
					name: upload.originalName,
					url: upload.url,
					size: upload.size,
				};
				res.status(201).json({ ok: true, image, url: image.url });
			} catch (error) {
				if (!requestAborted && !res.headersSent) {
					const safeError = error instanceof UploadError
						? error
						: new UploadError(500, 'Upload failed');
					res.status(safeError.status).json({ error: safeError.message });
				}
			} finally {
				if (!artifact.committed) cleanup();
				req.off('aborted', abortRequest);
				req.off('error', abortRequest);
				res.off('close', abortResponse);
			}
		};
		const abortRequest = () => {
			requestAborted = true;
			busboy.destroy();
			void complete();
		};
		const abortResponse = () => {
			if (!res.writableEnded) abortRequest();
		};

		busboy.on('file', (_name, file, info) => {
			if (fileSeen) {
				file.resume();
				rememberFailure(new UploadError(400, 'Only one image may be uploaded'));
				return;
			}
			fileSeen = true;
			const originalName = sanitizeFileName(info.filename);
			const declaredType = declaredImageType(originalName, info.mimeType);
			if (!declaredType) {
				file.resume();
				rememberFailure(new UploadError(400, 'Invalid image upload'));
				return;
			}

			const id = `img_${randomToken(12)}`;
			const tempPath = join(config.uploadTempDir, `${id}.upload`);
			artifact.tempPath = tempPath;
			let fileLimited = false;
			file.once('limit', () => {
				fileLimited = true;
			});
			const output = createWriteStream(tempPath, { flags: 'wx' });
			uploadPromise = pipeline(file, output).then(() => {
				if (fileLimited || file.truncated) throw new UploadError(413, 'File too large');
				const size = statSync(tempPath).size;
				if (size > config.uploadMaxFileBytes) throw new UploadError(413, 'File too large');
				return { id, originalName, declaredType, tempPath, size };
			});
			uploadPromise.catch(() => {});
		});
		busboy.once('filesLimit', () => {
			rememberFailure(new UploadError(400, 'Only one image may be uploaded'));
		});
		busboy.once('fieldsLimit', () => {
			rememberFailure(new UploadError(400, 'Invalid multipart upload'));
		});
		busboy.once('partsLimit', () => {
			rememberFailure(new UploadError(400, 'Invalid multipart upload'));
		});
		busboy.once('error', (error) => {
			void complete(error);
		});
		busboy.once('finish', () => {
			void complete();
		});
		req.once('aborted', abortRequest);
		req.once('error', abortRequest);
		res.once('close', abortResponse);
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

function sanitizeFileName(value) {
	return basename(String(value || 'upload.bin'))
		.replace(/[^\w.\-]+/g, '-')
		.slice(0, 180) || 'upload.bin';
}

function declaredImageType(filename, mimeType) {
	const extension = extname(filename).toLowerCase();
	const normalizedMimeType = String(mimeType || '').toLowerCase();
	for (const [format, imageType] of IMAGE_TYPES) {
		if (imageType.extensions.has(extension) && imageType.mimeType === normalizedMimeType) {
			return { format, ...imageType };
		}
	}
	return null;
}

async function inspectImage(path, declaredType, config) {
	let metadata;
	try {
		metadata = await sharp(path, {
			animated: true,
			failOn: 'warning',
			limitInputPixels: config.uploadMaxPixels,
		}).metadata();
	} catch (error) {
		if (error instanceof Error && /pixel limit/i.test(error.message)) {
			throw new UploadError(413, 'Image limits exceeded');
		}
		throw new UploadError(400, 'Invalid image upload');
	}

	const actualType = IMAGE_TYPES.get(metadata.format);
	if (
		!actualType
		|| metadata.format !== declaredType.format
		|| metadata.mediaType !== declaredType.mimeType
	) {
		throw new UploadError(400, 'Image format does not match its filename and Content-Type');
	}
	const frames = Number(metadata.pages || 1);
	const width = Number(metadata.width);
	const totalHeight = metadata.pageHeight && frames > 1
		? Number(metadata.pageHeight) * frames
		: Number(metadata.height);
	const totalPixels = width * totalHeight;
	if (
		!Number.isSafeInteger(frames)
		|| frames <= 0
		|| frames > config.uploadMaxFrames
		|| !Number.isSafeInteger(totalPixels)
		|| totalPixels <= 0
		|| totalPixels > config.uploadMaxPixels
	) {
		throw new UploadError(413, 'Image limits exceeded');
	}

	try {
		await sharp(path, {
			animated: true,
			failOn: 'warning',
			limitInputPixels: config.uploadMaxPixels,
		}).stats();
	} catch {
		throw new UploadError(400, 'Invalid image upload');
	}
	return actualType;
}

function createUploadRateLimiter(config) {
	const rateMap = new Map();
	return (userId, ip) => {
		const bucket = Math.floor(Date.now() / config.uploadRateLimitWindowMs);
		const entries = [
			[`${bucket}:user:${userId}`, config.uploadRateLimitPerUser],
			[`${bucket}:ip:${ip}`, config.uploadRateLimitPerIp],
		];
		if (entries.some(([key, limit]) => (rateMap.get(key) || 0) >= limit)) return false;
		for (const [key] of entries) rateMap.set(key, (rateMap.get(key) || 0) + 1);
		if (rateMap.size > 10_000) {
			const currentPrefix = `${bucket}:`;
			for (const key of rateMap.keys()) {
				if (!key.startsWith(currentPrefix)) rateMap.delete(key);
			}
		}
		return true;
	};
}

export function createDecodeLimiter(limit, inspect) {
	let active = 0;
	return async (...args) => {
		if (active >= limit) throw new UploadError(429, 'Too Many Requests');
		active += 1;
		try {
			return await inspect(...args);
		} finally {
			active -= 1;
		}
	};
}
