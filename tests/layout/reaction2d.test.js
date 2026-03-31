import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../src/io/smiles.js';
import { reactionTemplates } from '../../src/smirks/reference.js';
import { findSMARTSRaw } from '../../src/smarts/search.js';
import { generateAndRefine2dCoords } from '../../src/layout/index.js';
import { pickStereoWedges, stereoBondCenterIdForRender } from '../../src/layout/mol2d-helpers.js';
import {
  buildReaction2dMol,
  alignReaction2dProductOrientation,
  spreadReaction2dProductComponents,
  centerReaction2dPairCoords
} from '../../src/layout/reaction2d.js';

function preparePreview(smiles, smirks) {
  const sourceMol = parseSMILES(smiles);
  const reactantSmarts = smirks.split('>>')[0];
  const mapping = [...findSMARTSRaw(sourceMol, reactantSmarts)][0];
  assert.ok(mapping, 'expected at least one mapped reactant site');
  const preview = buildReaction2dMol(sourceMol, smirks, mapping);
  assert.ok(preview, 'expected reaction preview to be buildable');
  generateAndRefine2dCoords(preview.mol, { suppressH: true, bondLength: 1.5 });
  alignReaction2dProductOrientation(preview.mol, preview, 1.5);
  spreadReaction2dProductComponents(preview.mol, preview, 1.5);
  centerReaction2dPairCoords(preview.mol, preview, 1.5);
  return preview;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleDeg(a, b, c) {
  const ux = a.x - b.x;
  const uy = a.y - b.y;
  const vx = c.x - b.x;
  const vy = c.y - b.y;
  const ulen = Math.hypot(ux, uy) || 1;
  const vlen = Math.hypot(vx, vy) || 1;
  const dot = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (ulen * vlen)));
  return Math.acos(dot) * 180 / Math.PI;
}

function maxPairDistanceErrorForMappedUnedited(preview) {
  const pairs = preview.mappedAtomPairs
    .filter(([reactantId, productId]) =>
      !preview.editedProductAtomIds.has(productId) &&
      preview.mol.atoms.get(reactantId)?.name !== 'H' &&
      preview.mol.atoms.get(productId)?.name !== 'H'
    );
  let maxError = 0;
  for (let i = 0; i < pairs.length; i++) {
    for (let j = i + 1; j < pairs.length; j++) {
      const [r1, p1] = pairs[i];
      const [r2, p2] = pairs[j];
      const reactantDistance = distance(preview.mol.atoms.get(r1), preview.mol.atoms.get(r2));
      const productDistance = distance(preview.mol.atoms.get(p1), preview.mol.atoms.get(p2));
      maxError = Math.max(maxError, Math.abs(productDistance - reactantDistance));
    }
  }
  return maxError;
}

function largestProductComponent(preview) {
  let best = null;
  for (const atomIds of preview.productComponentAtomIdSets) {
    const heavy = [...atomIds].filter(id => preview.mol.atoms.get(id)?.name !== 'H').length;
    if (!best || heavy > best.heavy) {
      best = { atomIds, heavy };
    }
  }
  return best?.atomIds ?? new Set();
}

function heavyGeometryStats(preview, atomIds) {
  const heavyAtoms = [...atomIds]
    .map(id => preview.mol.atoms.get(id))
    .filter(atom => atom && atom.name !== 'H');
  let minNonbonded = Infinity;
  let maxBond = 0;
  let minBond = Infinity;
  for (let i = 0; i < heavyAtoms.length; i++) {
    for (let j = i + 1; j < heavyAtoms.length; j++) {
      const a = heavyAtoms[i];
      const b = heavyAtoms[j];
      const d = distance(a, b);
      if (preview.mol.getBond(a.id, b.id)) {
        maxBond = Math.max(maxBond, d);
        minBond = Math.min(minBond, d);
      } else {
        minNonbonded = Math.min(minNonbonded, d);
      }
    }
  }
  return { minNonbonded, maxBond, minBond };
}

function findProductCarbonylCenters(preview, predicate) {
  return [...preview.mol.atoms.values()].filter(atom => {
    if (!preview.productAtomIds.has(atom.id) || atom.name !== 'C') {
      return false;
    }
    const oxygenNeighbors = atom.getNeighbors(preview.mol).filter(nb => nb.name === 'O');
    if (oxygenNeighbors.length < 2) {
      return false;
    }
    const hasDoubleO = oxygenNeighbors.some(nb => (preview.mol.getBond(atom.id, nb.id)?.properties.order ?? 1) >= 2);
    const hasSingleO = oxygenNeighbors.some(nb => (preview.mol.getBond(atom.id, nb.id)?.properties.order ?? 1) === 1);
    if (!(hasDoubleO && hasSingleO)) {
      return false;
    }
    return predicate ? predicate(atom) : true;
  });
}

test('reaction preview preserves ring scaffold geometry for alkene hydrogenation', () => {
  const preview = preparePreview(
    'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O',
    reactionTemplates.alkeneHydrogenation.smirks
  );
  const maxError = maxPairDistanceErrorForMappedUnedited(preview);
  assert.ok(maxError < 0.15, `expected preserved ring scaffold distances to stay close, got max error ${maxError.toFixed(3)} Å`);
});

test('reaction preview keeps terminal alkene hydrogenation in a zig-zag for C=CCC', () => {
  const preview = preparePreview(
    'C=CCC',
    reactionTemplates.alkeneHydrogenation.smirks
  );
  const atoms = [...preview.mol.atoms.values()]
    .filter(atom => preview.productAtomIds.has(atom.id) && atom.name !== 'H')
    .sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(atoms.length, 4, 'expected four heavy atoms in hydrogenated product');
  const angle = angleDeg(atoms[0], atoms[1], atoms[2]);
  assert.ok(angle > 100 && angle < 140, `expected new saturated chain angle to stay zig-zag-like, got ${angle.toFixed(1)}°`);
});

