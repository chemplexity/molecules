import { test, expect } from '@playwright/test';
import { morganRanks } from '../../src/algorithms/morgan.js';
import { parseSMILES } from '../../src/io/smiles.js';
import { analyzeRings } from '../../src/layout/engine/topology/ring-analysis.js';

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => {
    throw error;
  });
});

test('app boot does not hit unsupported module URLs', async ({ page }) => {
  const failedRequests = [];
  const consoleErrors = [];
  page.on('requestfailed', request => {
    failedRequests.push({
      url: request.url(),
      errorText: request.failure()?.errorText ?? ''
    });
  });
  page.on('console', message => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });

  await page.goto('/index.html');
  await expect(page.locator('#smiles-input')).toBeVisible();

  const unsupportedRequests = failedRequests.filter(request => request.url.startsWith('node:'));
  const unsupportedConsoleErrors = consoleErrors.filter(message => /unsupported url|node:perf_hooks/i.test(message));

  expect(unsupportedRequests).toEqual([]);
  expect(unsupportedConsoleErrors).toEqual([]);
});

async function loadSmiles(page, smiles) {
  const input = page.locator('#smiles-input');
  await input.fill(smiles);
  await input.press('Enter');
}

async function loadInchi(page, inchi) {
  const input = page.locator('#smiles-input');
  await input.fill(inchi);
  await input.press('Enter');
}

async function computeResonanceContributors(resonanceRow) {
  const computeBtn = resonanceRow.getByRole('button', { name: 'Compute' });
  await expect(computeBtn).toBeVisible();
  await computeBtn.click();
  await expect(resonanceRow).not.toContainText('Compute');
}

async function atomBondAngleDegrees(page, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) {
  return await page.evaluate(({ centerAtomId: centerId, firstNeighborAtomId: firstId, secondNeighborAtomId: secondId }) => {
    const parseTranslate = value => {
      const match = /^translate\(([-0-9.]+),([-0-9.]+)\)$/.exec(value ?? '');
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    };
    const center = parseTranslate(document.querySelector(`g[data-atom-id="${centerId}"]`)?.getAttribute('transform'));
    const first = parseTranslate(document.querySelector(`g[data-atom-id="${firstId}"]`)?.getAttribute('transform'));
    const second = parseTranslate(document.querySelector(`g[data-atom-id="${secondId}"]`)?.getAttribute('transform'));
    if (!center || !first || !second) {
      return null;
    }
    const firstDx = first.x - center.x;
    const firstDy = first.y - center.y;
    const secondDx = second.x - center.x;
    const secondDy = second.y - center.y;
    const denominator = Math.hypot(firstDx, firstDy) * Math.hypot(secondDx, secondDy);
    if (!(denominator > 0)) {
      return null;
    }
    const cosine = Math.max(-1, Math.min(1, ((firstDx * secondDx) + (firstDy * secondDy)) / denominator));
    return (Math.acos(cosine) * 180) / Math.PI;
  }, { centerAtomId, firstNeighborAtomId, secondNeighborAtomId });
}

async function bondDirectionDegrees(page, firstAtomId, secondAtomId) {
  return await page.evaluate(({ firstAtomId: firstId, secondAtomId: secondId }) => {
    const parseTranslate = value => {
      const match = /^translate\(([-0-9.]+),([-0-9.]+)\)$/.exec(value ?? '');
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    };
    const first = parseTranslate(document.querySelector(`g[data-atom-id="${firstId}"]`)?.getAttribute('transform'));
    const second = parseTranslate(document.querySelector(`g[data-atom-id="${secondId}"]`)?.getAttribute('transform'));
    if (!first || !second) {
      return null;
    }
    return (Math.atan2(second.y - first.y, second.x - first.x) * 180) / Math.PI;
  }, { firstAtomId, secondAtomId });
}

async function atomDistance(page, firstAtomId, secondAtomId) {
  return await page.evaluate(({ firstAtomId: firstId, secondAtomId: secondId }) => {
    const parseTranslate = value => {
      const match = /^translate\(([-0-9.]+),([-0-9.]+)\)$/.exec(value ?? '');
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    };
    const first = parseTranslate(document.querySelector(`g[data-atom-id="${firstId}"]`)?.getAttribute('transform'));
    const second = parseTranslate(document.querySelector(`g[data-atom-id="${secondId}"]`)?.getAttribute('transform'));
    if (!first || !second) {
      return null;
    }
    return Math.hypot(second.x - first.x, second.y - first.y);
  }, { firstAtomId, secondAtomId });
}

async function atomInsideRing(page, atomId, ringAtomIds) {
  return await page.evaluate(({ atomId: targetAtomId, ringAtomIds: targetRingAtomIds }) => {
    const parseTranslate = value => {
      const match = /^translate\(([-0-9.]+),([-0-9.]+)\)$/.exec(value ?? '');
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    };
    const point = parseTranslate(document.querySelector(`g[data-atom-id="${targetAtomId}"]`)?.getAttribute('transform'));
    const polygon = targetRingAtomIds.map(ringAtomId =>
      parseTranslate(document.querySelector(`g[data-atom-id="${ringAtomId}"]`)?.getAttribute('transform'))
    );
    if (!point || polygon.some(position => !position)) {
      return null;
    }
    let inside = false;
    for (let firstIndex = 0, secondIndex = polygon.length - 1; firstIndex < polygon.length; secondIndex = firstIndex++) {
      const first = polygon[firstIndex];
      const second = polygon[secondIndex];
      const intersects = ((first.y > point.y) !== (second.y > point.y))
        && point.x < ((second.x - first.x) * (point.y - first.y)) / (second.y - first.y) + first.x;
      if (intersects) {
        inside = !inside;
      }
    }
    return inside;
  }, { atomId, ringAtomIds });
}

async function signedTurn(page, firstAtomId, centerAtomId, secondAtomId) {
  return await page.evaluate(({ firstAtomId: firstId, centerAtomId: centerId, secondAtomId: secondId }) => {
    const parseTranslate = value => {
      const match = /^translate\(([-0-9.]+),([-0-9.]+)\)$/.exec(value ?? '');
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    };
    const first = parseTranslate(document.querySelector(`g[data-atom-id="${firstId}"]`)?.getAttribute('transform'));
    const center = parseTranslate(document.querySelector(`g[data-atom-id="${centerId}"]`)?.getAttribute('transform'));
    const second = parseTranslate(document.querySelector(`g[data-atom-id="${secondId}"]`)?.getAttribute('transform'));
    if (!first || !center || !second) {
      return null;
    }
    return ((first.x - center.x) * (second.y - center.y)) - ((first.y - center.y) * (second.x - center.x));
  }, { firstAtomId, centerAtomId, secondAtomId });
}

test('loading and cleaning the benzamide bug molecule keeps the aryl amide exit on the exact trigonal slot', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCC1=CC=CC(CC)=C1NC(=O)C1=C(C)N(CC(C)C)C(C)=C(Br)C1=O');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const initialAngle = await atomBondAngleDegrees(page, 'N11', 'C10', 'C12');
  expect(initialAngle).not.toBeNull();
  expect(Math.abs(initialAngle - 120)).toBeLessThan(1e-6);

  await page.locator('#clean-2d-btn').click();

  await expect
    .poll(async () => {
      const cleanedAngle = await atomBondAngleDegrees(page, 'N11', 'C10', 'C12');
      return cleanedAngle == null ? null : Math.abs(cleanedAngle - 120);
    })
    .toBeLessThan(1e-6);
});

test('loading the simple chloro ketone bug molecule keeps the chlorine on the exact downward slot', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC(=O)C(Cl)CC(C(C)C)C=C');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const chlorineDirection = await bondDirectionDegrees(page, 'C4', 'Cl5');
  expect(chlorineDirection).not.toBeNull();
  expect(Math.abs(chlorineDirection - 90)).toBeLessThan(1e-6);
});

test('loading the crowded phosphine oxide keeps mirrored aryl ethyl branches separated in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCCCP(=O)(C(=O)C1=C(CC)C=C(CC)C=C1CC)C(=O)C1=C(CC)C=C(CC)C=C1CC');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const mirroredEthylDistance = await atomDistance(page, 'C11', 'C33');
  const carbonylClearance = await atomDistance(page, 'C2', 'O8');
  const firstArylEthylAngle = await atomBondAngleDegrees(page, 'C10', 'C9', 'C11');
  const firstArylEthylMirrorAngle = await atomBondAngleDegrees(page, 'C10', 'C11', 'C13');
  const secondArylEthylAngle = await atomBondAngleDegrees(page, 'C32', 'C23', 'C33');
  const secondArylEthylMirrorAngle = await atomBondAngleDegrees(page, 'C32', 'C31', 'C33');
  const phosphineOxideAxisAngle = await atomBondAngleDegrees(page, 'P5', 'O6', 'C4');
  const phosphineArylAxisAngle = await atomBondAngleDegrees(page, 'P5', 'C7', 'C21');
  expect(mirroredEthylDistance).not.toBeNull();
  expect(carbonylClearance).not.toBeNull();
  expect(firstArylEthylAngle).not.toBeNull();
  expect(firstArylEthylMirrorAngle).not.toBeNull();
  expect(secondArylEthylAngle).not.toBeNull();
  expect(secondArylEthylMirrorAngle).not.toBeNull();
  expect(phosphineOxideAxisAngle).not.toBeNull();
  expect(phosphineArylAxisAngle).not.toBeNull();
  expect(mirroredEthylDistance).toBeGreaterThan(60);
  expect(carbonylClearance).toBeGreaterThan(45);
  expect(Math.abs(firstArylEthylAngle - 120)).toBeLessThan(1e-6);
  expect(Math.abs(firstArylEthylMirrorAngle - 120)).toBeLessThan(1e-6);
  expect(Math.abs(secondArylEthylAngle - 120)).toBeLessThan(1e-6);
  expect(Math.abs(secondArylEthylMirrorAngle - 120)).toBeLessThan(1e-6);
  expect(Math.abs(phosphineOxideAxisAngle - 180)).toBeLessThan(1e-6);
  expect(phosphineArylAxisAngle).toBeGreaterThan(160);
});

test('loading the bulky cyclohexyl ester bug molecule keeps the C22/C24 pocket clear in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC(C)(O)C(=O)C1=CC=C(COC(=O)NCC2(C)CC(CC(C)(C)C2)NC(=O)OCC2=CC=C(C=C2)C(=O)C(C)(C)O)C=C1');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const esterOxygenToRingHub = await atomDistance(page, 'O12', 'C22');
  const esterOxygenToMethylLeaf = await atomDistance(page, 'O12', 'C24');
  const methylBondLength = await atomDistance(page, 'C22', 'C24');
  expect(esterOxygenToRingHub).not.toBeNull();
  expect(esterOxygenToMethylLeaf).not.toBeNull();
  expect(methylBondLength).not.toBeNull();
  expect(methylBondLength).toBeGreaterThan(80);
  expect(esterOxygenToRingHub).toBeGreaterThan(120);
  expect(esterOxygenToMethylLeaf).toBeGreaterThan(120);
});

test('loading the benzylic amino-alcohol bug molecule keeps the visible trigonal centers and attached phenyl exit exact', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC(COC1=CC=CC=C1)NC(C)C(O)C1=CC=C(O)C=C1');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  for (const [centerAtomId, firstNeighborAtomId, secondNeighborAtomId] of [
    ['C2', 'C1', 'N11'],
    ['C2', 'C1', 'C3'],
    ['C2', 'N11', 'C3'],
    ['C12', 'C13', 'N11'],
    ['C12', 'C13', 'C14'],
    ['C12', 'N11', 'C14'],
    ['C14', 'C12', 'O15'],
    ['C14', 'C12', 'C16'],
    ['C14', 'O15', 'C16']
  ]) {
    const angle = await atomBondAngleDegrees(page, centerAtomId, firstNeighborAtomId, secondNeighborAtomId);
    expect(angle).not.toBeNull();
    expect(Math.abs(angle - 120)).toBeLessThan(1e-6);
  }
  const attachedPhenylExit = await atomBondAngleDegrees(page, 'C16', 'C17', 'C14');
  const attachedPhenylExitMirror = await atomBondAngleDegrees(page, 'C16', 'C22', 'C14');
  expect(attachedPhenylExit).not.toBeNull();
  expect(attachedPhenylExitMirror).not.toBeNull();
  expect(Math.abs(attachedPhenylExit - 120)).toBeLessThan(1e-6);
  expect(Math.abs(attachedPhenylExitMirror - 120)).toBeLessThan(1e-6);

  await page.locator('#clean-2d-btn').click();

  await expect
    .poll(async () => {
      const angles = await Promise.all([
        atomBondAngleDegrees(page, 'C2', 'C1', 'N11'),
        atomBondAngleDegrees(page, 'C2', 'C1', 'C3'),
        atomBondAngleDegrees(page, 'C2', 'N11', 'C3'),
        atomBondAngleDegrees(page, 'C12', 'C13', 'N11'),
        atomBondAngleDegrees(page, 'C12', 'C13', 'C14'),
        atomBondAngleDegrees(page, 'C12', 'N11', 'C14'),
        atomBondAngleDegrees(page, 'C14', 'C12', 'O15'),
        atomBondAngleDegrees(page, 'C14', 'C12', 'C16'),
        atomBondAngleDegrees(page, 'C14', 'O15', 'C16'),
        atomBondAngleDegrees(page, 'C16', 'C17', 'C14'),
        atomBondAngleDegrees(page, 'C16', 'C22', 'C14')
      ]);
      if (angles.some(angle => angle == null)) {
        return null;
      }
      return Math.max(...angles.map(angle => Math.abs(angle - 120)));
    })
    .toBeLessThan(1e-6);
});

test('loading and cleaning the diaryl amino alcohol bug molecule keeps both phenyl roots exact in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC[C@@H](O)C(C[C@@H](C)N(C)C)(C1=CC=CC=C1)C1=CC=CC=C1');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const phenylRootAngleMaxDeviation = async () => {
    const angles = await Promise.all([
      atomBondAngleDegrees(page, 'C14', 'C6', 'C15'),
      atomBondAngleDegrees(page, 'C14', 'C6', 'C19'),
      atomBondAngleDegrees(page, 'C14', 'C15', 'C19'),
      atomBondAngleDegrees(page, 'C20', 'C6', 'C21'),
      atomBondAngleDegrees(page, 'C20', 'C6', 'C25'),
      atomBondAngleDegrees(page, 'C20', 'C21', 'C25')
    ]);
    if (angles.some(angle => angle == null)) {
      return null;
    }
    return Math.max(...angles.map(angle => Math.abs(angle - 120)));
  };

  await expect.poll(phenylRootAngleMaxDeviation).toBeLessThan(1e-6);

  await page.locator('#clean-2d-btn').click();

  await expect.poll(phenylRootAngleMaxDeviation).toBeLessThan(1e-6);
});

