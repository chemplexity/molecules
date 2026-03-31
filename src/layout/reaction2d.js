import { Molecule } from '../core/Molecule.js';
import { applySMIRKS } from '../smirks/index.js';
import { generateAndRefine2dCoords } from './index.js';
import { pickStereoWedges, stereoBondTypeForCenter } from './mol2d-helpers.js';

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
    const copy = cloned.addBond(
      `${prefix}${bond.id}`,
      `${prefix}${bond.atoms[0]}`,
      `${prefix}${bond.atoms[1]}`,
      JSON.parse(JSON.stringify(bond.properties ?? {})),
      false
    );
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
  if (!hasExistingHeavyCoords) {
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

export function buildReaction2dMol(sourceMol, smirks, mapping = undefined) {
  if (!sourceMol || !smirks) {
    return null;
  }
  const reactantMol = sourceMol.clone();
  const productMol = applySMIRKS(sourceMol, smirks, { mode: 'first', ...(mapping ? { mapping } : {}) });
  if (!productMol) {
    return null;
  }
  let previewMol = reactantMol;
  const productAtomIds = new Set();
  const productComponentAtomIdSets = [];
  const mappedAtomPairs = [];
  const reactantAffectedAtomIds = new Set(mapping ? [...mapping.values()] : []);
  const productAffectedAtomIds = new Set();
  const sourceStereoReferenceMol = prepareReaction2dStereoReferenceMol(reactantMol.clone());
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
    highlightMapping
  };
}

export function sourceAtomId(productAtomId) {
  return typeof productAtomId === 'string' ? productAtomId.split(':').slice(1).join(':') : productAtomId;
}

