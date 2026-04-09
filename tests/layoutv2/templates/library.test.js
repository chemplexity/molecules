import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getTemplateById, getTemplateCoords, listTemplates } from '../../../src/layoutv2/templates/library.js';

describe('layoutv2/templates/library', () => {
  it('exposes a deterministic scaffold-template catalog', () => {
    const templateIds = listTemplates().map(template => template.id);
    assert.deepEqual(templateIds, ['adamantane', 'bicyclo-2-2-2', 'norbornane', 'naphthalene', 'benzene', 'cyclohexane', 'spiro-5-5']);
  });

  it('stores family and graph sizes for each template', () => {
    const adamantane = getTemplateById('adamantane');
    assert.equal(adamantane.family, 'bridged');
    assert.equal(adamantane.atomCount, 10);
    assert.equal(adamantane.bondCount, 15);
    assert.equal(adamantane.ringCount, 6);

    const bicyclo222 = getTemplateById('bicyclo-2-2-2');
    assert.equal(bicyclo222.family, 'bridged');
    assert.equal(bicyclo222.atomCount, 8);
    assert.equal(bicyclo222.bondCount, 9);
    assert.equal(bicyclo222.ringCount, 2);

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

    const naphthalene = getTemplateById('naphthalene');
    assert.equal(naphthalene.family, 'fused');
    assert.equal(naphthalene.atomCount, 10);
    assert.equal(naphthalene.bondCount, 11);
    assert.equal(naphthalene.ringCount, 2);
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
