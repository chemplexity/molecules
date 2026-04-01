/** @module app/render/reaction-2d */

import { Molecule } from '../../core/Molecule.js';
import { findSMARTS, parseSMARTS, functionalGroups } from '../../smarts/index.js';
import { reactionTemplates } from '../../smirks/index.js';
import {
  buildReaction2dMol as buildReaction2dMolShared,
  alignReaction2dProductOrientation as alignReaction2dProductOrientationShared,
  spreadReaction2dProductComponents as spreadReaction2dProductComponentsShared,
  centerReaction2dPairCoords as centerReaction2dPairCoordsShared
} from '../../layout/reaction2d.js';
import { atomRadius } from './helpers.js';

let ctx = {};

export function initReaction2d(context) {
  ctx = context;
}

// ---------------------------------------------------------------------------
// Functional-group SMARTS panel
// ---------------------------------------------------------------------------
/** Apply (or clear) a highlight from a list of SMARTS mappings and redraw. */
export function _setHighlight(mappings, options = {}) {
  _highlightedAtomIds.clear();
  _highlightedAtomSets = [];
  _highlightStyle = options.style ?? 'default';
  if (mappings) {
    for (const mapping of mappings) {
      const atomSet = new Set(mapping.values());
      // Include explicit H atoms bonded to any matched atom
      if (_highlightMol) {
        for (const atomId of [...atomSet]) {
          for (const nb of (_highlightMol.atoms.get(atomId)?.getNeighbors(_highlightMol) ?? [])) {
            if (nb.name === 'H') {
              atomSet.add(nb.id);
            }
          }
        }
      }
      for (const atomId of atomSet) {
        _highlightedAtomIds.add(atomId);
      }
      _highlightedAtomSets.push(atomSet);
    }
  }
  if (ctx.mode === '2d' && ctx._mol2d) {
    ctx.draw2d();
  } else {
    ctx.applyForceHighlights();
  }
}

export const HIGHLIGHT_STYLES = {
  default: {
    fill: 'rgb(130, 210, 80)',
    outline: 'rgb(70, 140, 40)'
  },
  physchem: {
    fill: 'rgb(246, 227, 110)',
    outline: 'rgb(194, 168, 24)'
  }
};
let _highlightStyle = 'default';

const FUNCTIONAL_GROUP_EXPORT_HOVER_GRACE_MS = 1500;
let _lastHoveredFunctionalGroupMappings = null;
let _lastHoveredFunctionalGroupAt = 0;
let _preserveFunctionalGroupHighlightUntil = 0;

const _highlightedAtomIds  = new Set();
let _highlightedAtomSets = []; // one Set<atomId> per SMARTS match instance
let _highlightMol        = null; // molecule used for last updateFunctionalGroups call

function _rememberHoveredFunctionalGroupMappings(mappings) {
  if (!mappings?.length) {
    _lastHoveredFunctionalGroupMappings = null;
    _lastHoveredFunctionalGroupAt = 0;
    return;
  }
  _lastHoveredFunctionalGroupMappings = mappings.map(mapping => new Map(mapping));
  _lastHoveredFunctionalGroupAt = Date.now();
}

export function _prepare2dExportHighlightState() {
  if (_highlightedAtomSets.length > 0) {
    return () => {};
  }
  if (!_highlightMol || !_lastHoveredFunctionalGroupMappings?.length) {
    return () => {};
  }
  if (Date.now() - _lastHoveredFunctionalGroupAt > FUNCTIONAL_GROUP_EXPORT_HOVER_GRACE_MS) {
    return () => {};
  }
  _setHighlight(_lastHoveredFunctionalGroupMappings.map(mapping => new Map(mapping)));
  return () => {};
}

export function _restoreRecentFunctionalGroupHighlight() {
  if (_highlightedAtomSets.length > 0) {
    return false;
  }
  if (!_highlightMol || !_lastHoveredFunctionalGroupMappings?.length) {
    return false;
  }
  if (Date.now() - _lastHoveredFunctionalGroupAt > FUNCTIONAL_GROUP_EXPORT_HOVER_GRACE_MS) {
    return false;
  }
  _preserveFunctionalGroupHighlightUntil = Date.now() + FUNCTIONAL_GROUP_EXPORT_HOVER_GRACE_MS;
  _setHighlight(_lastHoveredFunctionalGroupMappings.map(mapping => new Map(mapping)));
  return true;
}

export function _restorePersistentHighlight() {
  const activeFgRow = document.querySelector('#fg-body tr.fg-active');
  if (activeFgRow?._fgMappings?.length) {
    _setHighlight(activeFgRow._fgMappings);
    return true;
  }
  if (_reactionPreviewLocked && _reactionPreviewHighlightMappings?.length) {
    _setHighlight(_reactionPreviewHighlightMappings.map(mapping => new Map(mapping)));
    return true;
  }
  _setHighlight(null);
  return false;
}

/** Returns true if id1 and id2 belong to the same SMARTS match instance. */
export function _isBondHighlighted(id1, id2) {
  for (const set of _highlightedAtomSets) {
    if (set.has(id1) && set.has(id2)) {
      return true;
    }
  }
  return false;
}

const _functionalGroupAnchorCache = new Map();
let _reactionPreviewSourceMol = null;
let _activeReactionSmirks = null;
let _activeReactionMatchIndex = 0;
let _reactionPreviewLocked = false;
let _reactionPreviewReactantAtomIds = new Set();
let _reactionPreviewProductAtomIds = new Set();
let _reactionPreviewProductComponentAtomIdSets = [];
let _reactionPreviewMappedAtomPairs = [];
let _reactionPreviewEditedProductAtomIds = new Set();
let _reactionPreviewPreservedReactantStereoByCenter = new Map();
let _reactionPreviewPreservedReactantStereoBondTypes = new Map();
let _reactionPreviewPreservedProductStereoByCenter = new Map();
let _reactionPreviewPreservedProductStereoBondTypes = new Map();
let _reactionPreviewForcedStereoByCenter = new Map();
let _reactionPreviewForcedStereoBondTypes = new Map();
let _reactionPreviewForcedStereoBondCenters = new Map();
let _reactionPreviewReactantReferenceCoords = new Map();
let _reactionPreviewHighlightMappings = null;

