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
const BROWSER_CROWDED_PHENOL_RING_EXIT_SMILES = 'CC(=CCC12Oc3cc(O)ccc3C1(O)Oc4cc(O)c([C@H]5C=C(C)CC([C@H]5C(=O)c6ccc(O)cc6O)c7ccc(O)cc7O)c(O)c4C2=O)C';
const BROWSER_OMITTED_H_RING_HUB_SMILES = 'CC(NC(=O)C1=C2C=CC=CC2=NC=C1C(N1CCN(CC([O-])=O)C(=O)C1)C1=CC=CS1)C1CCCCC1';
const BROWSER_TETRAZOLE_OMITTED_H_SMILES = 'CCCCCCCC(C)C1CC(C(CC)C2=NNC=N2)(C(=O)O1)C1=CC=C(Cl)C=C1C';
const BROWSER_TRISODIUM_ANTHRAQUINONE_SMILES = '[Na+].[Na+].[Na+].CCc1cc(C(=O)C)c([O-])cc1OCCCOc2ccc3C(=O)c4cc(ccc4Oc3c2CCC(=O)[O-])C(=O)[O-]';

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

async function browserLayoutSignature(browserType, origin, smiles, layoutOptions = null) {
  const browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/index.html`, { timeout: 60_000 });
    return await page.evaluate(async ({ smilesValue, layoutOptionsValue }) => {
      const { parseSMILES } = await import('/src/io/smiles.js');
      const { findVisibleHeavyBondCrossings } = await import('/src/layout/engine/audit/invariants.js');
      const { computeIncidentRingOutwardAngles } = await import('/src/layout/engine/geometry/ring-direction.js');
      const { createLayoutGraphFromNormalized } = await import('/src/layout/engine/model/layout-graph.js');
      const { normalizeOptions } = await import('/src/layout/engine/options.js');
      const { runPipeline } = await import('/src/layout/engine/pipeline.js');

      const molecule = parseSMILES(smilesValue);
      const pipelineOptions = {
        suppressH: true,
        ...(layoutOptionsValue ?? {})
      };
      const layoutGraph = createLayoutGraphFromNormalized(molecule, normalizeOptions(pipelineOptions));
      const pipeline = runPipeline(molecule, pipelineOptions);
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
      const isTetrazoleOmittedHCase = smilesValue === 'CCCCCCCC(C)C1CC(C(CC)C2=NNC=N2)(C(=O)O1)C1=CC=C(Cl)C=C1C';
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
      const crowdedPhenolC49Spreads = [
        bondAngleAtAtom('C49', 'C21', 'O50'),
        bondAngleAtAtom('C49', 'C21', 'C51'),
        bondAngleAtAtom('C49', 'O50', 'C51')
      ];
      const crowdedPhenolC31Angles = [
        bondAngleAtAtom('C31', 'O32', 'C33'),
        bondAngleAtAtom('C31', 'O32', 'C29'),
        bondAngleAtAtom('C31', 'C33', 'C29')
      ];
      const crowdedPhenolO15BridgeAngle = bondAngleAtAtom('C14', 'C5', 'O15');
      const omittedHubC16Spreads = [
        bondAngleAtAtom('C16', 'N17', 'C28'),
        bondAngleAtAtom('C16', 'N17', 'C15'),
        bondAngleAtAtom('C16', 'C28', 'C15')
      ];
      const omittedHubC28Angles = [
        bondAngleAtAtom('C28', 'C16', 'C29'),
        bondAngleAtAtom('C28', 'C16', 'S32'),
        bondAngleAtAtom('C28', 'C29', 'S32')
      ];
      const omittedHubN17Angles = [
        bondAngleAtAtom('N17', 'C16', 'C18'),
        bondAngleAtAtom('N17', 'C16', 'C27'),
        bondAngleAtAtom('N17', 'C18', 'C27')
      ];
      const omittedHubC6Angles = [
        bondAngleAtAtom('C6', 'C4', 'C15'),
        bondAngleAtAtom('C6', 'C4', 'C7'),
        bondAngleAtAtom('C6', 'C15', 'C7')
      ];
      const omittedHubC4Angles = [
        bondAngleAtAtom('C4', 'O5', 'C6'),
        bondAngleAtAtom('C4', 'O5', 'N3'),
        bondAngleAtAtom('C4', 'C6', 'N3')
      ];
      const tetrazoleC13Angles = isTetrazoleOmittedHCase
        ? [
            bondAngleAtAtom('C13', 'C12', 'C14'),
            bondAngleAtAtom('C13', 'C12', 'C16'),
            bondAngleAtAtom('C13', 'C14', 'C16')
          ]
        : null;
      const tetrazoleC12Angles = isTetrazoleOmittedHCase
        ? [
            bondAngleAtAtom('C12', 'C11', 'C13'),
            bondAngleAtAtom('C12', 'C11', 'C21'),
            bondAngleAtAtom('C12', 'C11', 'C24'),
            bondAngleAtAtom('C12', 'C13', 'C21'),
            bondAngleAtAtom('C12', 'C13', 'C24'),
            bondAngleAtAtom('C12', 'C21', 'C24')
          ]
        : null;
      const tetrazoleC30Angles = isTetrazoleOmittedHCase
        ? [
            bondAngleAtAtom('C30', 'C24', 'C31'),
            bondAngleAtAtom('C30', 'C29', 'C31'),
            bondAngleAtAtom('C30', 'C24', 'C29')
          ]
        : null;
      const tetrazoleC24Angles = isTetrazoleOmittedHCase
        ? [
            bondAngleAtAtom('C24', 'C12', 'C30'),
            bondAngleAtAtom('C24', 'C12', 'C25'),
            bondAngleAtAtom('C24', 'C30', 'C25')
          ]
        : null;
      const trisodiumC37Angle = bondAngleAtAtom('C37', 'C36', 'C38');
      const omittedHubRootOutwardDeviation = (rootAtomId, parentAtomId) => {
        const rootPosition = pipeline.coords.get(rootAtomId);
        const parentPosition = pipeline.coords.get(parentAtomId);
        if (!rootPosition || !parentPosition) {
          return null;
        }
        const outwardAngles = computeIncidentRingOutwardAngles(layoutGraph, rootAtomId, atomId => pipeline.coords.get(atomId) ?? null);
        if (outwardAngles.length === 0) {
          return null;
        }
        const parentAngle = Math.atan2(parentPosition.y - rootPosition.y, parentPosition.x - rootPosition.x);
        return Math.min(...outwardAngles.map(outwardAngle => angularDifference(parentAngle, outwardAngle))) * (180 / Math.PI);
      };
      const omittedHubC28OutwardDeviation = omittedHubRootOutwardDeviation('C28', 'C16');
      const omittedHubN17OutwardDeviation = omittedHubRootOutwardDeviation('N17', 'C16');
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
        crowdedPhenolC49Spreads: crowdedPhenolC49Spreads.every(value => typeof value === 'number' && Number.isFinite(value))
          ? crowdedPhenolC49Spreads
          : null,
        crowdedPhenolC31Angles: crowdedPhenolC31Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? crowdedPhenolC31Angles
          : null,
        crowdedPhenolO15BridgeAngle: typeof crowdedPhenolO15BridgeAngle === 'number' && Number.isFinite(crowdedPhenolO15BridgeAngle)
          ? crowdedPhenolO15BridgeAngle
          : null,
        omittedHubC16Spreads: omittedHubC16Spreads.every(value => typeof value === 'number' && Number.isFinite(value))
          ? omittedHubC16Spreads
          : null,
        omittedHubC28Angles: omittedHubC28Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? omittedHubC28Angles
          : null,
        omittedHubN17Angles: omittedHubN17Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? omittedHubN17Angles
          : null,
        omittedHubC6Angles: omittedHubC6Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? omittedHubC6Angles
          : null,
        omittedHubC4Angles: omittedHubC4Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? omittedHubC4Angles
          : null,
        tetrazoleC13Angles: Array.isArray(tetrazoleC13Angles) && tetrazoleC13Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? tetrazoleC13Angles
          : null,
        tetrazoleC12Angles: Array.isArray(tetrazoleC12Angles) && tetrazoleC12Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? tetrazoleC12Angles
          : null,
        tetrazoleC30Angles: Array.isArray(tetrazoleC30Angles) && tetrazoleC30Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? tetrazoleC30Angles
          : null,
        tetrazoleC24Angles: Array.isArray(tetrazoleC24Angles) && tetrazoleC24Angles.every(value => typeof value === 'number' && Number.isFinite(value))
          ? tetrazoleC24Angles
          : null,
        visibleHeavyBondCrossingCount: findVisibleHeavyBondCrossings(pipeline.layoutGraph, pipeline.coords).length,
        omittedHubC28OutwardDeviation: typeof omittedHubC28OutwardDeviation === 'number' && Number.isFinite(omittedHubC28OutwardDeviation)
          ? omittedHubC28OutwardDeviation
          : null,
        omittedHubN17OutwardDeviation: typeof omittedHubN17OutwardDeviation === 'number' && Number.isFinite(omittedHubN17OutwardDeviation)
          ? omittedHubN17OutwardDeviation
          : null,
        trisodiumC37Angle: typeof trisodiumC37Angle === 'number' && Number.isFinite(trisodiumC37Angle)
          ? trisodiumC37Angle
          : null,
        audit: {
          ok: pipeline.metadata?.audit?.ok ?? null,
          severeOverlapCount: pipeline.metadata?.audit?.severeOverlapCount ?? null,
          ringSubstituentReadabilityFailureCount: pipeline.metadata?.audit?.ringSubstituentReadabilityFailureCount ?? null,
          outwardAxisRingSubstituentFailureCount: pipeline.metadata?.audit?.outwardAxisRingSubstituentFailureCount ?? null
        }
      };
    }, { smilesValue: smiles, layoutOptionsValue: layoutOptions });
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

test('browser layout keeps crowded omitted-h thiophene and piperazine hubs exact and overlap-free in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const layoutOptions = {
    auditTelemetry: true,
    finalLandscapeOrientation: true
  };
  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_OMITTED_H_RING_HUB_SMILES, layoutOptions);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_OMITTED_H_RING_HUB_SMILES, layoutOptions);

  assert.deepStrictEqual(webkitSignature.audit, chromiumSignature.audit);
  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.equal(signature.audit.ok, true, `expected ${browserName} audit to pass`);
    assert.equal(signature.audit.severeOverlapCount, 0, `expected ${browserName} to avoid severe overlaps`);
    assert.ok(Array.isArray(signature.omittedHubC16Spreads), `expected ${browserName} to report C16 spreads`);
    for (const spread of signature.omittedHubC16Spreads) {
      assert.ok(Math.abs(spread - 120) < 1e-6, `expected ${browserName} C16 omitted-H spread near 120 degrees, got ${spread.toFixed(2)}`);
    }
    assert.ok(Array.isArray(signature.omittedHubC28Angles), `expected ${browserName} to report C28 angles`);
    for (const [index, expectedAngle] of [126, 126, 108].entries()) {
      const angle = signature.omittedHubC28Angles[index];
      assert.ok(Math.abs(angle - expectedAngle) < 1e-6, `expected ${browserName} C28 angle near ${expectedAngle} degrees, got ${angle.toFixed(2)}`);
    }
    assert.ok(Array.isArray(signature.omittedHubN17Angles), `expected ${browserName} to report N17 angles`);
    for (const angle of signature.omittedHubN17Angles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected ${browserName} N17 angle near 120 degrees, got ${angle.toFixed(2)}`);
    }
    assert.ok(Array.isArray(signature.omittedHubC6Angles), `expected ${browserName} to report C6 angles`);
    for (const angle of signature.omittedHubC6Angles) {
      assert.ok(Math.abs(angle - 120) <= 12 + 1e-6, `expected ${browserName} C6 angle within the bounded local relief, got ${angle.toFixed(2)}`);
    }
    assert.ok(Array.isArray(signature.omittedHubC4Angles), `expected ${browserName} to report C4 angles`);
    for (const [index, expectedAngle] of [132, 114, 114].entries()) {
      const angle = signature.omittedHubC4Angles[index];
      assert.ok(Math.abs(angle - expectedAngle) < 1e-6, `expected ${browserName} C4 balanced relief angle near ${expectedAngle} degrees, got ${angle.toFixed(2)}`);
    }
    assert.ok(
      signature.omittedHubC28OutwardDeviation < 1e-6,
      `expected ${browserName} C28 outward deviation below tolerance, got ${signature.omittedHubC28OutwardDeviation?.toFixed(6)}`
    );
    assert.ok(
      signature.omittedHubN17OutwardDeviation < 1e-6,
      `expected ${browserName} N17 outward deviation below tolerance, got ${signature.omittedHubN17OutwardDeviation?.toFixed(6)}`
    );
  }
});

