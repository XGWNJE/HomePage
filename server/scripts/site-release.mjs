// 服务器端文章发布脚本（Phase 0：网页后台发布地基）。
// 在 VPS 上运行：把文章文件写入仓库专用克隆，构建静态站，复用版本化目录
// 与原子切换机制上线。与本地 publish:content 通道共用同一个 flock 与
// releases 结构，两条发布路径天然串行。
//
// 用法：
//   node server/scripts/site-release.mjs --repo /opt/homepage-site \
//     [--write <repoRelPath>=<absContentFile>]... [--delete <repoRelPath>]... \
//     --message "提交说明" [--node-bin /opt/node22/bin/node] [--dry-run]
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARTICLE_PATTERN = /^src\/content\/blog\/[a-z0-9][a-z0-9-]*-(?:cn|en)\.md$/;
const IMAGE_PATTERN = /^public\/image\/blog\/[a-z0-9][a-z0-9/-]*\.(?:avif|gif|jpe?g|png|webp)$/i;
const ATTACHMENT_PATTERN = /^public\/file\/blog\/[a-z0-9][a-z0-9/-]*\.(?:csv|json|mp3|mp4|ogg|pdf|txt|wav|webm|zip)$/i;
const LOCK_PATH = '/tmp/xgwnje-home-frontend-release.lock';
const LIVE_ROOT = '/var/www/xgwnje-home';
const RELEASES_ROOT = '/var/www/xgwnje-home.releases';
const SITE_ORIGIN = process.env.SITE_RELEASE_ORIGIN || 'https://xgwnje.cn';