export function _hasReactionPreview() {
  return _reactionPreviewReactantAtomIds.size > 0 && _reactionPreviewProductAtomIds.size > 0;
}

export function _plotOverlayFitPadding(basePad = 40) {
  const pads = { left: basePad, right: basePad, top: basePad, bottom: basePad };
  const reactionPreview = _hasReactionPreview();
  const plotRect = ctx.plotEl.getBoundingClientRect();
  const visibleRect = id => {
    const el = document.getElementById(id);
    if (!el) {
      return null;
    }
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return null;
    }
    const rect = el.getBoundingClientRect();
    return (rect.width > 0 && rect.height > 0) ? rect : null;
  };
  for (const id of ['draw-tools']) {
    const rect = visibleRect(id);
    if (!rect) {
      continue;
    }
    pads.left = Math.max(
      pads.left,
      rect.right - plotRect.left + (reactionPreview ? 22 : 16)
    );
  }
  for (const id of ['atom-selector', 'toggle-controls', 'undo-controls', 'rotate-controls', 'force-controls']) {
    const rect = visibleRect(id);
    if (!rect) {
      continue;
    }
    const needed = plotRect.right - rect.left + 6;
    const capped = reactionPreview ? Math.min(needed, Math.max(basePad, 82)) : needed;
    pads.right = Math.max(pads.right, capped);
  }
  for (const id of ['clean-controls', 'rotate-controls', 'force-controls']) {
    const rect = visibleRect(id);
    if (!rect) {
      continue;
    }
    pads.bottom = Math.max(pads.bottom, plotRect.bottom - rect.top + 6);
  }
  return pads;
}

export function _viewportFitPadding(basePad = 40) {
  const pads = _plotOverlayFitPadding(basePad);
  return pads;
}

export function _clearReactionPreviewState() {
  _reactionPreviewSourceMol = null;
  _activeReactionSmirks = null;
  _activeReactionMatchIndex = 0;
  _reactionPreviewLocked = false;
  _reactionPreviewReactantAtomIds = new Set();
  _reactionPreviewProductAtomIds = new Set();
  _reactionPreviewProductComponentAtomIdSets = [];
  _reactionPreviewMappedAtomPairs = [];
  _reactionPreviewEditedProductAtomIds = new Set();
  _reactionPreviewPreservedReactantStereoByCenter = new Map();
  _reactionPreviewPreservedReactantStereoBondTypes = new Map();
  _reactionPreviewPreservedProductStereoByCenter = new Map();
  _reactionPreviewPreservedProductStereoBondTypes = new Map();
  _reactionPreviewForcedStereoByCenter = new Map();
  _reactionPreviewForcedStereoBondTypes = new Map();
  _reactionPreviewForcedStereoBondCenters = new Map();
  _reactionPreviewReactantReferenceCoords = new Map();
  _reactionPreviewHighlightMappings = null;
}

function _serializeSnapshotMol(mol) {
  if (!mol) {
    return null;
  }
  const atoms = [];
  for (const [id, atom] of mol.atoms) {
    atoms.push({
      id,
      name: atom.name,
      x: atom.x,
      y: atom.y,
      visible: atom.visible,
      properties: JSON.parse(JSON.stringify(atom.properties))
    });
  }
  const bonds = [];
  for (const [id, bond] of mol.bonds) {
    bonds.push({
      id,
      atoms: [...bond.atoms],
      properties: JSON.parse(JSON.stringify(bond.properties))
    });
  }
  return { atoms, bonds };
}

function _deserializeSnapshotMol(data) {
  if (!data) {
    return null;
  }
  const mol = new Molecule();
  for (const ad of data.atoms ?? []) {
    const atom = mol.addAtom(ad.id, ad.name, { ...ad.properties });
    atom.x = ad.x;
    atom.y = ad.y;
    if (ad.visible !== undefined) {
      atom.visible = ad.visible;
    }
    Object.assign(atom.properties, ad.properties);
  }
  for (const bd of data.bonds ?? []) {
    mol.addBond(bd.id, bd.atoms[0], bd.atoms[1], { ...bd.properties }, false);
    Object.assign(mol.bonds.get(bd.id).properties, bd.properties);
  }
  return mol;
}

export function _captureReactionPreviewSnapshot() {
  if (!_hasReactionPreview() || !_reactionPreviewSourceMol) {
    return null;
  }
  return {
    sourceMol: _serializeSnapshotMol(_reactionPreviewSourceMol),
    activeReactionSmirks: _activeReactionSmirks,
    activeReactionMatchIndex: _activeReactionMatchIndex,
    reactionPreviewLocked: _reactionPreviewLocked,
    reactantAtomIds: [..._reactionPreviewReactantAtomIds],
    productAtomIds: [..._reactionPreviewProductAtomIds],
    productComponentAtomIdSets: (_reactionPreviewProductComponentAtomIdSets ?? []).map(set => [...set]),
    mappedAtomPairs: [...(_reactionPreviewMappedAtomPairs ?? [])],
    editedProductAtomIds: [..._reactionPreviewEditedProductAtomIds],
    preservedReactantStereoByCenter: [..._reactionPreviewPreservedReactantStereoByCenter],
    preservedReactantStereoBondTypes: [..._reactionPreviewPreservedReactantStereoBondTypes],
    preservedProductStereoByCenter: [..._reactionPreviewPreservedProductStereoByCenter],
    preservedProductStereoBondTypes: [..._reactionPreviewPreservedProductStereoBondTypes],
    forcedStereoByCenter: [..._reactionPreviewForcedStereoByCenter],
    forcedStereoBondTypes: [..._reactionPreviewForcedStereoBondTypes],
    forcedStereoBondCenters: [..._reactionPreviewForcedStereoBondCenters],
    reactantReferenceCoords: [..._reactionPreviewReactantReferenceCoords],
    reactionPreviewHighlightMappings: (_reactionPreviewHighlightMappings ?? []).map(mapping => [...mapping])
  };
}

