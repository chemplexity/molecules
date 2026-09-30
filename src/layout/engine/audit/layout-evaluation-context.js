/** @module audit/layout-evaluation-context */

import { buildAtomGrid, buildSubtreeOverlapContext, findSevereOverlaps, measureLayoutState, measureOverlapState } from './invariants.js';

/**
 * Shared read-only evaluation scratch for one layout coordinate state.
 *
 * Cleanup passes tend to need the same layout-visible atom lists, heavy-atom
 * subset, and spatial grid several times while evaluating candidates from one
 * base coordinate map. This context owns those derived structures so callers
 * do not each rebuild them ad hoc.
 */
export class LayoutEvaluationContext {
  constructor(layoutGraph, coords, options = {}) {
    this.layoutGraph = layoutGraph;
    this.coords = coords;
    this.bondLength = options.bondLength ?? layoutGraph.options.bondLength;
    this._layoutAtomIds = options.layoutAtomIds ?? null;
    this._visibleHeavyAtomIds = options.visibleHeavyAtomIds ?? null;
    this._displayAtomCounts = options.displayAtomCounts ?? null;
    this._atomGrid = options.atomGrid ?? null;
    this._subtreeOverlapContexts = new Map();
  }

  layoutAtomIds() {
    if (this._layoutAtomIds) {
      return this._layoutAtomIds;
    }
    const atomIds = [];
    for (const atom of this.layoutGraph.atoms.values()) {
      if (this.layoutGraph.options.suppressH && atom.element === 'H') {
        continue;
      }
      if (this.coords.has(atom.id)) {
        atomIds.push(atom.id);
      }
    }
    this._layoutAtomIds = atomIds;
    return atomIds;
  }

  visibleHeavyAtomIds() {
    if (this._visibleHeavyAtomIds) {
      return this._visibleHeavyAtomIds;
    }
    const atomIds = [];
    for (const atomId of this.layoutAtomIds()) {
      if (this.layoutGraph.atoms.get(atomId)?.element !== 'H') {
        atomIds.push(atomId);
      }
    }
    this._visibleHeavyAtomIds = atomIds;
    return atomIds;
  }

  displayAtomCounts() {
    if (this._displayAtomCounts) {
      return this._displayAtomCounts;
    }
    let visibleAtomCount = 0;
    let visibleHeavyAtomCount = 0;
    for (const atom of this.layoutGraph.atoms.values()) {
      if (!atom.visible) {
        continue;
      }
      visibleAtomCount++;
      if (atom.element !== 'H') {
        visibleHeavyAtomCount++;
      }
    }
    this._displayAtomCounts = { visibleAtomCount, visibleHeavyAtomCount };
    return this._displayAtomCounts;
  }

  atomGrid() {
    if (!this._atomGrid) {
      this._atomGrid = buildAtomGrid(this.layoutGraph, this.coords, this.bondLength, {
        visibleAtomIds: this.layoutAtomIds()
      });
    }
    return this._atomGrid;
  }

  findSevereOverlaps(options = {}) {
    const atomGrid = options.atomGrid ?? this.atomGrid();
    return findSevereOverlaps(this.layoutGraph, this.coords, this.bondLength, {
      ...options,
      atomGrid,
      visibleHeavyAtomIds: options.visibleHeavyAtomIds ?? this.visibleHeavyAtomIds(),
      visibleAtomIdsMatchGrid: options.visibleAtomIdsMatchGrid ?? atomGrid === this._atomGrid
    });
  }

  measureOverlapState(options = {}) {
    const atomGrid = options.atomGrid ?? this.atomGrid();
    return measureOverlapState(this.layoutGraph, this.coords, this.bondLength, {
      ...options,
      atomGrid,
      visibleHeavyAtomIds: options.visibleHeavyAtomIds ?? this.visibleHeavyAtomIds(),
      visibleAtomIdsMatchGrid: options.visibleAtomIdsMatchGrid ?? atomGrid === this._atomGrid
    });
  }

  measureLayoutState(options = {}) {
    const atomGrid = options.atomGrid ?? this.atomGrid();
    return measureLayoutState(this.layoutGraph, this.coords, this.bondLength, {
      ...options,
      atomGrid,
      visibleHeavyAtomIds: options.visibleHeavyAtomIds ?? this.visibleHeavyAtomIds(),
      visibleAtomIdsMatchGrid: options.visibleAtomIdsMatchGrid ?? atomGrid === this._atomGrid
    });
  }

  subtreeOverlapContext(subtreeAtomIds, options = {}) {
    const includeBondCrowding = options.includeBondCrowding === true;
    const key = `${includeBondCrowding ? 'bonds' : 'atoms'}:${[...subtreeAtomIds].join('|')}`;
    let context = this._subtreeOverlapContexts.get(key);
    if (!context) {
      context = buildSubtreeOverlapContext(this.layoutGraph, subtreeAtomIds, options);
      this._subtreeOverlapContexts.set(key, context);
    }
    return context;
  }

  /**
   * Creates evaluation scratch for a new coordinate state. Atom membership is
   * coordinate-dependent, so lists and spatial grids must be rebuilt unless the
   * caller supplies replacements valid for the new state. Graph-only display
   * counts may be reused; the graph is assumed unchanged and contexts read-only.
   * @param {Map<string, {x: number, y: number}>} coords - Replacement coordinates.
   * @param {object} [options] - Optional scratch validated for the replacement state.
   * @param {string[]} [options.layoutAtomIds] - Replacement layout atom IDs.
   * @param {string[]} [options.visibleHeavyAtomIds] - Replacement heavy atom IDs.
   * @param {object} [options.displayAtomCounts] - Replacement graph display counts.
   * @param {object} [options.atomGrid] - Spatial grid for the replacement coordinates.
   * @returns {LayoutEvaluationContext} Independent evaluation context.
   */
  withCoords(coords, options = {}) {
    return new LayoutEvaluationContext(this.layoutGraph, coords, {
      bondLength: this.bondLength,
      layoutAtomIds: options.layoutAtomIds ?? null,
      visibleHeavyAtomIds: options.visibleHeavyAtomIds ?? null,
      displayAtomCounts: options.displayAtomCounts ?? this._displayAtomCounts,
      atomGrid: options.atomGrid ?? null
    });
  }
}

/**
 * Builds a shared evaluation context for one coordinate state.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} coords - Coordinate map to evaluate.
 * @param {object} [options] - Optional precomputed evaluation scratch.
 * @returns {LayoutEvaluationContext} Shared layout evaluation context.
 */
export function createLayoutEvaluationContext(layoutGraph, coords, options = {}) {
  return new LayoutEvaluationContext(layoutGraph, coords, options);
}
