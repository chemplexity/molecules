import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { buildScaffoldPlan, classifyRingSystemFamily } from '../../../src/layoutv2/model/scaffold-plan.js';
import { makeAdamantane, makeChain, makeCyclohexane, makeMethylbenzene, makeNaphthylbenzene, makeNorbornane } from '../support/molecules.js';

describe('layoutv2/model/scaffold-plan', () => {
  it('classifies ring-system families from ring topology', () => {
    const graph = createLayoutGraph(makeNaphthylbenzene());
    const firstRingSystem = graph.ringSystems.find(ringSystem => ringSystem.atomIds.includes('a0'));
    const secondRingSystem = graph.ringSystems.find(ringSystem => ringSystem.atomIds.includes('b0'));
    assert.equal(classifyRingSystemFamily(graph, firstRingSystem), 'fused');
    assert.equal(classifyRingSystemFamily(graph, secondRingSystem), 'isolated-ring');
  });

  it('builds a mixed scaffold plan with a ring root and chain follow-up', () => {
    const graph = createLayoutGraph(makeMethylbenzene());
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.type, 'ring-system');
    assert.equal(plan.rootScaffold.family, 'isolated-ring');
    assert.equal(plan.rootScaffold.templateId, 'benzene');
    assert.equal(plan.mixedMode, true);
    assert.deepEqual(plan.placementSequence.map(entry => entry.kind), ['root-scaffold', 'chains']);
    assert.deepEqual(plan.nonRingAtomIds, ['a6']);
  });

  it('prefers the larger fused scaffold over a smaller attached ring system', () => {
    const graph = createLayoutGraph(makeNaphthylbenzene());
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.family, 'fused');
    assert.equal(plan.rootScaffold.templateId, 'naphthalene');
    assert.equal(plan.rootScaffold.atomCount, 10);
    assert.equal(plan.placementSequence[1].kind, 'ring-system');
    assert.equal(plan.placementSequence[1].family, 'isolated-ring');
  });

  it('records template matches for common saturated ring scaffolds too', () => {
    const graph = createLayoutGraph(makeCyclohexane());
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.templateId, 'cyclohexane');
  });

  it('recognizes bridged ring systems as template-backed root scaffolds too', () => {
    const graph = createLayoutGraph(makeNorbornane());
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.family, 'bridged');
    assert.equal(plan.rootScaffold.templateId, 'norbornane');
  });

  it('prefers the larger cage template when the bridged scaffold itself is larger', () => {
    const graph = createLayoutGraph(makeAdamantane());
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.family, 'bridged');
    assert.equal(plan.rootScaffold.templateId, 'adamantane');
    assert.equal(plan.rootScaffold.atomCount, 10);
  });

  it('falls back to an acyclic scaffold when the component is ring-free', () => {
    const graph = createLayoutGraph(makeChain(4));
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.type, 'acyclic');
    assert.equal(plan.rootScaffold.family, 'acyclic');
    assert.equal(plan.mixedMode, false);
  });
});