test('reaction preview keeps nitrile hydrolysis to amide carbonyl locally trigonal', () => {
  const preview = preparePreview(
    'N#CC(C#N)=C(C#N)C#N',
    reactionTemplates.nitrileHydrolysisToAmide.smirks
  );
  const amideCarbonyl = [...preview.mol.atoms.values()].find(atom => {
    if (!preview.productAtomIds.has(atom.id) || atom.name !== 'C') {
      return false;
    }
    const neighbors = atom.getNeighbors(preview.mol);
    const oxygen = neighbors.find(nb => nb.name === 'O' && (preview.mol.getBond(atom.id, nb.id)?.properties.order ?? 1) >= 2);
    const nitrogen = neighbors.find(nb => nb.name === 'N' && (preview.mol.getBond(atom.id, nb.id)?.properties.order ?? 1) === 1);
    return !!oxygen && !!nitrogen;
  });
  assert.ok(amideCarbonyl, 'expected amide carbonyl center in preview');
  const oxygen = amideCarbonyl.getNeighbors(preview.mol).find(nb => nb.name === 'O' && (preview.mol.getBond(amideCarbonyl.id, nb.id)?.properties.order ?? 1) >= 2);
  const nitrogen = amideCarbonyl.getNeighbors(preview.mol).find(nb => nb.name === 'N' && (preview.mol.getBond(amideCarbonyl.id, nb.id)?.properties.order ?? 1) === 1);
  const angle = angleDeg(oxygen, amideCarbonyl, nitrogen);
  assert.ok(angle > 105 && angle < 135, `expected amide O=C-N angle to be trigonal, got ${angle.toFixed(1)}°`);
  assert.ok(distance(amideCarbonyl, oxygen) < 1.4, 'expected carbonyl bond to stay short');
  assert.ok(distance(amideCarbonyl, nitrogen) < 1.7, 'expected amide single bond to stay compact');
});

test('reaction preview keeps lactam hydrolysis acid geometry locally trigonal', () => {
  const preview = preparePreview(
    'C1=CC=C(C=C1)C2(C3CC3)C(=O)NC(=O)N2',
    reactionTemplates.lactamHydrolysis.smirks
  );
  const acidCenters = findProductCarbonylCenters(preview);
  assert.ok(acidCenters.length >= 1, 'expected at least one acid-like carbonyl center in lactam hydrolysis preview');
  const worstAngle = acidCenters.reduce((worst, atom) => {
    const oDouble = atom.getNeighbors(preview.mol).find(nb => nb.name === 'O' && (preview.mol.getBond(atom.id, nb.id)?.properties.order ?? 1) >= 2);
    const oSingle = atom.getNeighbors(preview.mol).find(nb => nb.name === 'O' && (preview.mol.getBond(atom.id, nb.id)?.properties.order ?? 1) === 1);
    const angle = angleDeg(oDouble, atom, oSingle);
    return Math.min(worst, angle);
  }, Infinity);
  assert.ok(worstAngle > 100, `expected acid O-C-O angle to stay open, got ${worstAngle.toFixed(1)}°`);
});

test('reaction preview keeps amide hydrolysis acid center compact on the preserved scaffold', () => {
  const sourceMol = parseSMILES('C1=C(NC=N1)CC(C(=O)N[C@@H](CCCCN)C(=O)O)NC(=O)CN');
  const reactantSmarts = reactionTemplates.amideHydrolysis.smirks.split('>>')[0];
  const mappings = [...findSMARTSRaw(sourceMol, reactantSmarts)];
  const mapping = mappings[1];
  assert.ok(mapping, 'expected second amide-hydrolysis mapping for scaffold-bound amide');
  const preview = buildReaction2dMol(sourceMol, reactionTemplates.amideHydrolysis.smirks, mapping);
  generateAndRefine2dCoords(preview.mol, { suppressH: true, bondLength: 1.5 });
  alignReaction2dProductOrientation(preview.mol, preview, 1.5);
  spreadReaction2dProductComponents(preview.mol, preview, 1.5);
  centerReaction2dPairCoords(preview.mol, preview, 1.5);

  const acidCenter = preview.mol.atoms.get('__rxn_product__0:C8');
  const scaffoldNeighbor = preview.mol.atoms.get('__rxn_product__0:C7');
  const oDouble = preview.mol.atoms.get('__rxn_product__0:O9');
  const oSingle = preview.mol.atoms.get('__rxn_product__0:0');
  assert.ok(acidCenter && scaffoldNeighbor && oDouble && oSingle, 'expected mapped scaffold acid center in amide hydrolysis preview');
  assert.ok(distance(acidCenter, scaffoldNeighbor) < 1.7, `expected scaffold-to-acid bond to stay compact, got ${distance(acidCenter, scaffoldNeighbor).toFixed(3)} Å`);
  assert.ok(distance(acidCenter, oDouble) < 1.4, `expected carbonyl bond to stay short, got ${distance(acidCenter, oDouble).toFixed(3)} Å`);
  assert.ok(distance(acidCenter, oSingle) < 1.7, `expected acid single bond to stay compact, got ${distance(acidCenter, oSingle).toFixed(3)} Å`);
});

test('reaction preview keeps retained chain geometry sane for alcohol cleavage and dehalogenation', () => {
  const smiles = 'CC(CC(Cl)CCO)C';
  for (const smirks of [reactionTemplates.alcoholCleavage.smirks, reactionTemplates.dehalogenation.smirks]) {
    const preview = preparePreview(smiles, smirks);
    const component = largestProductComponent(preview);
    const stats = heavyGeometryStats(preview, component);
    assert.ok(stats.minBond > 1.05, `expected no compressed heavy-atom bonds, got ${stats.minBond.toFixed(3)} Å for ${smirks}`);
    assert.ok(stats.maxBond < 1.85, `expected no stretched heavy-atom bonds, got ${stats.maxBond.toFixed(3)} Å for ${smirks}`);
    assert.ok(stats.minNonbonded > 0.8, `expected no heavy-atom overlap, got ${stats.minNonbonded.toFixed(3)} Å for ${smirks}`);
  }
});

