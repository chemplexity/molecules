/** @module algorithms/vf2 */

import { defaultAtomMatch, defaultBondMatch } from './subgraph.js';

// ---------------------------------------------------------------------------
// Adjacency index
// ---------------------------------------------------------------------------

/**
 * @typedef {object} MolIndex
 * @property {Map<string, Set<string>>}          neighborSet     atomId → Set of neighbor IDs
 * @property {Map<string, Map<string, string>>}  neighborToBond  atomId → (neighborId → bondId)
 * @property {Map<string, import('../core/Atom.js').Atom>}  atoms
 * @property {Map<string, import('../core/Bond.js').Bond>}  bonds
 * @property {Map<string, number>}               degreeMap       atomId → degree
 * @property {Map<string, number>}               elementCount    element → count
 */

/**
 * Builds an O(V+E) adjacency index for a molecule.
 * Constructed once per `findSubgraphMappings` call for both the query and
 * target; not cached on the Molecule instance (which is mutable).
 *
 * @param {import('../core/Molecule.js').Molecule} mol
 * @returns {MolIndex}
 */
function _buildIndex(mol) {
  /** @type {Map<string, Set<string>>} */
  const neighborSet = new Map();
  /** @type {Map<string, Map<string, string>>} */
  const neighborToBond = new Map();
  /** @type {Map<string, number>} */
  const elementCount = new Map();

  for (const [id, atom] of mol.atoms) {
    neighborSet.set(id, new Set());
    neighborToBond.set(id, new Map());
    elementCount.set(atom.name, (elementCount.get(atom.name) ?? 0) + 1);
  }

  for (const [bondId, bond] of mol.bonds) {
    const [a, b] = bond.atoms;
    if (!neighborSet.has(a) || !neighborSet.has(b)) {
      continue; // dangling bond — skip
    }
    neighborSet.get(a).add(b);
    neighborSet.get(b).add(a);
    neighborToBond.get(a).set(b, bondId);
    neighborToBond.get(b).set(a, bondId);
  }

  const degreeMap = new Map();
  for (const [id] of mol.atoms) {
    degreeMap.set(id, neighborSet.get(id).size);
  }

  return { neighborSet, neighborToBond, atoms: mol.atoms, bonds: mol.bonds, degreeMap, elementCount };
}

// ---------------------------------------------------------------------------
// Query atom ordering — BFS from highest-degree root
// ---------------------------------------------------------------------------

/**
 * Returns query atom IDs sorted for optimal VF2 performance.
 *
 * Strategy: start BFS from the highest-degree atom (largest branching
 * factor eliminated first); within each BFS level sort by degree descending
 * (maximises look-ahead pruning effectiveness).  Disconnected components are
 * appended after, also sorted by degree.
 *
 * @param {MolIndex} idx
 * @returns {string[]}
 */
function _queryOrder(idx) {
  const ids = [...idx.atoms.keys()];
  if (ids.length === 0) {
    return ids;
  }

  // Pick the atom with the highest degree as BFS root.
  ids.sort((a, b) => idx.degreeMap.get(b) - idx.degreeMap.get(a));
  const root = ids[0];

  const ordered = [];
  const visited = new Set([root]);
  const queue = [root];

  while (queue.length > 0) {
    const cur = queue.shift();
    ordered.push(cur);
    // Sort neighbours by degree descending before enqueuing.
    const nbs = [...idx.neighborSet.get(cur)].filter(nb => !visited.has(nb)).sort((a, b) => idx.degreeMap.get(b) - idx.degreeMap.get(a));
    for (const nb of nbs) {
      visited.add(nb);
      queue.push(nb);
    }
  }

  // Append atoms in disconnected components (e.g. disconnected query graphs).
  for (const id of ids) {
    if (!visited.has(id)) {
      ordered.push(id);
    }
  }

  return ordered;
}

// ---------------------------------------------------------------------------
// Element frequency pre-filter
// ---------------------------------------------------------------------------

/**
 * Returns `false` when the target provably cannot contain the query because
 * it lacks sufficient atoms of some element.  Runs in O(distinct elements
 * in query).  Only valid when `atomMatch === defaultAtomMatch` (exact
 * element matching); pass `skipElementFilter: true` for wildcards.
 *
 * @param {MolIndex} queryIdx
 * @param {MolIndex} targetIdx
 * @returns {boolean}
 */