export function _restoreReactionPreviewSnapshot(previewSnap) {
  _clearReactionPreviewState();
  if (!previewSnap) {
    return;
  }
  _reactionPreviewSourceMol = _deserializeSnapshotMol(previewSnap.sourceMol);
  _activeReactionSmirks = previewSnap.activeReactionSmirks ?? null;
  _activeReactionMatchIndex = previewSnap.activeReactionMatchIndex ?? 0;
  _reactionPreviewLocked = !!previewSnap.reactionPreviewLocked;
  _reactionPreviewReactantAtomIds = new Set(previewSnap.reactantAtomIds ?? []);
  _reactionPreviewProductAtomIds = new Set(previewSnap.productAtomIds ?? []);
  _reactionPreviewProductComponentAtomIdSets = (previewSnap.productComponentAtomIdSets ?? []).map(atomIds => new Set(atomIds));
  _reactionPreviewMappedAtomPairs = previewSnap.mappedAtomPairs ?? [];
  _reactionPreviewEditedProductAtomIds = new Set(previewSnap.editedProductAtomIds ?? []);
  _reactionPreviewPreservedReactantStereoByCenter = new Map(previewSnap.preservedReactantStereoByCenter ?? []);
  _reactionPreviewPreservedReactantStereoBondTypes = new Map(previewSnap.preservedReactantStereoBondTypes ?? []);
  _reactionPreviewPreservedProductStereoByCenter = new Map(previewSnap.preservedProductStereoByCenter ?? []);
  _reactionPreviewPreservedProductStereoBondTypes = new Map(previewSnap.preservedProductStereoBondTypes ?? []);
  _reactionPreviewForcedStereoByCenter = new Map(previewSnap.forcedStereoByCenter ?? []);
  _reactionPreviewForcedStereoBondTypes = new Map(previewSnap.forcedStereoBondTypes ?? []);
  _reactionPreviewForcedStereoBondCenters = new Map(previewSnap.forcedStereoBondCenters ?? []);
  _reactionPreviewReactantReferenceCoords = new Map(previewSnap.reactantReferenceCoords ?? []);
  _reactionPreviewHighlightMappings = (previewSnap.reactionPreviewHighlightMappings ?? []).map(mapping => new Map(mapping));
}