test('reaction preview preserves local zig-zag geometry for branched-chain dehalogenation', () => {
  const preview = preparePreview(
    'CC(CC(Cl)CCO)C',
    reactionTemplates.dehalogenation.smirks
  );
  const c3 = [...preview.mol.atoms.values()].find(atom => preview.productAtomIds.has(atom.id) && atom.name === 'C' && atom.id.endsWith(':C3'));
  const c4 = [...preview.mol.atoms.values()].find(atom => preview.productAtomIds.has(atom.id) && atom.name === 'C' && atom.id.endsWith(':C4'));
  const c6 = [...preview.mol.atoms.values()].find(atom => preview.productAtomIds.has(atom.id) && atom.name === 'C' && atom.id.endsWith(':C6'));
  const c2 = [...preview.mol.atoms.values()].find(atom => preview.productAtomIds.has(atom.id) && atom.name === 'C' && atom.id.endsWith(':C2'));
  const c7 = [...preview.mol.atoms.values()].find(atom => preview.productAtomIds.has(atom.id) && atom.name === 'C' && atom.id.endsWith(':C7'));
  assert.ok(c2 && c3 && c4 && c6 && c7, 'expected mapped chain atoms in dehalogenation preview');
  const leftAngle = angleDeg(c2, c3, c4);
  const rightAngle = angleDeg(c4, c6, c7);
  assert.ok(leftAngle > 100 && leftAngle < 140, `expected left branch angle to stay zig-zag-like, got ${leftAngle.toFixed(1)}°`);
  assert.ok(rightAngle > 100 && rightAngle < 140, `expected right branch angle to stay zig-zag-like, got ${rightAngle.toFixed(1)}°`);
});

test('reaction preview preserves local zig-zag geometry for branched-chain alcohol cleavage', () => {
  const preview = preparePreview(
    'CC(CC(Cl)CCO)C',
    reactionTemplates.alcoholCleavage.smirks
  );
  const c4 = [...preview.mol.atoms.values()].find(atom => preview.productAtomIds.has(atom.id) && atom.name === 'C' && atom.id.endsWith(':C4'));
  const c6 = [...preview.mol.atoms.values()].find(atom => preview.productAtomIds.has(atom.id) && atom.name === 'C' && atom.id.endsWith(':C6'));
  const c7 = [...preview.mol.atoms.values()].find(atom => preview.productAtomIds.has(atom.id) && atom.name === 'C' && atom.id.endsWith(':C7'));
  assert.ok(c4 && c6 && c7, 'expected retained chain atoms in alcohol cleavage preview');
  const angle = angleDeg(c4, c6, c7);
  assert.ok(angle > 100 && angle < 140, `expected retained cleavage-site chain angle to stay zig-zag-like, got ${angle.toFixed(1)}°`);
});

test('reaction preview preserves product wedge or dash display for an untouched stereocenter', () => {
  const smiles = 'I[C@H](CCO)CCF';
  const smirks = '[C:1][OH:2]>>[C:1][Cl:2]';
  const sourceMol = parseSMILES(smiles);
  generateAndRefine2dCoords(sourceMol, { suppressH: true, bondLength: 1.5 });

  const sourceWedges = pickStereoWedges(sourceMol);
  const sourceCenter = [...sourceMol.atoms.values()].find(atom => atom.getChirality());
  assert.ok(sourceCenter, 'expected one chiral reactant center');
  const sourceStereo = [...sourceWedges].find(([bondId]) => sourceMol.bonds.get(bondId)?.atoms.includes(sourceCenter.id));
  assert.ok(sourceStereo, 'expected reactant wedge/dash assignment');
  const sourceBond = sourceMol.bonds.get(sourceStereo[0]);
  const sourceOtherId = sourceBond.atoms[0] === sourceCenter.id ? sourceBond.atoms[1] : sourceBond.atoms[0];

  const mapping = [...findSMARTSRaw(sourceMol, smirks.split('>>')[0])][0];
  const preview = buildReaction2dMol(sourceMol, smirks, mapping);
  generateAndRefine2dCoords(preview.mol, { suppressH: true, bondLength: 1.5 });
  alignReaction2dProductOrientation(preview.mol, preview, 1.5);
  spreadReaction2dProductComponents(preview.mol, preview, 1.5);
  centerReaction2dPairCoords(preview.mol, preview, 1.5);

  const productCenterId = preview.mappedAtomPairs.find(([reactantId]) => reactantId === sourceCenter.id)?.[1];
  const productOtherId = preview.mappedAtomPairs.find(([reactantId]) => reactantId === sourceOtherId)?.[1];
  assert.ok(productCenterId && productOtherId, 'expected mapped product bond for preserved stereocenter');

  const productWedges = pickStereoWedges(preview.mol);
  const productBond = preview.mol.getBond(productCenterId, productOtherId);
  assert.ok(productBond, 'expected preserved product bond at untouched stereocenter');
  assert.equal(productWedges.get(productBond.id), sourceStereo[1], 'expected product wedge/dash display to match the reactant');
});

test('reaction preview preserves sugar stereobond display across alcohol cleavage sites', () => {
  const smiles = 'C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O';
  const smirks = reactionTemplates.alcoholCleavage.smirks;
  const sourceMol = parseSMILES(smiles);
  generateAndRefine2dCoords(sourceMol, { suppressH: true, bondLength: 1.5 });

  const sourceStereoByCenter = new Map();
  for (const [bondId, type] of pickStereoWedges(sourceMol)) {
    const bond = sourceMol.bonds.get(bondId);
    const [aId, bId] = bond.atoms;
    const a = sourceMol.atoms.get(aId);
    const b = sourceMol.atoms.get(bId);
    const centerId = a?.getChirality() ? aId : b?.getChirality() ? bId : null;
    if (!centerId) {
      continue;
    }
    const otherId = centerId === aId ? bId : aId;
    sourceStereoByCenter.set(centerId, { otherId, type });
  }

  const mappings = [...findSMARTSRaw(sourceMol, smirks.split('>>')[0])];
  assert.equal(mappings.length, 5, 'expected five alcohol-cleavage sites in the sugar example');

  for (const mapping of mappings) {
    const preview = buildReaction2dMol(sourceMol, smirks, mapping);
    assert.ok(preview, 'expected reaction preview to be buildable');
    generateAndRefine2dCoords(preview.mol, { suppressH: true, bondLength: 1.5 });
    alignReaction2dProductOrientation(preview.mol, preview, 1.5);
    spreadReaction2dProductComponents(preview.mol, preview, 1.5);
    centerReaction2dPairCoords(preview.mol, preview, 1.5);

    const productStereoByCenter = new Map();
    for (const [bondId, type] of pickStereoWedges(preview.mol)) {
      const bond = preview.mol.bonds.get(bondId);
      const [aId, bId] = bond.atoms;
      const a = preview.mol.atoms.get(aId);
      const b = preview.mol.atoms.get(bId);
      const centerId = a?.getChirality() ? aId : b?.getChirality() ? bId : null;
      if (!centerId) {
        continue;
      }
      const otherId = centerId === aId ? bId : aId;
      productStereoByCenter.set(centerId, { otherId, type });
    }

    for (const [sourceCenterId, sourceStereo] of sourceStereoByCenter) {
      const productCenterId = preview.mappedAtomPairs.find(([reactantId]) => reactantId === sourceCenterId)?.[1];
      if (!productCenterId || preview.editedProductAtomIds.has(productCenterId)) {
        continue;
      }
      const current = productStereoByCenter.get(productCenterId);
      assert.ok(current, `expected stereobond assignment for preserved sugar center ${productCenterId}`);
      assert.equal(
        current.type,
        sourceStereo.type,
        `expected sugar cleavage to preserve wedge/dash display for preserved stereocenter ${productCenterId}`
      );
    }
  }
});