test('loading and cleaning the fused indole alkene bug molecule keeps both linker trigonal angles exact in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'Cc1[nH]c2ccccc2c1\\C=C\\c3c[nH]c4ccccc34');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  for (const [centerAtomId, firstNeighborAtomId, secondNeighborAtomId] of [
    ['C12', 'C11', 'C13'],
    ['C13', 'C12', 'C14']
  ]) {
    const angle = await atomBondAngleDegrees(page, centerAtomId, firstNeighborAtomId, secondNeighborAtomId);
    expect(angle).not.toBeNull();
    expect(Math.abs(angle - 120)).toBeLessThan(1e-6);
  }

  await page.locator('#clean-2d-btn').click();

  await expect
    .poll(async () => {
      const angles = await Promise.all([
        atomBondAngleDegrees(page, 'C12', 'C11', 'C13'),
        atomBondAngleDegrees(page, 'C13', 'C12', 'C14')
      ]);
      if (angles.some(angle => angle == null)) {
        return null;
      }
      return Math.max(...angles.map(angle => Math.abs(angle - 120)));
    })
    .toBeLessThan(1e-6);
});

test('loading and cleaning the anisole ester bug molecule keeps the C7 carbonyl center exact in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, '[H][C@]12C[C@@H](OC(=O)C3=CC(OC)=C(OC)C(OC)=C3)[C@H](OC)[C@@H](C(=O)OC)[C@@]1([H])C[C@@]1([H])N(CCC3=C1NC1=C3C=CC(OC)=C1)C2');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  for (const [firstNeighborAtomId, secondNeighborAtomId, expectedAngle] of [
    ['O8', 'O6', 120],
    ['O8', 'C9', 120],
    ['O6', 'C9', 120]
  ]) {
    const initialAngle = await atomBondAngleDegrees(page, 'C7', firstNeighborAtomId, secondNeighborAtomId);
    expect(initialAngle).not.toBeNull();
    expect(Math.abs(initialAngle - expectedAngle)).toBeLessThan(1e-6);
  }
  const initialTurn = await signedTurn(page, 'C4', 'O6', 'C7');
  expect(initialTurn).not.toBeNull();
  expect(initialTurn).toBeLessThan(0);

  await page.locator('#clean-2d-btn').click();

  await expect
    .poll(async () => {
      const angleChecks = await Promise.all([
        atomBondAngleDegrees(page, 'C7', 'O8', 'O6'),
        atomBondAngleDegrees(page, 'C7', 'O8', 'C9'),
        atomBondAngleDegrees(page, 'C7', 'O6', 'C9')
      ]);
      if (angleChecks.some(angle => angle == null)) {
        return null;
      }
      return Math.max(
        Math.abs(angleChecks[0] - 120),
        Math.abs(angleChecks[1] - 120),
        Math.abs(angleChecks[2] - 120)
      );
    })
    .toBeLessThan(1e-6);

  await expect
    .poll(async () => signedTurn(page, 'C4', 'O6', 'C7'))
    .toBeLessThan(0);
});

test('loading and cleaning the dimethoxybenzyl sulfonamide keeps C8 exact while balancing C3 and C5 in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'COC(=O)C1N(CC2=CC=CC(OC)=C2OC)C(=NC(O)=C1[O-])C1=CSC=C1NC(=O)[N-]S(=O)(=O)C1=CC=CC=C1Cl');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  for (const [centerAtomId, firstNeighborAtomId, secondNeighborAtomId] of [
    ['C8', 'C15', 'C7'],
    ['C8', 'C9', 'C7']
  ]) {
    const initialAngle = await atomBondAngleDegrees(page, centerAtomId, firstNeighborAtomId, secondNeighborAtomId);
    expect(initialAngle).not.toBeNull();
    expect(Math.abs(initialAngle - 120)).toBeLessThan(1e-6);
  }
  for (const [firstNeighborAtomId, secondNeighborAtomId] of [
    ['O2', 'O4'],
    ['O2', 'C5'],
    ['O4', 'C5']
  ]) {
    const initialAngle = await atomBondAngleDegrees(page, 'C3', firstNeighborAtomId, secondNeighborAtomId);
    expect(initialAngle).not.toBeNull();
    expect(Math.abs(initialAngle - 120)).toBeLessThan(12.1);
  }
  for (const [firstNeighborAtomId, secondNeighborAtomId] of [
    ['C3', 'N6'],
    ['C3', 'C22'],
    ['N6', 'C22']
  ]) {
    const initialAngle = await atomBondAngleDegrees(page, 'C5', firstNeighborAtomId, secondNeighborAtomId);
    expect(initialAngle).not.toBeNull();
    expect(Math.abs(initialAngle - 120)).toBeLessThan(12.1);
  }

  await page.locator('#clean-2d-btn').click();

  await expect
    .poll(async () => {
      const angles = await Promise.all([
        atomBondAngleDegrees(page, 'C8', 'C15', 'C7'),
        atomBondAngleDegrees(page, 'C8', 'C9', 'C7'),
        atomBondAngleDegrees(page, 'C3', 'O2', 'O4'),
        atomBondAngleDegrees(page, 'C3', 'O2', 'C5'),
        atomBondAngleDegrees(page, 'C3', 'O4', 'C5'),
        atomBondAngleDegrees(page, 'C5', 'C3', 'N6'),
        atomBondAngleDegrees(page, 'C5', 'C3', 'C22'),
        atomBondAngleDegrees(page, 'C5', 'N6', 'C22')
      ]);
      if (angles.some(angle => angle == null)) {
        return null;
      }
      const exactC8Deviation = Math.max(
        Math.abs(angles[0] - 120),
        Math.abs(angles[1] - 120)
      );
      const localBalanceDeviation = Math.max(...angles.slice(2).map(angle => Math.abs(angle - 120)));
      return exactC8Deviation <= 1e-6 && localBalanceDeviation < 12.1;
    })
    .toBe(true);
});

test('loading and cleaning the bridgehead ethyl fused-ring bug keeps C3 exiting outside in the browser render', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCC12CCCC3=C1C(CC[NH2+]C2(C)C)=CO3');
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const assertC3ExitOutside = async () => {
    const insideFirstRing = await atomInsideRing(page, 'C2', ['C14', 'N12', 'C11', 'C10', 'C9', 'C8', 'C3']);
    const insideSecondRing = await atomInsideRing(page, 'C2', ['C8', 'C7', 'C6', 'C5', 'C4', 'C3']);
    const c14Gap = await atomBondAngleDegrees(page, 'C3', 'C14', 'C2');
    const c4Gap = await atomBondAngleDegrees(page, 'C3', 'C4', 'C2');
    if (insideFirstRing == null || insideSecondRing == null || c14Gap == null || c4Gap == null) {
      return false;
    }
    return !insideFirstRing && !insideSecondRing && c14Gap > 45 && c4Gap > 45;
  };

  expect(await assertC3ExitOutside()).toBe(true);

  await page.locator('#clean-2d-btn').click();
  await expect.poll(assertC3ExitOutside).toBe(true);
});

function dominantMultiRingBondIds(smiles) {
  const molecule = parseSMILES(smiles);
  const { ringSystems } = analyzeRings(molecule, morganRanks(molecule));
  const multiRingSystems = ringSystems.filter(ringSystem => ringSystem.ringIds.length > 1);
  if (multiRingSystems.length !== 1 || ringSystems.length > 2) {
    return [];
  }

  const dominantAtomIdSet = new Set(multiRingSystems[0].atomIds);
  const bondIds = [];
  for (const bond of molecule.bonds.values()) {
    const [firstAtomId, secondAtomId] = bond.atoms ?? [];
    if (dominantAtomIdSet.has(firstAtomId) && dominantAtomIdSet.has(secondAtomId)) {
      bondIds.push(String(bond.id));
    }
  }
  return bondIds;
}

async function dominantBondAxisDegrees(page, bondIds) {
  return await page.evaluate(ids => {
    const points = [];
    for (const bondId of ids) {
      const line = document.querySelector(`[data-bond-id="${bondId}"] .bond-hit`);
      if (!line) {
        continue;
      }
      points.push(
        { x: Number(line.getAttribute('x1') ?? 0), y: Number(line.getAttribute('y1') ?? 0) },
        { x: Number(line.getAttribute('x2') ?? 0), y: Number(line.getAttribute('y2') ?? 0) }
      );
    }
    if (points.length < 2) {
      return null;
    }

    const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    let inertiaXX = 0;
    let inertiaYY = 0;
    let inertiaXY = 0;
    for (const point of points) {
      const dx = point.x - centerX;
      const dy = point.y - centerY;
      inertiaXX += dy * dy;
      inertiaYY += dx * dx;
      inertiaXY -= dx * dy;
    }
    const angle0 = 0.5 * Math.atan2(2 * inertiaXY, inertiaXX - inertiaYY);
    const inertia0 = inertiaXX * Math.cos(angle0) ** 2 + inertiaYY * Math.sin(angle0) ** 2 + inertiaXY * Math.sin(2 * angle0);
    const inertia1 = inertiaXX + inertiaYY - inertia0;
    let axis = inertia0 <= inertia1 ? angle0 : angle0 + Math.PI / 2;
    if (axis > Math.PI / 2) {
      axis -= Math.PI;
    }
    if (axis <= -Math.PI / 2) {
      axis += Math.PI;
    }
    return (axis * 180) / Math.PI;
  }, bondIds);
}

async function bondSignature(page) {
  return await page.evaluate(() =>
    Array.from(document.querySelectorAll('line.bond-hit')).map(line => ({
      x1: Number(line.getAttribute('x1') ?? 0).toFixed(2),
      y1: Number(line.getAttribute('y1') ?? 0).toFixed(2),
      x2: Number(line.getAttribute('x2') ?? 0).toFixed(2),
      y2: Number(line.getAttribute('y2') ?? 0).toFixed(2)
    }))
  );
}

async function clickBondHit(page, selector) {
  const box = await page.locator(selector).boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function stereoGlyphState(page) {
  return await page.evaluate(() => ({
    wedgeCount: document.querySelectorAll('polygon.bond-wedge').length,
    hashCount: document.querySelectorAll('line.bond-hash').length
  }));
}

async function forceStereoOverlayCounts(page) {
  return await page.evaluate(() => {
    const root = document.querySelector('.svg-plot > g');
    const stereoGroup = root?.querySelector('g.force-stereo-bonds') ?? null;
    const wedgePolygons = Array.from(stereoGroup?.querySelectorAll('polygon') ?? []);
    const dashLines = Array.from(stereoGroup?.querySelectorAll('line') ?? []);
    return {
      wedgeCount: wedgePolygons.length,
      dashLineCount: dashLines.length
    };
  });
}

async function rootTransform(page) {
  return await page.evaluate(() => document.querySelector('.svg-plot > g')?.getAttribute('transform') ?? null);
}

async function forceNodesWithinPlot(page, padding = 4) {
  return await page.evaluate(pad => {
    const plot = document.querySelector('.svg-plot');
    if (!plot) {
      return false;
    }
    const plotRect = plot.getBoundingClientRect();
    const nodes = Array.from(document.querySelectorAll('circle.node'));
    if (nodes.length === 0) {
      return false;
    }
    return nodes.every(node => {
      const rect = node.getBoundingClientRect();
      return rect.left >= plotRect.left + pad && rect.top >= plotRect.top + pad && rect.right <= plotRect.right - pad && rect.bottom <= plotRect.bottom - pad;
    });
  }, padding);
}

async function plotGeometryWithinPlot(page, padding = 4) {
  return await page.evaluate(pad => {
    const plot = document.querySelector('.svg-plot');
    if (!plot) {
      return false;
    }
    const plotRect = plot.getBoundingClientRect();
    const geometry = Array.from(document.querySelectorAll('line.bond-hit, circle.atom-hit'));
    if (geometry.length === 0) {
      return false;
    }
    return geometry.every(node => {
      const rect = node.getBoundingClientRect();
      return rect.left >= plotRect.left + pad && rect.top >= plotRect.top + pad && rect.right <= plotRect.right - pad && rect.bottom <= plotRect.bottom - pad;
    });
  }, padding);
}

/**
 * Captures the current screen-space centers of rendered force nodes and their labels.
 * @param {import('@playwright/test').Page} page - Playwright page under test.
 * @returns {Promise<Array<{id: string, label: string, cx: number, cy: number}>>} Force-node screen points in DOM order.
 */
async function forceAtomScreenPoints(page) {
  return await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
    return circles.map((circle, index) => {
      const rect = circle.getBoundingClientRect();
      const label = labels[index]?.textContent?.trim() ?? '';
      return {
        id: String(circle.__data__?.id ?? ''),
        label,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2
      };
    });
  });
}

/**
 * Computes the screen-space horizontal separation between reaction-preview
 * reactant and product force nodes.
 * @param {import('@playwright/test').Page} page - Playwright page under test.
 * @returns {Promise<number>} Product-centroid x minus reactant-centroid x.
 */
async function forceReactionPreviewHorizontalDelta(page) {
  return await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const points = circles.map(circle => {
      const rect = circle.getBoundingClientRect();
      return {
        id: String(circle.__data__?.id ?? ''),
        cx: rect.left + rect.width / 2
      };
    });
    const reactant = points.filter(point => !point.id.startsWith('__rxn_product__'));
    const product = points.filter(point => point.id.startsWith('__rxn_product__'));
    if (reactant.length === 0 || product.length === 0) {
      return 0;
    }
    const reactantCx = reactant.reduce((sum, point) => sum + point.cx, 0) / reactant.length;
    const productCx = product.reduce((sum, point) => sum + point.cx, 0) / product.length;
    return productCx - reactantCx;
  });
}

/**
 * Computes the signed area of the triangle formed by the three requested force nodes.
 * @param {Array<{id: string, cx: number, cy: number}>} points - Force-node screen points keyed by atom id.
 * @param {string} firstId - First atom id.
 * @param {string} secondId - Second atom id.
 * @param {string} thirdId - Third atom id.
 * @returns {number} Signed screen-space triangle area.
 */
function signedTriangleArea(points, firstId, secondId, thirdId) {
  const pointById = new Map(points.map(point => [point.id, point]));
  const first = pointById.get(firstId);
  const second = pointById.get(secondId);
  const third = pointById.get(thirdId);
  if (!first || !second || !third) {
    throw new Error(`Missing force-node triangle point(s): ${firstId}, ${secondId}, ${thirdId}`);
  }
  return (second.cx - first.cx) * (third.cy - first.cy) - (second.cy - first.cy) * (third.cx - first.cx);
}

