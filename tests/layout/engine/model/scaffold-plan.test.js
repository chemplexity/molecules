import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { buildScaffoldPlan, classifyRingSystemFamily } from '../../../../src/layout/engine/model/scaffold-plan.js';
import { makeAdamantane, makeChain, makeCyclohexane, makeMethylbenzene, makeNaphthylbenzene, makeNorbornane } from '../support/molecules.js';

describe('layout/engine/model/scaffold-plan', () => {
  it('classifies ring-system families from ring topology', () => {
    const graph = createLayoutGraph(makeNaphthylbenzene());
    const firstRingSystem = graph.ringSystems.find(ringSystem => ringSystem.atomIds.includes('a0'));
    const secondRingSystem = graph.ringSystems.find(ringSystem => ringSystem.atomIds.includes('b0'));
    assert.equal(classifyRingSystemFamily(graph, firstRingSystem), 'fused');
    assert.equal(classifyRingSystemFamily(graph, secondRingSystem), 'isolated-ring');
  });

  it('routes fused-plus-spiro ring systems through the bridged fallback family', () => {
    const graph = createLayoutGraph(
      parseSMILES(
        String.raw`COC[C@H]1O[C@@H](O[C@@H]2OC[C@@H]3O[C@@]4(OC[C@@H](OC(=O)c5c(C)cc(O)cc5O)[C@@H]6OCO[C@@H]46)O[C@H]3[C@H]2OCCN=[N+]=[N-])[C@@H](OC)[C@@H](O)[C@@H]1O[C@@H]7O[C@H](C)[C@H](OC)[C@H](O[C@@H]8O[C@H](C)[C@H]9O[C@]%10(C[C@@H](O)[C@H](O[C@H]%11C[C@@H](O[C@H]%12C[C@@](C)([C@@H](OC)[C@H](C)O%12)[N+](=O)[O-])[C@H](OC(=O)c%13c(C)c(Cl)c(O)c(Cl)c%13OC)[C@@H](C)O%11)[C@@H](C)O%10)O[C@]9(C)[C@@H]8O)[C@@]7(C)O`
      ),
      { suppressH: true }
    );
    const hybridRingSystem = graph.ringSystems.find(ringSystem => ringSystem.ringIds.includes(1) && ringSystem.ringIds.includes(6) && ringSystem.ringIds.includes(12));
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    const pendingHybrid = plan.placementSequence.find(entry => entry.candidateId === `ring-system:${hybridRingSystem?.id}`);

    assert.ok(hybridRingSystem);
    assert.equal(classifyRingSystemFamily(graph, hybridRingSystem), 'bridged');
    assert.equal(pendingHybrid?.family, 'bridged');
  });

  it('builds a mixed scaffold plan with a ring root and chain follow-up', () => {
    const graph = createLayoutGraph(makeMethylbenzene());
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.type, 'ring-system');
    assert.equal(plan.rootScaffold.family, 'isolated-ring');
    assert.equal(plan.rootScaffold.templateId, 'benzene');
    assert.equal(plan.mixedMode, true);
    assert.deepEqual(
      plan.placementSequence.map(entry => entry.kind),
      ['root-scaffold', 'chains']
    );
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

  it('uses the tropane template for cocaine-like bridged mixed scaffolds', () => {
    const graph = createLayoutGraph(parseSMILES('CN1C2CCC1C(C(OC)=O)C(OC(c3ccccc3)=O)C2'));
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.family, 'bridged');
    assert.equal(plan.rootScaffold.templateId, 'tropane');
    assert.equal(plan.mixedMode, true);
  });

  it('uses the quinuclidine template for aza-bicyclo[2.2.2]octane cages', () => {
    const graph = createLayoutGraph(parseSMILES('C1CN2CCC1CC2'));
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.family, 'bridged');
    assert.equal(plan.rootScaffold.templateId, 'quinuclidine');
    assert.equal(plan.mixedMode, false);
  });

  it('uses the oxabicyclo[3.1.1]heptane template for bridged oxygen cages', () => {
    const graph = createLayoutGraph(parseSMILES('C1OC2CC(C1)C2'));
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.family, 'bridged');
    assert.equal(plan.rootScaffold.templateId, 'oxabicyclo-3-1-1');
    assert.equal(plan.mixedMode, false);
  });

  it('prefers the larger cage template when the bridged scaffold itself is larger', () => {
    const graph = createLayoutGraph(makeAdamantane());
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.family, 'bridged');
    assert.equal(plan.rootScaffold.templateId, 'adamantane');
    assert.equal(plan.rootScaffold.atomCount, 10);
  });

  it('promotes exact cage-template matches over a misleading fused heuristic family', () => {
    const graph = createLayoutGraph(parseSMILES('C12C3C4C1C5C4C3C25'));
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.family, 'bridged');
    assert.equal(plan.rootScaffold.templateId, 'cubane');
    assert.equal(plan.mixedMode, false);
    assert.deepEqual(plan.nonRingAtomIds, []);
  });

  it('records steroid-core templates for mixed fused steroid scaffolds', () => {
    const testosteroneGraph = createLayoutGraph(parseSMILES('C[C@]12CC[C@H]3[C@@H](CC=C4C[C@@H](O)CC[C@]34C)[C@@H]1CC[C@@H]2=O'));
    const testosteronePlan = buildScaffoldPlan(testosteroneGraph, testosteroneGraph.components[0]);
    assert.equal(testosteronePlan.rootScaffold.family, 'fused');
    assert.equal(testosteronePlan.rootScaffold.templateId, 'steroid-core-unsaturated');
    assert.equal(testosteronePlan.mixedMode, true);

    const saturatedGraph = createLayoutGraph(parseSMILES('C[C@]12CC[C@H]3[C@@H](CC[C@@H]4CC(=O)CC[C@]34C)[C@@H]1CC[C@@H]2O'));
    const saturatedPlan = buildScaffoldPlan(saturatedGraph, saturatedGraph.components[0]);
    assert.equal(saturatedPlan.rootScaffold.family, 'fused');
    assert.equal(saturatedPlan.rootScaffold.templateId, 'steroid-core-saturated');
    assert.equal(saturatedPlan.mixedMode, true);
  });

  it('prefers the indanone fused template when exocyclic ketone context is present', () => {
    const graph = createLayoutGraph(parseSMILES('O=C1CCc2ccccc21'));
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.family, 'fused');
    assert.equal(plan.rootScaffold.templateId, 'indanone');
    assert.equal(plan.mixedMode, true);
    assert.deepEqual(plan.nonRingAtomIds, ['O1']);
  });

  it('uses the fluorene fused template for the corpus fluorene SMILES spelling', () => {
    const graph = createLayoutGraph(parseSMILES('c1ccc2c(c1)Cc1ccccc1-2'));
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(graph.ringSystems.length, 1);
    assert.equal(plan.rootScaffold.family, 'fused');
    assert.equal(plan.rootScaffold.templateId, 'fluorene');
    assert.equal(plan.mixedMode, false);
  });

  it('uses the cinnoline fused template for the missing diazine isomer', () => {
    const graph = createLayoutGraph(parseSMILES('c1ccc2cnncc2c1'));
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.family, 'fused');
    assert.equal(plan.rootScaffold.templateId, 'cinnoline');
    assert.equal(plan.mixedMode, false);
  });

  it('promotes the porphine core from a bridged heuristic to the macrocycle template family', () => {
    const graph = createLayoutGraph(parseSMILES('C1=CC2=CC3=CC=C(N3)C=C4C=CC(=N4)C=C5C=CC(=N5)C=C1N2'));
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.family, 'macrocycle');
    assert.equal(plan.rootScaffold.templateId, 'porphine');
    assert.equal(plan.mixedMode, false);
  });

  it('falls back to an acyclic scaffold when the component is ring-free', () => {
    const graph = createLayoutGraph(makeChain(4));
    const plan = buildScaffoldPlan(graph, graph.components[0]);
    assert.equal(plan.rootScaffold.type, 'acyclic');
    assert.equal(plan.rootScaffold.family, 'acyclic');
    assert.equal(plan.mixedMode, false);
  });
});