test('reaction preview preserves reactant-side sugar stereobond display across alcohol cleavage sites', () => {
  const smiles = 'C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O';
  const smirks = reactionTemplates.alcoholCleavage.smirks;
  const sourceMol = parseSMILES(smiles);
  generateAndRefine2dCoords(sourceMol, { suppressH: true, bondLength: 1.5 });

  const sourceStereoByCenter = new Map();
  for (const [bondId, type] of pickStereoWedges(sourceMol)) {
    const bond = sourceMol.bonds.get(bondId);
    const [aId, bId] = bond.atoms;
    const a = sourceMol.atoms.get(aId);
    const b = sourceMol.atoms.get(bId);
    const centerId = a?.getChirality() ? aId : b?.getChirality() ? bId : null;
    if (!centerId) {
      continue;
    }
    const otherId = centerId === aId ? bId : aId;
    sourceStereoByCenter.set(centerId, { otherId, type });
  }

  const mappings = [...findSMARTSRaw(sourceMol, smirks.split('>>')[0])];
  assert.equal(mappings.length, 5, 'expected five alcohol-cleavage sites in the sugar example');

  for (const mapping of mappings) {
    const preview = buildReaction2dMol(sourceMol, smirks, mapping);
    assert.ok(preview, 'expected reaction preview to be buildable');
    generateAndRefine2dCoords(preview.mol, { suppressH: true, bondLength: 1.5 });
    alignReaction2dProductOrientation(preview.mol, preview, 1.5);
    spreadReaction2dProductComponents(preview.mol, preview, 1.5);
    centerReaction2dPairCoords(preview.mol, preview, 1.5);

    const reactantStereoByCenter = new Map();
    for (const [bondId, type] of pickStereoWedges(preview.mol)) {
      const bond = preview.mol.bonds.get(bondId);
      const [aId, bId] = bond.atoms;
      const a = preview.mol.atoms.get(aId);
      const b = preview.mol.atoms.get(bId);
      const centerId = a?.getChirality() ? aId : b?.getChirality() ? bId : null;
      if (!centerId || !preview.reactantAtomIds.has(centerId)) {
        continue;
      }
      const otherId = centerId === aId ? bId : aId;
      reactantStereoByCenter.set(centerId, { otherId, type });
    }

    for (const [centerId, sourceStereo] of sourceStereoByCenter) {
      const current = reactantStereoByCenter.get(centerId);
      assert.ok(current, `expected reactant-side stereobond assignment for sugar center ${centerId}`);
      assert.equal(
        current.type,
        sourceStereo.type,
        `expected reactant-side sugar cleavage preview to preserve wedge/dash display for ${centerId}`
      );
    }
  }
});

test('reaction preview preserves the exact reactant stereobond set across sugar alcohol-cleavage mappings', () => {
  const smiles = 'C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O';
  const smirks = reactionTemplates.alcoholCleavage.smirks;
  const sourceMol = parseSMILES(smiles);
  generateAndRefine2dCoords(sourceMol, { suppressH: true, bondLength: 1.5 });
  const sourceStereoBonds = [...pickStereoWedges(sourceMol)]
    .map(([bondId, type]) => ({ bondId, type }))
    .sort((a, b) => a.bondId.localeCompare(b.bondId));

  const mappings = [...findSMARTSRaw(sourceMol, smirks.split('>>')[0])];
  assert.equal(mappings.length, 5, 'expected five alcohol-cleavage sites in the sugar example');

  for (const mapping of mappings) {
    const preview = buildReaction2dMol(sourceMol, smirks, mapping);
    assert.ok(preview, 'expected reaction preview to be buildable');
    generateAndRefine2dCoords(preview.mol, { suppressH: true, bondLength: 1.5 });
    alignReaction2dProductOrientation(preview.mol, preview, 1.5);
    spreadReaction2dProductComponents(preview.mol, preview, 1.5);
    centerReaction2dPairCoords(preview.mol, preview, 1.5);

    const reactantStereoBonds = [...pickStereoWedges(preview.mol)]
      .filter(([bondId]) => {
        const bond = preview.mol.bonds.get(bondId);
        return bond && bond.atoms.every(atomId => preview.reactantAtomIds.has(atomId));
      })
      .map(([bondId, type]) => ({ bondId, type }))
      .sort((a, b) => a.bondId.localeCompare(b.bondId));

    assert.deepEqual(
      reactantStereoBonds,
      sourceStereoBonds,
      'expected the reactant-side sugar preview to preserve the exact stereobond set'
    );
  }
});

test('reaction preview keeps stereo render centers pinned to the original untouched sugar stereocenters', () => {
  const smiles = 'C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O';
  const smirks = reactionTemplates.alcoholCleavage.smirks;
  const sourceMol = parseSMILES(smiles);
  const mappings = [...findSMARTSRaw(sourceMol, smirks.split('>>')[0])];

  for (const mapping of mappings) {
    const preview = buildReaction2dMol(sourceMol, smirks, mapping);
    generateAndRefine2dCoords(preview.mol, { suppressH: true, bondLength: 1.5 });
    alignReaction2dProductOrientation(preview.mol, preview, 1.5);
    spreadReaction2dProductComponents(preview.mol, preview, 1.5);
    centerReaction2dPairCoords(preview.mol, preview, 1.5);

    for (const [productCenterId, preserved] of preview.preservedProductStereoByCenter) {
      const bond = preview.mol.getBond(productCenterId, preserved.otherProductId);
      assert.ok(bond, `expected preserved product stereo bond for ${productCenterId}`);
      assert.equal(
        stereoBondCenterIdForRender(preview.mol, bond.id),
        productCenterId,
        `expected render-time stereo center to stay pinned to ${productCenterId}`
      );
    }
  }
});