test('input changes participate in undo/redo through the real browser UI', async ({ page }) => {
  await page.goto('/index.html');

  const input = page.locator('#smiles-input');
  await loadSmiles(page, 'CCO');
  await expect(input).toHaveValue('CCO');

  await loadSmiles(page, 'CCC');
  await expect(input).toHaveValue('CCC');

  await page.locator('#undo-btn').click();
  await expect(input).toHaveValue('CCO');
});

test('browser 2D rendering keeps one clearly dominant multi-ring scaffold level by that scaffold axis', async ({ page }) => {
  const smiles = 'CCCCC1=CC2=C(C=C1C(=CC1=CC=NO1)C(C)C)C(C)(C)CC2(C)C';
  const bondIds = dominantMultiRingBondIds(smiles);

  await page.goto('/index.html');
  await loadSmiles(page, smiles);
  await page.locator('line.bond-hit').first().waitFor({ state: 'attached' });

  const axisDegrees = await dominantBondAxisDegrees(page, bondIds);

  expect(Math.abs(axisDegrees ?? Infinity)).toBeLessThanOrEqual(1);
});

test('undo restores the prior InChI text after switching input format', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#inchi-mode-btn').click();

  const ethanolInchi = 'InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3';
  await expect(page.locator('#smiles-input')).toHaveValue(ethanolInchi);

  const propaneInchi = 'InChI=1S/C3H8/c1-3-2/h3H2,1-2H3';
  await loadInchi(page, propaneInchi);
  await expect(page.locator('#smiles-input')).toHaveValue(propaneInchi);

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue(ethanolInchi);
});

test('input format toggle participates in undo and redo', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await expect(page.locator('#smiles-mode-btn')).toHaveClass(/active/);

  await page.locator('#inchi-mode-btn').click();
  await expect(page.locator('#inchi-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('#smiles-input')).toHaveValue('InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('#inchi-mode-btn')).not.toHaveClass(/active/);
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');

  await page.locator('#redo-btn').click();
  await expect(page.locator('#inchi-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('#smiles-input')).toHaveValue('InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3');
});

test('undo restores pasted SMILES correctly after auto-switching out of InChI mode', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#inchi-mode-btn').click();
  await expect(page.locator('#inchi-mode-btn')).toHaveClass(/active/);

  const input = page.locator('#smiles-input');
  await input.fill('CCC');
  await input.evaluate(element => {
    element.dispatchEvent(new Event('paste', { bubbles: true }));
  });
  await expect(page.locator('#smiles-mode-btn')).toHaveClass(/active/);
  await expect(input).toHaveValue('CCC');

  await loadSmiles(page, 'CCN');
  await expect(input).toHaveValue('CCN');

  await page.locator('#undo-btn').click();
  await expect(input).toHaveValue('CCC');
});

test('random molecule selection avoids revisiting recent entries before exhausting the current shuffled run', async ({ page }) => {
  await page.goto('/index.html');

  const picks = await page.evaluate(() => {
    Math.random = () => 0;
    const input = document.getElementById('smiles-input');
    const values = [];
    for (let index = 0; index < 4; index++) {
      window.pickRandomMolecule();
      values.push(input?.value ?? '');
    }
    return values;
  });

  expect(new Set(picks).size).toBe(4);
});

test('undo after pasting SMILES in InChI mode restores the prior InChI-backed molecule text', async ({ page }) => {
  await page.goto('/index.html');

  await page.locator('#inchi-mode-btn').click();
  await expect(page.locator('#inchi-mode-btn')).toHaveClass(/active/);

  await page.evaluate(() => {
    const entries = window.randomMolecule.filter(entry => entry.inchi);
    window.parseInput(entries[0].inchi);
    window.parseInput(entries[1].inchi);
  });

  const beforePaste = await page.locator('#smiles-input').inputValue();
  expect(beforePaste.startsWith('InChI=')).toBeTruthy();

  await page.evaluate(() => {
    const input = document.getElementById('smiles-input');
    input.focus();
    input.setSelectionRange(0, input.value.length);
    const data = new DataTransfer();
    data.setData('text/plain', 'CCC');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });

  await expect(page.locator('#smiles-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('#smiles-input')).toHaveValue('CCC');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#inchi-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('#smiles-input')).toHaveValue(beforePaste);
});

test('undo restores pasted SMILES after editing a pasted molecule that auto-switched out of InChI mode', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCN');
  await page.locator('#inchi-mode-btn').click();
  await expect(page.locator('#inchi-mode-btn')).toHaveClass(/active/);

  const input = page.locator('#smiles-input');
  await input.fill('CCO');
  await input.evaluate(element => {
    element.dispatchEvent(new Event('paste', { bubbles: true }));
  });
  await expect(page.locator('#smiles-mode-btn')).toHaveClass(/active/);
  await expect(input).toHaveValue('CCO');

  await page.locator('#erase-btn').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').hover();
  await page.keyboard.press('Delete');
  await expect(input).toHaveValue('CC');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-mode-btn')).toHaveClass(/active/);
  await expect(input).toHaveValue('CCO');
});

test('undo restores pasted SMILES after an immediate molecule change from InChI paste mode', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#inchi-mode-btn').click();
  await expect(page.locator('#inchi-mode-btn')).toHaveClass(/active/);

  await page.evaluate(() => {
    const input = document.getElementById('smiles-input');
    input.focus();
    input.setSelectionRange(0, input.value.length);
    const data = new DataTransfer();
    data.setData('text/plain', 'CCC');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    window.parseInput('CCN');
  });

  await expect(page.locator('#smiles-input')).toHaveValue('CCN');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('#smiles-input')).toHaveValue('CCC');
});

test('undo preserves localized aromatic rendering for anthracene after loading another molecule', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=CC2=CC3=CC=CC=C3C=C2C=C1');
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        dashed: document.querySelectorAll('line.bond-dashed').length,
        hits: document.querySelectorAll('line.bond-hit').length
      }))
    )
    .toEqual({ dashed: 0, hits: 16 });

  await loadSmiles(page, 'CCC');
  await expect(page.locator('#smiles-input')).toHaveValue('CCC');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('C1=CC2=CC3=CC=CC=C3C=C2C=C1');
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        dashed: document.querySelectorAll('line.bond-dashed').length,
        hits: document.querySelectorAll('line.bond-hit').length
      }))
    )
    .toEqual({ dashed: 0, hits: 16 });
});

test('undo preserves localized aromatic rendering for 2d-rotated aza-aromatic ring systems', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C(NC=N1)CC(C(=O)N[C@@H](CCCCN)C(=O)O)NC(=O)CN');
  await expect
    .poll(async () =>
      page.evaluate(() => ({
        dashed: document.querySelectorAll('line.bond-dashed').length
      }))
    )
    .toEqual({ dashed: 0 });

  await page.locator('#rotate-cw').click();
  await page.locator('#undo-btn').click();

  await expect
    .poll(async () =>
      page.evaluate(() => ({
        dashed: document.querySelectorAll('line.bond-dashed').length
      }))
    )
    .toEqual({ dashed: 0 });
});

test('undo preserves hidden stereo hydrogen rendering after loading a random molecule', async ({ page }) => {
  await page.goto('/index.html');

  const smiles = 'C1C[C@H]2[C@@H](C1)C=C[C@H]2O';
  await loadSmiles(page, smiles);

  const atomTransforms = async atomIds =>
    await page.evaluate(ids => Object.fromEntries(ids.map(id => [id, document.querySelector(`g[data-atom-id="${id}"]`)?.getAttribute('transform') ?? null])), atomIds);

  const stereoSignature = async () =>
    await page.evaluate(() => ({
      wedges: Array.from(document.querySelectorAll('polygon.bond-wedge')).map(element => element.getAttribute('points')),
      hashes: Array.from(document.querySelectorAll('line.bond-hash')).map(element => [
        element.getAttribute('x1'),
        element.getAttribute('y1'),
        element.getAttribute('x2'),
        element.getAttribute('y2')
      ])
    }));

  const before = await stereoSignature();
  expect(before.wedges.length + before.hashes.length).toBeGreaterThan(0);
  const beforeTransforms = await atomTransforms(['C3', 'H4', 'C5', 'H6']);
  expect(beforeTransforms.H4).not.toEqual(beforeTransforms.C3);
  expect(beforeTransforms.H6).not.toEqual(beforeTransforms.C5);

  await page.evaluate(() => window.pickRandomMolecule());
  await page.locator('#undo-btn').click();

  const after = await stereoSignature();
  const afterTransforms = await atomTransforms(['C3', 'H4', 'C5', 'H6']);
  expect(after).toEqual(before);
  expect(afterTransforms).toEqual(beforeTransforms);
  await expect(page.locator('#smiles-input')).toHaveValue(smiles);
});

test('renders stereo hydrogens away from their parent carbons on initial 2d load', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');

  const transforms = await page.evaluate(() => ({
    C3: document.querySelector('g[data-atom-id="C3"]')?.getAttribute('transform') ?? null,
    H4: document.querySelector('g[data-atom-id="H4"]')?.getAttribute('transform') ?? null,
    C5: document.querySelector('g[data-atom-id="C5"]')?.getAttribute('transform') ?? null,
    H6: document.querySelector('g[data-atom-id="H6"]')?.getAttribute('transform') ?? null
  }));

  expect(transforms.H4).not.toEqual(transforms.C3);
  expect(transforms.H6).not.toEqual(transforms.C5);
});

test('2D atom numbering follows projected stereochemical hydrogens away from parent bonds', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
  await page.locator('button.smarts-tab[data-tab="other"]').click();
  await page.locator('#atom-numbering-body tr').filter({ hasText: 'Atom Numbering' }).click();

  await expect(page.locator('g.atom-numbering-overlay text.atom-num[data-atom-id="H4"]')).toHaveCount(1);
  await expect(page.locator('g.atom-numbering-overlay text.atom-num[data-atom-id="H6"]')).toHaveCount(1);

  const geometry = await page.evaluate(() => {
    const parseTranslate = value => {
      const match = /^translate\(([-0-9.]+),([-0-9.]+)\)$/.exec(value ?? '');
      return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
    };
    const atomPoint = atomId => parseTranslate(document.querySelector(`g[data-atom-id="${atomId}"]`)?.getAttribute('transform'));
    const numberPoint = atomId => {
      const label = document.querySelector(`g.atom-numbering-overlay text.atom-num[data-atom-id="${atomId}"]`);
      return label
        ? {
            text: label.textContent ?? '',
            x: Number(label.getAttribute('x')),
            y: Number(label.getAttribute('y'))
          }
        : null;
    };
    const distanceToSegment = (point, start, end) => {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared > 0 ? Math.max(0, Math.min(1, (((point.x - start.x) * dx) + ((point.y - start.y) * dy)) / lengthSquared)) : 0;
      return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
    };
    const metricsFor = (hydrogenId, parentId) => {
      const hydrogen = atomPoint(hydrogenId);
      const parent = atomPoint(parentId);
      const number = numberPoint(hydrogenId);
      if (!hydrogen || !parent || !number) {
        return null;
      }
      const outwardDot = ((number.x - hydrogen.x) * (parent.x - hydrogen.x)) + ((number.y - hydrogen.y) * (parent.y - hydrogen.y));
      return {
        numberText: number.text,
        numberIsOutward: outwardDot < 0,
        numberCloserToHydrogenThanParent: Math.hypot(number.x - hydrogen.x, number.y - hydrogen.y) < Math.hypot(number.x - parent.x, number.y - parent.y),
        numberDistanceToBond: distanceToSegment(number, parent, hydrogen)
      };
    };
    return {
      visibleAtomCount: document.querySelectorAll('g.atom-labels g[data-atom-id]').length,
      numberCount: document.querySelectorAll('g.atom-numbering-overlay text.atom-num').length,
      H4: metricsFor('H4', 'C3'),
      H6: metricsFor('H6', 'C5')
    };
  });

  expect(geometry.numberCount).toBe(geometry.visibleAtomCount);
  for (const metrics of [geometry.H4, geometry.H6]) {
    expect(metrics).toBeTruthy();
    expect(metrics.numberText).toMatch(/^\d+$/);
    expect(metrics.numberIsOutward).toBe(true);
    expect(metrics.numberCloserToHydrogenThanParent).toBe(true);
    expect(metrics.numberDistanceToBond).toBeGreaterThan(8);
  }
});

test('dragging a projected stereo hydrogen follows the mouse in real time', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');

  const hydrogenHit = page.locator('g[data-atom-id="H4"] .atom-hit');
  await expect(hydrogenHit).toHaveCount(1);

  const startBox = await hydrogenHit.boundingBox();
  expect(startBox).toBeTruthy();

  const startX = startBox.x + startBox.width / 2;
  const startY = startBox.y + startBox.height / 2;
  const targetX = startX + 64;
  const targetY = startY - 42;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 10 });

  const duringBox = await hydrogenHit.boundingBox();
  expect(duringBox).toBeTruthy();
  const duringCenterX = duringBox.x + duringBox.width / 2;
  const duringCenterY = duringBox.y + duringBox.height / 2;
  expect(Math.abs(duringCenterX - targetX)).toBeLessThan(18);
  expect(Math.abs(duringCenterY - targetY)).toBeLessThan(18);

  await page.mouse.up();

  const afterBox = await hydrogenHit.boundingBox();
  expect(afterBox).toBeTruthy();
  const afterCenterX = afterBox.x + afterBox.width / 2;
  const afterCenterY = afterBox.y + afterBox.height / 2;
  expect(Math.abs(afterCenterX - targetX)).toBeLessThan(18);
  expect(Math.abs(afterCenterY - targetY)).toBeLessThan(18);
});

test('cleaning 2d after dragging a projected stereo hydrogen restores its default position', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');

  const hydrogenHit = page.locator('g[data-atom-id="H4"] .atom-hit');
  await expect(hydrogenHit).toHaveCount(1);

  const getTransform = async atomId => await page.evaluate(id => document.querySelector(`g[data-atom-id="${id}"]`)?.getAttribute('transform') ?? null, atomId);
  const initialTransform = await getTransform('H4');
  expect(initialTransform).not.toBeNull();

  const startBox = await hydrogenHit.boundingBox();
  expect(startBox).toBeTruthy();

  const startX = startBox.x + startBox.width / 2;
  const startY = startBox.y + startBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 64, startY - 42, { steps: 10 });
  await page.mouse.up();

  await expect.poll(async () => await getTransform('H4')).not.toEqual(initialTransform);

  await page.locator('#clean-2d-btn').click();

  await expect.poll(async () => await getTransform('H4')).toEqual(initialTransform);
});

