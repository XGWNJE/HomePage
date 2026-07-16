import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileFromFile } from 'json-schema-to-typescript';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, '..');
export const schemaPath = resolve(repositoryRoot, 'schemas', 'human-agency-exchange.v1.schema.json');
export const targetPath = resolve(repositoryRoot, 'src', 'generated', 'human-agency-exchange.ts');

export async function generateHumanAgencyTypes(): Promise<string> {
  return compileFromFile(schemaPath, {
    cwd: dirname(schemaPath),
    bannerComment: '/* Generated from the versioned human-agency exchange JSON Schema. Do not edit directly. */',
    additionalProperties: false,
    unknownAny: true,
    style: { singleQuote: true, semi: true, useTabs: true, tabWidth: 2 },
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, await generateHumanAgencyTypes(), 'utf8');
}
