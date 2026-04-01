import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../../src/core/index.js';
import { parseSMILES } from '../../src/io/index.js';
import { findSubgraphMappings, findFirstSubgraphMapping, matchesSubgraph } from '../../src/algorithms/vf2.js';
import {
  wildcardAtomMatch,
  wildcardBondMatch,
  elementOnlyAtomMatch,
  makeAtomMatcher
} from '../../src/algorithms/subgraph.js';

// ---------------------------------------------------------------------------
// Test molecule builders (no implicit H — use addBond with false flag)
// ---------------------------------------------------------------------------

function propane() {
  const mol = new Molecule();
  mol.addAtom('a0', 'C');
  mol.addAtom('a1', 'C');
  mol.addAtom('a2', 'C');
  mol.addBond('b0', 'a0', 'a1', { order: 1 }, false);
  mol.addBond('b1', 'a1', 'a2', { order: 1 }, false);
  return mol;
}

function singleCarbon() {
  const mol = new Molecule();
  mol.addAtom('c0', 'C');
  return mol;
}

function singleNitrogen() {
  const mol = new Molecule();
  mol.addAtom('n0', 'N');
  return mol;
}

function ethane() {
  const mol = new Molecule();
  mol.addAtom('a0', 'C');
  mol.addAtom('a1', 'C');
  mol.addBond('b0', 'a0', 'a1', { order: 1 }, false);
  return mol;
}

function ethene() {
  const mol = new Molecule();
  mol.addAtom('a0', 'C');
  mol.addAtom('a1', 'C');
  mol.addBond('b0', 'a0', 'a1', { order: 2 }, false);
  return mol;
}

function triangle() {
  const mol = new Molecule();
  mol.addAtom('a0', 'C');
  mol.addAtom('a1', 'C');
  mol.addAtom('a2', 'C');
  mol.addBond('b0', 'a0', 'a1', { order: 1 }, false);
  mol.addBond('b1', 'a1', 'a2', { order: 1 }, false);
  mol.addBond('b2', 'a2', 'a0', { order: 1 }, false);
  return mol;
}

