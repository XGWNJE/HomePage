import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import {
	readHumanAgencyPackage,
	verifyHumanAgencyPackage,
	type HumanAgencyEntry,
} from '../lib/humanAgencyContract.js';

export interface StoredHumanAgencyEntry {
	published_at: string;
	entry: HumanAgencyEntry;
}

export interface LoadedHumanAgencyEntry {
	publishedAt: string;
	entry: HumanAgencyEntry;
}

export interface LoadHumanAgencyOptions {
	previewPackage?: string;
	contentDirectory: string;
}

function parseStoredEntry(value: unknown, name: string): StoredHumanAgencyEntry {
	if (!value || typeof value !== 'object') throw new Error(`Invalid stored Journal article: ${name}.`);
	const record = value as Partial<StoredHumanAgencyEntry>;
	if (typeof record.published_at !== 'string' || Number.isNaN(Date.parse(record.published_at)) || !record.entry) {
		throw new Error(`Invalid stored Journal article metadata: ${name}.`);
	}
	return record as StoredHumanAgencyEntry;
}

export async function loadHumanAgencyEntries(options: LoadHumanAgencyOptions): Promise<LoadedHumanAgencyEntry[]> {
	if (options.previewPackage) {
		if (!isAbsolute(options.previewPackage)) {
			throw new Error('JOURNAL_PREVIEW_PACKAGE must be an absolute path to an explicitly approved package.');
		}
		const exchange = await readHumanAgencyPackage(
			options.previewPackage,
			new Set(['approved-preview', 'approved-publish']),
		);
		return exchange.entries.map((entry) => ({ entry, publishedAt: exchange.generated_at }));
	}

	let names: string[] = [];
	try {
		names = (await readdir(options.contentDirectory)).filter((name) => name.endsWith('.json')).sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	const entries: LoadedHumanAgencyEntry[] = [];
	for (const name of names) {
		const stored = parseStoredEntry(JSON.parse(await readFile(join(options.contentDirectory, name), 'utf8')), name);
		const entry = stored.entry;
		const fixturePackage = {
			schema_version: '1.0.0',
			package_version: 1,
			package_id: `production-${entry.id}`,
			approval_status: 'approved-publish',
			generated_at: stored.published_at,
			entries: [entry],
			content_hash: '',
		};
		const { content_hash: _ignored, ...unsigned } = fixturePackage;
		fixturePackage.content_hash = (await import('../lib/humanAgencyContract.js')).sha256(unsigned);
		await verifyHumanAgencyPackage(fixturePackage, new Set(['approved-publish']));
		entries.push({ entry, publishedAt: stored.published_at });
	}
	return entries;
}
