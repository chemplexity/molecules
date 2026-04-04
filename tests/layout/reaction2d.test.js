import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../src/io/smiles.js';
import { reactionTemplates } from '../../src/smirks/reference.js';
import { findSMARTSRaw } from '../../src/smarts/search.js';
import { generateAndRefine2dCoords } from '../../src/layout/index.js';
import { pickStereoWedges } from '../../src/layout/mol2d-helpers.js';
import { buildReaction2dMol, alignReaction2dProductOrientation, spreadReaction2dProductComponents, centerReaction2dPairCoords } from '../../src/layout/reaction2d.js';
import {
  initReaction2d,
  _chooseReactionPreviewForceArrow,
  _isReactionPreviewEditableAtomId,
  _prepareReactionPreviewEraseTargets,
  _restoreReactionPreviewSnapshot,
  _clearReactionPreviewState
} from '../../src/app/render/reaction-2d.js';
import { validateValence } from '../../src/validation/index.js';

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

function serializeMol(mol) {
  return {
    atoms: [...mol.atoms.entries()].map(([id, atom]) => ({
      id,
      name: atom.name,
      x: atom.x,
      y: atom.y,
      visible: atom.visible,
      properties: JSON.parse(JSON.stringify(atom.properties))
    })),
    bonds: [...mol.bonds.entries()].map(([id, bond]) => ({
      id,
      atoms: [...bond.atoms],
      properties: JSON.parse(JSON.stringify(bond.properties))
    }))
  };
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
  return (Math.acos(dot) * 180) / Math.PI;
}

