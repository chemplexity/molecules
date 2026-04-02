/** @module smirks/apply */

import { refreshAromaticity } from '../algorithms/aromaticity.js';
import { kekulize } from '../layout/mol2d-helpers.js';
import { generateCoords } from '../layout/coords2d.js';
import { _findSMARTSParsed } from '../smarts/search.js';
import { parseSMIRKS } from './parser.js';

function _mappingEquals(a, b) {
  if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) {
    return false;
  }
  for (const [key, value] of a) {
    if (b.get(key) !== value) {
      return false;
    }
  }
  return true;
}

function _validateParsedTransform(transform) {
  if (!transform || typeof transform !== 'object') {
    throw new TypeError('applySMIRKS: expected a parsed SMIRKS transform object');
  }
  if (!transform.reactant || !transform.product || !(transform.reactantMaps instanceof Map) || !(transform.productMaps instanceof Map)) {
    throw new TypeError('applySMIRKS: parsed transform is missing reactant/product graphs or map tables');
  }
}

function _validateMode(options) {
  const mode = options.mode ?? 'first';
  if (mode !== 'first' && mode !== 'all') {
    throw new Error(`applySMIRKS: unsupported mode '${mode}', expected 'first' or 'all'`);
  }
  if (options.mapping !== undefined && mode !== 'first') {
    throw new Error("applySMIRKS: explicit mapping can only be used with mode 'first'");
  }
  return mode;
}

function _validateExplicitMapping(molecule, transform, mapping, options) {
  if (!(mapping instanceof Map)) {
    throw new TypeError('applySMIRKS: options.mapping must be a Map<reactantAtomId,targetAtomId>');
  }

  const reactantAtomIds = [...transform.reactant.atoms.keys()];
  if (mapping.size !== reactantAtomIds.length) {
    throw new Error(`applySMIRKS: explicit mapping must bind all ${reactantAtomIds.length} reactant atoms`);
  }

  const seenTargets = new Set();
  for (const reactantAtomId of reactantAtomIds) {
    if (!mapping.has(reactantAtomId)) {
      throw new Error(`applySMIRKS: explicit mapping is missing reactant atom '${reactantAtomId}'`);
    }
    const targetAtomId = mapping.get(reactantAtomId);
    if (!molecule.atoms.has(targetAtomId)) {
      throw new Error(`applySMIRKS: explicit mapping target atom '${targetAtomId}' does not exist in the molecule`);
    }
    if (seenTargets.has(targetAtomId)) {
      throw new Error(`applySMIRKS: explicit mapping reuses target atom '${targetAtomId}'`);
    }
    seenTargets.add(targetAtomId);
  }

  for (const key of mapping.keys()) {
    if (!transform.reactant.atoms.has(key)) {
      throw new Error(`applySMIRKS: explicit mapping contains unknown reactant atom '${key}'`);
    }
  }

  for (const candidate of _findSMARTSParsed(molecule, transform.reactant, options, { dedupe: false })) {
    if (_mappingEquals(candidate, mapping)) {
      return;
    }
  }
  throw new Error('applySMIRKS: explicit mapping does not satisfy the reactant SMARTS pattern');
}

function _mappingTargetIds(mapping) {
  return new Set(mapping.values());
}

function _mappingsOverlap(a, b) {
  const idsA = _mappingTargetIds(a);
  for (const targetId of b.values()) {
    if (idsA.has(targetId)) {
      return true;
    }
  }
  return false;
}

function _reactantMapToTarget(reactant, mapping) {
  const mapToTargetId = new Map();
  for (const qAtom of reactant.atoms.values()) {
    const atomMap = qAtom.getAtomMap();
    if (atomMap == null) {
      continue;
    }
    const targetId = mapping.get(qAtom.id);
    if (!targetId) {
      throw new Error(`applySMIRKS: mapped reactant atom ${qAtom.id} was not bound in the match`);
    }
    mapToTargetId.set(atomMap, targetId);
  }
  return mapToTargetId;
}

function _templateFlags(templateAtom) {
  return templateAtom.properties.reaction?.template ?? {};
}

function _pendantHydrogenIds(mol, atomId) {
  const atom = mol.atoms.get(atomId);
  if (!atom) {
    return [];
  }
  const hydrogenIds = [];
  for (const bondId of atom.bonds) {
    const bond = mol.bonds.get(bondId);
    if (!bond) {
      continue;
    }
    const otherId = bond.getOtherAtom(atomId);
    const other = mol.atoms.get(otherId);
    if (other?.name === 'H' && other.bonds.length === 1) {
      hydrogenIds.push(otherId);
    }
  }
  return hydrogenIds;
}

