/** @module layout/coords2d/neighbor-ordering */

import { morganRanks } from '../../algorithms/morgan.js';

const _layoutNeighborCache = new WeakMap();
const _layoutRankCache = new WeakMap();

export function _layoutCompareAtomIds(molecule, aId, bId) {
  const ranks = _layoutRankCache.get(molecule);
  const a = molecule.atoms.get(aId);
  const b = molecule.atoms.get(bId);
  const aIsH = a?.name === 'H' ? 1 : 0;
  const bIsH = b?.name === 'H' ? 1 : 0;
  if (aIsH !== bIsH) {
    return aIsH - bIsH;
  }

  const aRank = ranks?.get(aId);
  const bRank = ranks?.get(bId);
  if (aRank != null && bRank != null && aRank !== bRank) {
    return aRank - bRank;
  }
  if (aRank != null && bRank == null) {
    return -1;
  }
  if (aRank == null && bRank != null) {
    return 1;
  }

  const aAtomic = a?.properties.protons ?? 0;
  const bAtomic = b?.properties.protons ?? 0;
  if (aAtomic !== bAtomic) {
    return aAtomic - bAtomic;
  }

  const aCharge = a?.getCharge() ?? 0;
  const bCharge = b?.getCharge() ?? 0;
  if (aCharge !== bCharge) {
    return aCharge - bCharge;
  }

  return aId.localeCompare(bId);
}

export function _buildLayoutNeighborCache(molecule) {
  const ranks = morganRanks(molecule);
  _layoutRankCache.set(molecule, ranks);

  const neighborMap = new Map();
  for (const atomId of molecule.atoms.keys()) {
    const ordered = molecule
      .getNeighbors(atomId)
      .slice()
      .sort((aId, bId) => _layoutCompareAtomIds(molecule, aId, bId));
    neighborMap.set(atomId, ordered);
  }
  _layoutNeighborCache.set(molecule, neighborMap);
  return neighborMap;
}

export function _layoutNeighbors(molecule, atomId) {
  return _layoutNeighborCache.get(molecule)?.get(atomId) ?? molecule.getNeighbors(atomId);
}
