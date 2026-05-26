import { Molecule } from '../core/Molecule.js';
import { applySMIRKS } from '../smirks/index.js';
import { generateAndRefine2dCoords } from './index.js';
import { ensureLandscapeOrientation, findPreferredBackbonePath, shouldPreferFinalLandscapeOrientation } from './engine/orientation.js';
import { createLayoutGraph } from './engine/model/layout-graph.js';
import { applyDisplayedStereoToCenter, pickStereoWedges } from './mol2d-helpers.js';

// ---------------------------------------------------------------------------
// Element-set constants (module-level to avoid repeated inline allocations)
// ---------------------------------------------------------------------------

/** Terminal heteroatoms whose peripheral direction is preserved in reaction layout. */
const _TERMINAL_HETEROATOMS = new Set(['O', 'N', 'S']);

/** Halogens whose peripheral direction is preserved in reaction layout. */
const _HALOGENS = new Set(['F', 'Cl', 'Br', 'I']);

/**
 * Returns true when the heavy-atom bond lengths in `mol` are consistent with
 * chemistry-space 2D coordinates (expected ~`bondLength` Å) rather than
 * force-layout pixel coordinates (~41 px per bond). Forces the range
 * [bondLength*0.2, bondLength*5] which comfortably separates the two scales.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {number} bondLength - Target bond length.
 * @returns {boolean} True if coordinates are in chemistry scale.
 */
function _coordsAreChemScale(mol, bondLength = 1.5) {
  let sum = 0,
    count = 0;
  for (const bond of mol.bonds.values()) {
    const [a, b] = bond.getAtomObjects(mol);
    if (!a || !b || a.x == null || b.x == null || a.name === 'H' || b.name === 'H') {
      continue;
    }
    sum += Math.hypot(b.x - a.x, b.y - a.y);
    count++;
  }
  if (count === 0) {
    return false;
  }
  const avg = sum / count;
  return avg >= bondLength * 0.2 && avg <= bondLength * 5;
}

/**
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {string} prefix - String prefix.
 * @returns {import('../core/Molecule.js').Molecule} Cloned molecule with prefixed IDs.
 */
export function cloneWithPrefixedIds(mol, prefix) {
  const cloned = new Molecule();
  for (const atom of mol.atoms.values()) {
    const copy = cloned.addAtom(`${prefix}${atom.id}`, atom.name, JSON.parse(JSON.stringify(atom.properties ?? {})));
    copy.x = atom.x;
    copy.y = atom.y;
    copy.z = atom.z;
    copy.visible = atom.visible;
    copy.tags = [...(atom.tags ?? [])];
  }
  for (const bond of mol.bonds.values()) {
    const copy = cloned.addBond(`${prefix}${bond.id}`, `${prefix}${bond.atoms[0]}`, `${prefix}${bond.atoms[1]}`, JSON.parse(JSON.stringify(bond.properties ?? {})), false);
    copy.tags = [...(bond.tags ?? [])];
  }
  return cloned;
}

function prepareReaction2dStereoReferenceMol(mol, bondLength = 1.5) {
  if (!mol) {
    return mol;
  }
  mol.hideHydrogens();
  const heavyAtoms = [...mol.atoms.values()].filter(atom => atom.name !== 'H');
  const hasExistingHeavyCoords = heavyAtoms.length > 0 && heavyAtoms.every(atom => atom.x != null && atom.y != null);
  const hasChem2dScale = hasExistingHeavyCoords && _coordsAreChemScale(mol, bondLength);
  if (!hasChem2dScale) {
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength });
  }
  for (const atom of mol.atoms.values()) {
    if (atom.name !== 'H' || atom.visible !== false) {
      continue;
    }
    const neighbors = atom.getNeighbors(mol);
    if (neighbors.length !== 1) {
      continue;
    }
    const parent = neighbors[0];
    if (!parent.getChirality()) {
      continue;
    }
    const others = parent.getNeighbors(mol).filter(nb => nb.id !== atom.id);
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const nb of others) {
      if (nb.x == null) {
        continue;
      }
      sumX += nb.x - parent.x;
      sumY += nb.y - parent.y;
      count++;
    }
    const angle = count > 0 ? Math.atan2(-sumY, -sumX) : 0;
    const hLen = bondLength * 0.75;
    atom.x = parent.x + Math.cos(angle) * hLen;
    atom.y = parent.y + Math.sin(angle) * hLen;
  }
  return mol;
}

function prepareReaction2dLayoutReferenceMol(mol, bondLength = 1.5) {
  if (!mol) {
    return mol;
  }
  const heavyAtoms = [...mol.atoms.values()].filter(atom => atom.name !== 'H');
  const hasExistingHeavyCoords = heavyAtoms.length > 0 && heavyAtoms.every(atom => atom.x != null && atom.y != null);
  const hasChem2dScale = hasExistingHeavyCoords && _coordsAreChemScale(mol, bondLength);
  if (!hasChem2dScale) {
    generateAndRefine2dCoords(mol, { suppressH: true, bondLength });
  }
  return mol;
}

/**
 * @param {import('../core/Molecule.js').Molecule} sourceMol - The source molecule.
 * @param {string} smirks - SMIRKS reaction string.
 * @param {Map.<string, string>} mapping - Atom-to-atom mapping (query ID → target ID).
 * @returns {import('../core/Molecule.js').Molecule|null} The reaction 2D scaffold, or null if inputs are invalid.
 */
export function buildReaction2dMol(sourceMol, smirks, mapping = undefined) {
  if (!sourceMol || !smirks) {
    return null;
  }
  const reactantMol = sourceMol.clone();
  const productMol = applySMIRKS(sourceMol, smirks, { mode: 'first', skipCoordGen: true, ...(mapping ? { mapping } : {}) });
  if (!productMol) {
    return null;
  }
  let previewMol = reactantMol;
  const productAtomIds = new Set();
  const productComponentAtomIdSets = [];
  const mappedAtomPairs = [];
  const reactantAffectedAtomIds = new Set(mapping ? [...mapping.values()] : []);
  const productAffectedAtomIds = new Set();
  const layoutReferenceMol = prepareReaction2dLayoutReferenceMol(sourceMol.clone());
  const reactantReferenceCoords = snapshotReaction2dCoords(layoutReferenceMol, new Set(layoutReferenceMol.atoms.keys()));
  const sourceStereoReferenceMol = prepareReaction2dStereoReferenceMol(layoutReferenceMol.clone());
  const sourceStereoBondTypes = new Map(pickStereoWedges(sourceStereoReferenceMol));
  const sourceStereoByCenter = new Map();
  for (const [bondId, type] of sourceStereoBondTypes) {
    const bond = sourceStereoReferenceMol.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const [aId, bId] = bond.atoms;
    const a = sourceStereoReferenceMol.atoms.get(aId);
    const b = sourceStereoReferenceMol.atoms.get(bId);
    const centerId = a?.getChirality() ? aId : b?.getChirality() ? bId : null;
    if (!centerId) {
      continue;
    }
    const otherId = centerId === aId ? bId : aId;
    sourceStereoByCenter.set(centerId, { otherId, type });
  }
  const sortedComponents = productMol.getComponents().sort((a, b) => {
    const aHeavy = [...a.atoms.values()].filter(atom => atom.name !== 'H').length;
    const bHeavy = [...b.atoms.values()].filter(atom => atom.name !== 'H').length;
    if (bHeavy !== aHeavy) {
      return bHeavy - aHeavy;
    }
    if (b.atoms.size !== a.atoms.size) {
      return b.atoms.size - a.atoms.size;
    }
    return 0;
  });
  sortedComponents.forEach((componentMol, index) => {
    const prefixedComponent = cloneWithPrefixedIds(componentMol, `__rxn_product__${index}:`);
    const atomIds = new Set(prefixedComponent.atoms.keys());
    productComponentAtomIdSets.push(atomIds);
    for (const id of atomIds) {
      productAtomIds.add(id);
    }
    for (const atomId of componentMol.atoms.keys()) {
      if (reactantMol.atoms.has(atomId)) {
        const productId = `__rxn_product__${index}:${atomId}`;
        mappedAtomPairs.push([atomId, productId]);
        if (reactantAffectedAtomIds.has(atomId)) {
          productAffectedAtomIds.add(productId);
        }
      }
    }
    for (const atom of prefixedComponent.atoms.values()) {
      const sourceId = sourceAtomId(atom.id);
      const isMappedAffected = productAffectedAtomIds.has(atom.id);
      const isNewAtom = !reactantMol.atoms.has(sourceId);
      if (!isNewAtom || isMappedAffected) {
        continue;
      }
      const touchesAffected = atom.getNeighbors(prefixedComponent).some(nb => productAffectedAtomIds.has(nb.id));
      if (touchesAffected) {
        productAffectedAtomIds.add(atom.id);
      }
    }
    previewMol = previewMol.merge(prefixedComponent);
  });
  const highlightMapping = new Map();
  const productIdBySourceId = new Map(mappedAtomPairs.map(([sourceId, productId]) => [sourceId, productId]));
  const preservedProductStereoByCenter = new Map();
  const preservedProductStereoBondTypes = new Map();
  for (const [sourceCenterId, stereo] of sourceStereoByCenter) {
    const productCenterId = productIdBySourceId.get(sourceCenterId);
    const otherProductId = productIdBySourceId.get(stereo.otherId);
    if (!productCenterId || !otherProductId || productAffectedAtomIds.has(productCenterId)) {
      continue;
    }
    preservedProductStereoByCenter.set(productCenterId, {
      otherProductId,
      type: stereo.type
    });
  }
  for (const [sourceBondId, type] of sourceStereoBondTypes) {
    const sourceBond = reactantMol.bonds.get(sourceBondId);
    if (!sourceBond) {
      continue;
    }
    const productA = productIdBySourceId.get(sourceBond.atoms[0]);
    const productB = productIdBySourceId.get(sourceBond.atoms[1]);
    if (!productA || !productB) {
      continue;
    }
    if (productAffectedAtomIds.has(productA) || productAffectedAtomIds.has(productB)) {
      continue;
    }
    const productBond = previewMol.getBond(productA, productB);
    if (!productBond) {
      continue;
    }
    preservedProductStereoBondTypes.set(productBond.id, type);
  }
  for (const id of reactantAffectedAtomIds) {
    highlightMapping.set(id, id);
  }
  for (const id of productAffectedAtomIds) {
    highlightMapping.set(id, id);
  }

  // Offset product component(s) to the right of the reactant so that force-mode
  // can seed the simulation from non-overlapping positions.  (In 2D mode,
  // render2d → alignReaction2dProductOrientation + centerReaction2dPairCoords
  // will reposition everything anyway, but in force mode updateForce is called
  // directly on the preview mol and relies on atom.x / atom.y as anchors.)
  const reactantHeavy = [...reactantMol.atoms.values()].filter(a => a.name !== 'H' && Number.isFinite(a.x));
  if (reactantHeavy.length > 0) {
    const reactantMaxX = Math.max(...reactantHeavy.map(a => a.x));
    const reactantMinX = Math.min(...reactantHeavy.map(a => a.x));
    const reactantWidth = reactantMaxX - reactantMinX;
    let cursor = reactantMaxX + reactantWidth * 0.5 + 3.0;
    for (const componentAtomIds of productComponentAtomIdSets) {
      const productHeavy = [...componentAtomIds].map(id => previewMol.atoms.get(id)).filter(a => a && a.name !== 'H' && Number.isFinite(a.x));
      if (productHeavy.length === 0) {
        continue;
      }
      const pMinX = Math.min(...productHeavy.map(a => a.x));
      const pMaxX = Math.max(...productHeavy.map(a => a.x));
      const dx = cursor - pMinX;
      for (const atomId of componentAtomIds) {
        const atom = previewMol.atoms.get(atomId);
        if (atom && Number.isFinite(atom.x)) {
          atom.x += dx;
        }
      }
      cursor += pMaxX - pMinX + 3.0;
    }
  }

  return {
    mol: previewMol,
    reactantAtomIds: new Set(reactantMol.atoms.keys()),
    productAtomIds,
    productComponentAtomIdSets,
    mappedAtomPairs,
    editedProductAtomIds: productAffectedAtomIds,
    preservedReactantStereoByCenter: new Map(sourceStereoByCenter),
    preservedReactantStereoBondTypes: new Map(sourceStereoBondTypes),
    preservedProductStereoByCenter,
    preservedProductStereoBondTypes,
    forcedStereoByCenter: new Map(),
    forcedStereoBondTypes: new Map(),
    forcedStereoBondCenters: new Map(),
    forcedProductStereoByCenter: new Map(),
    reactantReferenceCoords,
    highlightMapping
  };
}

/**
 * @param {string} productAtomId - Product atom ID.
 * @returns {string} The corresponding source atom ID.
 */
export function sourceAtomId(productAtomId) {
  return typeof productAtomId === 'string' ? productAtomId.split(':').slice(1).join(':') : productAtomId;
}

function reaction2dArrowGeometry(items, atomIds) {
  if (!atomIds?.size) {
    return null;
  }
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  let count = 0;
  for (const item of items) {
    if (!atomIds.has(item.id)) {
      continue;
    }
    if (item.x - 0 < minX) {
      minX = item.x;
    }
    if (item.x + 0 > maxX) {
      maxX = item.x;
    }
    if (item.y - 0 < minY) {
      minY = item.y;
    }
    if (item.y + 0 > maxY) {
      maxY = item.y;
    }
    count++;
  }
  if (count === 0) {
    return null;
  }
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function reaction2dArrowGeometryPreferHeavy(items, atomIds) {
  const heavyItems = items.filter(item => atomIds.has(item.id) && item.name !== 'H');
  if (heavyItems.length > 0) {
    return reaction2dArrowGeometry(heavyItems, atomIds);
  }
  return reaction2dArrowGeometry(items, atomIds);
}

function relayoutReaction2dComponentInIsolation(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }

  const componentMol = new Molecule();
  for (const atomId of componentAtomIds) {
    const atom = mol.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    const copy = componentMol.addAtom(atom.id, atom.name, JSON.parse(JSON.stringify(atom.properties ?? {})));
    copy.visible = atom.visible;
    copy.tags = [...(atom.tags ?? [])];
  }
  for (const bond of mol.bonds.values()) {
    const [aId, bId] = bond.atoms;
    if (!componentAtomIds.has(aId) || !componentAtomIds.has(bId)) {
      continue;
    }
    const copy = componentMol.addBond(bond.id, aId, bId, JSON.parse(JSON.stringify(bond.properties ?? {})), false);
    copy.tags = [...(bond.tags ?? [])];
  }

  generateAndRefine2dCoords(componentMol, { suppressH: true, bondLength });

  for (const atomId of componentAtomIds) {
    const source = componentMol.atoms.get(atomId);
    const target = mol.atoms.get(atomId);
    if (!source || !target || source.x == null || source.y == null) {
      continue;
    }
    target.x = source.x;
    target.y = source.y;
  }
}

/**
 * @param {import('../core/Molecule.js').Molecule} reactant - The reactant molecule.
 * @param {import('../core/Molecule.js').Molecule} product - The product molecule.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {string[]} componentAtomIds - Array of atom IDs in the component.
 * @returns {boolean} True if the mapped atom is scaffold-compatible with the reactant.
 */
export function mappedAtomReaction2dScaffoldCompatible(reactant, product, mol, componentAtomIds) {
  if (!reactant || !product) {
    return false;
  }
  if (mol.__reactionPreview.editedProductAtomIds.has(product.id)) {
    return false;
  }
  if (reactant.name !== product.name) {
    return false;
  }
  if ((reactant.getCharge?.() ?? 0) !== (product.getCharge?.() ?? 0)) {
    return false;
  }
  if ((reactant.isAromatic?.() ?? false) !== (product.isAromatic?.() ?? false)) {
    return false;
  }
  if ((reactant.getRadical?.() ?? 0) !== (product.getRadical?.() ?? 0)) {
    return false;
  }

  const reactantMappedNeighbors = reactant
    .getNeighbors(mol)
    .filter(nb => mol.__reactionPreview.reactantAtomIds.has(nb.id) && nb.name !== 'H')
    .map(nb => nb.id)
    .sort();
  const productMappedNeighbors = product
    .getNeighbors(mol)
    .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H')
    .map(nb => sourceAtomId(nb.id))
    .sort();

  return reactantMappedNeighbors.join('|') === productMappedNeighbors.join('|');
}

/**
 * @param {import('../core/Molecule.js').Molecule} reactant - The reactant molecule.
 * @param {import('../core/Molecule.js').Molecule} product - The product molecule.
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {string[]} componentAtomIds - Array of atom IDs in the component.
 * @returns {boolean} True if the mapped atom is locally anchored to the reactant geometry.
 */
export function mappedAtomReaction2dLocallyAnchored(reactant, product, mol, componentAtomIds) {
  if (!reactant || !product) {
    return false;
  }
  if (mol.__reactionPreview.editedProductAtomIds.has(product.id)) {
    return false;
  }
  if (reactant.name !== product.name) {
    return false;
  }
  if ((reactant.getCharge?.() ?? 0) !== (product.getCharge?.() ?? 0)) {
    return false;
  }
  if ((reactant.isAromatic?.() ?? false) !== (product.isAromatic?.() ?? false)) {
    return false;
  }
  if ((reactant.getRadical?.() ?? 0) !== (product.getRadical?.() ?? 0)) {
    return false;
  }
  const reactantMappedNeighbors = reactant
    .getNeighbors(mol)
    .filter(nb => mol.__reactionPreview.reactantAtomIds.has(nb.id) && nb.name !== 'H')
    .map(nb => {
      const bond = mol.getBond(reactant.id, nb.id);
      return `${nb.id}:${bond?.properties.order ?? 1}:${bond?.properties.aromatic ?? false}`;
    })
    .sort();
  const productMappedNeighbors = product
    .getNeighbors(mol)
    .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H')
    .map(nb => {
      const bond = mol.getBond(product.id, nb.id);
      return `${sourceAtomId(nb.id)}:${bond?.properties.order ?? 1}:${bond?.properties.aromatic ?? false}`;
    })
    .sort();
  return reactantMappedNeighbors.join('|') === productMappedNeighbors.join('|');
}

/**
 * Builds a stable mapped-heavy-neighbor signature for topology comparisons.
 * @param {import('../core/Atom.js').Atom} atom - Atom to inspect.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} atomIds - Atom IDs that define the side being compared.
 * @param {(id: string) => string} [idMapper] - Optional atom ID normalizer.
 * @returns {string} Neighbor signature including mapped IDs and bond style.
 */
function reaction2dMappedHeavyNeighborSignature(atom, mol, atomIds, idMapper = id => id) {
  return atom
    .getNeighbors(mol)
    .filter(nb => atomIds.has(nb.id) && nb.name !== 'H')
    .map(nb => {
      const bond = mol.getBond(atom.id, nb.id);
      return `${idMapper(nb.id)}:${bond?.properties.order ?? 1}:${bond?.properties.aromatic === true}`;
    })
    .sort()
    .join('|');
}

/**
 * Seeds a product component directly from reactant coordinates when every
 * product heavy atom maps to an unchanged heavy-atom topology. Charge-only and
 * protonation/deprotonation previews can then avoid a full isolated layout.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @returns {boolean} True if the component was seeded from reactant geometry.
 */
function seedReaction2dTopologyPreservedComponentCoords(mol, componentAtomIds) {
  const preview = mol?.__reactionPreview;
  if (!preview?.reactantAtomIds?.size || !componentAtomIds?.size) {
    return false;
  }

  const productHeavyAtoms = [...componentAtomIds].map(atomId => mol.atoms.get(atomId)).filter(atom => atom && atom.name !== 'H');
  if (productHeavyAtoms.length === 0) {
    return false;
  }

  const seenSourceIds = new Set();
  for (const productAtom of productHeavyAtoms) {
    const sourceId = sourceAtomId(productAtom.id);
    const reactantAtom = mol.atoms.get(sourceId);
    if (
      !sourceId ||
      seenSourceIds.has(sourceId) ||
      !preview.reactantAtomIds.has(sourceId) ||
      !reactantAtom ||
      reactantAtom.name !== productAtom.name ||
      !Number.isFinite(reactantAtom.x) ||
      !Number.isFinite(reactantAtom.y)
    ) {
      return false;
    }
    seenSourceIds.add(sourceId);
    if ((reactantAtom.isAromatic?.() ?? false) !== (productAtom.isAromatic?.() ?? false)) {
      return false;
    }

    const reactantSignature = reaction2dMappedHeavyNeighborSignature(reactantAtom, mol, preview.reactantAtomIds);
    const productSignature = reaction2dMappedHeavyNeighborSignature(productAtom, mol, componentAtomIds, sourceAtomId);
    if (reactantSignature !== productSignature) {
      return false;
    }
  }

  for (const atomId of componentAtomIds) {
    const productAtom = mol.atoms.get(atomId);
    const reactantAtom = mol.atoms.get(sourceAtomId(atomId));
    if (!productAtom || !reactantAtom || !Number.isFinite(reactantAtom.x) || !Number.isFinite(reactantAtom.y)) {
      continue;
    }
    productAtom.x = reactantAtom.x;
    productAtom.y = reactantAtom.y;
  }
  return true;
}