function _setExplicitHydrogenCount(mol, atomId, hydrogenCount) {
  const atom = mol.atoms.get(atomId);
  if (!atom) {
    return false;
  }

  const existingHydrogenIds = _pendantHydrogenIds(mol, atomId);
  const changed = existingHydrogenIds.length !== hydrogenCount;
  if (!changed) {
    return false;
  }

  for (const hydrogenId of existingHydrogenIds) {
    _removeBondKeepAtoms(mol, mol.atoms.get(hydrogenId)?.bonds[0]);
    mol.atoms.delete(hydrogenId);
  }

  for (let i = 0; i < hydrogenCount; i++) {
    const hydrogen = mol.addAtom(null, 'H');
    hydrogen.visible = atom.name === 'H';
    if (atom.x != null && atom.y != null) {
      hydrogen.x = atom.x;
      hydrogen.y = atom.y;
      hydrogen.z = atom.z;
    }
    mol.addBond(null, atomId, hydrogen.id, { order: 1 }, false);
  }

  return true;
}

function _applyTemplateAtomState(targetAtom, templateAtom) {
  const flags = _templateFlags(templateAtom);
  let stateChanged = false;
  let topologyChanged = false;

  if (targetAtom.name !== templateAtom.name) {
    targetAtom.name = templateAtom.name;
    targetAtom.resolveElement();
    stateChanged = true;
    topologyChanged = true;
  }
  if (targetAtom.isAromatic() !== templateAtom.isAromatic()) {
    targetAtom.setAromatic(templateAtom.isAromatic());
    stateChanged = true;
    topologyChanged = true;
  }
  if (flags.chargeSpecified && targetAtom.getCharge() !== templateAtom.getCharge()) {
    targetAtom.setCharge(templateAtom.getCharge());
    stateChanged = true;
  }
  if (flags.radicalSpecified && targetAtom.getRadical() !== templateAtom.getRadical()) {
    targetAtom.setRadical(templateAtom.getRadical());
    stateChanged = true;
  }
  if (stateChanged) {
    targetAtom.setHybridization(null);
  }

  return { stateChanged, topologyChanged };
}

function _setBondState(bond, templateBond) {
  const before = {
    order: bond.properties.order ?? 1,
    aromatic: bond.properties.aromatic ?? false,
    stereo: bond.properties.stereo ?? null
  };
  if (templateBond.properties.aromatic ?? false) {
    bond.setAromatic(true);
  } else {
    bond.setOrder(templateBond.properties.order ?? 1);
  }
  const topologyChanged = before.order !== (bond.properties.order ?? 1) || before.aromatic !== (bond.properties.aromatic ?? false);
  const explicitStereo = templateBond.properties.stereo ?? null;
  if (explicitStereo != null) {
    bond.setStereo(explicitStereo);
  } else if (topologyChanged && before.stereo != null) {
    bond.setStereo(null);
  }
  delete bond.properties.localizedOrder;
  return {
    topologyChanged,
    stereoChanged: before.stereo !== (bond.properties.stereo ?? null)
  };
}

function _pairKey(a, b) {
  return a < b ? `${a},${b}` : `${b},${a}`;
}

function _affectedNeighborhood(mol, atomIds) {
  const affected = new Set();
  for (const atomId of atomIds) {
    const atom = mol.atoms.get(atomId);
    if (!atom) {
      continue;
    }
    affected.add(atomId);
    for (const neighbor of atom.getNeighbors(mol)) {
      affected.add(neighbor.id);
    }
  }
  return affected;
}

function _removeBondKeepAtoms(mol, bondId) {
  const bond = mol.bonds.get(bondId);
  if (!bond) {
    return;
  }
  for (const atomId of bond.atoms) {
    const atom = mol.atoms.get(atomId);
    if (atom) {
      atom.bonds = atom.bonds.filter(id => id !== bondId);
    }
  }
  const [a, b] = bond.atoms;
  mol._bondIndex.delete(a < b ? `${a},${b}` : `${b},${a}`);
  mol._ringsCache = null;
  mol.bonds.delete(bondId);
}

