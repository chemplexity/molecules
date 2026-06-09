import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getTemplateById, getTemplateCoords, listTemplates } from '../../../../src/layout/engine/templates/library.js';

describe('layout/engine/templates/library', () => {
  it('exposes a deterministic scaffold-template catalog', () => {
    const templateIds = listTemplates().map(template => template.id);
    assert.deepEqual(templateIds, [
      'adamantane',
      'noradamantane-core',
      'bicyclo-2-2-2',
      'hydroxy-diformyl-bicyclooctadiene-core',
      'alkenyl-phenyl-oxabicycloheptane-core',
      'caged-hydroxy-lactone-core',
      'oxabicyclo-2-2-2',
      'quinuclidine',
      'quinuclidinium-oxygen-exit',
      'quinuclidinium',
      'diazatricyclodecane-core',
      'triazaadamantane-core',
      'scopolamine-epoxide-core',
      'tropane',
      'cubane',
      'oxabicyclo-3-1-1',
      'bridged-lactone-core',
      'oxabicyclic-lactone-ammonium-core',
      'methoxy-ammonium-oxazabicyclic-lactam-core',
      'oxazabicyclic-lactam-core',
      'hydroxy-oxazabicyclic-lactam-core',
      'azabicyclo-ketone-oxadiazole-core',
      'hydroxy-keto-oxadiazole-bridged-core',
      'cyanoacyl-azabicyclo-core',
      'aminonitrile-acetal-bridged-core',
      'cyano-formyl-acetal-bridged-core',
      'aminonitrile-oxabicyclobutane-core',
      'alkynyl-dicyano-oxabicyclobutane-core',
      'alkyl-oxabicyclobutane-core',
      'ammonium-cyanomethyl-oxatricyclo-core',
      'amino-pyrimidine-cyclobutane-core',
      'methyl-azabicyclo-cyclobutanone-core',
      'methyl-imino-oxatricyclo-core',
      'n-methyl-lactam-diaza-tricyclo-core',
      'ammonium-cyclobutyl-pyrrolidine-core',
      'azabicyclo-pyrrolidine-core',
      'shared-edge-tricyclic-ether-core',
      'dioxatricyclodiene-ether-core',
      'n-methyl-amino-diaza-tricyclo-core',
      'aminomethyl-oxabicyclobutane-core',
      'cyclopropane-azabicyclic-enone-core',
      'cyclopropane-azacyclooctane-core',
      'hydroxy-aminopropyl-cyclobutane-decalin-core',
      'hydroxy-aminomethyl-bicyclo-ketone-core',
      'hydroxy-amino-oxabicyclic-acetal-core',
      'aryl-phosphite-spiro-core',
      'imino-oxazocine-lactam-core',
      'imino-dioxazocine-ketone-core',
      'alkylidene-oxime-bicyclohexane-core',
      'trigonal-carbon-bicyclo-2-1-1-hexane-core',
      'substituted-bicyclo-2-1-1-hexane-core',
      'azabicyclo-nitrile-core',
      'bridged-decalin-lactam-core',
      'bridged-oxadecalin-core',
      'hydroxy-acetal-oxadecalin-core',
      'formyl-aza-oxatricyclo-core',
      'methyl-aza-oxa-tricyclic-core',
      'ethyl-dioxatricyclo-oxetane-core',
      'hydroxy-azatricyclo-cyclohexene-core',
      'imino-oxa-azatricyclo-ketone-core',
      'cyclopropyl-lactam-pentacycle-core',
      'hydroxy-thiazole-cyclopropyl-pentacycle-core',
      'amino-hydroxy-dimethyl-fused-cage-core',
      'ammonium-benzocyclobutane-core',
      'dimethyl-diaza-fused-cyclopropane-cage-core',
      'sulfonyl-aza-cycloheptene-cyclopropane-core',
      'sulfonyl-aromatic-bridged-heterocycle-core',
      'oxa-azabicyclo-sulfonyl-core',
      'hydroxy-dimethyl-oxatricyclo-cage-core',
      'hydroxy-oxatricyclo-diol-core',
      'cyclobutane-oxadecalin-core',
      'dimethyl-oxatricyclo-cage-core',
      'bridged-diketone-tricyclo-core',
      'bridged-pyrrolizidine-dione-core',
      'acetal-amino-decalin-core',
      'amino-oxaza-tricyclo-core',
      'aza-oxa-cyclopropyl-oxetane-core',
      'amino-diaza-tricyclo-core',
      'imino-thiazole-oxaza-tricyclo-core',
      'amino-cyano-thiazole-oxatricyclo-core',
      'spiro-bridged-aza-cage',
      'spiro-bridged-oxetane',
      'sulfonyl-azatricyclo-cage',
      'sulfonyl-cyclopentenyl-azocane-core',
      'hydroxy-alkyl-bicyclohexene-core',
      'oxime-lactam-cyclopentenyl-core',
      'benzoxathiobicyclo-core',
      'cyclobutane-thiophene-core',
      'oxygen-bridged-bisindole-lactam-core',
      'indoline-aza-bridged-heptacycle-core',
      'aza-annulene-cyclohexadiene-core',
      'bridged-cyclopropyl-decalin-core',
      'oxaza-morphinan-core',
      'pyridyl-phenolic-oxaza-morphinan-core',
      'phenolic-oxaza-morphinan-core',
      'oripavine-core',
      'saturated-morphinan-core',
      'morphinan-core',
      'amino-acyl-aryl-norbornane-core',
      'quaternary-exit-norbornane-core',
      'norbornene',
      'norbornane',
      'quinoline',
      'isoquinoline',
      'indole',
      'benzimidazole',
      'benzimidazolium',
      'benzoxazole',
      'benzothiazole',
      'indazole',
      'benzotriazole',
      'purine',
      'quinazoline',
      'quinoxaline',
      'acridine',
      'calixarene-guanidine-core',
      'porphine',
      'trans-polyene-macrolide',
      'steroid-core-unsaturated',
      'steroid-core-saturated',
      'amino-bromo-diaza-ketone-pericondensed-core',
      'perylene',
      'pyrene',
      'fluorene',
      'indanone',
      'indane',
      'tetralin',
      'anthracene',
      'chromane',
      'isochromane',
      'phthalazine',
      'cinnoline',
      'naphthalene',
      'pyridine',
      'pyrimidine',
      'pyrazine',
      'pyridazine',
      'triazine-1-2-3',
      'triazine-1-2-4',
      'triazine-1-3-5',
      'benzene',
      'pyrrole',
      'furan',
      'thiophene',
      'imidazole',
      'pyrazole',
      'oxazole',
      'isoxazole',
      'thiazole',
      'tetrazole',
      'isothiazole',
      'triazole-1-2-3',
      'cyclohexane',
      'triazole-1-2-4',
      'spiro-5-5'
    ]);
  });

  it('stores family and graph sizes for each template', () => {
    const adamantane = getTemplateById('adamantane');
    assert.equal(adamantane.family, 'bridged');
    assert.equal(adamantane.atomCount, 10);
    assert.equal(adamantane.bondCount, 12);
    assert.equal(adamantane.ringCount, 3);

    const noradamantane = getTemplateById('noradamantane-core');
    assert.equal(noradamantane.family, 'bridged');
    assert.equal(noradamantane.atomCount, 9);
    assert.equal(noradamantane.bondCount, 11);
    assert.equal(noradamantane.ringCount, 3);

    const bicyclo222 = getTemplateById('bicyclo-2-2-2');
    assert.equal(bicyclo222.family, 'bridged');
    assert.equal(bicyclo222.atomCount, 8);
    assert.equal(bicyclo222.bondCount, 9);
    assert.equal(bicyclo222.ringCount, 2);

    const hydroxyDiformylBicyclooctadiene = getTemplateById('hydroxy-diformyl-bicyclooctadiene-core');
    assert.equal(hydroxyDiformylBicyclooctadiene.family, 'bridged');
    assert.equal(hydroxyDiformylBicyclooctadiene.atomCount, 8);
    assert.equal(hydroxyDiformylBicyclooctadiene.bondCount, 9);
    assert.equal(hydroxyDiformylBicyclooctadiene.ringCount, 2);
    assert.deepEqual(
      hydroxyDiformylBicyclooctadiene.matchContext?.exocyclicNeighbors?.map(neighbor => [neighbor.templateAtomId, neighbor.element]),
      [
        ['C4', 'C'],
        ['C5', 'O'],
        ['C8', 'C'],
        ['C14', 'C']
      ]
    );

    const alkenylPhenylOxabicycloheptane = getTemplateById('alkenyl-phenyl-oxabicycloheptane-core');
    assert.equal(alkenylPhenylOxabicycloheptane.family, 'bridged');
    assert.equal(alkenylPhenylOxabicycloheptane.atomCount, 7);
    assert.equal(alkenylPhenylOxabicycloheptane.bondCount, 8);
    assert.equal(alkenylPhenylOxabicycloheptane.ringCount, 2);
    assert.deepEqual(
      alkenylPhenylOxabicycloheptane.matchContext?.exocyclicNeighbors?.map(neighbor => [neighbor.templateAtomId, neighbor.element]),
      [
        ['C12', 'C'],
        ['C15', 'C'],
        ['C18', 'C']
      ]
    );

    const cagedHydroxyLactone = getTemplateById('caged-hydroxy-lactone-core');
    assert.equal(cagedHydroxyLactone.family, 'bridged');
    assert.equal(cagedHydroxyLactone.atomCount, 17);
    assert.equal(cagedHydroxyLactone.bondCount, 21);
    assert.equal(cagedHydroxyLactone.ringCount, 5);
    assert.deepEqual(
      cagedHydroxyLactone.matchContext?.exocyclicNeighbors?.map(neighbor => [neighbor.templateAtomId, neighbor.element, neighbor.bondOrder]),
      [
        ['C6', 'C', 2],
        ['C15', 'O', 1],
        ['C18', 'C', 1],
        ['C20', 'O', 2],
        ['C25', 'C', 1]
      ]
    );

    const oxabicyclo222 = getTemplateById('oxabicyclo-2-2-2');
    assert.equal(oxabicyclo222.family, 'bridged');
    assert.equal(oxabicyclo222.atomCount, 8);
    assert.equal(oxabicyclo222.bondCount, 9);
    assert.equal(oxabicyclo222.ringCount, 2);

    const quinuclidine = getTemplateById('quinuclidine');
    assert.equal(quinuclidine.family, 'bridged');
    assert.equal(quinuclidine.atomCount, 8);
    assert.equal(quinuclidine.bondCount, 9);
    assert.equal(quinuclidine.ringCount, 2);

    const quinuclidiniumOxygenExit = getTemplateById('quinuclidinium-oxygen-exit');
    assert.equal(quinuclidiniumOxygenExit.family, 'bridged');
    assert.equal(quinuclidiniumOxygenExit.atomCount, 8);
    assert.equal(quinuclidiniumOxygenExit.bondCount, 9);
    assert.equal(quinuclidiniumOxygenExit.ringCount, 2);
    assert.equal(quinuclidiniumOxygenExit.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C3');
    assert.equal(quinuclidiniumOxygenExit.matchContext?.exocyclicNeighbors?.[0]?.element, 'O');

    const quinuclidinium = getTemplateById('quinuclidinium');
    assert.equal(quinuclidinium.family, 'bridged');
    assert.equal(quinuclidinium.atomCount, 8);
    assert.equal(quinuclidinium.bondCount, 9);
    assert.equal(quinuclidinium.ringCount, 2);

    const diazatricyclodecane = getTemplateById('diazatricyclodecane-core');
    assert.equal(diazatricyclodecane.family, 'bridged');
    assert.equal(diazatricyclodecane.atomCount, 10);
    assert.equal(diazatricyclodecane.bondCount, 12);
    assert.equal(diazatricyclodecane.ringCount, 3);

    const triazaadamantane = getTemplateById('triazaadamantane-core');
    assert.equal(triazaadamantane.family, 'bridged');
    assert.equal(triazaadamantane.atomCount, 10);
    assert.equal(triazaadamantane.bondCount, 12);
    assert.equal(triazaadamantane.ringCount, 3);

    const tropane = getTemplateById('tropane');
    assert.equal(tropane.family, 'bridged');
    assert.equal(tropane.atomCount, 8);
    assert.equal(tropane.bondCount, 9);
    assert.equal(tropane.ringCount, 2);

    const cubane = getTemplateById('cubane');
    assert.equal(cubane.family, 'bridged');
    assert.equal(cubane.atomCount, 8);
    assert.equal(cubane.bondCount, 12);
    assert.equal(cubane.ringCount, 5);

    const oxabicyclo311 = getTemplateById('oxabicyclo-3-1-1');
    assert.equal(oxabicyclo311.family, 'bridged');
    assert.equal(oxabicyclo311.atomCount, 7);
    assert.equal(oxabicyclo311.bondCount, 8);
    assert.equal(oxabicyclo311.ringCount, 2);

    const bridgedLactone = getTemplateById('bridged-lactone-core');
    assert.equal(bridgedLactone.family, 'bridged');
    assert.equal(bridgedLactone.atomCount, 9);
    assert.equal(bridgedLactone.bondCount, 10);
    assert.equal(bridgedLactone.ringCount, 2);
    assert.equal(bridgedLactone.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C17');
    assert.equal(bridgedLactone.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 2);

    const oxabicyclicLactoneAmmonium = getTemplateById('oxabicyclic-lactone-ammonium-core');
    assert.equal(oxabicyclicLactoneAmmonium.family, 'bridged');
    assert.equal(oxabicyclicLactoneAmmonium.atomCount, 9);
    assert.equal(oxabicyclicLactoneAmmonium.bondCount, 10);
    assert.equal(oxabicyclicLactoneAmmonium.ringCount, 2);
    assert.equal(oxabicyclicLactoneAmmonium.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C7');
    assert.equal(oxabicyclicLactoneAmmonium.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 2);
    assert.equal(oxabicyclicLactoneAmmonium.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C12');
    assert.equal(oxabicyclicLactoneAmmonium.matchContext?.exocyclicNeighbors?.[1]?.element, 'N');

    const methoxyAmmoniumOxazabicyclicLactam = getTemplateById('methoxy-ammonium-oxazabicyclic-lactam-core');
    assert.equal(methoxyAmmoniumOxazabicyclicLactam.family, 'bridged');
    assert.equal(methoxyAmmoniumOxazabicyclicLactam.atomCount, 11);
    assert.equal(methoxyAmmoniumOxazabicyclicLactam.bondCount, 12);
    assert.equal(methoxyAmmoniumOxazabicyclicLactam.ringCount, 2);
    assert.deepEqual(
      methoxyAmmoniumOxazabicyclicLactam.matchContext?.exocyclicNeighbors?.map(neighbor => [neighbor.templateAtomId, neighbor.element, neighbor.bondOrder]),
      [
        ['C3', 'O', 1],
        ['C8', 'C', 1],
        ['N10', 'C', 1],
        ['C15', 'O', 2]
      ]
    );
    assert.deepEqual(
      methoxyAmmoniumOxazabicyclicLactam.matchContext?.mappedAtoms?.map(atom => [atom.templateAtomId, atom.element, atom.charge]),
      [['N10', 'N', 1]]
    );

    const oxazabicyclicLactam = getTemplateById('oxazabicyclic-lactam-core');
    assert.equal(oxazabicyclicLactam.family, 'bridged');
    assert.equal(oxazabicyclicLactam.atomCount, 8);
    assert.equal(oxazabicyclicLactam.bondCount, 9);
    assert.equal(oxazabicyclicLactam.ringCount, 2);
    assert.equal(oxazabicyclicLactam.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C11');
    assert.equal(oxazabicyclicLactam.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 2);
    assert.equal(oxazabicyclicLactam.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C2');
    assert.equal(oxazabicyclicLactam.matchContext?.exocyclicNeighbors?.[1]?.minCount, 2);

    const hydroxyOxazabicyclicLactam = getTemplateById('hydroxy-oxazabicyclic-lactam-core');
    assert.equal(hydroxyOxazabicyclicLactam.family, 'bridged');
    assert.equal(hydroxyOxazabicyclicLactam.atomCount, 7);
    assert.equal(hydroxyOxazabicyclicLactam.bondCount, 8);
    assert.equal(hydroxyOxazabicyclicLactam.ringCount, 2);
    assert.equal(hydroxyOxazabicyclicLactam.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C2');
    assert.equal(hydroxyOxazabicyclicLactam.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 1);
    assert.equal(hydroxyOxazabicyclicLactam.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C6');
    assert.equal(hydroxyOxazabicyclicLactam.matchContext?.exocyclicNeighbors?.[1]?.bondOrder, 2);

    const azabicycloKetoneOxadiazole = getTemplateById('azabicyclo-ketone-oxadiazole-core');
    assert.equal(azabicycloKetoneOxadiazole.family, 'bridged');
    assert.equal(azabicycloKetoneOxadiazole.atomCount, 6);
    assert.equal(azabicycloKetoneOxadiazole.bondCount, 7);
    assert.equal(azabicycloKetoneOxadiazole.ringCount, 2);
    assert.equal(azabicycloKetoneOxadiazole.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C2');
    assert.equal(azabicycloKetoneOxadiazole.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 2);
    assert.equal(azabicycloKetoneOxadiazole.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C8');
    assert.equal(azabicycloKetoneOxadiazole.matchContext?.exocyclicNeighbors?.[1]?.element, 'C');
    assert.equal(azabicycloKetoneOxadiazole.matchContext?.exocyclicNeighbors?.[1]?.neighborDegree, 3);

    const hydroxyKetoOxadiazole = getTemplateById('hydroxy-keto-oxadiazole-bridged-core');
    assert.equal(hydroxyKetoOxadiazole.family, 'bridged');
    assert.equal(hydroxyKetoOxadiazole.atomCount, 12);
    assert.equal(hydroxyKetoOxadiazole.bondCount, 14);
    assert.equal(hydroxyKetoOxadiazole.ringCount, 3);
    assert.equal(hydroxyKetoOxadiazole.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C5');
    assert.equal(hydroxyKetoOxadiazole.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 1);
    assert.equal(hydroxyKetoOxadiazole.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C16');
    assert.equal(hydroxyKetoOxadiazole.matchContext?.exocyclicNeighbors?.[1]?.bondOrder, 2);

    const cyanoacylAzabicyclo = getTemplateById('cyanoacyl-azabicyclo-core');
    assert.equal(cyanoacylAzabicyclo.family, 'bridged');
    assert.equal(cyanoacylAzabicyclo.atomCount, 6);
    assert.equal(cyanoacylAzabicyclo.bondCount, 7);
    assert.equal(cyanoacylAzabicyclo.ringCount, 2);
    assert.equal(cyanoacylAzabicyclo.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'N5');
    assert.equal(cyanoacylAzabicyclo.matchContext?.exocyclicNeighbors?.[0]?.element, 'C');
    assert.equal(cyanoacylAzabicyclo.matchContext?.exocyclicNeighbors?.[0]?.neighborDegree, 3);

    const aminonitrileAcetalBridged = getTemplateById('aminonitrile-acetal-bridged-core');
    assert.equal(aminonitrileAcetalBridged.family, 'bridged');
    assert.equal(aminonitrileAcetalBridged.atomCount, 13);
    assert.equal(aminonitrileAcetalBridged.bondCount, 15);
    assert.equal(aminonitrileAcetalBridged.ringCount, 3);
    assert.equal(aminonitrileAcetalBridged.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C7');
    assert.equal(aminonitrileAcetalBridged.matchContext?.exocyclicNeighbors?.[0]?.neighborDegree, 2);

    const cyanoFormylAcetalBridged = getTemplateById('cyano-formyl-acetal-bridged-core');
    assert.equal(cyanoFormylAcetalBridged.family, 'bridged');
    assert.equal(cyanoFormylAcetalBridged.atomCount, 12);
    assert.equal(cyanoFormylAcetalBridged.bondCount, 14);
    assert.equal(cyanoFormylAcetalBridged.ringCount, 3);
    assert.equal(cyanoFormylAcetalBridged.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C6');
    assert.equal(cyanoFormylAcetalBridged.matchContext?.exocyclicNeighbors?.[0]?.neighborDegree, 2);
    assert.equal(cyanoFormylAcetalBridged.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C9');
    assert.equal(cyanoFormylAcetalBridged.matchContext?.exocyclicNeighbors?.[1]?.neighborDegree, 3);

    const aminonitrileOxabicyclobutane = getTemplateById('aminonitrile-oxabicyclobutane-core');
    assert.equal(aminonitrileOxabicyclobutane.family, 'bridged');
    assert.equal(aminonitrileOxabicyclobutane.atomCount, 6);
    assert.equal(aminonitrileOxabicyclobutane.bondCount, 7);
    assert.equal(aminonitrileOxabicyclobutane.ringCount, 2);
    assert.equal(aminonitrileOxabicyclobutane.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C5');
    assert.equal(aminonitrileOxabicyclobutane.matchContext?.exocyclicNeighbors?.[0]?.minCount, 1);
    assert.equal(aminonitrileOxabicyclobutane.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C8');
    assert.equal(aminonitrileOxabicyclobutane.matchContext?.exocyclicNeighbors?.[1]?.maxCount, 1);

    const ammoniumCyanomethylOxatricyclo = getTemplateById('ammonium-cyanomethyl-oxatricyclo-core');
    assert.equal(ammoniumCyanomethylOxatricyclo.family, 'bridged');
    assert.equal(ammoniumCyanomethylOxatricyclo.atomCount, 8);
    assert.equal(ammoniumCyanomethylOxatricyclo.bondCount, 10);
    assert.equal(ammoniumCyanomethylOxatricyclo.ringCount, 3);
    assert.equal(ammoniumCyanomethylOxatricyclo.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C3');
    assert.equal(ammoniumCyanomethylOxatricyclo.matchContext?.exocyclicNeighbors?.[0]?.element, 'N');
    assert.equal(ammoniumCyanomethylOxatricyclo.matchContext?.exocyclicNeighbors?.[1]?.element, 'C');

    const aminoPyrimidineCyclobutane = getTemplateById('amino-pyrimidine-cyclobutane-core');
    assert.equal(aminoPyrimidineCyclobutane.family, 'bridged');
    assert.equal(aminoPyrimidineCyclobutane.atomCount, 9);
    assert.equal(aminoPyrimidineCyclobutane.bondCount, 11);
    assert.equal(aminoPyrimidineCyclobutane.ringCount, 3);
    assert.equal(aminoPyrimidineCyclobutane.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C7');
    assert.equal(aminoPyrimidineCyclobutane.matchContext?.exocyclicNeighbors?.[0]?.element, 'O');
    assert.equal(aminoPyrimidineCyclobutane.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C9');
    assert.equal(aminoPyrimidineCyclobutane.matchContext?.exocyclicNeighbors?.[1]?.element, 'N');

    const methylAzabicycloCyclobutanone = getTemplateById('methyl-azabicyclo-cyclobutanone-core');
    assert.equal(methylAzabicycloCyclobutanone.family, 'bridged');
    assert.equal(methylAzabicycloCyclobutanone.atomCount, 10);
    assert.equal(methylAzabicycloCyclobutanone.bondCount, 12);
    assert.equal(methylAzabicycloCyclobutanone.ringCount, 3);
    assert.equal(methylAzabicycloCyclobutanone.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C2');
    assert.equal(methylAzabicycloCyclobutanone.matchContext?.exocyclicNeighbors?.[0]?.element, 'C');
    assert.equal(methylAzabicycloCyclobutanone.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C12');
    assert.equal(methylAzabicycloCyclobutanone.matchContext?.exocyclicNeighbors?.[1]?.element, 'O');

    const methylIminoOxatricyclo = getTemplateById('methyl-imino-oxatricyclo-core');
    assert.equal(methylIminoOxatricyclo.family, 'bridged');
    assert.equal(methylIminoOxatricyclo.atomCount, 9);
    assert.equal(methylIminoOxatricyclo.bondCount, 11);
    assert.equal(methylIminoOxatricyclo.ringCount, 3);
    assert.equal(methylIminoOxatricyclo.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'N2');
    assert.equal(methylIminoOxatricyclo.matchContext?.exocyclicNeighbors?.[0]?.element, 'C');
    assert.equal(methylIminoOxatricyclo.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C10');
    assert.equal(methylIminoOxatricyclo.matchContext?.exocyclicNeighbors?.[1]?.element, 'N');
    assert.equal(methylIminoOxatricyclo.matchContext?.exocyclicNeighbors?.[1]?.bondOrder, 2);

    const ammoniumCyclobutylPyrrolidine = getTemplateById('ammonium-cyclobutyl-pyrrolidine-core');
    assert.equal(ammoniumCyclobutylPyrrolidine.family, 'bridged');
    assert.equal(ammoniumCyclobutylPyrrolidine.atomCount, 6);
    assert.equal(ammoniumCyclobutylPyrrolidine.bondCount, 7);
    assert.equal(ammoniumCyclobutylPyrrolidine.ringCount, 2);

    const azabicycloPyrrolidine = getTemplateById('azabicyclo-pyrrolidine-core');
    assert.equal(azabicycloPyrrolidine.family, 'bridged');
    assert.equal(azabicycloPyrrolidine.atomCount, 6);
    assert.equal(azabicycloPyrrolidine.bondCount, 7);
    assert.equal(azabicycloPyrrolidine.ringCount, 2);

    const sharedEdgeTricyclicEther = getTemplateById('shared-edge-tricyclic-ether-core');
    assert.equal(sharedEdgeTricyclicEther.family, 'bridged');
    assert.equal(sharedEdgeTricyclicEther.atomCount, 14);
    assert.equal(sharedEdgeTricyclicEther.bondCount, 16);
    assert.equal(sharedEdgeTricyclicEther.ringCount, 3);

    const nMethylAminoDiazaTricyclo = getTemplateById('n-methyl-amino-diaza-tricyclo-core');
    assert.equal(nMethylAminoDiazaTricyclo.family, 'bridged');
    assert.equal(nMethylAminoDiazaTricyclo.atomCount, 10);
    assert.equal(nMethylAminoDiazaTricyclo.bondCount, 12);
    assert.equal(nMethylAminoDiazaTricyclo.ringCount, 3);
    assert.equal(nMethylAminoDiazaTricyclo.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'N2');
    assert.equal(nMethylAminoDiazaTricyclo.matchContext?.exocyclicNeighbors?.[2]?.element, 'N');

    const trigonalCarbonBicyclo211Hexane = getTemplateById('trigonal-carbon-bicyclo-2-1-1-hexane-core');
    assert.equal(trigonalCarbonBicyclo211Hexane.family, 'bridged');
    assert.equal(trigonalCarbonBicyclo211Hexane.atomCount, 6);
    assert.equal(trigonalCarbonBicyclo211Hexane.bondCount, 7);
    assert.equal(trigonalCarbonBicyclo211Hexane.ringCount, 2);
    assert.equal(trigonalCarbonBicyclo211Hexane.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C1');
    assert.equal(trigonalCarbonBicyclo211Hexane.matchContext?.exocyclicNeighbors?.[0]?.neighborDegree, 3);

    const substitutedBicyclo211Hexane = getTemplateById('substituted-bicyclo-2-1-1-hexane-core');
    assert.equal(substitutedBicyclo211Hexane.family, 'bridged');
    assert.equal(substitutedBicyclo211Hexane.atomCount, 6);
    assert.equal(substitutedBicyclo211Hexane.bondCount, 7);
    assert.equal(substitutedBicyclo211Hexane.ringCount, 2);
    assert.equal(substitutedBicyclo211Hexane.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C1');
    assert.equal(substitutedBicyclo211Hexane.matchContext?.exocyclicNeighbors?.[0]?.element, 'C');

    const hydroxyAminopropylCyclobutaneDecalin = getTemplateById('hydroxy-aminopropyl-cyclobutane-decalin-core');
    assert.equal(hydroxyAminopropylCyclobutaneDecalin.family, 'bridged');
    assert.equal(hydroxyAminopropylCyclobutaneDecalin.atomCount, 11);
    assert.equal(hydroxyAminopropylCyclobutaneDecalin.bondCount, 13);
    assert.equal(hydroxyAminopropylCyclobutaneDecalin.ringCount, 3);
    assert.equal(hydroxyAminopropylCyclobutaneDecalin.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C2');
    assert.equal(hydroxyAminopropylCyclobutaneDecalin.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C7');
    assert.equal(hydroxyAminopropylCyclobutaneDecalin.matchContext?.exocyclicNeighbors?.[1]?.element, 'O');
    assert.equal(hydroxyAminopropylCyclobutaneDecalin.matchContext?.exocyclicNeighbors?.[2]?.templateAtomId, 'C12');

    const hydroxyAminomethylBicycloKetone = getTemplateById('hydroxy-aminomethyl-bicyclo-ketone-core');
    assert.equal(hydroxyAminomethylBicycloKetone.family, 'bridged');
    assert.equal(hydroxyAminomethylBicycloKetone.atomCount, 6);
    assert.equal(hydroxyAminomethylBicycloKetone.bondCount, 7);
    assert.equal(hydroxyAminomethylBicycloKetone.ringCount, 2);
    assert.equal(hydroxyAminomethylBicycloKetone.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C5');
    assert.equal(hydroxyAminomethylBicycloKetone.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C7');
    assert.equal(hydroxyAminomethylBicycloKetone.matchContext?.exocyclicNeighbors?.[1]?.bondOrder, 1);
    assert.equal(hydroxyAminomethylBicycloKetone.matchContext?.exocyclicNeighbors?.[2]?.templateAtomId, 'C10');
    assert.equal(hydroxyAminomethylBicycloKetone.matchContext?.exocyclicNeighbors?.[2]?.bondOrder, 2);

    const hydroxyAminoOxabicyclicAcetal = getTemplateById('hydroxy-amino-oxabicyclic-acetal-core');
    assert.equal(hydroxyAminoOxabicyclicAcetal.family, 'bridged');
    assert.equal(hydroxyAminoOxabicyclicAcetal.atomCount, 7);
    assert.equal(hydroxyAminoOxabicyclicAcetal.bondCount, 8);
    assert.equal(hydroxyAminoOxabicyclicAcetal.ringCount, 2);
    assert.equal(hydroxyAminoOxabicyclicAcetal.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C11');
    assert.equal(hydroxyAminoOxabicyclicAcetal.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C14');
    assert.equal(hydroxyAminoOxabicyclicAcetal.matchContext?.exocyclicNeighbors?.[1]?.element, 'N');
    assert.equal(hydroxyAminoOxabicyclicAcetal.matchContext?.exocyclicNeighbors?.[2]?.templateAtomId, 'C14');
    assert.equal(hydroxyAminoOxabicyclicAcetal.matchContext?.exocyclicNeighbors?.[2]?.element, 'C');

    const arylPhosphiteSpiro = getTemplateById('aryl-phosphite-spiro-core');
    assert.equal(arylPhosphiteSpiro.family, 'bridged');
    assert.equal(arylPhosphiteSpiro.atomCount, 30);
    assert.equal(arylPhosphiteSpiro.bondCount, 36);
    assert.equal(arylPhosphiteSpiro.ringCount, 7);
    assert.equal(arylPhosphiteSpiro.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'P3');
    assert.equal(arylPhosphiteSpiro.matchContext?.exocyclicNeighbors?.[0]?.element, 'O');

    const iminoOxazocineLactam = getTemplateById('imino-oxazocine-lactam-core');
    assert.equal(iminoOxazocineLactam.family, 'bridged');
    assert.equal(iminoOxazocineLactam.atomCount, 12);
    assert.equal(iminoOxazocineLactam.bondCount, 13);
    assert.equal(iminoOxazocineLactam.ringCount, 2);
    assert.equal(iminoOxazocineLactam.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C14');
    assert.equal(iminoOxazocineLactam.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 2);
    assert.equal(iminoOxazocineLactam.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C5');
    assert.equal(iminoOxazocineLactam.matchContext?.exocyclicNeighbors?.[2]?.templateAtomId, 'C2');

    const iminoDioxazocineKetone = getTemplateById('imino-dioxazocine-ketone-core');
    assert.equal(iminoDioxazocineKetone.family, 'bridged');
    assert.equal(iminoDioxazocineKetone.atomCount, 11);
    assert.equal(iminoDioxazocineKetone.bondCount, 12);
    assert.equal(iminoDioxazocineKetone.ringCount, 2);
    assert.equal(iminoDioxazocineKetone.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C14');
    assert.equal(iminoDioxazocineKetone.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 2);
    assert.equal(iminoDioxazocineKetone.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C16');
    assert.equal(iminoDioxazocineKetone.matchContext?.exocyclicNeighbors?.[2]?.templateAtomId, 'C8');

    const azabicycloNitrile = getTemplateById('azabicyclo-nitrile-core');
    assert.equal(azabicycloNitrile.family, 'bridged');
    assert.equal(azabicycloNitrile.atomCount, 6);
    assert.equal(azabicycloNitrile.bondCount, 7);
    assert.equal(azabicycloNitrile.ringCount, 2);
    assert.equal(azabicycloNitrile.matchContext?.mappedAtoms?.[0]?.templateAtomId, 'N2');
    assert.equal(azabicycloNitrile.matchContext?.mappedAtoms?.[0]?.charge, 1);
    assert.equal(azabicycloNitrile.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C8');
    assert.equal(azabicycloNitrile.matchContext?.exocyclicNeighbors?.[1]?.minCount, 2);

    const bridgedDecalinLactam = getTemplateById('bridged-decalin-lactam-core');
    assert.equal(bridgedDecalinLactam.family, 'bridged');
    assert.equal(bridgedDecalinLactam.atomCount, 10);
    assert.equal(bridgedDecalinLactam.bondCount, 11);
    assert.equal(bridgedDecalinLactam.ringCount, 2);
    assert.equal(bridgedDecalinLactam.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C12');
    assert.equal(bridgedDecalinLactam.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 2);

    const bridgedOxadecalin = getTemplateById('bridged-oxadecalin-core');
    assert.equal(bridgedOxadecalin.family, 'bridged');
    assert.equal(bridgedOxadecalin.atomCount, 10);
    assert.equal(bridgedOxadecalin.bondCount, 11);
    assert.equal(bridgedOxadecalin.ringCount, 2);
    assert.equal(bridgedOxadecalin.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C11');
    assert.equal(bridgedOxadecalin.matchContext?.exocyclicNeighbors?.[0]?.minCount, 2);
    assert.equal(bridgedOxadecalin.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C14');
    assert.equal(bridgedOxadecalin.matchContext?.exocyclicNeighbors?.[1]?.maxCount, 1);

    const formylAzaOxatricyclo = getTemplateById('formyl-aza-oxatricyclo-core');
    assert.equal(formylAzaOxatricyclo.family, 'bridged');
    assert.equal(formylAzaOxatricyclo.atomCount, 12);
    assert.equal(formylAzaOxatricyclo.bondCount, 14);
    assert.equal(formylAzaOxatricyclo.ringCount, 3);
    assert.equal(formylAzaOxatricyclo.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'N2');
    assert.equal(formylAzaOxatricyclo.matchContext?.exocyclicNeighbors?.[0]?.neighborDegree, 4);
    assert.equal(formylAzaOxatricyclo.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'N13');
    assert.equal(formylAzaOxatricyclo.matchContext?.exocyclicNeighbors?.[1]?.neighborDegree, 3);

    const hydroxyAzatricycloCyclohexene = getTemplateById('hydroxy-azatricyclo-cyclohexene-core');
    assert.equal(hydroxyAzatricycloCyclohexene.family, 'bridged');
    assert.equal(hydroxyAzatricycloCyclohexene.atomCount, 10);
    assert.equal(hydroxyAzatricycloCyclohexene.bondCount, 12);
    assert.equal(hydroxyAzatricycloCyclohexene.ringCount, 3);
    assert.equal(hydroxyAzatricycloCyclohexene.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C13');
    assert.equal(hydroxyAzatricycloCyclohexene.matchContext?.exocyclicNeighbors?.[0]?.element, 'O');

    const iminoOxaAzatricycloKetone = getTemplateById('imino-oxa-azatricyclo-ketone-core');
    assert.equal(iminoOxaAzatricycloKetone.family, 'bridged');
    assert.equal(iminoOxaAzatricycloKetone.atomCount, 14);
    assert.equal(iminoOxaAzatricycloKetone.bondCount, 15);
    assert.equal(iminoOxaAzatricycloKetone.ringCount, 2);
    assert.equal(iminoOxaAzatricycloKetone.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C15');
    assert.equal(iminoOxaAzatricycloKetone.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 2);

    const cyclopropylLactamPentacycle = getTemplateById('cyclopropyl-lactam-pentacycle-core');
    assert.equal(cyclopropylLactamPentacycle.family, 'bridged');
    assert.equal(cyclopropylLactamPentacycle.atomCount, 12);
    assert.equal(cyclopropylLactamPentacycle.bondCount, 16);
    assert.equal(cyclopropylLactamPentacycle.ringCount, 5);
    assert.equal(cyclopropylLactamPentacycle.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C11');
    assert.equal(cyclopropylLactamPentacycle.matchContext?.exocyclicNeighbors?.[1]?.bondOrder, 2);

    const hydroxyThiazoleCyclopropylPentacycle = getTemplateById('hydroxy-thiazole-cyclopropyl-pentacycle-core');
    assert.equal(hydroxyThiazoleCyclopropylPentacycle.family, 'fused');
    assert.equal(hydroxyThiazoleCyclopropylPentacycle.atomCount, 12);
    assert.equal(hydroxyThiazoleCyclopropylPentacycle.bondCount, 16);
    assert.equal(hydroxyThiazoleCyclopropylPentacycle.ringCount, 5);
    assert.equal(hydroxyThiazoleCyclopropylPentacycle.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C2');
    assert.equal(hydroxyThiazoleCyclopropylPentacycle.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C7');
    assert.equal(hydroxyThiazoleCyclopropylPentacycle.matchContext?.exocyclicNeighbors?.[2]?.templateAtomId, 'C14');

    const sulfonylAzaCyclohepteneCyclopropane = getTemplateById('sulfonyl-aza-cycloheptene-cyclopropane-core');
    assert.equal(sulfonylAzaCyclohepteneCyclopropane.family, 'fused');
    assert.equal(sulfonylAzaCyclohepteneCyclopropane.atomCount, 11);
    assert.equal(sulfonylAzaCyclohepteneCyclopropane.bondCount, 14);
    assert.equal(sulfonylAzaCyclohepteneCyclopropane.ringCount, 4);
    assert.equal(sulfonylAzaCyclohepteneCyclopropane.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C3');
    assert.equal(sulfonylAzaCyclohepteneCyclopropane.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'S12');
    assert.equal(sulfonylAzaCyclohepteneCyclopropane.matchContext?.exocyclicNeighbors?.[1]?.minCount, 2);
    assert.equal(sulfonylAzaCyclohepteneCyclopropane.matchContext?.exocyclicNeighbors?.[2]?.templateAtomId, 'C15');

    const ammoniumBenzocyclobutane = getTemplateById('ammonium-benzocyclobutane-core');
    assert.equal(ammoniumBenzocyclobutane.family, 'bridged');
    assert.equal(ammoniumBenzocyclobutane.atomCount, 10);
    assert.equal(ammoniumBenzocyclobutane.bondCount, 12);
    assert.equal(ammoniumBenzocyclobutane.ringCount, 3);
    assert.equal(ammoniumBenzocyclobutane.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C8');
    assert.equal(ammoniumBenzocyclobutane.matchContext?.exocyclicNeighbors?.[1]?.element, 'N');

    const hydroxyDimethylOxatricycloCage = getTemplateById('hydroxy-dimethyl-oxatricyclo-cage-core');
    assert.equal(hydroxyDimethylOxatricycloCage.family, 'bridged');
    assert.equal(hydroxyDimethylOxatricycloCage.atomCount, 10);
    assert.equal(hydroxyDimethylOxatricycloCage.bondCount, 12);
    assert.equal(hydroxyDimethylOxatricycloCage.ringCount, 3);
    assert.equal(hydroxyDimethylOxatricycloCage.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C2');
    assert.equal(hydroxyDimethylOxatricycloCage.matchContext?.exocyclicNeighbors?.[0]?.minCount, 2);
    assert.equal(hydroxyDimethylOxatricycloCage.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C12');
    assert.equal(hydroxyDimethylOxatricycloCage.matchContext?.exocyclicNeighbors?.[1]?.element, 'O');

    const methylAzaOxaTricyclic = getTemplateById('methyl-aza-oxa-tricyclic-core');
    assert.equal(methylAzaOxaTricyclic.family, 'bridged');
    assert.equal(methylAzaOxaTricyclic.atomCount, 14);
    assert.equal(methylAzaOxaTricyclic.bondCount, 16);
    assert.equal(methylAzaOxaTricyclic.ringCount, 3);
    assert.equal(methylAzaOxaTricyclic.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C2');
    assert.equal(methylAzaOxaTricyclic.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C7');
    assert.equal(methylAzaOxaTricyclic.matchContext?.exocyclicNeighbors?.[2]?.templateAtomId, 'C16');

    const ethylDioxatricycloOxetane = getTemplateById('ethyl-dioxatricyclo-oxetane-core');
    assert.equal(ethylDioxatricycloOxetane.family, 'bridged');
    assert.equal(ethylDioxatricycloOxetane.atomCount, 8);
    assert.equal(ethylDioxatricycloOxetane.bondCount, 10);
    assert.equal(ethylDioxatricycloOxetane.ringCount, 3);
    assert.equal(ethylDioxatricycloOxetane.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C3');
    assert.equal(ethylDioxatricycloOxetane.matchContext?.exocyclicNeighbors?.[0]?.element, 'C');

    const dimethylOxatricycloCage = getTemplateById('dimethyl-oxatricyclo-cage-core');
    assert.equal(dimethylOxatricycloCage.family, 'bridged');
    assert.equal(dimethylOxatricycloCage.atomCount, 9);
    assert.equal(dimethylOxatricycloCage.bondCount, 11);
    assert.equal(dimethylOxatricycloCage.ringCount, 3);
    assert.equal(dimethylOxatricycloCage.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C2');
    assert.equal(dimethylOxatricycloCage.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C8');

    const hydroxyOxatricycloDiol = getTemplateById('hydroxy-oxatricyclo-diol-core');
    assert.equal(hydroxyOxatricycloDiol.family, 'bridged');
    assert.equal(hydroxyOxatricycloDiol.atomCount, 9);
    assert.equal(hydroxyOxatricycloDiol.bondCount, 11);
    assert.equal(hydroxyOxatricycloDiol.ringCount, 3);
    assert.equal(hydroxyOxatricycloDiol.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C2');
    assert.equal(hydroxyOxatricycloDiol.matchContext?.exocyclicNeighbors?.[0]?.element, 'O');
    assert.equal(hydroxyOxatricycloDiol.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C5');
    assert.equal(hydroxyOxatricycloDiol.matchContext?.exocyclicNeighbors?.[1]?.element, 'O');

    const cyclobutaneOxadecalin = getTemplateById('cyclobutane-oxadecalin-core');
    assert.equal(cyclobutaneOxadecalin.family, 'bridged');
    assert.equal(cyclobutaneOxadecalin.atomCount, 14);
    assert.equal(cyclobutaneOxadecalin.bondCount, 16);
    assert.equal(cyclobutaneOxadecalin.ringCount, 3);

    const bridgedPyrrolizidineDione = getTemplateById('bridged-pyrrolizidine-dione-core');
    assert.equal(bridgedPyrrolizidineDione.family, 'bridged');
    assert.equal(bridgedPyrrolizidineDione.atomCount, 11);
    assert.equal(bridgedPyrrolizidineDione.bondCount, 13);
    assert.equal(bridgedPyrrolizidineDione.ringCount, 3);
    assert.equal(bridgedPyrrolizidineDione.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C24');
    assert.equal(bridgedPyrrolizidineDione.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 2);

    const bridgedDiketoneTricyclo = getTemplateById('bridged-diketone-tricyclo-core');
    assert.equal(bridgedDiketoneTricyclo.family, 'bridged');
    assert.equal(bridgedDiketoneTricyclo.atomCount, 9);
    assert.equal(bridgedDiketoneTricyclo.bondCount, 11);
    assert.equal(bridgedDiketoneTricyclo.ringCount, 3);
    assert.equal(bridgedDiketoneTricyclo.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C2');
    assert.equal(bridgedDiketoneTricyclo.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 2);
    assert.equal(bridgedDiketoneTricyclo.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C5');

    const acetalAminoDecalin = getTemplateById('acetal-amino-decalin-core');
    assert.equal(acetalAminoDecalin.family, 'bridged');
    assert.equal(acetalAminoDecalin.atomCount, 12);
    assert.equal(acetalAminoDecalin.bondCount, 14);
    assert.equal(acetalAminoDecalin.ringCount, 3);
    assert.equal(acetalAminoDecalin.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C6');
    assert.equal(acetalAminoDecalin.matchContext?.exocyclicNeighbors?.[0]?.neighborDegree, 4);
    assert.equal(acetalAminoDecalin.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C16');
    assert.equal(acetalAminoDecalin.matchContext?.exocyclicNeighbors?.[1]?.neighborDegree, 3);
    assert.equal(acetalAminoDecalin.matchContext?.exocyclicNeighbors?.[2]?.templateAtomId, 'C19');
    assert.equal(acetalAminoDecalin.matchContext?.exocyclicNeighbors?.[2]?.neighborDegree, 3);

    const aminoOxazaTricyclo = getTemplateById('amino-oxaza-tricyclo-core');
    assert.equal(aminoOxazaTricyclo.family, 'bridged');
    assert.equal(aminoOxazaTricyclo.atomCount, 12);
    assert.equal(aminoOxazaTricyclo.bondCount, 15);
    assert.equal(aminoOxazaTricyclo.ringCount, 4);

    const azaOxaCyclopropylOxetane = getTemplateById('aza-oxa-cyclopropyl-oxetane-core');
    assert.equal(azaOxaCyclopropylOxetane.family, 'bridged');
    assert.equal(azaOxaCyclopropylOxetane.atomCount, 10);
    assert.equal(azaOxaCyclopropylOxetane.bondCount, 13);
    assert.equal(azaOxaCyclopropylOxetane.ringCount, 4);
    assert.equal(azaOxaCyclopropylOxetane.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C4');
    assert.equal(azaOxaCyclopropylOxetane.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C9');
    assert.equal(azaOxaCyclopropylOxetane.matchContext?.exocyclicNeighbors?.[1]?.element, 'O');

    const cyclopropaneAzabicyclicEnone = getTemplateById('cyclopropane-azabicyclic-enone-core');
    assert.equal(cyclopropaneAzabicyclicEnone.family, 'bridged');
    assert.equal(cyclopropaneAzabicyclicEnone.atomCount, 11);
    assert.equal(cyclopropaneAzabicyclicEnone.bondCount, 13);
    assert.equal(cyclopropaneAzabicyclicEnone.ringCount, 3);
    assert.equal(cyclopropaneAzabicyclicEnone.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C7');
    assert.equal(cyclopropaneAzabicyclicEnone.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 2);

    const cyclopropaneAzacyclooctane = getTemplateById('cyclopropane-azacyclooctane-core');
    assert.equal(cyclopropaneAzacyclooctane.family, 'bridged');
    assert.equal(cyclopropaneAzacyclooctane.atomCount, 12);
    assert.equal(cyclopropaneAzacyclooctane.bondCount, 14);
    assert.equal(cyclopropaneAzacyclooctane.ringCount, 3);
    assert.equal(cyclopropaneAzacyclooctane.matchContext?.mappedAtoms?.[0]?.templateAtomId, 'N12');
    assert.equal(cyclopropaneAzacyclooctane.matchContext?.mappedAtoms?.[0]?.charge, 1);
    assert.equal(cyclopropaneAzacyclooctane.matchContext?.exocyclicNeighbors?.[2]?.templateAtomId, 'C14');
    assert.equal(cyclopropaneAzacyclooctane.matchContext?.exocyclicNeighbors?.[2]?.minCount, 2);

    const aminoDiazaTricyclo = getTemplateById('amino-diaza-tricyclo-core');
    assert.equal(aminoDiazaTricyclo.family, 'bridged');
    assert.equal(aminoDiazaTricyclo.atomCount, 13);
    assert.equal(aminoDiazaTricyclo.bondCount, 15);
    assert.equal(aminoDiazaTricyclo.ringCount, 3);
    assert.equal(aminoDiazaTricyclo.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C9');
    assert.equal(aminoDiazaTricyclo.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 2);

    const iminoThiazoleOxazaTricyclo = getTemplateById('imino-thiazole-oxaza-tricyclo-core');
    assert.equal(iminoThiazoleOxazaTricyclo.family, 'bridged');
    assert.equal(iminoThiazoleOxazaTricyclo.atomCount, 13);
    assert.equal(iminoThiazoleOxazaTricyclo.bondCount, 16);
    assert.equal(iminoThiazoleOxazaTricyclo.ringCount, 4);
    assert.equal(iminoThiazoleOxazaTricyclo.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C2');
    assert.equal(iminoThiazoleOxazaTricyclo.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C6');
    assert.equal(iminoThiazoleOxazaTricyclo.matchContext?.exocyclicNeighbors?.[1]?.bondOrder, 2);

    const spiroBridgedAzaCage = getTemplateById('spiro-bridged-aza-cage');
    assert.equal(spiroBridgedAzaCage.family, 'bridged');
    assert.equal(spiroBridgedAzaCage.atomCount, 9);
    assert.equal(spiroBridgedAzaCage.bondCount, 11);
    assert.equal(spiroBridgedAzaCage.ringCount, 3);

    const spiroBridgedOxetane = getTemplateById('spiro-bridged-oxetane');
    assert.equal(spiroBridgedOxetane.family, 'bridged');
    assert.equal(spiroBridgedOxetane.atomCount, 9);
    assert.equal(spiroBridgedOxetane.bondCount, 11);
    assert.equal(spiroBridgedOxetane.ringCount, 3);

    const sulfonylAzatricyclo = getTemplateById('sulfonyl-azatricyclo-cage');
    assert.equal(sulfonylAzatricyclo.family, 'bridged');
    assert.equal(sulfonylAzatricyclo.atomCount, 7);
    assert.equal(sulfonylAzatricyclo.bondCount, 9);
    assert.equal(sulfonylAzatricyclo.ringCount, 3);

    const sulfonylCyclopentenylAzocane = getTemplateById('sulfonyl-cyclopentenyl-azocane-core');
    assert.equal(sulfonylCyclopentenylAzocane.family, 'bridged');
    assert.equal(sulfonylCyclopentenylAzocane.atomCount, 10);
    assert.equal(sulfonylCyclopentenylAzocane.bondCount, 11);
    assert.equal(sulfonylCyclopentenylAzocane.ringCount, 2);
    assert.equal(sulfonylCyclopentenylAzocane.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'S5');
    assert.equal(sulfonylCyclopentenylAzocane.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 2);

    const hydroxyAlkylBicyclohexene = getTemplateById('hydroxy-alkyl-bicyclohexene-core');
    assert.equal(hydroxyAlkylBicyclohexene.family, 'bridged');
    assert.equal(hydroxyAlkylBicyclohexene.atomCount, 6);
    assert.equal(hydroxyAlkylBicyclohexene.bondCount, 7);
    assert.equal(hydroxyAlkylBicyclohexene.ringCount, 2);
    assert.equal(hydroxyAlkylBicyclohexene.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C3');
    assert.equal(hydroxyAlkylBicyclohexene.matchContext?.exocyclicNeighbors?.[0]?.element, 'O');

    const oximeLactamCyclopentenyl = getTemplateById('oxime-lactam-cyclopentenyl-core');
    assert.equal(oximeLactamCyclopentenyl.family, 'bridged');
    assert.equal(oximeLactamCyclopentenyl.atomCount, 12);
    assert.equal(oximeLactamCyclopentenyl.bondCount, 14);
    assert.equal(oximeLactamCyclopentenyl.ringCount, 3);
    assert.equal(oximeLactamCyclopentenyl.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C7');
    assert.equal(oximeLactamCyclopentenyl.matchContext?.exocyclicNeighbors?.[0]?.element, 'N');
    assert.equal(oximeLactamCyclopentenyl.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C15');
    assert.equal(oximeLactamCyclopentenyl.matchContext?.exocyclicNeighbors?.[1]?.bondOrder, 2);

    const benzoxathiobicyclo = getTemplateById('benzoxathiobicyclo-core');
    assert.equal(benzoxathiobicyclo.family, 'bridged');
    assert.equal(benzoxathiobicyclo.atomCount, 13);
    assert.equal(benzoxathiobicyclo.bondCount, 15);
    assert.equal(benzoxathiobicyclo.ringCount, 3);

    const cyclobutaneThiophene = getTemplateById('cyclobutane-thiophene-core');
    assert.equal(cyclobutaneThiophene.family, 'bridged');
    assert.equal(cyclobutaneThiophene.atomCount, 9);
    assert.equal(cyclobutaneThiophene.bondCount, 11);
    assert.equal(cyclobutaneThiophene.ringCount, 3);

    const indolineAzaBridgedHeptacycle = getTemplateById('indoline-aza-bridged-heptacycle-core');
    assert.equal(indolineAzaBridgedHeptacycle.family, 'bridged');
    assert.equal(indolineAzaBridgedHeptacycle.atomCount, 19);
    assert.equal(indolineAzaBridgedHeptacycle.bondCount, 24);
    assert.equal(indolineAzaBridgedHeptacycle.ringCount, 7);

    const azaAnnuleneCyclohexadiene = getTemplateById('aza-annulene-cyclohexadiene-core');
    assert.equal(azaAnnuleneCyclohexadiene.family, 'bridged');
    assert.equal(azaAnnuleneCyclohexadiene.atomCount, 13);
    assert.equal(azaAnnuleneCyclohexadiene.bondCount, 14);
    assert.equal(azaAnnuleneCyclohexadiene.ringCount, 2);
    assert.equal(azaAnnuleneCyclohexadiene.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C3');
    assert.equal(azaAnnuleneCyclohexadiene.matchContext?.exocyclicNeighbors?.[1]?.templateAtomId, 'C5');
    assert.equal(azaAnnuleneCyclohexadiene.matchContext?.exocyclicNeighbors?.[1]?.element, 'N');

    const oxazaMorphinan = getTemplateById('oxaza-morphinan-core');
    assert.equal(oxazaMorphinan.family, 'bridged');
    assert.equal(oxazaMorphinan.atomCount, 18);
    assert.equal(oxazaMorphinan.bondCount, 22);
    assert.equal(oxazaMorphinan.ringCount, 5);

    const pyridylPhenolicOxazaMorphinan = getTemplateById('pyridyl-phenolic-oxaza-morphinan-core');
    assert.equal(pyridylPhenolicOxazaMorphinan.family, 'bridged');
    assert.equal(pyridylPhenolicOxazaMorphinan.atomCount, 22);
    assert.equal(pyridylPhenolicOxazaMorphinan.bondCount, 27);
    assert.equal(pyridylPhenolicOxazaMorphinan.ringCount, 6);

    const phenolicOxazaMorphinan = getTemplateById('phenolic-oxaza-morphinan-core');
    assert.equal(phenolicOxazaMorphinan.family, 'bridged');
    assert.equal(phenolicOxazaMorphinan.atomCount, 18);
    assert.equal(phenolicOxazaMorphinan.bondCount, 22);
    assert.equal(phenolicOxazaMorphinan.ringCount, 5);

    const oripavine = getTemplateById('oripavine-core');
    assert.equal(oripavine.family, 'bridged');
    assert.equal(oripavine.atomCount, 20);
    assert.equal(oripavine.bondCount, 25);
    assert.equal(oripavine.ringCount, 6);

    const saturatedMorphinan = getTemplateById('saturated-morphinan-core');
    assert.equal(saturatedMorphinan.family, 'bridged');
    assert.equal(saturatedMorphinan.atomCount, 17);
    assert.equal(saturatedMorphinan.bondCount, 20);
    assert.equal(saturatedMorphinan.ringCount, 4);

    const morphinan = getTemplateById('morphinan-core');
    assert.equal(morphinan.family, 'bridged');
    assert.equal(morphinan.atomCount, 13);
    assert.equal(morphinan.bondCount, 15);
    assert.equal(morphinan.ringCount, 3);

    const aminoAcylArylNorbornane = getTemplateById('amino-acyl-aryl-norbornane-core');
    assert.equal(aminoAcylArylNorbornane.family, 'bridged');
    assert.equal(aminoAcylArylNorbornane.atomCount, 7);
    assert.equal(aminoAcylArylNorbornane.bondCount, 8);
    assert.equal(aminoAcylArylNorbornane.ringCount, 2);
    assert.equal(aminoAcylArylNorbornane.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C8');
    assert.equal(aminoAcylArylNorbornane.matchContext?.exocyclicNeighbors?.[0]?.element, 'N');
    assert.equal(aminoAcylArylNorbornane.matchContext?.exocyclicNeighbors?.[3]?.templateAtomId, 'C7');
    assert.equal(aminoAcylArylNorbornane.matchContext?.exocyclicNeighbors?.[3]?.minCount, 2);

    const quaternaryExitNorbornane = getTemplateById('quaternary-exit-norbornane-core');
    assert.equal(quaternaryExitNorbornane.family, 'bridged');
    assert.equal(quaternaryExitNorbornane.atomCount, 7);
    assert.equal(quaternaryExitNorbornane.bondCount, 8);
    assert.equal(quaternaryExitNorbornane.ringCount, 2);
    assert.equal(quaternaryExitNorbornane.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'a1');
    assert.equal(quaternaryExitNorbornane.matchContext?.exocyclicNeighbors?.[0]?.neighborDegree, 4);

    const norbornane = getTemplateById('norbornane');
    assert.equal(norbornane.family, 'bridged');
    assert.equal(norbornane.atomCount, 7);
    assert.equal(norbornane.bondCount, 8);
    assert.equal(norbornane.ringCount, 2);

    const norbornene = getTemplateById('norbornene');
    assert.equal(norbornene.family, 'bridged');
    assert.equal(norbornene.atomCount, 7);
    assert.equal(norbornene.bondCount, 8);
    assert.equal(norbornene.ringCount, 2);

    const benzene = getTemplateById('benzene');
    assert.equal(benzene.family, 'isolated-ring');
    assert.equal(benzene.atomCount, 6);
    assert.equal(benzene.bondCount, 6);
    assert.equal(benzene.ringCount, 1);

    const pyridine = getTemplateById('pyridine');
    assert.equal(pyridine.family, 'isolated-ring');
    assert.equal(pyridine.atomCount, 6);
    assert.equal(pyridine.bondCount, 6);
    assert.equal(pyridine.ringCount, 1);

    const triazine123 = getTemplateById('triazine-1-2-3');
    assert.equal(triazine123.family, 'isolated-ring');
    assert.equal(triazine123.atomCount, 6);
    assert.equal(triazine123.bondCount, 6);
    assert.equal(triazine123.ringCount, 1);

    const imidazole = getTemplateById('imidazole');
    assert.equal(imidazole.family, 'isolated-ring');
    assert.equal(imidazole.atomCount, 5);
    assert.equal(imidazole.bondCount, 5);
    assert.equal(imidazole.ringCount, 1);

    const thiazole = getTemplateById('thiazole');
    assert.equal(thiazole.family, 'isolated-ring');
    assert.equal(thiazole.atomCount, 5);
    assert.equal(thiazole.bondCount, 5);
    assert.equal(thiazole.ringCount, 1);

    const naphthalene = getTemplateById('naphthalene');
    assert.equal(naphthalene.family, 'fused');
    assert.equal(naphthalene.atomCount, 10);
    assert.equal(naphthalene.bondCount, 11);
    assert.equal(naphthalene.ringCount, 2);

    const quinoline = getTemplateById('quinoline');
    assert.equal(quinoline.family, 'fused');
    assert.equal(quinoline.atomCount, 10);
    assert.equal(quinoline.bondCount, 11);
    assert.equal(quinoline.ringCount, 2);

    const indole = getTemplateById('indole');
    assert.equal(indole.family, 'fused');
    assert.equal(indole.atomCount, 9);
    assert.equal(indole.bondCount, 10);
    assert.equal(indole.ringCount, 2);

    const benzimidazolium = getTemplateById('benzimidazolium');
    assert.equal(benzimidazolium.family, 'fused');
    assert.equal(benzimidazolium.atomCount, 9);
    assert.equal(benzimidazolium.bondCount, 10);
    assert.equal(benzimidazolium.ringCount, 2);
    assert.equal(benzimidazolium.matchContext?.mappedAtoms?.[0]?.templateAtomId, 'a7');
    assert.equal(benzimidazolium.matchContext?.mappedAtoms?.[0]?.charge, 1);

    const quinazoline = getTemplateById('quinazoline');
    assert.equal(quinazoline.family, 'fused');
    assert.equal(quinazoline.atomCount, 10);
    assert.equal(quinazoline.bondCount, 11);
    assert.equal(quinazoline.ringCount, 2);

    const indazole = getTemplateById('indazole');
    assert.equal(indazole.family, 'fused');
    assert.equal(indazole.atomCount, 9);
    assert.equal(indazole.bondCount, 10);
    assert.equal(indazole.ringCount, 2);

    const benzotriazole = getTemplateById('benzotriazole');
    assert.equal(benzotriazole.family, 'fused');
    assert.equal(benzotriazole.atomCount, 9);
    assert.equal(benzotriazole.bondCount, 10);
    assert.equal(benzotriazole.ringCount, 2);

    const purine = getTemplateById('purine');
    assert.equal(purine.family, 'fused');
    assert.equal(purine.atomCount, 9);
    assert.equal(purine.bondCount, 10);
    assert.equal(purine.ringCount, 2);

    const acridine = getTemplateById('acridine');
    assert.equal(acridine.family, 'fused');
    assert.equal(acridine.atomCount, 14);
    assert.equal(acridine.bondCount, 16);
    assert.equal(acridine.ringCount, 3);

    const calixareneGuanidineCore = getTemplateById('calixarene-guanidine-core');
    assert.equal(calixareneGuanidineCore.family, 'macrocycle');
    assert.equal(calixareneGuanidineCore.atomCount, 28);
    assert.equal(calixareneGuanidineCore.bondCount, 32);
    assert.equal(calixareneGuanidineCore.ringCount, 5);

    const porphine = getTemplateById('porphine');
    assert.equal(porphine.family, 'macrocycle');
    assert.equal(porphine.atomCount, 24);
    assert.equal(porphine.bondCount, 28);
    assert.equal(porphine.ringCount, 5);

    const transPolyeneMacrolide = getTemplateById('trans-polyene-macrolide');
    assert.equal(transPolyeneMacrolide.family, 'macrocycle');
    assert.equal(transPolyeneMacrolide.atomCount, 28);
    assert.equal(transPolyeneMacrolide.bondCount, 30);
    assert.equal(transPolyeneMacrolide.ringCount, 3);
    assert.equal(transPolyeneMacrolide.matchContext?.mappedBonds?.[0]?.templateAtomIds?.[0], 'C28');
    assert.equal(transPolyeneMacrolide.matchContext?.mappedBonds?.[0]?.ez, 'E');
    assert.equal(transPolyeneMacrolide.matchContext?.mappedBonds?.[2]?.templateAtomIds?.[1], 'C38');

    const anthracene = getTemplateById('anthracene');
    assert.equal(anthracene.family, 'fused');
    assert.equal(anthracene.atomCount, 14);
    assert.equal(anthracene.bondCount, 16);
    assert.equal(anthracene.ringCount, 3);

    const pyrene = getTemplateById('pyrene');
    assert.equal(pyrene.family, 'fused');
    assert.equal(pyrene.atomCount, 16);
    assert.equal(pyrene.bondCount, 19);
    assert.equal(pyrene.ringCount, 4);

    const perylene = getTemplateById('perylene');
    assert.equal(perylene.family, 'fused');
    assert.equal(perylene.atomCount, 20);
    assert.equal(perylene.bondCount, 24);
    assert.equal(perylene.ringCount, 5);

    const aminoBromoDiazaKetone = getTemplateById('amino-bromo-diaza-ketone-pericondensed-core');
    assert.equal(aminoBromoDiazaKetone.family, 'fused');
    assert.equal(aminoBromoDiazaKetone.atomCount, 21);
    assert.equal(aminoBromoDiazaKetone.bondCount, 25);
    assert.equal(aminoBromoDiazaKetone.ringCount, 5);
    assert.equal(aminoBromoDiazaKetone.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'C8');
    assert.equal(aminoBromoDiazaKetone.matchContext?.exocyclicNeighbors?.[0]?.bondOrder, 2);
    assert.equal(aminoBromoDiazaKetone.matchContext?.exocyclicNeighbors?.[2]?.element, 'Br');

    const fluorene = getTemplateById('fluorene');
    assert.equal(fluorene.family, 'fused');
    assert.equal(fluorene.atomCount, 13);
    assert.equal(fluorene.bondCount, 15);
    assert.equal(fluorene.ringCount, 3);

    const indanone = getTemplateById('indanone');
    assert.equal(indanone.family, 'fused');
    assert.equal(indanone.atomCount, 9);
    assert.equal(indanone.bondCount, 10);
    assert.equal(indanone.ringCount, 2);
    assert.equal(indanone.matchContext?.exocyclicNeighbors?.[0]?.templateAtomId, 'a0');

    const steroidUnsaturated = getTemplateById('steroid-core-unsaturated');
    assert.equal(steroidUnsaturated.family, 'fused');
    assert.equal(steroidUnsaturated.atomCount, 17);
    assert.equal(steroidUnsaturated.bondCount, 20);
    assert.equal(steroidUnsaturated.ringCount, 4);

    const steroidSaturated = getTemplateById('steroid-core-saturated');
    assert.equal(steroidSaturated.family, 'fused');
    assert.equal(steroidSaturated.atomCount, 17);
    assert.equal(steroidSaturated.bondCount, 20);
    assert.equal(steroidSaturated.ringCount, 4);

    const indane = getTemplateById('indane');
    assert.equal(indane.family, 'fused');
    assert.equal(indane.atomCount, 9);
    assert.equal(indane.bondCount, 10);
    assert.equal(indane.ringCount, 2);

    const tetralin = getTemplateById('tetralin');
    assert.equal(tetralin.family, 'fused');
    assert.equal(tetralin.atomCount, 10);
    assert.equal(tetralin.bondCount, 11);
    assert.equal(tetralin.ringCount, 2);

    const chromane = getTemplateById('chromane');
    assert.equal(chromane.family, 'fused');
    assert.equal(chromane.atomCount, 10);
    assert.equal(chromane.bondCount, 11);
    assert.equal(chromane.ringCount, 2);

    const isochromane = getTemplateById('isochromane');
    assert.equal(isochromane.family, 'fused');
    assert.equal(isochromane.atomCount, 10);
    assert.equal(isochromane.bondCount, 11);
    assert.equal(isochromane.ringCount, 2);

    const cinnoline = getTemplateById('cinnoline');
    assert.equal(cinnoline.family, 'fused');
    assert.equal(cinnoline.atomCount, 10);
    assert.equal(cinnoline.bondCount, 11);
    assert.equal(cinnoline.ringCount, 2);
  });

  it('stores normalized xy geometry for each active template', () => {
    for (const template of listTemplates()) {
      assert.equal(template.geometryKind, 'normalized-xy');
      assert.equal(template.hasGeometry, true, `${template.id} should expose geometry-backed placement data`);
      assert.equal(Array.isArray(template.normalizedCoords), true);
      assert.equal(template.normalizedCoords.length, template.atomCount);
      assert.equal(typeof template.createCoords, 'function');
    }
  });

  it('scales template coordinates from the embedded normalized geometry', () => {
    const coords = getTemplateCoords('benzene', 2);
    assert.equal(coords.size, 6);
    const first = coords.get('a0');
    const second = coords.get('a1');
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    assert.ok(Math.abs(distance - 2) < 1e-6);
  });
});