test('reaction preview preserves sugar stereobond display even when built from an unprepared source molecule', () => {
  const smiles = 'C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O';
  const smirks = reactionTemplates.alcoholCleavage.smirks;
  const sourceMol = parseSMILES(smiles);
  const sourceDisplayMol = parseSMILES(smiles);
  sourceDisplayMol.hideHydrogens();
  generateAndRefine2dCoords(sourceDisplayMol, { suppressH: true, bondLength: 1.5 });
  for (const atom of sourceDisplayMol.atoms.values()) {
    if (atom.name !== 'H' || atom.visible !== false) {
      continue;
    }
    const nbrs = atom.getNeighbors(sourceDisplayMol);
    if (nbrs.length !== 1) {
      continue;
    }
    const parent = nbrs[0];
    if (!parent.getChirality()) {
      continue;
    }
    const others = parent.getNeighbors(sourceDisplayMol).filter(n => n.id !== atom.id);
    let sumX = 0;
    let sumY = 0;
    let cnt = 0;
    for (const nb of others) {
      if (nb.x == null) {
        continue;
      }
      sumX += nb.x - parent.x;
      sumY += nb.y - parent.y;
      cnt++;
    }
    const angle = cnt > 0 ? Math.atan2(-sumY, -sumX) : 0;
    const hLen = 1.5 * 0.75;
    atom.x = parent.x + Math.cos(angle) * hLen;
    atom.y = parent.y + Math.sin(angle) * hLen;
  }
  const sourceStereo = [...pickStereoWedges(sourceDisplayMol)]
    .map(([bondId, type]) => ({ bondId, type }))
    .sort((a, b) => a.bondId.localeCompare(b.bondId));
  const mappings = [...findSMARTSRaw(sourceMol, smirks.split('>>')[0])];

  for (const mapping of mappings) {
    const preview = buildReaction2dMol(sourceMol.clone(), smirks, mapping);
    preview.mol.hideHydrogens();
    generateAndRefine2dCoords(preview.mol, { suppressH: true, bondLength: 1.5 });
    alignReaction2dProductOrientation(preview.mol, preview, 1.5);
    spreadReaction2dProductComponents(preview.mol, preview, 1.5);
    centerReaction2dPairCoords(preview.mol, preview, 1.5);
    for (const atom of preview.mol.atoms.values()) {
      if (atom.name !== 'H' || atom.visible !== false) {
        continue;
      }
      const nbrs = atom.getNeighbors(preview.mol);
      if (nbrs.length !== 1) {
        continue;
      }
      const parent = nbrs[0];
      if (!parent.getChirality()) {
        continue;
      }
      const others = parent.getNeighbors(preview.mol).filter(n => n.id !== atom.id);
      let sumX = 0;
      let sumY = 0;
      let cnt = 0;
      for (const nb of others) {
        if (nb.x == null) {
          continue;
        }
        sumX += nb.x - parent.x;
        sumY += nb.y - parent.y;
        cnt++;
      }
      const angle = cnt > 0 ? Math.atan2(-sumY, -sumX) : 0;
      const hLen = 1.5 * 0.75;
      atom.x = parent.x + Math.cos(angle) * hLen;
      atom.y = parent.y + Math.sin(angle) * hLen;
    }

    const reactantStereo = [...pickStereoWedges(preview.mol)]
      .filter(([bondId]) => {
        const bond = preview.mol.bonds.get(bondId);
        return bond && bond.atoms.every(atomId => preview.reactantAtomIds.has(atomId));
      })
      .map(([bondId, type]) => ({ bondId, type }))
      .sort((a, b) => a.bondId.localeCompare(b.bondId));
    assert.deepEqual(reactantStereo, sourceStereo, 'expected reactant-side stereobond display to stay unchanged from an unprepared source input');

    const productStereo = [...pickStereoWedges(preview.mol)]
      .filter(([bondId]) => {
        const bond = preview.mol.bonds.get(bondId);
        return bond && bond.atoms.every(atomId => preview.productAtomIds.has(atomId));
      })
      .map(([bondId, type]) => ({ bondId, type }))
      .sort((a, b) => a.bondId.localeCompare(b.bondId));

    for (const [sourceBondId, type] of sourceStereo.map(entry => [entry.bondId, entry.type])) {
      const preservedMapped = preview.mappedAtomPairs
        .map(([reactantId, productId]) => [reactantId, productId]);
      const sourceBond = sourceDisplayMol.bonds.get(sourceBondId);
      if (!sourceBond) {
        continue;
      }
      const productAtoms = sourceBond.atoms.map(atomId => preservedMapped.find(([reactantId]) => reactantId === atomId)?.[1] ?? null);
      if (productAtoms.some(atomId => !atomId || preview.editedProductAtomIds.has(atomId))) {
        continue;
      }
      const productBond = preview.mol.getBond(productAtoms[0], productAtoms[1]);
      assert.ok(productBond, 'expected preserved product stereobond');
      assert.ok(productStereo.some(entry => entry.bondId === productBond.id && entry.type === type), 'expected preserved product stereobond display to match source display');
    }
  }
});

