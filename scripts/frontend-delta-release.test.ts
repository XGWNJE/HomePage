import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { collectTreeManifest, diffTreeManifests } from './content-delta.mjs';

function bashQuote(value: string) {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function runBash(script: string) {
	const result = process.platform === 'win32'
		? spawnSync('wsl.exe', ['bash', '-lc', script], { encoding: 'utf8' })
		: spawnSync('bash', ['-lc', script], { encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`Bash failed (${result.status}): ${result.stderr || result.stdout}`);
	}
	return result.stdout;
}

function toBashPath(value: string) {
	if (process.platform !== 'win32') return value;
	const result = spawnSync('wsl.exe', ['wslpath', '-a', value.replaceAll('\\', '/')], { encoding: 'utf8' });
	if (result.status !== 0) throw new Error(`wslpath failed: ${result.stderr}`);
	return result.stdout.trim();
}

async function write(root: string, relative: string, contents: string) {
	const target = path.join(root, ...relative.split('/'));
	await mkdir(path.dirname(target), { recursive: true });
	await writeFile(target, contents, 'utf8');
}

async function sha256(filePath: string) {
	return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

test('delta frontend helper reconstructs, activates, and rolls back an immutable release', { timeout: 30_000 }, async () => {
	await mkdir(path.resolve('output'), { recursive: true });
	const root = await mkdtemp(path.resolve('output', 'frontend-delta-test-'));
	try {
		const previousTree = path.join(root, 'previous-tree');
		const currentTree = path.join(root, 'current-tree');
		await write(previousTree, 'index.html', 'old home');
		await write(previousTree, 'assets/site.css', 'stable');
		await write(previousTree, 'blog/post/index.html', 'old post');
		await write(previousTree, 'remove.txt', 'remove me');
		await write(currentTree, 'index.html', 'new home');
		await write(currentTree, 'assets/site.css', 'stable');
		await write(currentTree, 'blog/post/index.html', 'new post');
		await write(currentTree, 'new.txt', 'new file');
		await write(currentTree, 'tags/human ai/index.html', 'tag page');

		const previous = await collectTreeManifest(previousTree);
		const current = await collectTreeManifest(currentTree);
		const delta = diffTreeManifests(previous, current);
		const releases = path.join(root, 'releases');
		const previousRelease = path.join(releases, 'old-release');
		const staging = path.join(root, 'staging', 'homepage-release-new-release');
		const live = path.join(root, 'live');
		await mkdir(previousRelease, { recursive: true });
		await cp(previousTree, path.join(previousRelease, 'site'), { recursive: true });
		await cp(previousTree, live, { recursive: true });
		await mkdir(staging, { recursive: true });
		const changedList = path.join(staging, 'CHANGED_FILES');
		const deletedList = path.join(staging, 'DELETED_FILES');
		await writeFile(changedList, `${delta.changedPaths.join('\n')}\n`, 'utf8');
		await writeFile(deletedList, `${delta.deletedPaths.join('\n')}\n`, 'utf8');
		await writeFile(path.join(staging, 'release-manifest-new-release.json'), '{}', 'utf8');
		await cp(
			path.resolve('.agents/skills/deploy-homepage/scripts/deploy-frontend.sh'),
			path.join(staging, 'deploy-frontend.sh'),
		);

		const deltaArchive = path.join(staging, 'homepage-frontend-delta-new-release.tar.gz');
		runBash([
			`tar -czf ${bashQuote(toBashPath(deltaArchive))}`,
			`-C ${bashQuote(toBashPath(currentTree))}`,
			...delta.changedPaths.map(bashQuote),
		].join(' '));
		const sumsFiles = [
			deltaArchive,
			path.join(staging, 'release-manifest-new-release.json'),
			changedList,
			deletedList,
			path.join(staging, 'deploy-frontend.sh'),
		];
		const sums = await Promise.all(sumsFiles.map(async (file) => `${await sha256(file)}  ${path.basename(file)}`));
		await writeFile(path.join(staging, 'SHA256SUMS'), `${sums.join('\n')}\n`, 'utf8');

		const helper = toBashPath(path.join(staging, 'deploy-frontend.sh'));
		const releaseArgs = [
			'new-release',
			await sha256(deltaArchive),
			String(current.fileCount),
			String(current.totalBytes),
			current.indexSha256,
			'old-release',
			current.treeSha256,
		].map(bashQuote).join(' ');
		const environment = [
			`HOMEPAGE_STAGING_ROOT=${bashQuote(toBashPath(path.join(root, 'staging')))}`,
			`HOMEPAGE_RELEASES_ROOT=${bashQuote(toBashPath(releases))}`,
			`HOMEPAGE_LIVE_DIR=${bashQuote(toBashPath(live))}`,
			`HOMEPAGE_NEW_PREFIX=${bashQuote(toBashPath(path.join(root, 'new')))}`,
			`HOMEPAGE_BACKUP_PREFIX=${bashQuote(toBashPath(path.join(root, 'backup')))}`,
			`HOMEPAGE_FAILED_PREFIX=${bashQuote(toBashPath(path.join(root, 'failed')))}`,
			`HOMEPAGE_FRONTEND_LOCK_FILE=${bashQuote(toBashPath(path.join(root, 'release.lock')))}`,
			`HOMEPAGE_RELEASE_OWNER=''`,
		].join(' ');

		runBash(`ln -s ${bashQuote('old-release')} ${bashQuote(toBashPath(path.join(releases, 'current')))}`);
		runBash(`${environment} bash ${bashQuote(helper)} prepare-delta ${releaseArgs}`);
		const installedHelper = toBashPath(path.join(releases, 'new-release', 'deploy-frontend.sh'));
		runBash(`ln -sfn ${bashQuote('competing-release')} ${bashQuote(toBashPath(path.join(releases, 'current')))}`);
		assert.throws(
			() => runBash(`${environment} bash ${bashQuote(installedHelper)} activate ${releaseArgs}`),
			/Bash failed/,
		);
		runBash(`ln -sfn ${bashQuote('old-release')} ${bashQuote(toBashPath(path.join(releases, 'current')))}`);
		runBash(`${environment} bash ${bashQuote(installedHelper)} activate ${releaseArgs}`);
		assert.equal(await readFile(path.join(live, 'index.html'), 'utf8'), 'new home');
		assert.equal(await readFile(path.join(live, 'assets', 'site.css'), 'utf8'), 'stable');
		assert.equal(await readFile(path.join(live, 'new.txt'), 'utf8'), 'new file');
		assert.equal(await readFile(path.join(live, 'tags', 'human ai', 'index.html'), 'utf8'), 'tag page');
		await assert.rejects(readFile(path.join(live, 'remove.txt')), /ENOENT/);
		await writeFile(path.join(live, 'index.html'), 'runtime mutation', 'utf8');
		assert.equal(
			await readFile(path.join(releases, 'new-release', 'site', 'index.html'), 'utf8'),
			'new home',
		);

		runBash(`${environment} bash ${bashQuote(installedHelper)} rollback ${releaseArgs}`);
		assert.equal(await readFile(path.join(live, 'index.html'), 'utf8'), 'old home');
		assert.equal(await readFile(path.join(live, 'remove.txt'), 'utf8'), 'remove me');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
