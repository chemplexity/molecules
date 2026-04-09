/** @module templates/library */

import { Molecule } from '../../core/index.js';
import { apothemForRegularPolygon, circumradiusForRegularPolygon, placeRegularPolygon } from '../geometry/polygon.js';
import { add, angleOf, centroid, fromAngle, normalize, scale, sub } from '../geometry/vec2.js';
import { getRingAtomIds } from '../topology/ring-analysis.js';

function addAtomSeries(molecule, prefix, count, element, properties = {}) {
  for (let index = 0; index < count; index++) {
    molecule.addAtom(`${prefix}${index}`, element, properties, { recompute: false });
  }
}

function addRingBonds(molecule, prefix, count, properties = {}) {
  for (let index = 0; index < count; index++) {
    molecule.addBond(`${prefix}${index}`, `${prefix}${index}`, `${prefix}${(index + 1) % count}`, properties, false);
  }
}

function createBenzeneTemplate() {
  const molecule = new Molecule('template-benzene');
  addAtomSeries(molecule, 'a', 6, 'C', { aromatic: true });
  addRingBonds(molecule, 'a', 6, { aromatic: true });
  return molecule;
}

function createCyclohexaneTemplate() {
  const molecule = new Molecule('template-cyclohexane');
  addAtomSeries(molecule, 'a', 6, 'C');
  addRingBonds(molecule, 'a', 6, {});
  return molecule;
}

function createNaphthaleneTemplate() {
  const molecule = new Molecule('template-naphthalene');
  addAtomSeries(molecule, 'a', 10, 'C', { aromatic: true });
  molecule.addBond('b0', 'a0', 'a1', { aromatic: true }, false);
  molecule.addBond('b1', 'a1', 'a2', { aromatic: true }, false);
  molecule.addBond('b2', 'a2', 'a3', { aromatic: true }, false);
  molecule.addBond('b3', 'a3', 'a4', { aromatic: true }, false);
  molecule.addBond('b4', 'a4', 'a5', { aromatic: true }, false);
  molecule.addBond('b5', 'a5', 'a0', { aromatic: true }, false);
  molecule.addBond('b6', 'a4', 'a6', { aromatic: true }, false);
  molecule.addBond('b7', 'a6', 'a7', { aromatic: true }, false);
  molecule.addBond('b8', 'a7', 'a8', { aromatic: true }, false);
  molecule.addBond('b9', 'a8', 'a9', { aromatic: true }, false);
  molecule.addBond('b10', 'a9', 'a5', { aromatic: true }, false);
  return molecule;
}

function createSpiroTemplate() {
  const molecule = new Molecule('template-spiro-5-5');
  addAtomSeries(molecule, 'a', 9, 'C');
  molecule.addBond('b0', 'a0', 'a1', {}, false);
  molecule.addBond('b1', 'a1', 'a2', {}, false);
  molecule.addBond('b2', 'a2', 'a3', {}, false);
  molecule.addBond('b3', 'a3', 'a4', {}, false);
  molecule.addBond('b4', 'a4', 'a0', {}, false);
  molecule.addBond('b5', 'a4', 'a5', {}, false);
  molecule.addBond('b6', 'a5', 'a6', {}, false);
  molecule.addBond('b7', 'a6', 'a7', {}, false);
  molecule.addBond('b8', 'a7', 'a8', {}, false);
  molecule.addBond('b9', 'a8', 'a4', {}, false);
  return molecule;
}

function createNorbornaneTemplate() {
  const molecule = new Molecule('template-norbornane');
  addAtomSeries(molecule, 'a', 7, 'C');
  molecule.addBond('b0', 'a0', 'a2', {}, false);
  molecule.addBond('b1', 'a2', 'a3', {}, false);
  molecule.addBond('b2', 'a3', 'a1', {}, false);
  molecule.addBond('b3', 'a0', 'a4', {}, false);
  molecule.addBond('b4', 'a4', 'a5', {}, false);
  molecule.addBond('b5', 'a5', 'a1', {}, false);
  molecule.addBond('b6', 'a0', 'a6', {}, false);
  molecule.addBond('b7', 'a6', 'a1', {}, false);
  return molecule;
}

