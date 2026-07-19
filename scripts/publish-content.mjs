// ContentOnly 内容快速发布通道。
//
// 设计：不再建立隔离 worktree。门禁改为"自生产 release 以来的全部变更必须只含
// 普通 Markdown 文章及其专用图片/附件"（git diff <productionRevision>..HEAD 通过
// classifyContentReleasePaths 判定），有代码变更即拒绝并提示走前端/完整发布。
// 构建直接在主工作区进行；服务器端机制（deploy-frontend.sh 版本化目录、
// prepare-delta/activate/rollback、flock、原子切换）完全不变。
//
// 用法：
//   node scripts/publish-content.mjs [--plan] [--benchmark]
//     [--server-infra-root <path>] [--project-root <path>]
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	classifyContentReleasePaths,
	findArticlesUsingRawHtml,
	findPublishedArticlesTurnedDraft,
	getContentReleaseRoutes,
	selectContentReleasePaths,
} from './content-release-scope.mjs';
import { findMissingLocalReleaseTargets } from './content-release-links.mjs';
import { collectTreeManifest, diffTreeManifests, parseTreeTsv } from './content-delta.mjs';

const REVISION_PATTERN = /^[a-f0-9]{40}$/i;
const RELEASE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

process.on('unhandledRejection', (reason) => {
	console.error(reason instanceof Error ? reason.message : String(reason));
	process.exit(1);
});
process.on('uncaughtException', (error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});

function parseArgs(argv) {
	const options = {
		plan: false,
		benchmark: false,
		serverInfraRoot: 'D:\\ObjectCode\\Server-infra',
		projectRoot: '',
	};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--plan') options.plan = true;
		else if (arg === '--benchmark') options.benchmark = true;
		else if (arg === '--server-infra-root') options.serverInfraRoot = argv[++index] ?? '';
		else if (arg === '--project-root') options.projectRoot = argv[++index] ?? '';
		else if (arg === '--help' || arg === '-h') {
			console.log('Usage: node scripts/publish-content.mjs [--plan] [--benchmark] [--server-infra-root <path>] [--project-root <path>]');
			process.exit(0);
		} else {
			throw new Error(`Unknown argument: ${arg}`);
		}
	}
	return options;
}

function readDotEnv(filePath) {
	const values = {};
	for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
		const match = line.match(/^([^#=]+)=(.*)$/);
		if (!match) continue;
		const key = match[1].trim();
		let value = match[2].trim();
		if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
			value = value.slice(1, -1);
		}
		values[key] = value;
	}
	return values;
}

function run(command, args, { cwd, input, echo = false, phase } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (chunk) => {
			stdout += chunk;
			if (echo) process.stdout.write(chunk);
		});
		child.stderr.on('data', (chunk) => {
			stderr += chunk;
			if (echo) process.stderr.write(chunk);
		});
		child.on('error', reject);
		child.on('close', (code) => {
			if (code !== 0) {
				const details = [stderr.trim(), stdout.trim()].filter(Boolean).join(' ');
				reject(new Error(`${phase ?? command} failed with exit code ${code}.${details ? ` ${details}` : ''}`));
				return;
			}
			resolve({ stdout, stderr });
		});
		if (input != null) {
			child.stdin.write(input.replaceAll('\r', ''));
			child.stdin.end();
		}
	});
}

function git(args, cwd) {
	return execFileSync('git', ['-c', 'safe.directory=*', '-C', cwd, ...args], {
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	}).trim();
}

