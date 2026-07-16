import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function compareUtf8(left, right) {
	return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export function assertSafeRelativePath(filePath) {
	const normalized = filePath.replaceAll('\\', '/');
	const segments = normalized.split('/');
	if (
		!normalized ||
		normalized.startsWith('/') ||
		/^[a-z]:/i.test(normalized) ||
		segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('-')) ||
		normalized.includes('\0') ||
		normalized.includes('\n') ||
		normalized.includes('\r') ||
		normalized.includes('\t')
	) {
		throw new Error(`Unsafe release path: ${filePath}`);
	}
	return normalized;
}

async function walk(root, directory = '') {
	const absolute = path.join(root, directory);
	const entries = await readdir(absolute, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const relative = assertSafeRelativePath(path.posix.join(directory.replaceAll('\\', '/'), entry.name));
		if (entry.isSymbolicLink()) throw new Error(`Release tree cannot contain a symbolic link: ${relative}`);
		if (entry.isDirectory()) files.push(...(await walk(root, relative)));
		else if (entry.isFile()) files.push(relative);
	}
	return files;
}

function calculateTreeHash(files) {
	const hash = createHash('sha256');
	for (const file of files) hash.update(`${file.sha256}\t${file.size}\t${file.path}\n`);
	return hash.digest('hex');
}

export async function collectTreeManifest(root) {
	const absoluteRoot = path.resolve(root);
	const relativePaths = (await walk(absoluteRoot)).sort(compareUtf8);
	const files = [];
	let totalBytes = 0;
	for (const relative of relativePaths) {
		const absolute = path.join(absoluteRoot, ...relative.split('/'));
		const info = await stat(absolute);
		const bytes = await readFile(absolute);
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		files.push({ path: relative, size: info.size, sha256 });
		totalBytes += info.size;
	}

	const index = files.find((file) => file.path === 'index.html');
	if (!index) throw new Error(`Release tree is missing index.html: ${absoluteRoot}`);

	return {
		version: 1,
		fileCount: files.length,
		totalBytes,
		indexSha256: index.sha256,
		treeSha256: calculateTreeHash(files),
		files,
	};
}

export function parseTreeTsv(source) {
	const files = source
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			const [sha256, sizeText, ...pathParts] = line.split('\t');
			const filePath = assertSafeRelativePath(pathParts.join('\t'));
			if (!/^[a-f0-9]{64}$/i.test(sha256 ?? '')) throw new Error(`Invalid SHA-256 for ${filePath}`);
			const size = Number(sizeText);
			if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid byte size for ${filePath}`);
			return { path: filePath, size, sha256: sha256.toLowerCase() };
		})
		.sort((left, right) => compareUtf8(left.path, right.path));
	return { version: 1, files };
}

export function diffTreeManifests(previous, current) {
	const previousFiles = new Map(previous.files.map((file) => [assertSafeRelativePath(file.path), file]));
	const currentFiles = new Map(current.files.map((file) => [assertSafeRelativePath(file.path), file]));
	const changedPaths = [];
	const deletedPaths = [];

	for (const [filePath, file] of currentFiles) {
		const old = previousFiles.get(filePath);
		if (!old || old.sha256 !== file.sha256 || old.size !== file.size) changedPaths.push(filePath);
	}
	for (const filePath of previousFiles.keys()) {
		if (!currentFiles.has(filePath)) deletedPaths.push(filePath);
	}

	changedPaths.sort(compareUtf8);
	deletedPaths.sort(compareUtf8);
	return { changedPaths, deletedPaths };
}

async function main() {
	const rootIndex = process.argv.indexOf('--root');
	const baselineIndex = process.argv.indexOf('--baseline');
	if (rootIndex < 0 || !process.argv[rootIndex + 1] || baselineIndex < 0 || !process.argv[baselineIndex + 1]) {
		throw new Error('Usage: node scripts/content-delta.mjs --root <dist> --baseline <tree.tsv>');
	}
	const [current, baselineSource] = await Promise.all([
		collectTreeManifest(process.argv[rootIndex + 1]),
		readFile(process.argv[baselineIndex + 1], 'utf8'),
	]);
	const previous = parseTreeTsv(baselineSource);
	process.stdout.write(JSON.stringify({ current, delta: diffTreeManifests(previous, current) }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	});
}