function createBicyclo222Template() {
  const molecule = new Molecule('template-bicyclo-2-2-2');
  addAtomSeries(molecule, 'a', 8, 'C');
  molecule.addBond('b0', 'a0', 'a2', {}, false);
  molecule.addBond('b1', 'a2', 'a3', {}, false);
  molecule.addBond('b2', 'a3', 'a1', {}, false);
  molecule.addBond('b3', 'a0', 'a4', {}, false);
  molecule.addBond('b4', 'a4', 'a5', {}, false);
  molecule.addBond('b5', 'a5', 'a1', {}, false);
  molecule.addBond('b6', 'a0', 'a6', {}, false);
  molecule.addBond('b7', 'a6', 'a7', {}, false);
  molecule.addBond('b8', 'a7', 'a1', {}, false);
  return molecule;
}

function createAdamantaneTemplate() {
  const molecule = new Molecule('template-adamantane');
  addAtomSeries(molecule, 'a', 10, 'C');
  molecule.addBond('b0', 'a0', 'a1', {}, false);
  molecule.addBond('b1', 'a1', 'a2', {}, false);
  molecule.addBond('b2', 'a2', 'a3', {}, false);
  molecule.addBond('b3', 'a3', 'a0', {}, false);
  molecule.addBond('b4', 'a0', 'a4', {}, false);
  molecule.addBond('b5', 'a1', 'a5', {}, false);
  molecule.addBond('b6', 'a2', 'a6', {}, false);
  molecule.addBond('b7', 'a3', 'a7', {}, false);
  molecule.addBond('b8', 'a4', 'a8', {}, false);
  molecule.addBond('b9', 'a5', 'a8', {}, false);
  molecule.addBond('b10', 'a5', 'a9', {}, false);
  molecule.addBond('b11', 'a6', 'a9', {}, false);
  molecule.addBond('b12', 'a6', 'a8', {}, false);
  molecule.addBond('b13', 'a7', 'a9', {}, false);
  molecule.addBond('b14', 'a7', 'a4', {}, false);
  return molecule;
}

function freezeCoordEntries(entries) {
  return Object.freeze(entries.map(([atomId, position]) => Object.freeze([atomId, Object.freeze({ x: position.x, y: position.y })])));
}

function scaleCoordEntries(entries, bondLength) {
  const coords = new Map();
  for (const [atomId, position] of entries) {
    coords.set(atomId, {
      x: position.x * bondLength,
      y: position.y * bondLength
    });
  }
  return coords;
}

function placePolygonWithStep(atomIds, center, radius, startAngle, stepAngle) {
  const coords = new Map();
  for (let index = 0; index < atomIds.length; index++) {
    coords.set(atomIds[index], add(center, fromAngle(startAngle + (index * stepAngle), radius)));
  }
  return coords;
}

function centeredEntries(coords) {
  const center = centroid([...coords.values()]);
  return [...coords.entries()].map(([atomId, position]) => [atomId, { x: position.x - center.x, y: position.y - center.y }]);
}

function createBenzeneGeometry() {
  return freezeCoordEntries(centeredEntries(placeRegularPolygon(['a0', 'a1', 'a2', 'a3', 'a4', 'a5'], { x: 0, y: 0 }, 1, Math.PI / 2)));
}

function createCyclohexaneGeometry() {
  return freezeCoordEntries(centeredEntries(placeRegularPolygon(['a0', 'a1', 'a2', 'a3', 'a4', 'a5'], { x: 0, y: 0 }, 1, Math.PI / 2)));
}