test('deleting a displayed stereo hydrogen bond also removes the hydrogen in 2d', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
  await page.locator('#draw-bond-btn').click();

  await expect(page.locator('g[data-atom-id="H4"] .atom-hit')).toHaveCount(1);

  const hydrogenBondId = await page.evaluate(() => {
    const hydrogenGroup = document.querySelector('g[data-atom-id="H4"]');
    if (!hydrogenGroup) {
      return null;
    }
    const transform = hydrogenGroup.getAttribute('transform') ?? '';
    const match = transform.match(/translate\(([-\d.]+),([-\d.]+)\)/);
    if (!match) {
      return null;
    }
    const hx = Number(match[1]);
    const hy = Number(match[2]);
    let closestBondId = null;
    let closestDistance = Infinity;
    for (const group of document.querySelectorAll('g[data-bond-id]')) {
      const hit = group.querySelector('line.bond-hit');
      if (!hit) {
        continue;
      }
      const x1 = Number(hit.getAttribute('x1') ?? NaN);
      const y1 = Number(hit.getAttribute('y1') ?? NaN);
      const x2 = Number(hit.getAttribute('x2') ?? NaN);
      const y2 = Number(hit.getAttribute('y2') ?? NaN);
      const distance = Math.min(Math.hypot(x1 - hx, y1 - hy), Math.hypot(x2 - hx, y2 - hy));
      if (distance < closestDistance) {
        closestDistance = distance;
        closestBondId = group.getAttribute('data-bond-id');
      }
    }
    return closestDistance <= 12 ? closestBondId : null;
  });

  expect(hydrogenBondId).toBeTruthy();

  const hydrogenBondHit = page.locator(`g[data-bond-id="${hydrogenBondId}"] .bond-hit`);
  const bondBox = await hydrogenBondHit.boundingBox();
  expect(bondBox).toBeTruthy();
  await page.mouse.move(bondBox.x + bondBox.width / 2, bondBox.y + bondBox.height / 2);
  await page.keyboard.press('Delete');

  await expect(page.locator('g[data-atom-id="H4"]')).toHaveCount(0);
  await expect(page.locator('circle.valence-warning')).toHaveCount(0);
});

test('changing a dashed stereochemical hydrogen bond back to a single bond hides the hydrogen in 2d', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
  await page.locator('#draw-bond-btn').click();

  await expect(page.locator('g[data-atom-id="H4"] .atom-hit')).toHaveCount(1);

  const hydrogenBondId = await page.evaluate(() => {
    const hydrogenGroup = document.querySelector('g[data-atom-id="H4"]');
    if (!hydrogenGroup) {
      return null;
    }
    const transform = hydrogenGroup.getAttribute('transform') ?? '';
    const match = transform.match(/translate\(([-\d.]+),([-\d.]+)\)/);
    if (!match) {
      return null;
    }
    const hx = Number(match[1]);
    const hy = Number(match[2]);
    let closestBondId = null;
    let closestDistance = Infinity;
    for (const group of document.querySelectorAll('g[data-bond-id]')) {
      const hit = group.querySelector('line.bond-hit');
      if (!hit) {
        continue;
      }
      const x1 = Number(hit.getAttribute('x1') ?? NaN);
      const y1 = Number(hit.getAttribute('y1') ?? NaN);
      const x2 = Number(hit.getAttribute('x2') ?? NaN);
      const y2 = Number(hit.getAttribute('y2') ?? NaN);
      const distance = Math.min(Math.hypot(x1 - hx, y1 - hy), Math.hypot(x2 - hx, y2 - hy));
      if (distance < closestDistance) {
        closestDistance = distance;
        closestBondId = group.getAttribute('data-bond-id');
      }
    }
    return closestDistance <= 12 ? closestBondId : null;
  });

  expect(hydrogenBondId).toBeTruthy();

  const hydrogenBondHit = page.locator(`g[data-bond-id="${hydrogenBondId}"] .bond-hit`);
  const clickHydrogenBond = async () => {
    const bondBox = await hydrogenBondHit.boundingBox();
    expect(bondBox).toBeTruthy();
    await page.mouse.click(bondBox.x + bondBox.width / 2, bondBox.y + bondBox.height / 2);
  };

  await page.locator('#draw-bond-type-dash').click();
  await clickHydrogenBond();
  await expect.poll(async () => await page.locator(`g[data-bond-id="${hydrogenBondId}"] line.bond-hash`).count()).toBeGreaterThan(0);

  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-single').click();
  await clickHydrogenBond();

  await expect(page.locator('g[data-atom-id="H4"]')).toHaveCount(0);
  await expect(page.locator('circle.valence-warning')).toHaveCount(0);
});

test('incompatible bond orders on a displayed 2D stereochemical hydrogen are a no-op', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
  await page.locator('#draw-bond-btn').click();

  await expect(page.locator('g[data-atom-id="H4"] .atom-hit')).toHaveCount(1);

  const hydrogenBondId = await page.evaluate(() => {
    const hydrogenGroup = document.querySelector('g[data-atom-id="H4"]');
    if (!hydrogenGroup) {
      return null;
    }
    const transform = hydrogenGroup.getAttribute('transform') ?? '';
    const match = transform.match(/translate\(([-\d.]+),([-\d.]+)\)/);
    if (!match) {
      return null;
    }
    const hx = Number(match[1]);
    const hy = Number(match[2]);
    let closestBondId = null;
    let closestDistance = Infinity;
    for (const group of document.querySelectorAll('g[data-bond-id]')) {
      const hit = group.querySelector('line.bond-hit');
      if (!hit) {
        continue;
      }
      const x1 = Number(hit.getAttribute('x1') ?? NaN);
      const y1 = Number(hit.getAttribute('y1') ?? NaN);
      const x2 = Number(hit.getAttribute('x2') ?? NaN);
      const y2 = Number(hit.getAttribute('y2') ?? NaN);
      const distance = Math.min(Math.hypot(x1 - hx, y1 - hy), Math.hypot(x2 - hx, y2 - hy));
      if (distance < closestDistance) {
        closestDistance = distance;
        closestBondId = group.getAttribute('data-bond-id');
      }
    }
    return closestDistance <= 12 ? closestBondId : null;
  });

  expect(hydrogenBondId).toBeTruthy();

  const hydrogenBondHit = page.locator(`g[data-bond-id="${hydrogenBondId}"] .bond-hit`);
  const clickHydrogenBond = async () => {
    const bondBox = await hydrogenBondHit.boundingBox();
    expect(bondBox).toBeTruthy();
    await page.mouse.click(bondBox.x + bondBox.width / 2, bondBox.y + bondBox.height / 2);
  };

  const captureState = async () =>
    await page.evaluate(() => ({
      smiles: window._getMolSmiles?.() ?? null,
      wedgeCount: document.querySelectorAll('polygon.bond-wedge').length,
      hashCount: document.querySelectorAll('line.bond-hash').length,
      hydrogenCount: document.querySelectorAll('g[data-atom-id="H4"]').length
    }));

  const before = await captureState();

  for (const drawBondType of ['double', 'triple', 'aromatic']) {
    await page.locator('#draw-bond-btn').hover();
    await page.locator(`#draw-bond-type-${drawBondType}`).click();
    await clickHydrogenBond();
    await expect.poll(captureState).toEqual(before);
  }
});

test('clicking a displayed 2D stereochemical hydrogen with carbon, oxygen, or sulfur draw elements keeps the replacement atom off the parent carbon', async ({ page }) => {
  for (const drawElement of ['C', 'O', 'S']) {
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

    await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
    await page.locator('#draw-bond-btn').click();
    if (drawElement !== 'C') {
      await page.locator(`#elem-btn-${drawElement}`).click();
    }

    const hydrogenHit = page.locator('g[data-atom-id="H4"] .atom-hit');
    await expect(hydrogenHit).toHaveCount(1);
    await hydrogenHit.click();

    const separation = await page.evaluate(() => {
      const atomCenter = atomId => {
        const group = document.querySelector(`g[data-atom-id="${atomId}"]`);
        if (!group) {
          return null;
        }
        const hit = group.querySelector('.atom-hit');
        const rect = hit?.getBoundingClientRect?.() ?? group.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2
        };
      };
      const replacement = atomCenter('H4');
      const parent = atomCenter('C3');
      if (!replacement || !parent) {
        return null;
      }
      return Math.hypot(replacement.x - parent.x, replacement.y - parent.y);
    });

    expect(separation).not.toBeNull();
    expect(separation).toBeGreaterThan(10);
    if (drawElement !== 'C') {
      await expect.poll(async () => await page.locator('g[data-atom-id="H4"]').evaluate(node => node.textContent?.trim() ?? '')).toContain(drawElement);
    }
    await expect(page.locator('circle.valence-warning')).toHaveCount(0);
  }
});

test('2D draw-bond preview on a displayed stereochemical hydrogen starts at the rendered hydrogen position', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');
  await page.locator('#draw-bond-btn').click();

  const hydrogenHit = page.locator('g[data-atom-id="H4"] .atom-hit');
  await expect(hydrogenHit).toHaveCount(1);
  const renderedHydrogenPoint = await page.evaluate(() => {
    const hydrogenGroup = document.querySelector('g[data-atom-id="H4"]');
    const transform = hydrogenGroup?.getAttribute('transform') ?? '';
    const match = transform.match(/translate\(([-\d.]+),([-\d.]+)\)/);
    if (!match) {
      return null;
    }
    return {
      x: Number(match[1]),
      y: Number(match[2])
    };
  });
  expect(renderedHydrogenPoint).toBeTruthy();

  const hydrogenBox = await hydrogenHit.boundingBox();
  expect(hydrogenBox).toBeTruthy();
  const hx = hydrogenBox.x + hydrogenBox.width / 2;
  const hy = hydrogenBox.y + hydrogenBox.height / 2;

  await page.mouse.move(hx, hy);
  await page.mouse.down();

  const previewStart = await page.evaluate(() => {
    const segment = document.querySelector('g.draw-bond-preview line.draw-bond-preview-segment');
    if (!segment) {
      return null;
    }
    return {
      x: Number(segment.getAttribute('x1') ?? NaN),
      y: Number(segment.getAttribute('y1') ?? NaN)
    };
  });

  expect(previewStart).toBeTruthy();
  expect(Math.hypot(previewStart.x - renderedHydrogenPoint.x, previewStart.y - renderedHydrogenPoint.y)).toBeLessThan(3);

  await page.mouse.up();
});

test('cleaning 2d after dragging a carbonyl restores reasonable local carbonyl geometry', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O');

  const getAtomCenters = async atomIds =>
    await page.evaluate(
      ids =>
        Object.fromEntries(
          ids.map(id => {
            const rect = document.querySelector(`g[data-atom-id="${id}"] .atom-hit`)?.getBoundingClientRect();
            return [id, rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null];
          })
        ),
      atomIds
    );
  const carbonylMetrics = centers => {
    const dist = (first, second) => Math.hypot(first.x - second.x, first.y - second.y);
    const angle = (center, first, second) => {
      const v1x = first.x - center.x;
      const v1y = first.y - center.y;
      const v2x = second.x - center.x;
      const v2y = second.y - center.y;
      const dot = v1x * v2x + v1y * v2y;
      const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1;
      return Math.acos(Math.min(1, Math.max(-1, dot / mag))) * (180 / Math.PI);
    };
    return {
      C10C12: dist(centers.C10, centers.C12),
      C12O13: dist(centers.C12, centers.O13),
      C12O14: dist(centers.C12, centers.O14),
      O13C12O14: angle(centers.C12, centers.O13, centers.O14)
    };
  };

  const atomIds = ['C10', 'C12', 'O13', 'O14'];
  const initialCenters = await getAtomCenters(atomIds);
  const initialMetrics = carbonylMetrics(initialCenters);
  expect(initialCenters.O13).not.toBeNull();

  const oxygenHit = page.locator('g[data-atom-id="O13"] .atom-hit');
  const startBox = await oxygenHit.boundingBox();
  expect(startBox).toBeTruthy();

  const startX = startBox.x + startBox.width / 2;
  const startY = startBox.y + startBox.height / 2;
  const targetX = startX + 110;
  const targetY = startY + 75;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 12 });
  await page.mouse.up();

  const draggedCenters = await getAtomCenters(atomIds);
  expect(Math.hypot(draggedCenters.O13.x - initialCenters.O13.x, draggedCenters.O13.y - initialCenters.O13.y)).toBeGreaterThan(40);

  await page.locator('#clean-2d-btn').click();

  await expect
    .poll(async () => {
      const cleanedMetrics = carbonylMetrics(await getAtomCenters(atomIds));
      return (
        Math.abs(cleanedMetrics.O13C12O14 - initialMetrics.O13C12O14) < 1 &&
        Math.abs(cleanedMetrics.C10C12 - cleanedMetrics.C12O13) < 1.5 &&
        Math.abs(cleanedMetrics.C12O13 - cleanedMetrics.C12O14) < 1.5
      );
    })
    .toBe(true);
});

test('cleaning cocaine twice in 2d keeps the twice-cleaned layout readable and within the plot', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CN1C2CCC1C(C(OC)=O)C(OC(c3ccccc3)=O)C2');

  const layoutMetrics = async () =>
    await page.evaluate(() => {
      const lengths = Array.from(document.querySelectorAll('line.bond-hit'))
        .map(line => {
          const x1 = Number(line.getAttribute('x1') ?? NaN);
          const y1 = Number(line.getAttribute('y1') ?? NaN);
          const x2 = Number(line.getAttribute('x2') ?? NaN);
          const y2 = Number(line.getAttribute('y2') ?? NaN);
          return Math.hypot(x2 - x1, y2 - y1);
        })
        .filter(length => Number.isFinite(length) && length > 0);
      const plotRect = document.getElementById('plot')?.getBoundingClientRect();
      const atomCenters = Array.from(document.querySelectorAll('g[data-atom-id] .atom-hit'))
        .map(element => {
          const atomId = element.parentElement?.getAttribute('data-atom-id') ?? '';
          const rect = element.getBoundingClientRect();
          return {
            atomId,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
        })
        .filter(atom => atom.atomId && !atom.atomId.startsWith('H'));
      return {
        atomCount: atomCenters.length,
        bondCount: lengths.length,
        maxBondRatio: lengths.length ? Math.max(...lengths) / Math.min(...lengths) : Number.POSITIVE_INFINITY,
        inPlot:
          !!plotRect &&
          atomCenters.every(atom => atom.x >= plotRect.left - 4 && atom.x <= plotRect.right + 4 && atom.y >= plotRect.top - 4 && atom.y <= plotRect.bottom + 4)
      };
    });

  await page.locator('#clean-2d-btn').click();
  const firstCleanMetrics = await layoutMetrics();

  await page.locator('#clean-2d-btn').click();

  await expect
    .poll(async () => {
      const secondCleanMetrics = await layoutMetrics();
      return (
        secondCleanMetrics.atomCount === firstCleanMetrics.atomCount &&
        secondCleanMetrics.bondCount === firstCleanMetrics.bondCount &&
        secondCleanMetrics.inPlot &&
        secondCleanMetrics.maxBondRatio < 2.5 &&
        secondCleanMetrics.maxBondRatio <= firstCleanMetrics.maxBondRatio + 0.5
      );
    })
    .toBe(true);
});

