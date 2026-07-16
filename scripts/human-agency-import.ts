import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

import {
	readHumanAgencyPackage,
	type HumanAgencyEntry,
} from '../src/lib/humanAgencyContract.js';
import type { StoredHumanAgencyEntry } from '../src/content/humanAgencyLoader.js';

export interface ImportPlanItem {
	slug: string;
	target: string;
	language: HumanAgencyEntry['language'];
	exists: boolean;
	currentHash: string | null;
	incomingHash: string;
	action: 'create' | 'replace' | 'collision';
}

export interface HumanAgencyImportPlan {
	packageId: string;
	approvalStatus: 'approved-publish';
	items: ImportPlanItem[];
	languageSummary: {
		chinese: number;
		english: number;
		chineseMayStandAlone: true;
	};
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
}

export async function planHumanAgencyImport(
	packagePath: string,
	contentDirectory: string,
	expectedOldHash?: string,
): Promise<{ plan: HumanAgencyImportPlan; entries: StoredHumanAgencyEntry[] }> {
	const exchange = await readHumanAgencyPackage(resolve(packagePath), new Set(['approved-publish']));
	const records: StoredHumanAgencyEntry[] = exchange.entries.map((entry) => ({
		published_at: exchange.generated_at,
		entry,
	}));
	const items: ImportPlanItem[] = [];
	for (const entry of exchange.entries) {
		const target = join(contentDirectory, `${entry.slug}.json`);
		const targetExists = await exists(target);
		let currentHash: string | null = null;
		if (targetExists) {
			const current = JSON.parse(await readFile(target, 'utf8')) as StoredHumanAgencyEntry;
			currentHash = current.entry.entry_hash;
		}
		const canReplace = targetExists && expectedOldHash !== undefined && currentHash === expectedOldHash;
		items.push({
			slug: entry.slug,
			target,
			language: entry.language,
			exists: targetExists,
			currentHash,
			incomingHash: entry.entry_hash,
			action: targetExists ? (canReplace ? 'replace' : 'collision') : 'create',
		});
	}
	return {
		plan: {
			packageId: exchange.package_id,
			approvalStatus: 'approved-publish',
			items,
			languageSummary: {
				chinese: exchange.entries.filter((entry) => entry.language === 'zh-CN').length,
				english: exchange.entries.filter((entry) => entry.language === 'en').length,
				chineseMayStandAlone: true,
			},
		},
		entries: records,
	};
}

async function atomicWriteEntry(path: string, entry: StoredHumanAgencyEntry): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
	await writeFile(temporary, `${JSON.stringify(entry, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
	await rename(temporary, path);
}

export async function applyHumanAgencyImport(
	packagePath: string,
	contentDirectory: string,
	expectedOldHash?: string,
): Promise<HumanAgencyImportPlan> {
	const { plan, entries } = await planHumanAgencyImport(packagePath, contentDirectory, expectedOldHash);
	const collisions = plan.items.filter((item) => item.action === 'collision');
	if (collisions.length > 0) {
		throw new Error(
			`Import collision: ${collisions.map((item) => item.slug).join(', ')}. Replacements require the exact --expected-old-hash.`,
		);
	}
	for (const record of entries) {
		await atomicWriteEntry(join(contentDirectory, `${record.entry.slug}.json`), record);
	}
	return plan;
}