function bashLiteral(value) {
	return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function sha256File(filePath) {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function routeToDistPath(route) {
	if (route === '/') return 'index.html';
	const trimmed = route.replace(/^\/+|\/+$/g, '');
	return route.endsWith('/') ? `${trimmed}/index.html` : trimmed;
}

const options = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(options.projectRoot || path.join(fileURLToPath(import.meta.url), '..', '..'));
const serverInfraRoot = path.resolve(options.serverInfraRoot);
const serverEnvPath = path.join(serverInfraRoot, 'server.local.env');
const maintainScript = path.join(serverInfraRoot, 'scripts', 'maintain.ps1');
const remoteHelper = path.join(projectRoot, '.agents', 'skills', 'deploy-homepage', 'scripts', 'deploy-frontend.sh');
const outputRoot = path.join(projectRoot, 'output', 'content-release');
const skipPublishGates = options.plan || options.benchmark;

for (const required of [serverEnvPath, maintainScript, remoteHelper]) {
	if (!existsSync(required)) throw new Error(`Required release file is missing: ${required}`);
}

const gitRoot = git(['rev-parse', '--show-toplevel'], projectRoot);
if (path.resolve(gitRoot) !== projectRoot) throw new Error(`Unexpected Git root: ${gitRoot}`);

const dirtyLines = git(['status', '--porcelain=v1'], projectRoot).split('\n').filter((line) => line.length >= 4);
if (dirtyLines.length > 0) {
	const dirtyPaths = dirtyLines.map((line) => line.slice(3).split(' -> ').pop());
	throw new Error(`Content publishing requires a clean worktree. Commit the article and its images first. Dirty paths: ${dirtyPaths.join(', ')}`);
}

const branch = git(['branch', '--show-current'], projectRoot);
const head = git(['rev-parse', 'HEAD'], projectRoot);
const headShort = git(['rev-parse', '--short=7', 'HEAD'], projectRoot);
if (!skipPublishGates && branch !== 'main') {
	throw new Error(`Content publishing requires the main branch. Current branch: ${branch}`);
}
if (!skipPublishGates) {
	let upstream = '';
	try {
		upstream = git(['rev-parse', '@{u}'], projectRoot);
	} catch {
		upstream = '';
	}
	if (upstream !== head) {
		throw new Error(`Push the committed article before publishing. Local HEAD: ${head}; tracked upstream: ${upstream}`);
	}
}

const server = readDotEnv(serverEnvPath);
const requiredKeys = ['VPS_IP', 'SSH_USER', 'SSH_PORT', 'SSH_KEY_PATH'];
const missingKeys = requiredKeys.filter((key) => !server[key]?.trim());
if (missingKeys.length > 0) throw new Error(`Server inventory is missing required keys: ${missingKeys.join(', ')}`);
if (!existsSync(server.SSH_KEY_PATH)) throw new Error('Configured SSH key does not exist.');

const sshTarget = `${server.SSH_USER}@${server.VPS_IP}`;
const sshArgs = [
	'-o', 'BatchMode=yes',
	'-o', 'ConnectTimeout=10',
	'-o', 'StrictHostKeyChecking=yes',
	'-p', server.SSH_PORT,
	'-i', server.SSH_KEY_PATH,
];
const scpArgs = [
	'-q',
	'-o', 'BatchMode=yes',
	'-o', 'ConnectTimeout=10',
	'-o', 'StrictHostKeyChecking=yes',
	'-P', server.SSH_PORT,
	'-i', server.SSH_KEY_PATH,
];

const snapshotCommand = `set -eu
available_kb="$(df -Pk /var/www | awk 'NR == 2 {print $4}')"
test "$available_kb" -ge 262144
release_id="$(basename "$(readlink -f /var/www/xgwnje-home.releases/current)")"
manifest="$(find "/var/www/xgwnje-home.releases/\${release_id}" -maxdepth 1 -type f -name 'release-manifest-*.json' | head -n 1)"
site="/var/www/xgwnje-home.releases/\${release_id}/site"
test -n "$manifest"
test -d "$site"
cat "$manifest"
printf '\\n__TREE_TSV__\\n'
cd "$site"
find . -type f -printf '%P\\n' | LC_ALL=C sort | while IFS= read -r relative; do
    printf '%s\\t%s\\t%s\\n' "$(sha256sum "$relative" | awk '{print $1}')" "$(stat -c '%s' "$relative")" "$relative"
done
`;

const stopwatchStart = Date.now();
const elapsedSeconds = () => (Date.now() - stopwatchStart) / 1000;
const snapshotResult = await run('ssh.exe', [...sshArgs, sshTarget, 'bash', '-s'], {
	input: snapshotCommand,
	phase: 'Production snapshot',
});

const snapshotParts = snapshotResult.stdout.split(/^__TREE_TSV__\r?$/m);
if (snapshotParts.length !== 2) throw new Error('Unable to parse the production release snapshot.');
const production = JSON.parse(snapshotParts[0].trim());
const productionRevision = String(production.revision ?? '');
const previousRelease = String(production.releaseId ?? '');
const previousContentRevision = REVISION_PATTERN.test(String(production.contentSourceRevision ?? ''))
	? String(production.contentSourceRevision)
	: productionRevision;
if (!REVISION_PATTERN.test(productionRevision)) throw new Error('Production manifest contains an invalid Git revision.');
if (!RELEASE_ID_PATTERN.test(previousRelease)) throw new Error('Production manifest contains an invalid release ID.');

for (const revision of [productionRevision, previousContentRevision]) {
	try {
		git(['cat-file', '-e', `${revision}^{commit}`], projectRoot);
	} catch {
		throw new Error(`Required content release revision is not available locally: ${revision}`);
	}
}

const releaseRepositoryPaths = git(['diff', '--name-only', `${previousContentRevision}..HEAD`], projectRoot).split('\n').filter(Boolean);
const productionDiffPaths = git(['diff', '--name-only', `${productionRevision}..HEAD`], projectRoot).split('\n').filter(Boolean);
const scope = selectContentReleasePaths(releaseRepositoryPaths);
const productionScope = classifyContentReleasePaths(productionDiffPaths);

if (!scope.eligible) {
	throw new Error('Fast content release found no new ordinary Markdown article changes.');
}
if (!productionScope.eligible) {
	throw new Error(
		`ContentOnly requires every change since the production release to be articles or their dedicated assets; use a frontend or full release for: ${productionScope.rejectedPaths.join(', ')}`,
	);
}
const rawHtmlArticles = findArticlesUsingRawHtml(productionScope.contentFiles, projectRoot);
if (rawHtmlArticles.length > 0) {
	throw new Error(`ContentOnly accepts native Markdown only; raw HTML requires a frontend release: ${rawHtmlArticles.join(', ')}`);
}
const deletedContent = productionScope.paths.filter((filePath) => !existsSync(path.join(projectRoot, filePath)));
if (deletedContent.length > 0) {
	throw new Error(`Article or attachment deletion is not supported by the daily fast lane: ${deletedContent.join(', ')}`);
}
const draftComparisons = [];
for (const filePath of scope.contentFiles) {
	const previous = spawnSyncSafe(['show', `${previousContentRevision}:${filePath}`]);
	if (previous == null) continue;
	draftComparisons.push({
		path: filePath,
		previousSource: previous,
		currentSource: readFileSync(path.resolve(projectRoot, filePath), 'utf8'),
	});
}
const publishedToDraft = findPublishedArticlesTurnedDraft(draftComparisons);
if (publishedToDraft.length > 0) {
	throw new Error(`The daily fast lane cannot turn a published article back into a draft: ${publishedToDraft.join(', ')}`);
}
const routes = getContentReleaseRoutes(scope.contentFiles, projectRoot);
const articleRoutes = routes.filter((route) => /^\/blog\/.+\/$/.test(route));
if (articleRoutes.length === 0) throw new Error('Fast content release requires at least one non-draft article.');
for (const asset of scope.assetFiles) {
	const assetPath = path.join(projectRoot, asset);
	if (!existsSync(assetPath)) continue;
	const assetBytes = statSync(assetPath).size;
	const assetLimit = scope.attachmentFiles.includes(asset) ? 10 * 1024 * 1024 : 1024 * 1024;
	if (assetBytes > assetLimit) throw new Error(`Blog asset exceeds its fast-lane size limit: ${asset}`);
}

function spawnSyncSafe(args) {
	try {
		return execFileSync('git', ['-c', 'safe.directory=*', '-C', projectRoot, ...args], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		});
	} catch {
		return null;
	}
}

if (options.plan) {
	console.log(JSON.stringify({
		mode: 'ContentOnlyDelta',
		planOnly: true,
		productionRelease: previousRelease,
		productionRevision,
		previousContentSourceRevision: previousContentRevision,
		contentSourceRevision: head,
		changedPaths: scope.paths,
		contentOverlayPaths: productionScope.paths,
		ignoredRepositoryPaths: scope.ignoredPaths,
		articleRoutes,
		skipped: ['full test suite', 'API tests', 'browser QA', 'full dist upload'],
	}, null, 2));
	process.exit(0);
}

const releaseId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-content-${headShort}`;
const artifactDir = path.join(outputRoot, releaseId);

await run(process.execPath, [path.join(projectRoot, 'scripts', 'check-language-pairs.mjs')], {
	cwd: projectRoot,
	echo: true,
	phase: 'Language pair check',
});
await run(process.execPath, [path.join(projectRoot, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build'], {
	cwd: projectRoot,
	echo: true,
	phase: 'Astro build',
});
await run(process.execPath, [path.join(projectRoot, 'scripts', 'ensure-sitemap-xml.mjs')], {
	cwd: projectRoot,
	echo: true,
	phase: 'Sitemap check',
});

const distRoot = path.join(projectRoot, 'dist');
for (const route of articleRoutes) {
	const relative = routeToDistPath(decodeURIComponent(route));
	if (!existsSync(path.join(distRoot, ...relative.split('/')))) {
		throw new Error(`Built article route is missing: ${route} (${relative})`);
	}
}
const missingLinks = await findMissingLocalReleaseTargets({ distRoot, routes: articleRoutes });
if (missingLinks.length > 0) {
	throw new Error(`Built article contains missing local links or assets: ${missingLinks.map((entry) => `${entry.route} -> ${entry.target}`).join(', ')}`);
}

mkdirSync(artifactDir, { recursive: true });
const baselinePath = path.join(artifactDir, 'BASELINE_TREE.tsv');
writeFileSync(baselinePath, snapshotParts[1].replace(/^[\r\n]+/, ''), 'utf8');
const current = await collectTreeManifest(distRoot);
const previous = parseTreeTsv(snapshotParts[1]);
const delta = diffTreeManifests(previous, current);
const changedOutputPaths = delta.changedPaths;
const deletedOutputPaths = delta.deletedPaths;
if (changedOutputPaths.length === 0 && deletedOutputPaths.length === 0) {
	throw new Error('The build produced no public file changes.');
}

const changedListPath = path.join(artifactDir, 'CHANGED_FILES');
const deletedListPath = path.join(artifactDir, 'DELETED_FILES');
writeFileSync(changedListPath, `${changedOutputPaths.join('\n')}\n`, 'utf8');
writeFileSync(deletedListPath, deletedOutputPaths.length > 0 ? `${deletedOutputPaths.join('\n')}\n` : '', 'utf8');

const deltaArchiveName = `homepage-frontend-delta-${releaseId}.tar.gz`;
const manifestName = `release-manifest-${releaseId}.json`;
const bundleName = `homepage-content-bundle-${releaseId}.tar.gz`;
const deltaArchivePath = path.join(artifactDir, deltaArchiveName);
const manifestPath = path.join(artifactDir, manifestName);
const sumsPath = path.join(artifactDir, 'SHA256SUMS');
const helperArtifactPath = path.join(artifactDir, 'deploy-frontend.sh');
copyFileSync(remoteHelper, helperArtifactPath);
await run('tar.exe', ['--force-local', '-czf', deltaArchivePath, '-C', distRoot, '-T', changedListPath], { phase: 'Delta archive' });

const deltaArchiveSha = sha256File(deltaArchivePath);
const manifest = {
	releaseId,
	scope: 'content-only-delta',
	revision: productionRevision,
	productionBaseRevision: productionRevision,
	previousContentSourceRevision: previousContentRevision,
	contentSourceRevision: head,
	branch,
	gitStatus: 'clean',
	builtAtUtc: new Date().toISOString(),
	changedPaths: scope.paths,
	contentOverlayPaths: productionScope.paths,
	ignoredRepositoryPaths: scope.ignoredPaths,
	affectedRoutes: articleRoutes,
	publishPolicy: {
		format: 'plain-markdown',
		isolatedProductionBuild: false,
		productionDiffContentOnly: true,
		browserQa: false,
		apiTests: false,
		fullDistUpload: false,
	},
	frontend: {
		archive: deltaArchiveName,
		sha256: deltaArchiveSha,
		changedFileCount: changedOutputPaths.length,
		deletedFileCount: deletedOutputPaths.length,
		changedBytes: statSync(deltaArchivePath).size,
		fileCount: current.fileCount,
		totalBytes: current.totalBytes,
		indexSha256: current.indexSha256,
		treeSha256: current.treeSha256,
	},
	backend: {
		deployed: false,
		currentRevision: String(production.backend?.currentRevision ?? ''),
	},
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
const sumLines = [deltaArchivePath, manifestPath, changedListPath, deletedListPath, helperArtifactPath]
	.map((filePath) => `${sha256File(filePath)}  ${path.basename(filePath)}`);
writeFileSync(sumsPath, `${sumLines.join('\n')}\n`, 'utf8');

const bundlePath = path.join(artifactDir, bundleName);
await run('tar.exe', [
	'--force-local',
	'-czf', bundlePath,
	'-C', artifactDir,
	deltaArchiveName,
	manifestName,
	'SHA256SUMS',
	'CHANGED_FILES',
	'DELETED_FILES',
	'deploy-frontend.sh',
], { phase: 'Content bundle' });
const bundleSha = sha256File(bundlePath);
const buildAndBundleSeconds = elapsedSeconds();

if (options.benchmark) {
	console.log(JSON.stringify({
		mode: 'ContentOnlyDelta',
		benchmarkOnly: true,
		releaseId,
		buildAndBundleSeconds: Math.round(buildAndBundleSeconds * 100) / 100,
		changedOutputFiles: changedOutputPaths.length,
		deletedOutputFiles: deletedOutputPaths.length,
		bundleBytes: statSync(bundlePath).size,
		fullDistBytes: current.totalBytes,
	}, null, 2));
	process.exit(0);
}

const quotedArgs = [
	releaseId,
	deltaArchiveSha,
	String(current.fileCount),
	String(current.totalBytes),
	String(current.indexSha256),
	previousRelease,
	String(current.treeSha256),
].map(bashLiteral);
const remoteArticleChecks = articleRoutes
	.map((route) => `test -f /var/www/xgwnje-home/${bashLiteral(routeToDistPath(decodeURIComponent(route)))}`)
	.join('\n');
const remotePublicChecks = articleRoutes
	.map((route) => `curl --fail --silent --show-error --output /dev/null --max-time 10 ${bashLiteral(`https://xgwnje.cn${route}`)}`)
	.join('\n');
const remoteBundlePath = `/tmp/${bundleName}`;
const remoteCommand = `set -Eeuo pipefail
staging=/tmp/homepage-release-${releaseId}
release_dir=/var/www/xgwnje-home.releases/${releaseId}
bundle=\$staging/${bundleName}
mkdir -p "\$staging"
uploaded_bundle=${bashLiteral(remoteBundlePath)}
test "\$(sha256sum "\$uploaded_bundle" | awk '{print \$1}')" = '${bundleSha}'
mv "\$uploaded_bundle" "\$bundle"
tar -xzf "\$bundle" -C "\$staging"
exec 9>/tmp/xgwnje-home-frontend-release.lock
flock -n 9 || { printf 'Another frontend release is active.\\n' >&2; exit 75; }
export HOMEPAGE_FRONTEND_LOCK_HELD=1
test "\$(basename "\$(readlink -f /var/www/xgwnje-home.releases/current)")" = ${bashLiteral(previousRelease)}
activated=0
rollback_on_error() {
    status=\$?
    if test "\$activated" = 1 && test -x "\$release_dir/deploy-frontend.sh"; then
        bash "\$release_dir/deploy-frontend.sh" rollback ${quotedArgs.join(' ')} || true
    fi
    rm -rf "\$staging" "\$uploaded_bundle"
    exit "\$status"
}
trap rollback_on_error ERR
bash "\$staging/deploy-frontend.sh" prepare-delta ${quotedArgs.join(' ')}
bash "\$staging/deploy-frontend.sh" activate ${quotedArgs.join(' ')}
activated=1
${remoteArticleChecks}
${remotePublicChecks}
rm -rf "\$staging"
trap - ERR
printf 'CONTENT_ACTIVE release=%s previous=%s\\n' '${releaseId}' '${previousRelease}'
`;

const uploadStarted = elapsedSeconds();
await run('scp.exe', [...scpArgs, bundlePath, `${sshTarget}:${remoteBundlePath}`], { phase: 'Bundle upload' });
const uploadSeconds = elapsedSeconds() - uploadStarted;
const activateStarted = elapsedSeconds();
const remoteResult = await run('ssh.exe', [...sshArgs, sshTarget, 'bash', '-s'], {
	input: remoteCommand,
	phase: 'Remote content activation',
});
const activateSeconds = elapsedSeconds() - activateStarted;
if (remoteResult.stdout.trim()) console.log(remoteResult.stdout.trim());

const rollbackCommand = `bash /var/www/xgwnje-home.releases/${releaseId}/deploy-frontend.sh rollback ${quotedArgs.join(' ')}`;
const publishedSeconds = elapsedSeconds();
const invokeAfterChange = () => run('powershell.exe', [
	'-NoProfile',
	'-ExecutionPolicy', 'Bypass',
	'-File', maintainScript,
	'-Mode', 'AfterChange',
	'-Scope', 'homepage',
], { echo: true, phase: 'AfterChange' });

let afterChangeSeconds = 0;
try {
	const afterChangeStarted = elapsedSeconds();
	await invokeAfterChange();
	afterChangeSeconds = elapsedSeconds() - afterChangeStarted;
} catch (verificationFailure) {
	try {
		const rollbackResult = await run('ssh.exe', [...sshArgs, sshTarget, 'bash', '-s'], {
			input: rollbackCommand,
			phase: 'Content rollback',
		});
		if (rollbackResult.stdout.trim()) console.log(rollbackResult.stdout.trim());
		await invokeAfterChange();
	} catch (rollbackFailure) {
		throw new Error(`Post-release verification failed and rollback also failed. Verification: ${verificationFailure.message} Rollback: ${rollbackFailure.message}`);
	}
	throw verificationFailure;
}

console.log(JSON.stringify({
	mode: 'ContentOnlyDelta',
	releaseId,
	revision: productionRevision,
	previousContentSourceRevision: previousContentRevision,
	contentSourceRevision: head,
	previousRelease,
	publishedSeconds: Math.round(publishedSeconds * 100) / 100,
	totalSeconds: Math.round(elapsedSeconds() * 100) / 100,
	buildAndBundleSeconds: Math.round(buildAndBundleSeconds * 100) / 100,
	uploadSeconds: Math.round(uploadSeconds * 100) / 100,
	activateSeconds: Math.round(activateSeconds * 100) / 100,
	afterChangeSeconds: Math.round(afterChangeSeconds * 100) / 100,
	changedOutputFiles: changedOutputPaths.length,
	deletedOutputFiles: deletedOutputPaths.length,
	bundleBytes: statSync(bundlePath).size,
	fullDistBytes: current.totalBytes,
	deltaArchiveSha256: deltaArchiveSha,
	bundleSha256: bundleSha,
	manifestSha256: sha256File(manifestPath),
	treeSha256: current.treeSha256,
	backup: `/var/www/xgwnje-home.backup-${releaseId}`,
	rollback: rollbackCommand,
	verifiedRoutes: articleRoutes,
	skipped: ['full test suite', 'API tests', 'browser QA', 'full dist upload'],
}, null, 2));