test('dense bridged alkaloids do not render with catastrophic stretched bonds in 2d', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(
    page,
    'COC(=O)C1=C2Nc3ccccc3[C@@]24CCN5[C@@H]6O[C@]78[C@H]9C[C@]%10%11CCO[C@H]%10CCN%12CC[C@]7([C@H]%11%12)c%13cccc(OC)c%13N8C[C@]6(C9)[C@@H]%14OCC[C@]%14(C1)[C@@H]45'
  );

  await expect.poll(async () => await page.locator('g[data-atom-id] .atom-hit').count()).toBeGreaterThan(45);

  const bondMetrics = await page.evaluate(() => {
    const lengths = Array.from(document.querySelectorAll('line.bond-hit'))
      .map(line => {
        const x1 = Number(line.getAttribute('x1') ?? NaN);
        const y1 = Number(line.getAttribute('y1') ?? NaN);
        const x2 = Number(line.getAttribute('x2') ?? NaN);
        const y2 = Number(line.getAttribute('y2') ?? NaN);
        return Math.hypot(x2 - x1, y2 - y1);
      })
      .filter(length => Number.isFinite(length) && length > 0);
    return {
      count: lengths.length,
      min: Math.min(...lengths),
      max: Math.max(...lengths)
    };
  });

  expect(bondMetrics.count).toBeGreaterThan(50);
  expect(bondMetrics.max / bondMetrics.min).toBeLessThan(3.5);
  expect(await plotGeometryWithinPlot(page)).toBe(true);
});

test('undo restores selection mode and selected atoms as part of the app session', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#select-mode-btn').click();
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);

  await page.locator('g[data-atom-id="O3"] .atom-hit').click();
  const selectedCircleCount = await page.locator('g.atom-selection circle').count();
  expect(selectedCircleCount).toBeGreaterThan(0);

  await loadSmiles(page, 'CCC');
  await expect(page.locator('#smiles-input')).toHaveValue('CCC');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('g.atom-selection circle')).toHaveCount(selectedCircleCount);
});

test('undo after hovered delete in selection mode does not restore a sticky synthetic selection', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#select-mode-btn').click();
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);

  await page.locator('g[data-atom-id="O3"] .atom-hit').hover();
  await page.keyboard.press('Delete');
  await expect(page.locator('#smiles-input')).toHaveValue('CC');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('g.atom-selection circle')).toHaveCount(0);
});

test('undo after deleting a real selection restores the atoms without restoring the old selection', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#select-mode-btn').click();
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);

  await page.locator('g[data-atom-id="O3"] .atom-hit').click();
  await expect(page.locator('g.atom-selection circle')).not.toHaveCount(0);

  await page.keyboard.press('Delete');
  await expect(page.locator('#smiles-input')).toHaveValue('CC');
  await expect(page.locator('g.atom-selection circle')).toHaveCount(0);

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);
  await expect(page.locator('g.atom-selection circle')).toHaveCount(0);
});

test('drawing a new 2d bond clears an existing 2d selection highlight', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#select-mode-btn').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').click();
  await expect(page.locator('g.atom-selection circle')).not.toHaveCount(0);

  await page.locator('#draw-bond-btn').click();
  const oxygen = page.locator('g[data-atom-id="O3"] .atom-hit');
  const box = await oxygen.boundingBox();
  expect(box).toBeTruthy();

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 120, startY + 10, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator('#smiles-input')).toHaveValue('CCOC');
  await expect(page.locator('g.atom-selection circle')).toHaveCount(0);
  await expect(page.locator('g.atom-selection line')).toHaveCount(0);
});

test('cleaning a drawn 2d branch restores strict trigonal angles', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCC');
  await page.locator('#draw-bond-btn').click();

  const middleCarbon = page.locator('g[data-atom-id="C2"] .atom-hit');
  const box = await middleCarbon.boundingBox();
  if (!box) {
    throw new Error('Expected a drawable atom hit target for C2');
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 48, startY - 36, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('#smiles-input')).toHaveValue('CC(C)C');

  await page.locator('#clean-2d-btn').click();

  const centerAngles = await page.evaluate(() => {
    const centers = [...document.querySelectorAll('g[data-atom-id] .atom-hit')].map(el => {
      const rect = el.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    });
    if (centers.length < 4) {
      return null;
    }

    let bestAngles = null;
    let bestScore = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const center = centers[i];
      const neighbors = centers
        .filter((_, idx) => idx !== i)
        .map(point => ({
          ...point,
          dist: Math.hypot(point.x - center.x, point.y - center.y)
        }))
        .sort((a, b) => a.dist - b.dist)
        .slice(0, 3);
      if (neighbors.length !== 3) {
        continue;
      }

      const angles = [];
      for (let j = 0; j < neighbors.length; j++) {
        for (let k = j + 1; k < neighbors.length; k++) {
          const a = neighbors[j];
          const b = neighbors[k];
          const v1x = a.x - center.x;
          const v1y = a.y - center.y;
          const v2x = b.x - center.x;
          const v2y = b.y - center.y;
          const dot = v1x * v2x + v1y * v2y;
          const mag = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y) || 1;
          angles.push(Math.acos(Math.min(1, Math.max(-1, dot / mag))) * (180 / Math.PI));
        }
      }

      const score = Math.max(...angles.map(angle => Math.abs(angle - 120)));
      if (score < bestScore) {
        bestScore = score;
        bestAngles = angles;
      }
    }

    return bestAngles;
  });

  expect(centerAngles).toBeTruthy();
  for (const angle of centerAngles) {
    expect(Math.abs(angle - 120)).toBeLessThan(5);
  }
});

test('editing a 2d atom clears selection and immediately restores the hovered highlight', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#select-mode-btn').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').click();
  await expect(page.locator('g.atom-selection circle')).not.toHaveCount(0);

  await page.locator('g[data-atom-id="O3"] .atom-hit').hover();
  await page.keyboard.press('N');

  await expect(page.locator('#smiles-input')).toHaveValue('CCN');
  await expect(page.locator('g.atom-selection circle')).not.toHaveCount(0);
  await expect(page.locator('g.atom-selection line')).toHaveCount(0);
});

test('changing a 2d bond immediately restores the hovered highlight', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#draw-bond-btn').click();
  await expect(page.locator('#draw-bond-btn')).toHaveClass(/active/);

  const targetBond = page.locator('line.bond-hit').nth(1);
  await targetBond.hover();
  await targetBond.click();

  await expect(page.locator('#smiles-input')).toHaveValue('CC=O');
  await expect(page.locator('g.atom-selection line')).not.toHaveCount(0);
});

test('2d line mode increases the atom hit target radius', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');

  const atomHit = page.locator('g[data-atom-id="O3"] .atom-hit');
  const baseRadius = Number(await atomHit.getAttribute('r'));
  expect(Number.isFinite(baseRadius)).toBeTruthy();

  await page.locator('#draw-bond-btn').click();

  const drawModeRadius = Number(await page.locator('g[data-atom-id="O3"] .atom-hit').getAttribute('r'));
  expect(drawModeRadius).toBeGreaterThan(baseRadius);
});

test('physicochemical row locks do not persist through undo and redo', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Physicochemical' }).click();

  const fsp3Row = page.locator('#pc-body tr').filter({ hasText: 'Fsp3 (carbons)' }).first();
  await expect(fsp3Row).toBeVisible();
  await fsp3Row.click();
  await expect(fsp3Row).toHaveClass(/pc-hover/);

  await loadSmiles(page, 'CCC');
  await page.locator('#undo-btn').click();
  await expect(fsp3Row).not.toHaveClass(/pc-hover/);

  await page.locator('#redo-btn').click();
  await page.locator('#undo-btn').click();
  await expect(fsp3Row).not.toHaveClass(/pc-hover/);
});

test('the resonance tab does not persist through undo and redo', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C1=CC=CC=C1');
  await page.getByRole('button', { name: 'Other' }).click();
  await expect(page.getByRole('button', { name: 'Other' })).toHaveClass(/active/);

  await loadSmiles(page, 'CCO');
  await page.locator('#undo-btn').click();

  await expect(page.getByRole('button', { name: 'Functional Groups' })).toHaveClass(/active/);
  await expect(page.getByRole('button', { name: 'Other' })).not.toHaveClass(/active/);
});

test('functional group rows stay visible when selecting one during reaction preview', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const reactionRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await reactionRow.click();
  await expect(reactionRow).toHaveClass(/reaction-active/);

  await page.getByRole('button', { name: 'Functional Groups' }).click();
  const beforeCount = await page.locator('#fg-body tr').count();
  expect(beforeCount).toBeGreaterThan(0);

  const alcoholRow = page.locator('#fg-body tr').filter({ hasText: 'Alcohol' }).first();
  await alcoholRow.click();

  await expect(page.locator('#fg-body tr')).toHaveCount(beforeCount);
});

test('delete key removes a hovered atom while erase mode is active', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');

  await page.locator('#erase-btn').click();
  await expect(page.locator('#erase-btn')).toHaveClass(/active/);

  await page.locator('g[data-atom-id="O3"] .atom-hit').hover();
  await page.keyboard.press('Delete');

  await expect(page.locator('#smiles-input')).toHaveValue('CC');
});

test('delete key removes a hovered atom while draw mode is active', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');

  await page.locator('#draw-bond-btn').click();
  await expect(page.locator('#draw-bond-btn')).toHaveClass(/active/);

  await page.locator('g[data-atom-id="O3"] .atom-hit').hover();
  await page.keyboard.press('Delete');

  await expect(page.locator('#smiles-input')).toHaveValue('CC');
});

test('delete key removes a hovered bond while draw mode is active', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await expect(page.locator('line.bond-hit')).toHaveCount(2);

  await page.locator('#draw-bond-btn').click();
  await expect(page.locator('#draw-bond-btn')).toHaveClass(/active/);

  await page.locator('line.bond-hit').nth(1).hover();
  await page.keyboard.press('Delete');

  await expect(page.locator('line.bond-hit')).toHaveCount(1);
});

test('delete key is a no-op for a hovered force hydrogen while draw mode is active', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await page.locator('#draw-bond-btn').click();

  const beforeAttempt = await page.locator('#smiles-input').inputValue();
  const forceAtoms = await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
    return circles.map((circle, index) => {
      const rect = circle.getBoundingClientRect();
      const label = labels[index]?.textContent?.trim() ?? '';
      return {
        label,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2
      };
    });
  });
  const hydrogenTarget = [...forceAtoms].find(atom => atom.label === 'H');
  expect(hydrogenTarget).toBeTruthy();

  await page.mouse.move(hydrogenTarget.cx, hydrogenTarget.cy);
  await page.keyboard.press('Delete');

  await expect(page.locator('#smiles-input')).toHaveValue(beforeAttempt);
});

test('delete key is a no-op for a hovered force C-H bond while draw mode is active', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await page.locator('#draw-bond-btn').click();

  const beforeAttempt = await page.locator('#smiles-input').inputValue();
  const forceAtoms = await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
    return circles.map((circle, index) => {
      const rect = circle.getBoundingClientRect();
      const label = labels[index]?.textContent?.trim() ?? '';
      return {
        label,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2
      };
    });
  });
  const hydrogenTarget = forceAtoms.find(atom => atom.label === 'H') ?? null;
  expect(hydrogenTarget).toBeTruthy();
  const nearestCarbon = forceAtoms
    .filter(atom => atom.label === 'C')
    .sort((a, b) => Math.hypot(a.cx - hydrogenTarget.cx, a.cy - hydrogenTarget.cy) - Math.hypot(b.cx - hydrogenTarget.cx, b.cy - hydrogenTarget.cy))[0];
  expect(nearestCarbon).toBeTruthy();

  await page.mouse.move((hydrogenTarget.cx + nearestCarbon.cx) / 2, (hydrogenTarget.cy + nearestCarbon.cy) / 2);
  await page.keyboard.press('Delete');

  await expect(page.locator('#smiles-input')).toHaveValue(beforeAttempt);
});

test('drawing a new force bond keeps the force scene visible', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await expect(page.locator('circle.node')).toHaveCount(9);

  await page.locator('#draw-bond-btn').click();
  await expect(page.locator('#draw-bond-btn')).toHaveClass(/active/);

  const forceAtoms = await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
    return circles.map((circle, index) => {
      const rect = circle.getBoundingClientRect();
      const label = labels[index]?.textContent?.trim() ?? '';
      return {
        label,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2
      };
    });
  });
  const carbonSource = [...forceAtoms].filter(atom => atom.label === 'C').sort((a, b) => a.cx - b.cx)[0] ?? null;
  expect(carbonSource).toBeTruthy();

  await page.mouse.move(carbonSource.cx, carbonSource.cy);
  await page.mouse.down();
  await page.mouse.move(carbonSource.cx - 70, carbonSource.cy - 35, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('circle.node')).toHaveCount(12);
  await expect(page.locator('.svg-plot > g')).toBeVisible();
  await expect(page.locator('#smiles-input')).toHaveValue(/C/);
});

test('clean in force mode re-idealizes a dragged force layout', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await expect(page.locator('circle.node')).toHaveCount(9);

  const beforeDrag = await forceAtomScreenPoints(page);
  const carbonSource = [...beforeDrag].filter(atom => atom.label === 'C').sort((a, b) => a.cx - b.cx)[0] ?? null;
  expect(carbonSource).toBeTruthy();

  await page.mouse.move(carbonSource.cx, carbonSource.cy);
  await page.mouse.down();
  await page.mouse.move(carbonSource.cx + 120, carbonSource.cy + 30, { steps: 10 });
  await page.mouse.up();

  const afterDrag = await forceAtomScreenPoints(page);
  const dragShift = Math.max(...afterDrag.map((atom, index) => Math.hypot(atom.cx - beforeDrag[index].cx, atom.cy - beforeDrag[index].cy)));
  expect(dragShift).toBeGreaterThan(40);

  await page.locator('#clean-force-btn').click();

  await expect
    .poll(async () => {
      const afterClean = await forceAtomScreenPoints(page);
      return Math.max(...afterClean.map((atom, index) => Math.hypot(atom.cx - afterDrag[index].cx, atom.cy - afterDrag[index].cy)));
    })
    .toBeGreaterThan(20);
});