function maxPairDistanceErrorForMappedUnedited(preview) {
  const pairs = preview.mappedAtomPairs.filter(
    ([reactantId, productId]) => !preview.editedProductAtomIds.has(productId) && preview.mol.atoms.get(reactantId)?.name !== 'H' && preview.mol.atoms.get(productId)?.name !== 'H'
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

function minHeavyDistanceToEdited(preview, startId) {
  const componentAtomIds = preview.productComponentAtomIdSets.find(atomIds => atomIds.has(startId));
  if (!componentAtomIds?.has(startId)) {
    return Infinity;
  }
  if (preview.editedProductAtomIds.has(startId)) {
    return 0;
  }
  const start = preview.mol.atoms.get(startId);
  if (!start || start.name === 'H') {
    return Infinity;
  }
  const queue = [{ id: startId, distance: 0 }];
  const visited = new Set([startId]);
  while (queue.length > 0) {
    const { id, distance } = queue.shift();
    const atom = preview.mol.atoms.get(id);
    if (!atom) {
      continue;
    }
    for (const neighbor of atom.getNeighbors(preview.mol)) {
      if (!componentAtomIds.has(neighbor.id) || neighbor.name === 'H' || visited.has(neighbor.id)) {
        continue;
      }
      if (preview.editedProductAtomIds.has(neighbor.id)) {
        return distance + 1;
      }
      visited.add(neighbor.id);
      queue.push({ id: neighbor.id, distance: distance + 1 });
    }
  }
  return Infinity;
}

function _maxPairDistanceErrorForRetainedScaffold(preview, minDistanceFromEdited = 2) {
  const pairs = preview.mappedAtomPairs.filter(
    ([reactantId, productId]) =>
      !preview.editedProductAtomIds.has(productId) &&
      preview.mol.atoms.get(reactantId)?.name !== 'H' &&
      preview.mol.atoms.get(productId)?.name !== 'H' &&
      minHeavyDistanceToEdited(preview, productId) > minDistanceFromEdited
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

function maxPairDistanceDeltaFromSnapshot(mol, atomIds, snapshot) {
  const ids = [...atomIds].filter(id => mol.atoms.get(id)?.name !== 'H' && snapshot.has(id));
  let maxDelta = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const atomA = mol.atoms.get(ids[i]);
      const atomB = mol.atoms.get(ids[j]);
      const snapA = snapshot.get(ids[i]);
      const snapB = snapshot.get(ids[j]);
      const currentDistance = distance(atomA, atomB);
      const snapshotDistance = Math.hypot(snapA.x - snapB.x, snapA.y - snapB.y);
      maxDelta = Math.max(maxDelta, Math.abs(currentDistance - snapshotDistance));
    }
  }
  return maxDelta;
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
  const heavyAtoms = [...atomIds].map(id => preview.mol.atoms.get(id)).filter(atom => atom && atom.name !== 'H');
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

function atomIdBounds(preview, atomIds) {
  const atoms = [...atomIds].map(id => preview.mol.atoms.get(id)).filter(atom => atom && atom.name !== 'H');
  const xs = atoms.map(atom => atom.x);
  const ys = atoms.map(atom => atom.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };
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

test('force reaction arrow shifts to a clearer parallel lane when atoms block the centerline', () => {
  const reactant = { minX: -22, maxX: -6, minY: -8, maxY: 8, cx: -14, cy: 0 };
  const product = { minX: 6, maxX: 22, minY: -8, maxY: 8, cx: 14, cy: 0 };
  const nodes = [
    { id: 'r1', name: 'C', protons: 6, x: -14, y: 0 },
    { id: 'p1', name: 'C', protons: 6, x: 14, y: 0 },
    { id: 'blocker', name: 'H', protons: 1, x: 0, y: 0 }
  ];

  const arrow = _chooseReactionPreviewForceArrow(reactant, product, nodes, {
    pad: 16,
    radiusForItem: node => (node.name === 'H' ? 8 : 10),
    hydrogenRadiusScale: 0.75
  });

  assert.ok(arrow, 'expected a force reaction arrow candidate');
  assert.notEqual(arrow.offset, 0, 'expected blocked centerline arrow to shift off the midpoint');
  assert.ok(Math.abs(arrow.start.y - reactant.cy) > 1, 'expected shifted arrow to move away from the blocked centerline');
});

test('force reaction arrow keeps its previous lane when the new lane is only marginally better', () => {
  const reactant = { minX: -22, maxX: -6, minY: -8, maxY: 8, cx: -14, cy: 0 };
  const product = { minX: 6, maxX: 22, minY: -8, maxY: 8, cx: 14, cy: 0 };
  const nodes = [
    { id: 'r1', name: 'C', protons: 6, x: -14, y: 0 },
    { id: 'p1', name: 'C', protons: 6, x: 14, y: 0 },
    { id: 'topBlocker', name: 'H', protons: 1, x: 0, y: 10 },
    { id: 'bottomBlocker', name: 'H', protons: 1, x: 0, y: -15 }
  ];

  const arrow = _chooseReactionPreviewForceArrow(reactant, product, nodes, {
    pad: 16,
    radiusForItem: node => (node.name === 'H' ? 8 : 10),
    hydrogenRadiusScale: 0.75,
    previousOffset: -10,
    stickyTolerance: 6
  });

  assert.ok(arrow, 'expected a force reaction arrow candidate');
  assert.equal(arrow.offset, -10, 'expected previous arrow lane to be kept when still nearly as clear');
});

test('reaction preview erase targets ignore product-side atoms and bonds', () => {
  const sourceMol = parseSMILES('CCO');
  const smirks = reactionTemplates.alcoholDehydration.smirks;
  const mapping = [...findSMARTSRaw(sourceMol, smirks.split('>>')[0])][0];
  const preview = buildReaction2dMol(sourceMol, smirks, mapping);
  assert.ok(preview, 'expected dehydration preview to be buildable');

  const context = {
    mode: '2d',
    _mol2d: preview.mol,
    currentMol: null,
    renderMol(mol) {
      this._mol2d = mol;
    }
  };
  initReaction2d(context);
  _restoreReactionPreviewSnapshot({
    sourceMol: serializeMol(sourceMol),
    reactantAtomIds: [...preview.reactantAtomIds],
    productAtomIds: [...preview.productAtomIds],
    productComponentAtomIdSets: preview.productComponentAtomIdSets.map(atomIds => [...atomIds]),
    mappedAtomPairs: [...preview.mappedAtomPairs],
    editedProductAtomIds: [...preview.editedProductAtomIds],
    preservedReactantStereoByCenter: [],
    preservedReactantStereoBondTypes: [],
    preservedProductStereoByCenter: [],
    preservedProductStereoBondTypes: [],
    forcedStereoByCenter: [],
    forcedStereoBondTypes: [],
    forcedStereoBondCenters: [],
    reactantReferenceCoords: [],
    reactionPreviewHighlightMappings: []
  });

  const productC1 = preview.mappedAtomPairs.find(([sourceId]) => sourceId === 'C1')?.[1];
  const productC2 = preview.mappedAtomPairs.find(([sourceId]) => sourceId === 'C2')?.[1];
  assert.ok(productC1 && productC2, 'expected mapped dehydration product carbons');
  const productBond = preview.mol.getBond(productC1, productC2);
  assert.ok(productBond, 'expected dehydration product bond');

  const eraseTargets = _prepareReactionPreviewEraseTargets([productC2], [productBond.id]);
  assert.equal(eraseTargets.restored, false, 'expected product-side erase requests to leave reaction preview untouched');
  assert.deepEqual(eraseTargets.atomIds, []);
  assert.deepEqual(eraseTargets.bondIds, []);
  assert.ok(context._mol2d?.atoms.has(productC2), 'expected preview molecule to remain active in the render context');

  _clearReactionPreviewState();
});

test('reaction preview only allows atom edits on the reactant side', () => {
  const sourceMol = parseSMILES('CCO');
  const smirks = reactionTemplates.alcoholDehydration.smirks;
  const mapping = [...findSMARTSRaw(sourceMol, smirks.split('>>')[0])][0];
  const preview = buildReaction2dMol(sourceMol, smirks, mapping);
  assert.ok(preview, 'expected dehydration preview to be buildable');

  initReaction2d({
    mode: '2d',
    _mol2d: preview.mol,
    currentMol: null,
    renderMol() {}
  });
  _restoreReactionPreviewSnapshot({
    sourceMol: serializeMol(sourceMol),
    reactantAtomIds: [...preview.reactantAtomIds],
    productAtomIds: [...preview.productAtomIds],
    productComponentAtomIdSets: preview.productComponentAtomIdSets.map(atomIds => [...atomIds]),
    mappedAtomPairs: [...preview.mappedAtomPairs],
    editedProductAtomIds: [...preview.editedProductAtomIds],
    preservedReactantStereoByCenter: [],
    preservedReactantStereoBondTypes: [],
    preservedProductStereoByCenter: [],
    preservedProductStereoBondTypes: [],
    forcedStereoByCenter: [],
    forcedStereoBondTypes: [],
    forcedStereoBondCenters: [],
    reactantReferenceCoords: [],
    reactionPreviewHighlightMappings: []
  });

  const productC2 = preview.mappedAtomPairs.find(([sourceId]) => sourceId === 'C2')?.[1];
  assert.ok(productC2, 'expected mapped product atom');
  assert.equal(_isReactionPreviewEditableAtomId('C2'), true);
  assert.equal(_isReactionPreviewEditableAtomId(productC2), false);

  _clearReactionPreviewState();
});

test('reaction preview erase targets also ignore reactant-side atoms and bonds', () => {
  const sourceMol = parseSMILES('CCO');
  const smirks = reactionTemplates.alcoholDehydration.smirks;
  const mapping = [...findSMARTSRaw(sourceMol, smirks.split('>>')[0])][0];
  const preview = buildReaction2dMol(sourceMol, smirks, mapping);
  assert.ok(preview, 'expected dehydration preview to be buildable');

  const context = {
    mode: '2d',
    _mol2d: preview.mol,
    currentMol: null,
    renderMol(mol) {
      this._mol2d = mol;
    }
  };
  initReaction2d(context);
  _restoreReactionPreviewSnapshot({
    sourceMol: serializeMol(sourceMol),
    reactantAtomIds: [...preview.reactantAtomIds],
    productAtomIds: [...preview.productAtomIds],
    productComponentAtomIdSets: preview.productComponentAtomIdSets.map(atomIds => [...atomIds]),
    mappedAtomPairs: [...preview.mappedAtomPairs],
    editedProductAtomIds: [...preview.editedProductAtomIds],
    preservedReactantStereoByCenter: [],
    preservedReactantStereoBondTypes: [],
    preservedProductStereoByCenter: [],
    preservedProductStereoBondTypes: [],
    forcedStereoByCenter: [],
    forcedStereoBondTypes: [],
    forcedStereoBondCenters: [],
    reactantReferenceCoords: [],
    reactionPreviewHighlightMappings: []
  });

  const reactantBond = preview.mol.getBond('C1', 'C2');
  assert.ok(reactantBond, 'expected reactant-side bond in preview');

  const eraseTargets = _prepareReactionPreviewEraseTargets(['C2'], [reactantBond.id]);
  assert.equal(eraseTargets.restored, false, 'expected reactant-side erase requests to stay in reaction preview');
  assert.deepEqual(eraseTargets.atomIds, []);
  assert.deepEqual(eraseTargets.bondIds, []);
  assert.ok(context._mol2d?.atoms.has('C2'), 'expected preview molecule to remain active in the render context');

  _clearReactionPreviewState();
});

test('reaction preview preserves ring scaffold geometry for alkene hydrogenation', () => {
  const preview = preparePreview('C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O', reactionTemplates.alkeneHydrogenation.smirks);
  const maxError = maxPairDistanceErrorForMappedUnedited(preview);
  assert.ok(maxError < 0.15, `expected preserved ring scaffold distances to stay close, got max error ${maxError.toFixed(3)} Å`);
});

test('reaction preview keeps terminal alkene hydrogenation in a zig-zag for C=CCC', () => {
  const preview = preparePreview('C=CCC', reactionTemplates.alkeneHydrogenation.smirks);
  const atoms = [...preview.mol.atoms.values()].filter(atom => preview.productAtomIds.has(atom.id) && atom.name !== 'H').sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(atoms.length, 4, 'expected four heavy atoms in hydrogenated product');
  const angle = angleDeg(atoms[0], atoms[1], atoms[2]);
  assert.ok(angle > 100 && angle < 140, `expected new saturated chain angle to stay zig-zag-like, got ${angle.toFixed(1)}°`);
});

test('reaction preview stays valence-clean for ethanol dehydration', () => {
  const preview = preparePreview('CCO', reactionTemplates.alcoholDehydration.smirks);
  assert.deepEqual(validateValence(preview.mol), []);
});

test('reaction preview keeps nitrile hydrolysis to amide carbonyl locally trigonal', () => {
  const preview = preparePreview('N#CC(C#N)=C(C#N)C#N', reactionTemplates.nitrileHydrolysisToAmide.smirks);
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
  const preview = preparePreview('C1=CC=C(C=C1)C2(C3CC3)C(=O)NC(=O)N2', reactionTemplates.lactamHydrolysis.smirks);
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

test('reaction preview keeps the cytosine amide-hydrolysis product leveled', () => {
  const sourceMol = parseSMILES('NC1=NC(=O)N(C=C1)C(=O)N');
  const reactantSmarts = reactionTemplates.amideHydrolysis.smirks.split('>>')[0];
  const mappings = [...findSMARTSRaw(sourceMol, reactantSmarts)];
  const mapping = mappings[3];
  assert.ok(mapping, 'expected the cytosine ring-nitrogen amide-hydrolysis mapping');

  const preview = buildReaction2dMol(sourceMol, reactionTemplates.amideHydrolysis.smirks, mapping);
  generateAndRefine2dCoords(preview.mol, { suppressH: true, bondLength: 1.5 });
  alignReaction2dProductOrientation(preview.mol, preview, 1.5);
  spreadReaction2dProductComponents(preview.mol, preview, 1.5);
  centerReaction2dPairCoords(preview.mol, preview, 1.5);

  const topLeft = preview.mol.atoms.get('__rxn_product__0:N1');
  const topRight = preview.mol.atoms.get('__rxn_product__0:C2');
  const midLeft = preview.mol.atoms.get('__rxn_product__0:N3');
  const midRight = preview.mol.atoms.get('__rxn_product__0:C4');
  const bottomLeft = preview.mol.atoms.get('__rxn_product__0:C8');
  const bottomRight = preview.mol.atoms.get('__rxn_product__0:C7');
  assert.ok(topLeft && topRight && midLeft && midRight && bottomLeft && bottomRight, 'expected mapped cytosine product ring atoms');

  assert.ok(Math.abs(topLeft.y - topRight.y) < 0.05, `expected top edge to stay level, got Δy=${Math.abs(topLeft.y - topRight.y).toFixed(3)} Å`);
  assert.ok(Math.abs(midLeft.y - midRight.y) < 0.05, `expected middle edge to stay level, got Δy=${Math.abs(midLeft.y - midRight.y).toFixed(3)} Å`);
  assert.ok(Math.abs(bottomLeft.y - bottomRight.y) < 0.05, `expected bottom edge to stay level, got Δy=${Math.abs(bottomLeft.y - bottomRight.y).toFixed(3)} Å`);
});

test('reaction preview keeps retained chain geometry sane for dehalogenation', () => {
  const smiles = 'CC(CC(Cl)CCO)C';
  for (const smirks of [reactionTemplates.dehalogenation.smirks]) {
    const preview = preparePreview(smiles, smirks);
    const component = largestProductComponent(preview);
    const stats = heavyGeometryStats(preview, component);
    assert.ok(stats.minBond > 1.05, `expected no compressed heavy-atom bonds, got ${stats.minBond.toFixed(3)} Å for ${smirks}`);
    assert.ok(stats.maxBond < 1.85, `expected no stretched heavy-atom bonds, got ${stats.maxBond.toFixed(3)} Å for ${smirks}`);
    assert.ok(stats.minNonbonded > 0.8, `expected no heavy-atom overlap, got ${stats.minNonbonded.toFixed(3)} Å for ${smirks}`);
  }
});

test('reaction preview preserves local zig-zag geometry for branched-chain dehalogenation', () => {
  const preview = preparePreview('CC(CC(Cl)CCO)C', reactionTemplates.dehalogenation.smirks);
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

test('reaction preview preserves the retained sugar scaffold for ether cleavage', () => {
  const smiles = 'C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O';
  const smirks = reactionTemplates.etherCleavage.smirks;
  const sourceMol = parseSMILES(smiles);
  const mappings = [...findSMARTSRaw(sourceMol, smirks.split('>>')[0])];
  assert.equal(mappings.length, 2, 'expected two ether-cleavage sites in the sugar example');

  for (const mapping of mappings) {
    const preview = buildReaction2dMol(sourceMol, smirks, mapping);
    generateAndRefine2dCoords(preview.mol, {
      suppressH: true,
      bondLength: 1.5
    });
    const component = largestProductComponent(preview);
    const isolatedSnapshot = new Map(
      [...component]
        .map(id => [id, preview.mol.atoms.get(id)])
        .filter(([, atom]) => atom && atom.name !== 'H' && atom.x != null && atom.y != null)
        .map(([id, atom]) => [id, { x: atom.x, y: atom.y }])
    );
    alignReaction2dProductOrientation(preview.mol, preview, 1.5);
    spreadReaction2dProductComponents(preview.mol, preview, 1.5);
    centerReaction2dPairCoords(preview.mol, preview, 1.5);
    const stats = heavyGeometryStats(preview, component);
    const internalDrift = maxPairDistanceDeltaFromSnapshot(preview.mol, component, isolatedSnapshot);
    assert.ok(stats.maxBond < 1.95, `expected ether-cleavage sugar preview to avoid stretched heavy bonds, got ${stats.maxBond.toFixed(3)} Å`);
    assert.ok(stats.minNonbonded > 0.8, `expected ether-cleavage sugar preview to avoid heavy-atom overlap, got ${stats.minNonbonded.toFixed(3)} Å`);
    assert.ok(
      internalDrift < 1e-6,
      `expected ether-cleavage sugar product geometry to survive reaction alignment unchanged, got max pair-distance drift ${internalDrift.toExponential(3)} Å`
    );
  }
});

test('reaction preview keeps ether-cleavage ring-opening product leveled (landscape)', () => {
  // Glucose (ring form): ether cleavage opens the ring to an open-chain hexitol.
  // After alignment to the reactant scaffold, the open-chain backbone should be
  // re-leveled (horizontal) rather than tilted to match the ring orientation.
  const smiles = 'C([C@@H]1[C@H]([C@@H]([C@H](C(O1)O)O)O)O)O';
  const smirks = reactionTemplates.etherCleavage.smirks;
  const sourceMol = parseSMILES(smiles);
  const mappings = [...findSMARTSRaw(sourceMol, smirks.split('>>')[0])];

  for (const mapping of mappings) {
    const preview = buildReaction2dMol(sourceMol, smirks, mapping);
    assert.ok(preview, 'expected ether-cleavage preview to build');
    alignReaction2dProductOrientation(preview.mol, preview, 1.5);

    for (const atomIds of preview.productComponentAtomIdSets) {
      const atoms = [...atomIds].map(id => preview.mol.atoms.get(id)).filter(a => a && a.name !== 'H');
      if (atoms.length < 8) {
        continue;
      }
      const bounds = atomIdBounds(preview, atomIds);
      assert.ok(
        bounds.width > bounds.height,
        `expected open-chain ether-cleavage product to be landscape after alignment, got width=${bounds.width.toFixed(2)} height=${bounds.height.toFixed(2)}`
      );
    }
  }
});

test('reaction preview keeps nitrile hydrolysis to acid locally carboxyl-like for isolated nitrile', () => {
  const preview = preparePreview('C#N', reactionTemplates.nitrileHydrolysisToAcid.smirks);
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
  const preview = preparePreview('N#CC(C#N)=C(C#N)C#N', reactionTemplates.nitrileHydrogenationToImine.smirks);
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
    generateAndRefine2dCoords(preview.mol, {
      suppressH: true,
      bondLength: 1.5
    });
    alignReaction2dProductOrientation(preview.mol, preview, 1.5);
    spreadReaction2dProductComponents(preview.mol, preview, 1.5);
    centerReaction2dPairCoords(preview.mol, preview, 1.5);

    const stats = heavyGeometryStats(preview, largestProductComponent(preview));
    assert.ok(stats.maxBond < 1.85, `expected no stretched heavy-atom bonds in nitrile-to-imine mapping ${index}, got ${stats.maxBond.toFixed(3)} Å`);
    assert.ok(stats.minNonbonded > 0.8, `expected no heavy-atom overlap in nitrile-to-imine mapping ${index}, got ${stats.minNonbonded.toFixed(3)} Å`);
  }
});

test('reaction preview preserves exact stereobond choices on both sides for untouched stereocenters', () => {
  const smiles = 'C1=C[C@H]2[C@@H](C1)C=C[C@@H]2C(=O)O';
  const sourceMol = parseSMILES(smiles);
  generateAndRefine2dCoords(sourceMol, { suppressH: true, bondLength: 1.5 });
  const sourceStereoBonds = [...pickStereoWedges(sourceMol)].map(([bondId, type]) => ({ bondId, type })).sort((a, b) => a.bondId.localeCompare(b.bondId));
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
  assert.deepEqual(reactantStereoBonds, sourceStereoBonds, 'expected reactant-side stereobond choices to stay unchanged in reaction preview');

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
  const preview = preparePreview('C1=CC=C(C=C1)C2(C3CC3)C(=O)NC(=O)N2', reactionTemplates.lactamHydrolysis.smirks);
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
  const preview = preparePreview('F/C=C/F', reactionTemplates.dehalogenation.smirks);
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
  const preview = preparePreview('ClC(CCC)=O', reactionTemplates.halideHydrolysis.smirks);
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
  const preview = preparePreview('ClC(CCC)=O', reactionTemplates.dehalogenation.smirks);
  const aldehydeCenter = [...preview.mol.atoms.values()].find(
    atom => preview.productAtomIds.has(atom.id) && atom.name === 'C' && atom.getNeighbors(preview.mol).some(nb => nb.name === 'O')
  );
  assert.ok(aldehydeCenter, 'expected aldehyde carbonyl center after acid-chloride dehalogenation');
  const oxygen = aldehydeCenter.getNeighbors(preview.mol).find(nb => nb.name === 'O');
  const carbonNeighbor = aldehydeCenter.getNeighbors(preview.mol).find(nb => nb.name === 'C');
  assert.ok(oxygen && carbonNeighbor, 'expected O=C-C fragment after dehalogenation');
  const angle = angleDeg(oxygen, aldehydeCenter, carbonNeighbor);
  assert.ok(angle > 115 && angle < 125, `expected aldehyde O=C-C angle to stay trigonal, got ${angle.toFixed(1)}°`);
});

test('reaction preview preserves fused-ring scaffold geometry for steroid alkene hydrogenation', () => {
  const preview = preparePreview('CC(C)CCCC(C)C1CCC2C3C(CC=C4C3(CCC5C4CCC(C5)O)C)CC2C1', reactionTemplates.alkeneHydrogenation.smirks);
  const error = maxPairDistanceErrorForMappedUnedited(preview);
  assert.ok(error < 0.05, `expected unchanged fused-ring scaffold distances to stay locked after alkene hydrogenation, got ${error.toFixed(3)} Å`);
});

test('reaction preview keeps long polyunsaturated-chain alkene hydrogenation locally bent across all mappings', () => {
  const smiles = 'CC\\C=C/C\\C=C/C\\C=C/C\\C=C/C\\C=C/C\\C=C/CCC(=O)O';
  const sourceMol = parseSMILES(smiles);
  const reactantSmarts = reactionTemplates.alkeneHydrogenation.smirks.split('>>')[0];
  const mappings = [...findSMARTSRaw(sourceMol, reactantSmarts)];
  assert.ok(mappings.length > 0, 'expected alkene-hydrogenation mappings for long polyunsaturated chain');

  for (const [index, mapping] of mappings.entries()) {
    const preview = buildReaction2dMol(sourceMol, reactionTemplates.alkeneHydrogenation.smirks, mapping);
    assert.ok(preview, `expected preview for mapping ${index}`);
    generateAndRefine2dCoords(preview.mol, {
      suppressH: true,
      bondLength: 1.5
    });
    alignReaction2dProductOrientation(preview.mol, preview, 1.5);
    spreadReaction2dProductComponents(preview.mol, preview, 1.5);
    centerReaction2dPairCoords(preview.mol, preview, 1.5);

    const editedCarbons = [...preview.editedProductAtomIds].map(id => preview.mol.atoms.get(id)).filter(atom => atom?.name === 'C');
    assert.equal(editedCarbons.length, 2, `expected two edited carbons for mapping ${index}`);

    for (const atom of editedCarbons) {
      const carbonNeighbors = atom.getNeighbors(preview.mol).filter(nb => nb.name !== 'H' && preview.productAtomIds.has(nb.id));
      if (carbonNeighbors.length !== 2) {
        continue;
      }
      const localAngle = angleDeg(carbonNeighbors[0], atom, carbonNeighbors[1]);
      assert.ok(localAngle > 100 && localAngle < 140, `expected bent local geometry for mapping ${index} at ${atom.id}, got ${localAngle.toFixed(1)}°`);
    }
  }
});

test('reaction preview preserves long polyunsaturated-chain scaffold shape for alkene hydrogenation across EPA and DHA mappings', () => {
  for (const smiles of ['CC\\C=C/C\\C=C/C\\C=C/C\\C=C/C\\C=C/CCCC(=O)O', 'CC\\C=C/C\\C=C/C\\C=C/C\\C=C/C\\C=C/C\\C=C/CCC(=O)O']) {
    const sourceMol = parseSMILES(smiles);
    const reactantSmarts = reactionTemplates.alkeneHydrogenation.smirks.split('>>')[0];
    const mappings = [...findSMARTSRaw(sourceMol, reactantSmarts)];
    assert.ok(mappings.length > 0, `expected alkene-hydrogenation mappings for ${smiles}`);

    for (const [index, mapping] of mappings.entries()) {
      const preview = buildReaction2dMol(sourceMol, reactionTemplates.alkeneHydrogenation.smirks, mapping);
      assert.ok(preview, `expected preview for mapping ${index} of ${smiles}`);
      generateAndRefine2dCoords(preview.mol, {
        suppressH: true,
        bondLength: 1.5
      });
      alignReaction2dProductOrientation(preview.mol, preview, 1.5);
      spreadReaction2dProductComponents(preview.mol, preview, 1.5);
      centerReaction2dPairCoords(preview.mol, preview, 1.5);

      const maxError = maxPairDistanceErrorForMappedUnedited(preview);
      assert.ok(maxError < 0.05, `expected preserved EPA/DHA scaffold distances to stay close for mapping ${index} of ${smiles}, got ${maxError.toFixed(3)} Å`);

      const productBounds = atomIdBounds(preview, largestProductComponent(preview));
      assert.ok(
        productBounds.width >= productBounds.height,
        `expected product chain to stay landscape for mapping ${index} of ${smiles}, got width=${productBounds.width.toFixed(3)} Å height=${productBounds.height.toFixed(3)} Å`
      );

      const geometry = heavyGeometryStats(preview, largestProductComponent(preview));
      assert.ok(
        geometry.minNonbonded >= 1.2,
        `expected no tight self-overlap for mapping ${index} of ${smiles}, got nearest non-bonded distance ${geometry.minNonbonded.toFixed(3)} Å`
      );
      assert.ok(geometry.maxBond <= 1.85, `expected no stretched product bonds for mapping ${index} of ${smiles}, got ${geometry.maxBond.toFixed(3)} Å`);
    }
  }
});

test('reaction preview keeps terminal carbon-halogen bond bent after alcohol halogenation', () => {
  const preview = preparePreview('C(C(C(C(C(C(C(C(C))))))))O', reactionTemplates.alcoholHalogenation.smirks);
  const chlorine = [...preview.mol.atoms.values()].find(atom => preview.productAtomIds.has(atom.id) && atom.name === 'Cl');
  assert.ok(chlorine, 'expected chlorine in alcohol halogenation preview');
  const terminalCarbon = chlorine.getNeighbors(preview.mol).find(nb => nb.name === 'C');
  assert.ok(terminalCarbon, 'expected chlorine to attach to terminal carbon');
  const chainNeighbor = terminalCarbon.getNeighbors(preview.mol).find(nb => nb.id !== chlorine.id && nb.name === 'C');
  assert.ok(chainNeighbor, 'expected terminal carbon to retain chain neighbor');
  const angle = angleDeg(chainNeighbor, terminalCarbon, chlorine);
  assert.ok(angle > 105 && angle < 135, `expected terminal C-Cl bond to stay bent, got ${angle.toFixed(1)}°`);
});

test('reaction preview keeps alkyne full reduction locally bent for 2-butyne', () => {
  const preview = preparePreview('CC#CC', reactionTemplates.alkyneFullReduction.smirks);
  const productCarbons = [...preview.mol.atoms.values()].filter(atom => preview.productAtomIds.has(atom.id) && atom.name === 'C').sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(productCarbons.length, 4, 'expected four carbons in fully reduced 2-butyne product');
  const angle1 = angleDeg(productCarbons[0], productCarbons[1], productCarbons[2]);
  const angle2 = angleDeg(productCarbons[1], productCarbons[2], productCarbons[3]);
  assert.ok(angle1 > 100 && angle1 < 140, `expected first reduced sp3 angle to stay bent, got ${angle1.toFixed(1)}°`);
  assert.ok(angle2 > 100 && angle2 < 140, `expected second reduced sp3 angle to stay bent, got ${angle2.toFixed(1)}°`);
});

test('reaction preview keeps alkyne partial reduction locally bent for 2-butyne', () => {
  const preview = preparePreview('CC#CC', reactionTemplates.alkynePartialReduction.smirks);
  const productCarbons = [...preview.mol.atoms.values()].filter(atom => preview.productAtomIds.has(atom.id) && atom.name === 'C').sort((a, b) => a.id.localeCompare(b.id));
  assert.equal(productCarbons.length, 4, 'expected four carbons in partially reduced 2-butyne product');
  const angle1 = angleDeg(productCarbons[0], productCarbons[1], productCarbons[2]);
  const angle2 = angleDeg(productCarbons[1], productCarbons[2], productCarbons[3]);
  assert.ok(angle1 > 100 && angle1 < 140, `expected first alkene angle to stay bent, got ${angle1.toFixed(1)}°`);
  assert.ok(angle2 > 100 && angle2 < 140, `expected second alkene angle to stay bent, got ${angle2.toFixed(1)}°`);
});
