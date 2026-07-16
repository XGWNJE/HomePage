import { readFile } from 'node:fs/promises';

import { generateHumanAgencyTypes, targetPath } from './generate-human-agency-types.js';

const expected = await generateHumanAgencyTypes();
let actual = '';
try {
  actual = await readFile(targetPath, 'utf8');
} catch {
  throw new Error('Generated human-agency types are missing. Run npm run human-agency:typegen.');
}

if (actual !== expected) {
  throw new Error('Generated human-agency types are stale. Run npm run human-agency:typegen.');
}