/**
 * Returns true when a mapped terminal hetero atom is attached only to an
 * edited reaction center, so it should move with that center's new local
 * geometry instead of locking the retained scaffold.
 * @param {{atom: import('../core/Atom.js').Atom}|null} info - Neighbor info.
 * @param {import('../core/Atom.js').Atom} center - Edited product center.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @returns {boolean} True if the neighbor is a terminal mapped hetero.
 */
function isReaction2dTerminalMappedHeteroAtEditedCenter(info, center, mol, componentAtomIds) {
  if (!info?.atom || !center || !mol?.__reactionPreview?.editedProductAtomIds?.has(center.id)) {
    return false;
  }
  if (!_TERMINAL_HETEROATOMS.has(info.atom.name)) {
    return false;
  }
  const infoHeavyNeighbors = info.atom.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H');
  return infoHeavyNeighbors.length === 1 && infoHeavyNeighbors[0]?.id === center.id;
}

/**
 * Returns true when a mapped terminal halogen remains attached only to an
 * edited reaction center. Such leaves should move with the product center's
 * new visible fan instead of preserving the deleted-halogen reactant frame.
 * @param {{atom: import('../core/Atom.js').Atom}|null} info - Neighbor info.
 * @param {import('../core/Atom.js').Atom} center - Edited product center.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @returns {boolean} True if the neighbor is a terminal halogen leaf.
 */
function isReaction2dTerminalMappedHalogenAtEditedCenter(info, center, mol, componentAtomIds) {
  if (!info?.atom || !center || !mol?.__reactionPreview?.editedProductAtomIds?.has(center.id) || !_HALOGENS.has(info.atom.name)) {
    return false;
  }
  const infoHeavyNeighbors = info.atom.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H');
  return infoHeavyNeighbors.length === 1 && infoHeavyNeighbors[0]?.id === center.id;
}

/**
 * Restores mapped product atoms whose local scaffold connectivity survived the
 * reaction so retained rings and their unchanged substituents move together.
 * Edited ring atoms are allowed because they anchor changed carbonyl sites,
 * while non-ring edited atoms are left for reaction-specific finalizers.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @returns {void}
 */
function restoreMappedReaction2dRetainedScaffoldCoords(mol, componentAtomIds) {
  if (!mol?.__reactionPreview?.mappedAtomPairs?.length || !componentAtomIds?.size) {
    return;
  }
  for (const [reactantId, productId] of mol.__reactionPreview.mappedAtomPairs) {
    if (!componentAtomIds.has(productId)) {
      continue;
    }
    const reactantAtom = mol.atoms.get(reactantId);
    const productAtom = mol.atoms.get(productId);
    if (!reactantAtom || !productAtom || reactantAtom.name === 'H' || productAtom.name === 'H') {
      continue;
    }
    const isMappedRingScaffold = reactantAtom.isInRing(mol) && productAtom.isInRing(mol);
    const distanceToEdited = reaction2dMinHeavyDistanceToEdited(mol, productId, componentAtomIds);
    const isRetainedScaffoldAtom =
      !mol.__reactionPreview.editedProductAtomIds.has(productId) &&
      distanceToEdited > 1 &&
      mappedAtomReaction2dScaffoldCompatible(reactantAtom, productAtom, mol, componentAtomIds);
    if (!isMappedRingScaffold && !isRetainedScaffoldAtom) {
      continue;
    }
    productAtom.x = reactantAtom.x;
    productAtom.y = reactantAtom.y;
  }
}

/**
 * Reanchors hidden product hydrogens after reaction-preview heavy-atom edits.
 * Product orientation can snap or refine heavy atoms after hidden hydrogens
 * were initially placed, so hidden H coordinates must be refreshed against the
 * current parent atom before the renderer projects any displayed stereobonds.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @returns {void}
 */
function reanchorReaction2dHiddenHydrogens(mol, componentAtomIds) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }
  for (const atomId of componentAtomIds) {
    const atom = mol.atoms.get(atomId);
    if (!atom || atom.name !== 'H' || atom.visible !== false) {
      continue;
    }
    const parent = atom.getNeighbors(mol).find(neighbor => neighbor && componentAtomIds.has(neighbor.id) && Number.isFinite(neighbor.x) && Number.isFinite(neighbor.y));
    if (!parent) {
      continue;
    }
    atom.x = parent.x;
    atom.y = parent.y;
  }
}

function scaledReaction2dBondLength(order, bondLength = 1.5) {
  if (order >= 3) {
    return bondLength * 0.78;
  }
  if (order >= 2) {
    return bondLength * 0.86;
  }
  return bondLength;
}

function reaction2dCandidateLayoutScore(mol, componentAtomIds, placements, bondLength = 1.5) {
  if (!placements?.length) {
    return 0;
  }

  const placementMap = new Map(placements.map(({ atom, x, y }) => [atom.id, { atom, x, y }]));
  const heavyAtoms = [...componentAtomIds].map(id => mol.atoms.get(id)).filter(atom => atom && atom.name !== 'H');
  const seenPairs = new Set();
  const getPlaced = atom => placementMap.get(atom.id) ?? atom;
  let score = 0;

  for (const { atom, x, y } of placements) {
    score += 0.05 * ((x - atom.x) ** 2 + (y - atom.y) ** 2);
  }

  for (const { atom, x, y } of placements) {
    for (const nb of atom.getNeighbors(mol)) {
      if (!componentAtomIds.has(nb.id) || nb.name === 'H') {
        continue;
      }
      const placedNb = getPlaced(nb);
      if (placedNb.x == null || placedNb.y == null) {
        continue;
      }
      const order = mol.getBond(atom.id, nb.id)?.properties.order ?? 1;
      const targetLength = scaledReaction2dBondLength(order, bondLength);
      const d = Math.hypot(x - placedNb.x, y - placedNb.y);
      score += 2.5 * (d - targetLength) ** 2;
    }
  }

  for (const { atom, x, y } of placements) {
    for (const other of heavyAtoms) {
      if (other.id === atom.id || mol.getBond(atom.id, other.id)) {
        continue;
      }
      const pairKey = atom.id < other.id ? `${atom.id}|${other.id}` : `${other.id}|${atom.id}`;
      if (seenPairs.has(pairKey)) {
        continue;
      }
      seenPairs.add(pairKey);
      const placedOther = getPlaced(other);
      if (placedOther.x == null || placedOther.y == null) {
        continue;
      }
      const d = Math.hypot(x - placedOther.x, y - placedOther.y);
      if (d < 0.6) {
        score += 500 + (0.6 - d) * 1000;
      } else if (d < 0.9) {
        score += 180 * (0.9 - d) ** 2;
      } else if (d < 1.15) {
        score += 30 * (1.15 - d) ** 2;
      }
    }
  }

  return score;
}

function reaction2dPerpUnit(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

function reaction2dSymmetricBridgePlacements(outerA, outerB, atomA, atomB, { outerLength, middleLength, bendSign }) {
  const dx = outerB.x - outerA.x;
  const dy = outerB.y - outerA.y;
  const endpointDistance = Math.hypot(dx, dy);
  if (!Number.isFinite(endpointDistance) || endpointDistance < 1e-6) {
    return null;
  }

  const a = (endpointDistance - middleLength) / 2;
  const h2 = outerLength * outerLength - a * a;
  if (h2 < -1e-6) {
    return null;
  }

  const ux = dx / endpointDistance;
  const uy = dy / endpointDistance;
  const perp = reaction2dPerpUnit(outerA.x, outerA.y, outerB.x, outerB.y);
  const h = Math.sqrt(Math.max(0, h2)) * bendSign;

  return [
    {
      atom: atomA,
      x: outerA.x + ux * a + perp.x * h,
      y: outerA.y + uy * a + perp.y * h
    },
    {
      atom: atomB,
      x: outerB.x - ux * a + perp.x * h,
      y: outerB.y - uy * a + perp.y * h
    }
  ];
}

function reaction2dBendSignFromReference(outerA, outerB, referenceAtom) {
  if (!outerA || !outerB || !referenceAtom) {
    return 1;
  }
  const dx = outerB.x - outerA.x;
  const dy = outerB.y - outerA.y;
  const rx = referenceAtom.x - outerA.x;
  const ry = referenceAtom.y - outerA.y;
  const cross = dx * ry - dy * rx;
  return cross >= 0 ? 1 : -1;
}

function reaction2dMappedScaffoldAnchor(atom, mol, componentAtomIds) {
  if (!atom || atom.name === 'H') {
    return null;
  }
  const sourceId = sourceAtomId(atom.id);
  if (!mol.__reactionPreview.reactantAtomIds.has(sourceId)) {
    return null;
  }
  const reactant = mol.atoms.get(sourceId);
  if (!reactant) {
    return null;
  }
  if (!mappedAtomReaction2dScaffoldCompatible(reactant, atom, mol, componentAtomIds)) {
    return null;
  }
  return reactant;
}

function snapshotReaction2dCoords(mol, atomIds) {
  return new Map(
    [...atomIds]
      .map(id => mol.atoms.get(id))
      .filter(atom => atom && atom.x != null && atom.y != null)
      .map(atom => [atom.id, { x: atom.x, y: atom.y }])
  );
}

function restoreReaction2dCoords(mol, snapshot) {
  for (const [atomId, coords] of snapshot ?? new Map()) {
    const atom = mol.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    atom.x = coords.x;
    atom.y = coords.y;
  }
}

function reaction2dHeavyGeometryStats(mol, componentAtomIds) {
  const atoms = [...componentAtomIds].map(id => mol.atoms.get(id)).filter(atom => atom && atom.name !== 'H' && atom.x != null && atom.y != null);
  let minNonbonded = Infinity;
  let maxBond = 0;

  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const a = atoms[i];
      const b = atoms[j];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (mol.getBond(a.id, b.id)) {
        maxBond = Math.max(maxBond, distance);
      } else {
        minNonbonded = Math.min(minNonbonded, distance);
      }
    }
  }

  return { minNonbonded, maxBond };
}

function expandReaction2dCrowdedComponent(mol, componentAtomIds, bondLength = 1.5, options = {}) {
  if (!mol || !componentAtomIds?.size) {
    return false;
  }
  const targetMinNonbonded = options.targetMinNonbonded ?? bondLength * 0.55;
  const maxScale = options.maxScale ?? 1.08;
  const { minNonbonded } = reaction2dHeavyGeometryStats(mol, componentAtomIds);
  if (!Number.isFinite(minNonbonded) || minNonbonded >= targetMinNonbonded) {
    return false;
  }

  const heavyAtoms = [...componentAtomIds].map(id => mol.atoms.get(id)).filter(atom => atom && atom.name !== 'H' && atom.x != null && atom.y != null);
  if (heavyAtoms.length < 2) {
    return false;
  }

  const scale = Math.min(maxScale, targetMinNonbonded / Math.max(minNonbonded, 1e-6));
  if (!(scale > 1 + 1e-6)) {
    return false;
  }

  let cx = 0;
  let cy = 0;
  for (const atom of heavyAtoms) {
    cx += atom.x;
    cy += atom.y;
  }
  cx /= heavyAtoms.length;
  cy /= heavyAtoms.length;

  for (const atomId of componentAtomIds) {
    const atom = mol.atoms.get(atomId);
    if (!atom || atom.x == null || atom.y == null) {
      continue;
    }
    atom.x = cx + (atom.x - cx) * scale;
    atom.y = cy + (atom.y - cy) * scale;
  }
  return true;
}

function reaction2dMinHeavyDistanceToEdited(mol, startId, componentAtomIds) {
  if (!mol || !componentAtomIds?.has(startId)) {
    return Infinity;
  }
  if (mol.__reactionPreview.editedProductAtomIds.has(startId)) {
    return 0;
  }
  const start = mol.atoms.get(startId);
  if (!start || start.name === 'H') {
    return Infinity;
  }

  const queue = [{ id: startId, distance: 0 }];
  const visited = new Set([startId]);
  let queueHead = 0;
  while (queueHead < queue.length) {
    const { id, distance } = queue[queueHead++];
    const atom = mol.atoms.get(id);
    if (!atom) {
      continue;
    }
    for (const neighbor of atom.getNeighbors(mol)) {
      if (!componentAtomIds.has(neighbor.id) || neighbor.name === 'H' || visited.has(neighbor.id)) {
        continue;
      }
      if (mol.__reactionPreview.editedProductAtomIds.has(neighbor.id)) {
        return distance + 1;
      }
      visited.add(neighbor.id);
      queue.push({ id: neighbor.id, distance: distance + 1 });
    }
  }
  return Infinity;
}

function refineReaction2dEditedGeometry(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }
  idealizeReaction2dEditedCenters(mol, componentAtomIds, bondLength);
  idealizeReaction2dEditedSaturatedRingAnchorFans(mol, componentAtomIds, bondLength);
  idealizeReaction2dReducedAlkynePairs(mol, componentAtomIds, bondLength);
  idealizeReaction2dTerminalReducedAlkynePairs(mol, componentAtomIds, bondLength);
  idealizeReaction2dReducedAlkenePairs(mol, componentAtomIds, bondLength);
  preserveReaction2dEditedSingleBondTermini(mol, componentAtomIds, bondLength);
  idealizeReaction2dEditedMultipleBondTermini(mol, componentAtomIds, bondLength);
  idealizeReaction2dEditedTwoHeavyImineCenters(mol, componentAtomIds, bondLength);
  idealizeReaction2dEditedRingExocyclicTermini(mol, componentAtomIds, bondLength);
  idealizeReaction2dTrigonalCenters(mol, componentAtomIds, bondLength);
  idealizeReaction2dTerminalAlkylContinuations(mol, componentAtomIds, bondLength);
  repositionReaction2dPeripheralAtoms(mol, componentAtomIds, bondLength);
  idealizeReaction2dEditedSaturatedHalogenFans(mol, componentAtomIds, bondLength);
  finalizeReaction2dEditedCarbonylCenters(mol, componentAtomIds, bondLength);
  finalizeReaction2dTwoNeighborCarbonylCenters(mol, componentAtomIds, bondLength);
  idealizeReaction2dTerminalHeteroCarbonylContinuations(mol, componentAtomIds, bondLength);
  idealizeReaction2dTerminalAlkyneContinuations(mol, componentAtomIds, bondLength);
}

/**
 * Restores retained tert-butyl-like fans from the isolated product layout after
 * reaction preview scaffold snapping. This keeps unchanged BOC groups from
 * inheriting square 90/180-degree reactant fans while preserving the retained
 * anchor and rejecting moves that worsen local spacing.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @param {Map<string, {x: number, y: number}>} isolatedSnapshot - Product coordinates before scaffold restoration.
 * @param {number} bondLength - Target bond length.
 * @returns {void}
 */
function restoreReaction2dRetainedTertButylFansFromIsolated(mol, componentAtomIds, isolatedSnapshot, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size || !isolatedSnapshot?.size) {
    return;
  }

  const oppositionWeight = 1000;
  for (const centerId of componentAtomIds) {
    if (mol.__reactionPreview.editedProductAtomIds.has(centerId)) {
      continue;
    }
    const center = mol.atoms.get(centerId);
    if (!center || center.name !== 'C' || center.x == null || center.y == null || center.isInRing(mol)) {
      continue;
    }
    const centerIsolated = isolatedSnapshot.get(centerId);
    if (!centerIsolated) {
      continue;
    }

    const heavyNeighbors = center.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighbors.length !== 4) {
      continue;
    }
    const infos = heavyNeighbors.map(atom => {
      const bond = mol.getBond(center.id, atom.id);
      return {
        atom,
        order: bond?.properties.order ?? 1,
        targetLength: scaledReaction2dBondLength(bond?.properties.order ?? 1, bondLength)
      };
    });
    if (infos.some(info => info.order !== 1)) {
      continue;
    }

    const terminalCarbonLeaves = infos.filter(info => {
      if (info.atom.name !== 'C' || info.atom.isInRing(mol)) {
        return false;
      }
      const neighborHeavyCount = info.atom.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H').length;
      return neighborHeavyCount === 1;
    });
    const anchors = infos.filter(info => !terminalCarbonLeaves.includes(info));
    if (terminalCarbonLeaves.length !== 3 || anchors.length !== 1) {
      continue;
    }
    const anchor = anchors[0];
    const anchorIsolated = isolatedSnapshot.get(anchor.atom.id);
    if (!anchorIsolated) {
      continue;
    }

    const isolatedAnchorDx = centerIsolated.x - anchorIsolated.x;
    const isolatedAnchorDy = centerIsolated.y - anchorIsolated.y;
    const isolatedAnchorLen = Math.hypot(isolatedAnchorDx, isolatedAnchorDy);
    if (isolatedAnchorLen < 1e-6) {
      continue;
    }

    const candidatePlacementsList = [];
    const centerCandidate = {
      atom: center,
      x: anchor.atom.x + (isolatedAnchorDx / isolatedAnchorLen) * anchor.targetLength,
      y: anchor.atom.y + (isolatedAnchorDy / isolatedAnchorLen) * anchor.targetLength
    };
    const leafPlacements = [];
    let complete = true;
    for (const leaf of terminalCarbonLeaves) {
      const leafIsolated = isolatedSnapshot.get(leaf.atom.id);
      if (!leafIsolated) {
        complete = false;
        break;
      }
      const dx = leafIsolated.x - centerIsolated.x;
      const dy = leafIsolated.y - centerIsolated.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) {
        complete = false;
        break;
      }
      leafPlacements.push({
        atom: leaf.atom,
        x: centerCandidate.x + (dx / len) * leaf.targetLength,
        y: centerCandidate.y + (dy / len) * leaf.targetLength
      });
    }
    if (!complete) {
      continue;
    }
    candidatePlacementsList.push([centerCandidate, ...leafPlacements]);

    const anchorAngle = Math.atan2(anchor.atom.y - center.y, anchor.atom.x - center.x);
    const tertButylFanAngleSets = [
      [anchorAngle + (2 * Math.PI) / 3, anchorAngle + (10 * Math.PI) / 9, anchorAngle + (14 * Math.PI) / 9],
      [anchorAngle - (2 * Math.PI) / 3, anchorAngle - (10 * Math.PI) / 9, anchorAngle - (14 * Math.PI) / 9]
    ];
    for (const angleSet of tertButylFanAngleSets) {
      candidatePlacementsList.push([
        { atom: center, x: center.x, y: center.y },
        ...terminalCarbonLeaves.map((leaf, index) => ({
          atom: leaf.atom,
          x: center.x + Math.cos(angleSet[index]) * leaf.targetLength,
          y: center.y + Math.sin(angleSet[index]) * leaf.targetLength
        }))
      ]);
    }

    const currentPlacements = [{ atom: center, x: center.x, y: center.y }, ...terminalCarbonLeaves.map(info => ({ atom: info.atom, x: info.atom.x, y: info.atom.y }))];
    const currentScore =
      reaction2dCandidateLayoutScore(mol, componentAtomIds, currentPlacements, bondLength) +
      oppositionWeight * reaction2dFourNeighborOppositionPenalty(center, infos, currentPlacements);
    let best = null;
    for (const candidatePlacements of candidatePlacementsList) {
      const candidateScore =
        reaction2dCandidateLayoutScore(mol, componentAtomIds, candidatePlacements, bondLength) +
        oppositionWeight * reaction2dFourNeighborOppositionPenalty(center, infos, candidatePlacements);
      if (!best || candidateScore < best.score) {
        best = { score: candidateScore, placements: candidatePlacements };
      }
    }
    if (!best || best.score >= currentScore - 1e-6) {
      continue;
    }

    const beforeSnapshot = snapshotReaction2dCoords(mol, componentAtomIds);
    for (const placement of best.placements) {
      placement.atom.x = placement.x;
      placement.atom.y = placement.y;
    }
    const stats = reaction2dHeavyGeometryStats(mol, componentAtomIds);
    if (stats.maxBond > bondLength * 1.85 || stats.minNonbonded < bondLength * 0.5) {
      restoreReaction2dCoords(mol, beforeSnapshot);
    }
  }
}

function reaction2dPositionFromSnapshot(mol, snapshot, atomId) {
  const snapshotPosition = snapshot?.get(atomId);
  if (snapshotPosition && Number.isFinite(snapshotPosition.x) && Number.isFinite(snapshotPosition.y)) {
    return snapshotPosition;
  }
  const atom = mol?.atoms?.get(atomId);
  if (atom && Number.isFinite(atom.x) && Number.isFinite(atom.y)) {
    return atom;
  }
  return null;
}

function reaction2dRingInternalAngleFromPositions(ring, positionForAtom, atomId) {
  const index = ring.atomIds.indexOf(atomId);
  if (index < 0) {
    return null;
  }
  const center = positionForAtom(atomId);
  const previous = positionForAtom(ring.atomIds[(index - 1 + ring.atomIds.length) % ring.atomIds.length]);
  const next = positionForAtom(ring.atomIds[(index + 1) % ring.atomIds.length]);
  if (!center || !previous || !next) {
    return null;
  }
  const firstAngle = Math.atan2(previous.y - center.y, previous.x - center.x);
  const secondAngle = Math.atan2(next.y - center.y, next.x - center.x);
  let difference = Math.abs(firstAngle - secondAngle) % (Math.PI * 2);
  if (difference > Math.PI) {
    difference = Math.PI * 2 - difference;
  }
  return difference;
}