function _cloneWithPrefixedIds(mol, prefix) {
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

function _buildReaction2dMol(sourceMol, smirks, mapping = undefined) {
  return buildReaction2dMolShared(sourceMol, smirks, mapping);
}

export function _restoreReactionPreviewSource() {
  if (!_reactionPreviewSourceMol) {
    return false;
  }
  const sourceMol = _reactionPreviewSourceMol.clone();
  _clearReactionPreviewState();
  ctx.renderMol(sourceMol);
  return true;
}

export function _prepareReactionPreviewEditTargets({ atomId = null, snapAtomId = null } = {}) {
  if (!_hasReactionPreview()) {
    return { atomId, snapAtomId, restored: false };
  }
  const reactantAtomIds = _reactionPreviewReactantAtomIds ?? new Set();
  if (atomId !== null && !reactantAtomIds.has(atomId)) {
    return null;
  }
  if (snapAtomId !== null && !reactantAtomIds.has(snapAtomId)) {
    return null;
  }
  const restored = _restoreReactionPreviewSource();
  return { atomId, snapAtomId, restored };
}

export function _prepareReactionPreviewBondEditTarget(bondId) {
  if (!_hasReactionPreview()) {
    return { bondId, restored: false };
  }
  const previewMol = ctx.mode === 'force' ? ctx.currentMol : ctx._mol2d;
  const bond = previewMol?.bonds.get(bondId);
  if (!bond) {
    return null;
  }
  const reactantAtomIds = _reactionPreviewReactantAtomIds ?? new Set();
  if (!bond.atoms.every(atomId => reactantAtomIds.has(atomId))) {
    return null;
  }
  const restored = _restoreReactionPreviewSource();
  return { bondId, restored };
}

function _reaction2dArrowGeometry(items, atomIds, {
  hydrogenRadiusScale = 1,
  radiusForItem = () => 0
} = {}) {
  if (!atomIds?.size) {
    return null;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let count = 0;
  for (const item of items) {
    if (!atomIds.has(item.id)) {
      continue;
    }
    const r = radiusForItem(item) * (item.name === 'H' ? hydrogenRadiusScale : 1);
    if (item.x - r < minX) {
      minX = item.x - r;
    }
    if (item.x + r > maxX) {
      maxX = item.x + r;
    }
    if (item.y - r < minY) {
      minY = item.y - r;
    }
    if (item.y + r > maxY) {
      maxY = item.y + r;
    }
    count++;
  }
  if (count === 0) {
    return null;
  }
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

function _reaction2dArrowGeometryPreferHeavy(items, atomIds, opts = {}) {
  const heavyItems = items.filter(item => atomIds.has(item.id) && item.name !== 'H');
  if (heavyItems.length > 0) {
    return _reaction2dArrowGeometry(heavyItems, atomIds, opts);
  }
  return _reaction2dArrowGeometry(items, atomIds, opts);
}

export function _reaction2dSourceAtomId(productAtomId) {
  return typeof productAtomId === 'string' ? productAtomId.split(':').slice(1).join(':') : productAtomId;
}

export function _reaction2dProductGeometries(items, opts = {}) {
  return (_reactionPreviewProductComponentAtomIdSets ?? [])
    .map(atomIds => _reaction2dArrowGeometryPreferHeavy(items, atomIds, opts))
    .filter(Boolean);
}

export function _reaction2dArrowEndpoints(reactant, product, pad = 0.45) {
  if (!reactant || !product) {
    return null;
  }
  const dx = product.cx - reactant.cx;
  const dy = product.cy - reactant.cy;
  const distance = Math.hypot(dx, dy);
  if (distance < 1e-6) {
    return null;
  }

  const ux = dx / distance;
  const uy = dy / distance;
  const reactantHalfWidth = Math.max(0, (reactant.maxX - reactant.minX) / 2);
  const reactantHalfHeight = Math.max(0, (reactant.maxY - reactant.minY) / 2);
  const productHalfWidth = Math.max(0, (product.maxX - product.minX) / 2);
  const productHalfHeight = Math.max(0, (product.maxY - product.minY) / 2);
  const reactantTx = Math.abs(ux) > 1e-6 ? reactantHalfWidth / Math.abs(ux) : Infinity;
  const reactantTy = Math.abs(uy) > 1e-6 ? reactantHalfHeight / Math.abs(uy) : Infinity;
  const productTx = Math.abs(ux) > 1e-6 ? productHalfWidth / Math.abs(ux) : Infinity;
  const productTy = Math.abs(uy) > 1e-6 ? productHalfHeight / Math.abs(uy) : Infinity;
  const reactantEdge = Math.min(reactantTx, reactantTy);
  const productEdge = Math.min(productTx, productTy);
  if (!Number.isFinite(reactantEdge) || !Number.isFinite(productEdge)) {
    return null;
  }

  const start = {
    x: reactant.cx + ux * (reactantEdge + pad),
    y: reactant.cy + uy * (reactantEdge + pad)
  };
  const end = {
    x: product.cx - ux * (productEdge + pad),
    y: product.cy - uy * (productEdge + pad)
  };
  const edgeDistance = Math.hypot(end.x - start.x, end.y - start.y);
  if (edgeDistance >= 0.35) {
    return { start, end, ux, uy };
  }

  const inset = Math.max(0.12, Math.min(distance * 0.22, Math.max(pad, 0.8)));
  if (distance <= inset * 2 + 1e-6) {
    return null;
  }
  const fallbackStart = {
    x: reactant.cx + ux * inset,
    y: reactant.cy + uy * inset
  };
  const fallbackEnd = {
    x: product.cx - ux * inset,
    y: product.cy - uy * inset
  };
  if (Math.hypot(fallbackEnd.x - fallbackStart.x, fallbackEnd.y - fallbackStart.y) < 0.35) {
    return null;
  }
  return { start: fallbackStart, end: fallbackEnd, ux, uy };
}

export function _centerReaction2dPairCoords(mol, bondLength = 1.5) {
  if (!_hasReactionPreview() || !mol) {
    return;
  }
  centerReaction2dPairCoordsShared(mol, {
    reactantAtomIds: _reactionPreviewReactantAtomIds,
    productAtomIds: _reactionPreviewProductAtomIds,
    productComponentAtomIdSets: _reactionPreviewProductComponentAtomIdSets
  }, bondLength);
}

export function _spreadReaction2dProductComponents(mol, bondLength = 1.5) {
  if (!_hasReactionPreview() || !mol || (_reactionPreviewProductComponentAtomIdSets?.length ?? 0) < 2) {
    return;
  }
  spreadReaction2dProductComponentsShared(mol, {
    productComponentAtomIdSets: _reactionPreviewProductComponentAtomIdSets
  }, bondLength);
}

function _reaction2dMappedAtomLocallyAnchored(reactant, product, mol, componentAtomIds) {
  if (!reactant || !product) {
    return false;
  }
  if (_reactionPreviewEditedProductAtomIds.has(product.id)) {
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
    .filter(nb => _reactionPreviewReactantAtomIds.has(nb.id))
    .map(nb => {
      const bond = mol.getBond(reactant.id, nb.id);
      return `${nb.id}:${bond?.properties.order ?? 1}:${bond?.properties.aromatic ?? false}`;
    })
    .sort();
  const productMappedNeighbors = product.getNeighbors(mol)
    .filter(nb => componentAtomIds.has(nb.id))
    .map(nb => {
      const bond = mol.getBond(product.id, nb.id);
      return `${_reaction2dSourceAtomId(nb.id)}:${bond?.properties.order ?? 1}:${bond?.properties.aromatic ?? false}`;
    })
    .sort();
  return reactantMappedNeighbors.join('|') === productMappedNeighbors.join('|');
}

function _reaction2dMappedAtomScaffoldCompatible(reactant, product, mol, componentAtomIds) {
  if (!reactant || !product) {
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
    .filter(nb => _reactionPreviewReactantAtomIds.has(nb.id))
    .map(nb => nb.id)
    .sort();
  const productMappedNeighbors = product.getNeighbors(mol)
    .filter(nb => componentAtomIds.has(nb.id))
    .map(nb => _reaction2dSourceAtomId(nb.id))
    .sort();

  return reactantMappedNeighbors.join('|') === productMappedNeighbors.join('|');
}

function _scaledReaction2dBondLength(order, bondLength = 1.5) {
  if (order >= 3) {
    return bondLength * 0.78;
  }
  if (order >= 2) {
    return bondLength * 0.86;
  }
  return bondLength;
}

function _idealizeReaction2dEditedCenters(mol, componentAtomIds, bondLength = 1.5) {
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
    if (!_reactionPreviewEditedProductAtomIds.has(centerId)) {
      continue;
    }
    const center = mol.atoms.get(centerId);
    if (!center || center.name === 'H' || center.x == null || center.y == null) {
      continue;
    }

    const sourceCenterId = _reaction2dSourceAtomId(centerId);
    const reactantCenter = _reactionPreviewReactantAtomIds.has(sourceCenterId)
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
        const reactantNb = _reactionPreviewReactantAtomIds.has(_reaction2dSourceAtomId(nb.id))
          ? mol.atoms.get(_reaction2dSourceAtomId(nb.id))
          : null;
        const bond = mol.getBond(center.id, nb.id);
        return {
          atom: nb,
          reactant: reactantNb,
          anchored: _reaction2dMappedAtomScaffoldCompatible(reactantNb, nb, mol, componentAtomIds),
          targetLength: _scaledReaction2dBondLength(bond?.properties.order ?? 1, bondLength)
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
          for (const candidate of candidates) {
            let score = (candidate.x - center.x) ** 2 + (candidate.y - center.y) ** 2;
            if (reactantCenter?.x != null && reactantCenter?.y != null) {
              score += 0.35 * ((candidate.x - reactantCenter.x) ** 2 + (candidate.y - reactantCenter.y) ** 2);
            }
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
          center.x = anchor.atom.x + (vx / vlen) * anchor.targetLength;
          center.y = anchor.atom.y + (vy / vlen) * anchor.targetLength;
        }
      }
    }
  }
}

function _idealizeReaction2dTrigonalCenters(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }
  const mappedProductIds = new Set(
    (_reactionPreviewMappedAtomPairs ?? [])
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
      const reactant = mappedProductIds.has(nb.id) ? mol.atoms.get(_reaction2dSourceAtomId(nb.id)) : null;
      return {
        atom: nb,
        order: bond?.properties.order ?? 1,
        anchored: _reaction2dMappedAtomLocallyAnchored(reactant, nb, mol, componentAtomIds),
        targetLength: _scaledReaction2dBondLength(bond?.properties.order ?? 1, bondLength)
      };
    });

    if (!neighborInfo.some(info => info.order >= 2)) {
      continue;
    }

    const anchored = neighborInfo.filter(info => info.anchored);
    const moving = neighborInfo.filter(info => !info.anchored);
    if (moving.length === 0) {
      continue;
    }

    if (_reactionPreviewEditedProductAtomIds.has(center.id) && anchored.length >= 2) {
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
        for (const candidate of candidates) {
          let score = (candidate.x - center.x) ** 2 + (candidate.y - center.y) ** 2;
          if (moving.length > 0) {
            const approx = (() => {
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
              if (vlen < 1e-6) {
                return null;
              }
              return { x: vx / vlen, y: vy / vlen };
            })();
            if (approx) {
              for (const info of moving) {
                const targetX = candidate.x + approx.x * info.targetLength;
                const targetY = candidate.y + approx.y * info.targetLength;
                score += 0.35 * ((targetX - info.atom.x) ** 2 + (targetY - info.atom.y) ** 2);
              }
            }
          }
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
        moving[0].atom.x = center.x + (vx / vlen) * moving[0].targetLength;
        moving[0].atom.y = center.y + (vy / vlen) * moving[0].targetLength;
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
    }
  }
}

function _repositionReaction2dPeripheralAtoms(mol, componentAtomIds, bondLength = 1.5) {
  if (!mol || !componentAtomIds?.size) {
    return;
  }
  const mappedProductIds = new Set(
    (_reactionPreviewMappedAtomPairs ?? [])
      .filter(([, productId]) => componentAtomIds.has(productId))
      .map(([, productId]) => productId)
  );
  for (const atomId of componentAtomIds) {
    const atom = mol.atoms.get(atomId);
    if (!atom || atom.x == null || atom.name === 'H') {
      continue;
    }
    if (mappedProductIds.has(atomId)) {
      const sourceId = _reaction2dSourceAtomId(atomId);
      const reactantAtom = _reactionPreviewReactantAtomIds.has(sourceId)
        ? mol.atoms.get(sourceId)
        : null;
      if (_reaction2dMappedAtomLocallyAnchored(reactantAtom, atom, mol, componentAtomIds)) {
        continue;
      }
    }
    const heavyNeighbors = atom.getNeighbors(mol)
      .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null);
    if (heavyNeighbors.length !== 1) {
      continue;
    }
    const parent = heavyNeighbors[0];
    const atomBond = mol.getBond(atom.id, parent.id);
    const parentHeavyNeighbors = parent.getNeighbors(mol)
      .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && nb.x != null && nb.y != null);
    const parentHasTrigonalEditedGeometry =
            _reactionPreviewEditedProductAtomIds.has(parent.id) &&
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
    const parentSourceId = _reaction2dSourceAtomId(parent.id);
    const reactantParent = _reactionPreviewReactantAtomIds.has(parentSourceId)
      ? mol.atoms.get(parentSourceId)
      : null;
    const mappedSiblingSourceIds = new Set(
      parent.getNeighbors(mol)
        .filter(nb => componentAtomIds.has(nb.id) && nb.name !== 'H' && mappedProductIds.has(nb.id))
        .map(nb => _reaction2dSourceAtomId(nb.id))
    );
    const lostReactantNeighbors = reactantParent
      ? reactantParent.getNeighbors(mol).filter(nb =>
        _reactionPreviewReactantAtomIds.has(nb.id) &&
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
        atom.x = parent.x + (vx / vlen) * targetBondLength;
        atom.y = parent.y + (vy / vlen) * targetBondLength;
        continue;
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
    atom.x = parent.x + (vx / vlen) * targetBondLength;
    atom.y = parent.y + (vy / vlen) * targetBondLength;
  }
}