test('clean in force mode preserves the current handedness of a dragged acyclic layout', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await expect(page.locator('circle.node')).toHaveCount(9);

  const beforeDrag = await forceAtomScreenPoints(page);
  const oxygen = beforeDrag.find(atom => atom.id === 'O3');
  expect(oxygen).toBeTruthy();

  await page.mouse.move(oxygen.cx, oxygen.cy);
  await page.mouse.down();
  await page.mouse.move(oxygen.cx, oxygen.cy + 90, { steps: 10 });
  await page.mouse.up();

  const afterDrag = await forceAtomScreenPoints(page);
  const dragArea = signedTriangleArea(afterDrag, 'C1', 'C2', 'O3');
  expect(Math.abs(dragArea)).toBeGreaterThan(100);

  await page.locator('#clean-force-btn').click();

  await expect
    .poll(async () => {
      const afterClean = await forceAtomScreenPoints(page);
      return Math.sign(signedTriangleArea(afterClean, 'C1', 'C2', 'O3'));
    })
    .toBe(Math.sign(dragArea));
});

test('editing a force atom updates the implicit hydrogens around the edited atom', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await expect(page.locator('circle.node')).toHaveCount(6);
  await page.locator('#select-mode-btn').click();
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);

  const forceAtoms = await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
    return circles.map((circle, index) => {
      const rect = circle.getBoundingClientRect();
      const label = labels[index]?.textContent?.trim() ?? '';
      return {
        label,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2
      };
    });
  });
  const oxygenTarget = [...forceAtoms].filter(atom => atom.label === 'O').sort((a, b) => b.cx - a.cx)[0] ?? null;
  expect(oxygenTarget).toBeTruthy();

  await page.mouse.move(oxygenTarget.cx, oxygenTarget.cy);
  await page.keyboard.press('C');

  await expect(page.locator('#smiles-input')).toHaveValue('CC');
  await expect(page.locator('circle.node')).toHaveCount(8);
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const circles = Array.from(document.querySelectorAll('circle.node'));
        const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
        const atoms = circles.map((circle, index) => {
          const rect = circle.getBoundingClientRect();
          return {
            label: labels[index]?.textContent?.trim() ?? '',
            cx: rect.left + rect.width / 2,
            cy: rect.top + rect.height / 2
          };
        });
        const carbons = atoms.filter(atom => atom.label === 'C').sort((a, b) => b.cx - a.cx);
        const hydrogens = atoms.filter(atom => atom.label === 'H');
        const editedCarbon = carbons[0] ?? null;
        if (!editedCarbon) {
          return 0;
        }
        return hydrogens.filter(atom => Math.hypot(atom.cx - editedCarbon.cx, atom.cy - editedCarbon.cy) < 45).length;
      })
    )
    .toBeGreaterThanOrEqual(3);
});

test('reaction preview can be entered and toggled back off from the reactions table', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await expect(dehydrationRow).toBeVisible();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await dehydrationRow.click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
});

test('cleaning a 2d carboxylic-acid deprotonation preview preserves the displayed product layout', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'O=C(O)C1=C2C=CCC2C=C1');

  await page.getByRole('button', { name: 'Reactions' }).click();
  const deprotonationRow = page.locator('#reaction-body tr').filter({ hasText: 'Carboxylic Acid Deprotonation' }).first();

  await expect(deprotonationRow).toBeVisible();
  await deprotonationRow.click();
  await expect(deprotonationRow).toHaveClass(/reaction-active/);

  const beforeSignature = await bondSignature(page);
  const beforeTexts = await page.evaluate(() => [...document.querySelectorAll('#plot text')].map(el => el.textContent));

  await page.locator('#clean-2d-btn').click();
  await expect(deprotonationRow).toHaveClass(/reaction-active/);

  const afterSignature = await bondSignature(page);
  const afterTexts = await page.evaluate(() => [...document.querySelectorAll('#plot text')].map(el => el.textContent));

  expect(afterSignature).toEqual(beforeSignature);
  expect(afterTexts).toEqual(beforeTexts);
});

test('reaction preview ignores a disconnected 2d draw after it has been undone', async ({ page }) => {
  await page.goto('/index.html');

  const initialSmiles = 'CC(=O)C(Cl)CC(C(C)C)C=C';
  await expect(page.locator('#smiles-input')).toHaveValue(initialSmiles);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const hydrogenationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alkene Hydrogenation' }).first();
  await expect(hydrogenationRow).toBeVisible();

  await hydrogenationRow.click();
  await expect(hydrogenationRow).toHaveClass(/reaction-active/);
  const baselinePreview = JSON.stringify(await bondSignature(page));

  await hydrogenationRow.click();
  await expect(hydrogenationRow).not.toHaveClass(/reaction-active/);

  await page.locator('#draw-bond-btn').click();
  const plotBox = await page.locator('#plot').boundingBox();
  expect(plotBox).toBeTruthy();
  await page.mouse.click(plotBox.x + plotBox.width - 120, plotBox.y + plotBox.height - 120);

  await expect(page.locator('#smiles-input')).not.toHaveValue(initialSmiles);
  await expect(page.locator('#smiles-input')).toHaveValue(/\./);

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue(initialSmiles);

  await hydrogenationRow.click();
  await expect(hydrogenationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => JSON.stringify(await bondSignature(page))).toBe(baselinePreview);
});

test('exiting reaction preview restores the prior 2d zoom transform', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

  await loadSmiles(page, 'CCO');
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await expect(dehydrationRow).toBeVisible();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforePreview);

  await dehydrationRow.click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).toBe(beforePreview);
});

test('exiting reaction preview restores a manually zoomed 2d transform', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });

  await loadSmiles(page, 'CCO');
  await page.mouse.wheel(0, -900);
  const beforePreview = await rootTransform(page);
  const beforePreviewBonds = await bondSignature(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforePreview);

  await dehydrationRow.click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).toBe(beforePreview);
  await expect.poll(async () => JSON.stringify(await bondSignature(page))).toBe(JSON.stringify(beforePreviewBonds));
});

test('editing from reaction preview restores the pre-preview 2d zoom transform', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforePreview);

  await page.locator('#draw-bond-btn').click();
  const oxygen = page.locator('g[data-atom-id="O3"] .atom-hit');
  const box = await oxygen.boundingBox();
  expect(box).toBeTruthy();

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY - 50, { steps: 10 });
  await page.mouse.up();

  await expect(page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' })).toHaveCount(0);
  await expect.poll(async () => await rootTransform(page)).toBe(beforePreview);
});

test('exiting reaction preview restores the prior force zoom transform', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforePreview);

  await dehydrationRow.click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).toBe(beforePreview);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
});

test('resizing the window in force layout keeps the molecule in view', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCCCCCCCCCCCCCCCCCCC');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await expect.poll(async () => await forceNodesWithinPlot(page, 2)).toBe(true);

  await page.setViewportSize({ width: 560, height: 520 });

  await expect.poll(async () => await forceNodesWithinPlot(page, 2)).toBe(true);
});

test('resizing the window in 2d reaction preview keeps the preview active', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  const beforeResize = await rootTransform(page);

  await page.setViewportSize({ width: 560, height: 520 });

  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforeResize);
  await expect.poll(async () => await plotGeometryWithinPlot(page, 2)).toBe(true);
  await expect(page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' })).toHaveCount(1);
});

test('exiting reaction preview after switching from force back to 2d restores the 2d zoom transform', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  const beforeForcePreview = await rootTransform(page);

  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforeForcePreview);

  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('Force');
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await dehydrationRow.click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).toBe(beforeForcePreview);
});

test('reaction preview entry participates in undo and redo', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await expect(dehydrationRow).toBeVisible();
  const beforePreviewBondCount = await page.locator('line.bond-hit').count();

  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  const previewBondCount = await page.locator('line.bond-hit').count();
  expect(previewBondCount).toBeGreaterThan(beforePreviewBondCount);

  await page.locator('#undo-btn').click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect(page.locator('line.bond-hit')).toHaveCount(beforePreviewBondCount);

  await page.locator('#redo-btn').click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect(page.locator('line.bond-hit')).toHaveCount(previewBondCount);
});

test('reaction preview site navigation updates the active site count label', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'OCCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();

  await expect(dehydrationRow).toBeVisible();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect(page.locator('#reaction-body tr.reaction-active .reaction-site-label')).toHaveText('1/2');

  await dehydrationRow.locator('button[title="Next reaction site"]').click();
  await expect(page.locator('#reaction-body tr.reaction-active .reaction-site-label')).toHaveText('2/2');

  await page.locator('#reaction-body tr.reaction-active button[title="Previous reaction site"]').click();
  await expect(page.locator('#reaction-body tr.reaction-active .reaction-site-label')).toHaveText('1/2');
});

test('reaction preview does not change the molecular weight summary', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  const beforeWeight = await page.locator('#molecularWeight').textContent();

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect(page.locator('#molecularWeight')).toHaveText(beforeWeight ?? '');
});

test('reaction preview functional groups apply to the full preview molecule', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Functional Groups' }).click();
  await expect(page.locator('#fg-body tr').filter({ hasText: 'Carbonyl' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const oxidationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Oxidation' }).first();
  await oxidationRow.click();
  await expect(oxidationRow).toHaveClass(/reaction-active/);

  await page.getByRole('button', { name: 'Functional Groups' }).click();
  await expect(page.locator('#fg-body tr').filter({ hasText: 'Alcohol' })).toHaveCount(1);
  await expect(page.locator('#fg-body tr').filter({ hasText: 'Carbonyl' })).toHaveCount(1);
  await expect(page.locator('#fg-body tr').filter({ hasText: 'Aldehyde' })).toHaveCount(1);
});

test('switching SMILES/InChI format in reaction preview keeps the source molecule input', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await page.locator('#inchi-mode-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3');

  await page.locator('#smiles-mode-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
});

test('mode toggle participates in undo and redo', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  const toggleButton = page.locator('#toggle-btn');

  await expect(toggleButton).toHaveText('⚡ Force Layout');
  await toggleButton.click();
  await expect(toggleButton).toHaveText('⬡ 2D Structure');

  await page.locator('#undo-btn').click();
  await expect(toggleButton).toHaveText('⚡ Force Layout');

  await page.locator('#redo-btn').click();
  await expect(toggleButton).toHaveText('⬡ 2D Structure');
});

test('undo after mode toggle restores the prior 2d zoom transform', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);

  await expect.poll(async () => rootTransform(page)).not.toBe('translate(0,0) scale(1)');
  const beforeToggle = await rootTransform(page);
  const toggleButton = page.locator('#toggle-btn');
  await toggleButton.click();
  await expect(toggleButton).toHaveText('⬡ 2D Structure');

  await page.locator('#undo-btn').click();
  await expect(toggleButton).toHaveText('⚡ Force Layout');
  await expect.poll(async () => rootTransform(page)).toBe(beforeToggle);
});

test('undo and redo preserve 2d zoom after a simple atom edit', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);
  await expect.poll(async () => rootTransform(page)).not.toBe('translate(0,0) scale(1)');
  const beforeEdit = await rootTransform(page);

  await page.locator('#elem-btn-N').click();
  await page.locator('circle.atom-hit').first().click();
  await expect(page.locator('#smiles-input')).not.toHaveValue('CCO');
  const afterEdit = await rootTransform(page);
  await expect(afterEdit).toBe(beforeEdit);

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
  await expect.poll(async () => rootTransform(page)).toBe(beforeEdit);

  await page.locator('#redo-btn').click();
  await expect(page.locator('#smiles-input')).not.toHaveValue('CCO');
  await expect.poll(async () => rootTransform(page)).toBe(beforeEdit);
});

test('redo restores the fitted 2d zoom for a newly loaded molecule', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);
  await expect.poll(async () => rootTransform(page)).not.toBe('translate(0,0) scale(1)');
  const beforeLoad = await rootTransform(page);

  await loadSmiles(page, 'CCCC');
  await expect(page.locator('#smiles-input')).toHaveValue('CCCC');
  const afterLoad = await rootTransform(page);
  await expect(afterLoad).not.toBe(beforeLoad);

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
  await expect.poll(async () => rootTransform(page)).toBe(beforeLoad);

  await page.locator('#redo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCCC');
  await expect.poll(async () => rootTransform(page)).toBe(afterLoad);
});

test('reaction preview entry refits 2d zoom and redo restores that preview fit', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);
  await expect.poll(async () => rootTransform(page)).not.toBe('translate(0,0) scale(1)');
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  const previewTransform = await rootTransform(page);
  await expect(previewTransform).not.toBe(beforePreview);

  await page.locator('#undo-btn').click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
  await expect.poll(async () => rootTransform(page)).toBe(beforePreview);

  await page.locator('#redo-btn').click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => rootTransform(page)).toBe(previewTransform);
});

test('reaction preview entry refits force zoom', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => rootTransform(page)).not.toBe(beforePreview);
});

test('clean in force mode preserves the aromatic-aza-protonation product on the right side of the reaction preview', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'N1C=NC2=C1N=CN2[C@H]3C[C@H](O)[C@@H](CO)O3');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');

  await page.getByRole('button', { name: 'Reactions' }).click();
  const protonationRow = page.locator('#reaction-body tr').filter({ hasText: 'Aromatic Aza Protonation' }).first();
  await expect(protonationRow).toBeVisible();
  await protonationRow.click();
  await expect(protonationRow).toHaveClass(/reaction-active/);

  const beforeDelta = await forceReactionPreviewHorizontalDelta(page);
  expect(beforeDelta).toBeGreaterThan(20);

  await page.locator('#clean-force-btn').click();
  await expect(protonationRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => forceReactionPreviewHorizontalDelta(page)).toBeGreaterThan(20);
});

test('force-mode reaction preview rotation keeps the reaction arrow visible', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'O=C(O)C1=C2C=CCC2C=C1');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');

  await page.getByRole('button', { name: 'Reactions' }).click();
  const hydrogenationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alkene Hydrogenation' }).first();
  await expect(hydrogenationRow).toBeVisible();
  await hydrogenationRow.click();
  await expect(hydrogenationRow).toHaveClass(/reaction-active/);
  await expect(page.locator('g.reaction-preview-arrow')).toHaveCount(1);

  const rotateButton = page.locator('#force-rotate-cw');
  const box = await rotateButton.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();

  let minArrowCount = Infinity;
  for (let i = 0; i < 25; i++) {
    await page.waitForTimeout(80);
    minArrowCount = Math.min(minArrowCount, await page.locator('g.reaction-preview-arrow').count());
  }
  await page.mouse.up();

  expect(minArrowCount).toBe(1);
});