function reaction2dRingSystemShapeScore(mol, rings, snapshot, bondLength = 1.5) {
  const positionForAtom = atomId => reaction2dPositionFromSnapshot(mol, snapshot, atomId);
  let score = 0;
  let minAngle = Infinity;
  let maxAngle = 0;
  let maxBondDeviation = 0;
  let measuredAngles = 0;

  for (const ring of rings) {
    if (!ring?.atomIds?.length) {
      continue;
    }
    const targetAngle = Math.PI - (2 * Math.PI) / ring.atomIds.length;
    for (let index = 0; index < ring.atomIds.length; index++) {
      const atomId = ring.atomIds[index];
      const nextAtomId = ring.atomIds[(index + 1) % ring.atomIds.length];
      const angle = reaction2dRingInternalAngleFromPositions(ring, positionForAtom, atomId);
      if (angle == null) {
        return { score: Infinity, minAngle: 0, maxAngle: Infinity, maxBondDeviation: Infinity };
      }
      const deviation = Math.abs(angle - targetAngle);
      score += deviation * deviation;
      minAngle = Math.min(minAngle, angle);
      maxAngle = Math.max(maxAngle, angle);
      measuredAngles++;

      const current = positionForAtom(atomId);
      const next = positionForAtom(nextAtomId);
      if (!current || !next) {
        return { score: Infinity, minAngle: 0, maxAngle: Infinity, maxBondDeviation: Infinity };
      }
      const bondDeviation = Math.abs(Math.hypot(next.x - current.x, next.y - current.y) - bondLength);
      maxBondDeviation = Math.max(maxBondDeviation, bondDeviation);
      score += (bondDeviation / Math.max(bondLength, 1e-6)) ** 2;
    }
  }

  if (measuredAngles === 0) {
    return { score: Infinity, minAngle: 0, maxAngle: Infinity, maxBondDeviation: Infinity };
  }
  return { score, minAngle, maxAngle, maxBondDeviation };
}

function isReaction2dCompactBridgedCage(graph, ringSystem, componentAtomIds) {
  if (!ringSystem || ringSystem.ringIds?.length !== 2 || !ringSystem.atomIds?.every(atomId => componentAtomIds.has(atomId)) || ringSystem.atomIds.length > 8) {
    return false;
  }
  const rings = ringSystem.ringIds.map(ringId => graph.ringById.get(ringId)).filter(Boolean);
  if (rings.length !== 2 || rings.some(ring => ring.aromatic || ring.atomIds.length < 4 || ring.atomIds.length > 5)) {
    return false;
  }
  const ringSizes = rings.map(ring => ring.atomIds.length).sort((a, b) => a - b).join(',');
  if (ringSizes !== '4,5') {
    return false;
  }
  const connection = graph.ringConnections?.find(
    entry =>
      (entry.firstRingId === rings[0].id && entry.secondRingId === rings[1].id) ||
      (entry.firstRingId === rings[1].id && entry.secondRingId === rings[0].id)
  );
  if (connection?.kind !== 'bridged') {
    return false;
  }
  return ringSystem.atomIds.some(atomId => graph.atoms.get(atomId)?.element === 'O');
}

function collectReaction2dCompactRingRestoreAtomIds(mol, componentAtomIds, ringAtomIds, maxDepth = 3) {
  const restoreAtomIds = new Set(ringAtomIds);
  const ringAtomIdSet = new Set(ringAtomIds);
  const queue = [...ringAtomIds].map(atomId => ({ atomId, depth: 0 }));
  const visited = new Set(ringAtomIds);
  let queueHead = 0;

  while (queueHead < queue.length) {
    const { atomId, depth } = queue[queueHead++];
    const atom = mol.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    for (const neighbor of atom.getNeighbors(mol)) {
      if (!componentAtomIds.has(neighbor.id) || neighbor.name === 'H' || visited.has(neighbor.id)) {
        continue;
      }
      const nextDepth = ringAtomIdSet.has(atomId) ? 1 : depth + 1;
      if (nextDepth > maxDepth || (neighbor.isInRing(mol) && !ringAtomIdSet.has(neighbor.id))) {
        continue;
      }
      visited.add(neighbor.id);
      restoreAtomIds.add(neighbor.id);
      queue.push({ atomId: neighbor.id, depth: nextDepth });
    }
  }

  return restoreAtomIds;
}

/**
 * Restores small bridged 4/5 ether cages from the isolated product layout when
 * reaction-preview scaffold snapping visibly pinches the retained ring system.
 * These cages are too compact for wholesale reactant-coordinate preservation:
 * unchanged mapped atoms can still form a misleading frame after nearby nitrile
 * or carbonyl edits.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @param {Map<string, {x: number, y: number}>} isolatedSnapshot - Fitted isolated-product coords.
 * @param {number} bondLength - Target bond length.
 * @param {object|null} [layoutGraph] - Optional cached layout graph for this preview topology.
 * @returns {void}
 */
function restoreReaction2dCompactBridgedCagesFromIsolated(mol, componentAtomIds, isolatedSnapshot, bondLength = 1.5, layoutGraph = null) {
  if (!mol || !componentAtomIds?.size || !isolatedSnapshot?.size) {
    return;
  }

  const graph = layoutGraph ?? createLayoutGraph(mol, { suppressH: true, bondLength });
  for (const ringSystem of graph.ringSystems ?? []) {
    if (!isReaction2dCompactBridgedCage(graph, ringSystem, componentAtomIds)) {
      continue;
    }
    const rings = ringSystem.ringIds.map(ringId => graph.ringById.get(ringId)).filter(Boolean);
    const currentShape = reaction2dRingSystemShapeScore(mol, rings, null, bondLength);
    const isolatedShape = reaction2dRingSystemShapeScore(mol, rings, isolatedSnapshot, bondLength);
    const currentHasPinch = currentShape.minAngle < (70 * Math.PI) / 180 || currentShape.maxAngle > (155 * Math.PI) / 180 || currentShape.maxBondDeviation > bondLength * 0.28;
    const isolatedIsReadable = isolatedShape.minAngle > (75 * Math.PI) / 180 && isolatedShape.maxAngle < (150 * Math.PI) / 180 && isolatedShape.maxBondDeviation < bondLength * 0.32;
    if (!currentHasPinch || !isolatedIsReadable || !(isolatedShape.score < currentShape.score * 0.72)) {
      continue;
    }

    const restoreAtomIds = collectReaction2dCompactRingRestoreAtomIds(mol, componentAtomIds, ringSystem.atomIds);
    if ([...restoreAtomIds].some(atomId => !isolatedSnapshot.has(atomId))) {
      continue;
    }

    const beforeSnapshot = snapshotReaction2dCoords(mol, componentAtomIds);
    const currentStats = reaction2dHeavyGeometryStats(mol, componentAtomIds);
    for (const atomId of restoreAtomIds) {
      const atom = mol.atoms.get(atomId);
      const coords = isolatedSnapshot.get(atomId);
      if (!atom || !coords) {
        continue;
      }
      atom.x = coords.x;
      atom.y = coords.y;
    }
    const restoredShape = reaction2dRingSystemShapeScore(mol, rings, null, bondLength);
    const restoredStats = reaction2dHeavyGeometryStats(mol, componentAtomIds);
    const maxAllowedBond = Math.max(currentStats.maxBond + bondLength * 0.25, bondLength * 1.95);
    const minAllowedNonbonded = Number.isFinite(currentStats.minNonbonded) ? Math.min(currentStats.minNonbonded, bondLength * 0.5) - bondLength * 0.04 : bondLength * 0.45;
    if (
      !(restoredShape.score < currentShape.score * 0.85) ||
      restoredStats.maxBond > maxAllowedBond ||
      (Number.isFinite(restoredStats.minNonbonded) && restoredStats.minNonbonded < minAllowedNonbonded)
    ) {
      restoreReaction2dCoords(mol, beforeSnapshot);
    }
  }
}

function reaction2dBondAngle(a, center, b) {
  if (!a || !center || !b || a.x == null || a.y == null || center.x == null || center.y == null || b.x == null || b.y == null) {
    return null;
  }
  const firstAngle = Math.atan2(a.y - center.y, a.x - center.x);
  const secondAngle = Math.atan2(b.y - center.y, b.x - center.x);
  let difference = Math.abs(firstAngle - secondAngle) % (Math.PI * 2);
  if (difference > Math.PI) {
    difference = Math.PI * 2 - difference;
  }
  return difference;
}

function terminalReducedAlkyneDescriptor(mol, componentAtomIds, bond) {
  const [aId, bId] = bond.atoms;
  if (!componentAtomIds.has(aId) || !componentAtomIds.has(bId)) {
    return null;
  }
  const productBondOrder = bond.properties.order ?? 1;
  if (productBondOrder !== 1 && productBondOrder !== 2) {
    return null;
  }
  if (!mol.__reactionPreview.editedProductAtomIds.has(aId) || !mol.__reactionPreview.editedProductAtomIds.has(bId)) {
    return null;
  }
  const reactantBond = mol.getBond(sourceAtomId(aId), sourceAtomId(bId));
  if ((reactantBond?.properties.order ?? 1) < 3) {
    return null;
  }
  const first = mol.atoms.get(aId);
  const second = mol.atoms.get(bId);
  if (!first || !second || first.name !== 'C' || second.name !== 'C') {
    return null;
  }
  const firstHeavyNeighbors = first.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
  const secondHeavyNeighbors = second.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
  const oriented =
    firstHeavyNeighbors.length === 1 && secondHeavyNeighbors.length === 2
      ? { terminal: first, internal: second, internalNeighbors: secondHeavyNeighbors }
      : secondHeavyNeighbors.length === 1 && firstHeavyNeighbors.length === 2
        ? { terminal: second, internal: first, internalNeighbors: firstHeavyNeighbors }
        : null;
  if (!oriented) {
    return null;
  }
  const outer = oriented.internalNeighbors.find(nb => nb.id !== oriented.terminal.id);
  if (!outer || (mol.getBond(oriented.internal.id, outer.id)?.properties.order ?? 1) !== 1) {
    return null;
  }
  return {
    terminal: oriented.terminal,
    internal: oriented.internal,
    outer,
    productBondOrder,
    outerAnchor: outer.getNeighbors(mol).find(nb => componentAtomIds.has(nb.id) && nb.id !== oriented.internal.id && nb.name !== 'H' && nb.x != null && nb.y != null)
  };
}

/**
 * Bends terminal alkyne-reduction products away from the retained scaffold.
 * Internal alkynes are handled by the symmetric four-atom reducer; terminal
 * alkynes only have one heavy substituent, so the reduced terminal carbon must
 * be placed into the visible 120-degree slot explicitly.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @param {number} bondLength - Target bond length.
 * @returns {void}
 */
function idealizeReaction2dTerminalReducedAlkynePairs(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }

  for (const bond of mol.bonds.values()) {
    const descriptor = terminalReducedAlkyneDescriptor(mol, componentAtomIds, bond);
    if (!descriptor || descriptor.internal.x == null || descriptor.outer.x == null) {
      continue;
    }
    const currentAngle = reaction2dBondAngle(descriptor.terminal, descriptor.internal, descriptor.outer);
    if (currentAngle == null) {
      continue;
    }
    const idealAngle = (2 * Math.PI) / 3;
    const targetLength = scaledReaction2dBondLength(descriptor.productBondOrder, bondLength);
    const outerAngle = Math.atan2(descriptor.outer.y - descriptor.internal.y, descriptor.outer.x - descriptor.internal.x);
    const currentOuterAngle = descriptor.outerAnchor ? reaction2dBondAngle(descriptor.internal, descriptor.outer, descriptor.outerAnchor) : null;
    const currentPlacements = [
      { atom: descriptor.terminal, x: descriptor.terminal.x, y: descriptor.terminal.y },
      { atom: descriptor.internal, x: descriptor.internal.x, y: descriptor.internal.y }
    ];
    const currentScore =
      reaction2dCandidateLayoutScore(mol, componentAtomIds, currentPlacements, bondLength) +
      80 * (currentAngle - idealAngle) ** 2 +
      (currentOuterAngle == null ? 0 : 45 * (currentOuterAngle - idealAngle) ** 2);
    let best = null;

    if (descriptor.outerAnchor) {
      const outerAnchorAngle = Math.atan2(descriptor.outerAnchor.y - descriptor.outer.y, descriptor.outerAnchor.x - descriptor.outer.x);
      for (const internalSign of [1, -1]) {
        const internalAngle = outerAnchorAngle + internalSign * idealAngle;
        const internalCandidate = {
          x: descriptor.outer.x + Math.cos(internalAngle) * bondLength,
          y: descriptor.outer.y + Math.sin(internalAngle) * bondLength
        };
        const backToOuterAngle = Math.atan2(descriptor.outer.y - internalCandidate.y, descriptor.outer.x - internalCandidate.x);
        for (const terminalSign of [1, -1]) {
          const terminalAngle = backToOuterAngle + terminalSign * idealAngle;
          const terminalCandidate = {
            x: internalCandidate.x + Math.cos(terminalAngle) * targetLength,
            y: internalCandidate.y + Math.sin(terminalAngle) * targetLength
          };
          const placements = [
            { atom: descriptor.internal, x: internalCandidate.x, y: internalCandidate.y },
            { atom: descriptor.terminal, x: terminalCandidate.x, y: terminalCandidate.y }
          ];
          const score =
            reaction2dCandidateLayoutScore(mol, componentAtomIds, placements, bondLength) +
            0.05 * ((terminalCandidate.x - descriptor.terminal.x) ** 2 + (terminalCandidate.y - descriptor.terminal.y) ** 2) +
            0.12 * ((internalCandidate.x - descriptor.internal.x) ** 2 + (internalCandidate.y - descriptor.internal.y) ** 2);
          if (!best || score < best.score) {
            best = { score, placements };
          }
        }
      }
    }

    if (!best) {
      for (const sign of [1, -1]) {
        const targetAngle = outerAngle + sign * idealAngle;
        const terminalCandidate = {
          x: descriptor.internal.x + Math.cos(targetAngle) * targetLength,
          y: descriptor.internal.y + Math.sin(targetAngle) * targetLength
        };
        const placements = [{ atom: descriptor.terminal, x: terminalCandidate.x, y: terminalCandidate.y }];
        const score =
          reaction2dCandidateLayoutScore(mol, componentAtomIds, placements, bondLength) +
          0.05 * ((terminalCandidate.x - descriptor.terminal.x) ** 2 + (terminalCandidate.y - descriptor.terminal.y) ** 2);
        if (!best || score < best.score) {
          best = { score, placements };
        }
      }
    }
    if (best && best.score < currentScore - 1e-9) {
      for (const placement of best.placements) {
        placement.atom.x = placement.x;
        placement.atom.y = placement.y;
      }
    }
  }
}

function terminalAlkyneContinuationDescriptor(mol, componentAtomIds, bond) {
  const [aId, bId] = bond.atoms;
  if (!componentAtomIds.has(aId) || !componentAtomIds.has(bId) || (bond.properties.order ?? 1) < 3) {
    return null;
  }
  const first = mol.atoms.get(aId);
  const second = mol.atoms.get(bId);
  if (!first || !second || first.name !== 'C' || second.name !== 'C') {
    return null;
  }
  const firstHeavyNeighbors = first.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
  const secondHeavyNeighbors = second.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
  const oriented =
    firstHeavyNeighbors.length === 1 && secondHeavyNeighbors.length === 2
      ? { terminal: first, internal: second, internalNeighbors: secondHeavyNeighbors }
      : secondHeavyNeighbors.length === 1 && firstHeavyNeighbors.length === 2
        ? { terminal: second, internal: first, internalNeighbors: firstHeavyNeighbors }
        : null;
  if (!oriented) {
    return null;
  }
  const outer = oriented.internalNeighbors.find(nb => nb.id !== oriented.terminal.id);
  return outer ? { terminal: oriented.terminal, internal: oriented.internal, outer } : null;
}

/**
 * Restores terminal alkyne continuations after reaction-preview scaffold
 * alignment and ring-opening retouches. Product-side retained scaffold snaps
 * can bend an unchanged `C#C-C` end; the terminal atom can be moved back onto
 * the straight continuation without disturbing the retained ring/cage anchor.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @param {number} bondLength - Target bond length.
 * @returns {void}
 */
function idealizeReaction2dTerminalAlkyneContinuations(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }

  for (const bond of mol.bonds.values()) {
    const descriptor = terminalAlkyneContinuationDescriptor(mol, componentAtomIds, bond);
    if (!descriptor || descriptor.internal.x == null || descriptor.outer.x == null) {
      continue;
    }
    const currentAngle = reaction2dBondAngle(descriptor.terminal, descriptor.internal, descriptor.outer);
    if (currentAngle == null || Math.abs(currentAngle - Math.PI) < 1e-6) {
      continue;
    }
    const targetLength = scaledReaction2dBondLength(3, bondLength);
    const outerAngle = Math.atan2(descriptor.outer.y - descriptor.internal.y, descriptor.outer.x - descriptor.internal.x);
    const candidate = {
      x: descriptor.internal.x + Math.cos(outerAngle + Math.PI) * targetLength,
      y: descriptor.internal.y + Math.sin(outerAngle + Math.PI) * targetLength
    };
    const currentScore =
      reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: descriptor.terminal, x: descriptor.terminal.x, y: descriptor.terminal.y }], bondLength) +
      100 * (currentAngle - Math.PI) ** 2;
    const candidateScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: descriptor.terminal, x: candidate.x, y: candidate.y }], bondLength);
    if (candidateScore <= currentScore) {
      descriptor.terminal.x = candidate.x;
      descriptor.terminal.y = candidate.y;
    }
  }
}

/**
 * Bends terminal alkyl tails attached next to an edited multiple-bond center.
 * Scaffold snapping can preserve an unchanged terminal carbon exactly, leaving
 * the tail collinear with a newly formed alkene; this restores the expected
 * zig-zag continuation without moving the edited center itself.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @param {number} bondLength - Target bond length.
 * @returns {void}
 */
function idealizeReaction2dTerminalAlkylContinuations(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }

  for (const atomId of componentAtomIds) {
    const atom = mol.atoms.get(atomId);
    if (!atom || atom.name !== 'C' || atom.x == null || atom.y == null || atom.isInRing(mol)) {
      continue;
    }
    const heavyNeighbors = atom.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighbors.length !== 1) {
      continue;
    }

    const parent = heavyNeighbors[0];
    if (!parent || parent.name !== 'C' || parent.isInRing(mol)) {
      continue;
    }
    const atomBond = mol.getBond(atom.id, parent.id);
    const atomBondOrder = atomBond?.properties.order ?? 1;
    if (atomBondOrder !== 1) {
      continue;
    }

    const parentNeighbors = parent.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.id !== atom.id && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (parentNeighbors.length !== 1) {
      continue;
    }
    const editedNeighbor = parentNeighbors[0];
    if (!mol.__reactionPreview.editedProductAtomIds.has(editedNeighbor.id)) {
      continue;
    }
    const editedHasMultipleBond = editedNeighbor.getNeighbors(mol).some(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && (mol.getBond(editedNeighbor.id, nb.id)?.properties.order ?? 1) >= 2);
    if (!editedHasMultipleBond) {
      continue;
    }

    const currentAngle = reaction2dBondAngle(atom, parent, editedNeighbor);
    if (currentAngle == null || currentAngle < (5 * Math.PI) / 6) {
      continue;
    }
    const targetLength = scaledReaction2dBondLength(atomBondOrder, bondLength);
    const baseAngle = Math.atan2(editedNeighbor.y - parent.y, editedNeighbor.x - parent.x);
    const idealAngle = (2 * Math.PI) / 3;
    const currentScore =
      reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom, x: atom.x, y: atom.y }], bondLength) + 150 * (currentAngle - idealAngle) ** 2;
    let best = { score: currentScore, x: atom.x, y: atom.y };
    for (const angle of [baseAngle + idealAngle, baseAngle - idealAngle]) {
      const candidate = {
        x: parent.x + Math.cos(angle) * targetLength,
        y: parent.y + Math.sin(angle) * targetLength
      };
      const candidateAngle = reaction2dBondAngle(candidate, parent, editedNeighbor);
      const anglePenalty = candidateAngle == null ? 0 : 150 * (candidateAngle - idealAngle) ** 2;
      const movePenalty = 0.1 * ((candidate.x - atom.x) ** 2 + (candidate.y - atom.y) ** 2);
      const score = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom, x: candidate.x, y: candidate.y }], bondLength) + anglePenalty + movePenalty;
      if (score < best.score) {
        best = { score, x: candidate.x, y: candidate.y };
      }
    }
    if (best.x !== atom.x || best.y !== atom.y) {
      atom.x = best.x;
      atom.y = best.y;
    }
  }
}