function _has2dCoords(mol) {
  return [...mol.atoms.values()].some(atom => Number.isFinite(atom.x) && Number.isFinite(atom.y));
}

function _applyParsedSMIRKSMatch(molecule, transform, match) {
  const hadCoords = _has2dCoords(molecule);
  const result = molecule.clone();
  const repairSeedIds = new Set();
  const stereoDirtySeedIds = new Set();
  const explicitHydrogenSpecs = new Map();
  const explicitAtomStereoSpecs = new Map();
  const explicitBondStereoSpecs = new Map();
  const mapToTargetId = _reactantMapToTarget(transform.reactant, match);

  const keptTargetIds = new Set();
  for (const atomMap of transform.productMaps.keys()) {
    keptTargetIds.add(mapToTargetId.get(atomMap));
  }

  const productAtomToTargetId = new Map();
  for (const pAtom of transform.product.atoms.values()) {
    const atomMap = pAtom.getAtomMap();
    const flags = _templateFlags(pAtom);
    if (atomMap != null) {
      const targetId = mapToTargetId.get(atomMap);
      const targetAtom = result.atoms.get(targetId);
      if (!targetAtom) {
        throw new Error(`applySMIRKS: target atom for map :${atomMap} is missing`);
      }
      const { stateChanged, topologyChanged } = _applyTemplateAtomState(targetAtom, pAtom);
      if (stateChanged) {
        repairSeedIds.add(targetId);
      }
      if (topologyChanged) {
        stereoDirtySeedIds.add(targetId);
        for (const neighbor of targetAtom.getNeighbors(result)) {
          stereoDirtySeedIds.add(neighbor.id);
        }
      }
      if (flags.hydrogenCountSpecified) {
        explicitHydrogenSpecs.set(targetId, flags.hydrogenCount);
      }
      if (flags.chiralitySpecified) {
        explicitAtomStereoSpecs.set(targetId, pAtom.getChirality());
        stereoDirtySeedIds.add(targetId);
      }
      productAtomToTargetId.set(pAtom.id, targetId);
      continue;
    }

    const created = result.addAtom(null, pAtom.name, { aromatic: pAtom.isAromatic() });
    created.resolveElement();
    created.setCharge(pAtom.getCharge());
    created.setAromatic(pAtom.isAromatic());
    created.setRadical(pAtom.getRadical());
    created.setChirality(pAtom.getChirality());
    created.setHybridization(null);
    productAtomToTargetId.set(pAtom.id, created.id);
    stereoDirtySeedIds.add(created.id);
    if (flags.hydrogenCountSpecified) {
      explicitHydrogenSpecs.set(created.id, flags.hydrogenCount);
    } else {
      repairSeedIds.add(created.id);
    }
    if (flags.chiralitySpecified) {
      explicitAtomStereoSpecs.set(created.id, pAtom.getChirality());
    }
  }

  for (const qAtom of transform.reactant.atoms.values()) {
    const targetId = match.get(qAtom.id);
    if (!targetId || keptTargetIds.has(targetId)) {
      continue;
    }
    const targetAtom = result.atoms.get(targetId);
    if (targetAtom) {
      for (const neighbor of targetAtom.getNeighbors(result)) {
        repairSeedIds.add(neighbor.id);
        stereoDirtySeedIds.add(neighbor.id);
      }
    }
    result.removeAtom(targetId);
  }

  const productBondPairs = new Set();
  for (const pBond of transform.product.bonds.values()) {
    const tA = productAtomToTargetId.get(pBond.atoms[0]);
    const tB = productAtomToTargetId.get(pBond.atoms[1]);
    productBondPairs.add(_pairKey(tA, tB));

    const existing = result.getBond(tA, tB);
    if (existing) {
      const { topologyChanged, stereoChanged } = _setBondState(existing, pBond);
      if (topologyChanged) {
        repairSeedIds.add(tA);
        repairSeedIds.add(tB);
        stereoDirtySeedIds.add(tA);
        stereoDirtySeedIds.add(tB);
      }
      if (stereoChanged || pBond.getStereo()) {
        stereoDirtySeedIds.add(tA);
        stereoDirtySeedIds.add(tB);
      }
      if (pBond.getStereo()) {
        explicitBondStereoSpecs.set(existing.id, pBond.getStereo());
      }
    } else {
      const newBond = result.addBond(null, tA, tB, {}, false);
      _setBondState(newBond, pBond);
      repairSeedIds.add(tA);
      repairSeedIds.add(tB);
      stereoDirtySeedIds.add(tA);
      stereoDirtySeedIds.add(tB);
      if (pBond.getStereo()) {
        explicitBondStereoSpecs.set(newBond.id, pBond.getStereo());
      }
    }
  }

  for (const qBond of transform.reactant.bonds.values()) {
    const [qA, qB] = qBond.atoms;
    const qAtomA = transform.reactant.atoms.get(qA);
    const qAtomB = transform.reactant.atoms.get(qB);
    const mapA = qAtomA?.getAtomMap() ?? null;
    const mapB = qAtomB?.getAtomMap() ?? null;
    if (mapA == null || mapB == null) {
      continue;
    }
    if (!transform.productMaps.has(mapA) || !transform.productMaps.has(mapB)) {
      continue;
    }

    const tA = mapToTargetId.get(mapA);
    const tB = mapToTargetId.get(mapB);
    if (!tA || !tB) {
      continue;
    }
    if (productBondPairs.has(_pairKey(tA, tB))) {
      continue;
    }

    const existing = result.getBond(tA, tB);
    if (existing) {
      _removeBondKeepAtoms(result, existing.id);
      repairSeedIds.add(tA);
      repairSeedIds.add(tB);
      stereoDirtySeedIds.add(tA);
      stereoDirtySeedIds.add(tB);
    }
  }

  for (const [targetId, hydrogenCount] of explicitHydrogenSpecs) {
    if (_setExplicitHydrogenCount(result, targetId, hydrogenCount)) {
      stereoDirtySeedIds.add(targetId);
    }
    repairSeedIds.delete(targetId);
  }

  if (stereoDirtySeedIds.size > 0) {
    result.clearStereoAnnotations(stereoDirtySeedIds);
  }
  kekulize(result);
  refreshAromaticity(result, { preserveKekule: true });
  if (repairSeedIds.size > 0) {
    const repairAtomIds = _affectedNeighborhood(result, repairSeedIds);
    for (const targetId of explicitHydrogenSpecs.keys()) {
      repairAtomIds.delete(targetId);
    }
    if (repairAtomIds.size > 0) {
      result.repairImplicitHydrogens(repairAtomIds);
    }
  }
  for (const [bondId, stereo] of explicitBondStereoSpecs) {
    const bond = result.bonds.get(bondId);
    if (bond) {
      bond.setStereo(stereo);
    }
  }
  for (const [atomId, chirality] of explicitAtomStereoSpecs) {
    const atom = result.atoms.get(atomId);
    if (atom && chirality) {
      atom.setChirality(chirality, result);
    }
  }

  if (hadCoords) {
    generateCoords(result);
  }

  result._recomputeProperties();
  return result;
}