export function _drawReactionPreviewArrow2d(toSVGPt, atoms) {
  if (_reactionPreviewReactantAtomIds.size === 0 || _reactionPreviewProductAtomIds.size === 0) {
    return;
  }
  const reactant = _reaction2dArrowGeometryPreferHeavy(atoms, _reactionPreviewReactantAtomIds);
  const product = _reaction2dArrowGeometryPreferHeavy(atoms, _reactionPreviewProductAtomIds);
  const arrow = _reaction2dArrowEndpoints(reactant, product);
  if (!arrow) {
    return;
  }
  const start = toSVGPt(arrow.start);
  const end = toSVGPt(arrow.end);
  const arrowHeadLength = 10;
  const arrowHeadWidth = 6;
  const x1 = start.x;
  const y1 = start.y;
  const x2 = end.x;
  const y2 = end.y;
  const lineLength = Math.hypot(x2 - x1, y2 - y1);
  if (lineLength < 12) {
    return;
  }
  const ux = (x2 - x1) / lineLength;
  const uy = (y2 - y1) / lineLength;
  const px = -uy;
  const py = ux;

  const arrowLayer = ctx.g.append('g')
    .attr('class', 'reaction-preview-arrow')
    .attr('pointer-events', 'none')
    .attr('opacity', 0.8);
  arrowLayer.append('line')
    .attr('x1', x1)
    .attr('y1', y1)
    .attr('x2', x2)
    .attr('y2', y2)
    .attr('stroke', '#444')
    .attr('stroke-width', 2.5)
    .attr('stroke-linecap', 'round');
  arrowLayer.append('path')
    .attr('d', `M ${x2 - ux * arrowHeadLength + px * arrowHeadWidth} ${y2 - uy * arrowHeadLength + py * arrowHeadWidth} L ${x2} ${y2} L ${x2 - ux * arrowHeadLength - px * arrowHeadWidth} ${y2 - uy * arrowHeadLength - py * arrowHeadWidth}`)
    .attr('fill', 'none')
    .attr('stroke', '#444')
    .attr('stroke-width', 2.5)
    .attr('stroke-linecap', 'round')
    .attr('stroke-linejoin', 'round');

  const productGeometries = _reaction2dProductGeometries(atoms);
  for (let i = 0; i < productGeometries.length - 1; i++) {
    const left = productGeometries[i];
    const right = productGeometries[i + 1];
    const plus = toSVGPt({ x: (left.maxX + right.minX) / 2, y: (left.cy + right.cy) / 2 });
    arrowLayer.append('text')
      .attr('x', plus.x)
      .attr('y', plus.y)
      .attr('fill', '#444')
      .attr('font-size', 18)
      .attr('font-weight', 500)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .text('+');
  }
}