export function assertAllowedContentPath(filePath) {
	const normalized = String(filePath).replaceAll('\\', '/').replace(/^\.\//, '');
	if (
		!ARTICLE_PATTERN.test(normalized)
		&& !IMAGE_PATTERN.test(normalized)
		&& !ATTACHMENT_PATTERN.test(normalized)
	) {
		throw new Error(`Path is not an article or dedicated article asset: ${filePath}`);
	}
	return normalized;
}

export function parseArticleFrontmatter(source) {
	const text = String(source).replaceAll('\r\n', '\n');
	if (!text.startsWith('---\n')) return {};
	const end = text.indexOf('\n---', 4);
	if (end < 0) return {};
	const fields = {};
	for (const line of text.slice(4, end).split('\n')) {
		const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
		if (!match) continue;
		fields[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
	}
	return fields;
}

export function validateArticleSource(source, filePath) {
	const fields = parseArticleFrontmatter(source);
	const problems = [];
	if (!fields.title) problems.push('missing title');
	if (!fields.description) problems.push('missing description');
	if (!fields.pubDate || Number.isNaN(Date.parse(fields.pubDate))) problems.push('invalid pubDate');
	if (fields.lang && fields.lang !== 'cn' && fields.lang !== 'en') problems.push(`invalid lang: ${fields.lang}`);
	if (fields.draft && fields.draft !== 'true' && fields.draft !== 'false') problems.push(`invalid draft: ${fields.draft}`);
	if (problems.length > 0) throw new Error(`Invalid article frontmatter in ${filePath}: ${problems.join(', ')}`);
	return fields;
}

export function deriveArticleRoutes(writes) {
	const routes = new Set(['/', '/blog/', '/feed.xml', '/sitemap.xml']);
	for (const { repoPath, source } of writes) {
		if (!ARTICLE_PATTERN.test(repoPath)) continue;
		const fields = parseArticleFrontmatter(source);
		if (fields.draft === 'true') continue;
		routes.add(`/blog/${path.basename(repoPath, '.md')}/`);
	}
	return [...routes];
}

export function buildReleaseId(now, headShort) {
	const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
	return `${stamp}-web-${headShort}`;
}

function sha256File(filePath) {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function collectTree(root, directory = '') {
	const absolute = path.join(root, directory);
	const files = [];
	for (const entry of readdirSync(absolute, { withFileTypes: true })) {
		const relative = directory ? `${directory}/${entry.name}` : entry.name;
		if (entry.isDirectory()) files.push(...collectTree(root, relative));
		else if (entry.isFile()) files.push(relative);
	}
	return files;
}

function treeManifest(root) {
	const files = collectTree(root).sort();
	let totalBytes = 0;
	const hash = createHash('sha256');
	let indexSha256 = '';
	for (const relative of files) {
		const fileSha = sha256File(path.join(root, ...relative.split('/')));
		const size = statSync(path.join(root, ...relative.split('/'))).size;
		hash.update(`${fileSha}\t${size}\t${relative}\n`);
		totalBytes += size;
		if (relative === 'index.html') indexSha256 = fileSha;
	}
	if (!indexSha256) throw new Error(`Release tree is missing index.html: ${root}`);
	return { fileCount: files.length, totalBytes, indexSha256, treeSha256: hash.digest('hex') };
}

function parseArgs(argv) {
	const options = { repo: '', writes: [], deletes: [], message: '', nodeBin: '/opt/node22/bin/node', dryRun: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--repo') options.repo = argv[++index] ?? '';
		else if (arg === '--write') {
			const spec = argv[++index] ?? '';
			const eq = spec.indexOf('=');
			if (eq <= 0) throw new Error(`Invalid --write spec: ${spec}`);
			options.writes.push({ repoPath: spec.slice(0, eq), contentPath: spec.slice(eq + 1) });
		} else if (arg === '--delete') options.deletes.push(argv[++index] ?? '');
		else if (arg === '--message') options.message = argv[++index] ?? '';
		else if (arg === '--node-bin') options.nodeBin = argv[++index] ?? '';
		else if (arg === '--dry-run') options.dryRun = true;
		else throw new Error(`Unknown argument: ${arg}`);
	}
	if (!options.repo) throw new Error('Missing --repo');
	if (!options.message) throw new Error('Missing --message');
	if (options.writes.length === 0 && options.deletes.length === 0) throw new Error('Nothing to write or delete');
	return options;
}

function git(repo, args) {
	return execFileSync('git', ['-c', 'safe.directory=*', '-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function run(command, args, { cwd, phase } = {}) {
	return new Promise((resolve, reject) => {
		// 不继承调用方环境：API 服务的 BASE_URL 等变量会污染 Astro 构建产物。
		const env = { ...process.env };
		delete env.BASE_URL;
		delete env.PUBLIC_API_BASE_URL;
		const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
			process.stdout.write(chunk);
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
			process.stderr.write(chunk);
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) reject(new Error(`${phase ?? command} failed with exit code ${code}. ${stderr.trim()}`));
			else resolve({ stdout, stderr });
		});
	});
}

async function main() {
	// Re-exec under the shared release flock unless already held.
	// -E 75 distinguishes lock conflicts from inner script failures.
	if (process.env.SITE_RELEASE_LOCK_HELD !== '1') {
		const result = spawnSync('flock', ['-n', '-E', '75', LOCK_PATH, process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
			stdio: 'inherit',
			env: { ...process.env, SITE_RELEASE_LOCK_HELD: '1' },
		});
		if (result.status === 75) throw new Error('Another frontend release is active.');
		process.exit(result.status ?? 1);
	}

	const options = parseArgs(process.argv.slice(2));
	const repo = path.resolve(options.repo);
	const startedAt = Date.now();

	const writes = options.writes.map(({ repoPath, contentPath }) => {
		const normalized = assertAllowedContentPath(repoPath);
		if (!existsSync(contentPath)) throw new Error(`Content file is missing: ${contentPath}`);
		const source = readFileSync(contentPath, 'utf8');
		if (ARTICLE_PATTERN.test(normalized)) validateArticleSource(source, normalized);
		return { repoPath: normalized, contentPath, source };
	});
	const deletes = options.deletes.map(assertAllowedContentPath);
	const articleRoutes = deriveArticleRoutes(writes);

	// Dedicated publishing clone: must be clean and fast-forwarded to origin/main.
	if (git(repo, ['status', '--porcelain']) !== '') throw new Error(`Publishing clone is dirty: ${repo}`);
	git(repo, ['fetch', 'origin', 'main']);
	git(repo, ['checkout', 'main']);
	git(repo, ['reset', '--hard', 'origin/main']);

	for (const { repoPath, contentPath } of writes) {
		const target = path.join(repo, ...repoPath.split('/'));
		mkdirSync(path.dirname(target), { recursive: true });
		copyFileSync(contentPath, target);
	}
	for (const repoPath of deletes) {
		rmSync(path.join(repo, ...repoPath.split('/')), { force: true });
	}
	if (git(repo, ['status', '--porcelain']) === '') throw new Error('The job produced no repository changes.');

	// Build before committing: a failed build leaves no trace in git history.
	// 依赖变化检测：lockfile 哈希与上次 npm ci 记录不一致时重装依赖，
	// 否则新增依赖（如编辑器组件）会让构建找不到模块。标记文件放在克隆外，
	// 避免弄脏 git 工作区。
	const npmBin = path.join(path.dirname(options.nodeBin), 'npm');
	const lockSha = sha256File(path.join(repo, 'package-lock.json'));
	const lockMarker = `${repo}.package-lock.sha256`;
	const recordedLockSha = existsSync(lockMarker) ? readFileSync(lockMarker, 'utf8').trim() : '';
	if (!existsSync(path.join(repo, 'node_modules', 'astro', 'bin', 'astro.mjs')) || recordedLockSha !== lockSha) {
		await run(npmBin, ['ci'], { cwd: repo, phase: 'npm ci' });
		writeFileSync(lockMarker, `${lockSha}\n`, 'utf8');
	}
	await run(options.nodeBin, [path.join(repo, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build'], {
		cwd: repo,
		phase: 'Astro build',
	});
	await run(options.nodeBin, [path.join(repo, 'scripts', 'ensure-sitemap-xml.mjs')], {
		cwd: repo,
		phase: 'Sitemap check',
	});

	const distRoot = path.join(repo, 'dist');
	const routeToDistPath = (route) => {
		if (route === '/') return 'index.html';
		const trimmed = route.replace(/^\/+|\/+$/g, '');
		return route.endsWith('/') ? `${trimmed}/index.html` : trimmed;
	};
	try {
		for (const route of articleRoutes) {
			if (!existsSync(path.join(distRoot, ...routeToDistPath(route).split('/')))) {
				throw new Error(`Built route is missing: ${route}`);
			}
		}
	} finally {
		if (options.dryRun) {
			// Leave no trace: restore the dedicated clone to origin/main.
			git(repo, ['reset', '--hard', 'origin/main']);
			git(repo, ['clean', '-fd', '--', ...writes.map((w) => w.repoPath), ...deletes]);
		}
	}

	if (options.dryRun) {
		console.log(JSON.stringify({ mode: 'web-admin', dryRun: true, routes: articleRoutes }, null, 2));
		return;
	}

	git(repo, ['add', '-A', '--', ...writes.map((w) => w.repoPath), ...deletes]);
	git(repo, ['commit', '-m', options.message]);
	git(repo, ['push', 'origin', 'main']);
	const revision = git(repo, ['rev-parse', 'HEAD']);
	const headShort = revision.slice(0, 7);

	const releaseId = buildReleaseId(new Date(), headShort);
	const releaseDir = path.join(RELEASES_ROOT, releaseId);
	const siteDir = path.join(releaseDir, 'site');
	mkdirSync(siteDir, { recursive: true });
	execFileSync('cp', ['-a', `${distRoot}/.`, siteDir], { stdio: 'inherit' });
	const tree = treeManifest(siteDir);
	const manifest = {
		releaseId,
		scope: 'web-admin-content',
		source: 'web-admin',
		revision,
		builtAtUtc: new Date().toISOString(),
		affectedRoutes: articleRoutes,
		frontend: { fileCount: tree.fileCount, totalBytes: tree.totalBytes, indexSha256: tree.indexSha256, treeSha256: tree.treeSha256 },
	};
	writeFileSync(path.join(releaseDir, `release-manifest-${releaseId}.json`), JSON.stringify(manifest, null, 2), 'utf8');

	// Atomic switch with the same double-mv semantics as deploy-frontend.sh.
	const liveNew = `${LIVE_ROOT}.new-${releaseId}`;
	const backup = `${LIVE_ROOT}.backup-${releaseId}`;
	execFileSync('cp', ['-a', siteDir, liveNew], { stdio: 'inherit' });
	if (typeof process.getuid === 'function' && process.getuid() === 0) {
		execFileSync('chown', ['-R', 'www-data:www-data', liveNew], { stdio: 'inherit' });
		execFileSync('bash', ['-c', `find "$1" -type d -exec chmod 755 {} + && find "$1" -type f -exec chmod 644 {} +`, 'bash', liveNew], { stdio: 'inherit' });
	}
	const previousRelease = execFileSync('bash', ['-c', `basename "$(readlink -f ${RELEASES_ROOT}/current)"`], { encoding: 'utf8' }).trim();

	let switched = false;
	try {
		renameSync(LIVE_ROOT, backup);
		switched = true;
		renameSync(liveNew, LIVE_ROOT);
	} catch (error) {
		if (switched) renameSync(backup, LIVE_ROOT);
		rmSync(liveNew, { recursive: true, force: true });
		throw error;
	}

	const verified = [];
	try {
		for (const route of articleRoutes) {
			const check = spawnSync('curl', ['--fail', '--silent', '--show-error', '--output', '/dev/null', '--max-time', '10', `${SITE_ORIGIN}${route}`]);
			if (check.status !== 0) throw new Error(`Public route check failed: ${route}`);
			verified.push(route);
		}
	} catch (error) {
		// Roll back: restore the backup tree and symlinks, keep the release dir for forensics.
		renameSync(LIVE_ROOT, `${LIVE_ROOT}.failed-${releaseId}`);
		renameSync(backup, LIVE_ROOT);
		throw error;
	}

	execFileSync('ln', ['-sfn', releaseDir, path.join(RELEASES_ROOT, 'current')], { stdio: 'inherit' });
	if (/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(previousRelease)) {
		execFileSync('ln', ['-sfn', path.join(RELEASES_ROOT, previousRelease), path.join(RELEASES_ROOT, 'previous')], { stdio: 'inherit' });
	}
	rmSync(`${LIVE_ROOT}.failed-${releaseId}`, { recursive: true, force: true });

	console.log(JSON.stringify({
		mode: 'web-admin',
		releaseId,
		revision,
		backup,
		routes: verified,
		seconds: Math.round(((Date.now() - startedAt) / 1000) * 100) / 100,
	}, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	});
}
