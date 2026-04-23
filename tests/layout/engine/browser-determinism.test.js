import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { chromium, webkit } from '@playwright/test';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BROWSER_SENSITIVE_SMILES = 'COc1cc([C@H](CC=C(C)C)OC(=O)c2ccccn2)c(OC)c3\\C(=N\\O)\\C=C\\C(=N/O)\\c13';

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
    await page.goto(`${origin}/index.html`);
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
        stereoSignature
      };
    }, smiles);
  } finally {
    await browser.close();
  }
}

test('browser layout remains deterministic across chromium and webkit for mixed fused/attached-ring placement', { timeout: 60_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_SENSITIVE_SMILES);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_SENSITIVE_SMILES);

  assert.deepStrictEqual(webkitSignature, chromiumSignature);
});