function reaction2dArrowGeometry(items, atomIds) {
  if (!atomIds?.size) {
    return null;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
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

  const reactantMappedNeighbors = reactant.getNeighbors(mol)
    .filter(nb => mol.__reactionPreview.reactantAtomIds.has(nb.id) && nb.name !== 'H')
    .map(nb => nb.id)
    .sort();
  const productMappedNeighbors = product.getNeighbors(mol)
    .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H')
    .map(nb => sourceAtomId(nb.id))
    .sort();

  return reactantMappedNeighbors.join('|') === productMappedNeighbors.join('|');
}

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
  const reactantMappedNeighbors = reactant.getNeighbors(mol)
    .filter(nb => mol.__reactionPreview.reactantAtomIds.has(nb.id) && nb.name !== 'H')
    .map(nb => {
      const bond = mol.getBond(reactant.id, nb.id);
      return `${nb.id}:${bond?.properties.order ?? 1}:${bond?.properties.aromatic ?? false}`;
    })
    .sort();
  const productMappedNeighbors = product.getNeighbors(mol)
    .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H')
    .map(nb => {
      const bond = mol.getBond(product.id, nb.id);
      return `${sourceAtomId(nb.id)}:${bond?.properties.order ?? 1}:${bond?.properties.aromatic ?? false}`;
    })
    .sort();
  return reactantMappedNeighbors.join('|') === productMappedNeighbors.join('|');
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

  const placementMap = new Map(
    placements.map(({ atom, x, y }) => [atom.id, { atom, x, y }])
  );
  const heavyAtoms = [...componentAtomIds]
    .map(id => mol.atoms.get(id))
    .filter(atom => atom && atom.name !== 'H');
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
      score += 2.5 * ((d - targetLength) ** 2);
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
        score += 500 + ((0.6 - d) * 1000);
      } else if (d < 0.9) {
        score += 180 * ((0.9 - d) ** 2);
      } else if (d < 1.15) {
        score += 30 * ((1.15 - d) ** 2);
      }
    }
  }

  return score;
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
  const atoms = [...componentAtomIds]
    .map(id => mol.atoms.get(id))
    .filter(atom => atom && atom.name !== 'H' && atom.x != null && atom.y != null);
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

    const heavyNeighbors = center.getNeighbors(mol)
      .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
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
    const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceCenterId)
      ? mol.atoms.get(sourceCenterId)
      : null;
    const reactantParent = mol.__reactionPreview.reactantAtomIds.has(sourceParentId)
      ? mol.atoms.get(sourceParentId)
      : null;
    if (
      reactantCenter?.x == null ||
      reactantCenter?.y == null ||
      reactantParent?.x == null ||
      reactantParent?.y == null ||
      !reactantParent.getNeighbors(mol).some(nb => nb.id === reactantCenter.id)
    ) {
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
    const currentScore = reaction2dCandidateLayoutScore(
      mol,
      componentAtomIds,
      [{ atom: center, x: center.x, y: center.y }],
      bondLength
    );
    const candidateScore = reaction2dCandidateLayoutScore(
      mol,
      componentAtomIds,
      [{ atom: center, x: candidate.x, y: candidate.y }],
      bondLength
    );
    if (candidateScore <= currentScore) {
      center.x = candidate.x;
      center.y = candidate.y;
    }
  }
}

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
    const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceCenterId)
      ? mol.atoms.get(sourceCenterId)
      : null;

    const heavyNeighbors = center.getNeighbors(mol)
      .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighbors.length === 0) {
      continue;
    }
    if (heavyNeighbors.some(nb => (mol.getBond(center.id, nb.id)?.properties.order ?? 1) >= 2)) {
      continue;
    }

    const anchored = heavyNeighbors
      .map(nb => {
        const reactantNb = mol.__reactionPreview.reactantAtomIds.has(sourceAtomId(nb.id))
          ? mol.atoms.get(sourceAtomId(nb.id))
          : null;
        const bond = mol.getBond(center.id, nb.id);
        return {
          atom: nb,
          reactant: reactantNb,
          anchored: mappedAtomReaction2dScaffoldCompatible(reactantNb, nb, mol, componentAtomIds),
          targetLength: scaledReaction2dBondLength(bond?.properties.order ?? 1, bondLength)
        };
      })
      .filter(info => info.anchored);

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
        const candidates = circleIntersections(
          bestPair.first.atom,
          bestPair.first.targetLength,
          bestPair.second.atom,
          bestPair.second.targetLength
        );
        if (candidates.length > 0) {
          let best = null;
          for (const candidate of [{ x: center.x, y: center.y }, ...candidates]) {
            let score = (candidate.x - center.x) ** 2 + (candidate.y - center.y) ** 2;
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
            score += reaction2dCandidateLayoutScore(
              mol,
              componentAtomIds,
              [{ atom: center, x: candidate.x, y: candidate.y }],
              bondLength
            );
            if (!best || score < best.score) {
              best = { candidate, score };
            }
          }
          if (best) {
            center.x = best.candidate.x;
            center.y = best.candidate.y;
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
          const currentScore = reaction2dCandidateLayoutScore(
            mol,
            componentAtomIds,
            [{ atom: center, x: center.x, y: center.y }],
            bondLength
          );
          const candidateScore = reaction2dCandidateLayoutScore(
            mol,
            componentAtomIds,
            [{ atom: center, x: candidate.x, y: candidate.y }],
            bondLength
          );
          if (candidateScore <= currentScore) {
            center.x = candidate.x;
            center.y = candidate.y;
          }
        }
      }
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

    const heavyNeighbors = center.getNeighbors(mol)
      .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
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
    const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceCenterId)
      ? mol.atoms.get(sourceCenterId)
      : null;
    const reactantParent = mol.__reactionPreview.reactantAtomIds.has(sourceParentId)
      ? mol.atoms.get(sourceParentId)
      : null;
    if (
      reactantCenter?.x == null ||
      reactantCenter?.y == null ||
      reactantParent?.x == null ||
      reactantParent?.y == null ||
      !reactantParent.getNeighbors(mol).some(nb => nb.id === reactantCenter.id)
    ) {
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
    const currentScore = reaction2dCandidateLayoutScore(
      mol,
      componentAtomIds,
      [{ atom: center, x: center.x, y: center.y }],
      bondLength
    );
    const candidateScore = reaction2dCandidateLayoutScore(
      mol,
      componentAtomIds,
      [{ atom: center, x: candidate.x, y: candidate.y }],
      bondLength
    );
    if (candidateScore <= currentScore) {
      center.x = candidate.x;
      center.y = candidate.y;
    }
  }
}

