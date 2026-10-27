import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import { rollup } from 'rollup';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'molecules-consumer-'));
const npmCommand = process.env.npm_execpath ? process.execPath : 'npm';
const npmPrefix = process.env.npm_execpath ? [process.env.npm_execpath] : [];

try {
  const output = execFileSync(npmCommand, [...npmPrefix, 'pack', '--ignore-scripts', '--json', '--pack-destination', directory], { cwd: root, encoding: 'utf8' });
  const [archive] = JSON.parse(output);
  assert(
    archive.files.some(file => file.path === 'es/index.js'),
    'Build the package before running npm run test:package'
  );
  const project = join(directory, 'consumer');
  await mkdir(project);
  await writeFile(join(project, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync(npmCommand, [...npmPrefix, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, archive.filename)], { cwd: project, stdio: 'inherit' });
  await copyFile(new URL('../../tests/package/consumer.js', import.meta.url), join(project, 'consumer.js'));
  execFileSync(process.execPath, ['--test', 'consumer.js'], { cwd: project, stdio: 'inherit' });

  // A bundler must retain SMARTS registration even when only parseSMILES is used.
  const entry = join(project, 'bundle-entry.js');
  await writeFile(entry, "import { parseSMILES } from 'molecules';\nexport const matches = parseSMILES('CC(=O)O').matchesSMARTS('[CX3](=O)[OX2H1]');\n");
  const bundle = await rollup({
    input: entry,
    plugins: [nodeResolve()],
    onwarn(warning, warn) {
      if (warning.code === 'UNRESOLVED_IMPORT') {
        throw new Error(warning.message);
      }
      warn(warning);
    }
  });
  try {
    await bundle.write({ file: join(project, 'bundle.js'), format: 'es' });
  } finally {
    await bundle.close();
  }
  execFileSync(process.execPath, ['--input-type=module', '-e', "import assert from 'node:assert/strict'; import { matches } from './bundle.js'; assert.equal(matches, true);"], {
    cwd: project,
    stdio: 'inherit'
  });
  process.stdout.write('Tree-shaken package consumer passed.\n');
} finally {
  await rm(directory, { recursive: true, force: true });
}
