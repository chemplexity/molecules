import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSMILES } from '../../../../src/io/smiles.js';
import { createLayoutGraph } from '../../../../src/layout/engine/model/layout-graph.js';
import { angleOf, angularDifference, distance, sub } from '../../../../src/layout/engine/geometry/vec2.js';
import { pointInPolygon } from '../../../../src/layout/engine/geometry/polygon.js';
import { placeTemplateCoords } from '../../../../src/layout/engine/templates/placement.js';
import { getTemplateCoords } from '../../../../src/layout/engine/templates/library.js';
import { BRIDGED_VALIDATION } from '../../../../src/layout/engine/constants.js';
import { auditLayout } from '../../../../src/layout/engine/audit/audit.js';
import { assignBondValidationClass } from '../../../../src/layout/engine/placement/bond-validation.js';
import { inspectEZStereo } from '../../../../src/layout/engine/stereo/ez.js';
import { makeAdamantane, makeBenzene, makeBicyclo222, makeNaphthalene, makeNorbornane, makeSpiro } from '../support/molecules.js';

function ringAngles(coords, atomIds) {
  return atomIds.map(
    (atomId, index) =>
      angularDifference(
        angleOf(sub(coords.get(atomIds[(index - 1 + atomIds.length) % atomIds.length]), coords.get(atomId))),
        angleOf(sub(coords.get(atomIds[(index + 1) % atomIds.length]), coords.get(atomId)))
      ) *
      (180 / Math.PI)
  );
}

function bondAngleAtAtom(coords, centerAtomId, firstNeighborAtomId, secondNeighborAtomId) {
  return angularDifference(angleOf(sub(coords.get(firstNeighborAtomId), coords.get(centerAtomId))), angleOf(sub(coords.get(secondNeighborAtomId), coords.get(centerAtomId)))) * (180 / Math.PI);
}