export function _renderReactionPreviewArrowForce(nodes) {
  ctx.g.selectAll('g.reaction-preview-arrow').remove();
  if (_reactionPreviewReactantAtomIds.size === 0 || _reactionPreviewProductAtomIds.size === 0) {
    return;
  }

  const reactant = _reaction2dArrowGeometryPreferHeavy(nodes, _reactionPreviewReactantAtomIds, {
    radiusForItem: node => atomRadius(node.protons),
    hydrogenRadiusScale: 0.75
  });
  const product = _reaction2dArrowGeometryPreferHeavy(nodes, _reactionPreviewProductAtomIds, {
    radiusForItem: node => atomRadius(node.protons),
    hydrogenRadiusScale: 0.75
  });
  const arrow = _reaction2dArrowEndpoints(reactant, product, 16);
  if (!arrow) {
    return;
  }
  const startInsideReactant = arrow.start.x >= reactant.minX && arrow.start.x <= reactant.maxX
        && arrow.start.y >= reactant.minY && arrow.start.y <= reactant.maxY;
  const endInsideProduct = arrow.end.x >= product.minX && arrow.end.x <= product.maxX
        && arrow.end.y >= product.minY && arrow.end.y <= product.maxY;
  if (startInsideReactant || endInsideProduct) {
    return;
  }
  const x1 = arrow.start.x;
  const y1 = arrow.start.y;
  const x2 = arrow.end.x;
  const y2 = arrow.end.y;
  const lineLength = Math.hypot(x2 - x1, y2 - y1);
  if (lineLength < 14) {
    return;
  }
  const ux = (x2 - x1) / lineLength;
  const uy = (y2 - y1) / lineLength;
  const px = -uy;
  const py = ux;
  const arrowHeadLength = 10;
  const arrowHeadWidth = 6;

  const arrowLayer = ctx.g.append('g')
    .attr('class', 'reaction-preview-arrow')
    .attr('pointer-events', 'none')
    .attr('opacity', 0.8);
  arrowLayer.append('line')
    .attr('x1', x1)
    .attr('y1', y1)
    .attr('x2', x2)
    .attr('y2', y2)
    .attr('stroke', '#444')
    .attr('stroke-width', 2.5)
    .attr('stroke-linecap', 'round');
  arrowLayer.append('path')
    .attr('d', `M ${x2 - ux * arrowHeadLength + px * arrowHeadWidth} ${y2 - uy * arrowHeadLength + py * arrowHeadWidth} L ${x2} ${y2} L ${x2 - ux * arrowHeadLength - px * arrowHeadWidth} ${y2 - uy * arrowHeadLength - py * arrowHeadWidth}`)
    .attr('fill', 'none')
    .attr('stroke', '#444')
    .attr('stroke-width', 2.5)
    .attr('stroke-linecap', 'round')
    .attr('stroke-linejoin', 'round');

  const productGeometries = _reaction2dProductGeometries(nodes, {
    radiusForItem: node => atomRadius(node.protons),
    hydrogenRadiusScale: 0.75
  });
  for (let i = 0; i < productGeometries.length - 1; i++) {
    const left = productGeometries[i];
    const right = productGeometries[i + 1];
    arrowLayer.append('text')
      .attr('x', (left.maxX + right.minX) / 2)
      .attr('y', (left.cy + right.cy) / 2)
      .attr('fill', '#444')
      .attr('font-size', 18)
      .attr('font-weight', 500)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .text('+');
  }
}

function _queryAtomAnchorSignature(queryMol, atom) {
  const bondSignature = atom.bonds
    .map(bondId => {
      const bond = queryMol.bonds.get(bondId);
      return `${bond?.properties.order ?? 1}:${bond?.properties.aromatic ?? false}`;
    })
    .sort()
    .join('|');
  return [
    atom.name ?? '*',
    atom.isAromatic?.() ?? false,
    atom.getCharge?.() ?? 0,
    atom.bonds.length,
    atom.isInRing?.(queryMol) ?? false,
    bondSignature
  ].join(';');
}

function _functionalGroupAnchorQueryIds(smarts) {
  let cached = _functionalGroupAnchorCache.get(smarts);
  if (cached) {
    return cached;
  }

  const queryMol = parseSMARTS(smarts);
  const classes = new Map();
  for (const atom of queryMol.atoms.values()) {
    const signature = _queryAtomAnchorSignature(queryMol, atom);
    if (!classes.has(signature)) {
      classes.set(signature, []);
    }
    classes.get(signature).push(atom.id);
  }

  const ranked = [...classes.values()].sort((aIds, bIds) => {
    if (aIds.length !== bIds.length) {
      return aIds.length - bIds.length;
    }
    const aDegree = Math.max(...aIds.map(id => queryMol.atoms.get(id)?.bonds.length ?? 0));
    const bDegree = Math.max(...bIds.map(id => queryMol.atoms.get(id)?.bonds.length ?? 0));
    if (aDegree !== bDegree) {
      return bDegree - aDegree;
    }
    return aIds.join(',').localeCompare(bIds.join(','));
  });

  cached = ranked[0] ?? [...queryMol.atoms.keys()];
  _functionalGroupAnchorCache.set(smarts, cached);
  return cached;
}