/**
 * Opens terminal substituents attached through a hetero atom to an edited
 * carbonyl center. Imine hydrolysis can preserve the original imidate ether
 * tail after the carbonyl oxygen is introduced, leaving a very acute
 * C(=O)-O-C angle.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @param {number} bondLength - Target bond length.
 * @returns {void}
 */
function idealizeReaction2dTerminalHeteroCarbonylContinuations(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }

  for (const atomId of componentAtomIds) {
    const atom = mol.atoms.get(atomId);
    if (!atom || atom.name === 'H' || atom.x == null || atom.y == null || atom.isInRing(mol)) {
      continue;
    }
    const heavyNeighbors = atom.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighbors.length !== 1) {
      continue;
    }

    const hetero = heavyNeighbors[0];
    if (!hetero || !_TERMINAL_HETEROATOMS.has(hetero.name) || hetero.x == null || hetero.y == null) {
      continue;
    }
    const heteroNeighbors = hetero.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.id !== atom.id && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heteroNeighbors.length !== 1) {
      continue;
    }
    const carbonylCenter = heteroNeighbors[0];
    if (!mol.__reactionPreview.editedProductAtomIds.has(carbonylCenter.id) || carbonylCenter.name !== 'C') {
      continue;
    }
    const hasCarbonylOxygen = carbonylCenter
      .getNeighbors(mol)
      .some(nb => componentAtomIds.has(nb.id) && nb.name === 'O' && (mol.getBond(carbonylCenter.id, nb.id)?.properties.order ?? 1) >= 2);
    if (!hasCarbonylOxygen) {
      continue;
    }

    const currentAngle = reaction2dBondAngle(atom, hetero, carbonylCenter);
    if (currentAngle == null || currentAngle > Math.PI / 2) {
      continue;
    }
    const atomBond = mol.getBond(atom.id, hetero.id);
    const targetLength = scaledReaction2dBondLength(atomBond?.properties.order ?? 1, bondLength);
    const baseAngle = Math.atan2(carbonylCenter.y - hetero.y, carbonylCenter.x - hetero.x);
    const idealAngle = (2 * Math.PI) / 3;
    const currentScore =
      reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom, x: atom.x, y: atom.y }], bondLength) + 100 * (currentAngle - idealAngle) ** 2;
    let best = { score: currentScore, x: atom.x, y: atom.y };
    for (const angle of [baseAngle + idealAngle, baseAngle - idealAngle]) {
      const candidate = {
        x: hetero.x + Math.cos(angle) * targetLength,
        y: hetero.y + Math.sin(angle) * targetLength
      };
      const candidateAngle = reaction2dBondAngle(candidate, hetero, carbonylCenter);
      const anglePenalty = candidateAngle == null ? 0 : 100 * (candidateAngle - idealAngle) ** 2;
      const movePenalty = 0.1 * ((candidate.x - atom.x) ** 2 + (candidate.y - atom.y) ** 2);
      const score = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom, x: candidate.x, y: candidate.y }], bondLength) + anglePenalty + movePenalty;
      if (score < best.score) {
        best = { score, x: candidate.x, y: candidate.y };
      }
    }

    if (best.x !== atom.x || best.y !== atom.y) {
      atom.x = best.x;
      atom.y = best.y;
    }
  }
}

function idealizeReaction2dReducedAlkynePairs(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }

  for (const bond of mol.bonds.values()) {
    const [aId, bId] = bond.atoms;
    if (!componentAtomIds.has(aId) || !componentAtomIds.has(bId)) {
      continue;
    }
    const productBondOrder = bond.properties.order ?? 1;
    if (productBondOrder !== 1 && productBondOrder !== 2) {
      continue;
    }
    if (!mol.__reactionPreview.editedProductAtomIds.has(aId) || !mol.__reactionPreview.editedProductAtomIds.has(bId)) {
      continue;
    }

    const sourceAId = sourceAtomId(aId);
    const sourceBId = sourceAtomId(bId);
    if (!mol.__reactionPreview.reactantAtomIds.has(sourceAId) || !mol.__reactionPreview.reactantAtomIds.has(sourceBId)) {
      continue;
    }
    const reactantBond = mol.getBond(sourceAId, sourceBId);
    if ((reactantBond?.properties.order ?? 1) < 3) {
      continue;
    }

    const atomA = mol.atoms.get(aId);
    const atomB = mol.atoms.get(bId);
    if (!atomA || !atomB || atomA.name !== 'C' || atomB.name !== 'C') {
      continue;
    }
    if (atomA.x == null || atomA.y == null || atomB.x == null || atomB.y == null) {
      continue;
    }

    const heavyNeighborsA = atomA.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    const heavyNeighborsB = atomB.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighborsA.length !== 2 || heavyNeighborsB.length !== 2) {
      continue;
    }
    const outerA = heavyNeighborsA.find(nb => nb.id !== atomB.id);
    const outerB = heavyNeighborsB.find(nb => nb.id !== atomA.id);
    if (!outerA || !outerB) {
      continue;
    }
    if ((mol.getBond(atomA.id, outerA.id)?.properties.order ?? 1) !== 1) {
      continue;
    }
    if ((mol.getBond(atomB.id, outerB.id)?.properties.order ?? 1) !== 1) {
      continue;
    }
    if (outerA.x == null || outerA.y == null || outerB.x == null || outerB.y == null) {
      continue;
    }

    const outerSegmentLength = scaledReaction2dBondLength(1, bondLength);
    const middleSegmentLength = scaledReaction2dBondLength(productBondOrder, bondLength);
    const currentPlacements = [
      { atom: outerA, x: outerA.x, y: outerA.y },
      { atom: atomA, x: atomA.x, y: atomA.y },
      { atom: atomB, x: atomB.x, y: atomB.y },
      { atom: outerB, x: outerB.x, y: outerB.y }
    ];
    const targetMidX = (outerA.x + outerB.x) / 2;
    const targetMidY = (outerA.y + outerB.y) / 2;
    const targetAngle = Math.atan2(outerB.y - outerA.y, outerB.x - outerA.x);

    let best = {
      score: Infinity,
      placements: currentPlacements
    };

    for (const bendSign of [1, -1]) {
      const localPoints = [
        { x: 0, y: 0 },
        { x: outerSegmentLength, y: 0 },
        {
          x: outerSegmentLength + Math.cos((bendSign * Math.PI) / 3) * middleSegmentLength,
          y: Math.sin((bendSign * Math.PI) / 3) * middleSegmentLength
        },
        {
          x: outerSegmentLength + Math.cos((bendSign * Math.PI) / 3) * middleSegmentLength + outerSegmentLength,
          y: Math.sin((bendSign * Math.PI) / 3) * middleSegmentLength
        }
      ];
      const localEnd = localPoints[3];
      const localAngle = Math.atan2(localEnd.y, localEnd.x);
      const rotateBy = targetAngle - localAngle;
      const cosA = Math.cos(rotateBy);
      const sinA = Math.sin(rotateBy);
      const rotated = localPoints.map(point => ({
        x: point.x * cosA - point.y * sinA,
        y: point.x * sinA + point.y * cosA
      }));
      const rotatedMidX = (rotated[0].x + rotated[3].x) / 2;
      const rotatedMidY = (rotated[0].y + rotated[3].y) / 2;
      const translateX = targetMidX - rotatedMidX;
      const translateY = targetMidY - rotatedMidY;
      const rotatedOuterAX = rotated[0].x + translateX;
      const rotatedOuterAY = rotated[0].y + translateY;
      const rotatedOuterBX = rotated[3].x + translateX;
      const rotatedOuterBY = rotated[3].y + translateY;
      const candidatePlacements = [
        { atom: atomA, x: rotated[1].x + translateX, y: rotated[1].y + translateY },
        { atom: atomB, x: rotated[2].x + translateX, y: rotated[2].y + translateY }
      ];
      let score = reaction2dCandidateLayoutScore(mol, componentAtomIds, candidatePlacements, bondLength);
      score += 0.15 * ((rotatedOuterAX - outerA.x) ** 2 + (rotatedOuterAY - outerA.y) ** 2 + (rotatedOuterBX - outerB.x) ** 2 + (rotatedOuterBY - outerB.y) ** 2);
      if (score < best.score) {
        best = { score, placements: candidatePlacements };
      }
    }

    if (Number.isFinite(best.score)) {
      for (const placement of best.placements) {
        placement.atom.x = placement.x;
        placement.atom.y = placement.y;
      }
    }
  }
}

function idealizeReaction2dReducedAlkenePairs(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }
  const ringAtomIds = new Set(mol.getRings().flat());

  for (const bond of mol.bonds.values()) {
    const [aId, bId] = bond.atoms;
    if (!componentAtomIds.has(aId) || !componentAtomIds.has(bId)) {
      continue;
    }
    const productBondOrder = bond.properties.order ?? 1;
    if (productBondOrder !== 1) {
      continue;
    }
    if (!mol.__reactionPreview.editedProductAtomIds.has(aId) || !mol.__reactionPreview.editedProductAtomIds.has(bId)) {
      continue;
    }
    if (ringAtomIds.has(aId) || ringAtomIds.has(bId)) {
      continue;
    }

    const sourceAId = sourceAtomId(aId);
    const sourceBId = sourceAtomId(bId);
    if (!mol.__reactionPreview.reactantAtomIds.has(sourceAId) || !mol.__reactionPreview.reactantAtomIds.has(sourceBId)) {
      continue;
    }
    const reactantBond = mol.getBond(sourceAId, sourceBId);
    if ((reactantBond?.properties.order ?? 1) !== 2) {
      continue;
    }

    const atomA = mol.atoms.get(aId);
    const atomB = mol.atoms.get(bId);
    if (!atomA || !atomB || atomA.name !== 'C' || atomB.name !== 'C') {
      continue;
    }
    if (atomA.x == null || atomA.y == null || atomB.x == null || atomB.y == null) {
      continue;
    }

    const heavyNeighborsA = atomA.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    const heavyNeighborsB = atomB.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighborsA.length !== 2 || heavyNeighborsB.length !== 2) {
      continue;
    }
    const outerA = heavyNeighborsA.find(nb => nb.id !== atomB.id);
    const outerB = heavyNeighborsB.find(nb => nb.id !== atomA.id);
    if (!outerA || !outerB) {
      continue;
    }
    if ((mol.getBond(atomA.id, outerA.id)?.properties.order ?? 1) !== 1) {
      continue;
    }
    if ((mol.getBond(atomB.id, outerB.id)?.properties.order ?? 1) !== 1) {
      continue;
    }
    if (outerA.x == null || outerA.y == null || outerB.x == null || outerB.y == null) {
      continue;
    }

    const outerSegmentLength = scaledReaction2dBondLength(1, bondLength);
    const middleSegmentLength = scaledReaction2dBondLength(1, bondLength);
    const currentPlacements = [
      { atom: outerA, x: outerA.x, y: outerA.y },
      { atom: atomA, x: atomA.x, y: atomA.y },
      { atom: atomB, x: atomB.x, y: atomB.y },
      { atom: outerB, x: outerB.x, y: outerB.y }
    ];
    const targetMidX = (outerA.x + outerB.x) / 2;
    const targetMidY = (outerA.y + outerB.y) / 2;
    const targetAngle = Math.atan2(outerB.y - outerA.y, outerB.x - outerA.x);

    let best = {
      score: Infinity,
      placements: currentPlacements
    };

    const outerAAnchor = reaction2dMappedScaffoldAnchor(outerA, mol, componentAtomIds);
    const outerBAnchor = reaction2dMappedScaffoldAnchor(outerB, mol, componentAtomIds);
    if (outerAAnchor && outerBAnchor) {
      const referenceAtom = mol.atoms.get(sourceAId) ?? atomA;
      const preferredSign = reaction2dBendSignFromReference(outerAAnchor, outerBAnchor, referenceAtom);
      for (const bendSign of [preferredSign, -preferredSign]) {
        const candidatePlacements = reaction2dSymmetricBridgePlacements(outerA, outerB, atomA, atomB, {
          outerLength: outerSegmentLength,
          middleLength: middleSegmentLength,
          bendSign
        });
        if (!candidatePlacements) {
          continue;
        }
        const score = reaction2dCandidateLayoutScore(mol, componentAtomIds, candidatePlacements, bondLength);
        if (score < best.score) {
          best = { score, placements: candidatePlacements };
        }
      }
    }

    for (const bendSign of [1, -1]) {
      const localPoints = [
        { x: 0, y: 0 },
        { x: outerSegmentLength, y: 0 },
        {
          x: outerSegmentLength + Math.cos((bendSign * Math.PI) / 3) * middleSegmentLength,
          y: Math.sin((bendSign * Math.PI) / 3) * middleSegmentLength
        },
        {
          x: outerSegmentLength + Math.cos((bendSign * Math.PI) / 3) * middleSegmentLength + outerSegmentLength,
          y: Math.sin((bendSign * Math.PI) / 3) * middleSegmentLength
        }
      ];
      const localEnd = localPoints[3];
      const localAngle = Math.atan2(localEnd.y, localEnd.x);
      const rotateBy = targetAngle - localAngle;
      const cosA = Math.cos(rotateBy);
      const sinA = Math.sin(rotateBy);
      const rotated = localPoints.map(point => ({
        x: point.x * cosA - point.y * sinA,
        y: point.x * sinA + point.y * cosA
      }));
      const rotatedMidX = (rotated[0].x + rotated[3].x) / 2;
      const rotatedMidY = (rotated[0].y + rotated[3].y) / 2;
      const translateX = targetMidX - rotatedMidX;
      const translateY = targetMidY - rotatedMidY;
      const rotatedOuterAX = rotated[0].x + translateX;
      const rotatedOuterAY = rotated[0].y + translateY;
      const rotatedOuterBX = rotated[3].x + translateX;
      const rotatedOuterBY = rotated[3].y + translateY;
      const candidatePlacements = [
        { atom: atomA, x: rotated[1].x + translateX, y: rotated[1].y + translateY },
        { atom: atomB, x: rotated[2].x + translateX, y: rotated[2].y + translateY }
      ];
      let score = reaction2dCandidateLayoutScore(mol, componentAtomIds, candidatePlacements, bondLength);
      score += 0.15 * ((rotatedOuterAX - outerA.x) ** 2 + (rotatedOuterAY - outerA.y) ** 2 + (rotatedOuterBX - outerB.x) ** 2 + (rotatedOuterBY - outerB.y) ** 2);
      if (score < best.score) {
        best = { score, placements: candidatePlacements };
      }
    }

    if (Number.isFinite(best.score)) {
      for (const placement of best.placements) {
        placement.atom.x = placement.x;
        placement.atom.y = placement.y;
      }
    }
  }
}

function preserveReaction2dEditedSingleBondTermini(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }

  for (const centerId of componentAtomIds) {
    if (!mol.__reactionPreview.editedProductAtomIds.has(centerId)) {
      continue;
    }
    const center = mol.atoms.get(centerId);
    if (!center || center.name === 'H' || center.x == null || center.y == null) {
      continue;
    }

    const heavyNeighbors = center.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighbors.length !== 1) {
      continue;
    }

    const parent = heavyNeighbors[0];
    const bond = mol.getBond(center.id, parent.id);
    const order = bond?.properties.order ?? 1;
    if (order !== 1) {
      continue;
    }

    const sourceCenterId = sourceAtomId(center.id);
    const sourceParentId = sourceAtomId(parent.id);
    const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceCenterId) ? mol.atoms.get(sourceCenterId) : null;
    const reactantParent = mol.__reactionPreview.reactantAtomIds.has(sourceParentId) ? mol.atoms.get(sourceParentId) : null;
    if (reactantCenter?.x == null || reactantCenter?.y == null || reactantParent?.x == null || reactantParent?.y == null || !reactantParent.getNeighbors(mol).some(nb => nb.id === reactantCenter.id)) {
      continue;
    }

    const reactantHeavyNeighborCount = reactantCenter.getNeighbors(mol).filter(nb => mol.__reactionPreview.reactantAtomIds.has(nb.id) && nb.name !== 'H').length;
    if (reactantHeavyNeighborCount > 1) {
      continue;
    }

    const vx = reactantCenter.x - reactantParent.x;
    const vy = reactantCenter.y - reactantParent.y;
    const len = Math.hypot(vx, vy);
    if (len < 1e-6) {
      continue;
    }
    const targetLength = scaledReaction2dBondLength(order, bondLength);
    const candidate = {
      x: parent.x + (vx / len) * targetLength,
      y: parent.y + (vy / len) * targetLength
    };
    const currentScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: center, x: center.x, y: center.y }], bondLength);
    const candidateScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: center, x: candidate.x, y: candidate.y }], bondLength);
    if (candidateScore <= currentScore) {
      center.x = candidate.x;
      center.y = candidate.y;
    }
  }
}

/**
 * Places a single unanchored neighbor opposite the anchored-neighbor fan for
 * an edited reaction-preview center candidate.
 * @param {{x: number, y: number}} centerCandidate - Candidate center coordinates.
 * @param {{atom: import('../core/Atom.js').Atom}[]} anchored - Anchored neighbor descriptors.
 * @param {{atom: import('../core/Atom.js').Atom, targetLength: number}} moving - Moving neighbor descriptor.
 * @returns {{atom: import('../core/Atom.js').Atom, x: number, y: number}|null} Moving-neighbor placement, or null when no stable direction exists.
 */
function reaction2dMovingNeighborOppositeAnchors(centerCandidate, anchored, moving) {
  if (!anchored?.length || !moving?.atom) {
    return null;
  }

  let vx = 0;
  let vy = 0;
  for (const info of anchored) {
    const dx = info.atom.x - centerCandidate.x;
    const dy = info.atom.y - centerCandidate.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      continue;
    }
    vx -= dx / len;
    vy -= dy / len;
  }

  const vlen = Math.hypot(vx, vy);
  if (vlen < 1e-6) {
    return null;
  }
  return {
    atom: moving.atom,
    x: centerCandidate.x + (vx / vlen) * moving.targetLength,
    y: centerCandidate.y + (vy / vlen) * moving.targetLength
  };
}

/**
 * Scores how far a three-neighbor center is from an ideal trigonal spread.
 * @param {import('../core/Atom.js').Atom} center - Center atom.
 * @param {{atom: import('../core/Atom.js').Atom}[]} infos - Neighbor descriptors.
 * @param {{atom: import('../core/Atom.js').Atom, x: number, y: number}[]} placements - Candidate neighbor placements.
 * @returns {number} Sum of squared angular deviations from 120 degrees.
 */
function reaction2dTrigonalSpreadPenalty(center, infos, placements = []) {
  if (!center || infos.length !== 3 || center.x == null || center.y == null) {
    return 0;
  }

  const placedByAtomId = new Map(placements.map(placement => [placement.atom.id, placement]));
  const angles = infos
    .map(info => {
      const point = placedByAtomId.get(info.atom.id) ?? info.atom;
      if (point.x == null || point.y == null) {
        return null;
      }
      return Math.atan2(point.y - center.y, point.x - center.x);
    })
    .filter(angle => angle != null)
    .sort((a, b) => a - b);
  if (angles.length !== 3) {
    return 0;
  }

  const ideal = (2 * Math.PI) / 3;
  let penalty = 0;
  for (let index = 0; index < angles.length; index++) {
    const nextIndex = (index + 1) % angles.length;
    const gap = nextIndex === 0 ? angles[nextIndex] + 2 * Math.PI - angles[index] : angles[nextIndex] - angles[index];
    penalty += (gap - ideal) ** 2;
  }
  return penalty;
}

/**
 * Penalizes exact opposition at a four-neighbor center. The term is used only
 * as a local tie-break for retained quaternary fans where a square projection
 * is less readable than the isolated product's staggered fan.
 * @param {import('../core/Atom.js').Atom|{x: number, y: number}|null} center - Center atom or candidate point.
 * @param {Array<{atom: import('../core/Atom.js').Atom}>} infos - Neighbor info records.
 * @param {Array<{atom: import('../core/Atom.js').Atom, x: number, y: number}>} placements - Candidate placements.
 * @returns {number} Opposition penalty.
 */
function reaction2dFourNeighborOppositionPenalty(center, infos, placements = []) {
  if (!center || infos.length !== 4 || center.x == null || center.y == null) {
    return 0;
  }

  const placedByAtomId = new Map(placements.map(placement => [placement.atom.id, placement]));
  const centerPoint = placedByAtomId.get(center.id) ?? center;
  let penalty = 0;
  for (let firstIndex = 0; firstIndex < infos.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < infos.length; secondIndex++) {
      const firstPoint = placedByAtomId.get(infos[firstIndex].atom.id) ?? infos[firstIndex].atom;
      const secondPoint = placedByAtomId.get(infos[secondIndex].atom.id) ?? infos[secondIndex].atom;
      const angle = reaction2dBondAngle(firstPoint, centerPoint, secondPoint);
      if (angle == null || angle <= (17 * Math.PI) / 18) {
        continue;
      }
      penalty += (angle - (17 * Math.PI) / 18) ** 2;
    }
  }
  return penalty;
}

