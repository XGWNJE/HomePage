import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../src/config.js';
import { createDatabase } from '../src/db.js';
import { reviewHtml } from '../src/routes/pages.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONTENT_DIR = join(ROOT, 'src', 'content', 'blog');
const DIST_BLOG_DIR = join(ROOT, 'dist', 'blog');

function value(frontmatter, key) {
	const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
	return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

function identifier() {
	return randomBytes(12).toString('base64url');
}

function digest(html) {
	return createHash('sha256').update(html, 'utf8').digest('hex');
}

function escaped(value) {
	return value.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character]);
}

if (!existsSync(DIST_BLOG_DIR)) {
	throw new Error('dist/blog does not exist. Run npm run build before importing legacy pages.');
}

// Match `npm --prefix server start`; callers may still select another database
// explicitly through HOMEPAGE_API_DATA_DIR or DATABASE_PATH.
process.env.HOMEPAGE_API_DATA_DIR ||= join(ROOT, 'server', 'server-data');
const config = loadConfig();
const db = createDatabase(config.databasePath);
let imported = 0;
let skipped = 0;

try {
	for (const entry of readdirSync(CONTENT_DIR, { withFileTypes: true })) {
		if (!entry.isFile() || !/\.(?:md|mdx)$/i.test(entry.name)) continue;
		const slug = basename(entry.name).replace(/\.(?:md|mdx)$/i, '');
		const source = readFileSync(join(CONTENT_DIR, entry.name), 'utf8');
		const frontmatter = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';
		const isDraft = /^draft:\s*true\s*$/mi.test(frontmatter);
		if (db.prepare('SELECT 1 FROM pages WHERE slug = ? LIMIT 1').get(slug)) { skipped += 1; continue; }
		const outputPath = join(DIST_BLOG_DIR, slug, 'index.html');

		const body = source.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/, '');
		const html = existsSync(outputPath)
			? readFileSync(outputPath, 'utf8')
			: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escaped(value(frontmatter, 'title') || slug)}</title><style>body{max-width:860px;margin:auto;padding:32px;font:16px/1.8 system-ui;color:#27272a}pre{white-space:pre-wrap;font:inherit}</style><body><pre>${escaped(body)}</pre></body></html>`;
		const title = value(frontmatter, 'title') || slug;
		const summary = value(frontmatter, 'description');
		const publishedAt = Date.parse(value(frontmatter, 'pubDate')) || Date.now();
		const pageId = identifier();
		const versionId = identifier();
		const sha256 = digest(html);
		const review = reviewHtml(html);

		const status = isDraft ? 'draft' : 'published';
		db.exec('BEGIN IMMEDIATE');
		try {
			db.prepare('INSERT INTO pages (id, slug, published_version_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
				.run(pageId, slug, isDraft ? null : versionId, publishedAt, publishedAt);
			db.prepare(`INSERT INTO page_versions
				(id, page_id, title, summary, html, sha256, status, review_json, created_at, created_by, approved_at, approved_by, format_id)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'legacy-import', ?, ?, 'legacy-blog-v1')`)
				.run(versionId, pageId, title, summary, html, sha256, status, JSON.stringify(review), publishedAt, isDraft ? null : publishedAt, isDraft ? null : 'legacy-import');
			db.exec('COMMIT');
			imported += 1;
		} catch (error) {
			db.exec('ROLLBACK');
			throw error;
		}
	}
} finally {
	db.close();
}

console.log(`Legacy HTML import complete: ${imported} imported, ${skipped} skipped.`);
