import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const copies = [
  ['src/main/bridge-server.js', 'out/main/bridge-server.js'],
  ['src/shared/youtube.js', 'out/shared/youtube.js'],
  ['src/shared/ai-plan.js', 'out/shared/ai-plan.js'],
];

for (const [from, to] of copies) {
  mkdirSync(dirname(join(root, to)), { recursive: true });
  copyFileSync(join(root, from), join(root, to));
}