test('reaction preview preserves the currently displayed sugar stereobond choices after source rotation', () => {
  const smiles = 'C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O';
  const smirks = reactionTemplates.alcoholCleavage.smirks;
  const sourceMol = parseSMILES(smiles);
  sourceMol.hideHydrogens();
  generateAndRefine2dCoords(sourceMol, { suppressH: true, bondLength: 1.5 });

  const allAtoms = [...sourceMol.atoms.values()].filter(atom => atom.x != null);
  let cx = 0;
  let cy = 0;
  for (const atom of allAtoms) {
    cx += atom.x;
    cy += atom.y;
  }
  cx /= allAtoms.length;
  cy /= allAtoms.length;
  for (const atom of allAtoms) {
    const dx = atom.x - cx;
    const dy = atom.y - cy;
    atom.x = cx - dy;
    atom.y = cy + dx;
  }
  for (const atom of sourceMol.atoms.values()) {
    if (atom.name !== 'H' || atom.visible !== false) {
      continue;
    }
    const nbrs = atom.getNeighbors(sourceMol);
    if (nbrs.length !== 1) {
      continue;
    }
    const parent = nbrs[0];
    if (!parent.getChirality()) {
      continue;
    }
    const others = parent.getNeighbors(sourceMol).filter(n => n.id !== atom.id);
    let sumX = 0;
    let sumY = 0;
    let cnt = 0;
    for (const nb of others) {
      if (nb.x == null) {
        continue;
      }
      sumX += nb.x - parent.x;
      sumY += nb.y - parent.y;
      cnt++;
    }
    const angle = cnt > 0 ? Math.atan2(-sumY, -sumX) : 0;
    const hLen = 1.5 * 0.75;
    atom.x = parent.x + Math.cos(angle) * hLen;
    atom.y = parent.y + Math.sin(angle) * hLen;
  }

  const sourceStereo = [...pickStereoWedges(sourceMol)]
    .map(([bondId, type]) => ({ bondId, type }))
    .sort((a, b) => a.bondId.localeCompare(b.bondId));
  const mappings = [...findSMARTSRaw(parseSMILES(smiles), smirks.split('>>')[0])];

  for (const mapping of mappings) {
    const preview = buildReaction2dMol(sourceMol.clone(), smirks, mapping);
    preview.mol.hideHydrogens();
    generateAndRefine2dCoords(preview.mol, { suppressH: true, bondLength: 1.5 });
    alignReaction2dProductOrientation(preview.mol, preview, 1.5);
    spreadReaction2dProductComponents(preview.mol, preview, 1.5);
    centerReaction2dPairCoords(preview.mol, preview, 1.5);
    for (const atom of preview.mol.atoms.values()) {
      if (atom.name !== 'H' || atom.visible !== false) {
        continue;
      }
      const nbrs = atom.getNeighbors(preview.mol);
      if (nbrs.length !== 1) {
        continue;
      }
      const parent = nbrs[0];
      if (!parent.getChirality()) {
        continue;
      }
      const others = parent.getNeighbors(preview.mol).filter(n => n.id !== atom.id);
      let sumX = 0;
      let sumY = 0;
      let cnt = 0;
      for (const nb of others) {
        if (nb.x == null) {
          continue;
        }
        sumX += nb.x - parent.x;
        sumY += nb.y - parent.y;
        cnt++;
      }
      const angle = cnt > 0 ? Math.atan2(-sumY, -sumX) : 0;
      const hLen = 1.5 * 0.75;
      atom.x = parent.x + Math.cos(angle) * hLen;
      atom.y = parent.y + Math.sin(angle) * hLen;
    }

    const reactantStereo = [...pickStereoWedges(preview.mol)]
      .filter(([bondId]) => {
        const bond = preview.mol.bonds.get(bondId);
        return bond && bond.atoms.every(atomId => preview.reactantAtomIds.has(atomId));
      })
      .map(([bondId, type]) => ({ bondId, type }))
      .sort((a, b) => a.bondId.localeCompare(b.bondId));
    assert.deepEqual(
      reactantStereo,
      sourceStereo,
      'expected reactant-side preview to preserve the currently displayed stereobond choices after source rotation'
    );
  }
});

test('reaction preview keeps nitrile hydrolysis to acid locally carboxyl-like for isolated nitrile', () => {
  const preview = preparePreview(
    'C#N',
    reactionTemplates.nitrileHydrolysisToAcid.smirks
  );
  const acidCenter = findProductCarbonylCenters(preview)[0];
  assert.ok(acidCenter, 'expected acid carbonyl center in preview');
  const oDouble = acidCenter.getNeighbors(preview.mol).find(nb => nb.name === 'O' && (preview.mol.getBond(acidCenter.id, nb.id)?.properties.order ?? 1) >= 2);
  const oSingle = acidCenter.getNeighbors(preview.mol).find(nb => nb.name === 'O' && (preview.mol.getBond(acidCenter.id, nb.id)?.properties.order ?? 1) === 1);
  const angle = angleDeg(oDouble, acidCenter, oSingle);
  assert.ok(angle > 100 && angle < 140, `expected isolated acid O-C-O angle to stay open, got ${angle.toFixed(1)}°`);
  assert.ok(distance(acidCenter, oDouble) < 1.4, 'expected isolated carbonyl bond to stay short');
  assert.ok(distance(acidCenter, oSingle) < 1.7, 'expected isolated C-O bond to stay compact');
});

test('reaction preview keeps nitrile-to-imine product scaffold compact', () => {
  const preview = preparePreview(
    'N#CC(C#N)=C(C#N)C#N',
    reactionTemplates.nitrileHydrogenationToImine.smirks
  );
  const stats = heavyGeometryStats(preview, largestProductComponent(preview));
  assert.ok(stats.maxBond < 1.85, `expected no stretched heavy-atom bonds in nitrile-to-imine preview, got ${stats.maxBond.toFixed(3)} Å`);
  assert.ok(stats.minNonbonded > 0.8, `expected no heavy-atom overlap in nitrile-to-imine preview, got ${stats.minNonbonded.toFixed(3)} Å`);
});

test('reaction preview keeps all nitrile-to-imine mappings compact', () => {
  const smiles = 'N#CC(C#N)=C(C#N)C#N';
  const sourceMol = parseSMILES(smiles);
  const reactantSmarts = reactionTemplates.nitrileHydrogenationToImine.smirks.split('>>')[0];
  const mappings = [...findSMARTSRaw(sourceMol, reactantSmarts)];
  assert.equal(mappings.length, 4, 'expected four nitrile-to-imine mappings');

  for (const [index, mapping] of mappings.entries()) {
    const preview = buildReaction2dMol(sourceMol, reactionTemplates.nitrileHydrogenationToImine.smirks, mapping);
    assert.ok(preview, `expected nitrile-to-imine preview for mapping ${index}`);
    generateAndRefine2dCoords(preview.mol, { suppressH: true, bondLength: 1.5 });
    alignReaction2dProductOrientation(preview.mol, preview, 1.5);
    spreadReaction2dProductComponents(preview.mol, preview, 1.5);
    centerReaction2dPairCoords(preview.mol, preview, 1.5);

    const stats = heavyGeometryStats(preview, largestProductComponent(preview));
    assert.ok(
      stats.maxBond < 1.85,
      `expected no stretched heavy-atom bonds in nitrile-to-imine mapping ${index}, got ${stats.maxBond.toFixed(3)} Å`
    );
    assert.ok(
      stats.minNonbonded > 0.8,
      `expected no heavy-atom overlap in nitrile-to-imine mapping ${index}, got ${stats.minNonbonded.toFixed(3)} Å`
    );
  }
});

