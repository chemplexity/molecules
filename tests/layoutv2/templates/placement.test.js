import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../src/layoutv2/model/layout-graph.js';
import { distance } from '../../../src/layoutv2/geometry/vec2.js';
import { placeTemplateCoords } from '../../../src/layoutv2/templates/placement.js';
import { makeAdamantane, makeBenzene, makeBicyclo222, makeNaphthalene, makeNorbornane, makeSpiro } from '../support/molecules.js';

describe('layoutv2/templates/placement', () => {
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
    const benzotriazoleCoords = placeTemplateCoords(
      benzotriazoleGraph,
      'benzotriazole',
      benzotriazoleGraph.ringSystems[0].atomIds,
      benzotriazoleGraph.options.bondLength
    );
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
    assert.ok((Math.max(...acridineXs) - Math.min(...acridineXs)) > (Math.max(...acridineYs) - Math.min(...acridineYs)));

    const anthraceneGraph = createLayoutGraph(parseSMILES('c1ccc2cc3ccccc3cc2c1'));
    const anthraceneCoords = placeTemplateCoords(anthraceneGraph, 'anthracene', anthraceneGraph.ringSystems[0].atomIds, anthraceneGraph.options.bondLength);
    assert.equal(anthraceneCoords.size, 14);
    assert.ok(Math.abs(anthraceneCoords.get('C4').x - anthraceneCoords.get('C13').x) < 1e-6);
    assert.ok(Math.abs(anthraceneCoords.get('C6').x - anthraceneCoords.get('C11').x) < 1e-6);
    const anthraceneXs = [...anthraceneCoords.values()].map(position => position.x);
    const anthraceneYs = [...anthraceneCoords.values()].map(position => position.y);
    assert.ok((Math.max(...anthraceneXs) - Math.min(...anthraceneXs)) > (Math.max(...anthraceneYs) - Math.min(...anthraceneYs)));

    const pyreneGraph = createLayoutGraph(parseSMILES('c1cc2ccc3cccc4ccc(c1)c2c34'));
    const pyreneCoords = placeTemplateCoords(pyreneGraph, 'pyrene', pyreneGraph.ringSystems[0].atomIds, pyreneGraph.options.bondLength);
    assert.equal(pyreneCoords.size, 16);
    const pyreneXs = [...pyreneCoords.values()].map(position => position.x);
    const pyreneYs = [...pyreneCoords.values()].map(position => position.y);
    assert.ok((Math.max(...pyreneXs) - Math.min(...pyreneXs)) > (Math.max(...pyreneYs) - Math.min(...pyreneYs)));
    assert.ok(Math.abs(Math.max(...pyreneXs) + Math.min(...pyreneXs)) < 1e-6);
    assert.ok(Math.abs(Math.max(...pyreneYs) + Math.min(...pyreneYs)) < 1e-6);
    assert.equal(new Set(pyreneXs.map(value => Number(value.toFixed(6)))).size, 6);
    assert.equal(new Set(pyreneYs.map(value => Number(value.toFixed(6)))).size, 6);

    const fluoreneGraph = createLayoutGraph(parseSMILES('c1ccc2c(c1)Cc1ccccc1-2'));
    const fluoreneCoords = placeTemplateCoords(fluoreneGraph, 'fluorene', fluoreneGraph.ringSystems[0].atomIds, fluoreneGraph.options.bondLength);
    assert.equal(fluoreneCoords.size, 13);
    const fluoreneXs = [...fluoreneCoords.values()].map(position => position.x);
    const fluoreneYs = [...fluoreneCoords.values()].map(position => position.y);
    assert.ok((Math.max(...fluoreneXs) - Math.min(...fluoreneXs)) > (Math.max(...fluoreneYs) - Math.min(...fluoreneYs)));
    assert.ok(Math.abs(fluoreneCoords.get('C1').x + fluoreneCoords.get('C10').x) < 1e-6);
    assert.ok(Math.abs(fluoreneCoords.get('C4').x + fluoreneCoords.get('C13').x) < 1e-6);
    assert.equal(
      fluoreneCoords.get('C7').y,
      Math.max(...['C1', 'C10', 'C2', 'C11', 'C6', 'C9', 'C3', 'C12', 'C7', 'C5', 'C8', 'C4', 'C13'].map(atomId => fluoreneCoords.get(atomId).y))
    );

    const testosteroneGraph = createLayoutGraph(parseSMILES('C[C@]12CC[C@H]3[C@@H](CC=C4C[C@@H](O)CC[C@]34C)[C@@H]1CC[C@@H]2=O'));
    const testosteroneCoords = placeTemplateCoords(
      testosteroneGraph,
      'steroid-core-unsaturated',
      testosteroneGraph.ringSystems[0].atomIds,
      testosteroneGraph.options.bondLength
    );
    assert.equal(testosteroneCoords.size, 17);
    const testosteroneXs = [...testosteroneCoords.values()].map(position => position.x);
    const testosteroneYs = [...testosteroneCoords.values()].map(position => position.y);
    assert.ok((Math.max(...testosteroneXs) - Math.min(...testosteroneXs)) > (Math.max(...testosteroneYs) - Math.min(...testosteroneYs)));
    const testosteronePentagonMeanX = ['C20', 'C22', 'C23', 'C24', 'C2']
      .map(atomId => testosteroneCoords.get(atomId).x)
      .reduce((sum, value) => sum + value, 0) / 5;
    const testosteroneHexMeanX = ['C12', 'C13', 'C16', 'C17', 'C18', 'C11']
      .map(atomId => testosteroneCoords.get(atomId).x)
      .reduce((sum, value) => sum + value, 0) / 6;
    assert.ok(testosteronePentagonMeanX > testosteroneHexMeanX);

    const steroidTestGraph = createLayoutGraph(parseSMILES('C[C@]12CC[C@H]3[C@@H](CC[C@@H]4CC(=O)CC[C@]34C)[C@@H]1CC[C@@H]2O'));
    const steroidTestCoords = placeTemplateCoords(
      steroidTestGraph,
      'steroid-core-saturated',
      steroidTestGraph.ringSystems[0].atomIds,
      steroidTestGraph.options.bondLength
    );
    assert.equal(steroidTestCoords.size, 17);
    const steroidTestXs = [...steroidTestCoords.values()].map(position => position.x);
    const steroidTestYs = [...steroidTestCoords.values()].map(position => position.y);
    assert.ok((Math.max(...steroidTestXs) - Math.min(...steroidTestXs)) > (Math.max(...steroidTestYs) - Math.min(...steroidTestYs)));
    const steroidPentagonMeanX = ['C20', 'C22', 'C23', 'C24', 'C2']
      .map(atomId => steroidTestCoords.get(atomId).x)
      .reduce((sum, value) => sum + value, 0) / 5;
    const steroidHexMeanX = ['C16', 'C17', 'C18', 'C11', 'C13', 'C14']
      .map(atomId => steroidTestCoords.get(atomId).x)
      .reduce((sum, value) => sum + value, 0) / 6;
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
    const isochromaneCoords = placeTemplateCoords(
      isochromaneGraph,
      'isochromane',
      isochromaneGraph.ringSystems[0].atomIds,
      isochromaneGraph.options.bondLength
    );
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
    assert.ok(Math.abs((Math.max(...xs) - Math.min(...xs)) - (Math.max(...ys) - Math.min(...ys))) < 1e-6);

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
    assert.ok(cubaneConnectorEdges[0] > (cubaneGraph.options.bondLength * 0.84));

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