test('browser layout keeps the tetrazole-linked C13 fan bounded without collapsing C12 in webkit', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const layoutOptions = {
    auditTelemetry: true,
    finalLandscapeOrientation: true
  };
  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_TETRAZOLE_OMITTED_H_SMILES, layoutOptions);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_TETRAZOLE_OMITTED_H_SMILES, layoutOptions);

  assert.deepStrictEqual(webkitSignature.audit, chromiumSignature.audit);
  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.equal(signature.audit.ok, true, `expected ${browserName} audit to pass`);
    assert.equal(signature.audit.severeOverlapCount, 0, `expected ${browserName} to avoid severe overlaps`);
    assert.equal(signature.visibleHeavyBondCrossingCount, 0, `expected ${browserName} to avoid visible heavy-bond crossings`);
    assert.ok(Array.isArray(signature.tetrazoleC13Angles), `expected ${browserName} to report C13 angles`);
    for (const angle of signature.tetrazoleC13Angles) {
      assert.ok(Math.abs(angle - 120) <= 25 + 1e-6, `expected ${browserName} C13 fan within bounded relief, got ${angle.toFixed(2)}`);
    }
    assert.ok(Array.isArray(signature.tetrazoleC12Angles), `expected ${browserName} to report C12 angles`);
    assert.ok(
      Math.min(...signature.tetrazoleC12Angles) >= 70,
      `expected ${browserName} C12 branch fan to avoid collapse, got ${signature.tetrazoleC12Angles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(Array.isArray(signature.tetrazoleC30Angles), `expected ${browserName} to report C30 angles`);
    for (const angle of signature.tetrazoleC30Angles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected ${browserName} C30 methyl fan near 120 degrees, got ${angle.toFixed(2)}`);
    }
    assert.ok(Array.isArray(signature.tetrazoleC24Angles), `expected ${browserName} to report C24 angles`);
    for (const angle of signature.tetrazoleC24Angles) {
      assert.ok(Math.abs(angle - 120) < 1e-6, `expected ${browserName} C24 phenyl root near 120 degrees, got ${angle.toFixed(2)}`);
    }
  }
});

