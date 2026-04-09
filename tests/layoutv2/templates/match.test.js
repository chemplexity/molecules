import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { findTemplateMatch } from '../../../src/layoutv2/templates/match.js';
import { makeAdamantane, makeBicyclo222, makeCyclohexane, makeMethylbenzene, makeNaphthylbenzene, makeNorbornane, makeSpiro } from '../support/molecules.js';

function countInternalBonds(layoutGraph, atomIds) {
  const atomIdSet = new Set(atomIds);
  let count = 0;
  for (const bond of layoutGraph.bonds.values()) {
    if (atomIdSet.has(bond.a) && atomIdSet.has(bond.b)) {
      count++;
    }
  }
  return count;
}

function buildRingCandidate(layoutGraph, ringSystem, family) {
  return {
    id: `ring-system:${ringSystem.id}`,
    type: 'ring-system',
    family,
    atomIds: [...ringSystem.atomIds],
    ringIds: [...ringSystem.ringIds],
    atomCount: ringSystem.atomIds.length,
    bondCount: countInternalBonds(layoutGraph, ringSystem.atomIds),
    ringCount: ringSystem.ringIds.length
  };
}

describe('layoutv2/templates/match', () => {
  it('matches an isolated aromatic six-membered ring to the benzene template', () => {
    const graph = createLayoutGraph(makeMethylbenzene());
    const candidate = buildRingCandidate(graph, graph.ringSystems[0], 'isolated-ring');
    const match = findTemplateMatch(graph, candidate);
    assert.equal(match.id, 'benzene');
  });

  it('matches a fused aromatic bicyclic scaffold to the naphthalene template', () => {
    const graph = createLayoutGraph(makeNaphthylbenzene());
    const candidate = buildRingCandidate(graph, graph.ringSystems.find(ringSystem => ringSystem.atomIds.includes('a0')), 'fused');
    const match = findTemplateMatch(graph, candidate);
    assert.equal(match.id, 'naphthalene');
  });

  it('matches common saturated and spiro ring systems too', () => {
    const cyclohexaneGraph = createLayoutGraph(makeCyclohexane());
    const cyclohexaneMatch = findTemplateMatch(cyclohexaneGraph, buildRingCandidate(cyclohexaneGraph, cyclohexaneGraph.ringSystems[0], 'isolated-ring'));
    assert.equal(cyclohexaneMatch.id, 'cyclohexane');

    const spiroGraph = createLayoutGraph(makeSpiro());
    const spiroMatch = findTemplateMatch(spiroGraph, buildRingCandidate(spiroGraph, spiroGraph.ringSystems[0], 'spiro'));
    assert.equal(spiroMatch.id, 'spiro-5-5');
  });

  it('matches a bridged norbornane-like scaffold too', () => {
    const graph = createLayoutGraph(makeNorbornane());
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'norbornane');
  });

  it('matches larger bridged and cage scaffolds too', () => {
    const bicycloGraph = createLayoutGraph(makeBicyclo222());
    const bicycloMatch = findTemplateMatch(bicycloGraph, buildRingCandidate(bicycloGraph, bicycloGraph.ringSystems[0], 'bridged'));
    assert.equal(bicycloMatch.id, 'bicyclo-2-2-2');

    const adamantaneGraph = createLayoutGraph(makeAdamantane());
    const adamantaneMatch = findTemplateMatch(adamantaneGraph, buildRingCandidate(adamantaneGraph, adamantaneGraph.ringSystems[0], 'bridged'));
    assert.equal(adamantaneMatch.id, 'adamantane');
  });
});