function _applyParsedSMIRKS(molecule, transform, options = {}) {
  _validateParsedTransform(transform);
  const mode = _validateMode(options);

  if (options.mapping !== undefined) {
    _validateExplicitMapping(molecule, transform, options.mapping, options);
  }

  if (mode === 'first') {
    const match =
      options.mapping ??
      (() => {
        for (const mapping of _findSMARTSParsed(molecule, transform.reactant, options, { dedupe: false })) {
          return mapping;
        }
        return null;
      })();

    if (!match) {
      return null;
    }
    return _applyParsedSMIRKSMatch(molecule, transform, match);
  }

  const mappings = [..._findSMARTSParsed(molecule, transform.reactant, options, { dedupe: false })];
  if (mappings.length === 0) {
    return null;
  }

  let result = molecule;
  const acceptedMappings = [];
  for (const mapping of mappings) {
    if (acceptedMappings.some(prev => _mappingsOverlap(prev, mapping))) {
      continue;
    }
    // A previous transform may have removed atoms that this match targets.
    // Skip rather than crash or apply to a stale site.
    if ([...mapping.values()].some(targetId => !result.atoms.has(targetId))) {
      continue;
    }
    result = _applyParsedSMIRKSMatch(result, transform, mapping);
    acceptedMappings.push(mapping);
  }

  return acceptedMappings.length > 0 ? result : null;
}

export function applySMIRKS(molecule, smirks, options = {}) {
  const transform = typeof smirks === 'string' ? parseSMIRKS(smirks) : smirks;
  return _applyParsedSMIRKS(molecule, transform, options);
}

export { _applyParsedSMIRKS };
