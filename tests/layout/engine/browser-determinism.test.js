import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { chromium, webkit } from '@playwright/test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BROWSER_SENSITIVE_SMILES = 'COc1cc([C@H](CC=C(C)C)OC(=O)c2ccccn2)c(OC)c3\\C(=N\\O)\\C=C\\C(=N/O)\\c13';
const BROWSER_ATTACHED_RING_RESCUE_SMILES = 'CCCOC1=C(C)C=CC=C1N1C(=S)[N-]N=C1C1=CC=C(O)C=C1O';
const BROWSER_MIXED_ROOT_EXACT_EXIT_SMILES = 'COC1=CC(=CC(OC)=C1OC)C(F)(F)C(=O)N1CCCC[C@H]1C(=O)O[C@@H](CCCC1=CC=CC=C1)CCCC1=CN=CC=C1';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml']
]);

function respond(res, statusCode, body) {
  res.statusCode = statusCode;
  res.end(body);
}

async function resolveRequestPath(urlPathname) {
  const relativePath = urlPathname === '/' ? 'index.html' : urlPathname.slice(1);
  const absolutePath = path.resolve(REPO_ROOT, relativePath);
  if (!absolutePath.startsWith(REPO_ROOT)) {
    return null;
  }

  const fileStats = await stat(absolutePath).catch(() => null);
  if (!fileStats) {
    return null;
  }
  if (fileStats.isDirectory()) {
    const directoryIndexPath = path.join(absolutePath, 'index.html');
    const indexStats = await stat(directoryIndexPath).catch(() => null);
    return indexStats?.isFile() ? directoryIndexPath : null;
  }
  return fileStats.isFile() ? absolutePath : null;
}

async function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
      const filePath = await resolveRequestPath(requestUrl.pathname);
      if (!filePath) {
        respond(res, 404, 'Not found');
        return;
      }
      const body = await readFile(filePath);
      const contentType = MIME_TYPES.get(path.extname(filePath)) ?? 'application/octet-stream';
      res.statusCode = 200;
      res.setHeader('Content-Type', contentType);
      res.end(body);
    } catch (error) {
      respond(res, 500, String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`
  };
}

async function browserLayoutSignature(browserType, origin, smiles) {
  const browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/index.html`, { timeout: 60_000 });
    return await page.evaluate(async smilesValue => {
      const { parseSMILES } = await import('/src/io/smiles.js');
      const { runPipeline } = await import('/src/layout/engine/pipeline.js');

      const molecule = parseSMILES(smilesValue);
      const pipeline = runPipeline(molecule, { suppressH: true });
      const heavyAtomIds = [...molecule.atoms.keys()]
        .filter(atomId => molecule.atoms.get(atomId)?.name !== 'H')
        .sort((firstAtomId, secondAtomId) => firstAtomId.localeCompare(secondAtomId, 'en', { numeric: true }));
      const coordSignature = heavyAtomIds.map(atomId => {
        const position = pipeline.coords.get(atomId);
        return `${atomId}:${Math.round(position.x * 1e6)}:${Math.round(position.y * 1e6)}`;
      }).join('|');
      const stereoSignature = [...(pipeline.metadata?.stereo?.assignments ?? [])]
        .sort((firstAssignment, secondAssignment) => (
          firstAssignment.centerId.localeCompare(secondAssignment.centerId, 'en', { numeric: true })
          || firstAssignment.bondId.localeCompare(secondAssignment.bondId, 'en', { numeric: true })
          || firstAssignment.type.localeCompare(secondAssignment.type, 'en', { numeric: true })
        ))
        .map(assignment => `${assignment.centerId}:${assignment.bondId}:${assignment.type}`)
        .join('|');
      return {
        coordSignature,
        stereoSignature,
        audit: {
          ok: pipeline.metadata?.audit?.ok ?? null,
          severeOverlapCount: pipeline.metadata?.audit?.severeOverlapCount ?? null,
          ringSubstituentReadabilityFailureCount: pipeline.metadata?.audit?.ringSubstituentReadabilityFailureCount ?? null,
          outwardAxisRingSubstituentFailureCount: pipeline.metadata?.audit?.outwardAxisRingSubstituentFailureCount ?? null
        }
      };
    }, smiles);
  } finally {
    await browser.close();
  }
}

test('browser layout remains deterministic across chromium and webkit for mixed fused/attached-ring placement', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_SENSITIVE_SMILES);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_SENSITIVE_SMILES);

  assert.deepStrictEqual(webkitSignature, chromiumSignature);
});

test('browser layout stays deterministic and overlap-free for the attached-ring overlap rescue', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_ATTACHED_RING_RESCUE_SMILES);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_ATTACHED_RING_RESCUE_SMILES);

  assert.deepStrictEqual(webkitSignature, chromiumSignature);
  assert.equal(chromiumSignature.audit.ok, true);
  assert.equal(chromiumSignature.audit.severeOverlapCount, 0);
  assert.equal(chromiumSignature.audit.ringSubstituentReadabilityFailureCount, 0);
  assert.equal(chromiumSignature.audit.outwardAxisRingSubstituentFailureCount, 0);
});

test('browser layout stays audit-clean for mixed-root exact ring exits on anisole-linked ring systems', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_MIXED_ROOT_EXACT_EXIT_SMILES);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_MIXED_ROOT_EXACT_EXIT_SMILES);

  assert.equal(webkitSignature.stereoSignature, chromiumSignature.stereoSignature);
  assert.deepStrictEqual(webkitSignature.audit, chromiumSignature.audit);
  assert.equal(chromiumSignature.audit.ok, true);
  assert.equal(chromiumSignature.audit.severeOverlapCount, 0);
  assert.equal(chromiumSignature.audit.ringSubstituentReadabilityFailureCount, 0);
  assert.equal(chromiumSignature.audit.outwardAxisRingSubstituentFailureCount, 0);
});