function _mergeMappingsByAnchor(smarts, mappings) {
  const anchorQueryIds = _functionalGroupAnchorQueryIds(smarts);
  const mergedByAnchor = new Map();
  for (const m of mappings) {
    const anchorKey = anchorQueryIds
      .map(queryId => m.get(queryId))
      .filter(Boolean)
      .sort()
      .join(',');
    const key = anchorKey || [...m.values()].sort().join(',');
    if (!mergedByAnchor.has(key)) {
      mergedByAnchor.set(key, new Set());
    }
    for (const id of m.values()) {
      mergedByAnchor.get(key).add(id);
    }
  }
  return [...mergedByAnchor.values()].map(
    atomSet => new Map([...atomSet].map(id => [id, id]))
  );
}

function _groupMappingsByAnchor(smarts, mappings) {
  const anchorQueryIds = _functionalGroupAnchorQueryIds(smarts);
  const grouped = new Map();
  for (const mapping of mappings) {
    const anchorKey = anchorQueryIds
      .map(queryId => mapping.get(queryId))
      .filter(Boolean)
      .sort()
      .join(',');
    const key = anchorKey || [...mapping.values()].sort().join(',');
    if (!grouped.has(key)) {
      grouped.set(key, {
        applyMapping: mapping,
        atomIds: new Set()
      });
    }
    for (const id of mapping.values()) {
      grouped.get(key).atomIds.add(id);
    }
  }
  return [...grouped.values()].map(group => ({
    applyMapping: group.applyMapping,
    highlightMapping: new Map([...group.atomIds].map(id => [id, id]))
  }));
}

function _previewNavButton(label, title, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'reaction-nav-btn';
  btn.title = title;
  btn.textContent = label;
  btn.addEventListener('click', event => {
    event.stopPropagation();
    onClick();
  });
  return btn;
}

function _filterReactionMatchGroups(mol, entry, reactantSmarts, mappings) {
  const groups = _groupMappingsByAnchor(reactantSmarts, mappings);
  const excludePatterns = entry.excludeOverlaps ?? [];
  if (excludePatterns.length === 0) {
    return groups;
  }

  const excludedSets = excludePatterns.flatMap(pattern =>
    [...findSMARTS(mol, pattern)].map(mapping => new Set(mapping.values()))
  );
  if (excludedSets.length === 0) {
    return groups;
  }

  return groups.filter(group => {
    const atomIds = new Set(group.applyMapping.values());
    return !excludedSets.some(excluded => {
      let overlap = 0;
      for (const atomId of atomIds) {
        if (excluded.has(atomId)) {
          overlap++;
        }
      }
      return overlap > 0;
    });
  });
}

function _activateReactionEntry(sourceMol, entry, siteIndex = 0, { lock = true } = {}) {
  if (!sourceMol || !entry.matchGroups?.length) {
    return;
  }
  const siteCount = entry.matchGroups.length;
  const normalizedIndex = ((siteIndex % siteCount) + siteCount) % siteCount;
  const site = entry.matchGroups[normalizedIndex];
  const preview = _buildReaction2dMol(sourceMol, entry.smirks, site.applyMapping);
  if (lock) {
    _activeReactionSmirks = entry.smirks;
    _activeReactionMatchIndex = normalizedIndex;
    _reactionPreviewLocked = true;
  }
  if (preview) {
    if (lock || !_reactionPreviewSourceMol) {
      _reactionPreviewSourceMol = sourceMol.clone();
    }
    _reactionPreviewReactantAtomIds = preview.reactantAtomIds;
    _reactionPreviewProductAtomIds = preview.productAtomIds;
    _reactionPreviewProductComponentAtomIdSets = preview.productComponentAtomIdSets ?? [];
    _reactionPreviewMappedAtomPairs = preview.mappedAtomPairs ?? [];
    _reactionPreviewEditedProductAtomIds = preview.editedProductAtomIds ?? new Set();
    _reactionPreviewPreservedReactantStereoByCenter = preview.preservedReactantStereoByCenter ?? new Map();
    _reactionPreviewPreservedReactantStereoBondTypes = preview.preservedReactantStereoBondTypes ?? new Map();
    _reactionPreviewPreservedProductStereoByCenter = preview.preservedProductStereoByCenter ?? new Map();
    _reactionPreviewPreservedProductStereoBondTypes = preview.preservedProductStereoBondTypes ?? new Map();
    _reactionPreviewForcedStereoByCenter = preview.forcedStereoByCenter ?? new Map();
    _reactionPreviewForcedStereoBondTypes = preview.forcedStereoBondTypes ?? new Map();
    _reactionPreviewForcedStereoBondCenters = preview.forcedStereoBondCenters ?? new Map();
    _reactionPreviewReactantReferenceCoords = preview.reactantReferenceCoords ?? new Map();
    _reactionPreviewHighlightMappings = preview.highlightMapping
      ? [new Map(preview.highlightMapping)]
      : [new Map(site.highlightMapping)];
    ctx.renderMol(preview.mol);
    _setHighlight(preview.highlightMapping ? [preview.highlightMapping] : [site.highlightMapping]);
    return;
  }
  _reactionPreviewHighlightMappings = [new Map(site.highlightMapping)];
  _setHighlight([site.highlightMapping]);
}

export function _alignReaction2dProductOrientation(mol) {
  if (!_hasReactionPreview() || !_reactionPreviewMappedAtomPairs?.length) {
    return;
  }
  alignReaction2dProductOrientationShared(mol, {
    reactantAtomIds: _reactionPreviewReactantAtomIds,
    productAtomIds: _reactionPreviewProductAtomIds,
    productComponentAtomIdSets: _reactionPreviewProductComponentAtomIdSets,
    mappedAtomPairs: _reactionPreviewMappedAtomPairs,
    editedProductAtomIds: _reactionPreviewEditedProductAtomIds,
    preservedReactantStereoByCenter: _reactionPreviewPreservedReactantStereoByCenter,
    preservedReactantStereoBondTypes: _reactionPreviewPreservedReactantStereoBondTypes,
    preservedProductStereoByCenter: _reactionPreviewPreservedProductStereoByCenter,
    preservedProductStereoBondTypes: _reactionPreviewPreservedProductStereoBondTypes,
    forcedStereoByCenter: _reactionPreviewForcedStereoByCenter,
    forcedStereoBondTypes: _reactionPreviewForcedStereoBondTypes,
    forcedStereoBondCenters: _reactionPreviewForcedStereoBondCenters,
    reactantReferenceCoords: _reactionPreviewReactantReferenceCoords
  }, 1.5);
}