test('reaction preview preserves exact stereobond choices on both sides for untouched stereocenters', () => {
  const smiles = 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O';
  const sourceMol = parseSMILES(smiles);
  generateAndRefine2dCoords(sourceMol, { suppressH: true, bondLength: 1.5 });
  const sourceStereoBonds = [...pickStereoWedges(sourceMol)]
    .map(([bondId, type]) => ({ bondId, type }))
    .sort((a, b) => a.bondId.localeCompare(b.bondId));
  assert.deepEqual(
    sourceStereoBonds,
    [
      { bondId: '10', type: 'wedge' },
      { bondId: '14', type: 'dash' },
      { bondId: '2', type: 'wedge' }
    ].sort((a, b) => a.bondId.localeCompare(b.bondId)),
    'expected source stereobond set for ring alkene-hydrogenation case'
  );

  const mapping = [...findSMARTSRaw(sourceMol, reactionTemplates.alkeneHydrogenation.smirks.split('>>')[0])][0];
  const preview = buildReaction2dMol(sourceMol, reactionTemplates.alkeneHydrogenation.smirks, mapping);
  assert.ok(preview, 'expected alkene-hydrogenation preview');
  generateAndRefine2dCoords(preview.mol, { suppressH: true, bondLength: 1.5 });
  alignReaction2dProductOrientation(preview.mol, preview, 1.5);
  spreadReaction2dProductComponents(preview.mol, preview, 1.5);
  centerReaction2dPairCoords(preview.mol, preview, 1.5);

  const reactantStereoBonds = [...pickStereoWedges(preview.mol)]
    .filter(([bondId]) => preview.reactantAtomIds.has(preview.mol.bonds.get(bondId)?.atoms[0]) || preview.reactantAtomIds.has(preview.mol.bonds.get(bondId)?.atoms[1]))
    .map(([bondId, type]) => ({ bondId, type }))
    .sort((a, b) => a.bondId.localeCompare(b.bondId));
  assert.deepEqual(
    reactantStereoBonds,
    sourceStereoBonds,
    'expected reactant-side stereobond choices to stay unchanged in reaction preview'
  );

  const productStereoBonds = [...pickStereoWedges(preview.mol)]
    .filter(([bondId]) => bondId.startsWith('__rxn_product__0:'))
    .map(([bondId, type]) => ({ bondId, type }))
    .sort((a, b) => a.bondId.localeCompare(b.bondId));
  assert.deepEqual(
    productStereoBonds,
    [
      { bondId: '__rxn_product__0:10', type: 'wedge' },
      { bondId: '__rxn_product__0:14', type: 'dash' },
      { bondId: '__rxn_product__0:2', type: 'wedge' }
    ].sort((a, b) => a.bondId.localeCompare(b.bondId)),
    'expected untouched product stereobond choices to match the reactant-side display'
  );
});

test('reaction preview keeps lactam hydrolysis ring-opening product compact for bridged imide', () => {
  const preview = preparePreview(
    'C1=CC=C(C=C1)C2(C3CC3)C(=O)NC(=O)N2',
    reactionTemplates.lactamHydrolysis.smirks
  );
  const stats = heavyGeometryStats(preview, largestProductComponent(preview));
  assert.ok(stats.maxBond < 1.85, `expected no stretched heavy-atom bonds in bridged lactam hydrolysis preview, got ${stats.maxBond.toFixed(3)} Å`);
  assert.ok(stats.minNonbonded > 0.8, `expected no heavy-atom overlap in bridged lactam hydrolysis preview, got ${stats.minNonbonded.toFixed(3)} Å`);
});

test('reaction preview keeps lactam hydrolysis ring-opening product compact for tert-butyl imide mapping 2', () => {
  const sourceMol = parseSMILES('N1([C@H](C)C)C(=O)N(C)C(=O)C(C)(C)C1=O');
  const reactantSmarts = reactionTemplates.lactamHydrolysis.smirks.split('>>')[0];
  const mapping = [...findSMARTSRaw(sourceMol, reactantSmarts)][2];
  assert.ok(mapping, 'expected third lactam-hydrolysis mapping for tert-butyl imide');
  const preview = buildReaction2dMol(sourceMol, reactionTemplates.lactamHydrolysis.smirks, mapping);
  generateAndRefine2dCoords(preview.mol, { suppressH: true, bondLength: 1.5 });
  alignReaction2dProductOrientation(preview.mol, preview, 1.5);
  spreadReaction2dProductComponents(preview.mol, preview, 1.5);
  centerReaction2dPairCoords(preview.mol, preview, 1.5);
  const stats = heavyGeometryStats(preview, largestProductComponent(preview));
  assert.ok(stats.maxBond < 1.85, `expected no stretched heavy-atom bonds in tert-butyl lactam hydrolysis preview, got ${stats.maxBond.toFixed(3)} Å`);
  assert.ok(stats.minNonbonded > 0.8, `expected no heavy-atom overlap in tert-butyl lactam hydrolysis preview, got ${stats.minNonbonded.toFixed(3)} Å`);
});

