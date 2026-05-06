/** @module app/render/highlights */

import { findSMARTS, parseSMARTS, functionalGroups } from '../../smarts/index.js';
import { getAtomLabel, labelHalfW } from '../../layout/mol2d-helpers.js';
import { createNavButton } from './panel-row.js';

let ctx = {};

/**
 * Initializes the highlights module with the shared app context needed for redrawing after highlight changes.
 * @param {object} context - Context object providing `mode`, `_mol2d`, `draw2d`, and `applyForceHighlights`.
 */
export function initHighlights(context) {
  ctx = context;
}

/**
 * Applies or clears a highlight from a list of SMARTS mappings and triggers a redraw.
 * @param {Array<Map>|null} mappings - Array of atom-id mappings (one per SMARTS match instance), or null to clear.
 * @param {object} [options] - Optional rendering hints.
 * @param {string} [options.style] - Named highlight style to apply (e.g. `'default'` or `'physchem'`).
 */
export function _setHighlight(mappings, options = {}) {
  _highlightedAtomIds.clear();
  _highlightedAtomSets = [];
  _highlightStyle = options.style ?? 'default';
  if (mappings) {
    for (const mapping of mappings) {
      const atomSet = new Set(mapping.values());
      // Include explicit H atoms bonded to any matched atom.
      if (_highlightMol) {
        for (const atomId of [...atomSet]) {
          for (const nb of _highlightMol.atoms.get(atomId)?.getNeighbors(_highlightMol) ?? []) {
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

/**
 * Creates the 2D highlight renderer that draws atom and bond highlight overlays onto the SVG graph.
 * @param {object} context - Context providing `view`, `state`, `helpers`, and `constants` for rendering.
 * @returns {object} Object with a `redraw2dHighlights` function.
 */
export function create2DHighlightRenderer(context) {
  function highlightRadius(atom, hCounts, toSVGPt, mol) {
    const label = getAtomLabel(atom, hCounts, toSVGPt, mol) || atom.name;
    return Math.max(labelHalfW(label, context.constants.getFontSize()), 10) + 5;
  }

  function redraw2dHighlights() {
    const graphSelection = context.view.getGraphSelection();
    graphSelection.select('g.atom-highlights').remove();

    const mol = context.state.getMol();
    if (getHighlightedAtomIds().size === 0 || !mol) {
      return;
    }

    const hCounts = context.state.getHCounts();
    const toSVGPt = context.helpers.toSVGPt;
    const atoms = [...mol.atoms.values()].filter(atom => atom.x != null && atom.visible !== false);
    const highlightStyle = HIGHLIGHT_STYLES[getHighlightStyle()] ?? HIGHLIGHT_STYLES.default;
    const outlinePadding = 2;
    const highlightLayer = graphSelection.insert('g', ':first-child').attr('class', 'atom-highlights').attr('opacity', 0.45);

    for (const atomSet of getHighlightedAtomSets()) {
      const matchedBonds = [];
      for (const bond of mol.bonds.values()) {
        const [atom1, atom2] = bond.getAtomObjects(mol);
        if (!atom1 || !atom2 || atom1.x == null || atom2.x == null) {
          continue;
        }
        if (atom1.visible === false || atom2.visible === false) {
          continue;
        }
        if (!atomSet.has(atom1.id) || !atomSet.has(atom2.id)) {
          continue;
        }
        const point1 = toSVGPt(atom1);
        const point2 = toSVGPt(atom2);
        const radius1 = highlightRadius(atom1, hCounts, toSVGPt, mol);
        const radius2 = highlightRadius(atom2, hCounts, toSVGPt, mol);
        matchedBonds.push({ point1, point2, width: Math.min(radius1, radius2) * 2 });
      }

      const matchedAtoms = [];
      for (const atom of atoms) {
        if (!atomSet.has(atom.id)) {
          continue;
        }
        const { x, y } = toSVGPt(atom);
        matchedAtoms.push({ x, y, radius: highlightRadius(atom, hCounts, toSVGPt, mol) });
      }

      const addLines = (stroke, extra) => {
        for (const { point1, point2, width } of matchedBonds) {
          highlightLayer
            .append('line')
            .attr('x1', point1.x)
            .attr('y1', point1.y)
            .attr('x2', point2.x)
            .attr('y2', point2.y)
            .attr('stroke', stroke)
            .attr('stroke-width', width + extra * 2)
            .attr('stroke-linecap', 'round');
        }
      };

      const addCircles = (fill, extra) => {
        for (const { x, y, radius } of matchedAtoms) {
          highlightLayer
            .append('circle')
            .attr('cx', x)
            .attr('cy', y)
            .attr('r', radius + extra)
            .attr('fill', fill)
            .attr('stroke', 'none');
        }
      };

      addLines(highlightStyle.outline, outlinePadding);
      addCircles(highlightStyle.outline, outlinePadding);
      addLines(highlightStyle.fill, 0);
      addCircles(highlightStyle.fill, 0);
    }
  }

  return {
    redraw2dHighlights
  };
}

/**
 * Creates the force-layout highlight renderer that draws atom and bond highlight overlays onto the force graph.
 * @param {object} context - Context providing `view`, `cache`, `constants`, `helpers`, and `force` for rendering.
 * @returns {object} Object with an `applyForceHighlights` function.
 */
export function createForceHighlightRenderer(context) {
  function applyForceHighlights() {
    const graphSelection = context.view.getGraphSelection();
    graphSelection.selectAll('g.fg-highlight-layer').remove();
    context.cache.setHighlightLines(null);
    context.cache.setHighlightCircles(null);
    if (getHighlightedAtomIds().size === 0) {
      return;
    }

    const highlightStyle = HIGHLIGHT_STYLES[getHighlightStyle()] ?? HIGHLIGHT_STYLES.default;
    const highlightRadius = context.constants.getHighlightRadius();
    const outlineWidth = context.constants.getOutlineWidth();
    const highlightLayer = graphSelection.insert('g', ':first-child').attr('class', 'fg-highlight-layer').attr('opacity', 0.45);

    const nodeMap = new Map(context.force.getNodes().map(node => [node.id, node]));
    const allLinks = context.force.getLinks();

    for (const atomSet of getHighlightedAtomSets()) {
      const matchedLinks = allLinks.filter(link => atomSet.has(link.source.id) && atomSet.has(link.target.id));
      const matchedNodes = [...atomSet].map(id => nodeMap.get(id)).filter(Boolean);

      const addLines = (stroke, extra) => {
        highlightLayer
          .selectAll(null)
          .data(matchedLinks)
          .enter()
          .append('line')
          .datum(d => d)
          .attr('stroke', stroke)
          .attr('stroke-width', d => Math.min(context.helpers.atomRadius(d.source.protons), context.helpers.atomRadius(d.target.protons)) * 2 + highlightRadius * 2 + extra * 2)
          .attr('stroke-linecap', 'round')
          .attr('x1', d => d.source.x)
          .attr('y1', d => d.source.y)
          .attr('x2', d => d.target.x)
          .attr('y2', d => d.target.y);
      };

      const addCircles = (fill, extra) => {
        highlightLayer
          .selectAll(null)
          .data(matchedNodes)
          .enter()
          .append('circle')
          .datum(d => d)
          .attr('r', d => context.helpers.atomRadius(d.protons) + highlightRadius + extra)
          .attr('fill', fill)
          .attr('stroke', 'none')
          .attr('cx', d => d.x)
          .attr('cy', d => d.y);
      };

      addLines(highlightStyle.outline, outlineWidth);
      addCircles(highlightStyle.outline, outlineWidth);
      addLines(highlightStyle.fill, 0);
      addCircles(highlightStyle.fill, 0);
    }

    context.cache.setHighlightLines(highlightLayer.selectAll('line'));
    context.cache.setHighlightCircles(highlightLayer.selectAll('circle'));
  }

  return {
    applyForceHighlights
  };
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

const _highlightedAtomIds = new Set();
let _highlightedAtomSets = []; // one Set<atomId> per SMARTS match instance
let _highlightMol = null; // molecule used for last updateFunctionalGroups call

const _functionalGroupAnchorCache = new Map();
const _persistentHighlightFallbacks = new Map();
let _activeFunctionalGroupKey = null;
let _activeFunctionalGroupMatchIndex = 0;
const FUNCTIONAL_GROUP_ALL_MATCH_INDEX = -1;

function _rememberHoveredFunctionalGroupMappings(mappings) {
  if (!mappings?.length) {
    _lastHoveredFunctionalGroupMappings = null;
    _lastHoveredFunctionalGroupAt = 0;
    return;
  }
  _lastHoveredFunctionalGroupMappings = mappings.map(mapping => new Map(mapping));
  _lastHoveredFunctionalGroupAt = Date.now();
}

function _functionalGroupKey(fg) {
  return `${fg.name}::${fg.smarts}`;
}

const _functionalGroupNavButton = createNavButton;

function _clearActiveFunctionalGroupState() {
  _activeFunctionalGroupKey = null;
  _activeFunctionalGroupMatchIndex = 0;
}

/**
 * Normalizes a functional-group match index for a given site count.
 *
 * `-1` is reserved for the synthetic "All" cycle state when there are
 * multiple matches; otherwise the value is clamped into `[0, siteCount - 1]`.
 * @param {number} index - The raw index to normalize.
 * @param {number} siteCount - Total number of match sites.
 * @returns {number} Normalized index in `[0, siteCount - 1]`, or -1 for the "All" state.
 */
function _normalizeFunctionalGroupMatchIndex(index, siteCount) {
  if (siteCount <= 1) {
    return 0;
  }
  if (index === FUNCTIONAL_GROUP_ALL_MATCH_INDEX) {
    return FUNCTIONAL_GROUP_ALL_MATCH_INDEX;
  }
  return Math.max(0, Math.min(index ?? 0, siteCount - 1));
}

/**
 * Cycles through functional-group match states, including the synthetic
 * "All" state after the last individual match.
 * @param {number} currentIndex - Current active index.
 * @param {number} delta - Step direction (+1 or -1).
 * @param {number} siteCount - Total number of match sites.
 * @returns {number} Next index after cycling.
 */
function _cycleFunctionalGroupMatchIndex(currentIndex, delta, siteCount) {
  if (siteCount <= 1) {
    return 0;
  }
  const states = [...Array.from({ length: siteCount }, (_, index) => index), FUNCTIONAL_GROUP_ALL_MATCH_INDEX];
  const normalizedCurrent = _normalizeFunctionalGroupMatchIndex(currentIndex, siteCount);
  const currentPos = Math.max(0, states.indexOf(normalizedCurrent));
  const nextPos = (currentPos + delta + states.length) % states.length;
  return states[nextPos];
}

/**
 * Formats the active functional-group cycle label.
 * @param {number} index - Current active index.
 * @param {number} siteCount - Total number of match sites.
 * @returns {string} Display label such as "1/3" or "All".
 */
function _functionalGroupMatchIndexLabel(index, siteCount) {
  return index === FUNCTIONAL_GROUP_ALL_MATCH_INDEX ? 'All' : `${index + 1}/${siteCount}`;
}

function _activeFunctionalGroupMappingsForRow(row) {
  if (!row?._fgMappings?.length) {
    return null;
  }
  const index = _normalizeFunctionalGroupMatchIndex(row._fgActiveIndex ?? 0, row._fgMappings.length);
  if (index === FUNCTIONAL_GROUP_ALL_MATCH_INDEX) {
    return row._fgMappings.map(mapping => new Map(mapping));
  }
  return [row._fgMappings[index]];
}

function _queryAtomAnchorSignature(queryMol, atom) {
  const bondSignature = atom.bonds
    .map(bondId => {
      const bond = queryMol.bonds.get(bondId);
      return `${bond?.properties.order ?? 1}:${bond?.properties.aromatic ?? false}`;
    })
    .sort()
    .join('|');
  return [atom.name ?? '*', atom.isAromatic?.() ?? false, atom.getCharge?.() ?? 0, atom.bonds.length, atom.isInRing?.(queryMol) ?? false, bondSignature].join(';');
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

/**
 * Returns the query atom ids that serve as canonical anchors for deduplicating SMARTS matches.
 * @param {string} smarts - SMARTS pattern string to look up or compute anchor ids for.
 * @returns {string[]} Array of query atom ids representing the anchor atoms.
 */
export function getHighlightAnchorQueryIds(smarts) {
  return _functionalGroupAnchorQueryIds(smarts);
}

function _mergeMappingsByAnchor(smarts, mappings) {
  const anchorQueryIds = _functionalGroupAnchorQueryIds(smarts);
  const mergedByAnchor = new Map();
  for (const mapping of mappings) {
    const anchorKey = anchorQueryIds
      .map(queryId => mapping.get(queryId))
      .filter(Boolean)
      .sort()
      .join(',');
    const key = anchorKey || [...mapping.values()].sort().join(',');
    if (!mergedByAnchor.has(key)) {
      mergedByAnchor.set(key, new Set());
    }
    for (const id of mapping.values()) {
      mergedByAnchor.get(key).add(id);
    }
  }
  return [...mergedByAnchor.values()].map(atomSet => new Map([...atomSet].map(id => [id, id])));
}

/**
 * Applies a transient highlight from the last hovered functional-group mappings for 2D export, if within the grace period.
 * @returns {() => void} Cleanup no-op (always returns an empty function).
 */
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

/**
 * Restores a highlight from the most recently hovered functional-group mappings if still within the grace period.
 * @returns {boolean} True if a hover highlight was successfully restored, false otherwise.
 */
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

/**
 * Registers or removes a named persistent highlight fallback that is tried when no explicit highlight is active.
 * @param {(() => void)|null} fn - Restore function called when the fallback is activated, or a non-function value to remove the entry.
 * @param {object} [options] - Configuration options for the fallback entry.
 * @param {string} [options.key] - Unique key identifying this fallback entry (defaults to `'default'`).
 * @param {() => boolean} [options.isActive] - Optional predicate; if provided, only activates the fallback when it returns true.
 */
export function setPersistentHighlightFallback(fn, options = {}) {
  const key = options.key ?? 'default';
  if (typeof fn !== 'function') {
    _persistentHighlightFallbacks.delete(key);
    return;
  }
  _persistentHighlightFallbacks.set(key, {
    restore: fn,
    isActive: typeof options.isActive === 'function' ? options.isActive : null
  });
}

/**
 * Returns whether any registered persistent highlight fallback is currently active.
 * @returns {boolean} True if at least one fallback has no `isActive` guard or its guard returns true.
 */
export function hasPersistentHighlightFallback() {
  for (const { isActive } of [..._persistentHighlightFallbacks.values()].reverse()) {
    if (!isActive || isActive()) {
      return true;
    }
  }
  return false;
}

/**
 * Restores the most recently active highlight from the active functional-group row or registered fallbacks, clearing all highlights if none succeed.
 * @returns {boolean} True if a highlight was successfully restored, false if all highlights were cleared.
 */
export function _restorePersistentHighlight() {
  const activeFgRow = document.querySelector('#fg-body tr.fg-active');
  const activeFgMappings = _activeFunctionalGroupMappingsForRow(activeFgRow);
  if (activeFgMappings) {
    _setHighlight(activeFgMappings);
    return true;
  }
  for (const { restore } of [..._persistentHighlightFallbacks.values()].reverse()) {
    if (restore?.()) {
      return true;
    }
  }
  _setHighlight(null);
  return false;
}

/**
 * Returns true if both atom ids belong to the same highlighted SMARTS match instance.
 * @param {string} id1 - First atom id.
 * @param {string} id2 - Second atom id.
 * @returns {boolean} True if the two atoms share a highlighted match set.
 */
export function _isBondHighlighted(id1, id2) {
  for (const set of _highlightedAtomSets) {
    if (set.has(id1) && set.has(id2)) {
      return true;
    }
  }
  return false;
}

/**
 * Recomputes functional-group SMARTS matches for the given molecule and rebuilds the functional-group panel UI.
 * @param {object} mol - Molecule whose functional groups should be recomputed and displayed.
 */
export function updateFunctionalGroups(mol) {
  _highlightMol = mol;
  _highlightedAtomIds.clear();
  _highlightedAtomSets = [];
  _rememberHoveredFunctionalGroupMappings(null);
  const previousActiveKey = _activeFunctionalGroupKey;
  const previousActiveIndex = _activeFunctionalGroupMatchIndex;
  let activeStillPresent = false;
  if (typeof document === 'undefined') {
    return;
  }
  const tbody = document.getElementById('fg-body');
  if (!tbody) {
    return;
  }
  tbody.innerHTML = '';
  for (const [, fg] of Object.entries(functionalGroups)) {
    const mappings = [...findSMARTS(mol, fg.smarts)];
    if (mappings.length === 0) {
      continue;
    }
    const uniqueMappings = _mergeMappingsByAnchor(fg.smarts, mappings);
    const siteCount = uniqueMappings.length;
    const key = _functionalGroupKey(fg);
    const isActive = previousActiveKey === key;
    const activeIndex = isActive ? _normalizeFunctionalGroupMatchIndex(previousActiveIndex, siteCount) : 0;
    const tr = document.createElement('tr');
    if (isActive) {
      activeStillPresent = true;
      _activeFunctionalGroupKey = key;
      _activeFunctionalGroupMatchIndex = activeIndex;
      tr.classList.add('fg-active');
    }
    tr._fgMappings = uniqueMappings;
    tr._fgActiveIndex = activeIndex;

    const nameCell = document.createElement('td');
    const countCell = document.createElement('td');
    countCell.className = 'reaction-count';
    countCell.textContent = String(siteCount);

    const name = document.createElement('div');
    name.className = 'reaction-name';
    name.textContent = fg.name;
    nameCell.appendChild(name);

    if (isActive && siteCount > 1) {
      const nav = document.createElement('div');
      nav.className = 'reaction-nav';
      const siteLabel = document.createElement('span');
      siteLabel.className = 'reaction-site-label';
      siteLabel.textContent = _functionalGroupMatchIndexLabel(activeIndex, siteCount);
      nav.appendChild(
        _functionalGroupNavButton('‹', 'Previous functional-group match', () => {
          _activeFunctionalGroupMatchIndex = _cycleFunctionalGroupMatchIndex(activeIndex, -1, siteCount);
          _setHighlight(_activeFunctionalGroupMappingsForRow({ _fgMappings: uniqueMappings, _fgActiveIndex: _activeFunctionalGroupMatchIndex }));
          updateFunctionalGroups(_highlightMol);
        })
      );
      nav.appendChild(siteLabel);
      nav.appendChild(
        _functionalGroupNavButton('›', 'Next functional-group match', () => {
          _activeFunctionalGroupMatchIndex = _cycleFunctionalGroupMatchIndex(activeIndex, 1, siteCount);
          _setHighlight(_activeFunctionalGroupMappingsForRow({ _fgMappings: uniqueMappings, _fgActiveIndex: _activeFunctionalGroupMatchIndex }));
          updateFunctionalGroups(_highlightMol);
        })
      );
      nameCell.appendChild(nav);
    }

    tr.appendChild(nameCell);
    tr.appendChild(countCell);

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
      _restorePersistentHighlight();
    });
    tr.addEventListener('mousedown', event => {
      if (event.button !== 0) {
        return;
      }
      const wasActive = tr.classList.contains('fg-active');
      tbody.querySelectorAll('tr').forEach(row => row.classList.remove('fg-active'));
      _rememberHoveredFunctionalGroupMappings(uniqueMappings);
      if (wasActive) {
        _clearActiveFunctionalGroupState();
        _setHighlight(uniqueMappings);
        return;
      }
      _activeFunctionalGroupKey = key;
      _activeFunctionalGroupMatchIndex = 0;
      tr.classList.add('fg-active');
      _setHighlight([uniqueMappings[0]]);
      updateFunctionalGroups(_highlightMol);
    });
    tbody.appendChild(tr);
  }
  if (!activeStillPresent && previousActiveKey !== null) {
    _clearActiveFunctionalGroupState();
    return;
  }
  if (activeStillPresent) {
    const activeFgRow = tbody.querySelector('tr.fg-active');
    const activeFgMappings = _activeFunctionalGroupMappingsForRow(activeFgRow);
    if (activeFgMappings) {
      _setHighlight(activeFgMappings);
    }
  }
}

if (typeof document !== 'undefined') {
  // Clear active functional-group row when clicking outside the table.
  document.addEventListener(
    'click',
    event => {
      if (event.target.closest('#fg-table')) {
        return;
      }
      if (event.target.closest('#resonance-panel')) {
        return;
      }
      if (event.target.closest('#rotate-controls')) {
        return;
      }
      if (event.target.closest('#force-controls')) {
        return;
      }
      const tbody = document.getElementById('fg-body');
      if (!tbody?.querySelector('tr.fg-active')) {
        return;
      }
      _clearActiveFunctionalGroupState();
      tbody.querySelectorAll('tr').forEach(row => row.classList.remove('fg-active'));
      _setHighlight(null);
    },
    true
  );
}

/**
 * Returns the flat set of all currently highlighted atom ids across all match instances.
 * @returns {Set<string>} Set of highlighted atom ids.
 */
export function getHighlightedAtomIds() {
  return _highlightedAtomIds;
}

/**
 * Returns the array of per-match-instance atom-id sets currently highlighted.
 * @returns {Array<Set<string>>} Array of Sets, one per SMARTS match instance.
 */
export function getHighlightedAtomSets() {
  return _highlightedAtomSets;
}

/**
 * Returns the molecule used for the last `updateFunctionalGroups` call, or null if none.
 * @returns {object|null} The last molecule passed to `updateFunctionalGroups`, or null.
 */
export function getHighlightMol() {
  return _highlightMol;
}

/**
 * Returns the name of the currently active highlight style.
 * @returns {string} Highlight style key (e.g. `'default'` or `'physchem'`).
 */
export function getHighlightStyle() {
  return _highlightStyle;
}

/**
 * Captures the current active functional-group selection state for later restoration via undo/redo.
 * @returns {{activeFunctionalGroupKey: string|null, activeFunctionalGroupMatchIndex: number}} Snapshot of active functional-group state.
 */
export function captureHighlightSnapshot() {
  return {
    activeFunctionalGroupKey: _activeFunctionalGroupKey,
    activeFunctionalGroupMatchIndex: _activeFunctionalGroupMatchIndex
  };
}

/**
 * Restores the highlight and functional-group panel state from a previously captured snapshot.
 * @param {{activeFunctionalGroupKey: string|null, activeFunctionalGroupMatchIndex: number}|null} snapshot - Snapshot object from `captureHighlightSnapshot`, or null to clear.
 * @param {object|null} mol - Current molecule to re-run SMARTS searches against.
 * @returns {boolean} True if a highlight was successfully restored, false otherwise.
 */
export function restoreHighlightSnapshot(snapshot, mol) {
  _clearActiveFunctionalGroupState();
  if (!mol) {
    clearHighlightState();
    return false;
  }
  _highlightMol = mol;
  if (snapshot?.activeFunctionalGroupKey) {
    _activeFunctionalGroupKey = snapshot.activeFunctionalGroupKey;
    _activeFunctionalGroupMatchIndex = snapshot.activeFunctionalGroupMatchIndex ?? 0;
  }
  updateFunctionalGroups(mol);
  if (_activeFunctionalGroupKey) {
    const activeFgRow = document.querySelector('#fg-body tr.fg-active');
    const activeFgMappings = _activeFunctionalGroupMappingsForRow(activeFgRow);
    if (activeFgMappings) {
      _setHighlight(activeFgMappings);
      return true;
    }
  }
  return false;
}

/**
 * Clears all highlight state including highlighted atom sets, the reference molecule, and the active functional-group selection.
 */
export function clearHighlightState() {
  _highlightedAtomIds.clear();
  _highlightedAtomSets = [];
  _highlightMol = null;
  _clearActiveFunctionalGroupState();
}