/**
 * Rebuilds the visible three-heavy-neighbor fan at edited saturated centers
 * when terminal halogen leaves remain after dehalogenation. These centers have
 * a hidden product hydrogen, so the visible heavy atoms should read as a clean
 * trigonal projection rather than preserving the original tetrahedral halogen
 * slots left by the deleted atom.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @param {number} bondLength - Target bond length.
 * @returns {void}
 */
function idealizeReaction2dEditedSaturatedHalogenFans(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }

  for (const centerId of componentAtomIds) {
    if (!mol.__reactionPreview.editedProductAtomIds.has(centerId)) {
      continue;
    }
    const center = mol.atoms.get(centerId);
    if (!center || center.name === 'H' || center.x == null || center.y == null) {
      continue;
    }

    const sourceCenterId = sourceAtomId(centerId);
    const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceCenterId) ? mol.atoms.get(sourceCenterId) : null;
    const heavyNeighbors = center.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighbors.length !== 3 || heavyNeighbors.some(nb => (mol.getBond(center.id, nb.id)?.properties.order ?? 1) !== 1)) {
      continue;
    }
    const reactantHeavyNeighborCount = reactantCenter?.getNeighbors(mol).filter(nb => mol.__reactionPreview.reactantAtomIds.has(nb.id) && nb.name !== 'H').length ?? 0;
    if (reactantHeavyNeighborCount <= heavyNeighbors.length) {
      continue;
    }

    const neighborInfo = heavyNeighbors.map(nb => {
      const reactant = mol.__reactionPreview.reactantAtomIds.has(sourceAtomId(nb.id)) ? mol.atoms.get(sourceAtomId(nb.id)) : null;
      const bond = mol.getBond(center.id, nb.id);
      return {
        atom: nb,
        reactant,
        scaffold: mappedAtomReaction2dScaffoldCompatible(reactant, nb, mol, componentAtomIds),
        targetLength: scaledReaction2dBondLength(bond?.properties.order ?? 1, bondLength)
      };
    });
    const moving = neighborInfo.filter(info => isReaction2dTerminalMappedHalogenAtEditedCenter(info, center, mol, componentAtomIds));
    if (moving.length === 0) {
      continue;
    }
    const movingSet = new Set(moving);
    const anchors = neighborInfo.filter(info => !movingSet.has(info));
    if (anchors.length === 1 && moving.length === 2) {
      const anchor = anchors[0];
      const baseAngle = Math.atan2(anchor.atom.y - center.y, anchor.atom.x - center.x);
      const candidateLayouts = [
        [baseAngle + (2 * Math.PI) / 3, baseAngle - (2 * Math.PI) / 3],
        [baseAngle - (2 * Math.PI) / 3, baseAngle + (2 * Math.PI) / 3]
      ];
      let best = {
        score:
          reaction2dCandidateLayoutScore(
            mol,
            componentAtomIds,
            moving.map(info => ({ atom: info.atom, x: info.atom.x, y: info.atom.y })),
            bondLength
          ) + 40 * reaction2dTrigonalSpreadPenalty(center, neighborInfo),
        placements: moving.map(info => ({ atom: info.atom, x: info.atom.x, y: info.atom.y }))
      };
      for (const angles of candidateLayouts) {
        const placements = moving.map((info, index) => ({
          atom: info.atom,
          x: center.x + Math.cos(angles[index]) * info.targetLength,
          y: center.y + Math.sin(angles[index]) * info.targetLength
        }));
        const score = reaction2dCandidateLayoutScore(mol, componentAtomIds, placements, bondLength) + 40 * reaction2dTrigonalSpreadPenalty(center, neighborInfo, placements);
        if (score < best.score) {
          best = { score, placements };
        }
      }
      for (const { atom, x, y } of best.placements) {
        atom.x = x;
        atom.y = y;
      }
      continue;
    }

    if (anchors.length >= 2 && moving.length === 1) {
      const placement = reaction2dMovingNeighborOppositeAnchors(center, anchors, moving[0]);
      if (!placement) {
        continue;
      }
      const currentScore =
        reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: moving[0].atom, x: moving[0].atom.x, y: moving[0].atom.y }], bondLength) +
        40 * reaction2dTrigonalSpreadPenalty(center, neighborInfo);
      const candidateScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [placement], bondLength) + 40 * reaction2dTrigonalSpreadPenalty(center, neighborInfo, [placement]);
      if (candidateScore <= currentScore) {
        moving[0].atom.x = placement.x;
        moving[0].atom.y = placement.y;
      }
    }
  }
}

/**
 * Scores angular spread at an adjacent anchor after moving one bonded atom.
 * This protects the first retained atom beyond an edited reaction center from
 * inheriting collapsed angles when the edited center is rebuilt.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @param {import('../core/Atom.js').Atom} anchor - Fixed adjacent anchor atom.
 * @param {import('../core/Atom.js').Atom} movingAtom - Bonded atom being moved.
 * @param {{x: number, y: number}} movingPoint - Candidate position for moving atom.
 * @returns {number} Squared angular-spread penalty.
 */
function reaction2dAdjacentAnchorSpreadPenalty(mol, componentAtomIds, anchor, movingAtom, movingPoint) {
  if (!anchor || !movingAtom || !movingPoint || anchor.x == null || anchor.y == null) {
    return 0;
  }
  const points = [{ x: movingPoint.x, y: movingPoint.y }];
  for (const neighbor of anchor.getNeighbors(mol)) {
    if (neighbor.id === movingAtom.id || !componentAtomIds.has(neighbor.id) || neighbor.name === 'H' || neighbor.x == null || neighbor.y == null) {
      continue;
    }
    points.push(neighbor);
  }
  if (points.length < 2 || points.length > 3) {
    return 0;
  }

  const ideal = (2 * Math.PI) / 3;
  const angles = points.map(point => Math.atan2(point.y - anchor.y, point.x - anchor.x)).sort((a, b) => a - b);
  if (points.length === 2) {
    let difference = Math.abs(angles[1] - angles[0]) % (Math.PI * 2);
    if (difference > Math.PI) {
      difference = Math.PI * 2 - difference;
    }
    return (difference - ideal) ** 2;
  }

  let penalty = 0;
  for (let index = 0; index < angles.length; index++) {
    const nextIndex = (index + 1) % angles.length;
    const gap = nextIndex === 0 ? angles[nextIndex] + 2 * Math.PI - angles[index] : angles[nextIndex] - angles[index];
    penalty += (gap - ideal) ** 2;
  }
  return penalty;
}

/**
 * Builds candidate positions for an edited center from the angular fan around
 * its retained scaffold anchor.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @param {import('../core/Atom.js').Atom} anchor - Fixed adjacent anchor atom.
 * @param {import('../core/Atom.js').Atom} movingAtom - Bonded atom being moved.
 * @param {number} targetLength - Target bond length from anchor to moving atom.
 * @returns {{x: number, y: number}[]} Candidate positions.
 */
function reaction2dAdjacentAnchorCenterCandidates(mol, componentAtomIds, anchor, movingAtom, targetLength) {
  if (!anchor || !movingAtom || anchor.x == null || anchor.y == null || !(targetLength > 0)) {
    return [];
  }
  const candidates = [];
  let resultantX = 0;
  let resultantY = 0;
  for (const neighbor of anchor.getNeighbors(mol)) {
    if (neighbor.id === movingAtom.id || !componentAtomIds.has(neighbor.id) || neighbor.name === 'H' || neighbor.x == null || neighbor.y == null) {
      continue;
    }
    const dx = neighbor.x - anchor.x;
    const dy = neighbor.y - anchor.y;
    const len = Math.hypot(dx, dy) || 1;
    resultantX += dx / len;
    resultantY += dy / len;
    const baseAngle = Math.atan2(neighbor.y - anchor.y, neighbor.x - anchor.x);
    for (const angle of [baseAngle + (2 * Math.PI) / 3, baseAngle - (2 * Math.PI) / 3]) {
      candidates.push({
        x: anchor.x + Math.cos(angle) * targetLength,
        y: anchor.y + Math.sin(angle) * targetLength
      });
    }
  }
  if (Math.hypot(resultantX, resultantY) >= 1e-6) {
    const outwardAngle = Math.atan2(-resultantY, -resultantX);
    for (const angle of [outwardAngle, outwardAngle + Math.PI / 6, outwardAngle - Math.PI / 6, outwardAngle + Math.PI / 4, outwardAngle - Math.PI / 4]) {
      candidates.push({
        x: anchor.x + Math.cos(angle) * targetLength,
        y: anchor.y + Math.sin(angle) * targetLength
      });
    }
  }
  return candidates;
}

/**
 * Refines edited reaction-preview centers whose local heavy-atom geometry can
 * be recovered from preserved mapped neighbors.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @param {number} bondLength - Target bond length.
 * @returns {void}
 */
function idealizeReaction2dEditedCenters(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }

  const circleIntersections = (a, ra, b, rb) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (!(d > 1e-6) || d > ra + rb || d < Math.abs(ra - rb)) {
      return [];
    }
    const ux = dx / d;
    const uy = dy / d;
    const x = (ra * ra - rb * rb + d * d) / (2 * d);
    const h2 = Math.max(0, ra * ra - x * x);
    const h = Math.sqrt(h2);
    const px = a.x + ux * x;
    const py = a.y + uy * x;
    const perpX = -uy;
    const perpY = ux;
    return [
      { x: px + perpX * h, y: py + perpY * h },
      { x: px - perpX * h, y: py - perpY * h }
    ];
  };

  for (const centerId of componentAtomIds) {
    if (!mol.__reactionPreview.editedProductAtomIds.has(centerId)) {
      continue;
    }
    const center = mol.atoms.get(centerId);
    if (!center || center.name === 'H' || center.x == null || center.y == null) {
      continue;
    }

    const sourceCenterId = sourceAtomId(centerId);
    const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceCenterId) ? mol.atoms.get(sourceCenterId) : null;

    const heavyNeighbors = center.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighbors.length === 0) {
      continue;
    }
    if (heavyNeighbors.some(nb => (mol.getBond(center.id, nb.id)?.properties.order ?? 1) >= 2)) {
      continue;
    }

    const neighborInfo = heavyNeighbors.map(nb => {
      const reactantNb = mol.__reactionPreview.reactantAtomIds.has(sourceAtomId(nb.id)) ? mol.atoms.get(sourceAtomId(nb.id)) : null;
      const bond = mol.getBond(center.id, nb.id);
      return {
        atom: nb,
        reactant: reactantNb,
        anchored: mappedAtomReaction2dScaffoldCompatible(reactantNb, nb, mol, componentAtomIds),
        targetLength: scaledReaction2dBondLength(bond?.properties.order ?? 1, bondLength)
      };
    });
    const anchored = neighborInfo.filter(info => {
      if (!info.anchored) {
        return false;
      }
      return !isReaction2dTerminalMappedHeteroAtEditedCenter(info, center, mol, componentAtomIds);
    });

    if (anchored.length >= 2) {
      let bestPair = null;
      for (let i = 0; i < anchored.length; i++) {
        for (let j = i + 1; j < anchored.length; j++) {
          const a = anchored[i].atom;
          const b = anchored[j].atom;
          const sep = Math.hypot(b.x - a.x, b.y - a.y);
          if (!bestPair || sep > bestPair.sep) {
            bestPair = { first: anchored[i], second: anchored[j], sep };
          }
        }
      }
      if (bestPair) {
        const candidates = circleIntersections(bestPair.first.atom, bestPair.first.targetLength, bestPair.second.atom, bestPair.second.targetLength);
        const anchoredSet = new Set(anchored);
        const moving = neighborInfo.filter(info => !anchoredSet.has(info));
        if (candidates.length > 0) {
          let best = null;
          for (const candidate of [{ x: center.x, y: center.y }, ...candidates]) {
            let score = (candidate.x - center.x) ** 2 + (candidate.y - center.y) ** 2;
            const placements = [{ atom: center, x: candidate.x, y: candidate.y }];
            if (moving.length === 1) {
              const movingPlacement = reaction2dMovingNeighborOppositeAnchors(candidate, [bestPair.first, bestPair.second], moving[0]);
              if (movingPlacement) {
                placements.push(movingPlacement);
                score += 0.35 * ((movingPlacement.x - moving[0].atom.x) ** 2 + (movingPlacement.y - moving[0].atom.y) ** 2);
              }
            }
            if (reactantCenter?.x != null && reactantCenter?.y != null) {
              score += 0.35 * ((candidate.x - reactantCenter.x) ** 2 + (candidate.y - reactantCenter.y) ** 2);
            }
            for (const info of [bestPair.first, bestPair.second]) {
              if (info.reactant?.x == null || info.reactant?.y == null || reactantCenter?.x == null || reactantCenter?.y == null) {
                continue;
              }
              const reactantDx = reactantCenter.x - info.reactant.x;
              const reactantDy = reactantCenter.y - info.reactant.y;
              const reactantLen = Math.hypot(reactantDx, reactantDy);
              const candidateDx = candidate.x - info.atom.x;
              const candidateDy = candidate.y - info.atom.y;
              const candidateLen = Math.hypot(candidateDx, candidateDy);
              if (reactantLen < 1e-6 || candidateLen < 1e-6) {
                continue;
              }
              const rx = reactantDx / reactantLen;
              const ry = reactantDy / reactantLen;
              const cx = candidateDx / candidateLen;
              const cy = candidateDy / candidateLen;
              score += 0.9 * ((cx - rx) ** 2 + (cy - ry) ** 2);
            }
            score += reaction2dCandidateLayoutScore(mol, componentAtomIds, placements, bondLength);
            if (!best || score < best.score) {
              best = { candidate, placements, score };
            }
          }
          if (best) {
            center.x = best.candidate.x;
            center.y = best.candidate.y;
            for (const placement of best.placements) {
              if (placement.atom.id === center.id) {
                continue;
              }
              placement.atom.x = placement.x;
              placement.atom.y = placement.y;
            }
            continue;
          }
        }
      }
    }

    if (anchored.length === 1 && reactantCenter?.x != null && reactantCenter?.y != null) {
      const anchor = anchored[0];
      if (anchor.reactant?.x != null && anchor.reactant?.y != null) {
        const vx = reactantCenter.x - anchor.reactant.x;
        const vy = reactantCenter.y - anchor.reactant.y;
        const vlen = Math.hypot(vx, vy);
        if (vlen >= 1e-6) {
          const candidate = {
            x: anchor.atom.x + (vx / vlen) * anchor.targetLength,
            y: anchor.atom.y + (vy / vlen) * anchor.targetLength
          };
          const reactantPenalty = point => 0.75 * ((point.x - reactantCenter.x) ** 2 + (point.y - reactantCenter.y) ** 2);
          const currentScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: center, x: center.x, y: center.y }], bondLength) + reactantPenalty({ x: center.x, y: center.y });
          const candidateScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: center, x: candidate.x, y: candidate.y }], bondLength) + reactantPenalty(candidate);
          if (candidateScore <= currentScore) {
            center.x = candidate.x;
            center.y = candidate.y;
          }
        }
      }
    }
  }
}

/**
 * Reopens edited saturated product centers that hang from an otherwise
 * retained ring scaffold. Ring-scaffold restoration can leave the edited atom
 * on an isolated-layout branch slot, pinching the ring-exit angle; this keeps
 * the retained ring anchor fixed and rebuilds the local three-bond fan.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @param {number} bondLength - Target bond length.
 * @returns {void}
 */
function idealizeReaction2dEditedSaturatedRingAnchorFans(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }

  const ringAtomIds = new Set(mol.getRings().flat());
  const idealAngle = (2 * Math.PI) / 3;
  for (const centerId of componentAtomIds) {
    if (!mol.__reactionPreview.editedProductAtomIds.has(centerId) || ringAtomIds.has(centerId)) {
      continue;
    }
    const center = mol.atoms.get(centerId);
    if (!center || center.name === 'H' || center.x == null || center.y == null) {
      continue;
    }

    const heavyNeighbors = center.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighbors.length !== 3 || heavyNeighbors.some(nb => (mol.getBond(center.id, nb.id)?.properties.order ?? 1) >= 2)) {
      continue;
    }

    const infos = heavyNeighbors.map(nb => {
      const bond = mol.getBond(center.id, nb.id);
      const reactant = mol.__reactionPreview.reactantAtomIds.has(sourceAtomId(nb.id)) ? mol.atoms.get(sourceAtomId(nb.id)) : null;
      return {
        atom: nb,
        reactant,
        scaffold: mappedAtomReaction2dScaffoldCompatible(reactant, nb, mol, componentAtomIds),
        targetLength: scaledReaction2dBondLength(bond?.properties.order ?? 1, bondLength)
      };
    });
    const ringAnchors = infos.filter(info => info.scaffold && ringAtomIds.has(info.atom.id));
    if (ringAnchors.length !== 1) {
      continue;
    }

    const anchor = ringAnchors[0];
    const moving = infos.filter(info => info !== anchor);
    if (moving.length !== 2 || !moving.some(info => mol.__reactionPreview.editedProductAtomIds.has(info.atom.id) || info.reactant == null)) {
      continue;
    }

    const sourceCenterId = sourceAtomId(centerId);
    const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceCenterId) ? mol.atoms.get(sourceCenterId) : null;
    const centerCandidates = [{ x: center.x, y: center.y }];
    if (reactantCenter?.x != null && reactantCenter?.y != null && anchor.reactant?.x != null && anchor.reactant?.y != null) {
      const dx = reactantCenter.x - anchor.reactant.x;
      const dy = reactantCenter.y - anchor.reactant.y;
      const len = Math.hypot(dx, dy);
      if (len >= 1e-6) {
        centerCandidates.push({
          x: anchor.atom.x + (dx / len) * anchor.targetLength,
          y: anchor.atom.y + (dy / len) * anchor.targetLength
        });
      }
    }
    const currentDx = center.x - anchor.atom.x;
    const currentDy = center.y - anchor.atom.y;
    const currentLen = Math.hypot(currentDx, currentDy);
    if (currentLen >= 1e-6) {
      centerCandidates.push({
        x: anchor.atom.x + (currentDx / currentLen) * anchor.targetLength,
        y: anchor.atom.y + (currentDy / currentLen) * anchor.targetLength
      });
    }
    for (const candidate of reaction2dAdjacentAnchorCenterCandidates(mol, componentAtomIds, anchor.atom, center, anchor.targetLength)) {
      centerCandidates.push(candidate);
    }

    const currentPlacements = [{ atom: center, x: center.x, y: center.y }, ...moving.map(info => ({ atom: info.atom, x: info.atom.x, y: info.atom.y }))];
    let best = {
      score:
        reaction2dCandidateLayoutScore(mol, componentAtomIds, currentPlacements, bondLength) +
        35 * reaction2dAdjacentAnchorSpreadPenalty(mol, componentAtomIds, anchor.atom, center, center) +
        25 * reaction2dTrigonalSpreadPenalty(center, infos),
      centerCandidate: { x: center.x, y: center.y },
      placed: moving.map(info => ({ info, x: info.atom.x, y: info.atom.y }))
    };

    for (const centerCandidate of centerCandidates) {
      const anchorAngle = Math.atan2(anchor.atom.y - centerCandidate.y, anchor.atom.x - centerCandidate.x);
      const candidateLayouts = [
        [anchorAngle + idealAngle, anchorAngle - idealAngle],
        [anchorAngle - idealAngle, anchorAngle + idealAngle]
      ];

      for (const angles of candidateLayouts) {
        const placed = moving.map((info, index) => ({
          info,
          x: centerCandidate.x + Math.cos(angles[index]) * info.targetLength,
          y: centerCandidate.y + Math.sin(angles[index]) * info.targetLength
        }));
        const placements = [{ atom: center, x: centerCandidate.x, y: centerCandidate.y }, ...placed.map(({ info, x, y }) => ({ atom: info.atom, x, y }))];
        const movePenalty = 0.1 * ((centerCandidate.x - center.x) ** 2 + (centerCandidate.y - center.y) ** 2);
        const reactantPenalty =
          reactantCenter?.x != null && reactantCenter?.y != null
            ? 0.15 * ((centerCandidate.x - reactantCenter.x) ** 2 + (centerCandidate.y - reactantCenter.y) ** 2)
            : 0;
        const movingReactantPenalty = placed.reduce((sum, placement) => {
          if (placement.info.reactant?.x == null || placement.info.reactant?.y == null) {
            return sum;
          }
          return sum + 0.03 * ((placement.x - placement.info.reactant.x) ** 2 + (placement.y - placement.info.reactant.y) ** 2);
        }, 0);
        const score =
          reaction2dCandidateLayoutScore(mol, componentAtomIds, placements, bondLength) +
          movePenalty +
          reactantPenalty +
          movingReactantPenalty +
          35 * reaction2dAdjacentAnchorSpreadPenalty(mol, componentAtomIds, anchor.atom, center, centerCandidate) +
          25 * reaction2dTrigonalSpreadPenalty(centerCandidate, infos, placements.slice(1));
        if (score < best.score) {
          best = { score, centerCandidate, placed };
        }
      }
    }

    center.x = best.centerCandidate.x;
    center.y = best.centerCandidate.y;
    for (const { info, x, y } of best.placed) {
      info.atom.x = x;
      info.atom.y = y;
    }
  }
}