describe('layout/engine/templates/placement', () => {
  it('returns fresh template coordinate maps while reusing cached scaled entries internally', () => {
    const firstCoords = getTemplateCoords('benzene', 1.5);
    const secondCoords = getTemplateCoords('benzene', 1.5);
    assert.notEqual(firstCoords, secondCoords);
    assert.deepEqual(secondCoords.get('a0'), firstCoords.get('a0'));
    firstCoords.get('a0').x = 123;
    assert.notEqual(secondCoords.get('a0').x, 123);
  });

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
    const benzimidazoliumCoords = placeTemplateCoords(benzimidazoliumGraph, 'benzimidazolium', benzimidazoliumGraph.ringSystems[0].atomIds, benzimidazoliumGraph.options.bondLength);
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

    const pterinGraph = createLayoutGraph(parseSMILES('C1=CN=C2NC(=O)C(=N2)N=C1'));
    const pterinCoords = placeTemplateCoords(pterinGraph, 'pterin-core', pterinGraph.ringSystems[0].atomIds, pterinGraph.options.bondLength);
    const pterinLargeRing = pterinGraph.rings.find(ring => ring.atomIds.length === 8);
    const pterinLargePolygon = pterinLargeRing.atomIds.map(atomId => pterinCoords.get(atomId));
    const pterinOuterSevenAngles = ringAngles(pterinCoords, ['C11', 'N10', 'C8', 'C4', 'N3', 'C2', 'C1']);
    const pterinOuterSevenPolygon = ['C11', 'N10', 'C8', 'C4', 'N3', 'C2', 'C1'].map(atomId => pterinCoords.get(atomId));
    assert.equal(pterinCoords.size, 10);
    assert.equal(pointInPolygon(pterinCoords.get('N5'), pterinLargePolygon), false);
    assert.equal(pointInPolygon(pterinCoords.get('C6'), pterinLargePolygon), false);
    assert.equal(pointInPolygon(pterinCoords.get('N9'), pterinOuterSevenPolygon), true);
    assert.equal(pointInPolygon(pterinCoords.get('N5'), pterinOuterSevenPolygon), false);
    assert.equal(pointInPolygon(pterinCoords.get('C6'), pterinOuterSevenPolygon), false);
    assert.ok(pterinOuterSevenAngles.every(angle => Math.abs(angle - 128.571) < 1), `expected pterin outer contour to stay near seven-member angles, got ${pterinOuterSevenAngles.join(', ')}`);

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

    const aminoBromoDiazaKetoneGraph = createLayoutGraph(parseSMILES('Nc1ccc2nc3C(=O)c4cccnc4c5nccc(c35)c2c1Br'), { suppressH: true });
    const aminoBromoDiazaKetoneCoords = placeTemplateCoords(
      aminoBromoDiazaKetoneGraph,
      'amino-bromo-diaza-ketone-pericondensed-core',
      aminoBromoDiazaKetoneGraph.ringSystems[0].atomIds,
      aminoBromoDiazaKetoneGraph.options.bondLength
    );
    const aminoBromoDiazaKetoneAngles = aminoBromoDiazaKetoneGraph.rings.flatMap(ring => ringAngles(aminoBromoDiazaKetoneCoords, ring.atomIds));
    const aminoBromoDiazaKetoneLengths = aminoBromoDiazaKetoneGraph.rings.flatMap(ring =>
      ring.atomIds.map((atomId, index) => distance(aminoBromoDiazaKetoneCoords.get(atomId), aminoBromoDiazaKetoneCoords.get(ring.atomIds[(index + 1) % ring.atomIds.length])))
    );
    const aminoBromoDiazaKetoneXs = [...aminoBromoDiazaKetoneCoords.values()].map(position => position.x);
    const aminoBromoDiazaKetoneYs = [...aminoBromoDiazaKetoneCoords.values()].map(position => position.y);
    assert.equal(aminoBromoDiazaKetoneCoords.size, 21);
    assert.ok(Math.max(...aminoBromoDiazaKetoneXs) - Math.min(...aminoBromoDiazaKetoneXs) > Math.max(...aminoBromoDiazaKetoneYs) - Math.min(...aminoBromoDiazaKetoneYs));
    assert.ok(Math.max(...aminoBromoDiazaKetoneAngles.map(angle => Math.abs(angle - 120))) < 1e-9);
    assert.ok(Math.max(...aminoBromoDiazaKetoneLengths.map(length => Math.abs(length - aminoBromoDiazaKetoneGraph.options.bondLength))) < 1e-9);

    const fluoreneGraph = createLayoutGraph(parseSMILES('c1ccc2c(c1)Cc1ccccc1-2'));
    const fluoreneCoords = placeTemplateCoords(fluoreneGraph, 'fluorene', fluoreneGraph.ringSystems[0].atomIds, fluoreneGraph.options.bondLength);
    assert.equal(fluoreneCoords.size, 13);
    const fluoreneXs = [...fluoreneCoords.values()].map(position => position.x);
    const fluoreneYs = [...fluoreneCoords.values()].map(position => position.y);
    assert.ok(Math.max(...fluoreneXs) - Math.min(...fluoreneXs) > Math.max(...fluoreneYs) - Math.min(...fluoreneYs));
    assert.ok(Math.abs(fluoreneCoords.get('C1').x + fluoreneCoords.get('C10').x) < 1e-6);
    assert.ok(Math.abs(fluoreneCoords.get('C4').x + fluoreneCoords.get('C13').x) < 1e-6);
    assert.equal(fluoreneCoords.get('C7').y, Math.max(...['C1', 'C10', 'C2', 'C11', 'C6', 'C9', 'C3', 'C12', 'C7', 'C5', 'C8', 'C4', 'C13'].map(atomId => fluoreneCoords.get(atomId).y)));

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

  it('places the calixarene guanidine macrocycle with regular aryl walls', () => {
    const graph = createLayoutGraph(parseSMILES('NC(=N)NCCOc1c2Cc3cccc(Cc4cccc(Cc5cccc(Cc1ccc2)c5O)c4OCC(=O)NC(=N)N)c3O'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'calixarene-guanidine-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'planar')
    });
    const arylRings = [
      ['C8', 'C9', 'C32', 'C31', 'C30', 'C29'],
      ['C11', 'C12', 'C13', 'C14', 'C15', 'C44'],
      ['C17', 'C18', 'C19', 'C20', 'C21', 'C35'],
      ['C23', 'C24', 'C25', 'C26', 'C27', 'C33']
    ];
    const maxArylAngleDeviation = Math.max(...arylRings.flatMap(ring => ringAngles(coords, ring).map(angle => Math.abs(angle - 120))));

    assert.equal(coords.size, 28);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.ok(maxArylAngleDeviation < 1e-4, `expected regular aryl wall angles, got max deviation ${maxArylAngleDeviation}`);
  });

  it('places the trans-polyene macrolide template with regular fused rings and satisfied E alkenes', () => {
    const graph = createLayoutGraph(parseSMILES(String.raw`CC(C)[C@H]1OC(=O)C2=CCCN2C(=O)C2=COC(=N2)CC(=O)C[C@H](O)\C=C(/C)\C=C\CNC(=O)\C=C\[C@H]1C`), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'trans-polyene-macrolide', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const stereo = inspectEZStereo(graph, coords);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      stereo: { ezViolationCount: stereo.violationCount }
    });
    const pyrrolidoneAngles = ringAngles(coords, ['N13', 'C12', 'C11', 'C10', 'C9']);
    const oxazoleAngles = ringAngles(coords, ['N20', 'C19', 'O18', 'C17', 'C16']);

    assert.equal(coords.size, 28);
    assert.equal(audit.ok, true);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(stereo.violationCount, 0);
    assert.ok(Math.min(...pyrrolidoneAngles, ...oxazoleAngles) > 107);
    assert.ok(Math.max(...pyrrolidoneAngles, ...oxazoleAngles) < 109);
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

  it('places crowded quaternary norbornane exits with an open bridgehead fan', () => {
    const graph = createLayoutGraph(parseSMILES('CCC1CC2(CC1CC2CC)C(C)(C)[NH3+]'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'quaternary-exit-norbornane-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const firstRingAngles = ringAngles(coords, ['C9', 'C8', 'C7', 'C6', 'C5']);
    const secondRingAngles = ringAngles(coords, ['C7', 'C6', 'C5', 'C4', 'C3']);
    const quaternaryExitBridgeAngle = bondAngleAtAtom(coords, 'C5', 'C6', 'C4');

    assert.equal(coords.size, 7);
    assert.ok(Math.min(...firstRingAngles, ...secondRingAngles) > 60);
    assert.ok(quaternaryExitBridgeAngle > 75, `expected quaternary bridgehead exit to stay open, got ${quaternaryExitBridgeAngle.toFixed(2)}`);
  });

  it('places a norbornene scaffold without flattening the one-atom bridge', () => {
    const graph = createLayoutGraph(parseSMILES('C1C2CC(C=C2)C1'));
    const coords = placeTemplateCoords(graph, 'norbornene', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const firstRingAngles = ringAngles(coords, ['C6', 'C5', 'C4', 'C3', 'C2']);
    const secondRingAngles = ringAngles(coords, ['C7', 'C4', 'C3', 'C2', 'C1']);
    const sharedBridgeAngle = secondRingAngles[2];

    assert.equal(coords.size, 7);
    assert.ok(Math.max(...firstRingAngles, ...secondRingAngles) < 150);
    assert.ok(
      sharedBridgeAngle > 80 && sharedBridgeAngle < 100,
      `expected the shared one-atom bridge to bend open, got ${sharedBridgeAngle.toFixed(2)} from ${secondRingAngles.map(angle => angle.toFixed(2)).join(', ')}`
    );
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

  it('places charged quinuclidinium cages without pinched six-membered rings', () => {
    const graph = createLayoutGraph(parseSMILES('[N+]12CCC(CC1)C(C2)'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'quinuclidinium', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const firstRingAngles = ringAngles(coords, ['C2', 'C3', 'C4', 'C5', 'C6', 'N1']);
    const secondRingAngles = ringAngles(coords, ['C6', 'C5', 'C4', 'C7', 'C8', 'N1']);
    const allAngles = [...firstRingAngles, ...secondRingAngles];

    assert.equal(coords.size, 8);
    assert.ok(Math.min(...allAngles) > 75);
    assert.ok(Math.max(...allAngles) < 160);
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

  it('places caged hydroxy lactone steroids with readable fused ring lobes', () => {
    const graph = createLayoutGraph(parseSMILES('[H][C@@]12C[C@@]3(CC1=C)[C@@]([H])(CC2)[C@@]12CC[C@]([H])(O)[C@@](C)(C(=O)O1)[C@@]2([H])[C@]3([H])C(O)=O'), {
      suppressH: true
    });
    const coords = placeTemplateCoords(graph, 'caged-hydroxy-lactone-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const leftSixAngles = ringAngles(coords, ['C11', 'C10', 'C8', 'C4', 'C3', 'C2']);
    const rightSixAngles = ringAngles(coords, ['C18', 'C23', 'C12', 'C13', 'C14', 'C15']);
    const lactoneAngles = ringAngles(coords, ['O22', 'C20', 'C18', 'C23', 'C12']);
    const centralBridgeAngles = ringAngles(coords, ['C25', 'C23', 'C12', 'C8', 'C4']);
    const c12LactoneExitSeparation = angularDifference(angleOf(sub(coords.get('O22'), coords.get('C12'))), angleOf(sub(coords.get('C13'), coords.get('C12')))) * (180 / Math.PI);

    assert.equal(coords.size, 17);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(Math.min(...leftSixAngles) > 88);
    assert.ok(Math.min(...rightSixAngles) > 100);
    assert.ok(Math.min(...lactoneAngles) > 87);
    assert.ok(c12LactoneExitSeparation > 25);
    assert.ok(Math.max(...centralBridgeAngles) < 112);
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

  it('places methoxy ammonium oxazabicyclic lactams with an open middle bridge', () => {
    const graph = createLayoutGraph(parseSMILES('COC12CCC(CC(C)[NH+](C)C1)NC(=O)O2'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'methoxy-ammonium-oxazabicyclic-lactam-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const ammoniumRingAngles = ringAngles(coords, ['C13', 'N10', 'C8', 'C7', 'C6', 'C5', 'C4', 'C3']);
    const ammoniumNonBridgeheadAngles = ammoniumRingAngles.filter((_, index) => index !== 4 && index !== 7);
    const lactamRingAngles = ringAngles(coords, ['O17', 'C15', 'N14', 'C6', 'C5', 'C4', 'C3']);
    const centralBridgeAngles = [bondAngleAtAtom(coords, 'C4', 'C3', 'C5'), bondAngleAtAtom(coords, 'C5', 'C4', 'C6')];

    assert.equal(coords.size, 11);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(Math.min(...ammoniumNonBridgeheadAngles) > 120);
    assert.ok(Math.min(...lactamRingAngles) > 110);
    assert.ok(Math.max(...centralBridgeAngles) < 145);
  });

  it('places the hydroxy oxazabicyclic lactam cage with the alcohol bridge outside the lactam lane', () => {
    const graph = createLayoutGraph(parseSMILES('OC1C2CNC(=O)C1O2'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'hydroxy-oxazabicyclic-lactam-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const lactamRingAngles = ringAngles(coords, ['C8', 'O9', 'C3', 'C4', 'N5', 'C6']);
    const hydroxyBridgeAngles = ringAngles(coords, ['C8', 'O9', 'C3', 'C2']);

    assert.equal(coords.size, 7);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C2').y > coords.get('C3').y);
    assert.ok(coords.get('N5').y < coords.get('O9').y);
    assert.ok(Math.min(...lactamRingAngles) > 75);
    assert.ok(Math.min(...hydroxyBridgeAngles) > 65);
  });

  it('places dihydroxy oxabicyclic lactones as separated carbocycle and lactone lanes', () => {
    const graph = createLayoutGraph(parseSMILES('OC1C2CC1(O)C(=O)O2'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'dihydroxy-oxabicyclic-lactone-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const lactoneRingAngles = ringAngles(coords, ['O9', 'C7', 'C5', 'C2', 'C3']);
    const carbocycleRingAngles = ringAngles(coords, ['C5', 'C4', 'C3', 'C2']);

    assert.equal(coords.size, 6);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C2').y > coords.get('C3').y);
    assert.ok(coords.get('C2').y > coords.get('C5').y);
    assert.ok(coords.get('C4').y < coords.get('C3').y);
    assert.ok(coords.get('O9').y < coords.get('C4').y);
    assert.ok(coords.get('C7').y < coords.get('C4').y);
    assert.ok(Math.min(...lactoneRingAngles) > 80);
    assert.ok(Math.min(...carbocycleRingAngles) > 80);
    assert.ok(Math.max(...lactoneRingAngles) < 130);
    assert.ok(Math.max(...carbocycleRingAngles) < 110);
  });

  it('places hydroxyalkyl oxatricyclic lactones without crossing the cyclobutane core', () => {
    const graph = createLayoutGraph(parseSMILES('OCCC12OC3CC1C3C2=O'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'hydroxyalkyl-oxatricyclic-lactone-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const etherRingAtomIds = ['O5', 'C6', 'C7', 'C8', 'C4'];
    const etherRingAngles = ringAngles(coords, etherRingAtomIds);
    const etherRingBondLengths = etherRingAtomIds.map((atomId, index) => distance(coords.get(atomId), coords.get(etherRingAtomIds[(index + 1) % etherRingAtomIds.length])));
    const meanEtherRingBondLength = etherRingBondLengths.reduce((sum, length) => sum + length, 0) / etherRingBondLengths.length;
    const cyclobutaneAngles = ringAngles(coords, ['C9', 'C8', 'C7', 'C6']);
    const coreAtomIds = graph.ringSystems[0].atomIds;
    const coreAtomIdSet = new Set(coreAtomIds);
    const coreBondLengths = [...graph.bonds.values()]
      .filter(bond => coreAtomIdSet.has(bond.a) && coreAtomIdSet.has(bond.b))
      .map(bond => distance(coords.get(bond.a), coords.get(bond.b)));

    assert.equal(coords.size, 7);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C9').x > coords.get('C8').x);
    assert.ok(coords.get('C10').x > coords.get('C4').x);
    assert.ok(Math.max(...etherRingAngles.map(angle => Math.abs(angle - 108))) < 0.1);
    assert.ok(Math.max(...etherRingBondLengths.map(length => Math.abs(length - meanEtherRingBondLength))) < graph.options.bondLength * 0.002);
    assert.ok(Math.min(...coreBondLengths) > graph.options.bondLength * 0.9);
    assert.ok(Math.max(...coreBondLengths) < graph.options.bondLength * 1.4);
    assert.ok(Math.max(...cyclobutaneAngles) < 155);
  });

  it('places the azabicyclo ketone oxadiazole cage with separated theta lanes', () => {
    const graph = createLayoutGraph(parseSMILES('O=C1C2C[NH2+]C1C2C1=NON=C1'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'azabicyclo-ketone-oxadiazole-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const fiveRingAngles = ringAngles(coords, ['C4', 'N5', 'C7', 'C8', 'C3']);
    const fourRingAngles = ringAngles(coords, ['C7', 'C8', 'C3', 'C2']);

    assert.equal(coords.size, 6);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.ok(coords.get('C8').y > coords.get('C3').y);
    assert.ok(coords.get('C8').y > coords.get('C7').y);
    assert.ok(coords.get('C2').y < coords.get('C3').y);
    assert.ok(Math.min(...fiveRingAngles) > 95);
    assert.ok(Math.max(...fiveRingAngles) < 125);
    assert.ok(Math.min(...fourRingAngles) > 70);
    assert.ok(Math.max(...fourRingAngles) < 115);
  });

  it('places the cyanoacyl azabicyclo cage without crossing the compact cap', () => {
    const graph = createLayoutGraph(parseSMILES('O=C(C#N)N1CC2CC1C2'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'cyanoacyl-azabicyclo-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const nitrogenRingAngles = ringAngles(coords, ['C9', 'C10', 'C7', 'C6', 'N5']);
    const capRingAngles = ringAngles(coords, ['C10', 'C9', 'C8', 'C7']);

    assert.equal(coords.size, 6);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C10').y > coords.get('C9').y);
    assert.ok(coords.get('C8').y < coords.get('C9').y);
    assert.ok(coords.get('N5').y < coords.get('C8').y);
    assert.ok(Math.min(...nitrogenRingAngles) > 80);
    assert.ok(Math.max(...nitrogenRingAngles) < 135);
    assert.ok(Math.min(...capRingAngles) > 80);
    assert.ok(Math.max(...capRingAngles) < 105);
  });

  it('places the aminonitrile acetal-bridged core without flattening the saturated ring', () => {
    const graph = createLayoutGraph(parseSMILES('CC1NC2(C)CC1(OCOC1=C2C=CN1)C#N'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'aminonitrile-acetal-bridged-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const saturatedRingAngles = ringAngles(coords, ['C7', 'C6', 'C4', 'N3', 'C2']);
    const acetalBridgeAngles = ringAngles(coords, ['C12', 'C11', 'O10', 'C9', 'O8', 'C7', 'C6', 'C4']);
    const heteroarylAngles = ringAngles(coords, ['N15', 'C14', 'C13', 'C12', 'C11']);

    assert.equal(coords.size, 13);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(Math.min(...saturatedRingAngles) > 100);
    assert.ok(Math.max(...saturatedRingAngles) < 125);
    assert.ok(Math.min(...acetalBridgeAngles) > 105);
    assert.ok(Math.max(...acetalBridgeAngles) < 138);
    assert.ok(Math.min(...heteroarylAngles) > 106);
    assert.ok(Math.max(...heteroarylAngles) < 110);
  });

  it('places the cyano formyl acetal bridged core with open five-ring lanes', () => {
    const graph = createLayoutGraph(parseSMILES('CC1CC2CC1(C#N)C1(COC(CO2)O1)C=O'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'cyano-formyl-acetal-bridged-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const carbocycleAngles = ringAngles(coords, ['C6', 'C5', 'C4', 'C3', 'C2']);
    const acetalRingAngles = ringAngles(coords, ['O15', 'C12', 'O11', 'C10', 'C9']);
    const bridgeAngles = ringAngles(coords, ['O14', 'C13', 'C12', 'O15', 'C9', 'C6', 'C5', 'C4']);

    assert.equal(coords.size, 12);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(Math.min(...carbocycleAngles) > 75);
    assert.ok(Math.max(...carbocycleAngles) < 116);
    assert.ok(Math.min(...acetalRingAngles) > 90);
    assert.ok(Math.max(...acetalRingAngles) < 146);
    assert.ok(Math.min(...bridgeAngles) > 90);
    assert.ok(Math.max(...bridgeAngles) < 160);
  });

  it('places the formyl acetal cyclobutane core without crossing the C3 ring lane', () => {
    const graph = createLayoutGraph(parseSMILES('CCC1C2CCC1C21COC(C)C(O1)C=O'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'formyl-acetal-cyclobutane-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const cyclobutaneAngles = ringAngles(coords, ['C7', 'C8', 'C4', 'C3']);
    const cyclopentaneAngles = ringAngles(coords, ['C5', 'C6', 'C7', 'C8', 'C4']);
    const acetalAngles = ringAngles(coords, ['O14', 'C13', 'C11', 'O10', 'C9', 'C8']);

    assert.equal(coords.size, 11);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(audit.maxBondLengthDeviation < graph.options.bondLength * 0.24);
    assert.ok(Math.min(...cyclobutaneAngles) > 80);
    assert.ok(Math.max(...cyclobutaneAngles) < 100);
    assert.ok(Math.min(...cyclopentaneAngles) > 80);
    assert.ok(Math.max(...cyclopentaneAngles) < 135);
    assert.ok(Math.min(...acetalAngles) > 105);
    assert.ok(Math.max(...acetalAngles) < 130);
  });

  it('places the aminonitrile oxabicyclobutane core without folded five-four rings', () => {
    const graph = createLayoutGraph(parseSMILES('CCC12CC(C1)(OC2C[NH3+])C(N)C#N'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'aminonitrile-oxabicyclobutane-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const etherFiveRingAngles = ringAngles(coords, ['C8', 'O7', 'C5', 'C6', 'C3']);
    const cyclobutaneAngles = ringAngles(coords, ['C6', 'C5', 'C4', 'C3']);

    assert.equal(coords.size, 6);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(audit.maxBondLengthDeviation < graph.options.bondLength * 0.2);
    assert.ok(Math.min(...etherFiveRingAngles) > 90);
    assert.ok(Math.max(...etherFiveRingAngles) < 125);
    assert.ok(Math.min(...cyclobutaneAngles) > 80);
    assert.ok(Math.max(...cyclobutaneAngles) < 105);
  });

  it('places the ammonium cyanomethyl oxatricyclo core without malformed oxetane lanes', () => {
    const graph = createLayoutGraph(parseSMILES('[NH3+]C1(CC#N)CC23CC(O2)C1C3'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'ammonium-cyanomethyl-oxatricyclo-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const upperFiveRingAngles = ringAngles(coords, ['C13', 'C12', 'C10', 'O11', 'C8']);
    const ammoniumFiveRingAngles = ringAngles(coords, ['C12', 'C13', 'C8', 'C7', 'C3']);
    const oxetaneAngles = ringAngles(coords, ['O11', 'C10', 'C9', 'C8']);

    assert.equal(coords.size, 8);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(audit.maxBondLengthDeviation < graph.options.bondLength * 0.3);
    assert.ok(Math.min(...upperFiveRingAngles) > 85);
    assert.ok(Math.max(...upperFiveRingAngles) < 142);
    assert.ok(Math.min(...ammoniumFiveRingAngles) > 60);
    assert.ok(Math.max(...ammoniumFiveRingAngles) < 142);
    assert.ok(Math.min(...oxetaneAngles) > 60);
    assert.ok(Math.max(...oxetaneAngles) < 130);
  });

  it('places the cyclopropane azabicyclic enone core with separated seven-ring lanes', () => {
    const graph = createLayoutGraph(parseSMILES('CCOCC1=CC(=O)C2CCNC1C1CC21'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'cyclopropane-azabicyclic-enone-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const carbocycleAngles = ringAngles(coords, ['C13', 'C14', 'C16', 'C9', 'C7', 'C6', 'C5']);
    const azaRingAngles = ringAngles(coords, ['C10', 'C11', 'N12', 'C13', 'C14', 'C16', 'C9']);
    const cyclopropaneAngles = ringAngles(coords, ['C16', 'C15', 'C14']);

    assert.equal(coords.size, 11);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(audit.maxBondLengthDeviation < graph.options.bondLength * 0.3);
    assert.ok(Math.min(...carbocycleAngles, ...azaRingAngles) > 105);
    assert.ok(Math.max(...carbocycleAngles, ...azaRingAngles) < 145);
    assert.ok(Math.min(...cyclopropaneAngles) > 55);
    assert.ok(Math.max(...cyclopropaneAngles) < 65);
  });

  it('places the hydroxy aminomethyl bicyclo ketone core without stretched fallback bonds', () => {
    const graph = createLayoutGraph(parseSMILES('C[NH2+]CC12CC(O)(C1)C(=O)C2'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'hydroxy-aminomethyl-bicyclo-ketone-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const ketoneFiveRingAngles = ringAngles(coords, ['C12', 'C10', 'C7', 'C9', 'C5']);
    const cyclobutaneAngles = ringAngles(coords, ['C9', 'C7', 'C6', 'C5']);

    assert.equal(coords.size, 6);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(audit.maxBondLengthDeviation < graph.options.bondLength * 0.3);
    assert.ok(Math.min(...ketoneFiveRingAngles) > 40);
    assert.ok(Math.max(...ketoneFiveRingAngles) < 125);
    assert.ok(Math.min(...cyclobutaneAngles) > 70);
    assert.ok(Math.max(...cyclobutaneAngles) < 125);
  });

  it('places the compact azabicyclo nitrile core without stretched fallback bonds', () => {
    const graph = createLayoutGraph(parseSMILES('C[NH+]1C2CCC1C2(C)CC#N'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'azabicyclo-nitrile-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const fiveRingAngles = ringAngles(coords, ['C5', 'C6', 'C7', 'C8', 'C4']);
    const ammoniumRingAngles = ringAngles(coords, ['C7', 'C8', 'C4', 'N2']);

    assert.equal(coords.size, 6);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(audit.maxBondLengthDeviation < graph.options.bondLength * 0.4);
    assert.ok(Math.min(...fiveRingAngles) > 100);
    assert.ok(Math.max(...fiveRingAngles) < 120);
    assert.ok(Math.min(...ammoniumRingAngles) > 70);
    assert.ok(Math.max(...ammoniumRingAngles) < 120);
  });

  it('places the bridged oxadecalin cage as structured stacked theta rings', () => {
    const graph = createLayoutGraph(parseSMILES('CC1CC2COC(C)C(C1)C(C)(C)C2CCO'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'bridged-oxadecalin-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const carbocycleAngles = ringAngles(coords, ['C10', 'C9', 'C11', 'C14', 'C4', 'C3', 'C2']);
    const etherRingAngles = ringAngles(coords, ['C9', 'C11', 'C14', 'C4', 'C5', 'O6', 'C7']);

    assert.equal(coords.size, 10);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C14').y > coords.get('C4').y);
    assert.ok(coords.get('C11').y > coords.get('C9').y);
    assert.ok(coords.get('C5').y < coords.get('C4').y);
    assert.ok(coords.get('O6').y < coords.get('C5').y);
    assert.ok(coords.get('C7').y < coords.get('C9').y);
    assert.ok(Math.min(...carbocycleAngles, ...etherRingAngles) > 105);
    assert.ok(Math.max(...carbocycleAngles, ...etherRingAngles) < 155);
  });

  it('places the cyclobutane-capped oxadecalin cage without crossed lanes', () => {
    const graph = createLayoutGraph(parseSMILES('CC1CC2(C1)C(C)CC1CCCC2CCO1'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'cyclobutane-oxadecalin-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const carbocycleAngles = ringAngles(coords, ['C6', 'C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C4']);
    const etherRingAngles = ringAngles(coords, ['C13', 'C14', 'C15', 'O16', 'C9', 'C8', 'C6', 'C4']);
    const cyclobutaneAngles = ringAngles(coords, ['C5', 'C4', 'C3', 'C2']);

    assert.equal(coords.size, 14);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(Math.min(...carbocycleAngles) > 105);
    assert.ok(Math.max(...carbocycleAngles) < 162);
    assert.ok(Math.min(...etherRingAngles) > 80);
    assert.ok(Math.max(...etherRingAngles) < 162);
    assert.ok(Math.min(...cyclobutaneAngles) > 55);
    assert.ok(Math.max(...cyclobutaneAngles) < 125);
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

  it('places the bridged diketone tricyclo cage without flattening a five-ring bridge', () => {
    const graph = createLayoutGraph(parseSMILES('O=C1CC2C(=O)C3CCC12C3'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'bridged-diketone-tricyclo-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const bridgedFiveAngles = ringAngles(coords, ['C8', 'C9', 'C10', 'C11', 'C7']);
    const diketoneFiveAngles = ringAngles(coords, ['C7', 'C11', 'C10', 'C4', 'C5']);
    const cyclobutaneAngles = ringAngles(coords, ['C10', 'C4', 'C3', 'C2']);

    assert.equal(coords.size, 9);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(Math.min(...bridgedFiveAngles) > 45);
    assert.ok(Math.max(...bridgedFiveAngles) < 125);
    assert.ok(Math.min(...diketoneFiveAngles) > 100);
    assert.ok(Math.max(...diketoneFiveAngles) < 112);
    assert.ok(Math.min(...cyclobutaneAngles) > 85);
    assert.ok(Math.max(...cyclobutaneAngles) < 95);
  });

  it('places the acetal amino decalin cage without flattening the shared bridge path', () => {
    const graph = createLayoutGraph(parseSMILES('COC(OC)[C@@]12CC[C@@H]3CCCC3(C1)[C@@H](N[C@@H]2C(=O)OC)C(=O)OC'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'acetal-amino-decalin-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const lowerSixAngles = ringAngles(coords, ['C15', 'C6', 'C7', 'C8', 'C9', 'C14']);
    const aminoSixAngles = ringAngles(coords, ['C15', 'C14', 'C16', 'N18', 'C19', 'C6']);
    const exteriorFiveAngles = ringAngles(coords, ['C14', 'C13', 'C12', 'C11', 'C9']);

    assert.equal(coords.size, 12);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(Math.min(...lowerSixAngles) > 115, `expected the lower six-member ring to stay regular, got ${lowerSixAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...lowerSixAngles) < 125, `expected the lower six-member ring to stay regular, got ${lowerSixAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...aminoSixAngles) > 75, `expected the amino ring lane to stay open, got ${aminoSixAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...aminoSixAngles) < 145, `expected the amino ring lane to avoid a flat bridge, got ${aminoSixAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...exteriorFiveAngles) > 104, `expected the exterior five-member ring to stay regular, got ${exteriorFiveAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...exteriorFiveAngles) < 112, `expected the exterior five-member ring to stay regular, got ${exteriorFiveAngles.map(angle => angle.toFixed(2)).join(', ')}`);
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

  it('places the aza-oxa cyclopropyl oxetane cage with separated compact ring lanes', () => {
    const graph = createLayoutGraph(parseSMILES('CCCC1C2C3N2CC(O)C32OCC12'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'aza-oxa-cyclopropyl-oxetane-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const firstFiveRingAngles = ringAngles(coords, ['C11', 'C6', 'N7', 'C8', 'C9']);
    const secondFiveRingAngles = ringAngles(coords, ['C14', 'C11', 'C6', 'C5', 'C4']);
    const oxetaneAngles = ringAngles(coords, ['C14', 'C13', 'O12', 'C11']);
    const cyclopropaneAngles = ringAngles(coords, ['N7', 'C6', 'C5']);

    assert.equal(coords.size, 10);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('N7').y > coords.get('C6').y);
    assert.ok(coords.get('O12').y < coords.get('C11').y);
    assert.ok(Math.min(...firstFiveRingAngles) > 89);
    assert.ok(Math.min(...secondFiveRingAngles) > 89);
    assert.ok(Math.min(...oxetaneAngles) > 74);
    assert.ok(Math.min(...cyclopropaneAngles) > 52);
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
    const diazaCapLengths = diazaCapAtomIds.map((atomId, index) => distance(coords.get(atomId), coords.get(diazaCapAtomIds[(index + 1) % diazaCapAtomIds.length])));

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

  it('places the imino thiazole oxaza tricyclo cage with open fused lanes', () => {
    const graph = createLayoutGraph(parseSMILES('CC1C23COC(=N)C12NCC1=C3N=C(C)S1'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'imino-thiazole-oxaza-tricyclo-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const sixRingAngles = ringAngles(coords, ['C12', 'C11', 'C10', 'N9', 'C8', 'C3']);
    const oxazaRingAngles = ringAngles(coords, ['C8', 'C3', 'C4', 'O5', 'C6']);
    const thiazoleAngles = ringAngles(coords, ['S16', 'C14', 'N13', 'C12', 'C11']);
    const cyclopropaneAngles = ringAngles(coords, ['C8', 'C3', 'C2']);

    assert.equal(coords.size, 13);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(audit.maxBondLengthDeviation < graph.options.bondLength * 0.2);
    assert.ok(Math.min(...sixRingAngles) > 119);
    assert.ok(Math.min(...oxazaRingAngles) > 95);
    assert.ok(Math.min(...thiazoleAngles) > 107);
    assert.ok(Math.min(...cyclopropaneAngles) > 40);
  });

  it('places the hydroxy thiazole cyclopropyl pentacycle with clean compact core bonds', () => {
    const graph = createLayoutGraph(parseSMILES('CC12C3C4C=CC1(O)C1=NSC4=C1C23C=O'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'hydroxy-thiazole-cyclopropyl-pentacycle-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const cyclohexeneAngles = ringAngles(coords, ['C6', 'C7', 'C2', 'C3', 'C4', 'C5']);
    const cyclopropaneAngles = ringAngles(coords, ['C14', 'C3', 'C2']);

    assert.equal(coords.size, 12);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(audit.maxBondLengthDeviation < graph.options.bondLength * 0.38);
    assert.ok(Math.min(...cyclohexeneAngles) > 50);
    assert.ok(Math.max(...cyclohexeneAngles) < 150);
    assert.ok(Math.min(...cyclopropaneAngles) > 50);
    assert.ok(Math.max(...cyclopropaneAngles) < 75);
  });

  it('places sulfonyl aza cycloheptene cyclopropane cages with readable alkene ring geometry', () => {
    const graph = createLayoutGraph(parseSMILES('CCC12C3C4=CCCC(CN1S4(=O)=O)C23OC'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'sulfonyl-aza-cycloheptene-cyclopropane-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const cyclohepteneAngles = ringAngles(coords, ['C6', 'C7', 'C8', 'C9', 'C15', 'C4', 'C5']);
    const azaFiveRingAngles = ringAngles(coords, ['N11', 'C10', 'C9', 'C15', 'C3']);
    const sulfoneFiveRingAngles = ringAngles(coords, ['S12', 'N11', 'C3', 'C4', 'C5']);
    const cyclopropaneAngles = ringAngles(coords, ['C15', 'C4', 'C3']);

    assert.equal(coords.size, 11);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(audit.maxBondLengthDeviation < graph.options.bondLength * 0.41);
    assert.ok(Math.min(...cyclohepteneAngles) > 90, `expected the alkene seven-ring to stay open, got ${cyclohepteneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclohepteneAngles) < 155, `expected the alkene seven-ring to avoid flattening, got ${cyclohepteneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...azaFiveRingAngles) > 50, `expected the aza five-ring to stay open, got ${azaFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...azaFiveRingAngles) < 156, `expected the aza five-ring to avoid flattening, got ${azaFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...sulfoneFiveRingAngles) > 50, `expected the sulfone five-ring to stay open, got ${sulfoneFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...sulfoneFiveRingAngles) < 156, `expected the sulfone five-ring to avoid flattening, got ${sulfoneFiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.min(...cyclopropaneAngles) > 54, `expected the cyclopropane cap to stay triangular, got ${cyclopropaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...cyclopropaneAngles) < 72, `expected the cyclopropane cap to avoid stretching, got ${cyclopropaneAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('places the aza-annulene cyclohexadiene core with a regular six-member ring', () => {
    const graph = createLayoutGraph(parseSMILES('CCC1=NC(N)=CC(C)=CC=C2NC=CC1=C2'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'aza-annulene-cyclohexadiene-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const sixMemberAtomIds = ['C17', 'C16', 'C15', 'C14', 'N13', 'C12'];
    const sixMemberAngles = ringAngles(coords, sixMemberAtomIds);
    const sixMemberLengths = sixMemberAtomIds.map((atomId, index) => distance(coords.get(atomId), coords.get(sixMemberAtomIds[(index + 1) % sixMemberAtomIds.length])));

    assert.equal(coords.size, 13);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C7').y > coords.get('C17').y);
    assert.ok(coords.get('C14').y < coords.get('C17').y);
    for (const angle of sixMemberAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-4, `expected the six-member ring to stay regular, got ${sixMemberAngles.map(candidate => candidate.toFixed(2)).join(', ')}`);
    }
    for (const length of sixMemberLengths) {
      assert.ok(Math.abs(length - graph.options.bondLength) < 1e-4, `expected six-member ring bonds to stay normal, got ${sixMemberLengths.map(candidate => candidate.toFixed(3)).join(', ')}`);
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

  it('places the N-methyl lactam diazatricyclo cage with opened five-member lanes', () => {
    const graph = createLayoutGraph(parseSMILES('CN1CCC2C3NC(=O)C2([NH3+])CC13'), { suppressH: true });
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'n-methyl-lactam-diaza-tricyclo-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const ringAtomIds = [
      ['C14', 'C6', 'C5', 'C4', 'C3', 'N2'],
      ['C10', 'C13', 'C14', 'C6', 'C5'],
      ['C10', 'C5', 'C6', 'N7', 'C8']
    ];

    assert.equal(coords.size, 10);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(coords, ring);
      const lengths = ring.map((atomId, index) => distance(coords.get(atomId), coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 60, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 136, `expected ${ring.join('-')} to avoid over-flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...lengths) < graph.options.bondLength * 1.35, `expected ${ring.join('-')} bonds to stay bounded, got ${lengths.map(length => length.toFixed(3)).join(', ')}`);
    }
  });

  it('places the ammonium cyclobutyl-pyrrolidine cage without crossing the shared bridge', () => {
    const graph = createLayoutGraph(parseSMILES('C12CC(C1)C[NH2+]2'), { suppressH: true });
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'ammonium-cyclobutyl-pyrrolidine-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const ringAtomIds = [
      ['C1', 'C2', 'C3', 'C4'],
      ['C1', 'C4', 'C3', 'C5', 'N6']
    ];

    assert.equal(coords.size, 6);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(coords, ring);
      const lengths = ring.map((atomId, index) => distance(coords.get(atomId), coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 45, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 105, `expected ${ring.join('-')} to avoid flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.min(...lengths) > graph.options.bondLength * BRIDGED_VALIDATION.minBondLengthFactor);
      assert.ok(Math.max(...lengths) < graph.options.bondLength * BRIDGED_VALIDATION.maxBondLengthFactor);
    }
  });

  it('places the neutral azabicyclo-pyrrolidine cage as separated theta lanes', () => {
    const graph = createLayoutGraph(parseSMILES('C12CN(C1)CC2'), { suppressH: true });
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'azabicyclo-pyrrolidine-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const ringAtomIds = [
      ['C6', 'C5', 'N3', 'C4', 'C1'],
      ['C4', 'N3', 'C2', 'C1']
    ];

    assert.equal(coords.size, 6);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C2').y > coords.get('C1').y);
    assert.ok(coords.get('C5').y < coords.get('C4').y);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(coords, ring);
      const lengths = ring.map((atomId, index) => distance(coords.get(atomId), coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 50, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 105, `expected ${ring.join('-')} to avoid flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.min(...lengths) > graph.options.bondLength * BRIDGED_VALIDATION.minBondLengthFactor);
      assert.ok(Math.max(...lengths) < graph.options.bondLength * BRIDGED_VALIDATION.maxBondLengthFactor);
    }
  });

  it('places shared-edge tricyclic ether cages without crossing the carbon lanes', () => {
    const graph = createLayoutGraph(parseSMILES('CC1COCCCC23CCCC12CCC3'), { suppressH: true });
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'shared-edge-tricyclic-ether-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const ringAtomIds = [
      ['C12', 'C8', 'C7', 'C6', 'C5', 'O4', 'C3', 'C2'],
      ['C9', 'C10', 'C11', 'C12', 'C8'],
      ['C12', 'C13', 'C14', 'C15', 'C8']
    ];

    assert.equal(coords.size, 14);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('O4').x < coords.get('C12').x);
    assert.ok(coords.get('C14').x > coords.get('C8').x);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(coords, ring);
      const lengths = ring.map((atomId, index) => distance(coords.get(atomId), coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 85, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 165, `expected ${ring.join('-')} to avoid over-flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.min(...lengths) >= graph.options.bondLength * BRIDGED_VALIDATION.minBondLengthFactor - 1e-6);
      assert.ok(Math.max(...lengths) <= graph.options.bondLength * BRIDGED_VALIDATION.maxBondLengthFactor + 1e-6);
    }
  });

  it('places dioxatricyclodiene ether cages with open fused paths', () => {
    const graph = createLayoutGraph(parseSMILES('CCOCC1=C2CC(C1)COC1OC2C=C1'), { suppressH: true });
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'dioxatricyclodiene-ether-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const ringAtomIds = [
      ['C14', 'O13', 'C12', 'O11', 'C10', 'C8', 'C7', 'C6'],
      ['C16', 'C15', 'C14', 'O13', 'C12'],
      ['C9', 'C8', 'C7', 'C6', 'C5']
    ];

    assert.equal(coords.size, 12);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    for (const [ringIndex, ring] of ringAtomIds.entries()) {
      const angles = ringAngles(coords, ring);
      const lengths = ring.map((atomId, index) => distance(coords.get(atomId), coords.get(ring[(index + 1) % ring.length])));
      const minAngle = ringIndex === 0 ? 100 : 70;
      const maxAngle = ringIndex === 0 ? 160 : 155;
      assert.ok(Math.min(...angles) > minAngle, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < maxAngle, `expected ${ring.join('-')} to avoid over-flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.min(...lengths) >= graph.options.bondLength * BRIDGED_VALIDATION.minBondLengthFactor - 1e-6);
      assert.ok(Math.max(...lengths) <= graph.options.bondLength * BRIDGED_VALIDATION.maxBondLengthFactor + 1e-6);
    }
  });

  it('places N-methyl amino diaza tricyclo cages with separated ring lanes', () => {
    const graph = createLayoutGraph(parseSMILES('CN1CC2CC(C)(N)CC11CNC21'), { suppressH: true });
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'n-methyl-amino-diaza-tricyclo-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const ringAtomIds = [
      ['C9', 'C10', 'C13', 'C4', 'C5', 'C6'],
      ['C10', 'C13', 'C4', 'C3', 'N2'],
      ['C13', 'N12', 'C11', 'C10']
    ];

    assert.equal(coords.size, 10);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);

    const sixRingAngles = ringAngles(coords, ringAtomIds[0]);
    assert.ok(Math.min(...sixRingAngles) > 110, `expected six-ring lane to stay structured, got ${sixRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...sixRingAngles) < 135, `expected six-ring lane to avoid flattening, got ${sixRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);

    const fiveRingAngles = ringAngles(coords, ringAtomIds[1]);
    const fiveRingLengths = ringAtomIds[1].map((atomId, index) => distance(coords.get(atomId), coords.get(ringAtomIds[1][(index + 1) % ringAtomIds[1].length])));
    assert.ok(Math.min(...fiveRingAngles) > 55, `expected diaza lane to stay open, got ${fiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...fiveRingAngles) < 135, `expected diaza lane to avoid flattening, got ${fiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...fiveRingLengths) < graph.options.bondLength * 1.25, `expected diaza lane bonds to stay bounded, got ${fiveRingLengths.map(length => length.toFixed(3)).join(', ')}`);

    const fourRingAngles = ringAngles(coords, ringAtomIds[2]);
    assert.ok(Math.min(...fourRingAngles) > 85, `expected aminal cap to stay square-like, got ${fourRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...fourRingAngles) < 96, `expected aminal cap to avoid flattening, got ${fourRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });

  it('places substituted bicyclo[2.1.1]hexane cages without crossing cap bonds', () => {
    const graph = createLayoutGraph(parseSMILES('N#CC(C1C[NH2+]C1)C12CC(C1)CC2'), { suppressH: true });
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'substituted-bicyclo-2-1-1-hexane-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const ringAtomIds = [
      ['C14', 'C13', 'C11', 'C12', 'C9'],
      ['C12', 'C11', 'C10', 'C9']
    ];

    assert.equal(coords.size, 6);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C3') == null);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(coords, ring);
      const lengths = ring.map((atomId, index) => distance(coords.get(atomId), coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 45, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 113, `expected ${ring.join('-')} to avoid over-flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.min(...lengths) >= graph.options.bondLength * BRIDGED_VALIDATION.minBondLengthFactor - 1e-6);
      assert.ok(Math.max(...lengths) <= graph.options.bondLength * BRIDGED_VALIDATION.maxBondLengthFactor + 1e-6);
    }
    assert.ok(Math.abs(ringAngles(coords, ringAtomIds[0])[0] - ringAngles(coords, ringAtomIds[0])[1]) < 1);
    assert.ok(Math.abs(ringAngles(coords, ringAtomIds[0])[2] - ringAngles(coords, ringAtomIds[0])[4]) < 1);
  });

  it('places trigonal-carbon bicyclo[2.1.1]hexane cages without pinching the five-member lane', () => {
    const graph = createLayoutGraph(parseSMILES('O=CC12CC(C1)CC2'), { suppressH: true });
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'trigonal-carbon-bicyclo-2-1-1-hexane-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const ringAtomIds = [
      ['C8', 'C7', 'C5', 'C6', 'C3'],
      ['C6', 'C5', 'C4', 'C3']
    ];

    assert.equal(coords.size, 6);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(coords, ring);
      const lengths = ring.map((atomId, index) => distance(coords.get(atomId), coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 45, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 123, `expected ${ring.join('-')} to avoid over-flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.min(...lengths) >= graph.options.bondLength * BRIDGED_VALIDATION.minBondLengthFactor - 1e-6);
      assert.ok(Math.max(...lengths) <= graph.options.bondLength * BRIDGED_VALIDATION.maxBondLengthFactor + 1e-6);
    }
    assert.ok(Math.abs(ringAngles(coords, ringAtomIds[0])[0] - ringAngles(coords, ringAtomIds[0])[1]) < 1);
    assert.ok(Math.abs(ringAngles(coords, ringAtomIds[0])[2] - ringAngles(coords, ringAtomIds[0])[4]) < 1);
  });

  it('places cyclopropane-capped azacyclooctane cages with separated ring lanes', () => {
    const graph = createLayoutGraph(parseSMILES('CC1C2CC3(CC3)C1C(C)C[NH2+]C(C)(C)C2'), { suppressH: true });
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'cyclopropane-azacyclooctane-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const ringAtomIds = [
      ['C17', 'C14', 'N12', 'C11', 'C9', 'C8', 'C2', 'C3'],
      ['C8', 'C5', 'C4', 'C3', 'C2'],
      ['C7', 'C6', 'C5']
    ];

    assert.equal(coords.size, 12);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C1') == null);
    assert.ok(coords.get('C6').x > coords.get('C5').x);
    assert.ok(coords.get('C7').x > coords.get('C5').x);
    assert.ok(coords.get('N12').y > coords.get('C8').y);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(coords, ring);
      const lengths = ring.map((atomId, index) => distance(coords.get(atomId), coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 50, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 150, `expected ${ring.join('-')} to avoid over-flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.min(...lengths) >= graph.options.bondLength * BRIDGED_VALIDATION.minBondLengthFactor - 1e-6);
      assert.ok(Math.max(...lengths) <= graph.options.bondLength * BRIDGED_VALIDATION.maxBondLengthFactor + 1e-6);
    }
  });

  it('places hydroxy aminopropyl cyclobutane-decalin cages without flattening the six-ring lanes', () => {
    const graph = createLayoutGraph(parseSMILES('CC1CC2(C1)CC1(O)CCC2C(CC[NH3+])C1'), { suppressH: true });
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'hydroxy-aminopropyl-cyclobutane-decalin-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const ringAtomIds = [
      ['C6', 'C7', 'C9', 'C10', 'C11', 'C4'],
      ['C11', 'C12', 'C17', 'C7', 'C6', 'C4'],
      ['C5', 'C4', 'C3', 'C2']
    ];

    assert.equal(coords.size, 11);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C12').x > coords.get('C11').x);
    assert.ok(coords.get('C17').y < coords.get('C12').y);
    for (const ring of ringAtomIds) {
      const angles = ringAngles(coords, ring);
      const lengths = ring.map((atomId, index) => distance(coords.get(atomId), coords.get(ring[(index + 1) % ring.length])));
      assert.ok(Math.min(...angles) > 55, `expected ${ring.join('-')} to stay open, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.max(...angles) < 136, `expected ${ring.join('-')} to avoid over-flattening, got ${angles.map(angle => angle.toFixed(2)).join(', ')}`);
      assert.ok(Math.min(...lengths) >= graph.options.bondLength * BRIDGED_VALIDATION.minBondLengthFactor - 1e-6);
      assert.ok(Math.max(...lengths) <= graph.options.bondLength * BRIDGED_VALIDATION.maxBondLengthFactor + 1e-6);
    }
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

  it('places the triazaadamantane cage without crossed polyaza ring bonds', () => {
    const graph = createLayoutGraph(parseSMILES('C12CN3CN(CN(C3)C1)C2'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'triazaadamantane-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const exposedCarbonAngles = [
      angularDifference(angleOf(sub(coords.get('C1'), coords.get('C2'))), angleOf(sub(coords.get('N3'), coords.get('C2')))) * (180 / Math.PI),
      angularDifference(angleOf(sub(coords.get('C1'), coords.get('C10'))), angleOf(sub(coords.get('N5'), coords.get('C10')))) * (180 / Math.PI)
    ];
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });

    assert.equal(coords.size, 10);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(coords.get('C1').x < coords.get('N3').x);
    assert.ok(coords.get('C1').x < coords.get('N5').x);
    assert.ok(coords.get('C1').x < coords.get('N7').x);
    assert.ok(
      exposedCarbonAngles.every(angle => angle < 160),
      `expected C2/C10 to form visible cage vertices, got ${exposedCarbonAngles.map(angle => angle.toFixed(1)).join(', ')}`
    );
  });

  it('places the sulfonyl cyclopentenyl azocane core with a structured five-member ring', () => {
    const graph = createLayoutGraph(parseSMILES('CC1=C2CS(=O)(=O)C1C(CCNC2(C)C)C=O'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'sulfonyl-cyclopentenyl-azocane-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const fiveRingAngles = ringAngles(coords, ['C8', 'C2', 'C3', 'C4', 'S5']);
    const upperContourAtomIds = ['C3', 'C13', 'N12', 'C11', 'C10', 'C9', 'C8'];
    const upperContourAngles = ringAngles(coords, upperContourAtomIds);
    const upperContourPolygon = upperContourAtomIds.map(atomId => coords.get(atomId));

    assert.equal(coords.size, 10);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    for (const angle of fiveRingAngles) {
      assert.ok(Math.abs(angle - 108) < 1e-3, `expected the sulfonyl cyclopentene ring to stay pentagonal, got ${angle.toFixed(2)} degrees`);
    }
    for (const angle of upperContourAngles) {
      assert.ok(Math.abs(angle - 128.571) < 1, `expected the azocane outer contour to stay heptagonal, got ${upperContourAngles.map(candidate => candidate.toFixed(2)).join(', ')}`);
    }
    assert.equal(pointInPolygon(coords.get('C2'), upperContourPolygon), true);
  });

  it('places the hydroxy alkyl bicyclohexene core with a structured cyclopentenyl ring', () => {
    const graph = createLayoutGraph(parseSMILES('CCC1(O)C2C(CN(C)C)C1(CC)C=C2C'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'hydroxy-alkyl-bicyclohexene-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const fiveRingAtomIds = ['C15', 'C14', 'C11', 'C3', 'C5'];
    const fiveRingAngles = ringAngles(coords, fiveRingAtomIds);
    const minReadableBondLength = graph.options.bondLength * BRIDGED_VALIDATION.minBondLengthFactor;
    const maxReadableBondLength = graph.options.bondLength * BRIDGED_VALIDATION.maxBondLengthFactor;
    const ringBondLengths = [
      ['C3', 'C5'],
      ['C5', 'C15'],
      ['C15', 'C14'],
      ['C14', 'C11'],
      ['C11', 'C3'],
      ['C5', 'C6'],
      ['C6', 'C11']
    ].map(([firstAtomId, secondAtomId]) => distance(coords.get(firstAtomId), coords.get(secondAtomId)));

    assert.equal(coords.size, 6);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.ok(Math.min(...fiveRingAngles) > 80, `expected the hydroxy bicyclohexene five-ring to avoid pinched corners, got ${fiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...fiveRingAngles) < 145, `expected the hydroxy bicyclohexene five-ring to avoid flattened corners, got ${fiveRingAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    for (const bondLength of ringBondLengths) {
      assert.ok(bondLength >= minReadableBondLength && bondLength <= maxReadableBondLength);
    }
  });

  it('places the oxime lactam cyclopentenyl core without flattening the five-member ring', () => {
    const graph = createLayoutGraph(parseSMILES('CC1C2CC=C1C(=NO)C(C)C1N(CC1=O)C2'), { suppressH: true });
    const coords = placeTemplateCoords(graph, 'oxime-lactam-cyclopentenyl-core', graph.ringSystems[0].atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, graph.ringSystems[0].atomIds, 'bridged')
    });
    const fiveRingAngles = ringAngles(coords, ['C6', 'C5', 'C4', 'C3', 'C2']);
    const lactamAngles = ringAngles(coords, ['C15', 'C14', 'N13', 'C12']);

    assert.equal(coords.size, 12);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    for (const angle of fiveRingAngles) {
      assert.ok(Math.abs(angle - 108) < 0.05, `expected the cyclopentenyl ring to stay pentagonal, got ${fiveRingAngles.map(candidate => candidate.toFixed(2)).join(', ')}`);
    }
    for (const angle of lactamAngles) {
      assert.ok(Math.abs(angle - 90) < 1e-6, `expected the beta-lactam ring to stay square, got ${lactamAngles.map(candidate => candidate.toFixed(2)).join(', ')}`);
    }
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
        const angle = angularDifference(angleOf(sub(coords.get(previousAtomId), coords.get(atomId))), angleOf(sub(coords.get(nextAtomId), coords.get(atomId))));
        assert.ok(Math.abs(bondLength - graph.options.bondLength) < 1e-6);
        assert.ok(Math.abs(angle - (2 * Math.PI) / 3) < 1e-6);
      }
    }
  });

  it('places the saturated morphinan core without stretched fallback bonds', () => {
    const graph = createLayoutGraph(parseSMILES('[H][C@@]12CCCC[C@@]11CCN(CC=C)[C@@H]2CC2=C1C=C(O)C=C2'), { suppressH: true });
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'saturated-morphinan-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const outerCyclohexaneAngles = ringAngles(coords, ['C3', 'C4', 'C5', 'C6', 'C7', 'C2']);
    const azaBridgeAngles = ringAngles(coords, ['C7', 'C8', 'C9', 'N10', 'C14', 'C2']);
    const fusedCyclohexeneAngles = ringAngles(coords, ['C14', 'C16', 'C17', 'C18', 'C7', 'C2']);
    const aromaticAngles = ringAngles(coords, ['C23', 'C22', 'C20', 'C19', 'C18', 'C17']);

    assert.equal(coords.size, 17);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.ok(audit.maxBondLengthDeviation < graph.options.bondLength * 0.22);
    for (const angle of outerCyclohexaneAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-3, `expected outer cyclohexane angle near 120 degrees, got ${angle.toFixed(2)}`);
    }
    assert.ok(Math.min(...azaBridgeAngles) > 50);
    assert.ok(Math.max(...azaBridgeAngles) < 160);
    for (const angle of fusedCyclohexeneAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-3, `expected fused cyclohexene angle near 120 degrees, got ${angle.toFixed(2)}`);
    }
    for (const angle of aromaticAngles) {
      assert.ok(Math.abs(angle - 120) < 1e-3, `expected aromatic angle near 120 degrees, got ${angle.toFixed(2)}`);
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

  it('places the oxygen-bridged bisindole lactam core with open aromatic lanes', () => {
    const graph = createLayoutGraph(parseSMILES('[H][C@@]12C[C@H](<C(=O)OOC>)[C@](C)(O1)N1C3=C(C=C(CSCC)C=C3)C3=C4CNC(=O)C4=C4C5=C(C=CC(CSCC)=C5)N2C4=C13'), { suppressH: true });
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'oxygen-bridged-bisindole-lactam-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const centralAngles = ringAngles(coords, ['C26', 'C31', 'C32', 'C44', 'C45', 'C25']);
    const lowerIndoleAngles = ringAngles(coords, ['C45', 'C25', 'C16', 'C15', 'N14']);
    const upperIndoleAngles = ringAngles(coords, ['C44', 'N43', 'C34', 'C33', 'C32']);

    assert.equal(coords.size, 28);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.ok(Math.max(...centralAngles.map(angle => Math.abs(angle - 120))) < 1e-3);
    assert.ok(Math.min(...lowerIndoleAngles) > 103);
    assert.ok(Math.max(...lowerIndoleAngles) < 116);
    assert.ok(Math.min(...upperIndoleAngles) > 103);
    assert.ok(Math.max(...upperIndoleAngles) < 116);
    assert.ok(coords.get('C4').y < coords.get('O13').y, 'expected the small oxygen bridge to leave the ester-bearing atom on the exterior face');
  });

  it('places the indoline aza bridged heptacycle core without collapsed bridge bonds', () => {
    const graph = createLayoutGraph(parseSMILES('CC[C@H]1[C@@H]2C[C@H]3[C@@H]4N(C)C5=CC=CC=C5[C@]44C[C@@H](C2[C@H]4O)N3[C@@H]1O'), { suppressH: true });
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'indoline-aza-bridged-heptacycle-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const minReadableBondLength = graph.options.bondLength * BRIDGED_VALIDATION.minBondLengthFactor;
    const maxReadableBondLength = graph.options.bondLength * BRIDGED_VALIDATION.maxBondLengthFactor;
    const ringBondLengths = [...graph.bonds.values()]
      .filter(bond => bond.inRing && rootRingSystem.atomIds.includes(bond.a) && rootRingSystem.atomIds.includes(bond.b))
      .map(bond => distance(coords.get(bond.a), coords.get(bond.b)));

    assert.equal(coords.size, 19);
    assert.equal(audit.ok, true);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.ok(distance(coords.get('C8'), coords.get('N28')) > minReadableBondLength);
    for (const ringBondLength of ringBondLengths) {
      assert.ok(ringBondLength >= minReadableBondLength && ringBondLength <= maxReadableBondLength);
    }
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
        const angle = angularDifference(angleOf(sub(coords.get(previousAtomId), coords.get(atomId))), angleOf(sub(coords.get(nextAtomId), coords.get(atomId))));
        assert.ok(Math.abs(bondLength - graph.options.bondLength) < 1e-5);
        assert.ok(Math.abs(angle - (2 * Math.PI) / 3) < 1e-5);
      }
    }
    assert.ok(coords.get('N33').y > coords.get('C40').y);
    assert.ok(coords.get('O25').y < coords.get('C40').y);
  });

  it('places the phenolic oxaza morphinan core with regular fused six-rings', () => {
    const graph = createLayoutGraph(parseSMILES('O[C@H]1CC[C@@]2(O)[C@H]3CC4=CC=C(O)C5=C4[C@@]2(CCN3CC2CCC2)[C@H]1O5'), { suppressH: true });
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'phenolic-oxaza-morphinan-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const regularSixRings = [
      ['C27', 'C18', 'C6', 'C5', 'C4', 'C2'],
      ['C10', 'C11', 'C17', 'C18', 'C6', 'C8'],
      ['C17', 'C16', 'C14', 'C13', 'C12', 'C11']
    ];
    const etherBridgeAngles = ringAngles(coords, ['O29', 'C27', 'C18', 'C17', 'C16']);

    assert.equal(coords.size, 18);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.ok(audit.maxBondLengthDeviation < graph.options.bondLength * 0.58);
    for (const ring of regularSixRings) {
      for (let index = 0; index < ring.length; index++) {
        const atomId = ring[index];
        const nextAtomId = ring[(index + 1) % ring.length];
        assert.ok(Math.abs(distance(coords.get(atomId), coords.get(nextAtomId)) - graph.options.bondLength) < 1e-5);
      }
      for (const angle of ringAngles(coords, ring)) {
        assert.ok(Math.abs(angle - 120) < 1e-5);
      }
    }
    const azaBridgeAngles = ringAngles(coords, ['C18', 'C19', 'C20', 'N21', 'C8', 'C6']);

    assert.ok(Math.min(...azaBridgeAngles) > 45);
    assert.ok(Math.max(...azaBridgeAngles) < 140);
    assert.ok(Math.min(...etherBridgeAngles) > 88);
    assert.ok(Math.max(...etherBridgeAngles) < 125);
    assert.ok(coords.get('N21').y > coords.get('C18').y);
    assert.ok(coords.get('O29').y < coords.get('C18').y);
  });

  it('places the pyridyl phenolic oxaza morphinan core with regular fused sidewalls', () => {
    const graph = createLayoutGraph(parseSMILES('Oc1ccc2C[C@H]3N(CC=C)CC[C@@]45[C@@H](Oc1c24)c6ncc(cc6C[C@@]35O)c7ccc(Cl)cc7'), { suppressH: true });
    const rootRingSystem = graph.ringSystems[0];
    const coords = placeTemplateCoords(graph, 'pyridyl-phenolic-oxaza-morphinan-core', rootRingSystem.atomIds, graph.options.bondLength);
    const audit = auditLayout(graph, coords, {
      bondLength: graph.options.bondLength,
      bondValidationClasses: assignBondValidationClass(graph, rootRingSystem.atomIds, 'bridged')
    });
    const regularSixRings = [
      ['C28', 'C15', 'C20', 'C5', 'C6', 'C7'],
      ['C19', 'C20', 'C5', 'C4', 'C3', 'C2'],
      ['C25', 'C26', 'C21', 'N22', 'C23', 'C24']
    ];
    const azaBridgeAngles = ringAngles(coords, ['C13', 'C14', 'C15', 'C28', 'C7', 'N9']);
    const pyridylBridgeAngles = ringAngles(coords, ['C21', 'C26', 'C27', 'C28', 'C15', 'C16']);
    const etherBridgeAngles = ringAngles(coords, ['C20', 'C19', 'O18', 'C16', 'C15']);
    const regularBondTolerance = graph.options.bondLength * 0.015;

    assert.equal(coords.size, 22);
    assert.equal(audit.severeOverlapCount, 0);
    assert.equal(audit.visibleHeavyBondCrossingCount, 0);
    assert.equal(audit.bondLengthFailureCount, 0);
    assert.ok(audit.maxBondLengthDeviation < graph.options.bondLength * 0.34);
    for (const ring of regularSixRings) {
      for (let index = 0; index < ring.length; index++) {
        const atomId = ring[index];
        const nextAtomId = ring[(index + 1) % ring.length];
        assert.ok(Math.abs(distance(coords.get(atomId), coords.get(nextAtomId)) - graph.options.bondLength) < regularBondTolerance);
      }
      for (const angle of ringAngles(coords, ring)) {
        assert.ok(Math.abs(angle - 120) < 1e-5);
      }
    }
    assert.ok(Math.min(...azaBridgeAngles) > 65);
    assert.ok(Math.max(...azaBridgeAngles) < 130);
    assert.ok(Math.min(...pyridylBridgeAngles) > 75);
    assert.ok(Math.max(...pyridylBridgeAngles) < 155);
    assert.ok(Math.min(...etherBridgeAngles) > 95);
    assert.ok(Math.max(...etherBridgeAngles) < 125);
    assert.ok(coords.get('N9').y > coords.get('C15').y);
    assert.ok(coords.get('O18').y < coords.get('C15').y);
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

    const noradamantaneGraph = createLayoutGraph(parseSMILES('C12CC3CC1CC(C2)C3'), { suppressH: true });
    const noradamantaneCoords = placeTemplateCoords(noradamantaneGraph, 'noradamantane-core', noradamantaneGraph.ringSystems[0].atomIds, noradamantaneGraph.options.bondLength);
    const bridgeAngles = ringAngles(noradamantaneCoords, ['C9', 'C7', 'C8', 'C1', 'C2', 'C3']);
    assert.equal(noradamantaneCoords.size, 9);
    assert.ok(Math.min(...bridgeAngles) > 75, `expected the noradamantane bridge lane to stay open, got ${bridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
    assert.ok(Math.max(...bridgeAngles) < 150, `expected the noradamantane bridge lane to avoid flattened corners, got ${bridgeAngles.map(angle => angle.toFixed(2)).join(', ')}`);
  });
});
