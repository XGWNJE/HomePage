import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ErrorObject, ValidateFunction } from 'ajv/dist/2020.js';

import type {
	Entry,
	HumanAgencyExchangePackage,
} from '../generated/human-agency-exchange.js';

const require = createRequire(import.meta.url);
const Ajv2020 = (require('ajv/dist/2020') as typeof import('ajv/dist/2020.js')).default;
const addFormats = (require('ajv-formats') as typeof import('ajv-formats')).default;
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(currentDirectory, '..', '..', 'schemas', 'human-agency-exchange.v1.schema.json');

let validatorPromise: Promise<ValidateFunction> | undefined;

function normalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalize);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, normalize(child)]),
		);
	}
	return value;
}

export function canonicalJson(value: unknown): string {
	return JSON.stringify(normalize(value));
}

export function sha256(value: unknown): string {
	return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function formatErrors(errors: ErrorObject[]): string {
	return errors.map((error) => `${error.instancePath || '/'} ${error.message ?? error.keyword}`).join('; ');
}

async function getValidator(): Promise<ValidateFunction> {
	validatorPromise ??= (async () => {
		const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as object;
		const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
		addFormats(ajv);
		return ajv.compile(schema);
	})();
	return validatorPromise;
}

export async function verifyHumanAgencyPackage(
	value: unknown,
	allowedApproval: ReadonlySet<HumanAgencyExchangePackage['approval_status']> = new Set([
		'approved-preview',
		'approved-publish',
	]),
): Promise<HumanAgencyExchangePackage> {
	const validator = await getValidator();
	if (!validator(value)) throw new Error(`Invalid human-agency exchange package: ${formatErrors(validator.errors ?? [])}`);
	const exchange = value as HumanAgencyExchangePackage;
	if (!allowedApproval.has(exchange.approval_status)) {
		throw new Error(`Package approval ${exchange.approval_status} is not allowed in this operation.`);
	}
	for (const entry of exchange.entries) {
		const { entry_hash: expected, ...unsigned } = entry;
		if (sha256(unsigned) !== expected) throw new Error(`Entry hash mismatch for ${entry.id}.`);
	}
	const { content_hash: expected, ...unsigned } = exchange;
	if (sha256(unsigned) !== expected) throw new Error('Exchange package content hash mismatch.');
	return exchange;
}

export async function readHumanAgencyPackage(
	path: string,
	allowedApproval?: ReadonlySet<HumanAgencyExchangePackage['approval_status']>,
): Promise<HumanAgencyExchangePackage> {
	return verifyHumanAgencyPackage(JSON.parse(await readFile(path, 'utf8')) as unknown, allowedApproval);
}

export type { Entry as HumanAgencyEntry, HumanAgencyExchangePackage };