function idealizeReaction2dEditedMultipleBondTermini(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }

  for (const centerId of componentAtomIds) {
    if (!mol.__reactionPreview.editedProductAtomIds.has(centerId)) {
      continue;
    }
    const center = mol.atoms.get(centerId);
    if (!center || center.name === 'H' || center.x == null || center.y == null) {
      continue;
    }

    const heavyNeighbors = center.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighbors.length !== 1) {
      continue;
    }

    const parent = heavyNeighbors[0];
    const bond = mol.getBond(center.id, parent.id);
    const order = bond?.properties.order ?? 1;
    if (order < 2) {
      continue;
    }

    const sourceCenterId = sourceAtomId(center.id);
    const sourceParentId = sourceAtomId(parent.id);
    const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceCenterId) ? mol.atoms.get(sourceCenterId) : null;
    const reactantParent = mol.__reactionPreview.reactantAtomIds.has(sourceParentId) ? mol.atoms.get(sourceParentId) : null;
    if (reactantCenter?.x == null || reactantCenter?.y == null || reactantParent?.x == null || reactantParent?.y == null || !reactantParent.getNeighbors(mol).some(nb => nb.id === reactantCenter.id)) {
      continue;
    }

    const vx = reactantCenter.x - reactantParent.x;
    const vy = reactantCenter.y - reactantParent.y;
    const len = Math.hypot(vx, vy);
    if (len < 1e-6) {
      continue;
    }
    const targetLength = scaledReaction2dBondLength(order, bondLength);
    const candidate = {
      x: parent.x + (vx / len) * targetLength,
      y: parent.y + (vy / len) * targetLength
    };
    const currentScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: center, x: center.x, y: center.y }], bondLength);
    const candidateScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: center, x: candidate.x, y: candidate.y }], bondLength);
    if (candidateScore <= currentScore) {
      center.x = candidate.x;
      center.y = candidate.y;
    }
  }
}

/**
 * Restores the trigonal heavy-atom angle at edited nitrile-to-imine carbons.
 * Nitrile reactants are linear, but the product imine carbon has a hidden
 * hydrogen and should show its retained scaffold bond and terminal C=N bond at
 * a trigonal angle.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @param {number} bondLength - Target bond length.
 * @returns {void}
 */
function idealizeReaction2dEditedTwoHeavyImineCenters(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }

  const idealAngle = (2 * Math.PI) / 3;
  const angleWeight = 500;
  for (const centerId of componentAtomIds) {
    if (!mol.__reactionPreview.editedProductAtomIds.has(centerId)) {
      continue;
    }
    const center = mol.atoms.get(centerId);
    if (!center || center.name !== 'C' || center.x == null || center.y == null) {
      continue;
    }

    const heavyNeighbors = center.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighbors.length !== 2) {
      continue;
    }
    const neighborInfos = heavyNeighbors.map(atom => ({
      atom,
      order: mol.getBond(center.id, atom.id)?.properties.order ?? 1
    }));
    const imineInfo = neighborInfos.find(info => info.order === 2 && info.atom.name === 'N' && mol.__reactionPreview.editedProductAtomIds.has(info.atom.id));
    const anchorInfo = neighborInfos.find(info => info.order === 1 && info !== imineInfo);
    if (!imineInfo || !anchorInfo) {
      continue;
    }

    const reactantBond = mol.getBond(sourceAtomId(center.id), sourceAtomId(imineInfo.atom.id));
    if ((reactantBond?.properties.order ?? 1) < 3) {
      continue;
    }
    const anchorAngle = Math.atan2(anchorInfo.atom.y - center.y, anchorInfo.atom.x - center.x);
    const targetLength = scaledReaction2dBondLength(imineInfo.order, bondLength);
    const currentAngle = reaction2dBondAngle(anchorInfo.atom, center, imineInfo.atom);
    const anglePenalty = point => {
      const candidateAngle = reaction2dBondAngle(anchorInfo.atom, center, point);
      return candidateAngle == null ? 0 : (candidateAngle - idealAngle) ** 2;
    };
    const currentScore =
      reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: imineInfo.atom, x: imineInfo.atom.x, y: imineInfo.atom.y }], bondLength) +
      angleWeight * (currentAngle == null ? 0 : (currentAngle - idealAngle) ** 2);
    let best = {
      score: currentScore,
      x: imineInfo.atom.x,
      y: imineInfo.atom.y
    };
    for (const targetAngle of [anchorAngle + idealAngle, anchorAngle - idealAngle]) {
      const candidate = {
        x: center.x + Math.cos(targetAngle) * targetLength,
        y: center.y + Math.sin(targetAngle) * targetLength
      };
      const score =
        reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: imineInfo.atom, x: candidate.x, y: candidate.y }], bondLength) +
        angleWeight * anglePenalty(candidate);
      if (score < best.score) {
        best = { score, x: candidate.x, y: candidate.y };
      }
    }

    imineInfo.atom.x = best.x;
    imineInfo.atom.y = best.y;
  }
}

/**
 * Centers terminal exocyclic substituents on edited ring atoms against the
 * retained ring fan. This covers dehydration products where a small-ring
 * alcohol center becomes either an exocyclic alkene or an internal ring alkene
 * with a terminal exocyclic substituent.
 * @param {import('../core/Molecule.js').Molecule} mol - Preview molecule.
 * @param {Set<string>} componentAtomIds - Product component atom IDs.
 * @param {number} bondLength - Target bond length.
 * @returns {void}
 */
function idealizeReaction2dEditedRingExocyclicTermini(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }

  const ringAtomIds = new Set(mol.getRings().flat());
  for (const centerId of componentAtomIds) {
    if (!mol.__reactionPreview.editedProductAtomIds.has(centerId) || !ringAtomIds.has(centerId)) {
      continue;
    }
    const center = mol.atoms.get(centerId);
    if (!center || center.name === 'H' || center.x == null || center.y == null) {
      continue;
    }

    const heavyNeighbors = center.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighbors.length !== 3) {
      continue;
    }

    const hasInternalRingMultipleBond = heavyNeighbors.some(atom => {
      if (!ringAtomIds.has(atom.id) || !mol.__reactionPreview.editedProductAtomIds.has(atom.id)) {
        return false;
      }
      return (mol.getBond(center.id, atom.id)?.properties.order ?? 1) >= 2;
    });
    const terminalExocyclicInfos = heavyNeighbors
      .map(atom => ({
        atom,
        order: mol.getBond(center.id, atom.id)?.properties.order ?? 1
      }))
      .filter(info => {
        if (ringAtomIds.has(info.atom.id)) {
          return false;
        }
        const terminalHeavyNeighbors = info.atom.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H');
        if (terminalHeavyNeighbors.length !== 1) {
          return false;
        }
        const hasTerminalMultipleBond = info.order >= 2 && mol.__reactionPreview.editedProductAtomIds.has(info.atom.id);
        return hasTerminalMultipleBond || hasInternalRingMultipleBond;
      });
    if (terminalExocyclicInfos.length !== 1) {
      continue;
    }

    const terminalInfo = terminalExocyclicInfos[0];
    const anchorInfos = heavyNeighbors
      .filter(atom => atom.id !== terminalInfo.atom.id)
      .filter(atom => ringAtomIds.has(atom.id))
      .map(atom => ({ atom }));
    if (anchorInfos.length < 2) {
      continue;
    }

    let vx = 0;
    let vy = 0;
    for (const info of anchorInfos) {
      const dx = info.atom.x - center.x;
      const dy = info.atom.y - center.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) {
        continue;
      }
      vx -= dx / len;
      vy -= dy / len;
    }
    const vlen = Math.hypot(vx, vy);
    if (vlen < 1e-6) {
      continue;
    }

    const targetLength = scaledReaction2dBondLength(terminalInfo.order, bondLength);
    const candidate = {
      x: center.x + (vx / vlen) * targetLength,
      y: center.y + (vy / vlen) * targetLength
    };
    const trigonalInfos = heavyNeighbors.map(atom => ({ atom }));
    const currentScore =
      reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: terminalInfo.atom, x: terminalInfo.atom.x, y: terminalInfo.atom.y }], bondLength) +
      reaction2dTrigonalSpreadPenalty(center, trigonalInfos);
    const candidateScore =
      reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: terminalInfo.atom, x: candidate.x, y: candidate.y }], bondLength) +
      reaction2dTrigonalSpreadPenalty(center, trigonalInfos, [{ atom: terminalInfo.atom, x: candidate.x, y: candidate.y }]);
    if (candidateScore <= currentScore) {
      terminalInfo.atom.x = candidate.x;
      terminalInfo.atom.y = candidate.y;
    }
  }
}

function idealizeReaction2dTrigonalCenters(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }
  const mappedProductIds = new Set((mol.__reactionPreview.mappedAtomPairs ?? []).filter(([, productId]) => componentAtomIds.has(productId)).map(([, productId]) => productId));
  const ringAtomIds = new Set(mol.getRings().flat());

  for (const centerId of componentAtomIds) {
    if (ringAtomIds.has(centerId)) {
      continue;
    }
    const center = mol.atoms.get(centerId);
    if (!center || center.name === 'H' || center.x == null || center.y == null) {
      continue;
    }
    const heavyNeighbors = center.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighbors.length !== 3) {
      continue;
    }

    const neighborInfo = heavyNeighbors.map(nb => {
      const bond = mol.getBond(center.id, nb.id);
      const reactant = mappedProductIds.has(nb.id) ? mol.atoms.get(sourceAtomId(nb.id)) : null;
      return {
        atom: nb,
        reactant,
        order: bond?.properties.order ?? 1,
        scaffold: mappedProductIds.has(nb.id) ? mappedAtomReaction2dScaffoldCompatible(reactant, nb, mol, componentAtomIds) : false,
        anchored: mappedAtomReaction2dLocallyAnchored(reactant, nb, mol, componentAtomIds),
        targetLength: scaledReaction2dBondLength(bond?.properties.order ?? 1, bondLength)
      };
    });

    if (!neighborInfo.some(info => info.order >= 2)) {
      continue;
    }
    const isCarbonylLikeCenter = center.name === 'C' && neighborInfo.some(info => info.order >= 2 && info.atom.name === 'O');
    if (isCarbonylLikeCenter) {
      continue;
    }

    const anchored = neighborInfo.filter(info => info.anchored);
    const moving = neighborInfo.filter(info => !info.anchored);
    if (moving.length === 0) {
      continue;
    }

    if (mol.__reactionPreview.editedProductAtomIds.has(center.id)) {
      const ringScaffoldAnchors = neighborInfo.filter(info => info.scaffold && ringAtomIds.has(info.atom.id));
      const scaffoldAnchors = ringScaffoldAnchors.length === 1 ? ringScaffoldAnchors : neighborInfo.filter(info => info.scaffold);
      if (scaffoldAnchors.length === 1) {
        const anchor = scaffoldAnchors[0];
        const movingInfos = neighborInfo.filter(info => info !== anchor);
        if (movingInfos.length === 2) {
          const centerCandidates = [{ x: center.x, y: center.y }];
          if (anchor.reactant?.x != null && anchor.reactant?.y != null) {
            const sourceCenterId = sourceAtomId(center.id);
            const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceCenterId) ? mol.atoms.get(sourceCenterId) : null;
            if (reactantCenter?.x != null && reactantCenter?.y != null) {
              const vx = reactantCenter.x - anchor.reactant.x;
              const vy = reactantCenter.y - anchor.reactant.y;
              const vlen = Math.hypot(vx, vy);
              if (vlen >= 1e-6) {
                centerCandidates.push({
                  x: anchor.atom.x + (vx / vlen) * anchor.targetLength,
                  y: anchor.atom.y + (vy / vlen) * anchor.targetLength
                });
              }
            }
          }
          let best = {
            score:
              reaction2dCandidateLayoutScore(
                mol,
                componentAtomIds,
                [{ atom: center, x: center.x, y: center.y }, ...movingInfos.map(info => ({ atom: info.atom, x: info.atom.x, y: info.atom.y }))],
                bondLength
              ) + 20 * reaction2dTrigonalSpreadPenalty(center, neighborInfo),
            centerCandidate: { x: center.x, y: center.y },
            placed: movingInfos.map(info => ({ atom: info.atom, x: info.atom.x, y: info.atom.y }))
          };
          for (const centerCandidate of centerCandidates) {
            const baseAngle = Math.atan2(anchor.atom.y - centerCandidate.y, anchor.atom.x - centerCandidate.x);
            const candidateLayouts = [
              [baseAngle + (2 * Math.PI) / 3, baseAngle - (2 * Math.PI) / 3],
              [baseAngle - (2 * Math.PI) / 3, baseAngle + (2 * Math.PI) / 3]
            ];

            for (const angles of candidateLayouts) {
              const placed = [];
              for (let i = 0; i < movingInfos.length; i++) {
                const info = movingInfos[i];
                const angle = angles[i];
                const x = centerCandidate.x + Math.cos(angle) * info.targetLength;
                const y = centerCandidate.y + Math.sin(angle) * info.targetLength;
                placed.push({ atom: info.atom, x, y });
              }
              const penaltyCenter = centerCandidate.x === center.x && centerCandidate.y === center.y ? center : { x: centerCandidate.x, y: centerCandidate.y };
              const score =
                reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: center, x: centerCandidate.x, y: centerCandidate.y }, ...placed], bondLength) +
                20 * reaction2dTrigonalSpreadPenalty(penaltyCenter, neighborInfo, placed);
              if (score < best.score) {
                best = { score, centerCandidate, placed };
              }
            }
          }
          if (best) {
            center.x = best.centerCandidate.x;
            center.y = best.centerCandidate.y;
            for (const { atom, x, y } of best.placed) {
              atom.x = x;
              atom.y = y;
            }
            continue;
          }
        }
      }
    }

    if (mol.__reactionPreview.editedProductAtomIds.has(center.id) && anchored.length >= 2) {
      const circleIntersections = (a, ra, b, rb) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (!(d > 1e-6) || d > ra + rb || d < Math.abs(ra - rb)) {
          return [];
        }
        const ux = dx / d;
        const uy = dy / d;
        const x = (ra * ra - rb * rb + d * d) / (2 * d);
        const h2 = Math.max(0, ra * ra - x * x);
        const h = Math.sqrt(h2);
        const px = a.x + ux * x;
        const py = a.y + uy * x;
        const perpX = -uy;
        const perpY = ux;
        return [
          { x: px + perpX * h, y: py + perpY * h },
          { x: px - perpX * h, y: py - perpY * h }
        ];
      };

      const first = anchored[0];
      const second = anchored[1];
      const candidates = circleIntersections(first.atom, first.targetLength, second.atom, second.targetLength);
      if (candidates.length > 0) {
        let best = null;
        for (const candidate of [{ x: center.x, y: center.y }, ...candidates]) {
          let score = (candidate.x - center.x) ** 2 + (candidate.y - center.y) ** 2;
          const placed = [{ atom: center, x: candidate.x, y: candidate.y }];
          if (moving.length > 0) {
            let vx = 0;
            let vy = 0;
            for (const info of anchored) {
              const dx = info.atom.x - candidate.x;
              const dy = info.atom.y - candidate.y;
              const len = Math.hypot(dx, dy) || 1;
              vx -= dx / len;
              vy -= dy / len;
            }
            const vlen = Math.hypot(vx, vy);
            if (vlen >= 1e-6) {
              for (const info of moving) {
                const targetX = candidate.x + (vx / vlen) * info.targetLength;
                const targetY = candidate.y + (vy / vlen) * info.targetLength;
                placed.push({ atom: info.atom, x: targetX, y: targetY });
                score += 0.35 * ((targetX - info.atom.x) ** 2 + (targetY - info.atom.y) ** 2);
              }
            }
          }
          score += reaction2dCandidateLayoutScore(mol, componentAtomIds, placed, bondLength);
          if (!best || score < best.score) {
            best = { candidate, score };
          }
        }
        if (best) {
          center.x = best.candidate.x;
          center.y = best.candidate.y;
        }
      }
    }

    if (anchored.length >= 2 && moving.length === 1) {
      let vx = 0;
      let vy = 0;
      for (const info of anchored) {
        const dx = info.atom.x - center.x;
        const dy = info.atom.y - center.y;
        const len = Math.hypot(dx, dy) || 1;
        vx -= dx / len;
        vy -= dy / len;
      }
      const vlen = Math.hypot(vx, vy);
      if (vlen >= 1e-6) {
        const candidate = {
          x: center.x + (vx / vlen) * moving[0].targetLength,
          y: center.y + (vy / vlen) * moving[0].targetLength
        };
        const centerReactant = mappedProductIds.has(center.id) ? mol.atoms.get(sourceAtomId(center.id)) : null;
        const rawCandidateScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: moving[0].atom, x: candidate.x, y: candidate.y }], bondLength);
        const shouldPreserveUneditedCenterOrientation =
          !mol.__reactionPreview.editedProductAtomIds.has(center.id) &&
          mappedAtomReaction2dScaffoldCompatible(centerReactant, center, mol, componentAtomIds) &&
          moving[0].reactant?.x != null &&
          moving[0].reactant?.y != null;
        if (shouldPreserveUneditedCenterOrientation && rawCandidateScore < 400) {
          moving[0].atom.x = candidate.x;
          moving[0].atom.y = candidate.y;
          continue;
        }
        const reactantPenalty = moving[0].reactant?.x != null && moving[0].reactant?.y != null ? point => 5 * ((point.x - moving[0].reactant.x) ** 2 + (point.y - moving[0].reactant.y) ** 2) : () => 0;
        const currentScore =
          reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: moving[0].atom, x: moving[0].atom.x, y: moving[0].atom.y }], bondLength) +
          reactantPenalty({ x: moving[0].atom.x, y: moving[0].atom.y });
        const candidateScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom: moving[0].atom, x: candidate.x, y: candidate.y }], bondLength) + reactantPenalty(candidate);
        if (candidateScore <= currentScore) {
          moving[0].atom.x = candidate.x;
          moving[0].atom.y = candidate.y;
        }
      }
      continue;
    }

    if (anchored.length === 1 && moving.length === 2) {
      const anchor = anchored[0];
      const baseAngle = Math.atan2(anchor.atom.y - center.y, anchor.atom.x - center.x);
      const candidateLayouts = [
        [baseAngle + (2 * Math.PI) / 3, baseAngle - (2 * Math.PI) / 3],
        [baseAngle - (2 * Math.PI) / 3, baseAngle + (2 * Math.PI) / 3]
      ];

      let best = {
        score: reaction2dCandidateLayoutScore(
          mol,
          componentAtomIds,
          moving.map(info => ({ atom: info.atom, x: info.atom.x, y: info.atom.y })),
          bondLength
        ),
        placed: moving.map(info => ({ atom: info.atom, x: info.atom.x, y: info.atom.y }))
      };
      for (const angles of candidateLayouts) {
        const placed = [];
        for (let i = 0; i < moving.length; i++) {
          const info = moving[i];
          const angle = angles[i];
          const x = center.x + Math.cos(angle) * info.targetLength;
          const y = center.y + Math.sin(angle) * info.targetLength;
          placed.push({ atom: info.atom, x, y });
        }
        const score = reaction2dCandidateLayoutScore(mol, componentAtomIds, placed, bondLength);
        if (score < best.score) {
          best = { score, placed };
        }
      }
      if (best) {
        for (const { atom, x, y } of best.placed) {
          atom.x = x;
          atom.y = y;
        }
      }
    }
  }
}