function createNaphthaleneGeometry() {
  const radius = circumradiusForRegularPolygon(6, 1);
  const centerOffset = apothemForRegularPolygon(6, 1);
  const leftCenter = { x: -centerOffset, y: 0 };
  const rightCenter = { x: centerOffset, y: 0 };
  const coords = placeRegularPolygon(['a0', 'a1', 'a2', 'a3', 'a4', 'a5'], leftCenter, 1, Math.PI / 2);
  const rightCoords = placePolygonWithStep(['a4', 'a5', 'a9', 'a8', 'a7', 'a6'], rightCenter, radius, (7 * Math.PI) / 6, -Math.PI / 3);
  for (const [atomId, position] of rightCoords) {
    coords.set(atomId, position);
  }
  return freezeCoordEntries(centeredEntries(coords));
}

function createSpiroGeometry() {
  const coords = placeRegularPolygon(['a0', 'a1', 'a2', 'a3', 'a4'], { x: 0, y: 0 }, 1, Math.PI / 2);
  const sharedPosition = coords.get('a4');
  const rootCenter = centroid([...coords.values()]);
  let outward = normalize(sub(sharedPosition, rootCenter));
  if (Math.hypot(outward.x, outward.y) <= 1e-12) {
    outward = { x: 1, y: 0 };
  }
  const radius = circumradiusForRegularPolygon(5, 1);
  const secondCenter = add(sharedPosition, scale(outward, radius));
  const startAngle = angleOf(sub(sharedPosition, secondCenter));
  const secondCoords = placePolygonWithStep(['a4', 'a5', 'a6', 'a7', 'a8'], secondCenter, radius, startAngle, -(2 * Math.PI) / 5);
  for (const [atomId, position] of secondCoords) {
    coords.set(atomId, position);
  }
  return freezeCoordEntries(centeredEntries(coords));
}

function createNorbornaneGeometry() {
  return freezeCoordEntries([
    ['a0', { x: -1.1805, y: 0 }],
    ['a2', { x: -0.4789, y: -0.9624 }],
    ['a4', { x: -0.4789, y: 0.9624 }],
    ['a6', { x: 0, y: 0 }],
    ['a3', { x: 0.4789, y: -0.9624 }],
    ['a5', { x: 0.4789, y: 0.9624 }],
    ['a1', { x: 1.1805, y: 0 }]
  ]);
}

function createBicyclo222Geometry() {
  return freezeCoordEntries([
    ['a0', { x: -1.5, y: 0 }],
    ['a2', { x: -0.4862, y: -0.9407 }],
    ['a4', { x: -0.4862, y: 0.9407 }],
    ['a6', { x: -0.4833, y: 0 }],
    ['a3', { x: 0.4862, y: -0.9407 }],
    ['a5', { x: 0.4862, y: 0.9407 }],
    ['a7', { x: 0.4833, y: 0 }],
    ['a1', { x: 1.5, y: 0 }]
  ]);
}

function createAdamantaneGeometry() {
  return freezeCoordEntries([
    ['a0', { x: -1.0775, y: 0.4082 }],
    ['a1', { x: -0.2038, y: 1.3797 }],
    ['a3', { x: -0.2007, y: -0.2314 }],
    ['a4', { x: -0.7727, y: -0.4194 }],
    ['a2', { x: 0.7475, y: 0.559 }],
    ['a5', { x: -0.4026, y: 0.4029 }],
    ['a7', { x: -0.1444, y: -1.437 }],
    ['a8', { x: 0.3221, y: 0.1508 }],
    ['a6', { x: 1.1835, y: -0.2269 }],
    ['a9', { x: 0.5485, y: -0.5859 }]
  ]);
}

function geometrySpec(kind, normalizedCoords, validation) {
  return Object.freeze({
    kind,
    normalizedCoords,
    validation: Object.freeze({ ...validation })
  });
}

function createTemplate(id, family, priority, molecule, geometry) {
  const normalizedCoords = geometry?.normalizedCoords ?? null;
  return Object.freeze({
    id,
    family,
    priority,
    atomCount: molecule.atomCount,
    bondCount: molecule.bondCount,
    ringCount: getRingAtomIds(molecule).length,
    molecule,
    geometryKind: geometry?.kind ?? null,
    hasGeometry: Array.isArray(normalizedCoords),
    normalizedCoords,
    geometryValidation: geometry?.validation ?? null,
    createCoords: normalizedCoords ? bondLength => scaleCoordEntries(normalizedCoords, bondLength) : null
  });
}