test('browser layout preserves the trisodium anthraquinone C37 zigzag through presentation cleanup', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const layoutOptions = {
    auditTelemetry: true,
    finalLandscapeOrientation: true
  };
  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_TRISODIUM_ANTHRAQUINONE_SMILES, layoutOptions);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_TRISODIUM_ANTHRAQUINONE_SMILES, layoutOptions);

  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.equal(signature.audit.ok, true, `expected ${browserName} audit to pass`);
    assert.equal(signature.audit.severeOverlapCount, 0, `expected ${browserName} to avoid severe overlaps`);
    assert.ok(
      Math.abs(signature.trisodiumC37Angle - 120) < 1e-6,
      `expected ${browserName} C36-C37-C38 near 120 degrees, got ${signature.trisodiumC37Angle?.toFixed(2)}`
    );
  }
});

test('browser layout keeps crowded phenolic C49 ring exits exact after retouch cleanup', { timeout: 120_000 }, async t => {
  const { server, origin } = await startStaticServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
  });

  const chromiumSignature = await browserLayoutSignature(chromium, origin, BROWSER_CROWDED_PHENOL_RING_EXIT_SMILES);
  const webkitSignature = await browserLayoutSignature(webkit, origin, BROWSER_CROWDED_PHENOL_RING_EXIT_SMILES);

  for (const [browserName, signature] of [['chromium', chromiumSignature], ['webkit', webkitSignature]]) {
    assert.equal(signature.audit.ok, true, `expected ${browserName} audit to pass`);
    assert.ok(Array.isArray(signature.crowdedPhenolC49Spreads), `expected ${browserName} to report C49 spreads`);
    for (const spread of signature.crowdedPhenolC49Spreads) {
      assert.ok(Math.abs(spread - 120) < 1e-6, `expected ${browserName} C49 spread near 120 degrees, got ${spread.toFixed(2)}`);
    }
    assert.ok(Array.isArray(signature.crowdedPhenolC31Angles), `expected ${browserName} to report C31 angles`);
    assert.ok(
      Math.min(...signature.crowdedPhenolC31Angles) >= 88 - 1e-6,
      `expected ${browserName} C31 fan to stay bounded, got ${signature.crowdedPhenolC31Angles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(
      Math.max(...signature.crowdedPhenolC31Angles) <= 140 + 1e-6,
      `expected ${browserName} C31 fan not to over-open, got ${signature.crowdedPhenolC31Angles.map(angle => angle.toFixed(2)).join(', ')}`
    );
    assert.ok(
      Math.abs(signature.crowdedPhenolO15BridgeAngle - 180) < 1e-6,
      `expected ${browserName} C14-O15 bridge hydroxyl to stay straight, got ${signature.crowdedPhenolO15BridgeAngle?.toFixed(2)}`
    );
  }
});