test('reaction preview keeps remaining alkene substituent bent after dehalogenation', () => {
  const preview = preparePreview(
    'F/C=C/F',
    reactionTemplates.dehalogenation.smirks
  );
  const fluorine = [...preview.mol.atoms.values()].find(atom => preview.productAtomIds.has(atom.id) && atom.name === 'F');
  assert.ok(fluorine, 'expected remaining fluorine in dehalogenation preview');
  const alkeneCarbon = fluorine.getNeighbors(preview.mol).find(nb => nb.name === 'C');
  assert.ok(alkeneCarbon, 'expected fluorine to remain attached to alkene carbon');
  const otherAlkeneCarbon = alkeneCarbon.getNeighbors(preview.mol).find(nb => nb.id !== fluorine.id && (preview.mol.getBond(alkeneCarbon.id, nb.id)?.properties.order ?? 1) >= 2);
  assert.ok(otherAlkeneCarbon, 'expected alkene carbon partner in dehalogenation preview');
  const angle = angleDeg(fluorine, alkeneCarbon, otherAlkeneCarbon);
  assert.ok(angle > 105 && angle < 135, `expected remaining vinylic substituent bend to stay near trigonal, got ${angle.toFixed(1)}°`);
});

test('reaction preview keeps acid-chloride hydrolysis locally carboxyl-like', () => {
  const preview = preparePreview(
    'ClC(CCC)=O',
    reactionTemplates.halideHydrolysis.smirks
  );
  const acidCenter = findProductCarbonylCenters(preview)[0];
  assert.ok(acidCenter, 'expected carboxylic-acid center after acid-chloride hydrolysis');
  const oDouble = acidCenter.getNeighbors(preview.mol).find(nb => nb.name === 'O' && (preview.mol.getBond(acidCenter.id, nb.id)?.properties.order ?? 1) >= 2);
  const oSingle = acidCenter.getNeighbors(preview.mol).find(nb => nb.name === 'O' && (preview.mol.getBond(acidCenter.id, nb.id)?.properties.order ?? 1) === 1);
  const carbonNeighbor = acidCenter.getNeighbors(preview.mol).find(nb => nb.name === 'C');
  assert.ok(oDouble && oSingle && carbonNeighbor, 'expected O=C(O)-C geometry');
  assert.ok(
    angleDeg(carbonNeighbor, acidCenter, oSingle) > 115 && angleDeg(carbonNeighbor, acidCenter, oSingle) < 125,
    `expected C-C(=O)-O angle to stay trigonal, got ${angleDeg(carbonNeighbor, acidCenter, oSingle).toFixed(1)}°`
  );
  assert.ok(
    angleDeg(oDouble, acidCenter, carbonNeighbor) > 115 && angleDeg(oDouble, acidCenter, carbonNeighbor) < 125,
    `expected O=C-C angle to stay trigonal, got ${angleDeg(oDouble, acidCenter, carbonNeighbor).toFixed(1)}°`
  );
});

test('reaction preview keeps acid-chloride dehalogenation locally aldehyde-like', () => {
  const preview = preparePreview(
    'ClC(CCC)=O',
    reactionTemplates.dehalogenation.smirks
  );
  const aldehydeCenter = [...preview.mol.atoms.values()].find(atom =>
    preview.productAtomIds.has(atom.id) &&
    atom.name === 'C' &&
    atom.getNeighbors(preview.mol).some(nb => nb.name === 'O')
  );
  assert.ok(aldehydeCenter, 'expected aldehyde carbonyl center after acid-chloride dehalogenation');
  const oxygen = aldehydeCenter.getNeighbors(preview.mol).find(nb => nb.name === 'O');
  const carbonNeighbor = aldehydeCenter.getNeighbors(preview.mol).find(nb => nb.name === 'C');
  assert.ok(oxygen && carbonNeighbor, 'expected O=C-C fragment after dehalogenation');
  const angle = angleDeg(oxygen, aldehydeCenter, carbonNeighbor);
  assert.ok(angle > 115 && angle < 125, `expected aldehyde O=C-C angle to stay trigonal, got ${angle.toFixed(1)}°`);
});

test('reaction preview preserves fused-ring scaffold geometry for steroid alkene hydrogenation', () => {
  const preview = preparePreview(
    'CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1',
    reactionTemplates.alkeneHydrogenation.smirks
  );
  const error = maxPairDistanceErrorForMappedUnedited(preview);
  assert.ok(
    error < 0.05,
    `expected unchanged fused-ring scaffold distances to stay locked after alkene hydrogenation, got ${error.toFixed(3)} Å`
  );
});

test('reaction preview keeps alcohol cleavage local chain angle for sec-butanol', () => {
  const preview = preparePreview(
    'CC(O)CC',
    reactionTemplates.alcoholCleavage.smirks
  );
  const centralCarbon = [...preview.mol.atoms.values()].find(atom => {
    if (!preview.productAtomIds.has(atom.id) || atom.name !== 'C') {
      return false;
    }
    const carbonNeighbors = atom.getNeighbors(preview.mol).filter(nb => nb.name === 'C');
    return carbonNeighbors.length === 2;
  });
  assert.ok(centralCarbon, 'expected retained secondary carbon in alcohol cleavage preview');
  const carbonNeighbors = centralCarbon.getNeighbors(preview.mol).filter(nb => nb.name === 'C');
  const angle = angleDeg(carbonNeighbors[0], centralCarbon, carbonNeighbors[1]);
  assert.ok(angle > 105 && angle < 135, `expected retained chain angle to stay bent, got ${angle.toFixed(1)}°`);
});

test('reaction preview keeps terminal carbon-halogen bond bent after alcohol halogenation', () => {
  const preview = preparePreview(
    'C(C(C(C(C(C(C(C(C))))))))O',
    reactionTemplates.alcoholHalogenation.smirks
  );
  const chlorine = [...preview.mol.atoms.values()].find(atom => preview.productAtomIds.has(atom.id) && atom.name === 'Cl');
  assert.ok(chlorine, 'expected chlorine in alcohol halogenation preview');
  const terminalCarbon = chlorine.getNeighbors(preview.mol).find(nb => nb.name === 'C');
  assert.ok(terminalCarbon, 'expected chlorine to attach to terminal carbon');
  const chainNeighbor = terminalCarbon.getNeighbors(preview.mol).find(nb => nb.id !== chlorine.id && nb.name === 'C');
  assert.ok(chainNeighbor, 'expected terminal carbon to retain chain neighbor');
  const angle = angleDeg(chainNeighbor, terminalCarbon, chlorine);
  assert.ok(angle > 105 && angle < 135, `expected terminal C-Cl bond to stay bent, got ${angle.toFixed(1)}°`);
});
