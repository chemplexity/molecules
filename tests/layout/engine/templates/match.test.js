import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { getTemplateById } from '../../../../src/layout/engine/templates/library.js';
import { findTemplateMatch, findTemplateMatchIgnoringFamily } from '../../../../src/layout/engine/templates/match.js';
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

describe('layout/engine/templates/match', () => {
  it('matches an isolated aromatic six-membered ring to the benzene template', () => {
    const graph = createLayoutGraph(makeMethylbenzene());
    const candidate = buildRingCandidate(graph, graph.ringSystems[0], 'isolated-ring');
    const match = findTemplateMatch(graph, candidate);
    assert.equal(match.id, 'benzene');
  });

  it('matches a fused aromatic bicyclic scaffold to the naphthalene template', () => {
    const graph = createLayoutGraph(makeNaphthylbenzene());
    const candidate = buildRingCandidate(
      graph,
      graph.ringSystems.find(ringSystem => ringSystem.atomIds.includes('a0')),
      'fused'
    );
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

  it('matches common isolated aromatic heterocycles too', () => {
    const pyridineGraph = createLayoutGraph(parseSMILES('c1ccncc1'));
    const pyridineMatch = findTemplateMatch(pyridineGraph, buildRingCandidate(pyridineGraph, pyridineGraph.ringSystems[0], 'isolated-ring'));
    assert.equal(pyridineMatch.id, 'pyridine');

    const triazineGraph = createLayoutGraph(parseSMILES('n1ncncc1'));
    const triazineMatch = findTemplateMatch(triazineGraph, buildRingCandidate(triazineGraph, triazineGraph.ringSystems[0], 'isolated-ring'));
    assert.equal(triazineMatch.id, 'triazine-1-2-4');

    const thiopheneGraph = createLayoutGraph(parseSMILES('c1ccsc1'));
    const thiopheneMatch = findTemplateMatch(thiopheneGraph, buildRingCandidate(thiopheneGraph, thiopheneGraph.ringSystems[0], 'isolated-ring'));
    assert.equal(thiopheneMatch.id, 'thiophene');

    const thiazoleGraph = createLayoutGraph(parseSMILES('s1cncc1'));
    const thiazoleMatch = findTemplateMatch(thiazoleGraph, buildRingCandidate(thiazoleGraph, thiazoleGraph.ringSystems[0], 'isolated-ring'));
    assert.equal(thiazoleMatch.id, 'thiazole');

    const imidazoleGraph = createLayoutGraph(parseSMILES('[nH]1cncc1'));
    const imidazoleMatch = findTemplateMatch(imidazoleGraph, buildRingCandidate(imidazoleGraph, imidazoleGraph.ringSystems[0], 'isolated-ring'));
    assert.equal(imidazoleMatch.id, 'imidazole');

    const triazoleGraph = createLayoutGraph(parseSMILES('n1nc[nH]c1'));
    const triazoleMatch = findTemplateMatch(triazoleGraph, buildRingCandidate(triazoleGraph, triazoleGraph.ringSystems[0], 'isolated-ring'));
    assert.equal(triazoleMatch.id, 'triazole-1-2-4');
  });

  it('matches common fused heterobicycles too', () => {
    const quinolineGraph = createLayoutGraph(parseSMILES('c1ccc2ncccc2c1'));
    const quinolineMatch = findTemplateMatch(quinolineGraph, buildRingCandidate(quinolineGraph, quinolineGraph.ringSystems[0], 'fused'));
    assert.equal(quinolineMatch.id, 'quinoline');

    const isoquinolineGraph = createLayoutGraph(parseSMILES('c1ccc2cnccc2c1'));
    const isoquinolineMatch = findTemplateMatch(isoquinolineGraph, buildRingCandidate(isoquinolineGraph, isoquinolineGraph.ringSystems[0], 'fused'));
    assert.equal(isoquinolineMatch.id, 'isoquinoline');

    const indoleGraph = createLayoutGraph(parseSMILES('c1ccc2[nH]ccc2c1'));
    const indoleMatch = findTemplateMatch(indoleGraph, buildRingCandidate(indoleGraph, indoleGraph.ringSystems[0], 'fused'));
    assert.equal(indoleMatch.id, 'indole');

    const benzimidazoleGraph = createLayoutGraph(parseSMILES('c1ccc2[nH]cnc2c1'));
    const benzimidazoleMatch = findTemplateMatch(benzimidazoleGraph, buildRingCandidate(benzimidazoleGraph, benzimidazoleGraph.ringSystems[0], 'fused'));
    assert.equal(benzimidazoleMatch.id, 'benzimidazole');

    const benzimidazoliumGraph = createLayoutGraph(parseSMILES('c1ccc2[nH+]cnc2c1'));
    const benzimidazoliumMatch = findTemplateMatch(benzimidazoliumGraph, buildRingCandidate(benzimidazoliumGraph, benzimidazoliumGraph.ringSystems[0], 'fused'));
    assert.equal(benzimidazoliumMatch.id, 'benzimidazolium');

    const indazoleGraph = createLayoutGraph(parseSMILES('c1ccc2[nH]ncc2c1'));
    const indazoleMatch = findTemplateMatch(indazoleGraph, buildRingCandidate(indazoleGraph, indazoleGraph.ringSystems[0], 'fused'));
    assert.equal(indazoleMatch.id, 'indazole');

    const benzotriazoleGraph = createLayoutGraph(parseSMILES('c1ccc2[nH]nnc2c1'));
    const benzotriazoleMatch = findTemplateMatch(benzotriazoleGraph, buildRingCandidate(benzotriazoleGraph, benzotriazoleGraph.ringSystems[0], 'fused'));
    assert.equal(benzotriazoleMatch.id, 'benzotriazole');

    const purineGraph = createLayoutGraph(parseSMILES('c1ncc2[nH]cnc2n1'));
    const purineMatch = findTemplateMatch(purineGraph, buildRingCandidate(purineGraph, purineGraph.ringSystems[0], 'fused'));
    assert.equal(purineMatch.id, 'purine');

    const quinazolineGraph = createLayoutGraph(parseSMILES('c1ccc2ncncc2c1'));
    const quinazolineMatch = findTemplateMatch(quinazolineGraph, buildRingCandidate(quinazolineGraph, quinazolineGraph.ringSystems[0], 'fused'));
    assert.equal(quinazolineMatch.id, 'quinazoline');

    const quinoxalineGraph = createLayoutGraph(parseSMILES('c1ccc2nccnc2c1'));
    const quinoxalineMatch = findTemplateMatch(quinoxalineGraph, buildRingCandidate(quinoxalineGraph, quinoxalineGraph.ringSystems[0], 'fused'));
    assert.equal(quinoxalineMatch.id, 'quinoxaline');

    const acridineGraph = createLayoutGraph(parseSMILES('c1ccc2nc3ccccc3cc2c1'));
    const acridineMatch = findTemplateMatch(acridineGraph, buildRingCandidate(acridineGraph, acridineGraph.ringSystems[0], 'fused'));
    assert.equal(acridineMatch.id, 'acridine');

    const anthraceneGraph = createLayoutGraph(parseSMILES('c1ccc2cc3ccccc3cc2c1'));
    const anthraceneMatch = findTemplateMatch(anthraceneGraph, buildRingCandidate(anthraceneGraph, anthraceneGraph.ringSystems[0], 'fused'));
    assert.equal(anthraceneMatch.id, 'anthracene');

    const pyreneGraph = createLayoutGraph(parseSMILES('c1cc2ccc3cccc4ccc(c1)c2c34'));
    const pyreneMatch = findTemplateMatch(pyreneGraph, buildRingCandidate(pyreneGraph, pyreneGraph.ringSystems[0], 'fused'));
    assert.equal(pyreneMatch.id, 'pyrene');

    const peryleneGraph = createLayoutGraph(parseSMILES('C1=CC=C2C(=C1)C=C1C=CC3=CC=CC4=CC=C2C1=C34'));
    const peryleneMatch = findTemplateMatch(peryleneGraph, buildRingCandidate(peryleneGraph, peryleneGraph.ringSystems[0], 'fused'));
    assert.equal(peryleneMatch.id, 'perylene');

    const fluoreneGraph = createLayoutGraph(parseSMILES('c1ccc2c(c1)Cc1ccccc1-2'));
    const fluoreneMatch = findTemplateMatch(fluoreneGraph, buildRingCandidate(fluoreneGraph, fluoreneGraph.ringSystems[0], 'fused'));
    assert.equal(fluoreneMatch.id, 'fluorene');

    const testosteroneGraph = createLayoutGraph(parseSMILES('C[C@]12CC[C@H]3[C@@H](CC=C4C[C@@H](O)CC[C@]34C)[C@@H]1CC[C@@H]2=O'));
    const testosteroneMatch = findTemplateMatch(testosteroneGraph, buildRingCandidate(testosteroneGraph, testosteroneGraph.ringSystems[0], 'fused'));
    assert.equal(testosteroneMatch.id, 'steroid-core-unsaturated');

    const cholesterolGraph = createLayoutGraph(parseSMILES('C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C'));
    const cholesterolMatch = findTemplateMatch(cholesterolGraph, buildRingCandidate(cholesterolGraph, cholesterolGraph.ringSystems[0], 'fused'));
    assert.equal(cholesterolMatch.id, 'steroid-core-unsaturated');

    const steroidTestGraph = createLayoutGraph(parseSMILES('C[C@]12CC[C@H]3[C@@H](CC[C@@H]4CC(=O)CC[C@]34C)[C@@H]1CC[C@@H]2O'));
    const steroidTestMatch = findTemplateMatch(steroidTestGraph, buildRingCandidate(steroidTestGraph, steroidTestGraph.ringSystems[0], 'fused'));
    assert.equal(steroidTestMatch.id, 'steroid-core-saturated');

    const phthalazineGraph = createLayoutGraph(parseSMILES('c1ccc2nnccc2c1'));
    const phthalazineMatch = findTemplateMatch(phthalazineGraph, buildRingCandidate(phthalazineGraph, phthalazineGraph.ringSystems[0], 'fused'));
    assert.equal(phthalazineMatch.id, 'phthalazine');

    const cinnolineGraph = createLayoutGraph(parseSMILES('c1ccc2cnncc2c1'));
    const cinnolineMatch = findTemplateMatch(cinnolineGraph, buildRingCandidate(cinnolineGraph, cinnolineGraph.ringSystems[0], 'fused'));
    assert.equal(cinnolineMatch.id, 'cinnoline');
  });

  it('uses mapped-atom context to choose between otherwise identical template graphs', () => {
    const graph = createLayoutGraph(parseSMILES('c1ccc2[nH+]cnc2c1'));
    const candidate = buildRingCandidate(graph, graph.ringSystems[0], 'fused');
    const baseTemplate = getTemplateById('benzimidazolium');
    const templates = [
      Object.freeze({
        ...baseTemplate,
        id: 'benzimidazolium-wrong-context',
        matchContext: Object.freeze({
          exocyclicNeighbors: Object.freeze([]),
          mappedAtoms: Object.freeze([
            Object.freeze({
              templateAtomId: 'a7',
              charge: 0,
              aromatic: true
            })
          ])
        })
      }),
      Object.freeze({
        ...baseTemplate,
        id: 'benzimidazolium-right-context',
        matchContext: Object.freeze({
          exocyclicNeighbors: Object.freeze([]),
          mappedAtoms: Object.freeze([
            Object.freeze({
              templateAtomId: 'a7',
              charge: 1,
              aromatic: false
            })
          ])
        })
      })
    ];

    const match = findTemplateMatch(graph, candidate, templates);
    assert.equal(match.id, 'benzimidazolium-right-context');
  });

  it('matches common partially saturated fused scaffolds too', () => {
    const indanoneGraph = createLayoutGraph(parseSMILES('O=C1CCc2ccccc21'));
    const indanoneMatch = findTemplateMatch(indanoneGraph, buildRingCandidate(indanoneGraph, indanoneGraph.ringSystems[0], 'fused'));
    assert.equal(indanoneMatch.id, 'indanone');

    const indaneGraph = createLayoutGraph(parseSMILES('c1ccc2CCCc2c1'));
    const indaneMatch = findTemplateMatch(indaneGraph, buildRingCandidate(indaneGraph, indaneGraph.ringSystems[0], 'fused'));
    assert.equal(indaneMatch.id, 'indane');

    const tetralinGraph = createLayoutGraph(parseSMILES('c1ccc2CCCCc2c1'));
    const tetralinMatch = findTemplateMatch(tetralinGraph, buildRingCandidate(tetralinGraph, tetralinGraph.ringSystems[0], 'fused'));
    assert.equal(tetralinMatch.id, 'tetralin');

    const chromaneGraph = createLayoutGraph(parseSMILES('c1ccc2OCCCc2c1'));
    const chromaneMatch = findTemplateMatch(chromaneGraph, buildRingCandidate(chromaneGraph, chromaneGraph.ringSystems[0], 'fused'));
    assert.equal(chromaneMatch.id, 'chromane');

    const isochromaneGraph = createLayoutGraph(parseSMILES('c1ccc2COCCc2c1'));
    const isochromaneMatch = findTemplateMatch(isochromaneGraph, buildRingCandidate(isochromaneGraph, isochromaneGraph.ringSystems[0], 'fused'));
    assert.equal(isochromaneMatch.id, 'isochromane');
  });

  it('matches a bridged norbornane-like scaffold too', () => {
    const graph = createLayoutGraph(makeNorbornane());
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'norbornane');

    const norborneneGraph = createLayoutGraph(parseSMILES('C1C2CC(C=C2)C1'));
    const norborneneMatch = findTemplateMatch(norborneneGraph, buildRingCandidate(norborneneGraph, norborneneGraph.ringSystems[0], 'bridged'));
    assert.equal(norborneneMatch.id, 'norbornene');
  });

  it('matches larger bridged and cage scaffolds too', () => {
    const bicycloGraph = createLayoutGraph(makeBicyclo222());
    const bicycloMatch = findTemplateMatch(bicycloGraph, buildRingCandidate(bicycloGraph, bicycloGraph.ringSystems[0], 'bridged'));
    assert.equal(bicycloMatch.id, 'bicyclo-2-2-2');

    const oxabicyclo222Graph = createLayoutGraph(parseSMILES('C12CCC(CO1)CC2'));
    const oxabicyclo222Match = findTemplateMatch(oxabicyclo222Graph, buildRingCandidate(oxabicyclo222Graph, oxabicyclo222Graph.ringSystems[0], 'bridged'));
    assert.equal(oxabicyclo222Match.id, 'oxabicyclo-2-2-2');

    const quinuclidineGraph = createLayoutGraph(parseSMILES('C1CN2CCC1CC2'));
    const quinuclidineMatch = findTemplateMatch(quinuclidineGraph, buildRingCandidate(quinuclidineGraph, quinuclidineGraph.ringSystems[0], 'bridged'));
    assert.equal(quinuclidineMatch.id, 'quinuclidine');

    const quinuclidiniumGraph = createLayoutGraph(parseSMILES('[N+]12CCC(CC1)C(C2)'), { suppressH: true });
    const quinuclidiniumMatch = findTemplateMatch(quinuclidiniumGraph, buildRingCandidate(quinuclidiniumGraph, quinuclidiniumGraph.ringSystems[0], 'bridged'));
    assert.equal(quinuclidiniumMatch.id, 'quinuclidinium');

    const oxygenExitQuinuclidiniumGraph = createLayoutGraph(parseSMILES('CC[N+]12CCC(CC1)C(C2)OC=O'), { suppressH: true });
    const oxygenExitQuinuclidiniumMatch = findTemplateMatch(
      oxygenExitQuinuclidiniumGraph,
      buildRingCandidate(oxygenExitQuinuclidiniumGraph, oxygenExitQuinuclidiniumGraph.ringSystems[0], 'bridged')
    );
    assert.equal(oxygenExitQuinuclidiniumMatch.id, 'quinuclidinium-oxygen-exit');

    const tropaneGraph = createLayoutGraph(parseSMILES('N1C2CCC1CC(C2)'));
    const tropaneMatch = findTemplateMatch(tropaneGraph, buildRingCandidate(tropaneGraph, tropaneGraph.ringSystems[0], 'bridged'));
    assert.equal(tropaneMatch.id, 'tropane');

    const cocaineGraph = createLayoutGraph(parseSMILES('CN1C2CCC1C(C(OC)=O)C(OC(c3ccccc3)=O)C2'));
    const cocaineMatch = findTemplateMatch(cocaineGraph, buildRingCandidate(cocaineGraph, cocaineGraph.ringSystems[0], 'bridged'));
    assert.equal(cocaineMatch.id, 'tropane');

    const cubaneGraph = createLayoutGraph(parseSMILES('C12C3C4C1C5C4C3C25'));
    const cubaneMatch = findTemplateMatch(cubaneGraph, buildRingCandidate(cubaneGraph, cubaneGraph.ringSystems[0], 'bridged'));
    assert.equal(cubaneMatch.id, 'cubane');

    const adamantaneGraph = createLayoutGraph(makeAdamantane());
    const adamantaneMatch = findTemplateMatch(adamantaneGraph, buildRingCandidate(adamantaneGraph, adamantaneGraph.ringSystems[0], 'bridged'));
    assert.equal(adamantaneMatch.id, 'adamantane');

    const morphinanGraph = createLayoutGraph(parseSMILES('C1C2Cc3ccccc3C1CCN2'));
    const morphinanMatch = findTemplateMatch(morphinanGraph, buildRingCandidate(morphinanGraph, morphinanGraph.ringSystems[0], 'bridged'));
    assert.equal(morphinanMatch.id, 'morphinan-core');

    const saturatedMorphinanGraph = createLayoutGraph(parseSMILES('[H][C@@]12CCCC[C@@]11CCN(CC=C)[C@@H]2CC2=C1C=C(O)C=C2'));
    const saturatedMorphinanMatch = findTemplateMatch(saturatedMorphinanGraph, buildRingCandidate(saturatedMorphinanGraph, saturatedMorphinanGraph.ringSystems[0], 'bridged'));
    assert.equal(saturatedMorphinanMatch.id, 'saturated-morphinan-core');

    const oripavineGraph = createLayoutGraph(parseSMILES('[H][C@@]12OC3=C(O)C=CC4=C3[C@@]11CCN(CC3CC3)[C@]([H])(C4)[C@]11CC[C@@]2(OC)[C@H](C1)C(C)(C)O'));
    const oripavineMatch = findTemplateMatch(oripavineGraph, buildRingCandidate(oripavineGraph, oripavineGraph.ringSystems[0], 'bridged'));
    assert.equal(oripavineMatch.id, 'oripavine-core');

    const oxazaMorphinanGraph = createLayoutGraph(parseSMILES('COC1(NC(=O)C(=CC2=CC=CC=C2)C(F)(F)F)C=C(O)C2=C3C1OC1CCCC4C(C2)[N+](CC2CC2)(CCC314)C(C)C'));
    const oxazaMorphinanMatch = findTemplateMatch(oxazaMorphinanGraph, buildRingCandidate(oxazaMorphinanGraph, oxazaMorphinanGraph.ringSystems[0], 'bridged'));
    assert.equal(oxazaMorphinanMatch.id, 'oxaza-morphinan-core');
  });

  it('matches compact bridged lactone cages only when the carbonyl context is present', () => {
    const graph = createLayoutGraph(parseSMILES('CN(CCN)C(=[NH2+])C1CCC2CCC1OC2=O'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'bridged-lactone-core');

    const withoutCarbonylGraph = createLayoutGraph(parseSMILES('CN(CCN)C(=[NH2+])C1CCC2CCC1OC2'), { suppressH: true });
    const withoutCarbonylMatch = findTemplateMatch(withoutCarbonylGraph, buildRingCandidate(withoutCarbonylGraph, withoutCarbonylGraph.ringSystems[0], 'bridged'));
    assert.notEqual(withoutCarbonylMatch?.id, 'bridged-lactone-core');
  });

  it('matches compact oxazabicyclic lactam cages only with lactam and gem-carbon context', () => {
    const graph = createLayoutGraph(parseSMILES('CC1(CC#N)CC2COC1C(=O)N2'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'oxazabicyclic-lactam-core');

    const withoutCarbonylGraph = createLayoutGraph(parseSMILES('CC1(CC#N)CC2COC1CN2'), { suppressH: true });
    const withoutCarbonylMatch = findTemplateMatch(withoutCarbonylGraph, buildRingCandidate(withoutCarbonylGraph, withoutCarbonylGraph.ringSystems[0], 'bridged'));
    assert.notEqual(withoutCarbonylMatch?.id, 'oxazabicyclic-lactam-core');
  });

  it('matches azabicyclo ketone oxadiazole cages only with carbonyl and heteroaryl exit context', () => {
    const graph = createLayoutGraph(parseSMILES('O=C1C2C[NH2+]C1C2C1=NON=C1'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'azabicyclo-ketone-oxadiazole-core');

    const withoutOxadiazoleGraph = createLayoutGraph(parseSMILES('O=C1C2C[NH2+]C1C2C'), { suppressH: true });
    const withoutOxadiazoleMatch = findTemplateMatch(
      withoutOxadiazoleGraph,
      buildRingCandidate(withoutOxadiazoleGraph, withoutOxadiazoleGraph.ringSystems[0], 'bridged')
    );
    assert.notEqual(withoutOxadiazoleMatch?.id, 'azabicyclo-ketone-oxadiazole-core');
  });

  it('matches cyanoacyl azabicyclo cages only when the N-acyl context is present', () => {
    const graph = createLayoutGraph(parseSMILES('O=C(C#N)N1CC2CC1C2'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'cyanoacyl-azabicyclo-core');

    const withoutAcylGraph = createLayoutGraph(parseSMILES('N1CC2CC1C2'), { suppressH: true });
    const withoutAcylMatch = findTemplateMatch(withoutAcylGraph, buildRingCandidate(withoutAcylGraph, withoutAcylGraph.ringSystems[0], 'bridged'));
    assert.notEqual(withoutAcylMatch?.id, 'cyanoacyl-azabicyclo-core');
  });

  it('matches aminonitrile acetal-bridged cores only when the nitrile exit is present', () => {
    const graph = createLayoutGraph(parseSMILES('CC1NC2(C)CC1(OCOC1=C2C=CN1)C#N'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'aminonitrile-acetal-bridged-core');

    const withoutNitrileGraph = createLayoutGraph(parseSMILES('CC1NC2(C)CC1(OCOC1=C2C=CN1)'), { suppressH: true });
    const withoutNitrileMatch = findTemplateMatch(withoutNitrileGraph, buildRingCandidate(withoutNitrileGraph, withoutNitrileGraph.ringSystems[0], 'bridged'));
    assert.notEqual(withoutNitrileMatch?.id, 'aminonitrile-acetal-bridged-core');
  });

  it('matches azabicyclo nitrile cores only when the charged gem-substituted context is present', () => {
    const graph = createLayoutGraph(parseSMILES('C[NH+]1C2CCC1C2(C)CC#N'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'azabicyclo-nitrile-core');

    const neutralGraph = createLayoutGraph(parseSMILES('CN1C2CCC1C2(C)CC#N'), { suppressH: true });
    const neutralMatch = findTemplateMatch(neutralGraph, buildRingCandidate(neutralGraph, neutralGraph.ringSystems[0], 'bridged'));
    assert.notEqual(neutralMatch?.id, 'azabicyclo-nitrile-core');

    const withoutGemCarbonGraph = createLayoutGraph(parseSMILES('C[NH+]1C2CCC1C2'), { suppressH: true });
    const withoutGemCarbonMatch = findTemplateMatch(
      withoutGemCarbonGraph,
      buildRingCandidate(withoutGemCarbonGraph, withoutGemCarbonGraph.ringSystems[0], 'bridged')
    );
    assert.notEqual(withoutGemCarbonMatch?.id, 'azabicyclo-nitrile-core');
  });

  it('matches compact bridged decalin lactams only when the lactam carbonyl is present', () => {
    const graph = createLayoutGraph(parseSMILES('CC1CC(C)C2(C)CCC1CC(=O)N2CC[NH3+]'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'bridged-decalin-lactam-core');

    const withoutCarbonylGraph = createLayoutGraph(parseSMILES('CC1CC(C)C2(C)CCC1CCN2CC[NH3+]'), { suppressH: true });
    const withoutCarbonylMatch = findTemplateMatch(withoutCarbonylGraph, buildRingCandidate(withoutCarbonylGraph, withoutCarbonylGraph.ringSystems[0], 'bridged'));
    assert.notEqual(withoutCarbonylMatch?.id, 'bridged-decalin-lactam-core');
  });

  it('matches bridged oxadecalin cores only with gem-dimethyl and hydroxyalkyl context', () => {
    const graph = createLayoutGraph(parseSMILES('CC1CC2COC(C)C(C1)C(C)(C)C2CCO'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'bridged-oxadecalin-core');

    const withoutGemDimethylGraph = createLayoutGraph(parseSMILES('CC1CC2COC(C)C(C1)C(C)C2CCO'), { suppressH: true });
    const withoutGemDimethylMatch = findTemplateMatch(withoutGemDimethylGraph, buildRingCandidate(withoutGemDimethylGraph, withoutGemDimethylGraph.ringSystems[0], 'bridged'));
    assert.notEqual(withoutGemDimethylMatch?.id, 'bridged-oxadecalin-core');
  });

  it('matches the bridged pyrrolizidine dione cage scaffold too', () => {
    const graph = createLayoutGraph(parseSMILES(String.raw`C\C=C\C=C\C(=O)C1=C(O)[C@@]2(C)[C@H]3CCCN3[C@@H]1[C@](C)(O)C2=O`), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'bridged-pyrrolizidine-dione-core');
  });

  it('matches the amino oxaza tricyclo cage scaffold too', () => {
    const graph = createLayoutGraph(parseSMILES('CC1=C2C(OC1)C1(N)C3NC3C2CC1N'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'amino-oxaza-tricyclo-core');
  });

  it('matches amino diaza tricyclo cages only when imine and alcohol context is present', () => {
    const graph = createLayoutGraph(parseSMILES('CC1CC(O)C2CNC(=N)C1C1(C)NC=NC21'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'amino-diaza-tricyclo-core');

    const withoutAlcoholGraph = createLayoutGraph(parseSMILES('CC1CCC2CNC(=N)C1C1(C)NC=NC21'), { suppressH: true });
    const withoutAlcoholMatch = findTemplateMatch(withoutAlcoholGraph, buildRingCandidate(withoutAlcoholGraph, withoutAlcoholGraph.ringSystems[0], 'bridged'));
    assert.notEqual(withoutAlcoholMatch?.id, 'amino-diaza-tricyclo-core');
  });

  it('matches imino thiazole oxaza tricyclo cores only with imine and alkyl context', () => {
    const graph = createLayoutGraph(parseSMILES('CC1C23COC(=N)C12NCC1=C3N=C(C)S1'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'imino-thiazole-oxaza-tricyclo-core');

    const withoutImineGraph = createLayoutGraph(parseSMILES('CC1C23COCC12NCC1=C3N=C(C)S1'), { suppressH: true });
    const withoutImineMatch = findTemplateMatch(withoutImineGraph, buildRingCandidate(withoutImineGraph, withoutImineGraph.ringSystems[0], 'bridged'));
    assert.notEqual(withoutImineMatch?.id, 'imino-thiazole-oxaza-tricyclo-core');
  });

  it('matches aza-annulene cyclohexadiene cores only when the exterior amine and alkyl context is present', () => {
    const graph = createLayoutGraph(parseSMILES('CCC1=NC(N)=CC(C)=CC=C2NC=CC1=C2'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'aza-annulene-cyclohexadiene-core');

    const withoutAmineGraph = createLayoutGraph(parseSMILES('CCC1=NC=CC(C)=CC=C2NC=CC1=C2'), { suppressH: true });
    const withoutAmineMatch = findTemplateMatch(withoutAmineGraph, buildRingCandidate(withoutAmineGraph, withoutAmineGraph.ringSystems[0], 'bridged'));
    assert.notEqual(withoutAmineMatch?.id, 'aza-annulene-cyclohexadiene-core');
  });

  it('matches the bridged cyclopropyl-decalin scaffold too', () => {
    const graph = createLayoutGraph(parseSMILES('COC12CCC(CC11CC1)CCCCCC2'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'bridged-cyclopropyl-decalin-core');
  });

  it('matches the oxabicyclic lactone ammonium scaffold too', () => {
    const graph = createLayoutGraph(parseSMILES('CCC1OC2CC(=O)OC1CC2[NH3+]'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'oxabicyclic-lactone-ammonium-core');
  });

  it('matches the bridged oxabicyclo[3.1.1]heptane scaffold too', () => {
    const graph = createLayoutGraph(parseSMILES('C1OC2CC(C1)C2'));
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'oxabicyclo-3-1-1');
  });

  it('matches the acyl-substituted spiro-bridged aza cage scaffold', () => {
    const graph = createLayoutGraph(parseSMILES('CCC(=O)C1CC2(C1)[NH2+]C1CC2C1'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'spiro-bridged-aza-cage');
  });

  it('matches the compact spiro-bridged oxetane cage scaffold too', () => {
    const graph = createLayoutGraph(parseSMILES('N#CC1CC2(C1)C1CCC2O1'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'spiro-bridged-oxetane');
  });

  it('matches the sulfonyl azatricyclo cage scaffold too', () => {
    const graph = createLayoutGraph(parseSMILES('CC12C[NH+](C1)C1C2C1S([O-])(=O)=O'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'sulfonyl-azatricyclo-cage');
  });

  it('matches the sulfonyl cyclopentenyl azocane scaffold too', () => {
    const graph = createLayoutGraph(parseSMILES('CC1=C2CS(=O)(=O)C1C(CCNC2(C)C)C=O'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'sulfonyl-cyclopentenyl-azocane-core');
  });

  it('matches hydroxy alkyl bicyclohexene cores only with the alcohol context present', () => {
    const graph = createLayoutGraph(parseSMILES('CCC1(O)C2C(CN(C)C)C1(CC)C=C2C'), { suppressH: true });
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'hydroxy-alkyl-bicyclohexene-core');

    const withoutAlcoholGraph = createLayoutGraph(parseSMILES('CCC1C2C(CN(C)C)C1(CC)C=C2C'), { suppressH: true });
    const withoutAlcoholMatch = findTemplateMatch(withoutAlcoholGraph, buildRingCandidate(withoutAlcoholGraph, withoutAlcoholGraph.ringSystems[0], 'bridged'));
    assert.notEqual(withoutAlcoholMatch?.id, 'hydroxy-alkyl-bicyclohexene-core');
  });

  it('matches the bridged benzoxathiobicyclo cage scaffold too', () => {
    const graph = createLayoutGraph(parseSMILES('C1CC2CC(C2)COC2=CC=C1S2'));
    const match = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(match.id, 'benzoxathiobicyclo-core');
  });

  it('matches the porphyrin core as a macrocycle template and can promote it over a bridged heuristic', () => {
    const graph = createLayoutGraph(parseSMILES('C1=CC2=CC3=CC=C(N3)C=C4C=CC(=N4)C=C5C=CC(=N5)C=C1N2'));
    const strictMacrocycleMatch = findTemplateMatch(graph, buildRingCandidate(graph, graph.ringSystems[0], 'macrocycle'));
    assert.equal(strictMacrocycleMatch.id, 'porphine');

    const promotedMatch = findTemplateMatchIgnoringFamily(graph, buildRingCandidate(graph, graph.ringSystems[0], 'bridged'));
    assert.equal(promotedMatch.id, 'porphine');
    assert.equal(promotedMatch.family, 'macrocycle');
  });
});