function repositionReaction2dPeripheralAtoms(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }
  const mappedProductIds = new Set((mol.__reactionPreview.mappedAtomPairs ?? []).filter(([, productId]) => componentAtomIds.has(productId)).map(([, productId]) => productId));
  const productIdBySourceId = new Map((mol.__reactionPreview.mappedAtomPairs ?? []).filter(([, productId]) => componentAtomIds.has(productId)).map(([srcId, productId]) => [srcId, productId]));
  for (const atomId of componentAtomIds) {
    const atom = mol.atoms.get(atomId);
    if (!atom || atom.x == null || atom.name === 'H') {
      continue;
    }
    const heavyNeighbors = atom.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null);
    if (heavyNeighbors.length !== 1) {
      continue;
    }
    const parent = heavyNeighbors[0];
    const atomBond = mol.getBond(atom.id, parent.id);
    if (mol.__reactionPreview.editedProductAtomIds.has(atom.id) && (atomBond?.properties.order ?? 1) >= 2) {
      continue;
    }
    const parentHeavyNeighbors = parent.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    const parentHasTrigonalEditedGeometry =
      mol.__reactionPreview.editedProductAtomIds.has(parent.id) && parentHeavyNeighbors.length === 3 && parentHeavyNeighbors.some(nb => (mol.getBond(parent.id, nb.id)?.properties.order ?? 1) >= 2);
    if (parentHasTrigonalEditedGeometry) {
      continue;
    }
    const bondOrder = atomBond?.properties.order ?? 1;
    const targetBondLength = bondLength * (bondOrder >= 3 ? 0.78 : bondOrder >= 2 ? 0.86 : 1);
    const sourceId = sourceAtomId(atomId);
    const reactantAtom = mol.__reactionPreview.reactantAtomIds.has(sourceId) ? mol.atoms.get(sourceId) : null;
    const parentSourceId = sourceAtomId(parent.id);
    const reactantParent = mol.__reactionPreview.reactantAtomIds.has(parentSourceId) ? mol.atoms.get(parentSourceId) : null;
    const reactantPeripheralDirection =
      reactantAtom?.x != null && reactantAtom?.y != null && reactantParent?.x != null && reactantParent?.y != null && reactantParent.getNeighbors(mol).some(nb => nb.id === reactantAtom.id)
        ? {
            x: reactantAtom.x - reactantParent.x,
            y: reactantAtom.y - reactantParent.y
          }
        : null;
    const reactantHeavyNeighborCount = reactantAtom ? reactantAtom.getNeighbors(mol).filter(nb => mol.__reactionPreview.reactantAtomIds.has(nb.id) && nb.name !== 'H').length : 0;
    const wasTerminalInReactant = reactantHeavyNeighborCount <= 1;
    const preserveEditedTerminusDirection = mol.__reactionPreview.editedProductAtomIds.has(atom.id) && !!reactantPeripheralDirection && wasTerminalInReactant;
    const reactantLostHeavyNeighbor =
      reactantAtom &&
      reactantAtom
        .getNeighbors(mol)
        .some(
          nb =>
            mol.__reactionPreview.reactantAtomIds.has(nb.id) &&
            nb.id !== reactantParent?.id &&
            nb.name !== 'H' &&
            !parent.getNeighbors(mol).some(productNb => componentAtomIds.has(productNb.id) && sourceAtomId(productNb.id) === nb.id)
        );
    const preserveMappedTerminalHeteroDirection =
      !mol.__reactionPreview.editedProductAtomIds.has(atom.id) &&
      mappedProductIds.has(atom.id) &&
      !!reactantPeripheralDirection &&
      wasTerminalInReactant &&
      _TERMINAL_HETEROATOMS.has(atom.name) &&
      bondOrder === 1;
    const preserveReactantPeripheralDirection =
      preserveEditedTerminusDirection ||
      preserveMappedTerminalHeteroDirection ||
      (!!reactantPeripheralDirection && wasTerminalInReactant && (_HALOGENS.has(atom.name) || (reactantAtom && reactantAtom.name !== atom.name) || reactantLostHeavyNeighbor));
    if (preserveReactantPeripheralDirection) {
      const len = Math.hypot(reactantPeripheralDirection.x, reactantPeripheralDirection.y);
      if (len >= 1e-6) {
        const candidate = {
          x: parent.x + (reactantPeripheralDirection.x / len) * targetBondLength,
          y: parent.y + (reactantPeripheralDirection.y / len) * targetBondLength
        };
        const currentScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom, x: atom.x, y: atom.y }], bondLength);
        const candidateScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom, x: candidate.x, y: candidate.y }], bondLength);
        if (candidateScore <= currentScore) {
          atom.x = candidate.x;
          atom.y = candidate.y;
          continue;
        }
      }
    }
    if (mappedProductIds.has(atomId) && mappedAtomReaction2dLocallyAnchored(reactantAtom, atom, mol, componentAtomIds)) {
      continue;
    }
    const mappedSiblingSourceIds = new Set(
      parent
        .getNeighbors(mol)
        .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && mappedProductIds.has(nb.id))
        .map(nb => sourceAtomId(nb.id))
    );
    const lostReactantNeighbors = reactantParent
      ? reactantParent
          .getNeighbors(mol)
          .filter(
            nb =>
              mol.__reactionPreview.reactantAtomIds.has(nb.id) &&
              nb.id !== parentSourceId &&
              nb.name !== 'H' &&
              nb.x != null &&
              nb.y != null &&
              !mappedSiblingSourceIds.has(nb.id) &&
              !mol.__reactionPreview.editedProductAtomIds.has(productIdBySourceId.get(nb.id))
          )
      : [];
    const siblings = parent.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.id !== atom.id && nb.name !== 'H' && nb.x != null);
    const carbonylLikeParent = siblings.some(sibling => {
      const siblingBond = mol.getBond(parent.id, sibling.id);
      return (siblingBond?.properties.order ?? 1) >= 2;
    });
    const shouldReplaceLostNeighborDirection = bondOrder === 1 && carbonylLikeParent && lostReactantNeighbors.length > 0;
    const preferSiblingGeometry = bondOrder >= 2 || (bondOrder === 1 && carbonylLikeParent && !shouldReplaceLostNeighborDirection);

    if (!preferSiblingGeometry && lostReactantNeighbors.length > 0 && reactantParent?.x != null && reactantParent?.y != null) {
      let vx = 0;
      let vy = 0;
      for (const neighbor of lostReactantNeighbors) {
        const dx = neighbor.x - reactantParent.x;
        const dy = neighbor.y - reactantParent.y;
        const len = Math.hypot(dx, dy) || 1;
        vx += dx / len;
        vy += dy / len;
      }
      const vlen = Math.hypot(vx, vy);
      if (vlen >= 1e-6) {
        const candidate = {
          x: parent.x + (vx / vlen) * targetBondLength,
          y: parent.y + (vy / vlen) * targetBondLength
        };
        const currentScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom, x: atom.x, y: atom.y }], bondLength);
        const candidateScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom, x: candidate.x, y: candidate.y }], bondLength);
        if (candidateScore <= currentScore) {
          atom.x = candidate.x;
          atom.y = candidate.y;
          continue;
        }
      }
    }
    if (siblings.length === 0) {
      continue;
    }

    let vx = 0;
    let vy = 0;
    for (const sibling of siblings) {
      const dx = sibling.x - parent.x;
      const dy = sibling.y - parent.y;
      const len = Math.hypot(dx, dy) || 1;
      vx -= dx / len;
      vy -= dy / len;
    }
    const vlen = Math.hypot(vx, vy);
    if (vlen < 1e-6) {
      continue;
    }
    const candidate = {
      x: parent.x + (vx / vlen) * targetBondLength,
      y: parent.y + (vy / vlen) * targetBondLength
    };
    const currentScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom, x: atom.x, y: atom.y }], bondLength);
    const candidateScore = reaction2dCandidateLayoutScore(mol, componentAtomIds, [{ atom, x: candidate.x, y: candidate.y }], bondLength);
    if (candidateScore <= currentScore) {
      atom.x = candidate.x;
      atom.y = candidate.y;
    }
  }
}

function finalizeReaction2dTwoNeighborCarbonylCenters(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }

  for (const centerId of componentAtomIds) {
    if (!mol.__reactionPreview.editedProductAtomIds.has(centerId)) {
      continue;
    }
    const center = mol.atoms.get(centerId);
    if (!center || center.name !== 'C' || center.x == null || center.y == null) {
      continue;
    }

    const heavyNeighbors = center.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighbors.length !== 2) {
      continue;
    }

    const infos = heavyNeighbors.map(nb => {
      const bond = mol.getBond(center.id, nb.id);
      return {
        atom: nb,
        order: bond?.properties.order ?? 1,
        targetLength: scaledReaction2dBondLength(bond?.properties.order ?? 1, bondLength)
      };
    });
    const doubleNeighbor = infos.find(info => info.order >= 2);
    const singleNeighbor = infos.find(info => info.order === 1);
    if (!doubleNeighbor || !singleNeighbor) {
      continue;
    }
    if (doubleNeighbor.atom.name !== 'O') {
      continue;
    }

    const singleSourceId = sourceAtomId(singleNeighbor.atom.id);
    const singleReactant = mol.__reactionPreview.reactantAtomIds.has(singleSourceId) ? mol.atoms.get(singleSourceId) : null;
    const singleIsScaffoldAnchor =
      mappedAtomReaction2dScaffoldCompatible(singleReactant, singleNeighbor.atom, mol, componentAtomIds) || (singleReactant?.isInRing(mol) && singleNeighbor.atom.isInRing(mol));
    if (singleIsScaffoldAnchor) {
      const centerCandidates = [{ x: center.x, y: center.y }];
      const sourceCenterId = sourceAtomId(centerId);
      const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceCenterId) ? mol.atoms.get(sourceCenterId) : null;
      if (reactantCenter?.x != null && reactantCenter?.y != null && singleReactant?.x != null && singleReactant?.y != null) {
        const dx = reactantCenter.x - singleReactant.x;
        const dy = reactantCenter.y - singleReactant.y;
        const len = Math.hypot(dx, dy);
        if (len >= 1e-6) {
          centerCandidates.push({
            x: singleNeighbor.atom.x + (dx / len) * singleNeighbor.targetLength,
            y: singleNeighbor.atom.y + (dy / len) * singleNeighbor.targetLength
          });
        }
      }
      const currentDx = center.x - singleNeighbor.atom.x;
      const currentDy = center.y - singleNeighbor.atom.y;
      const currentLen = Math.hypot(currentDx, currentDy);
      if (currentLen >= 1e-6) {
        centerCandidates.push({
          x: singleNeighbor.atom.x + (currentDx / currentLen) * singleNeighbor.targetLength,
          y: singleNeighbor.atom.y + (currentDy / currentLen) * singleNeighbor.targetLength
        });
      }
      let best = null;
      for (const centerCandidate of centerCandidates) {
        const baseAngle = Math.atan2(singleNeighbor.atom.y - centerCandidate.y, singleNeighbor.atom.x - centerCandidate.x);
        const layouts = [baseAngle + (2 * Math.PI) / 3, baseAngle - (2 * Math.PI) / 3];
        for (const angle of layouts) {
          const doubleCandidate = {
            x: centerCandidate.x + Math.cos(angle) * doubleNeighbor.targetLength,
            y: centerCandidate.y + Math.sin(angle) * doubleNeighbor.targetLength
          };
          const placements = [
            { atom: center, x: centerCandidate.x, y: centerCandidate.y },
            { atom: doubleNeighbor.atom, x: doubleCandidate.x, y: doubleCandidate.y }
          ];
          const movePenalty = 0.15 * ((centerCandidate.x - center.x) ** 2 + (centerCandidate.y - center.y) ** 2);
          const score = reaction2dCandidateLayoutScore(mol, componentAtomIds, placements, bondLength) + movePenalty;
          if (!best || score < best.score) {
            best = { score, centerCandidate, doubleCandidate };
          }
        }
      }
      if (best) {
        center.x = best.centerCandidate.x;
        center.y = best.centerCandidate.y;
        doubleNeighbor.atom.x = best.doubleCandidate.x;
        doubleNeighbor.atom.y = best.doubleCandidate.y;
      }
      continue;
    }

    let baseAngle = null;
    const sourceCenterId = sourceAtomId(centerId);
    const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceCenterId) ? mol.atoms.get(sourceCenterId) : null;
    if (reactantCenter?.x != null && reactantCenter?.y != null) {
      const mappedSourceIds = new Set(heavyNeighbors.filter(nb => sourceAtomId(nb.id) !== nb.id || mol.__reactionPreview.reactantAtomIds.has(sourceAtomId(nb.id))).map(nb => sourceAtomId(nb.id)));
      const lostReactantNeighbors = reactantCenter
        .getNeighbors(mol)
        .filter(nb => mol.__reactionPreview.reactantAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null && !mappedSourceIds.has(nb.id));
      if (lostReactantNeighbors.length > 0) {
        let vx = 0;
        let vy = 0;
        for (const neighbor of lostReactantNeighbors) {
          const dx = neighbor.x - reactantCenter.x;
          const dy = neighbor.y - reactantCenter.y;
          const len = Math.hypot(dx, dy) || 1;
          vx += dx / len;
          vy += dy / len;
        }
        if (Math.hypot(vx, vy) >= 1e-6) {
          baseAngle = Math.atan2(vy, vx);
        }
      }
    }

    if (baseAngle == null) {
      let vx = 0;
      let vy = 0;
      for (const info of infos) {
        const dx = info.atom.x - center.x;
        const dy = info.atom.y - center.y;
        const len = Math.hypot(dx, dy) || 1;
        vx += dx / len;
        vy += dy / len;
      }
      if (Math.hypot(vx, vy) >= 1e-6) {
        baseAngle = Math.atan2(vy, vx);
      } else {
        const dx = doubleNeighbor.atom.x - center.x;
        const dy = doubleNeighbor.atom.y - center.y;
        baseAngle = Math.atan2(dy, dx);
      }
    }

    const layouts = [
      [
        { info: doubleNeighbor, angle: baseAngle + Math.PI / 3 },
        { info: singleNeighbor, angle: baseAngle - Math.PI / 3 }
      ],
      [
        { info: doubleNeighbor, angle: baseAngle - Math.PI / 3 },
        { info: singleNeighbor, angle: baseAngle + Math.PI / 3 }
      ]
    ];

    let best = null;
    for (const layout of layouts) {
      const placed = [];
      for (const { info, angle } of layout) {
        const x = center.x + Math.cos(angle) * info.targetLength;
        const y = center.y + Math.sin(angle) * info.targetLength;
        placed.push({ info, x, y });
      }
      const score = reaction2dCandidateLayoutScore(
        mol,
        componentAtomIds,
        placed.map(({ info, x, y }) => ({ atom: info.atom, x, y })),
        bondLength
      );
      if (!best || score < best.score) {
        best = { score, placed };
      }
    }

    if (best) {
      for (const { info, x, y } of best.placed) {
        info.atom.x = x;
        info.atom.y = y;
      }
    }
  }
}

function finalizeReaction2dEditedCarbonylCenters(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }

  for (const centerId of componentAtomIds) {
    if (!mol.__reactionPreview.editedProductAtomIds.has(centerId)) {
      continue;
    }
    const center = mol.atoms.get(centerId);
    if (!center || center.name === 'H' || center.x == null || center.y == null) {
      continue;
    }

    const heavyNeighbors = center.getNeighbors(mol).filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighbors.length !== 3) {
      continue;
    }

    const infos = heavyNeighbors.map(nb => {
      const bond = mol.getBond(center.id, nb.id);
      const reactant = mol.__reactionPreview.reactantAtomIds.has(sourceAtomId(nb.id)) ? mol.atoms.get(sourceAtomId(nb.id)) : null;
      return {
        atom: nb,
        order: bond?.properties.order ?? 1,
        reactant,
        scaffold: mappedAtomReaction2dScaffoldCompatible(reactant, nb, mol, componentAtomIds),
        targetLength: scaledReaction2dBondLength(bond?.properties.order ?? 1, bondLength)
      };
    });
    if (!infos.some(info => info.order >= 2 && info.atom.name === 'O')) {
      continue;
    }

    const scaffoldAnchors = infos.filter(info => info.scaffold && (info.atom.name === 'O' || !isReaction2dTerminalMappedHeteroAtEditedCenter(info, center, mol, componentAtomIds)));
    if (scaffoldAnchors.length === 1) {
      const anchor = scaffoldAnchors[0];
      const moving = infos.filter(info => info !== anchor);
      if (moving.length !== 2) {
        continue;
      }
      const centerCandidates = [{ x: center.x, y: center.y }];
      const sourceCenterId = sourceAtomId(centerId);
      const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceCenterId) ? mol.atoms.get(sourceCenterId) : null;
      if (reactantCenter?.x != null && reactantCenter?.y != null && anchor.reactant?.x != null && anchor.reactant?.y != null) {
        const dx = reactantCenter.x - anchor.reactant.x;
        const dy = reactantCenter.y - anchor.reactant.y;
        const len = Math.hypot(dx, dy);
        if (len >= 1e-6) {
          centerCandidates.push({
            x: anchor.atom.x + (dx / len) * anchor.targetLength,
            y: anchor.atom.y + (dy / len) * anchor.targetLength
          });
        }
      }
      const currentDx = center.x - anchor.atom.x;
      const currentDy = center.y - anchor.atom.y;
      const currentLen = Math.hypot(currentDx, currentDy);
      if (currentLen >= 1e-6) {
        centerCandidates.push({
          x: anchor.atom.x + (currentDx / currentLen) * anchor.targetLength,
          y: anchor.atom.y + (currentDy / currentLen) * anchor.targetLength
        });
      }
      for (const candidate of reaction2dAdjacentAnchorCenterCandidates(mol, componentAtomIds, anchor.atom, center, anchor.targetLength)) {
        centerCandidates.push(candidate);
      }
      let best = {
        score:
          reaction2dCandidateLayoutScore(
            mol,
            componentAtomIds,
            [{ atom: center, x: center.x, y: center.y }, ...moving.map(info => ({ atom: info.atom, x: info.atom.x, y: info.atom.y }))],
            bondLength
          ) +
          20 *
            reaction2dTrigonalSpreadPenalty(
              center,
              infos,
              moving.map(info => ({ atom: info.atom, x: info.atom.x, y: info.atom.y }))
            ) +
          35 * reaction2dAdjacentAnchorSpreadPenalty(mol, componentAtomIds, anchor.atom, center, center),
        centerCandidate: { x: center.x, y: center.y },
        placed: moving.map(info => ({ info, x: info.atom.x, y: info.atom.y }))
      };
      for (const centerCandidate of centerCandidates) {
        const baseAngle = Math.atan2(anchor.atom.y - centerCandidate.y, anchor.atom.x - centerCandidate.x);
        const candidateLayouts = [
          [baseAngle + (2 * Math.PI) / 3, baseAngle - (2 * Math.PI) / 3],
          [baseAngle - (2 * Math.PI) / 3, baseAngle + (2 * Math.PI) / 3]
        ];
        for (const angles of candidateLayouts) {
          const placed = [];
          for (let i = 0; i < moving.length; i++) {
            const info = moving[i];
            const angle = angles[i];
            const x = centerCandidate.x + Math.cos(angle) * info.targetLength;
            const y = centerCandidate.y + Math.sin(angle) * info.targetLength;
            placed.push({ info, x, y });
          }
          const placements = [{ atom: center, x: centerCandidate.x, y: centerCandidate.y }, ...placed.map(({ info, x, y }) => ({ atom: info.atom, x, y }))];
          const movePenalty = 0.15 * ((centerCandidate.x - center.x) ** 2 + (centerCandidate.y - center.y) ** 2);
          const anchorPenalty = 35 * reaction2dAdjacentAnchorSpreadPenalty(mol, componentAtomIds, anchor.atom, center, centerCandidate);
          const score = reaction2dCandidateLayoutScore(mol, componentAtomIds, placements, bondLength) + movePenalty + anchorPenalty;
          if (score < best.score) {
            best = { score, centerCandidate, placed };
          }
        }
      }
      if (best) {
        center.x = best.centerCandidate.x;
        center.y = best.centerCandidate.y;
        for (const { info, x, y } of best.placed) {
          info.atom.x = x;
          info.atom.y = y;
        }
      }
      continue;
    }

    if (scaffoldAnchors.length >= 2) {
      const moving = infos.filter(info => !info.scaffold);
      if (moving.length !== 1) {
        continue;
      }
      const circleIntersections = (a, ra, b, rb) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (!(d > 1e-6) || d > ra + rb || d < Math.abs(ra - rb)) {
          return [];
        }
        const ux = dx / d;
        const uy = dy / d;
        const x = (ra * ra - rb * rb + d * d) / (2 * d);
        const h2 = Math.max(0, ra * ra - x * x);
        const h = Math.sqrt(h2);
        const px = a.x + ux * x;
        const py = a.y + uy * x;
        const perpX = -uy;
        const perpY = ux;
        return [
          { x: px + perpX * h, y: py + perpY * h },
          { x: px - perpX * h, y: py - perpY * h }
        ];
      };

      let bestPair = null;
      for (let firstIndex = 0; firstIndex < scaffoldAnchors.length; firstIndex++) {
        for (let secondIndex = firstIndex + 1; secondIndex < scaffoldAnchors.length; secondIndex++) {
          const first = scaffoldAnchors[firstIndex];
          const second = scaffoldAnchors[secondIndex];
          const separation = Math.hypot(second.atom.x - first.atom.x, second.atom.y - first.atom.y);
          if (!bestPair || separation > bestPair.separation) {
            bestPair = { first, second, separation };
          }
        }
      }
      if (bestPair) {
        const centerCandidates = [{ x: center.x, y: center.y }, ...circleIntersections(bestPair.first.atom, bestPair.first.targetLength, bestPair.second.atom, bestPair.second.targetLength)];
        let best = null;
        for (const centerCandidate of centerCandidates) {
          const movingPlacement = reaction2dMovingNeighborOppositeAnchors(centerCandidate, [bestPair.first, bestPair.second], moving[0]);
          const placements = [{ atom: center, x: centerCandidate.x, y: centerCandidate.y }];
          if (movingPlacement) {
            placements.push(movingPlacement);
          }
          const movePenalty = 0.15 * ((centerCandidate.x - center.x) ** 2 + (centerCandidate.y - center.y) ** 2);
          const movingPenalty = movingPlacement ? 0.1 * ((movingPlacement.x - moving[0].atom.x) ** 2 + (movingPlacement.y - moving[0].atom.y) ** 2) : 0;
          const score =
            reaction2dCandidateLayoutScore(mol, componentAtomIds, placements, bondLength) +
            movePenalty +
            movingPenalty +
            20 * reaction2dTrigonalSpreadPenalty(centerCandidate, infos, movingPlacement ? [movingPlacement] : []);
          if (!best || score < best.score) {
            best = { score, centerCandidate, movingPlacement };
          }
        }
        if (best) {
          center.x = best.centerCandidate.x;
          center.y = best.centerCandidate.y;
          if (best.movingPlacement) {
            moving[0].atom.x = best.movingPlacement.x;
            moving[0].atom.y = best.movingPlacement.y;
          }
        }
      }
    }
  }
}