test('undoing a force-mode molecule change still allows switching back to a visible 2d structure', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await expect(page.locator('line.bond-hit')).toHaveCount(2);

  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');

  await loadSmiles(page, 'CCC');
  await expect(page.locator('#smiles-input')).toHaveValue('CCC');

  await page.locator('#undo-btn').click();
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');

  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⚡ Force Layout');
  await expect(page.locator('line.bond-hit')).toHaveCount(2);
  await expect(page.locator('circle.atom-hit')).toHaveCount(3);
});

test('reaction preview redo restores the rotated preview geometry', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  const beforeRotate = await bondSignature(page);
  await page.locator('#rotate-cw').click();
  const afterRotate = await bondSignature(page);
  await expect(afterRotate).not.toEqual(beforeRotate);

  await page.locator('#undo-btn').click();
  const afterUndo = await bondSignature(page);
  await expect(afterUndo).toEqual(beforeRotate);
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await page.locator('#redo-btn').click();
  const afterRedo = await bondSignature(page);
  await expect(afterRedo).toEqual(afterRotate);
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
});

test('clicking a resonance structure from force reaction preview restores the pre-preview force zoom and keeps the molecule in view', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC(=O)C(Cl)CC(C(C)C)C=C');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const reductionRow = page.locator('#reaction-body tr').filter({ hasText: 'Carbonyl Reduction' }).first();
  await expect(reductionRow).toBeVisible();
  await reductionRow.click();
  await expect(reductionRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforePreview);

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect.poll(async () => await page.locator('.charge-label-text').count()).toBeGreaterThan(0);
  await expect.poll(async () => rootTransform(page)).toBe(beforePreview);
  await expect.poll(async () => await forceNodesWithinPlot(page)).toBe(true);
});

test('clicking a resonance structure from 2d reaction preview restores the pre-preview zoom', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.locator('#plot').hover();
  await page.mouse.wheel(0, -900);
  const beforePreview = await rootTransform(page);

  await page.getByRole('button', { name: 'Reactions' }).click();
  const reductionRow = page.locator('#reaction-body tr').filter({ hasText: 'Carbonyl Reduction' }).first();
  await expect(reductionRow).toBeVisible();
  await reductionRow.click();
  await expect(reductionRow).toHaveClass(/reaction-active/);
  await expect.poll(async () => await rootTransform(page)).not.toBe(beforePreview);

  await page.getByRole('button', { name: 'Other' }).click();
  const resonanceRow = page.locator('#resonance-body tr').filter({ hasText: 'Resonance Structures' }).first();
  await expect(resonanceRow).toBeVisible();
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect.poll(async () => await page.locator('.atom-charge-text').count()).toBeGreaterThan(0);
  await expect.poll(async () => rootTransform(page)).toBe(beforePreview);
});

test('bond electronegativity toggle does not exit reaction preview', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const reductionRow = page.locator('#reaction-body tr').filter({ hasText: 'Carbonyl Reduction' }).first();
  await reductionRow.click();
  await expect(reductionRow).toHaveClass(/reaction-active/);
  const previewBondCount = await page.locator('line.bond-hit').count();

  await page.getByRole('button', { name: 'Other' }).click();
  const bondEnRow = page.locator('#bond-en-body tr').filter({ hasText: 'Bond Electronegativity' }).first();
  await expect(bondEnRow).toBeVisible();
  await bondEnRow.click();
  await expect(bondEnRow).toHaveClass(/resonance-active/);

  await page.getByRole('button', { name: 'Reactions' }).click();
  await expect(reductionRow).toHaveClass(/reaction-active/);
  await expect(page.locator('line.bond-hit')).toHaveCount(previewBondCount);
});

test('force SVG export includes charge labels', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/index.html');

  await loadSmiles(page, 'C[NH3+]');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await expect(page.locator('g.charge-label')).toHaveCount(1);

  await page.locator('#copy-force-svg-btn').click();

  const readForceSvgClipboard = async () =>
    page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (!item.types.includes('image/svg+xml')) {
          continue;
        }
        const blob = await item.getType('image/svg+xml');
        return await blob.text();
      }
      return '';
    });

  await expect.poll(readForceSvgClipboard).not.toBe('');
  const svgText = await readForceSvgClipboard();

  expect(svgText).toContain('charge-label');
  expect(svgText).toContain('charge-label-text');
  expect(svgText).not.toContain('-9999');
  expect(svgText).not.toContain('<line></line>');
});

test('flipping the view swaps wedge and dash stereo display', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'C[C@H](F)Cl');
  const beforeFlip = await stereoGlyphState(page);
  expect(beforeFlip.wedgeCount + beforeFlip.hashCount).toBeGreaterThan(0);

  await page.locator('#flip-h').click();
  const afterHorizontalFlip = await stereoGlyphState(page);
  expect(afterHorizontalFlip.wedgeCount).toBe(beforeFlip.hashCount > 0 ? 1 : 0);
  expect(afterHorizontalFlip.hashCount > 0).toBe(beforeFlip.wedgeCount > 0);

  await page.locator('#flip-v').click();
  const afterVerticalFlip = await stereoGlyphState(page);
  expect(afterVerticalFlip).toEqual(beforeFlip);
});

test('undo after editing from reaction preview restores the locked preview state', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await page.locator('#draw-bond-btn').click();
  await page.locator('#elem-btn-Cl').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').click();

  await expect(page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' })).toHaveCount(0);

  await page.locator('#undo-btn').click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
});

test('undo after dragging from reaction preview restores the locked preview state', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  const atomHit = page.locator('g[data-atom-id="O3"] .atom-hit').first();
  const beforeDrag = await bondSignature(page);
  const box = await atomHit.boundingBox();
  if (!box) {
    throw new Error('Expected a draggable atom hit target for O3');
  }

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();

  const afterDrag = await bondSignature(page);
  await expect(afterDrag).not.toEqual(beforeDrag);

  await page.locator('#undo-btn').click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  const afterUndo = await bondSignature(page);
  await expect(afterUndo).toEqual(beforeDrag);
});

test('dragging a bond onto a hydrogen from reaction preview is a no-op', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toHaveText('⬡ 2D Structure');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  await page.locator('#draw-bond-btn').click();
  const beforeAttempt = await bondSignature(page);
  const dragPair = await page.evaluate(() => {
    const snapRadius = 30;
    const atoms = Array.from(document.querySelectorAll('circle.node')).map(circle => {
      const rect = circle.getBoundingClientRect();
      const datum = circle.__data__ ?? {};
      return {
        id: datum.id ?? null,
        label: datum.name ?? '',
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2
      };
    });
    const reactantAtoms = atoms.filter(atom => typeof atom.id === 'string' && !atom.id.startsWith('__rxn_product__'));
    const heavyReactants = reactantAtoms.filter(atom => atom.label !== 'H');
    const reactantCarbons = heavyReactants.filter(atom => atom.label === 'C').sort((a, b) => a.cx - b.cx);

    for (const carbon of reactantCarbons) {
      const safeHydrogens = reactantAtoms
        .filter(atom => atom.label === 'H')
        .map(atom => {
          const competingHeavyDistances = heavyReactants
            .filter(other => other.id !== carbon.id)
            .map(other => Math.hypot(atom.cx - other.cx, atom.cy - other.cy));
          return {
            ...atom,
            competingHeavyDistance: competingHeavyDistances.length ? Math.min(...competingHeavyDistances) : Infinity
          };
        })
        .filter(atom => atom.competingHeavyDistance > snapRadius + 1)
        .sort((a, b) => b.competingHeavyDistance - a.competingHeavyDistance);
      if (safeHydrogens.length > 0) {
        return {
          carbonSource: carbon,
          hydrogenTarget: safeHydrogens[0]
        };
      }
    }

    return null;
  });
  expect(dragPair).toBeTruthy();
  const { carbonSource, hydrogenTarget } = dragPair;

  await page.mouse.move(carbonSource.cx, carbonSource.cy);
  await page.mouse.down();
  await page.mouse.move(hydrogenTarget.cx, hydrogenTarget.cy, { steps: 8 });
  await page.mouse.up();

  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect(await bondSignature(page)).toEqual(beforeAttempt);

  await page.locator('#undo-btn').click();
  await expect(dehydrationRow).not.toHaveClass(/reaction-active/);
});

test('undo after loading a new molecule from reaction preview restores the locked preview state', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CCO');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const dehydrationRow = page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' }).first();
  await dehydrationRow.click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);

  const beforeReplace = await bondSignature(page);
  await loadSmiles(page, 'CCC');
  await expect(page.locator('#smiles-input')).toHaveValue('CCC');
  await expect(page.locator('#reaction-body tr').filter({ hasText: 'Alcohol Dehydration' })).toHaveCount(0);

  await page.locator('#undo-btn').click();
  await expect(dehydrationRow).toHaveClass(/reaction-active/);
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
  const afterUndo = await bondSignature(page);
  await expect(afterUndo).toEqual(beforeReplace);
});

test('undo and redo stay coherent when switching between reaction preview and resonance view', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Reactions' }).click();
  const reductionRow = page.locator('#reaction-body tr').filter({ hasText: 'Carbonyl Reduction' }).first();
  await reductionRow.click();
  await expect(reductionRow).toHaveClass(/reaction-active/);
  const previewBondCount = await page.locator('line.bond-hit').count();

  await page.getByRole('button', { name: 'Other' }).click();
  await expect(page.locator('#resonance-body tr')).toHaveCount(1);
  const resonanceRow = page.locator('#resonance-body tr').first();
  await expect(resonanceRow).toContainText('Resonance Structures');
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(reductionRow).not.toHaveClass(/reaction-active/);
  await expect(resonanceRow).toHaveClass(/resonance-active/);

  await page.locator('#undo-btn').click();
  await expect(reductionRow).toHaveClass(/reaction-active/);
  await expect(page.locator('line.bond-hit')).toHaveCount(previewBondCount);

  await page.locator('#redo-btn').click();
  await expect(reductionRow).not.toHaveClass(/reaction-active/);
  await expect(resonanceRow).toHaveClass(/resonance-active/);
});

test('undo after editing from a locked resonance view restores the locked resonance contributor', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Other' }).click();
  await expect(page.locator('#resonance-body tr')).toHaveCount(1);
  const resonanceRow = page.locator('#resonance-body tr').first();
  await expect(resonanceRow).toContainText('Resonance Structures');
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('2/2');

  await page.locator('#draw-bond-btn').click();
  await page.locator('#elem-btn-Cl').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').click();

  await page.locator('#undo-btn').click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('2/2');
  await expect(page.locator('#smiles-input')).toHaveValue('CC=O');
});

test('redo after editing from a locked resonance view returns to the edited unlocked molecule', async ({ page }) => {
  await page.goto('/index.html');

  await loadSmiles(page, 'CC=O');
  await page.getByRole('button', { name: 'Other' }).click();
  await expect(page.locator('#resonance-body tr')).toHaveCount(1);
  const resonanceRow = page.locator('#resonance-body tr').first();
  await expect(resonanceRow).toContainText('Resonance Structures');
  await computeResonanceContributors(resonanceRow);
  await resonanceRow.click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);

  await page.locator('#draw-bond-btn').click();
  await page.locator('#elem-btn-Cl').click();
  await page.locator('g[data-atom-id="O3"] .atom-hit').click();

  await page.locator('#undo-btn').click();
  await expect(resonanceRow).toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('2/2');

  await page.locator('#redo-btn').click();
  await expect(resonanceRow).not.toHaveClass(/resonance-active/);
  await expect(resonanceRow).toContainText('Compute');
  await expect(page.locator('#smiles-input')).toHaveValue('CC=Cl');
});

test('bond drawer selection updates the active option, main tool icon, and collapses the drawer', async ({ page }) => {
  await page.goto('/index.html');

  const drawButton = page.locator('#draw-bond-btn');
  const doubleButton = page.locator('#draw-bond-type-double');

  await drawButton.click();
  await expect(doubleButton).toBeVisible();

  await doubleButton.click();

  await expect(doubleButton).toHaveClass(/active/);
  await expect(drawButton).toHaveClass(/active/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const mainButton = document.getElementById('draw-bond-btn');
        const selectedButton = document.getElementById('draw-bond-type-double');
        return (mainButton?.innerHTML ?? '') === (selectedButton?.innerHTML ?? '') && !(document.getElementById('draw-tools')?.classList.contains('drawer-open') ?? true);
      })
    )
    .toBe(true);
});

test('draw bond mode activates from a near-edge click on the circular tool button', async ({ page }) => {
  await page.goto('/index.html');

  const targetPoint = await page.evaluate(() => {
    const button = document.getElementById('draw-bond-btn');
    if (!button) {
      return null;
    }
    const rect = button.getBoundingClientRect();
    return {
      x: rect.left + (rect.width / 2) + 17,
      y: rect.top + (rect.height / 2)
    };
  });

  expect(targetPoint).toBeTruthy();

  await page.mouse.click(targetPoint.x, targetPoint.y);

  await expect(page.locator('#draw-bond-btn')).toHaveClass(/active/);
});

test('bond drawer stays open while moving from the main button into the drawer hover zone', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');

  const drawBondButton = page.locator('#draw-bond-btn');
  const doubleBondButton = page.locator('#draw-bond-type-double');

  await drawBondButton.hover();
  await expect(doubleBondButton).toBeVisible();

  const bridgePoint = await page.evaluate(() => {
    const drawBondButtonEl = document.getElementById('draw-bond-btn');
    const drawerEl = document.getElementById('draw-bond-drawer');
    if (!drawBondButtonEl || !drawerEl) {
      return null;
    }

    const drawBondRect = drawBondButtonEl.getBoundingClientRect();
    const drawerRect = drawerEl.getBoundingClientRect();
    return {
      x: drawBondRect.right + Math.min(8, Math.max(2, drawerRect.width * 0.06)),
      y: (drawBondRect.top + drawBondRect.bottom) / 2
    };
  });

  expect(bridgePoint).toBeTruthy();

  await page.mouse.move(bridgePoint.x, bridgePoint.y);
  await expect(doubleBondButton).toBeVisible();

  await doubleBondButton.click();
  await expect(doubleBondButton).toHaveClass(/active/);
});

