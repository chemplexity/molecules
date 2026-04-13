import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { findTemplateMatch } from '../../../../src/layout/engine/scaffold/template-match.js';
import { getTemplateById } from '../../../../src/layout/engine/templates/library.js';
import { makeBenzene } from '../support/molecules.js';

/**
 * Builds a ring-system candidate descriptor for the first ring system in a graph.
 * @param {object} graph - Layout graph shell.
 * @param {string} family - Candidate family label.
 * @returns {object} Ring-system candidate descriptor.
 */
function ringSystemCandidate(graph, family) {
  const ringSystem = graph.ringSystems[0];
  const atomIdSet = new Set(ringSystem.atomIds);
  const bondCount = [...graph.bonds.values()].filter(bond => atomIdSet.has(bond.a) && atomIdSet.has(bond.b)).length;
  return {
    type: 'ring-system',
    family,
    atomIds: ringSystem.atomIds,
    atomCount: ringSystem.atomIds.length,
    bondCount,
    ringCount: ringSystem.ringIds.length
  };
}

describe('layout/engine/scaffold/template-match', () => {
  it('finds the expected scaffold template for benzene', () => {
    const graph = createLayoutGraph(makeBenzene());
    const match = findTemplateMatch(graph, ringSystemCandidate(graph, 'isolated-ring'));
    assert.equal(match?.id, 'benzene');
  });

  it('does not match a graph-compatible template with the wrong heteroatom type', () => {
    const graph = createLayoutGraph(parseSMILES('c1ccoc1'));
    const candidate = ringSystemCandidate(graph, 'isolated-ring');
    const match = findTemplateMatch(graph, candidate, [getTemplateById('thiophene')]);

    assert.equal(match, null);
  });

  it('matches indole even when the fused ring system has extra substituents', () => {
    const graph = createLayoutGraph(parseSMILES('Cc1ccc2[nH]ccc2c1'));
    const match = findTemplateMatch(graph, ringSystemCandidate(graph, 'fused'));

    assert.equal(match?.id, 'indole');
  });
});
