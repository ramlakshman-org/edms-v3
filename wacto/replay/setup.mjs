// Prepares the offline replay harness (see README.md). Safe to re-run.
//   node setup.mjs                      -> src/controllers/current.js = working-tree controller
//   node setup.mjs before=<git-ref> ... -> also src/controllers/before.js = controller at that commit
// Also links node_modules -> ../../backend/node_modules and copies the constants the controller imports.
// Everything it writes is git-ignored: the harness always tests the real controller, never a stale copy.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const BACKEND = join(REPO, 'backend');
const CTRL = 'backend/src/controllers/wactoWebhookController.js';

mkdirSync(join(HERE, 'src', 'controllers'), { recursive: true });
mkdirSync(join(HERE, 'src', 'constants'), { recursive: true });
mkdirSync(join(HERE, 'out'), { recursive: true });

if (!existsSync(join(HERE, 'node_modules'))) {
  if (!existsSync(join(BACKEND, 'node_modules'))) throw new Error('run npm install in backend/ first');
  symlinkSync(join(BACKEND, 'node_modules'), join(HERE, 'node_modules'), 'junction');
}
for (const f of readdirSync(join(BACKEND, 'src', 'constants')).filter((f) => f.endsWith('.js')))
  copyFileSync(join(BACKEND, 'src', 'constants', f), join(HERE, 'src', 'constants', f));
// Real payment services (the controller imports them); cloudinaryService stays a stub.
mkdirSync(join(HERE, 'src', 'services'), { recursive: true });
for (const f of ['paymentSettings.js', 'paymentProof.js', 'botContent.js'])
  copyFileSync(join(BACKEND, 'src', 'services', f), join(HERE, 'src', 'services', f));
copyFileSync(join(REPO, CTRL), join(HERE, 'src', 'controllers', 'current.js'));
console.log('current.js  <- working tree', CTRL);

for (const arg of process.argv.slice(2)) {
  const m = arg.match(/^([\w-]+)=(.+)$/);
  if (!m) throw new Error(`expected name=<git-ref>, got ${arg}`);
  const src = execFileSync('git', ['-C', REPO, 'show', `${m[2]}:${CTRL}`], { encoding: 'utf8' });
  writeFileSync(join(HERE, 'src', 'controllers', `${m[1]}.js`), src);
  console.log(`${m[1]}.js <- ${m[2]}:${CTRL}`);
}