function idealizeReaction2dTrigonalCenters(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }
  const mappedProductIds = new Set(
    (mol.__reactionPreview.mappedAtomPairs ?? [])
      .filter(([, productId]) => componentAtomIds.has(productId))
      .map(([, productId]) => productId)
  );

  for (const centerId of componentAtomIds) {
    const center = mol.atoms.get(centerId);
    if (!center || center.name === 'H' || center.x == null || center.y == null) {
      continue;
    }
    const heavyNeighbors = center.getNeighbors(mol)
      .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
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
    const isCarbonylLikeCenter =
      center.name === 'C' &&
      neighborInfo.some(info => info.order >= 2 && info.atom.name === 'O');
    if (isCarbonylLikeCenter) {
      continue;
    }

    const anchored = neighborInfo.filter(info => info.anchored);
    const moving = neighborInfo.filter(info => !info.anchored);
    if (moving.length === 0) {
      continue;
    }

    if (mol.__reactionPreview.editedProductAtomIds.has(center.id)) {
      const scaffoldAnchors = neighborInfo.filter(info => info.scaffold);
      if (scaffoldAnchors.length === 1) {
        const anchor = scaffoldAnchors[0];
        const movingInfos = neighborInfo.filter(info => info !== anchor);
        if (movingInfos.length === 2) {
          const centerCandidates = [{ x: center.x, y: center.y }];
          if (anchor.reactant?.x != null && anchor.reactant?.y != null) {
            const sourceCenterId = sourceAtomId(center.id);
            const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceCenterId)
              ? mol.atoms.get(sourceCenterId)
              : null;
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
            score: reaction2dCandidateLayoutScore(
              mol,
              componentAtomIds,
              [
                { atom: center, x: center.x, y: center.y },
                ...movingInfos.map(info => ({ atom: info.atom, x: info.atom.x, y: info.atom.y }))
              ],
              bondLength
            ),
            centerCandidate: { x: center.x, y: center.y },
            placed: movingInfos.map(info => ({ atom: info.atom, x: info.atom.x, y: info.atom.y }))
          };
          for (const centerCandidate of centerCandidates) {
            const baseAngle = Math.atan2(anchor.atom.y - centerCandidate.y, anchor.atom.x - centerCandidate.x);
            const candidateLayouts = [
              [baseAngle + (2 * Math.PI / 3), baseAngle - (2 * Math.PI / 3)],
              [baseAngle - (2 * Math.PI / 3), baseAngle + (2 * Math.PI / 3)]
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
              const score = reaction2dCandidateLayoutScore(
                mol,
                componentAtomIds,
                [{ atom: center, x: centerCandidate.x, y: centerCandidate.y }, ...placed],
                bondLength
              );
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
      const candidates = circleIntersections(
        first.atom,
        first.targetLength,
        second.atom,
        second.targetLength
      );
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
        const currentScore = reaction2dCandidateLayoutScore(
          mol,
          componentAtomIds,
          [{ atom: moving[0].atom, x: moving[0].atom.x, y: moving[0].atom.y }],
          bondLength
        );
        const candidateScore = reaction2dCandidateLayoutScore(
          mol,
          componentAtomIds,
          [{ atom: moving[0].atom, x: candidate.x, y: candidate.y }],
          bondLength
        );
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
        [baseAngle + (2 * Math.PI / 3), baseAngle - (2 * Math.PI / 3)],
        [baseAngle - (2 * Math.PI / 3), baseAngle + (2 * Math.PI / 3)]
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
  const mappedProductIds = new Set(
    (mol.__reactionPreview.mappedAtomPairs ?? [])
      .filter(([, productId]) => componentAtomIds.has(productId))
      .map(([, productId]) => productId)
  );
  for (const atomId of componentAtomIds) {
    const atom = mol.atoms.get(atomId);
    if (!atom || atom.x == null || atom.name === 'H') {
      continue;
    }
    const heavyNeighbors = atom.getNeighbors(mol)
      .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null);
    if (heavyNeighbors.length !== 1) {
      continue;
    }
    const parent = heavyNeighbors[0];
    const atomBond = mol.getBond(atom.id, parent.id);
    if (mol.__reactionPreview.editedProductAtomIds.has(atom.id) && (atomBond?.properties.order ?? 1) >= 2) {
      continue;
    }
    const parentHeavyNeighbors = parent.getNeighbors(mol)
      .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    const parentHasTrigonalEditedGeometry =
      mol.__reactionPreview.editedProductAtomIds.has(parent.id) &&
      parentHeavyNeighbors.length === 3 &&
      parentHeavyNeighbors.some(nb => (mol.getBond(parent.id, nb.id)?.properties.order ?? 1) >= 2);
    if (parentHasTrigonalEditedGeometry) {
      continue;
    }
    const targetBondLength = bondLength * (
      (atomBond?.properties.order ?? 1) >= 3 ? 0.78 :
        (atomBond?.properties.order ?? 1) >= 2 ? 0.86 :
          1
    );
    const sourceId = sourceAtomId(atomId);
    const reactantAtom = mol.__reactionPreview.reactantAtomIds.has(sourceId)
      ? mol.atoms.get(sourceId)
      : null;
    const parentSourceId = sourceAtomId(parent.id);
    const reactantParent = mol.__reactionPreview.reactantAtomIds.has(parentSourceId)
      ? mol.atoms.get(parentSourceId)
      : null;
    const reactantPeripheralDirection =
      reactantAtom?.x != null &&
      reactantAtom?.y != null &&
      reactantParent?.x != null &&
      reactantParent?.y != null &&
      reactantParent.getNeighbors(mol).some(nb => nb.id === reactantAtom.id)
        ? {
          x: reactantAtom.x - reactantParent.x,
          y: reactantAtom.y - reactantParent.y
        }
        : null;
    const preserveEditedTerminusDirection =
      mol.__reactionPreview.editedProductAtomIds.has(atom.id) &&
      !!reactantPeripheralDirection;
    const reactantLostHeavyNeighbor =
      reactantAtom &&
      reactantAtom.getNeighbors(mol).some(nb =>
        mol.__reactionPreview.reactantAtomIds.has(nb.id) &&
        nb.id !== reactantParent?.id &&
        nb.name !== 'H' &&
        !parent.getNeighbors(mol).some(productNb => componentAtomIds.has(productNb.id) && sourceAtomId(productNb.id) === nb.id)
      );
    const preserveReactantPeripheralDirection =
      preserveEditedTerminusDirection ||
      !!reactantPeripheralDirection &&
      (
        ['F', 'Cl', 'Br', 'I'].includes(atom.name) ||
        (reactantAtom && reactantAtom.name !== atom.name) ||
        reactantLostHeavyNeighbor
      );
    if (preserveReactantPeripheralDirection) {
      const len = Math.hypot(reactantPeripheralDirection.x, reactantPeripheralDirection.y);
      if (len >= 1e-6) {
        const candidate = {
          x: parent.x + (reactantPeripheralDirection.x / len) * targetBondLength,
          y: parent.y + (reactantPeripheralDirection.y / len) * targetBondLength
        };
        const currentScore = reaction2dCandidateLayoutScore(
          mol,
          componentAtomIds,
          [{ atom, x: atom.x, y: atom.y }],
          bondLength
        );
        const candidateScore = reaction2dCandidateLayoutScore(
          mol,
          componentAtomIds,
          [{ atom, x: candidate.x, y: candidate.y }],
          bondLength
        );
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
      parent.getNeighbors(mol)
        .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && mappedProductIds.has(nb.id))
        .map(nb => sourceAtomId(nb.id))
    );
    const lostReactantNeighbors = reactantParent
      ? reactantParent.getNeighbors(mol).filter(nb =>
        mol.__reactionPreview.reactantAtomIds.has(nb.id) &&
        nb.id !== parentSourceId &&
        nb.name !== 'H' &&
        nb.x != null &&
        nb.y != null &&
        !mappedSiblingSourceIds.has(nb.id)
      )
      : [];
    const siblings = parent.getNeighbors(mol)
      .filter(nb => componentAtomIds.has(nb.id) && nb.id !== atom.id && nb.name !== 'H' && nb.x != null);
    const carbonylLikeParent = siblings.some(sibling => {
      const siblingBond = mol.getBond(parent.id, sibling.id);
      return (siblingBond?.properties.order ?? 1) >= 2;
    });
    const bondOrder = atomBond?.properties.order ?? 1;
    const shouldReplaceLostNeighborDirection =
      bondOrder === 1 &&
      carbonylLikeParent &&
      lostReactantNeighbors.length > 0;
    const preferSiblingGeometry =
      bondOrder >= 2 ||
      (bondOrder === 1 && carbonylLikeParent && !shouldReplaceLostNeighborDirection);

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
        const currentScore = reaction2dCandidateLayoutScore(
          mol,
          componentAtomIds,
          [{ atom, x: atom.x, y: atom.y }],
          bondLength
        );
        const candidateScore = reaction2dCandidateLayoutScore(
          mol,
          componentAtomIds,
          [{ atom, x: candidate.x, y: candidate.y }],
          bondLength
        );
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
    const currentScore = reaction2dCandidateLayoutScore(
      mol,
      componentAtomIds,
      [{ atom, x: atom.x, y: atom.y }],
      bondLength
    );
    const candidateScore = reaction2dCandidateLayoutScore(
      mol,
      componentAtomIds,
      [{ atom, x: candidate.x, y: candidate.y }],
      bondLength
    );
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

    const heavyNeighbors = center.getNeighbors(mol)
      .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
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

    let baseAngle = null;
    const sourceCenterId = sourceAtomId(centerId);
    const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceCenterId)
      ? mol.atoms.get(sourceCenterId)
      : null;
    if (reactantCenter?.x != null && reactantCenter?.y != null) {
      const mappedSourceIds = new Set(
        heavyNeighbors
          .filter(nb => sourceAtomId(nb.id) !== nb.id || mol.__reactionPreview.reactantAtomIds.has(sourceAtomId(nb.id)))
          .map(nb => sourceAtomId(nb.id))
      );
      const lostReactantNeighbors = reactantCenter.getNeighbors(mol).filter(nb =>
        mol.__reactionPreview.reactantAtomIds.has(nb.id) &&
        nb.name !== 'H' &&
        nb.x != null &&
        nb.y != null &&
        !mappedSourceIds.has(nb.id)
      );
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
        { info: doubleNeighbor, angle: baseAngle + (Math.PI / 3) },
        { info: singleNeighbor, angle: baseAngle - (Math.PI / 3) }
      ],
      [
        { info: doubleNeighbor, angle: baseAngle - (Math.PI / 3) },
        { info: singleNeighbor, angle: baseAngle + (Math.PI / 3) }
      ]
    ];

    let best = null;
    for (const layout of layouts) {
      let score = 0;
      const placed = [];
      for (const { info, angle } of layout) {
        const x = center.x + Math.cos(angle) * info.targetLength;
        const y = center.y + Math.sin(angle) * info.targetLength;
        placed.push({ info, x, y });
        score += (x - info.atom.x) ** 2 + (y - info.atom.y) ** 2;
      }
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

    const heavyNeighbors = center.getNeighbors(mol)
      .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    if (heavyNeighbors.length !== 3) {
      continue;
    }

    const infos = heavyNeighbors.map(nb => {
      const bond = mol.getBond(center.id, nb.id);
      const reactant = mol.__reactionPreview.reactantAtomIds.has(sourceAtomId(nb.id))
        ? mol.atoms.get(sourceAtomId(nb.id))
        : null;
      return {
        atom: nb,
        order: bond?.properties.order ?? 1,
        scaffold: mappedAtomReaction2dScaffoldCompatible(reactant, nb, mol, componentAtomIds),
        targetLength: scaledReaction2dBondLength(bond?.properties.order ?? 1, bondLength)
      };
    });
    if (!infos.some(info => info.order >= 2)) {
      continue;
    }

    const scaffoldAnchors = infos.filter(info => info.scaffold);
    if (scaffoldAnchors.length === 1) {
      const anchor = scaffoldAnchors[0];
      const moving = infos.filter(info => info !== anchor);
      if (moving.length !== 2) {
        continue;
      }
      const baseAngle = Math.atan2(anchor.atom.y - center.y, anchor.atom.x - center.x);
      const candidateLayouts = [
        [baseAngle + (2 * Math.PI / 3), baseAngle - (2 * Math.PI / 3)],
        [baseAngle - (2 * Math.PI / 3), baseAngle + (2 * Math.PI / 3)]
      ];
      let best = null;
      for (const angles of candidateLayouts) {
        let score = 0;
        const placed = [];
        for (let i = 0; i < moving.length; i++) {
          const info = moving[i];
          const angle = angles[i];
          const x = center.x + Math.cos(angle) * info.targetLength;
          const y = center.y + Math.sin(angle) * info.targetLength;
          placed.push({ info, x, y });
          score += (x - info.atom.x) ** 2 + (y - info.atom.y) ** 2;
        }
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
      continue;
    }

    if (scaffoldAnchors.length >= 2) {
      const moving = infos.filter(info => !info.scaffold);
      if (moving.length !== 1) {
        continue;
      }
      let vx = 0;
      let vy = 0;
      for (const info of scaffoldAnchors) {
        const dx = info.atom.x - center.x;
        const dy = info.atom.y - center.y;
        const len = Math.hypot(dx, dy) || 1;
        vx -= dx / len;
        vy -= dy / len;
      }
      const vlen = Math.hypot(vx, vy);
      if (vlen >= 1e-6) {
        moving[0].atom.x = center.x + (vx / vlen) * moving[0].targetLength;
        moving[0].atom.y = center.y + (vy / vlen) * moving[0].targetLength;
      }
    }
  }
}

function preserveReaction2dStereoDisplay(mol, previewState, componentAtomIds) {
  if (!mol) {
    return;
  }
  const resolved = previewState.forcedStereoByCenter instanceof Map
    ? previewState.forcedStereoByCenter
    : new Map();
  const resolvedBondTypes = previewState.forcedStereoBondTypes instanceof Map
    ? previewState.forcedStereoBondTypes
    : new Map();
  const resolvedBondCenters = previewState.forcedStereoBondCenters instanceof Map
    ? previewState.forcedStereoBondCenters
    : new Map();

  const ensureDisplayedStereo = (centerId, bond, desiredType) => {
    if (!bond || !centerId || !desiredType) {
      return;
    }
    const center = mol.atoms.get(centerId);
    if (!center) {
      return;
    }
    const current = stereoBondTypeForCenter(mol, centerId, bond.id);
    if (current && current.type === desiredType) {
      return;
    }
    const currentChirality = center.getChirality();
    if (currentChirality === 'R' || currentChirality === 'S') {
      center.setChirality(currentChirality === 'R' ? 'S' : 'R');
      const flipped = stereoBondTypeForCenter(mol, centerId, bond.id);
      if (!flipped || flipped.type !== desiredType) {
        center.setChirality(currentChirality);
      }
    }
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
    const reactantCenter = mol.__reactionPreview.reactantAtomIds.has(sourceAtomId(centerId))
      ? mol.atoms.get(sourceAtomId(centerId))
      : null;
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

export function alignReaction2dProductOrientation(mol, previewState, bondLength = 1.5) {
  if (!previewState?.mappedAtomPairs?.length) {
    return;
  }
  mol.__reactionPreview = previewState;

  for (const componentAtomIds of previewState.productComponentAtomIdSets ?? []) {
    const pairs = previewState.mappedAtomPairs
      .filter(([, productId]) => componentAtomIds.has(productId))
      .map(([reactantId, productId]) => [mol.atoms.get(reactantId), mol.atoms.get(productId)])
      .filter(([reactant, product]) => reactant?.x != null && product?.x != null);
    if (pairs.length === 0) {
      continue;
    }

    const productIdBySourceId = new Map(
      pairs.map(([reactant, product]) => [reactant.id, product.id])
    );
    let mappedConnectivityChanged = false;
    const sourceIds = [...productIdBySourceId.keys()]
      .filter(atomId => mol.atoms.get(atomId)?.name !== 'H');
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

    let reactantCx = 0, reactantCy = 0, productCx = 0, productCy = 0;
    for (const [reactant, product] of pairs) {
      reactantCx += reactant.x; reactantCy += reactant.y;
      productCx += product.x; productCy += product.y;
    }
    reactantCx /= pairs.length; reactantCy /= pairs.length;
    productCx /= pairs.length; productCy /= pairs.length;

    const anchoredPairs = pairs.filter(([reactant, product]) =>
      mappedAtomReaction2dLocallyAnchored(reactant, product, mol, componentAtomIds)
    );
    const fittingPairs = anchoredPairs.length > 0 ? anchoredPairs : pairs;
    if (anchoredPairs.length > 0) {
      reactantCx = 0; reactantCy = 0; productCx = 0; productCy = 0;
      for (const [reactant, product] of fittingPairs) {
        reactantCx += reactant.x; reactantCy += reactant.y;
        productCx += product.x; productCy += product.y;
      }
      reactantCx /= fittingPairs.length; reactantCy /= fittingPairs.length;
      productCx /= fittingPairs.length; productCy /= fittingPairs.length;
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
    const scaffoldPairs = pairs.filter(([reactant, product]) =>
      mappedAtomReaction2dScaffoldCompatible(reactant, product, mol, componentAtomIds)
    );
    const mappedHeavyPairs = pairs.filter(([reactant, product]) =>
      reactant.name !== 'H' && product.name !== 'H'
    );
    const componentHeavyAtomCount = [...componentAtomIds]
      .map(atomId => mol.atoms.get(atomId))
      .filter(atom => atom && atom.name !== 'H')
      .length;
    const canSeedHeavyScaffold =
      mappedHeavyPairs.length >= 3 &&
      mappedHeavyPairs.length === componentHeavyAtomCount &&
      !mappedConnectivityChanged;
    if (canSeedHeavyScaffold) {
      const beforeSnapshot = snapshotReaction2dCoords(mol, componentAtomIds);
      for (const [reactant, product] of mappedHeavyPairs) {
        product.x = reactant.x;
        product.y = reactant.y;
      }
      const seededStats = reaction2dHeavyGeometryStats(mol, componentAtomIds);
      if (
        seededStats.maxBond > bondLength * 1.85 ||
        seededStats.minNonbonded < bondLength * 0.55
      ) {
        restoreReaction2dCoords(mol, beforeSnapshot);
      }
    }
    const exactSnapPairs =
      scaffoldPairs.length >= 3
        ? scaffoldPairs
        : (anchoredPairs.length >= 3 ? anchoredPairs : []);
    if (!canSeedHeavyScaffold && exactSnapPairs.length >= 3 && !mappedConnectivityChanged) {
      const beforeSnapshot = snapshotReaction2dCoords(mol, componentAtomIds);
      for (const [reactant, product] of exactSnapPairs) {
        product.x = reactant.x;
        product.y = reactant.y;
      }
      const snappedStats = reaction2dHeavyGeometryStats(mol, componentAtomIds);
      if (
        snappedStats.maxBond > bondLength * 1.85 ||
        snappedStats.minNonbonded < bondLength * 0.55
      ) {
        restoreReaction2dCoords(mol, beforeSnapshot);
      }
    }
    idealizeReaction2dEditedCenters(mol, componentAtomIds, bondLength);
    preserveReaction2dEditedSingleBondTermini(mol, componentAtomIds, bondLength);
    idealizeReaction2dEditedMultipleBondTermini(mol, componentAtomIds, bondLength);
    idealizeReaction2dTrigonalCenters(mol, componentAtomIds, bondLength);
    repositionReaction2dPeripheralAtoms(mol, componentAtomIds, bondLength);
    finalizeReaction2dEditedCarbonylCenters(mol, componentAtomIds, bondLength);
    finalizeReaction2dTwoNeighborCarbonylCenters(mol, componentAtomIds, bondLength);
    preserveReaction2dStereoDisplay(mol, previewState, componentAtomIds);
  }
}

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
