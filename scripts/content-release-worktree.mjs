import { execFileSync } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { classifyContentReleasePaths } from './content-release-scope.mjs';

function runGit(repositoryRoot, args) {
	return execFileSync('git', ['-c', 'safe.directory=*', '-C', repositoryRoot, ...args], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim();
}

function requireRevision(revision, label) {
	if (!/^[a-f0-9]{40}$/i.test(revision)) {
		throw new Error(`${label} must be a full Git revision.`);
	}
}

function resolveWorktreeRoots(repositoryRoot, worktreeRoot) {
	const resolvedRepository = path.resolve(repositoryRoot);
	const resolvedWorktree = path.resolve(worktreeRoot);
	const repositoryPrefix = `${resolvedRepository}${path.sep}`;
	if (!resolvedWorktree.startsWith(repositoryPrefix)) {
		throw new Error('The isolated content worktree must stay inside the repository.');
	}
	return { resolvedRepository, resolvedWorktree };
}

export async function removeIsolatedContentWorktree({ repositoryRoot, worktreeRoot }) {
	const { resolvedRepository, resolvedWorktree } = resolveWorktreeRoots(repositoryRoot, worktreeRoot);

	try {
		runGit(resolvedRepository, ['worktree', 'remove', '--force', resolvedWorktree]);
	} catch {
		await rm(resolvedWorktree, { recursive: true, force: true });
		runGit(resolvedRepository, ['worktree', 'prune']);
	}
}

export async function prepareIsolatedContentWorktree({
	repositoryRoot,
	worktreeRoot,
	productionRevision,
	sourceRevision,
	contentPaths,
}) {
	const { resolvedRepository, resolvedWorktree } = resolveWorktreeRoots(repositoryRoot, worktreeRoot);
	requireRevision(productionRevision, 'Production revision');
	requireRevision(sourceRevision, 'Source revision');

	const scope = classifyContentReleasePaths(contentPaths);
	if (!scope.eligible) {
		throw new Error(`The isolated worktree accepts only Markdown articles and dedicated article assets: ${scope.rejectedPaths.join(', ')}`);
	}

	runGit(resolvedRepository, ['cat-file', '-e', `${productionRevision}^{commit}`]);
	runGit(resolvedRepository, ['cat-file', '-e', `${sourceRevision}^{commit}`]);
	await mkdir(path.dirname(resolvedWorktree), { recursive: true });
	await removeIsolatedContentWorktree({ repositoryRoot: resolvedRepository, worktreeRoot: resolvedWorktree });

	try {
		runGit(resolvedRepository, ['worktree', 'add', '--detach', resolvedWorktree, productionRevision]);
		runGit(resolvedWorktree, ['checkout', sourceRevision, '--', ...scope.paths]);
		for (const filePath of scope.paths) {
			await access(path.join(resolvedWorktree, filePath));
		}
	} catch (error) {
		await removeIsolatedContentWorktree({ repositoryRoot: resolvedRepository, worktreeRoot: resolvedWorktree });
		throw error;
	}

	return {
		worktreeRoot: resolvedWorktree,
		productionRevision,
		sourceRevision,
		contentPaths: scope.paths,
	};
}

function parseArguments(argv) {
	const [action, ...rest] = argv;
	const values = {};
	for (let index = 0; index < rest.length; index += 2) {
		const key = rest[index];
		const value = rest[index + 1];
		if (!key?.startsWith('--') || value === undefined) {
			throw new Error(`Invalid argument near ${key ?? '<end>'}.`);
		}
		values[key.slice(2)] = value;
	}
	return { action, values };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const { action, values } = parseArguments(process.argv.slice(2));
	const common = {
		repositoryRoot: values['repository-root'],
		worktreeRoot: values['worktree-root'],
	};
	if (action === 'prepare') {
		const pathsJson = process.env.CONTENT_RELEASE_WORKTREE_PATHS_JSON || values['paths-json'] || '[]';
		const result = await prepareIsolatedContentWorktree({
			...common,
			productionRevision: values['production-revision'],
			sourceRevision: values['source-revision'],
			contentPaths: JSON.parse(pathsJson),
		});
		process.stdout.write(JSON.stringify(result));
	} else if (action === 'remove') {
		await removeIsolatedContentWorktree(common);
	} else {
		throw new Error(`Unknown content worktree action: ${action ?? '<missing>'}`);
	}
}