test('bond drawer stays open when the pointer drifts slightly outside the visible drawer', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');

  const drawBondButton = page.locator('#draw-bond-btn');
  const wedgeBondButton = page.locator('#draw-bond-type-wedge');

  await drawBondButton.hover();
  await expect(wedgeBondButton).toBeVisible();

  const gracePoint = await page.evaluate(() => {
    const drawerEl = document.getElementById('draw-bond-drawer');
    if (!drawerEl) {
      return null;
    }

    const drawerRect = drawerEl.getBoundingClientRect();
    return {
      x: drawerRect.right + 8,
      y: drawerRect.top + drawerRect.height / 2
    };
  });

  expect(gracePoint).toBeTruthy();

  await page.mouse.move(gracePoint.x, gracePoint.y);
  await expect(wedgeBondButton).toBeVisible();

  await wedgeBondButton.hover();
  await wedgeBondButton.click();
  await expect(wedgeBondButton).toHaveClass(/active/);
});

test('clicking the active draw bond button again returns the app to pan mode', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');

  const drawBondButton = page.locator('#draw-bond-btn');

  await drawBondButton.click();
  await drawBondButton.click();

  await expect(drawBondButton).not.toHaveClass(/active/);
  await expect(page.locator('#pan-mode-btn')).toHaveClass(/active/);
});

test('charge mode suppresses native contextmenu on right click in the live app', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C');

  await page.locator('#charge-positive-btn').click();
  await expect(page.locator('#charge-positive-btn')).toHaveClass(/active/);

  const atomHit = page.locator('g[data-atom-id="C1"] .atom-hit');
  await atomHit.click({ button: 'right' });

  await expect.poll(() => page.evaluate(() => window._getMolSmiles?.() ?? null)).toBe('[CH3-]');
  await expect
    .poll(() =>
      page.evaluate(() => ({
        bodyHandler: typeof document.body?.oncontextmenu,
        docElHandler: typeof document.documentElement?.oncontextmenu,
        docHandler: typeof document.oncontextmenu,
        windowHandler: typeof window.oncontextmenu
      }))
    )
    .toMatchObject({
      bodyHandler: 'function',
      docElHandler: 'function',
      docHandler: 'function',
      windowHandler: 'function'
    });
});

test('the molecule plot suppresses native contextmenu even outside charge mode', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');

  const suppression = await page.evaluate(() => {
    const plot = document.getElementById('plot');
    if (!plot) {
      return null;
    }
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2
    });
    const dispatchResult = plot.dispatchEvent(event);
    return {
      defaultPrevented: event.defaultPrevented,
      dispatchResult
    };
  });

  expect(suppression).toEqual({
    defaultPrevented: true,
    dispatchResult: false
  });
});

test('undo preserves the selected bond draw type after undoing a bond edit', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');

  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-dash').click();

  const targetBond = page.locator('line.bond-hit').nth(1);
  await targetBond.click();
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('line.bond-hash').length)).toBeGreaterThan(0);

  await page.locator('#undo-btn').click();

  await expect(page.locator('#draw-bond-type-dash')).toHaveClass(/active/);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const mainButton = document.getElementById('draw-bond-btn');
        const selectedButton = document.getElementById('draw-bond-type-dash');
        return (mainButton?.innerHTML ?? '') === (selectedButton?.innerHTML ?? '');
      })
    )
    .toBe(true);
});

test('wedge and dash bond types render as actual bond glyphs when selected', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');

  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-type-wedge').click();
  await page.locator('line.bond-hit').nth(1).click();
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('polygon.bond-wedge').length)).toBeGreaterThan(0);

  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-dash').click();
  await page.locator('line.bond-hit').nth(1).click();
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('line.bond-hash').length)).toBeGreaterThan(0);
});

test('the live bond preview reflects the selected bond type while dragging', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');

  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-type-double').click();

  const oxygen = page.locator('g[data-atom-id="O3"] .atom-hit');
  const box = await oxygen.boundingBox();
  expect(box).toBeTruthy();

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 80, startY - 50, { steps: 10 });

  await expect
    .poll(() =>
      page.evaluate(() => ({
        previewGroup: document.querySelectorAll('g.draw-bond-preview').length,
        previewSegments: document.querySelectorAll('line.draw-bond-preview-segment').length
      }))
    )
    .toEqual({ previewGroup: 1, previewSegments: 2 });

  await page.mouse.up();
});

test('placing double on an existing double bond is a no-op', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CC=O');
  const undoWasDisabled = await page.locator('#undo-btn').isDisabled();

  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-type-double').click();
  await clickBondHit(page, 'g[data-bond-id="0"] .bond-hit');

  await expect(page.locator('#smiles-input')).toHaveValue('CC=O');
  await expect.poll(() => page.locator('#undo-btn').isDisabled()).toBe(undoWasDisabled);
});

test('placing triple on an existing triple bond is a no-op', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CC#N');
  const undoWasDisabled = await page.locator('#undo-btn').isDisabled();

  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-type-triple').click();
  await clickBondHit(page, 'g[data-bond-id="0"] .bond-hit');

  await expect(page.locator('#smiles-input')).toHaveValue('CC#N');
  await expect.poll(() => page.locator('#undo-btn').isDisabled()).toBe(undoWasDisabled);
});

test('placing aromatic on an existing aromatic bond is a no-op', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'c1ccccc1');
  const undoWasDisabled = await page.locator('#undo-btn').isDisabled();

  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-type-aromatic').click();
  await clickBondHit(page, 'g[data-bond-id="0"] .bond-hit');

  await expect(page.locator('#smiles-input')).toHaveValue('c1ccccc1');
  await expect.poll(() => page.locator('#undo-btn').isDisabled()).toBe(undoWasDisabled);
});

test('selection drag can start in the blank strip beside the draw toolbar', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');
  await page.locator('#select-mode-btn').click();
  await expect(page.locator('#select-mode-btn')).toHaveClass(/active/);

  const probe = await page.evaluate(() => {
    const drawBondButton = document.getElementById('draw-bond-btn');
    const negativeChargeButton = document.getElementById('charge-negative-btn');
    if (!drawBondButton || !negativeChargeButton) {
      return null;
    }

    const drawBondRect = drawBondButton.getBoundingClientRect();
    const negativeChargeRect = negativeChargeButton.getBoundingClientRect();
    const x = drawBondRect.left + 120;
    const y = (drawBondRect.top + negativeChargeRect.bottom) / 2;
    const target = document.elementFromPoint(x, y);

    return {
      x,
      y,
      insideButton: !!target?.closest('button'),
      insideDrawTools: !!target?.closest('#draw-tools')
    };
  });

  expect(probe).toBeTruthy();
  expect(probe.insideButton).toBeFalsy();
  expect(probe.insideDrawTools).toBeFalsy();

  await page.mouse.move(probe.x, probe.y);
  await page.mouse.down();
  await page.mouse.move(probe.x + 60, probe.y + 40, { steps: 6 });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const rect = document.querySelector('.selection-rect');
        if (!rect) {
          return false;
        }
        return getComputedStyle(rect).display !== 'none' && Number(rect.getAttribute('width') ?? 0) > 20 && Number(rect.getAttribute('height') ?? 0) > 20;
      })
    )
    .toBe(true);

  await page.mouse.up();
});

test('2D cobalt wedge tip clears the source Co label', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, '[Co+3](N)(N)(N)(N)(N)N');

  await expect.poll(() => page.evaluate(() => document.querySelectorAll('polygon.bond-wedge').length)).toBeGreaterThan(0);

  const overlapState = await page.evaluate(() => {
    const wedge = document.querySelector('polygon.bond-wedge');
    const coLabel = Array.from(document.querySelectorAll('text')).find(node => (node.textContent ?? '').trim() === 'Co');
    if (!wedge || !coLabel) {
      return null;
    }

    const tip = (wedge.getAttribute('points') ?? '').trim().split(/\s+/)[0].split(',').map(Number);
    const svg = wedge.ownerSVGElement;
    const svgPoint = svg.createSVGPoint();
    svgPoint.x = tip[0];
    svgPoint.y = tip[1];
    const screenPoint = svgPoint.matrixTransform(wedge.getScreenCTM());
    const labelRect = coLabel.getBoundingClientRect();
    const paddedRect = {
      left: labelRect.left - 1.5,
      right: labelRect.right + 1.5,
      top: labelRect.top - 1.5,
      bottom: labelRect.bottom + 1.5
    };

    return {
      inside: screenPoint.x >= paddedRect.left && screenPoint.x <= paddedRect.right && screenPoint.y >= paddedRect.top && screenPoint.y <= paddedRect.bottom
    };
  });

  expect(overlapState).not.toBeNull();
  expect(overlapState.inside).toBeFalsy();
});

test('renders both projected cobalt wedge and dash overlays after switching from 2D to force', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, '[Co+3](N)(N)(N)(N)(N)N');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await expect(page.locator('circle.node')).toHaveCount(19);

  const data = await forceStereoOverlayCounts(page);
  await expect(data.wedgeCount).toBeGreaterThan(1);
  await expect(data.dashLineCount).toBeGreaterThan(0);
});

test('renders projected cobalt wedge and dash overlays when pasted while already in force mode', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');

  await page.evaluate(() => {
    const input = document.getElementById('smiles-input');
    input.focus();
    input.setSelectionRange(0, input.value.length);
    const data = new DataTransfer();
    data.setData('text/plain', '[Co+3](N)(N)(N)(N)(N)N');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });

  await expect(page.locator('circle.node')).toHaveCount(19);

  const data = await forceStereoOverlayCounts(page);
  await expect(data.wedgeCount).toBeGreaterThan(1);
  await expect(data.dashLineCount).toBeGreaterThan(0);
});

test('renders projected cobalt wedge and dash overlays when loaded by Enter while already in force mode', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CCO');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await loadSmiles(page, '[Co+3](N)(N)(N)(N)(N)N');
  await expect(page.locator('circle.node')).toHaveCount(19);

  const data = await forceStereoOverlayCounts(page);
  await expect(data.wedgeCount).toBeGreaterThan(1);
  await expect(data.dashLineCount).toBeGreaterThan(0);
});

test('force mode can flip a stereochemical hydrogen bond between wedge and dash', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C[C@H](F)Cl');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');
  await page.locator('#draw-bond-btn').click();

  const before = await forceStereoOverlayCounts(page);
  expect(before.wedgeCount + before.dashLineCount).toBeGreaterThan(0);
  const beforeSmiles = await page.evaluate(() => window._getMolSmiles?.() ?? null);
  expect(beforeSmiles).toContain('@');

  await page.locator('#draw-bond-btn').hover();
  if (before.wedgeCount > 0) {
    await page.locator('#draw-bond-type-dash').click();
  } else {
    await page.locator('#draw-bond-type-wedge').click();
  }

  const hydrogenBondBox = await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
    const hydrogenIndex = labels.findIndex(label => (label.textContent ?? '').trim() === 'H');
    if (hydrogenIndex < 0) {
      return null;
    }
    const hydrogenRect = circles[hydrogenIndex]?.getBoundingClientRect?.();
    if (!hydrogenRect) {
      return null;
    }
    const hx = hydrogenRect.left + hydrogenRect.width / 2;
    const hy = hydrogenRect.top + hydrogenRect.height / 2;
    let best = null;
    let bestDistance = Infinity;
    for (const target of document.querySelectorAll('line.bond-hover-target')) {
      const rect = target.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const distance = Math.hypot(cx - hx, cy - hy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          x: cx,
          y: cy
        };
      }
    }
    return best;
  });

  expect(hydrogenBondBox).toBeTruthy();
  await page.mouse.click(hydrogenBondBox.x, hydrogenBondBox.y);

  if (before.wedgeCount > 0) {
    await expect
      .poll(async () => {
        const after = await forceStereoOverlayCounts(page);
        return after.wedgeCount === 0 && after.dashLineCount > 0;
      })
      .toBe(true);
  } else {
    await expect
      .poll(async () => {
        const after = await forceStereoOverlayCounts(page);
        return after.wedgeCount > 0 && after.dashLineCount === 0;
      })
      .toBe(true);
  }

  await expect.poll(() => page.evaluate(() => window._getMolSmiles?.() ?? null)).not.toBe(beforeSmiles);
});

test('force mode can clear a stereochemical hydrogen bond back to a single line', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'C[C@H](F)Cl');
  await page.locator('#toggle-btn').click();
  await expect(page.locator('#toggle-btn')).toContainText('2D');

  const before = await forceStereoOverlayCounts(page);
  expect(before.wedgeCount + before.dashLineCount).toBeGreaterThan(0);

  const hydrogenBondBox = await page.evaluate(() => {
    const circles = Array.from(document.querySelectorAll('circle.node'));
    const labels = Array.from(document.querySelectorAll('text.atom-symbol'));
    const hydrogenIndex = labels.findIndex(label => (label.textContent ?? '').trim() === 'H');
    if (hydrogenIndex < 0) {
      return null;
    }
    const hydrogenRect = circles[hydrogenIndex]?.getBoundingClientRect?.();
    if (!hydrogenRect) {
      return null;
    }
    const hx = hydrogenRect.left + hydrogenRect.width / 2;
    const hy = hydrogenRect.top + hydrogenRect.height / 2;
    let best = null;
    let bestDistance = Infinity;
    for (const target of document.querySelectorAll('line.bond-hover-target')) {
      const rect = target.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const distance = Math.hypot(cx - hx, cy - hy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = {
          x: cx,
          y: cy
        };
      }
    }
    return best;
  });

  expect(hydrogenBondBox).toBeTruthy();

  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-single').click();
  await page.mouse.click(hydrogenBondBox.x, hydrogenBondBox.y);

  await expect
    .poll(async () => {
      const after = await forceStereoOverlayCounts(page);
      return after.wedgeCount === 0 && after.dashLineCount === 0;
    })
    .toBe(true);
  await expect.poll(() => page.evaluate(() => window._getMolSmiles?.() ?? null)).not.toContain('@');
});

test('wedge display only changes exported stereochemistry for a real chiral center', async ({ page }) => {
  await page.goto('/index.html');
  await loadSmiles(page, 'CC(F)(Cl)Br');

  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-wedge').click();
  await clickBondHit(page, 'g[data-bond-id="1"] .bond-hit');
  await expect(page.locator('#smiles-input')).toHaveValue(/@/);

  await loadSmiles(page, 'CCO');
  await page.locator('#draw-bond-btn').click();
  await page.locator('#draw-bond-btn').hover();
  await page.locator('#draw-bond-type-wedge').click();
  await clickBondHit(page, 'g[data-bond-id="1"] .bond-hit');
  await expect(page.locator('#smiles-input')).toHaveValue('CCO');
});
