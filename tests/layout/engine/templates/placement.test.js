import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { angleOf, angularDifference, distance, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { placeTemplateCoords } from '../../../../src/layout/engine/templates/placement.js';
import { BRIDGED_VALIDATION } from '../../../../src/layout/engine/constants.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { assignBondValidationClass } from '../../../../src/layout/engine/placement/bond-validation.js';
import { makeAdamantane, makeBenzene, makeBicyclo222, makeNaphthalene, makeNorbornane, makeSpiro } from '../support/molecules.js';

function ringAngles(coords, atomIds) {
  return atomIds.map((atomId, index) => angularDifference(
    angleOf(sub(coords.get(atomIds[(index - 1 + atomIds.length) % atomIds.length]), coords.get(atomId))),
    angleOf(sub(coords.get(atomIds[(index + 1) % atomIds.length]), coords.get(atomId)))
  ) * (180 / Math.PI));
}

describe('layout/engine/templates/placement', () => {
  it('places an isolated aromatic ring from a matched scaffold template', () => {
    const graph = createLayoutGraph(makeBenzene());
    const coords = placeTemplateCoords(graph, 'benzene', graph.ringSystems[0].atomIds, graph.options.bondLength);
    assert.equal(coords.size, 6);
    assert.ok(Math.abs(distance(coords.get('a0'), coords.get('a1')) - graph.options.bondLength) < 1e-6);
  });

  it('places a fused aromatic scaffold from the naphthalene template', () => {
    const graph = createLayoutGraph(makeNaphthalene());
    const coords = placeTemplateCoords(graph, 'naphthalene', graph.ringSystems[0].atomIds, graph.options.bondLength);
    assert.equal(coords.size, 10);
    assert.ok(Math.abs(coords.get('a4').x - coords.get('a5').x) < 1e-6);
  });

  it('places fused heterobicycle templates with the expected fused-ring geometry', () => {
    const quinolineGraph = createLayoutGraph(parseSMILES('c1ccc2ncccc2c1'));
    const quinolineCoords = placeTemplateCoords(quinolineGraph, 'quinoline', quinolineGraph.ringSystems[0].atomIds, quinolineGraph.options.bondLength);
    assert.equal(quinolineCoords.size, 10);
    assert.ok(Math.abs(quinolineCoords.get('C4').x - quinolineCoords.get('C9').x) < 1e-6);

    const indoleGraph = createLayoutGraph(parseSMILES('c1ccc2[nH]ccc2c1'));
    const indoleCoords = placeTemplateCoords(indoleGraph, 'indole', indoleGraph.ringSystems[0].atomIds, indoleGraph.options.bondLength);
    assert.equal(indoleCoords.size, 9);
    assert.ok(Math.abs(distance(indoleCoords.get('C2'), indoleCoords.get('C3')) - indoleGraph.options.bondLength) < 1e-6);

    const benzimidazoliumGraph = createLayoutGraph(parseSMILES('c1ccc2[nH+]cnc2c1'));
    const benzimidazoliumCoords = placeTemplateCoords(
      benzimidazoliumGraph,
      'benzimidazolium',
      benzimidazoliumGraph.ringSystems[0].atomIds,
      benzimidazoliumGraph.options.bondLength
    );
    assert.equal(benzimidazoliumCoords.size, 9);
    assert.ok(Math.abs(distance(benzimidazoliumCoords.get('N5'), benzimidazoliumCoords.get('C7')) - benzimidazoliumGraph.options.bondLength) < 1e-6);
    assert.ok(Math.abs(distance(benzimidazoliumCoords.get('N8'), benzimidazoliumCoords.get('C9')) - benzimidazoliumGraph.options.bondLength) < 1e-6);

    const quinazolineGraph = createLayoutGraph(parseSMILES('c1ccc2ncncc2c1'));
    const quinazolineCoords = placeTemplateCoords(quinazolineGraph, 'quinazoline', quinazolineGraph.ringSystems[0].atomIds, quinazolineGraph.options.bondLength);
    assert.equal(quinazolineCoords.size, 10);
    assert.ok(Math.abs(quinazolineCoords.get('C4').x - quinazolineCoords.get('C9').x) < 1e-6);

    const indazoleGraph = createLayoutGraph(parseSMILES('c1ccc2[nH]ncc2c1'));
    const indazoleCoords = placeTemplateCoords(indazoleGraph, 'indazole', indazoleGraph.ringSystems[0].atomIds, indazoleGraph.options.bondLength);
    assert.equal(indazoleCoords.size, 9);
    assert.ok(Math.abs(distance(indazoleCoords.get('N5'), indazoleCoords.get('N7')) - indazoleGraph.options.bondLength) < 1e-6);

    const cinnolineGraph = createLayoutGraph(parseSMILES('c1ccc2cnncc2c1'));
    const cinnolineCoords = placeTemplateCoords(cinnolineGraph, 'cinnoline', cinnolineGraph.ringSystems[0].atomIds, cinnolineGraph.options.bondLength);
    assert.equal(cinnolineCoords.size, 10);
    assert.ok(Math.abs(cinnolineCoords.get('N6').x - cinnolineCoords.get('N7').x) < 1e-6);
    assert.ok(cinnolineCoords.get('N6').x > cinnolineCoords.get('C4').x);
    assert.ok(cinnolineCoords.get('N7').x > cinnolineCoords.get('C4').x);

    const benzotriazoleGraph = createLayoutGraph(parseSMILES('c1ccc2[nH]nnc2c1'));
    const benzotriazoleCoords = placeTemplateCoords(benzotriazoleGraph, 'benzotriazole', benzotriazoleGraph.ringSystems[0].atomIds, benzotriazoleGraph.options.bondLength);
    assert.equal(benzotriazoleCoords.size, 9);
    assert.ok(Math.abs(distance(benzotriazoleCoords.get('N7'), benzotriazoleCoords.get('N8')) - benzotriazoleGraph.options.bondLength) < 1e-6);

    const purineGraph = createLayoutGraph(parseSMILES('c1ncc2[nH]cnc2n1'));
    const purineCoords = placeTemplateCoords(purineGraph, 'purine', purineGraph.ringSystems[0].atomIds, purineGraph.options.bondLength);
    assert.equal(purineCoords.size, 9);
    assert.ok(purineCoords.get('N5').x < purineCoords.get('C3').x);
    assert.ok(purineCoords.get('N8').x < purineCoords.get('N2').x);

    const acridineGraph = createLayoutGraph(parseSMILES('c1ccc2nc3ccccc3cc2c1'));
    const acridineCoords = placeTemplateCoords(acridineGraph, 'acridine', acridineGraph.ringSystems[0].atomIds, acridineGraph.options.bondLength);
    assert.equal(acridineCoords.size, 14);
    assert.ok(Math.abs(acridineCoords.get('C4').x - acridineCoords.get('C13').x) < 1e-6);
    assert.ok(Math.abs(acridineCoords.get('C6').x - acridineCoords.get('C11').x) < 1e-6);
    const acridineXs = [...acridineCoords.values()].map(position => position.x);
    const acridineYs = [...acridineCoords.values()].map(position => position.y);
    assert.ok(Math.max(...acridineXs) - Math.min(...acridineXs) > Math.max(...acridineYs) - Math.min(...acridineYs));

    const anthraceneGraph = createLayoutGraph(parseSMILES('c1ccc2cc3ccccc3cc2c1'));
    const anthraceneCoords = placeTemplateCoords(anthraceneGraph, 'anthracene', anthraceneGraph.ringSystems[0].atomIds, anthraceneGraph.options.bondLength);
    assert.equal(anthraceneCoords.size, 14);
    assert.ok(Math.abs(anthraceneCoords.get('C4').x - anthraceneCoords.get('C13').x) < 1e-6);
    assert.ok(Math.abs(anthraceneCoords.get('C6').x - anthraceneCoords.get('C11').x) < 1e-6);
    const anthraceneXs = [...anthraceneCoords.values()].map(position => position.x);
    const anthraceneYs = [...anthraceneCoords.values()].map(position => position.y);
    assert.ok(Math.max(...anthraceneXs) - Math.min(...anthraceneXs) > Math.max(...anthraceneYs) - Math.min(...anthraceneYs));

    const pyreneGraph = createLayoutGraph(parseSMILES('c1cc2ccc3cccc4ccc(c1)c2c34'));
    const pyreneCoords = placeTemplateCoords(pyreneGraph, 'pyrene', pyreneGraph.ringSystems[0].atomIds, pyreneGraph.options.bondLength);
    assert.equal(pyreneCoords.size, 16);
    const pyreneXs = [...pyreneCoords.values()].map(position => position.x);
    const pyreneYs = [...pyreneCoords.values()].map(position => position.y);
    assert.ok(Math.max(...pyreneXs) - Math.min(...pyreneXs) > Math.max(...pyreneYs) - Math.min(...pyreneYs));
    assert.ok(Math.abs(Math.max(...pyreneXs) + Math.min(...pyreneXs)) < 1e-6);
    assert.ok(Math.abs(Math.max(...pyreneYs) + Math.min(...pyreneYs)) < 1e-6);
    assert.equal(new Set(pyreneXs.map(value => Number(value.toFixed(6)))).size, 6);
    assert.equal(new Set(pyreneYs.map(value => Number(value.toFixed(6)))).size, 6);

    const peryleneGraph = createLayoutGraph(parseSMILES('C1=CC=C2C(=C1)C=C1C=CC3=CC=CC4=CC=C2C1=C34'));
    const peryleneCoords = placeTemplateCoords(peryleneGraph, 'perylene', peryleneGraph.ringSystems[0].atomIds, peryleneGraph.options.bondLength);
    assert.equal(peryleneCoords.size, 20);
    const peryleneXs = [...peryleneCoords.values()].map(position => position.x);
    const peryleneYs = [...peryleneCoords.values()].map(position => position.y);
    assert.ok(Math.max(...peryleneXs) - Math.min(...peryleneXs) > Math.max(...peryleneYs) - Math.min(...peryleneYs));
    assert.equal(new Set(peryleneXs.map(value => Number(value.toFixed(6)))).size, 8);
    assert.equal(new Set(peryleneYs.map(value => Number(value.toFixed(6)))).size, 6);

    const fluoreneGraph = createLayoutGraph(parseSMILES('c1ccc2c(c1)Cc1ccccc1-2'));
    const fluoreneCoords = placeTemplateCoords(fluoreneGraph, 'fluorene', fluoreneGraph.ringSystems[0].atomIds, fluoreneGraph.options.bondLength);
    assert.equal(fluoreneCoords.size, 13);
    const fluoreneXs = [...fluoreneCoords.values()].map(position => position.x);
    const fluoreneYs = [...fluoreneCoords.values()].map(position => position.y);
    assert.ok(Math.max(...fluoreneXs) - Math.min(...fluoreneXs) > Math.max(...fluoreneYs) - Math.min(...fluoreneYs));
    assert.ok(Math.abs(fluoreneCoords.get('C1').x + fluoreneCoords.get('C10').x) < 1e-6);
    assert.ok(Math.abs(fluoreneCoords.get('C4').x + fluoreneCoords.get('C13').x) < 1e-6);
    assert.equal(
      fluoreneCoords.get('C7').y,
      Math.max(...['C1', 'C10', 'C2', 'C11', 'C6', 'C9', 'C3', 'C12', 'C7', 'C5', 'C8', 'C4', 'C13'].map(atomId => fluoreneCoords.get(atomId).y))
    );

    const testosteroneGraph = createLayoutGraph(parseSMILES('C[C@]12CC[C@H]3[C@@H](CC=C4C[C@@H](O)CC[C@]34C)[C@@H]1CC[C@@H]2=O'));
    const testosteroneCoords = placeTemplateCoords(testosteroneGraph, 'steroid-core-unsaturated', testosteroneGraph.ringSystems[0].atomIds, testosteroneGraph.options.bondLength);
    assert.equal(testosteroneCoords.size, 17);
    const testosteroneXs = [...testosteroneCoords.values()].map(position => position.x);
    const testosteroneYs = [...testosteroneCoords.values()].map(position => position.y);
    assert.ok(Math.max(...testosteroneXs) - Math.min(...testosteroneXs) > Math.max(...testosteroneYs) - Math.min(...testosteroneYs));
    const testosteronePentagonMeanX = ['C20', 'C22', 'C23', 'C24', 'C2'].map(atomId => testosteroneCoords.get(atomId).x).reduce((sum, value) => sum + value, 0) / 5;
    const testosteroneHexMeanX = ['C12', 'C13', 'C16', 'C17', 'C18', 'C11'].map(atomId => testosteroneCoords.get(atomId).x).reduce((sum, value) => sum + value, 0) / 6;
    assert.ok(testosteronePentagonMeanX > testosteroneHexMeanX);

    const steroidTestGraph = createLayoutGraph(parseSMILES('C[C@]12CC[C@H]3[C@@H](CC[C@@H]4CC(=O)CC[C@]34C)[C@@H]1CC[C@@H]2O'));
    const steroidTestCoords = placeTemplateCoords(steroidTestGraph, 'steroid-core-saturated', steroidTestGraph.ringSystems[0].atomIds, steroidTestGraph.options.bondLength);
    assert.equal(steroidTestCoords.size, 17);
    const steroidTestXs = [...steroidTestCoords.values()].map(position => position.x);
    const steroidTestYs = [...steroidTestCoords.values()].map(position => position.y);
    assert.ok(Math.max(...steroidTestXs) - Math.min(...steroidTestXs) > Math.max(...steroidTestYs) - Math.min(...steroidTestYs));
    const steroidPentagonMeanX = ['C20', 'C22', 'C23', 'C24', 'C2'].map(atomId => steroidTestCoords.get(atomId).x).reduce((sum, value) => sum + value, 0) / 5;
    const steroidHexMeanX = ['C16', 'C17', 'C18', 'C11', 'C13', 'C14'].map(atomId => steroidTestCoords.get(atomId).x).reduce((sum, value) => sum + value, 0) / 6;
    assert.ok(steroidPentagonMeanX > steroidHexMeanX);
  });

  it('places partially saturated fused templates with the expected conventional orientation', () => {
    const indanoneGraph = createLayoutGraph(parseSMILES('O=C1CCc2ccccc21'));
    const indanoneCoords = placeTemplateCoords(indanoneGraph, 'indanone', indanoneGraph.ringSystems[0].atomIds, indanoneGraph.options.bondLength);
    assert.equal(indanoneCoords.size, 9);
    assert.ok(Math.abs(indanoneCoords.get('C5').x - indanoneCoords.get('C10').x) < 1e-6);
    assert.ok(indanoneCoords.get('C2').x > indanoneCoords.get('C5').x);
    assert.ok(indanoneCoords.get('C2').y > 0);

    const indaneGraph = createLayoutGraph(parseSMILES('c1ccc2CCCc2c1'));
    const indaneCoords = placeTemplateCoords(indaneGraph, 'indane', indaneGraph.ringSystems[0].atomIds, indaneGraph.options.bondLength);
    assert.equal(indaneCoords.size, 9);
    assert.ok(Math.abs(indaneCoords.get('C4').x - indaneCoords.get('C8').x) < 1e-6);
    assert.ok(indaneCoords.get('C2').x < indaneCoords.get('C4').x);
    assert.ok(indaneCoords.get('C6').x > indaneCoords.get('C4').x);

    const tetralinGraph = createLayoutGraph(parseSMILES('c1ccc2CCCCc2c1'));
    const tetralinCoords = placeTemplateCoords(tetralinGraph, 'tetralin', tetralinGraph.ringSystems[0].atomIds, tetralinGraph.options.bondLength);
    assert.equal(tetralinCoords.size, 10);
    assert.ok(Math.abs(tetralinCoords.get('C4').x - tetralinCoords.get('C9').x) < 1e-6);
    assert.ok(tetralinCoords.get('C2').x < tetralinCoords.get('C4').x);
    assert.ok(tetralinCoords.get('C7').x > tetralinCoords.get('C4').x);

    const chromaneGraph = createLayoutGraph(parseSMILES('c1ccc2OCCCc2c1'));
    const chromaneCoords = placeTemplateCoords(chromaneGraph, 'chromane', chromaneGraph.ringSystems[0].atomIds, chromaneGraph.options.bondLength);
    assert.equal(chromaneCoords.size, 10);
    assert.ok(Math.abs(chromaneCoords.get('C4').x - chromaneCoords.get('C9').x) < 1e-6);
    assert.ok(chromaneCoords.get('O5').x > chromaneCoords.get('C4').x);
    assert.ok(chromaneCoords.get('C2').x < chromaneCoords.get('C4').x);

    const isochromaneGraph = createLayoutGraph(parseSMILES('c1ccc2COCCc2c1'));
    const isochromaneCoords = placeTemplateCoords(isochromaneGraph, 'isochromane', isochromaneGraph.ringSystems[0].atomIds, isochromaneGraph.options.bondLength);
    assert.equal(isochromaneCoords.size, 10);
    assert.ok(Math.abs(isochromaneCoords.get('C4').x - isochromaneCoords.get('C9').x) < 1e-6);
    assert.ok(isochromaneCoords.get('O6').x > isochromaneCoords.get('C4').x);
    assert.ok(isochromaneCoords.get('C2').x < isochromaneCoords.get('C4').x);
  });

  it('places the porphine macrocycle template as a square-like porphyrin core', () => {
    const porphineGraph = createLayoutGraph(parseSMILES('C1=CC2=CC3=CC=C(N3)C=C4C=CC(=N4)C=C5C=CC(=N5)C=C1N2'));
    const porphineCoords = placeTemplateCoords(porphineGraph, 'porphine', porphineGraph.ringSystems[0].atomIds, porphineGraph.options.bondLength);
    assert.equal(porphineCoords.size, 24);

    const xs = [...porphineCoords.values()].map(position => position.x);
    const ys = [...porphineCoords.values()].map(position => position.y);
    assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - (Math.max(...ys) - Math.min(...ys))) < 1e-6);

    assert.ok(porphineCoords.get('C10').x < 0 && porphineCoords.get('C10').y > 0);
    assert.ok(porphineCoords.get('C16').x > 0 && porphineCoords.get('C16').y > 0);
    assert.ok(porphineCoords.get('C22').x > 0 && porphineCoords.get('C22').y < 0);
    assert.ok(porphineCoords.get('C4').x < 0 && porphineCoords.get('C4').y < 0);

    assert.ok(Math.abs(porphineCoords.get('N15').x) < 1e-6);
    assert.ok(Math.abs(porphineCoords.get('N21').y) < 1e-6);
    assert.ok(Math.abs(porphineCoords.get('N24').x) < 1e-6);
    assert.ok(Math.abs(porphineCoords.get('N9').y) < 1e-6);

    const center = { x: 0, y: 0 };
    const innerNitrogenDistance = Math.max(
      distance(porphineCoords.get('N9'), center),
      distance(porphineCoords.get('N15'), center),
      distance(porphineCoords.get('N21'), center),
      distance(porphineCoords.get('N24'), center)
    );
    const outerBetaDistance = Math.min(
      distance(porphineCoords.get('C7'), center),
      distance(porphineCoords.get('C13'), center),
      distance(porphineCoords.get('C19'), center),
      distance(porphineCoords.get('C1'), center)
    );
    assert.ok(innerNitrogenDistance < outerBetaDistance);
  });

  it('places isolated aromatic heterocycle templates with the requested bond length', () => {
    const pyridineGraph = createLayoutGraph(parseSMILES('c1ccncc1'));
    const pyridineCoords = placeTemplateCoords(pyridineGraph, 'pyridine', pyridineGraph.ringSystems[0].atomIds, pyridineGraph.options.bondLength);
    assert.equal(pyridineCoords.size, 6);
    assert.ok(Math.abs(distance(pyridineCoords.get('C1'), pyridineCoords.get('C2')) - pyridineGraph.options.bondLength) < 1e-6);

    const thiopheneGraph = createLayoutGraph(parseSMILES('c1ccsc1'));
    const thiopheneCoords = placeTemplateCoords(thiopheneGraph, 'thiophene', thiopheneGraph.ringSystems[0].atomIds, thiopheneGraph.options.bondLength);
    assert.equal(thiopheneCoords.size, 5);
    assert.ok(Math.abs(distance(thiopheneCoords.get('C3'), thiopheneCoords.get('S4')) - thiopheneGraph.options.bondLength) < 1e-6);

    const triazineGraph = createLayoutGraph(parseSMILES('n1ncncc1'));
    const triazineCoords = placeTemplateCoords(triazineGraph, 'triazine-1-2-4', triazineGraph.ringSystems[0].atomIds, triazineGraph.options.bondLength);
    assert.equal(triazineCoords.size, 6);
    assert.ok(Math.abs(distance(triazineCoords.get('N1'), triazineCoords.get('N2')) - triazineGraph.options.bondLength) < 1e-6);

    const thiazoleGraph = createLayoutGraph(parseSMILES('s1cncc1'));
    const thiazoleCoords = placeTemplateCoords(thiazoleGraph, 'thiazole', thiazoleGraph.ringSystems[0].atomIds, thiazoleGraph.options.bondLength);
    assert.equal(thiazoleCoords.size, 5);
    assert.ok(Math.abs(distance(thiazoleCoords.get('S1'), thiazoleCoords.get('C2')) - thiazoleGraph.options.bondLength) < 1e-6);

    const triazoleGraph = createLayoutGraph(parseSMILES('n1nc[nH]c1'));
    const triazoleCoords = placeTemplateCoords(triazoleGraph, 'triazole-1-2-4', triazoleGraph.ringSystems[0].atomIds, triazoleGraph.options.bondLength);
    assert.equal(triazoleCoords.size, 5);
    assert.ok(Math.abs(distance(triazoleCoords.get('N1'), triazoleCoords.get('N2')) - triazoleGraph.options.bondLength) < 1e-6);
  });

  it('places the supported spiro template too', () => {
    const graph = createLayoutGraph(makeSpiro());
    const coords = placeTemplateCoords(graph, 'spiro-5-5', graph.ringSystems[0].atomIds, graph.options.bondLength);
    assert.equal(coords.size, 9);
    assert.equal(coords.has('a4'), true);
  });

  it('places a bridged norbornane scaffold from its template', () => {
    const graph = createLayoutGraph(makeNorbornane());
    const coords = placeTemplateCoords(graph, 'norbornane', graph.ringSystems[0].atomIds, graph.options.bondLength);
    assert.equal(coords.size, 7);
    assert.equal(coords.has('a6'), true);
    assert.ok(coords.get('a6').y > coords.get('a0').y);
    assert.ok(coords.get('a6').y > coords.get('a1').y);
    assert.ok(coords.get('a2').x < coords.get('a1').x);
    assert.ok(coords.get('a4').x > coords.get('a0').x);
  });

  it('places the tropane bridge-atom scaffold with the expected cocaine-like projection', () => {
    const graph = createLayoutGraph(parseSMILES('N1C2CCC1CC(C2)'));
    const coords = placeTemplateCoords(graph, 'tropane', graph.ringSystems[0].atomIds, graph.options.bondLength);
    assert.equal(coords.size, 8);
    assert.ok(coords.get('N1').y > coords.get('C5').y);
    assert.ok(coords.get('N1').y > coords.get('C2').y);
    assert.ok(Math.abs(coords.get('N1').x - coords.get('C5').x) < 1e-6);
    assert.ok(coords.get('C5').x < coords.get('C2').x);
    assert.ok(coords.get('C2').x < coords.get('C8').x);
    assert.ok(coords.get('C8').x < coords.get('C7').x);
    assert.ok(coords.get('C4').x < coords.get('C3').x);
    assert.ok(coords.get('C3').x < coords.get('C5').x);
    assert.ok(coords.get('C2').y > coords.get('C8').y);
    assert.ok(coords.get('C8').y > coords.get('C7').y);
    assert.ok(coords.get('C7').y < coords.get('C6').y);
    assert.ok(coords.get('C7').y < coords.get('C8').y);
    assert.ok(coords.get('C4').y < coords.get('C3').y);
    assert.ok(coords.get('C6').y < coords.get('C8').y);
  });

  it('places the quinuclidine aza cage with the expected compact reference projection', () => {
    const graph = createLayoutGraph(parseSMILES('C1CN2CCC1CC2'));
    const coords = placeTemplateCoords(graph, 'quinuclidine', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const ys = [...coords.values()].map(position => position.y);
    assert.equal(coords.size, 8);
    assert.equal(coords.get('C1').y, Math.max(...ys));
    assert.ok(Math.abs(coords.get('N3').x - coords.get('C2').x) < 1e-6);
    assert.ok(Math.abs(coords.get('C1').x - coords.get('C6').x) < 0.15);
    assert.ok(coords.get('C2').y > coords.get('C6').y);
    assert.ok(coords.get('N3').y < coords.get('C2').y);
    assert.ok(coords.get('N3').y < coords.get('C6').y);
    assert.ok(coords.get('C4').y < coords.get('N3').y);
    assert.ok(coords.get('C8').y < coords.get('N3').y);
    assert.ok(coords.get('C4').x < coords.get('C5').x);
    assert.ok(coords.get('C5').x < coords.get('N3').x);
    assert.ok(coords.get('N3').x < coords.get('C6').x);
    assert.ok(coords.get('C6').x < coords.get('C8').x);
    assert.ok(coords.get('C8').x < coords.get('C7').x);
    assert.ok(coords.get('C4').y < coords.get('C5').y);
    assert.ok(coords.get('C8').y < coords.get('C7').y);
  });

  it('places the oxabicyclo[2.2.2]octane cage with the expected oxygen-right projection', () => {
    const graph = createLayoutGraph(parseSMILES('C12CCC(CO1)CC2'));
    const coords = placeTemplateCoords(graph, 'oxabicyclo-2-2-2', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const ys = [...coords.values()].map(position => position.y);
    assert.equal(coords.size, 8);
    assert.equal(coords.get('C8').y, Math.max(...ys));
    assert.ok(coords.get('O6').x > coords.get('C1').x);
    assert.ok(coords.get('C1').x > coords.get('C2').x);
    assert.ok(coords.get('C2').x > coords.get('C3').x);
    assert.ok(coords.get('C4').x < coords.get('C5').x);
    assert.ok(coords.get('C5').x < coords.get('O6').x);
    assert.ok(coords.get('C7').x < coords.get('C1').x);
    assert.ok(coords.get('C3').y < coords.get('C2').y);
    assert.ok(coords.get('C5').y < coords.get('O6').y);
    assert.ok(coords.get('C4').y < coords.get('C7').y);
    assert.ok(coords.get('C1').y < coords.get('C8').y);
  });

  it('places the oxabicyclo[3.1.1]heptane cage with the expected oxygen-bridge projection', () => {
    const graph = createLayoutGraph(parseSMILES('C1OC2CC(C1)C2'));
    const coords = placeTemplateCoords(graph, 'oxabicyclo-3-1-1', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const ys = [...coords.values()].map(position => position.y);
    assert.equal(coords.size, 7);
    assert.equal(coords.get('C7').y, Math.max(...ys));
    assert.equal(coords.get('O2').y, Math.min(...ys));
    assert.ok(coords.get('O2').x < coords.get('C3').x);
    assert.ok(coords.get('C1').x < coords.get('O2').x);
    assert.ok(coords.get('C6').x < coords.get('C5').x);
    assert.ok(coords.get('C5').x < coords.get('C4').x);
    assert.ok(coords.get('C3').x < coords.get('C4').x);
    assert.ok(coords.get('C3').y < coords.get('C5').y);
    assert.ok(coords.get('C4').y < coords.get('C5').y);
    assert.ok(coords.get('C3').y < coords.get('C7').y);
    assert.ok(coords.get('C5').y < coords.get('C7').y);
  });

  it('places the bridged lactone cage as open theta lanes with the carbonyl corner outside', () => {
    const graph = createLayoutGraph(parseSMILES('CN(CCN)C(=[NH2+])C1CCC2CCC1OC2=O'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'bridged-lactone-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });

    assert.equal(coords.size, 9);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C17').y > coords.get('C12').y);
    assert.ok(coords.get('O16').y > coords.get('C15').y);
    assert.ok(coords.get('C10').y < coords.get('C13').y);
    assert.ok(distance(coords.get('C13'), coords.get('C14')) > graph.options.bondLength * BRIDGED_VALIDATION.minBondLengthFactor);
    assert.ok(distance(coords.get('C11'), coords.get('C10')) < graph.options.bondLength * BRIDGED_VALIDATION.maxBondLengthFactor);
  });

  it('places the oxazabicyclic lactam cage as separated ether and lactam lanes', () => {
    const graph = createLayoutGraph(parseSMILES('CC1(CC#N)CC2COC1C(=O)N2'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'oxazabicyclic-lactam-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const etherRingAngles = ringAngles(coords, ['C6', 'C7', 'C8', 'O9', 'C10', 'C2']);
    const lactamRingAngles = ringAngles(coords, ['C10', 'C11', 'N13', 'C7', 'C6', 'C2']);

    assert.equal(coords.size, 8);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('N13').y > coords.get('C7').y);
    assert.ok(coords.get('C11').y > coords.get('C10').y);
    assert.ok(coords.get('C6').y < coords.get('C7').y);
    assert.ok(coords.get('C2').y < coords.get('C10').y);
    assert.ok(Math.min(...etherRingAngles) > 90);
    assert.ok(Math.min(...lactamRingAngles) > 110);
  });

  it('places the bridged pyrrolizidine dione cage as separated tricyclic lanes', () => {
    const graph = createLayoutGraph(parseSMILES(String.raw`C\C=C\C=C\C(=O)C1=C(O)[C@@]2(C)[C@H]3CCCN3[C@@H]1[C@](C)(O)C2=O`), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'bridged-pyrrolizidine-dione-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const pyrrolizidineAngles = ringAngles(coords, ['N18', 'C17', 'C16', 'C15', 'C13']);

    assert.equal(coords.size, 11);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C16').y > coords.get('N18').y);
    assert.ok(coords.get('C21').y < coords.get('C19').y);
    assert.ok(coords.get('C24').y < coords.get('C11').y);
    assert.ok(Math.min(...pyrrolizidineAngles) > 100);
  });

  it('places the amino oxaza tricyclo cage without crossed compressed bridge bonds', () => {
    const graph = createLayoutGraph(parseSMILES('CC1=C2C(OC1)C1(N)C3NC3C2CC1N'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'amino-oxaza-tricyclo-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const upperRingAngles = ringAngles(coords, ['C12', 'C13', 'C14', 'C7', 'C4', 'C3']);
    const aziridineAngles = ringAngles(coords, ['C11', 'N10', 'C9']);

    assert.equal(coords.size, 12);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C13').y > coords.get('C12').y);
    assert.ok(coords.get('N10').y > coords.get('C11').y);
    assert.ok(coords.get('C6').y < coords.get('C3').y);
    assert.ok(Math.min(...upperRingAngles) > 110);
    assert.ok(Math.min(...aziridineAngles) > 50);
  });

  it('places the amino diaza tricyclo cage as separated seven-member lanes', () => {
    const graph = createLayoutGraph(parseSMILES('CC1CC(O)C2CNC(=N)C1C1(C)NC=NC21'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'amino-diaza-tricyclo-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const carbocycleAngles = ringAngles(coords, ['C11', 'C12', 'C17', 'C6', 'C4', 'C3', 'C2']);
    const imineBridgeAngles = ringAngles(coords, ['C11', 'C12', 'C17', 'C6', 'C7', 'N8', 'C9']);
    const diazaCapAtomIds = ['C17', 'N16', 'C15', 'N14', 'C12'];
    const diazaCapAngles = ringAngles(coords, diazaCapAtomIds);
    const diazaCapLengths = diazaCapAtomIds.map((atomId, index) => distance(
      coords.get(atomId),
      coords.get(diazaCapAtomIds[(index + 1) % diazaCapAtomIds.length])
    ));

    assert.equal(coords.size, 13);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C15').y > coords.get('C12').y);
    assert.ok(coords.get('C3').y < coords.get('C11').y);
    assert.ok(coords.get('N8').y > coords.get('C3').y);
    assert.ok(Math.min(...carbocycleAngles) > 110);
    assert.ok(Math.min(...imineBridgeAngles) > 85);
    for (const angle of diazaCapAngles) {
      assert.ok(Math.abs(angle - 108) < 0.5, `expected the diaza cap to stay regular, got ${diazaCapAngles.map(candidate => candidate.toFixed(2)).join(', ')}`);
    }
    const compactCapLength = graph.options.bondLength * 0.8;
    for (const length of diazaCapLengths) {
      assert.ok(Math.abs(length - compactCapLength) < 1e-4, `expected the diaza cap to stay compact, got ${diazaCapLengths.map(candidate => candidate.toFixed(3)).join(', ')}`);
    }
  });

  it('places the acyl-substituted spiro-bridged aza cage with a compact exterior tail corner', () => {
    const graph = createLayoutGraph(parseSMILES('CCC(=O)C1CC2(C1)[NH2+]C1CC2C1'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'spiro-bridged-aza-cage', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const xs = [...coords.values()].map(position => position.x);
    const ys = [...coords.values()].map(position => position.y);

    assert.equal(coords.size, 9);
    assert.equal(coords.get('C5').x, Math.min(...xs));
    assert.equal(coords.get('N9').y, Math.max(...ys));
    assert.ok(coords.get('C6').x < coords.get('C7').x);
    assert.ok(coords.get('C8').x < coords.get('C7').x);
    assert.ok(coords.get('C11').x > coords.get('N9').x);
    assert.ok(coords.get('C12').x > coords.get('C11').x);
    assert.ok(coords.get('C14').x > coords.get('C7').x);
    assert.ok(coords.get('C13').y < coords.get('C14').y);
  });

  it('places the compact spiro-bridged oxetane cage with the nitrile corner outside', () => {
    const graph = createLayoutGraph(parseSMILES('N#CC1CC2(C1)C1CCC2O1'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'spiro-bridged-oxetane', graph.ringSystems[0].atomIds, graph.options.bondLength);
    assert.equal(coords.size, 9);
    assert.ok(coords.get('O11').x > coords.get('C5').x);
    assert.ok(coords.get('C8').x > coords.get('O11').x);
    assert.ok(coords.get('C9').x > coords.get('O11').x);
    assert.ok(coords.get('C3').x < coords.get('C5').x);
    assert.ok(coords.get('C6').x < coords.get('C5').x);
    assert.ok(coords.get('C3').x < coords.get('C4').x);
    assert.ok(distance(coords.get('C7'), coords.get('O11')) > graph.options.bondLength * BRIDGED_VALIDATION.minBondLengthFactor);
    assert.ok(distance(coords.get('C10'), coords.get('O11')) < graph.options.bondLength * BRIDGED_VALIDATION.maxBondLengthFactor);
  });

  it('places the sulfonyl azatricyclo cage with the sulfone corner outside', () => {
    const graph = createLayoutGraph(parseSMILES('CC12C[NH+](C1)C1C2C1S([O-])(=O)=O'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'sulfonyl-azatricyclo-cage', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });

    assert.equal(coords.size, 7);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C9').x < coords.get('C8').x);
    assert.ok(coords.get('C9').y > coords.get('C7').y);
    assert.ok(coords.get('N4').x > coords.get('C3').x);
  });

  it('places the benzoxathiobicyclo cage with the sulfur-oxygen ring below the bridged span', () => {
    const graph = createLayoutGraph(parseSMILES('C1CC2CC(C2)COC2=CC=C1S2'));
    const coords = placeTemplateCoords(graph, 'benzoxathiobicyclo-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    assert.equal(coords.size, 13);
    assert.ok(coords.get('C1').x < coords.get('C2').x);
    assert.ok(coords.get('C2').x < coords.get('C6').x);
    assert.ok(coords.get('C6').x < coords.get('C7').x);
    assert.ok(coords.get('C7').y > coords.get('O8').y);
    assert.ok(coords.get('O8').x > coords.get('C9').x);
    assert.ok(coords.get('S13').y > coords.get('C9').y);
    assert.ok(coords.get('C10').y < coords.get('C9').y);
    assert.ok(coords.get('C11').x < coords.get('C9').x);
    assert.ok(coords.get('C12').x < coords.get('S13').x);
  });

  it('places the morphinan core with exact benzene and middle cyclohexane rings', () => {
    const graph = createLayoutGraph(parseSMILES('C1C2Cc3ccccc3C1CCN2'));
    const coords = placeTemplateCoords(graph, 'morphinan-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const middleRing = ['C9', 'C10', 'C1', 'C2', 'C3', 'C4'];
    const benzeneRing = ['C5', 'C6', 'C7', 'C8', 'C9', 'C4'];

    assert.equal(coords.size, 13);
    for (const ring of [middleRing, benzeneRing]) {
      for (let index = 0; index < ring.length; index++) {
        const atomId = ring[index];
        const previousAtomId = ring[(index - 1 + ring.length) % ring.length];
        const nextAtomId = ring[(index + 1) % ring.length];
        const bondLength = distance(coords.get(atomId), coords.get(nextAtomId));
        const angle = angularDifference(
          angleOf(sub(coords.get(previousAtomId), coords.get(atomId))),
          angleOf(sub(coords.get(nextAtomId), coords.get(atomId)))
        );
        assert.ok(Math.abs(bondLength - graph.options.bondLength) < 1e-6);
        assert.ok(Math.abs(angle - (2 * Math.PI) / 3) < 1e-6);
      }
    }
  });

  it('places the larger oripavine core without malformed bridged ring bonds', () => {
    const graph = createLayoutGraph(parseSMILES('[H][C@@]12OC3=C(O)C=CC4=C3[C@@]11CCN(CC3CC3)[C@]([H])(C4)[C@]11CC[C@@]2(OC)[C@H](C1)C(C)(C)O'));
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'oripavine-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });

    assert.equal(coords.size, 20);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.ok(audit.maxBondLengthDeviation < graph.options.bondLength * 0.16);
    assert.ok(coords.get('C25').y < coords.get('C2').y);
    assert.ok(coords.get('C23').y > coords.get('C25').y);
  });

  it('places the oxaza morphinan core without malformed bridged ring bonds', () => {
    const graph = createLayoutGraph(parseSMILES('COC1(NC(=O)C(=CC2=CC=CC=C2)C(F)(F)F)C=C(O)C2=C3C1OC1CCCC4C(C2)[N+](CC2CC2)(CCC314)C(C)C'));
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'oxaza-morphinan-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const regularSixRings = [
      ['C24', 'C23', 'C22', 'C20', 'C19', 'C3'],
      ['C40', 'C26', 'C27', 'C28', 'C29', 'C30'],
      ['C32', 'C31', 'C30', 'C40', 'C23', 'C22']
    ];

    assert.equal(coords.size, 18);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.ok(audit.maxBondLengthDeviation < graph.options.bondLength * 0.58);
    for (const ring of regularSixRings) {
      for (let index = 0; index < ring.length; index++) {
        const atomId = ring[index];
        const previousAtomId = ring[(index - 1 + ring.length) % ring.length];
        const nextAtomId = ring[(index + 1) % ring.length];
        const bondLength = distance(coords.get(atomId), coords.get(nextAtomId));
        const angle = angularDifference(
          angleOf(sub(coords.get(previousAtomId), coords.get(atomId))),
          angleOf(sub(coords.get(nextAtomId), coords.get(atomId)))
        );
        assert.ok(Math.abs(bondLength - graph.options.bondLength) < 1e-5);
        assert.ok(Math.abs(angle - (2 * Math.PI) / 3) < 1e-5);
      }
    }
    assert.ok(coords.get('N33').y > coords.get('C40').y);
    assert.ok(coords.get('O25').y < coords.get('C40').y);
  });

  it('places the larger bicyclo and adamantane cage templates too', () => {
    const bicycloGraph = createLayoutGraph(makeBicyclo222());
    const bicycloCoords = placeTemplateCoords(bicycloGraph, 'bicyclo-2-2-2', bicycloGraph.ringSystems[0].atomIds, bicycloGraph.options.bondLength);
    assert.equal(bicycloCoords.size, 8);
    assert.equal(bicycloCoords.has('a7'), true);
    assert.ok(bicycloCoords.get('a6').y > bicycloCoords.get('a0').y);
    assert.ok(bicycloCoords.get('a7').x < bicycloCoords.get('a0').x);
    assert.ok(bicycloCoords.get('a2').x < bicycloCoords.get('a1').x);
    assert.ok(bicycloCoords.get('a4').x > bicycloCoords.get('a0').x);

    const cubaneGraph = createLayoutGraph(parseSMILES('C12C3C4C1C5C4C3C25'));
    const cubaneCoords = placeTemplateCoords(cubaneGraph, 'cubane', cubaneGraph.ringSystems[0].atomIds, cubaneGraph.options.bondLength);
    assert.equal(cubaneCoords.size, 8);
    const cubaneBondLengths = [...cubaneGraph.bonds.values()]
      .filter(bond => cubaneCoords.has(bond.a) && cubaneCoords.has(bond.b))
      .map(bond => distance(cubaneCoords.get(bond.a), cubaneCoords.get(bond.b)));
    const cubaneFaceEdges = cubaneBondLengths.filter(length => Math.abs(length - cubaneGraph.options.bondLength) < 1e-6);
    const cubaneConnectorEdges = cubaneBondLengths.filter(length => Math.abs(length - cubaneGraph.options.bondLength) >= 1e-6);
    assert.equal(cubaneBondLengths.length, 12);
    assert.equal(cubaneFaceEdges.length, 8);
    assert.equal(cubaneConnectorEdges.length, 4);
    assert.ok(cubaneConnectorEdges.every(length => Math.abs(length - cubaneConnectorEdges[0]) < 1e-6));
    assert.ok(cubaneConnectorEdges[0] > cubaneGraph.options.bondLength * 0.84);

    const adamantaneGraph = createLayoutGraph(makeAdamantane());
    const adamantaneCoords = placeTemplateCoords(adamantaneGraph, 'adamantane', adamantaneGraph.ringSystems[0].atomIds, adamantaneGraph.options.bondLength);
    assert.equal(adamantaneCoords.size, 10);
    assert.equal(adamantaneCoords.has('a9'), true);
    assert.ok(adamantaneCoords.get('a5').y > adamantaneCoords.get('a0').y);
    assert.ok(adamantaneCoords.get('a5').y > adamantaneCoords.get('a4').y);
    assert.ok(Math.abs(adamantaneCoords.get('a6').x - adamantaneCoords.get('a7').x) < 0.15);
    assert.ok(Math.abs(adamantaneCoords.get('a4').x - adamantaneCoords.get('a3').x) < 0.15);
    assert.ok(adamantaneCoords.get('a2').x > adamantaneCoords.get('a1').x);
    assert.ok(adamantaneCoords.get('a2').x < adamantaneCoords.get('a3').x);
  });
});