/** Collects all mappings from a generator into an array. */
function collectAll(gen) {
  const results = [];
  for (const m of gen) {
    results.push(m);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Empty query
// ---------------------------------------------------------------------------

describe('findSubgraphMappings — empty query', () => {
  it('yields exactly one empty mapping for any target', () => {
    const results = collectAll(findSubgraphMappings(propane(), new Molecule()));
    assert.equal(results.length, 1);
    assert.equal(results[0].size, 0);
  });

  it('yields one empty mapping even for an empty target', () => {
    const results = collectAll(findSubgraphMappings(new Molecule(), new Molecule()));
    assert.equal(results.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Single-atom query
// ---------------------------------------------------------------------------

describe('findSubgraphMappings — single atom query', () => {
  it('single C query matches 3 times in propane (one per carbon)', () => {
    const results = collectAll(findSubgraphMappings(propane(), singleCarbon()));
    assert.equal(results.length, 3);
  });

  it('each mapping maps the query atom to a distinct target atom', () => {
    const results = collectAll(findSubgraphMappings(propane(), singleCarbon()));
    const targetIds = results.map(m => m.get('c0'));
    assert.equal(new Set(targetIds).size, 3);
  });

  it('single N query yields 0 matches in propane (no nitrogen)', () => {
    const results = collectAll(findSubgraphMappings(propane(), singleNitrogen()));
    assert.equal(results.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Bond order matching
// ---------------------------------------------------------------------------

describe('findSubgraphMappings — bond order matching', () => {
  it('C-C single bond query yields 4 directed matches in propane', () => {
    // Propane: a0-a1-a2.  Directed subgraph: (a0→a1), (a1→a0), (a1→a2), (a2→a1) = 4.
    const results = collectAll(findSubgraphMappings(propane(), ethane()));
    assert.equal(results.length, 4);
  });

  it('C=C double bond query yields 0 matches in propane (only single bonds)', () => {
    const results = collectAll(findSubgraphMappings(propane(), ethene()));
    assert.equal(results.length, 0);
  });

  it('C=C double bond query yields 2 directed matches in ethene', () => {
    const results = collectAll(findSubgraphMappings(ethene(), ethene()));
    assert.equal(results.length, 2);
  });
});

// ---------------------------------------------------------------------------
// Ring vs chain
// ---------------------------------------------------------------------------

describe('findSubgraphMappings — ring vs chain', () => {
  it('triangle query yields 0 matches in propane (acyclic)', () => {
    const results = collectAll(findSubgraphMappings(propane(), triangle()));
    assert.equal(results.length, 0);
  });

  it('triangle query matches cyclopropane (heavy-atom subgraph)', () => {
    const target = parseSMILES('C1CC1');
    const results = collectAll(findSubgraphMappings(target, triangle()));
    assert.ok(results.length > 0, 'triangle should appear in cyclopropane');
  });

  it('6-membered ring query (benzene heavy graph) is found in naphthalene', () => {
    const benzeneQuery = parseSMILES('c1ccccc1').stripHydrogens(); // strip so query has no H atoms
    const naphthalene = parseSMILES('c1ccc2ccccc2c1');
    assert.ok(matchesSubgraph(naphthalene, benzeneQuery));
  });
});

// ---------------------------------------------------------------------------
// matchesSubgraph (boolean API)
// ---------------------------------------------------------------------------

describe('matchesSubgraph', () => {
  it('returns true when query is found', () => {
    assert.equal(matchesSubgraph(propane(), singleCarbon()), true);
  });

  it('returns false when query is not found', () => {
    assert.equal(matchesSubgraph(propane(), singleNitrogen()), false);
  });

  it('aromatic C-C query matches benzene', () => {
    const aroCCQuery = new Molecule();
    aroCCQuery.addAtom('q0', 'C', { aromatic: true });
    aroCCQuery.addAtom('q1', 'C', { aromatic: true });
    aroCCQuery.addBond('bq0', 'q0', 'q1', { aromatic: true, order: 1.5 }, false);
    const benzene = parseSMILES('c1ccccc1');
    assert.equal(matchesSubgraph(benzene, aroCCQuery), true);
  });

  it('aromatic C-C query does not match cyclohexane (non-aromatic)', () => {
    const aroCCQuery = new Molecule();
    aroCCQuery.addAtom('q0', 'C', { aromatic: true });
    aroCCQuery.addAtom('q1', 'C', { aromatic: true });
    aroCCQuery.addBond('bq0', 'q0', 'q1', { aromatic: true, order: 1.5 }, false);
    const cyclohexane = parseSMILES('C1CCCCC1');
    assert.equal(matchesSubgraph(cyclohexane, aroCCQuery), false);
  });
});

// ---------------------------------------------------------------------------
// findFirstSubgraphMapping
// ---------------------------------------------------------------------------

describe('findFirstSubgraphMapping', () => {
  it('returns a Map when found', () => {
    const result = findFirstSubgraphMapping(propane(), singleCarbon());
    assert.ok(result instanceof Map);
    assert.equal(result.size, 1);
  });

  it('returns null when not found', () => {
    const result = findFirstSubgraphMapping(propane(), singleNitrogen());
    assert.equal(result, null);
  });

  it('does not enumerate all matches — terminates after first', () => {
    const target = parseSMILES('CCCCCC'); // hexane, 6 carbons
    const result = findFirstSubgraphMapping(target, singleCarbon());
    assert.ok(result !== null);
    assert.equal(result.size, 1);
  });
});

// ---------------------------------------------------------------------------
// Wildcard predicates
// ---------------------------------------------------------------------------

describe('findSubgraphMappings — wildcard predicates', () => {
  it('wildcardAtomMatch: C query matches N target atom', () => {
    const target = new Molecule();
    target.addAtom('n0', 'N');
    const results = collectAll(
      findSubgraphMappings(target, singleCarbon(), {
        atomMatch: wildcardAtomMatch,
        skipElementFilter: true
      })
    );
    assert.equal(results.length, 1);
  });

  it('wildcardAtomMatch + wildcardBondMatch: C-C query matches C-N bond', () => {
    const target = new Molecule();
    target.addAtom('c0', 'C');
    target.addAtom('n0', 'N');
    target.addBond('b0', 'c0', 'n0', { order: 1 }, false);
    const results = collectAll(
      findSubgraphMappings(target, ethane(), {
        atomMatch: wildcardAtomMatch,
        bondMatch: wildcardBondMatch,
        skipElementFilter: true
      })
    );
    assert.equal(results.length, 2); // 2 directed matches for a single bond
  });

  it('makeAtomMatcher({ element: "C" }) matches only C in methanol', () => {
    const target = parseSMILES('CO');
    const results = collectAll(
      findSubgraphMappings(target, singleCarbon(), {
        atomMatch: makeAtomMatcher({ element: 'C' }),
        skipElementFilter: true
      })
    );
    assert.equal(results.length, 1, 'only the C atom should match');
  });

  it('makeAtomMatcher({}) (no constraints) matches all atoms including H', () => {
    const target = parseSMILES('CO'); // C, O, 3×H(C), 1×H(O) = 6 atoms
    const results = collectAll(
      findSubgraphMappings(target, singleCarbon(), {
        atomMatch: makeAtomMatcher({}),
        skipElementFilter: true
      })
    );
    assert.equal(results.length, 6, 'all 6 atoms (C, O, 4 H) should match wildcard');
  });
});

describe('findSubgraphMappings — radical awareness', () => {
  it('does not match a closed-shell query atom to a radical target atom by default', () => {
    const target = new Molecule();
    target.addAtom('t0', 'C', { radical: 1 });
    const results = collectAll(findSubgraphMappings(target, singleCarbon()));
    assert.equal(results.length, 0);
  });

  it('does not match a radical query atom to a closed-shell target atom by default', () => {
    const query = singleCarbon();
    query.atoms.get('c0').setRadical(1);
    const results = collectAll(findSubgraphMappings(singleCarbon(), query));
    assert.equal(results.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Subgraph semantics — degree filter
// ---------------------------------------------------------------------------

describe('findSubgraphMappings — subgraph degree filter', () => {
  it('C-C query matches in neopentane (central C has degree 4 ≥ query degree 1)', () => {
    const target = parseSMILES('CC(C)(C)C');
    const results = collectAll(findSubgraphMappings(target, ethane()));
    assert.ok(results.length > 0, 'C-C query must appear in neopentane');
  });

  it('query larger than target yields nothing', () => {
    const results = collectAll(findSubgraphMappings(singleCarbon(), propane()));
    assert.equal(results.length, 0);
  });
});

// ---------------------------------------------------------------------------
// options.limit
// ---------------------------------------------------------------------------

describe('findSubgraphMappings — options.limit', () => {
  it('limit: 1 returns at most 1 mapping', () => {
    const results = collectAll(findSubgraphMappings(propane(), singleCarbon(), { limit: 1 }));
    assert.equal(results.length, 1);
  });

  it('limit: 2 returns at most 2 mappings', () => {
    const results = collectAll(findSubgraphMappings(propane(), singleCarbon(), { limit: 2 }));
    assert.equal(results.length, 2);
  });

  it('limit larger than match count returns all matches', () => {
    const results = collectAll(findSubgraphMappings(propane(), singleCarbon(), { limit: 999 }));
    assert.equal(results.length, 3);
  });
});

// ---------------------------------------------------------------------------
// elementOnlyAtomMatch (MCS use case)
// ---------------------------------------------------------------------------

describe('elementOnlyAtomMatch', () => {
  it('charged N+ in target matches uncharged N query', () => {
    const target = parseSMILES('[NH4+]');
    const query = singleNitrogen();
    const results = collectAll(
      findSubgraphMappings(target, query, {
        atomMatch: elementOnlyAtomMatch,
        skipElementFilter: true
      })
    );
    assert.equal(results.length, 1, 'elementOnlyAtomMatch should ignore charge');
  });

  it('aromatic C query does not match non-aromatic C by default (charge/aromaticity differs)', () => {
    // Default match: aromatic flag on query must match target
    const aroCQuery = new Molecule();
    aroCQuery.addAtom('q0', 'C', { aromatic: true });
    const target = parseSMILES('CC');
    assert.equal(matchesSubgraph(target, aroCQuery), false);
  });

  it('aromatic C query matches non-aromatic C with elementOnlyAtomMatch', () => {
    const aroCQuery = new Molecule();
    aroCQuery.addAtom('q0', 'C', { aromatic: true });
    const target = parseSMILES('CC');
    assert.equal(
      matchesSubgraph(target, aroCQuery, {
        atomMatch: elementOnlyAtomMatch,
        skipElementFilter: true
      }),
      true
    );
  });
});

// ---------------------------------------------------------------------------
// Molecule instance methods
// ---------------------------------------------------------------------------

describe('Molecule subgraph instance methods', () => {
  it('mol.matchesSubgraph(query) returns true when found', () => {
    assert.equal(propane().matchesSubgraph(singleCarbon()), true);
  });

  it('mol.matchesSubgraph(query) returns false when not found', () => {
    assert.equal(propane().matchesSubgraph(singleNitrogen()), false);
  });

  it('mol.findFirstSubgraphMapping(query) returns a Map or null', () => {
    const m = propane().findFirstSubgraphMapping(singleCarbon());
    assert.ok(m instanceof Map && m.size === 1);
    assert.equal(propane().findFirstSubgraphMapping(singleNitrogen()), null);
  });

  it('mol.findSubgraphMappings(query) is iterable', () => {
    const gen = propane().findSubgraphMappings(singleCarbon());
    assert.equal(typeof gen[Symbol.iterator], 'function');
    assert.equal(collectAll(gen).length, 3);
  });

  it('mol.findSubgraphMappings passes options through', () => {
    const all = collectAll(propane().findSubgraphMappings(singleCarbon(), { limit: 1 }));
    assert.equal(all.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Mapping correctness
// ---------------------------------------------------------------------------

describe('findSubgraphMappings — mapping correctness', () => {
  it('each mapping value is a valid atom ID in the target', () => {
    const target = propane();
    const targetIds = new Set(target.atoms.keys());
    for (const mapping of findSubgraphMappings(target, singleCarbon())) {
      for (const tId of mapping.values()) {
        assert.ok(targetIds.has(tId), `${tId} is not a valid target atom ID`);
      }
    }
  });

  it('each mapping key is a valid atom ID in the query', () => {
    const query = singleCarbon();
    const queryIds = new Set(query.atoms.keys());
    for (const mapping of findSubgraphMappings(propane(), query)) {
      for (const qId of mapping.keys()) {
        assert.ok(queryIds.has(qId), `${qId} is not a valid query atom ID`);
      }
    }
  });

  it('two-atom query: mapped atoms are adjacent in the target', () => {
    const target = propane();
    for (const mapping of findSubgraphMappings(target, ethane())) {
      const [tA, tB] = [...mapping.values()];
      const atomA = target.atoms.get(tA);
      const nbIds = atomA.getNeighbors(target).map(a => a.id);
      assert.ok(nbIds.includes(tB), `${tA} and ${tB} should be adjacent`);
    }
  });
});
