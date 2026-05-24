import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateChangelog } from '../src/utils/changelog-generator.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const outPath = join(__dirname, '..', 'CHANGELOG.md');

const content = generateChangelog();
writeFileSync(outPath, content, 'utf-8');
console.log(`CHANGELOG.md written (${content.length} bytes)`);