const PLANAR_VALIDATION = Object.freeze({
  minBondLengthFactor: 0.98,
  maxBondLengthFactor: 1.02,
  maxMeanDeviation: 0.02,
  maxSevereOverlapCount: 0
});

const BRIDGED_VALIDATION = Object.freeze({
  minBondLengthFactor: 0.7,
  maxBondLengthFactor: 1.4,
  maxMeanDeviation: 0.35,
  maxSevereOverlapCount: 0
});

const TEMPLATE_LIBRARY = Object.freeze(
  [
    createTemplate(
      'adamantane',
      'bridged',
      70,
      createAdamantaneTemplate(),
      geometrySpec('normalized-xy', createAdamantaneGeometry(), BRIDGED_VALIDATION)
    ),
    createTemplate(
      'bicyclo-2-2-2',
      'bridged',
      60,
      createBicyclo222Template(),
      geometrySpec('normalized-xy', createBicyclo222Geometry(), BRIDGED_VALIDATION)
    ),
    createTemplate(
      'norbornane',
      'bridged',
      50,
      createNorbornaneTemplate(),
      geometrySpec('normalized-xy', createNorbornaneGeometry(), BRIDGED_VALIDATION)
    ),
    createTemplate(
      'naphthalene',
      'fused',
      40,
      createNaphthaleneTemplate(),
      geometrySpec('normalized-xy', createNaphthaleneGeometry(), PLANAR_VALIDATION)
    ),
    createTemplate(
      'benzene',
      'isolated-ring',
      30,
      createBenzeneTemplate(),
      geometrySpec('normalized-xy', createBenzeneGeometry(), PLANAR_VALIDATION)
    ),
    createTemplate(
      'cyclohexane',
      'isolated-ring',
      20,
      createCyclohexaneTemplate(),
      geometrySpec('normalized-xy', createCyclohexaneGeometry(), PLANAR_VALIDATION)
    ),
    createTemplate(
      'spiro-5-5',
      'spiro',
      10,
      createSpiroTemplate(),
      geometrySpec('normalized-xy', createSpiroGeometry(), PLANAR_VALIDATION)
    )
  ].sort((firstTemplate, secondTemplate) => {
    if (secondTemplate.priority !== firstTemplate.priority) {
      return secondTemplate.priority - firstTemplate.priority;
    }
    if (secondTemplate.atomCount !== firstTemplate.atomCount) {
      return secondTemplate.atomCount - firstTemplate.atomCount;
    }
    return String(firstTemplate.id).localeCompare(String(secondTemplate.id), 'en', { numeric: true });
  })
);

/**
 * Returns the internal scaffold-template library in deterministic order.
 * @returns {ReadonlyArray<object>} Template descriptors.
 */
export function listTemplates() {
  return TEMPLATE_LIBRARY;
}

/**
 * Returns a scaffold template by ID.
 * @param {string} templateId - Template identifier.
 * @returns {object|null} Template descriptor or `null`.
 */
export function getTemplateById(templateId) {
  return TEMPLATE_LIBRARY.find(template => template.id === templateId) ?? null;
}

/**
 * Returns scaled coordinate geometry for a template when available.
 * @param {string|object} templateOrId - Template ID or descriptor.
 * @param {number} bondLength - Target depiction bond length.
 * @returns {Map<string, {x: number, y: number}>|null} Scaled template coordinates or `null`.
 */
export function getTemplateCoords(templateOrId, bondLength) {
  const template = typeof templateOrId === 'string' ? getTemplateById(templateOrId) : templateOrId;
  if (!template || typeof template.createCoords !== 'function') {
    return null;
  }
  return template.createCoords(bondLength);
}
