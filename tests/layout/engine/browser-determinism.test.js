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
const BROWSER_FUSED_CYCLOBUTYL_METHYLENE_SMILES = 'FC1=CC=CC(CC2C(CC3=CC=C(CC4(CCC4)NS(=O)=O)C=C23)[NH+]2CCC2)=C1';

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
      const angularDifference = (firstAngle, secondAngle) => {
        let difference = Math.abs(firstAngle - secondAngle) % (Math.PI * 2);
        if (difference > Math.PI) {
          difference = Math.PI * 2 - difference;
        }
        return difference;
      };
      const bondAngleAtAtom = (centerAtomId, firstNeighborAtomId, secondNeighborAtomId) => {
        const center = pipeline.coords.get(centerAtomId);
        const firstNeighbor = pipeline.coords.get(firstNeighborAtomId);
        const secondNeighbor = pipeline.coords.get(secondNeighborAtomId);
        if (!center || !firstNeighbor || !secondNeighbor) {
          return null;
        }
        return angularDifference(
          Math.atan2(firstNeighbor.y - center.y, firstNeighbor.x - center.x),
          Math.atan2(secondNeighbor.y - center.y, secondNeighbor.x - center.x)
        ) * (180 / Math.PI);
      };
      const c28Spreads = [
        bondAngleAtAtom('C28', 'O27', 'C30'),
        bondAngleAtAtom('C28', 'O27', 'C39'),
        bondAngleAtAtom('C28', 'C30', 'C39')
      ];
      const c13Angles = {
        branch: bondAngleAtAtom('C13', 'C5', 'C16'),
        geminalFluoro: bondAngleAtAtom('C13', 'F14', 'F15')
      };
      const fusedCyclobutylC15Angle = bondAngleAtAtom('C15', 'C14', 'C16');
      const fusedCyclobutylS21Angles = {
        oxo: bondAngleAtAtom('S21', 'O22', 'O23'),
        single: bondAngleAtAtom('S21', 'N20', 'H52')
      };
      return {
        coordSignature,
        stereoSignature,
        c28Spreads: c28Spreads.every(value => typeof value === 'number' && Number.isFinite(value))
          ? c28Spreads
          : null,
        c13Angles: Object.values(c13Angles).every(value => typeof value === 'number' && Number.isFinite(value))
          ? c13Angles
          : null,
        fusedCyclobutylC15Angle: typeof fusedCyclobutylC15Angle === 'number' && Number.isFinite(fusedCyclobutylC15Angle)
          ? fusedCyclobutylC15Angle
          : null,
        fusedCyclobutylS21Angles: Object.values(fusedCyclobutylS21Angles).every(value => typeof value === 'number' && Number.isFinite(value))
          ? fusedCyclobutylS21Angles
          : null,
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

test('browser layout keeps fused cyclobutyl methylene linkers bent and sulfonyl sulfur paired in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_FUSED_CYCLOBUTYL_METHYLENE_SMILES);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_FUSED_CYCLOBUTYL_METHYLENE_SMILES);

  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.equal(signature.audit.ok, true, `expected ${browserName} audit to pass`);
    assert.ok(
      Math.abs(signature.fusedCyclobutylC15Angle - 120) < 1e-6,
      `expected ${browserName} C14-C15-C16 near 120 degrees, got ${signature.fusedCyclobutylC15Angle?.toFixed(2)}`
    );
    assert.ok(signature.fusedCyclobutylS21Angles, `expected ${browserName} to report S21 angles`);
    assert.ok(
      Math.abs(signature.fusedCyclobutylS21Angles.oxo - 180) < 1e-6,
      `expected ${browserName} O22-S21-O23 near 180 degrees, got ${signature.fusedCyclobutylS21Angles.oxo.toFixed(2)}`
    );
    assert.ok(
      Math.abs(signature.fusedCyclobutylS21Angles.single - 180) < 1e-6,
      `expected ${browserName} N20-S21-H52 near 180 degrees, got ${signature.fusedCyclobutylS21Angles.single.toFixed(2)}`
    );
  }
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
  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.ok(Array.isArray(signature.c28Spreads), `expected ${browserName} to report C28 spreads`);
    for (const spread of signature.c28Spreads) {
      assert.ok(Math.abs(spread - 120) < 1e-6, `expected ${browserName} C28 spread near 120 degrees, got ${spread.toFixed(2)}`);
    }
    assert.ok(signature.c13Angles, `expected ${browserName} to report C13 angles`);
    assert.ok(Math.abs(signature.c13Angles.branch - 90) < 1e-6, `expected ${browserName} C5-C13-C16 near 90 degrees, got ${signature.c13Angles.branch.toFixed(2)}`);
    assert.ok(Math.abs(signature.c13Angles.geminalFluoro - 90) < 2.5, `expected ${browserName} F14-C13-F15 near 90 degrees, got ${signature.c13Angles.geminalFluoro.toFixed(2)}`);
  }
  assert.equal(chromiumSignature.audit.ok, true);
  assert.equal(chromiumSignature.audit.severeOverlapCount, 0);
  assert.equal(chromiumSignature.audit.ringSubstituentReadabilityFailureCount, 0);
  assert.equal(chromiumSignature.audit.outwardAxisRingSubstituentFailureCount, 0);
});