export function updateFunctionalGroups(mol) {
  _highlightMol = mol;
  _highlightedAtomIds.clear();
  _highlightedAtomSets = [];
  _rememberHoveredFunctionalGroupMappings(null);
  const tbody = document.getElementById('fg-body');
  tbody.innerHTML = '';
  for (const [, fg] of Object.entries(functionalGroups)) {
    const mappings = [...findSMARTS(mol, fg.smarts)];
    if (mappings.length === 0) {
      continue;
    }
    const uniqueMappings = _mergeMappingsByAnchor(fg.smarts, mappings);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${fg.name}</td><td>${uniqueMappings.length}</td>`;
    tr._fgMappings = uniqueMappings;

    tr.addEventListener('mouseenter', () => {
      if (tbody.querySelector('tr.fg-active')) {
        return;
      }
      _rememberHoveredFunctionalGroupMappings(uniqueMappings);
      _setHighlight(uniqueMappings);
    });
    tr.addEventListener('mouseleave', () => {
      if (tbody.querySelector('tr.fg-active')) {
        return;
      }
      if (Date.now() < _preserveFunctionalGroupHighlightUntil) {
        return;
      }
      _setHighlight(null);
    });
    tr.addEventListener('click', () => {
      tbody.querySelectorAll('tr').forEach(r => r.classList.remove('fg-active'));
      tr.classList.add('fg-active');
      _setHighlight(uniqueMappings);
    });
    tbody.appendChild(tr);
  }
}

export function updateReactionTemplatesPanel() {
  const tbody = document.getElementById('reaction-body');
  if (!tbody) {
    return;
  }
  const mol = _reactionPreviewSourceMol ?? ctx.currentMol ?? ctx._mol2d;
  if (!mol) {
    tbody.innerHTML = '';
    return;
  }
  const entries = Object.values(reactionTemplates)
    .slice()
    .map(entry => {
      const reactantSmarts = entry.smirks.split('>>')[0]?.trim();
      if (!reactantSmarts) {
        return null;
      }
      const mappings = [...findSMARTS(mol, reactantSmarts)];
      if (mappings.length === 0) {
        return null;
      }
      const matchGroups = _filterReactionMatchGroups(mol, entry, reactantSmarts, mappings);
      if (matchGroups.length === 0) {
        return null;
      }
      return {
        ...entry,
        matchGroups
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  tbody.innerHTML = '';
  for (const entry of entries) {
    const siteCount = entry.matchGroups.length;
    const isActive = _reactionPreviewLocked && entry.smirks === _activeReactionSmirks;
    const tr = document.createElement('tr');
    if (isActive) {
      tr.classList.add('reaction-active');
    }

    const nameCell = document.createElement('td');
    const countCell = document.createElement('td');
    countCell.className = 'reaction-count';
    countCell.textContent = String(siteCount);

    const name = document.createElement('div');
    name.className = 'reaction-name';
    name.textContent = entry.name;
    nameCell.appendChild(name);

    if (isActive && siteCount > 1) {
      const nav = document.createElement('div');
      nav.className = 'reaction-nav';
      const siteLabel = document.createElement('span');
      siteLabel.className = 'reaction-site-label';
      siteLabel.textContent = `${_activeReactionMatchIndex + 1}/${siteCount}`;
      const sourceMol = (_reactionPreviewSourceMol ?? ctx.currentMol ?? ctx._mol2d)?.clone();
      nav.appendChild(_previewNavButton('‹', 'Previous reaction site', () => {
        if (!sourceMol) {
          return;
        }
        _activateReactionEntry(sourceMol, entry, _activeReactionMatchIndex - 1);
      }));
      nav.appendChild(siteLabel);
      nav.appendChild(_previewNavButton('›', 'Next reaction site', () => {
        if (!sourceMol) {
          return;
        }
        _activateReactionEntry(sourceMol, entry, _activeReactionMatchIndex + 1);
      }));
      nameCell.appendChild(nav);
    }

    tr.appendChild(nameCell);
    tr.appendChild(countCell);
    tr.addEventListener('mouseenter', () => {
      if (_reactionPreviewLocked) {
        return;
      }
      _setHighlight(entry.matchGroups.map(group => group.highlightMapping));
    });
    tr.addEventListener('mouseleave', () => {
      if (_reactionPreviewLocked) {
        return;
      }
      _setHighlight(null);
    });
    tr.addEventListener('click', event => {
      event.stopPropagation();
      document.getElementById('fg-body')?.querySelectorAll('tr')
        .forEach(r => r.classList.remove('fg-active'));
      if (_reactionPreviewLocked && _activeReactionSmirks === entry.smirks) {
        _restoreReactionPreviewSource();
        _setHighlight(null);
        updateReactionTemplatesPanel();
        return;
      }
      const sourceMol = (_reactionPreviewSourceMol ?? ctx.currentMol ?? ctx._mol2d)?.clone();
      if (!sourceMol) {
        return;
      }
      _activateReactionEntry(sourceMol, entry, 0, { lock: true });
      updateReactionTemplatesPanel();
    });
    tbody.appendChild(tr);
  }
}

// Clear active functional-group row when clicking outside the table.
document.addEventListener('click', e => {
  if (e.target.closest('#fg-table')) {
    return;
  }
  if (e.target.closest('#rotate-controls')) {
    return;
  }
  const tbody = document.getElementById('fg-body');
  if (!tbody.querySelector('tr.fg-active')) {
    return;
  }
  tbody.querySelectorAll('tr').forEach(r => r.classList.remove('fg-active'));
  _setHighlight(null);
}, true);

export function getHighlightedAtomIds()  {
  return _highlightedAtomIds;
}
export function getHighlightedAtomSets() {
  return _highlightedAtomSets;
}
export function getHighlightMol()        {
  return _highlightMol;
}
export function getHighlightStyle()      {
  return _highlightStyle;
}
export function clearHighlightState() {
  _highlightedAtomIds.clear();
  _highlightedAtomSets = [];
  _highlightMol = null;
}
