import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getTemplateById, getTemplateCoords, listTemplates } from '../../../../src/layout/engine/templates/library.js';

describe('layout/engine/templates/library', () => {
  it('exposes a deterministic scaffold-template catalog', () => {
    const templateIds = listTemplates().map(template => template.id);
    assert.deepEqual(templateIds, [
      'adamantane',
      'bicyclo-2-2-2',
      'oxabicyclo-2-2-2',
      'quinuclidine',
      'tropane',
      'cubane',
      'oxabicyclo-3-1-1',
      'spiro-bridged-oxetane',
      'benzoxathiobicyclo-core',
      'morphinan-core',
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
      'porphine',
      'steroid-core-unsaturated',
      'steroid-core-saturated',
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

    const bicyclo222 = getTemplateById('bicyclo-2-2-2');
    assert.equal(bicyclo222.family, 'bridged');
    assert.equal(bicyclo222.atomCount, 8);
    assert.equal(bicyclo222.bondCount, 9);
    assert.equal(bicyclo222.ringCount, 2);

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

    const spiroBridgedOxetane = getTemplateById('spiro-bridged-oxetane');
    assert.equal(spiroBridgedOxetane.family, 'bridged');
    assert.equal(spiroBridgedOxetane.atomCount, 9);
    assert.equal(spiroBridgedOxetane.bondCount, 11);
    assert.equal(spiroBridgedOxetane.ringCount, 3);

    const benzoxathiobicyclo = getTemplateById('benzoxathiobicyclo-core');
    assert.equal(benzoxathiobicyclo.family, 'bridged');
    assert.equal(benzoxathiobicyclo.atomCount, 13);
    assert.equal(benzoxathiobicyclo.bondCount, 15);
    assert.equal(benzoxathiobicyclo.ringCount, 3);

    const morphinan = getTemplateById('morphinan-core');
    assert.equal(morphinan.family, 'bridged');
    assert.equal(morphinan.atomCount, 13);
    assert.equal(morphinan.bondCount, 15);
    assert.equal(morphinan.ringCount, 3);

    const norbornane = getTemplateById('norbornane');
    assert.equal(norbornane.family, 'bridged');
    assert.equal(norbornane.atomCount, 7);
    assert.equal(norbornane.bondCount, 8);
    assert.equal(norbornane.ringCount, 2);

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

    const porphine = getTemplateById('porphine');
    assert.equal(porphine.family, 'macrocycle');
    assert.equal(porphine.atomCount, 24);
    assert.equal(porphine.bondCount, 28);
    assert.equal(porphine.ringCount, 5);

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