function _elementFrequencyOk(queryIdx, targetIdx) {
  for (const [el, count] of queryIdx.elementCount) {
    if ((targetIdx.elementCount.get(el) ?? 0) < count) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Feasibility check (VF2 1-look-ahead)
// ---------------------------------------------------------------------------

/**
 * Tests whether extending the current mapping with `(qId → tId)` is
 * locally consistent:
 *
 * 1. Atom labels must be compatible (`atomMatch`).
 * 2. For every already-mapped neighbour `qNb` of `qId`, its image `tNb`
 *    must be adjacent to `tId`, and the bond `(tId, tNb)` must be
 *    compatible with `(qId, qNb)`.
 *
 * @param {object}   state
 * @param {string}   qId
 * @param {string}   tId
 * @returns {boolean}
 */
function _feasible(state, qId, tId) {
  const { queryIdx, targetIdx, queryToTarget, atomMatch, bondMatch } = state;

  if (!atomMatch(queryIdx.atoms.get(qId), targetIdx.atoms.get(tId))) {
    return false;
  }

  const qNeighbors = queryIdx.neighborSet.get(qId);
  const tNeighbors = targetIdx.neighborSet.get(tId);

  for (const [qNb, tNb] of queryToTarget) {
    if (!qNeighbors.has(qNb)) {
      continue; // qNb is not a neighbour of qId — skip
    }
    // The mapped neighbour tNb must be adjacent to tId.
    if (!tNeighbors.has(tNb)) {
      return false;
    }
    // Bond compatibility check.
    const qBondId = queryIdx.neighborToBond.get(qId).get(qNb);
    const tBondId = targetIdx.neighborToBond.get(tId).get(tNb);
    if (!bondMatch(queryIdx.bonds.get(qBondId), targetIdx.bonds.get(tBondId))) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

/**
 * Returns candidate target atom IDs for mapping `queryOrder[depth]`.
 *
 * When `targetFrontier` is non-empty (atoms adjacent to the already-mapped
 * target subgraph), only frontier atoms are considered — this is the VF2
 * connectivity constraint that keeps the search space small.  When the
 * frontier is empty (first atom, or disconnected query graph) all unmapped
 * target atoms are candidates.
 *
 * Degree filter: a query atom of degree d can only map to a target atom
 * with degree ≥ d (subgraph, not induced-subgraph semantics).
 *
 * @param {object} state
 * @param {number} depth
 * @returns {string[]}
 */
function _candidates(state, depth) {
  const qId = state.queryOrder[depth];
  const qDeg = state.queryIdx.degreeMap.get(qId);
  const mapped = state.targetToQuery;
  const qHasMappedNeighbor = [...state.queryIdx.neighborSet.get(qId)].some(qNb => state.queryToTarget.has(qNb));

  const pool = qHasMappedNeighbor && state.targetFrontier.size > 0 ? state.targetFrontier : state.targetIdx.atoms.keys();

  const result = [];
  for (const tId of pool) {
    if (mapped.has(tId)) {
      continue;
    }
    if (state.targetIdx.degreeMap.get(tId) < qDeg) {
      continue; // degree filter
    }
    result.push(tId);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core VF2 recursive generator
// ---------------------------------------------------------------------------

/**
 * @param {object} state  Mutable VF2 state (modified in-place and restored).
 * @param {number} depth  Index into `state.queryOrder` being matched.
 * @yields {Map<string, string>}  Complete query→target atom-ID mappings.
 */
function* _vf2(state, depth) {
  if (depth === state.queryOrder.length) {
    // All query atoms mapped — yield a snapshot of the current mapping.
    yield new Map(state.queryToTarget);
    return;
  }

  const qId = state.queryOrder[depth];

  for (const tId of _candidates(state, depth)) {
    if (!_feasible(state, qId, tId)) {
      continue;
    }

    // ── Extend the mapping ──────────────────────────────────────────────
    state.queryToTarget.set(qId, tId);
    state.targetToQuery.set(tId, qId);

    const wasInQFrontier = state.queryFrontier.has(qId);
    const wasInTFrontier = state.targetFrontier.has(tId);
    state.queryFrontier.delete(qId);
    state.targetFrontier.delete(tId);

    const addedQ = [];
    for (const qNb of state.queryIdx.neighborSet.get(qId)) {
      if (!state.queryToTarget.has(qNb) && !state.queryFrontier.has(qNb)) {
        state.queryFrontier.add(qNb);
        addedQ.push(qNb);
      }
    }
    const addedT = [];
    for (const tNb of state.targetIdx.neighborSet.get(tId)) {
      if (!state.targetToQuery.has(tNb) && !state.targetFrontier.has(tNb)) {
        state.targetFrontier.add(tNb);
        addedT.push(tNb);
      }
    }

    // ── Recurse ─────────────────────────────────────────────────────────
    yield* _vf2(state, depth + 1);

    // ── Backtrack ───────────────────────────────────────────────────────
    state.queryToTarget.delete(qId);
    state.targetToQuery.delete(tId);

    for (const id of addedQ) {
      state.queryFrontier.delete(id);
    }
    for (const id of addedT) {
      state.targetFrontier.delete(id);
    }
    if (wasInQFrontier) {
      state.queryFrontier.add(qId);
    }
    if (wasInTFrontier) {
      state.targetFrontier.add(tId);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generator that yields every injective mapping from `query` atoms into
 * `target` atoms that satisfies the given compatibility predicates.
 *
 * Each yielded value is a `Map<queryAtomId, targetAtomId>`.  The generator
 * is lazy: pulling one value with `generator.next()` or using `{ limit: 1 }`
 * in the options terminates as soon as the first match is found.
 *
 * **Options:**
 * - `atomMatch`          `(qAtom, tAtom) => boolean` — defaults to exact element/charge/aromatic match
 * - `bondMatch`          `(qBond, tBond) => boolean` — defaults to exact order/aromatic match
 * - `limit`              `number` — stop after this many mappings (default: `Infinity`)
 * - `skipElementFilter`  `boolean` — disable the O(n) element-frequency pre-filter
 *                        (required when using wildcard or SMARTS atom predicates)
 *
 * @param {import('../core/Molecule.js').Molecule} target
 * @param {import('../core/Molecule.js').Molecule} query
 * @param {object} [options]
 * @param {function} [options.atomMatch]
 * @param {function} [options.bondMatch]
 * @param {number}   [options.limit=Infinity]
 * @param {boolean}  [options.skipElementFilter=false]
 * @yields {Map<string, string>}
 */
export function* findSubgraphMappings(target, query, options = {}) {
  const { atomMatch = defaultAtomMatch, bondMatch = defaultBondMatch, limit = Infinity, skipElementFilter = false } = options;

  // Trivial case: empty query matches everything once.
  if (query.atoms.size === 0) {
    yield new Map();
    return;
  }

  // Fast size guard.
  if (query.atoms.size > target.atoms.size) {
    return;
  }
  if (query.bonds.size > target.bonds.size) {
    return;
  }

  const queryIdx = _buildIndex(query);
  const targetIdx = _buildIndex(target);

  // O(n) element-frequency rejection.
  if (!skipElementFilter && !_elementFrequencyOk(queryIdx, targetIdx)) {
    return;
  }

  const queryOrder = _queryOrder(queryIdx);

  const state = {
    queryToTarget: new Map(),
    targetToQuery: new Map(),
    queryFrontier: new Set(),
    targetFrontier: new Set(),
    queryOrder,
    queryIdx,
    targetIdx,
    atomMatch,
    bondMatch
  };

  let count = 0;
  for (const mapping of _vf2(state, 0)) {
    yield mapping;
    if (++count >= limit) {
      return;
    }
  }
}

/**
 * Returns the first mapping from `query` into `target`, or `null` if none
 * exists.  Equivalent to consuming the first value from
 * `findSubgraphMappings(target, query, { ...options, limit: 1 })`.
 *
 * @param {import('../core/Molecule.js').Molecule} target
 * @param {import('../core/Molecule.js').Molecule} query
 * @param {object} [options]
 * @returns {Map<string, string>|null}
 */
export function findFirstSubgraphMapping(target, query, options = {}) {
  for (const m of findSubgraphMappings(target, query, { ...options, limit: 1 })) {
    return m;
  }
  return null;
}

/**
 * Returns `true` if `query` is isomorphic to some subgraph of `target`.
 *
 * @param {import('../core/Molecule.js').Molecule} target
 * @param {import('../core/Molecule.js').Molecule} query
 * @param {object} [options]
 * @returns {boolean}
 */
export function matchesSubgraph(target, query, options = {}) {
  return findFirstSubgraphMapping(target, query, options) !== null;
}