function preserveReaction2dStereoDisplay(mol, previewState, componentAtomIds) {
  if (!mol) {
    return;
  }
  const resolved = previewState.forcedStereoByCenter instanceof Map ? previewState.forcedStereoByCenter : new Map();
  const resolvedBondTypes = previewState.forcedStereoBondTypes instanceof Map ? previewState.forcedStereoBondTypes : new Map();
  const resolvedBondCenters = previewState.forcedStereoBondCenters instanceof Map ? previewState.forcedStereoBondCenters : new Map();

  const ensureDisplayedStereo = (centerId, bond, desiredType) => {
    if (!bond || !centerId || !desiredType) {
      return;
    }
    applyDisplayedStereoToCenter(mol, centerId, bond.id, desiredType);
  };

  for (const [bondId, type] of previewState.preservedReactantStereoBondTypes ?? new Map()) {
    if (mol.bonds.has(bondId)) {
      resolvedBondTypes.set(bondId, type);
    }
  }

  for (const [bondId, type] of previewState.preservedProductStereoBondTypes ?? new Map()) {
    if (mol.bonds.has(bondId)) {
      resolvedBondTypes.set(bondId, type);
    }
  }

  for (const [centerId, preserved] of previewState.preservedReactantStereoByCenter ?? new Map()) {
    const bond = mol.getBond(centerId, preserved.otherId);
    if (!bond) {
      continue;
    }
    ensureDisplayedStereo(centerId, bond, preserved.type);
    resolved.set(centerId, {
      bondId: bond.id,
      type: preserved.type
    });
    resolvedBondCenters.set(bond.id, centerId);
  }

  for (const [centerId, preserved] of previewState.preservedProductStereoByCenter ?? new Map()) {
    if (!componentAtomIds.has(centerId) || mol.__reactionPreview.editedProductAtomIds.has(centerId)) {
      continue;
    }
    const center = mol.atoms.get(centerId);
    const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceAtomId(centerId)) ? mol.atoms.get(sourceAtomId(centerId)) : null;
    if (!center || !reactantCenter) {
      continue;
    }
    const bond = mol.getBond(centerId, preserved.otherProductId);
    if (!bond) {
      continue;
    }
    ensureDisplayedStereo(centerId, bond, preserved.type);

    resolved.set(centerId, {
      bondId: bond.id,
      type: preserved.type
    });
    resolvedBondCenters.set(bond.id, centerId);
  }

  previewState.forcedStereoByCenter = resolved;
  for (const [centerId, { bondId, type }] of resolved.entries()) {
    resolvedBondTypes.set(bondId, type);
    resolvedBondCenters.set(bondId, centerId);
  }
  previewState.forcedStereoBondTypes = resolvedBondTypes;
  previewState.forcedStereoBondCenters = resolvedBondCenters;
  previewState.forcedProductStereoByCenter = resolved;
}

/**
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {object} previewState - Reaction preview state object.
 * @param {number} bondLength - Target bond length.
 */
export function alignReaction2dProductOrientation(mol, previewState, bondLength = 1.5) {
  if (!previewState?.mappedAtomPairs?.length) {
    return;
  }
  mol.__reactionPreview = previewState;
  restoreReaction2dCoords(mol, previewState.reactantReferenceCoords);

  for (const componentAtomIds of previewState.productComponentAtomIdSets ?? []) {
    const topologyPreservedComponent = seedReaction2dTopologyPreservedComponentCoords(mol, componentAtomIds);
    if (topologyPreservedComponent) {
      idealizeReaction2dEditedTwoHeavyImineCenters(mol, componentAtomIds, bondLength);
      preserveReaction2dStereoDisplay(mol, previewState, componentAtomIds);
      reanchorReaction2dHiddenHydrogens(mol, componentAtomIds);
      continue;
    }

    relayoutReaction2dComponentInIsolation(mol, componentAtomIds, bondLength);
    const isolatedSnapshot = snapshotReaction2dCoords(mol, componentAtomIds);
    const pairs = previewState.mappedAtomPairs
      .filter(([, productId]) => componentAtomIds.has(productId))
      .map(([reactantId, productId]) => [mol.atoms.get(reactantId), mol.atoms.get(productId)])
      .filter(([reactant, product]) => reactant?.x != null && product?.x != null);
    if (pairs.length === 0) {
      continue;
    }

    const productIdBySourceId = new Map(pairs.map(([reactant, product]) => [reactant.id, product.id]));
    let mappedConnectivityChanged = false;
    let mappedRingMembershipChanged = false;
    const sourceIds = [...productIdBySourceId.keys()].filter(atomId => mol.atoms.get(atomId)?.name !== 'H');
    for (const sourceId of sourceIds) {
      const productId = productIdBySourceId.get(sourceId);
      const reactantAtom = mol.atoms.get(sourceId);
      const productAtom = mol.atoms.get(productId);
      if (!reactantAtom || !productAtom) {
        continue;
      }
      if (!!reactantAtom.isInRing(mol) !== !!productAtom.isInRing(mol)) {
        mappedRingMembershipChanged = true;
        break;
      }
    }
    for (let i = 0; i < sourceIds.length && !mappedConnectivityChanged; i++) {
      for (let j = i + 1; j < sourceIds.length; j++) {
        const reactantA = sourceIds[i];
        const reactantB = sourceIds[j];
        const productA = productIdBySourceId.get(reactantA);
        const productB = productIdBySourceId.get(reactantB);
        const reactantBond = mol.getBond(reactantA, reactantB);
        const productBond = mol.getBond(productA, productB);
        if (!!reactantBond !== !!productBond) {
          mappedConnectivityChanged = true;
          break;
        }
      }
    }

    let reactantCx = 0,
      reactantCy = 0,
      productCx = 0,
      productCy = 0;
    for (const [reactant, product] of pairs) {
      reactantCx += reactant.x;
      reactantCy += reactant.y;
      productCx += product.x;
      productCy += product.y;
    }
    reactantCx /= pairs.length;
    reactantCy /= pairs.length;
    productCx /= pairs.length;
    productCy /= pairs.length;

    const anchoredPairs = pairs.filter(([reactant, product]) => mappedAtomReaction2dLocallyAnchored(reactant, product, mol, componentAtomIds));
    const fittingPairs = anchoredPairs.length > 0 ? anchoredPairs : pairs;
    if (anchoredPairs.length > 0) {
      reactantCx = 0;
      reactantCy = 0;
      productCx = 0;
      productCy = 0;
      for (const [reactant, product] of fittingPairs) {
        reactantCx += reactant.x;
        reactantCy += reactant.y;
        productCx += product.x;
        productCy += product.y;
      }
      reactantCx /= fittingPairs.length;
      reactantCy /= fittingPairs.length;
      productCx /= fittingPairs.length;
      productCy /= fittingPairs.length;
    }

    let angle = 0;
    let mirrorX = 1;
    if (fittingPairs.length >= 2) {
      const candidateTransforms = [1, -1].map(candidateMirrorX => {
        let dot = 0;
        let cross = 0;
        for (const [reactant, product] of fittingPairs) {
          const ax = reactant.x - reactantCx;
          const ay = reactant.y - reactantCy;
          const bx = (product.x - productCx) * candidateMirrorX;
          const by = product.y - productCy;
          dot += bx * ax + by * ay;
          cross += bx * ay - by * ax;
        }
        let candidateAngle = Math.atan2(cross, dot);
        if (!Number.isFinite(candidateAngle)) {
          candidateAngle = 0;
        }
        const cosA = Math.cos(candidateAngle);
        const sinA = Math.sin(candidateAngle);
        let error = 0;
        for (const [reactant, product] of fittingPairs) {
          const dx = (product.x - productCx) * candidateMirrorX;
          const dy = product.y - productCy;
          const tx = reactantCx + dx * cosA - dy * sinA;
          const ty = reactantCy + dx * sinA + dy * cosA;
          error += (tx - reactant.x) ** 2 + (ty - reactant.y) ** 2;
        }
        return { candidateMirrorX, candidateAngle, error };
      });
      const best = candidateTransforms.sort((a, b) => a.error - b.error)[0];
      mirrorX = best.candidateMirrorX;
      angle = best.candidateAngle;
    }

    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    for (const atomId of componentAtomIds) {
      const atom = mol.atoms.get(atomId);
      if (!atom || atom.x == null) {
        continue;
      }
      const dx = (atom.x - productCx) * mirrorX;
      const dy = atom.y - productCy;
      atom.x = reactantCx + dx * cosA - dy * sinA;
      atom.y = reactantCy + dx * sinA + dy * cosA;
    }
    const fittedIsolatedSnapshot = snapshotReaction2dCoords(mol, componentAtomIds);
    let productLayoutGraph = null;
    const getProductLayoutGraph = () => {
      if (!productLayoutGraph) {
        productLayoutGraph = createLayoutGraph(mol, { suppressH: true, bondLength });
      }
      return productLayoutGraph;
    };
    const scaffoldPairs = pairs.filter(([reactant, product]) => mappedAtomReaction2dScaffoldCompatible(reactant, product, mol, componentAtomIds));
    const stableScaffoldPairs = scaffoldPairs.filter(([, product]) => product.name !== 'H' && reaction2dMinHeavyDistanceToEdited(mol, product.id, componentAtomIds) > 1);
    const hasEditedMultipleBondCenter = [...componentAtomIds].some(atomId => {
      if (!mol.__reactionPreview.editedProductAtomIds.has(atomId)) {
        return false;
      }
      const atom = mol.atoms.get(atomId);
      if (!atom || atom.name === 'H') {
        return false;
      }
      return atom.getNeighbors(mol).some(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && (mol.getBond(atom.id, nb.id)?.properties.order ?? 1) >= 2);
    });
    const mappedHeavyPairs = pairs.filter(([reactant, product]) => reactant.name !== 'H' && product.name !== 'H');
    const componentHeavyAtomCount = [...componentAtomIds].map(atomId => mol.atoms.get(atomId)).filter(atom => atom && atom.name !== 'H').length;
    const canSeedHeavyScaffold = mappedHeavyPairs.length >= 3 && mappedHeavyPairs.length === componentHeavyAtomCount && !mappedConnectivityChanged;
    if (canSeedHeavyScaffold) {
      const beforeSnapshot = snapshotReaction2dCoords(mol, componentAtomIds);
      for (const [reactant, product] of mappedHeavyPairs) {
        product.x = reactant.x;
        product.y = reactant.y;
      }
      refineReaction2dEditedGeometry(mol, componentAtomIds, bondLength);
      const seededStats = reaction2dHeavyGeometryStats(mol, componentAtomIds);
      if (seededStats.maxBond > bondLength * 1.85 || seededStats.minNonbonded < bondLength * 0.55) {
        restoreReaction2dCoords(mol, beforeSnapshot);
      }
    }
    const exactSnapPairs = scaffoldPairs.length >= 3 ? scaffoldPairs : anchoredPairs.length >= 3 ? anchoredPairs : [];
    if (!canSeedHeavyScaffold && !mappedConnectivityChanged && exactSnapPairs.length >= 3) {
      const beforeSnapshot = snapshotReaction2dCoords(mol, componentAtomIds);
      for (const [reactant, product] of exactSnapPairs) {
        product.x = reactant.x;
        product.y = reactant.y;
      }
      refineReaction2dEditedGeometry(mol, componentAtomIds, bondLength);
      const snappedStats = reaction2dHeavyGeometryStats(mol, componentAtomIds);
      if (snappedStats.maxBond > bondLength * 1.85 || snappedStats.minNonbonded < bondLength * 0.55) {
        restoreReaction2dCoords(mol, beforeSnapshot);
      }
    }
    if (mappedConnectivityChanged && !mappedRingMembershipChanged && !hasEditedMultipleBondCenter && stableScaffoldPairs.length >= 2) {
      const beforeSnapshot = snapshotReaction2dCoords(mol, componentAtomIds);
      for (const [reactant, product] of stableScaffoldPairs) {
        product.x = reactant.x;
        product.y = reactant.y;
      }
      refineReaction2dEditedGeometry(mol, componentAtomIds, bondLength);
      const lockedStats = reaction2dHeavyGeometryStats(mol, componentAtomIds);
      if (lockedStats.maxBond > bondLength * 2 || lockedStats.minNonbonded < bondLength * 0.45) {
        restoreReaction2dCoords(mol, beforeSnapshot);
      }
    }
    if (!mappedConnectivityChanged) {
      refineReaction2dEditedGeometry(mol, componentAtomIds, bondLength);
    }
    if (!mappedRingMembershipChanged) {
      restoreMappedReaction2dRetainedScaffoldCoords(mol, componentAtomIds);
      restoreReaction2dRetainedTertButylFansFromIsolated(mol, componentAtomIds, fittedIsolatedSnapshot, bondLength);
      restoreReaction2dCompactBridgedCagesFromIsolated(mol, componentAtomIds, fittedIsolatedSnapshot, bondLength, getProductLayoutGraph());
      idealizeReaction2dEditedRingExocyclicTermini(mol, componentAtomIds, bondLength);
      idealizeReaction2dEditedSaturatedRingAnchorFans(mol, componentAtomIds, bondLength);
    }
    if (mappedConnectivityChanged || hasEditedMultipleBondCenter) {
      idealizeReaction2dTrigonalCenters(mol, componentAtomIds, bondLength);
      idealizeReaction2dEditedTwoHeavyImineCenters(mol, componentAtomIds, bondLength);
      idealizeReaction2dTerminalAlkylContinuations(mol, componentAtomIds, bondLength);
    }
    idealizeReaction2dEditedSaturatedHalogenFans(mol, componentAtomIds, bondLength);
    finalizeReaction2dEditedCarbonylCenters(mol, componentAtomIds, bondLength);
    finalizeReaction2dTwoNeighborCarbonylCenters(mol, componentAtomIds, bondLength);
    idealizeReaction2dEditedTwoHeavyImineCenters(mol, componentAtomIds, bondLength);
    idealizeReaction2dTerminalHeteroCarbonylContinuations(mol, componentAtomIds, bondLength);
    restoreReaction2dRetainedTertButylFansFromIsolated(mol, componentAtomIds, fittedIsolatedSnapshot, bondLength);
    restoreReaction2dCompactBridgedCagesFromIsolated(mol, componentAtomIds, fittedIsolatedSnapshot, bondLength, getProductLayoutGraph());
    finalizeReaction2dEditedCarbonylCenters(mol, componentAtomIds, bondLength);
    finalizeReaction2dTwoNeighborCarbonylCenters(mol, componentAtomIds, bondLength);
    idealizeReaction2dTerminalHeteroCarbonylContinuations(mol, componentAtomIds, bondLength);
    preserveReaction2dStereoDisplay(mol, previewState, componentAtomIds);
    reanchorReaction2dHiddenHydrogens(mol, componentAtomIds);

    // Ring-opening reactions (e.g. ether cleavage) produce an acyclic chain
    // from a cyclic reactant.  The best-fit rotation above aligns the product
    // to the reactant ring orientation, leaving the backbone tilted.  When the
    // ring membership changed and the product component has a long acyclic
    // backbone, re-apply canonical landscape orientation so the chain is level.
    if (mappedRingMembershipChanged) {
      const checkMol = new Molecule();
      for (const atomId of componentAtomIds) {
        const atom = mol.atoms.get(atomId);
        if (!atom) {
          continue;
        }
        const copy = checkMol.addAtom(atom.id, atom.name, {});
        copy.x = atom.x;
        copy.y = atom.y;
      }
      for (const bond of mol.bonds.values()) {
        const [aId, bId] = bond.atoms;
        if (componentAtomIds.has(aId) && componentAtomIds.has(bId)) {
          checkMol.addBond(bond.id, aId, bId, {}, false);
        }
      }
      const remainingRingCount = checkMol.getRings().length;
      const preferredBackbone = findPreferredBackbonePath(checkMol);
      const shouldForceRingOpeningLandscape = shouldPreferFinalLandscapeOrientation(checkMol) || (remainingRingCount === 0 && (preferredBackbone?.path.length ?? 0) >= 4);
      if (shouldForceRingOpeningLandscape) {
        const useIsolatedRingOpeningLayout = remainingRingCount === 0 && (preferredBackbone?.path.length ?? 0) >= 4;
        const componentCoords = useIsolatedRingOpeningLayout
          ? new Map(isolatedSnapshot)
          : (() => {
              const coords = new Map();
              for (const atomId of componentAtomIds) {
                const atom = mol.atoms.get(atomId);
                if (atom?.x != null) {
                  coords.set(atomId, { x: atom.x, y: atom.y });
                }
              }
              return coords;
            })();
        if (!useIsolatedRingOpeningLayout) {
          ensureLandscapeOrientation(componentCoords, checkMol);
        }
        for (const [atomId, pos] of componentCoords) {
          const atom = mol.atoms.get(atomId);
          if (atom) {
            atom.x = pos.x;
            atom.y = pos.y;
          }
        }
      }
      if (remainingRingCount > 0) {
        expandReaction2dCrowdedComponent(mol, componentAtomIds, bondLength);
      }
    }
    idealizeReaction2dTerminalAlkyneContinuations(mol, componentAtomIds, bondLength);
    idealizeReaction2dTerminalReducedAlkynePairs(mol, componentAtomIds, bondLength);
    reanchorReaction2dHiddenHydrogens(mol, componentAtomIds);
  }
}

/**
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {object} previewState - Reaction preview state object.
 * @param {number} bondLength - Target bond length.
 */
export function spreadReaction2dProductComponents(mol, previewState, bondLength = 1.5) {
  if (!previewState || !mol || (previewState.productComponentAtomIdSets?.length ?? 0) < 2) {
    return;
  }
  const items = [...mol.atoms.values()].filter(atom => atom.x != null && atom.visible !== false);
  const geometries = previewState.productComponentAtomIdSets
    .map(atomIds => ({
      atomIds,
      geom: reaction2dArrowGeometryPreferHeavy(items, atomIds)
    }))
    .filter(entry => entry.geom);
  if (geometries.length < 2) {
    return;
  }

  const gap = bondLength * 2.1;
  const widths = geometries.map(entry => Math.max(0.5, entry.geom.maxX - entry.geom.minX));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + gap * (geometries.length - 1);
  const targetCy = geometries.reduce((sum, entry) => sum + entry.geom.cy, 0) / geometries.length;
  let cursor = -totalWidth / 2;
  for (let i = 0; i < geometries.length; i++) {
    const { atomIds, geom } = geometries[i];
    const width = widths[i];
    const targetCx = cursor + width / 2;
    const dx = targetCx - geom.cx;
    const dy = targetCy - geom.cy;
    for (const atomId of atomIds) {
      const atom = mol.atoms.get(atomId);
      if (!atom || atom.x == null) {
        continue;
      }
      atom.x += dx;
      atom.y += dy;
    }
    cursor += width + gap;
  }
}

/**
 * @param {import('../core/Molecule.js').Molecule} mol - The molecule graph.
 * @param {object} previewState - Reaction preview state object.
 * @param {number} bondLength - Target bond length.
 */
export function centerReaction2dPairCoords(mol, previewState, bondLength = 1.5) {
  if (!previewState || !mol) {
    return;
  }

  const items = [...mol.atoms.values()].filter(atom => atom.x != null && atom.visible !== false);
  const reactant = reaction2dArrowGeometryPreferHeavy(items, previewState.reactantAtomIds);
  const product = reaction2dArrowGeometryPreferHeavy(items, previewState.productAtomIds);
  if (!reactant || !product) {
    return;
  }

  const productComponentCount = Math.max(1, previewState.productComponentAtomIdSets?.length ?? 0);
  const gap = bondLength * (3.8 + Math.max(0, productComponentCount - 1) * 0.55);
  const reactantWidth = reactant.maxX - reactant.minX;
  const productWidth = product.maxX - product.minX;
  const reactantCx = (reactant.minX + reactant.maxX) / 2;
  const productCx = (product.minX + product.maxX) / 2;
  const targetReactantCx = -(gap / 2 + reactantWidth / 2);
  const targetProductCx = +(gap / 2 + productWidth / 2);
  const targetCy = (reactant.cy + product.cy) / 2;
  const reactantDy = targetCy - reactant.cy;
  const productDy = targetCy - product.cy;
  const reactantDx = targetReactantCx - reactantCx;
  const productDx = targetProductCx - productCx;

  for (const atom of mol.atoms.values()) {
    if (atom.x == null) {
      continue;
    }
    if (previewState.reactantAtomIds.has(atom.id)) {
      atom.x += reactantDx;
      atom.y += reactantDy;
    } else if (previewState.productAtomIds.has(atom.id)) {
      atom.x += productDx;
      atom.y += productDy;
    }
  }
}
