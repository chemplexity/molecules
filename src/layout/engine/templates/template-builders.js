/** @module templates/template-builders */

import { Molecule } from '../../../core/index.js';
import { parseSMILES } from '../../../io/smiles.js';
import { apothemForRegularPolygon, circumradiusForRegularPolygon, placeRegularPolygon } from '../geometry/polygon.js';
import { add, angleOf, centroid, fromAngle, normalize, scale, sub } from '../geometry/vec2.js';
import { BRIDGED_VALIDATION, TEMPLATE_PLANAR_VALIDATION } from '../constants.js';
import { createLayoutGraph } from '../model/layout-graph.js';
import { getRingAtomIds } from '../topology/ring-analysis.js';

/** Template-specific validation for the strongly foreshortened oxabicyclo cage projection. */
const OXABICYCLO311_VALIDATION = Object.freeze({
  ...BRIDGED_VALIDATION,
  maxMeanDeviation: 0.38
});

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

/**
 * Creates a heavy-atom scaffold template by parsing SMILES and discarding hydrogens.
 * @param {string} templateId - Template identifier suffix.
 * @param {string} smiles - Heavy-atom scaffold SMILES.
 * @returns {Molecule} Heavy-atom template molecule.
 */
function createHeavyTemplateFromSmiles(templateId, smiles) {
  const molecule = parseSMILES(smiles);
  const heavyAtomIds = [...molecule.atoms.values()].filter(atom => atom.name !== 'H').map(atom => atom.id);
  const heavySubgraph = molecule.getSubgraph(heavyAtomIds);
  heavySubgraph.id = `template-${templateId}`;
  return heavySubgraph;
}

/**
 * Creates a scaffold template from one fused ring system extracted from SMILES.
 * @param {string} templateId - Template identifier suffix.
 * @param {string} smiles - Source SMILES containing the target ring system.
 * @param {number} [ringSystemIndex] - Ring-system index to extract.
 * @returns {Molecule} Ring-system template molecule.
 */
function createRingSystemTemplateFromSmiles(templateId, smiles, ringSystemIndex = 0) {
  const molecule = parseSMILES(smiles);
  const layoutGraph = createLayoutGraph(molecule);
  const ringSystem = layoutGraph.ringSystems[ringSystemIndex] ?? null;
  if (!ringSystem) {
    throw new Error(`Template '${templateId}' could not resolve ring system ${ringSystemIndex}.`);
  }
  const ringSubgraph = molecule.getSubgraph(ringSystem.atomIds);
  ringSubgraph.id = `template-${templateId}`;
  return ringSubgraph;
}

/**
 * Creates a simple aromatic cycle template from an ordered ring atom list.
 * @param {string} templateId - Template identifier suffix.
 * @param {string[]} atomElements - Ordered aromatic ring atom symbols.
 * @returns {Molecule} Aromatic cycle template molecule.
 */
function createAromaticCycleTemplate(templateId, atomElements) {
  const molecule = new Molecule(`template-${templateId}`);
  for (let index = 0; index < atomElements.length; index++) {
    molecule.addAtom(`a${index}`, atomElements[index], { aromatic: true }, { recompute: false });
  }
  addRingBonds(molecule, 'a', atomElements.length, { aromatic: true });
  return molecule;
}

/**
 * Creates a fused aromatic bicyclic template from an ordered outer-perimeter atom list.
 * Consecutive perimeter atoms are bonded, the perimeter is closed, and one
 * additional aromatic shared bond is added to split the perimeter into two
 * fused rings.
 * @param {string} templateId - Template identifier suffix.
 * @param {string[]} atomElements - Ordered outer-perimeter atom symbols.
 * @param {number} firstSharedIndex - First shared-bond atom index in perimeter order.
 * @param {number} secondSharedIndex - Second shared-bond atom index in perimeter order.
 * @returns {Molecule} Fused aromatic bicyclic template molecule.
 */
function createFusedAromaticPerimeterTemplate(templateId, atomElements, firstSharedIndex, secondSharedIndex) {
  return createFusedPerimeterTemplate(
    templateId,
    atomElements.map(element => ({ element, properties: { aromatic: true } })),
    atomElements.map(() => ({ aromatic: true })),
    firstSharedIndex,
    secondSharedIndex,
    { aromatic: true }
  );
}

/**
 * Creates a perimeter template with one or more additional shared bonds.
 * @param {string} templateId - Template identifier suffix.
 * @param {ReadonlyArray<{element: string, properties?: object}>} atomSpecs - Ordered outer-perimeter atom specs.
 * @param {ReadonlyArray<object>} perimeterBondProperties - Bond properties for each consecutive perimeter edge.
 * @param {ReadonlyArray<{firstIndex: number, secondIndex: number, properties?: object}>} sharedBondSpecs - Extra shared bonds.
 * @returns {Molecule} Polycyclic perimeter template molecule.
 */
function createPolycyclicPerimeterTemplate(templateId, atomSpecs, perimeterBondProperties, sharedBondSpecs) {
  const molecule = new Molecule(`template-${templateId}`);
  for (let index = 0; index < atomSpecs.length; index++) {
    const atomSpec = atomSpecs[index];
    molecule.addAtom(`a${index}`, atomSpec.element, { ...(atomSpec.properties ?? {}) }, { recompute: false });
  }
  for (let index = 0; index < atomSpecs.length; index++) {
    molecule.addBond(`b${index}`, `a${index}`, `a${(index + 1) % atomSpecs.length}`, { ...(perimeterBondProperties[index] ?? {}) }, false);
  }
  for (let index = 0; index < sharedBondSpecs.length; index++) {
    const sharedBondSpec = sharedBondSpecs[index];
    molecule.addBond(`b${atomSpecs.length + index}`, `a${sharedBondSpec.firstIndex}`, `a${sharedBondSpec.secondIndex}`, { ...(sharedBondSpec.properties ?? {}) }, false);
  }
  return molecule;
}

/**
 * Creates a fused bicyclic perimeter template from explicit atom and bond specs.
 * @param {string} templateId - Template identifier suffix.
 * @param {ReadonlyArray<{element: string, properties?: object}>} atomSpecs - Ordered outer-perimeter atom specs.
 * @param {ReadonlyArray<object>} perimeterBondProperties - Bond properties for each consecutive perimeter edge.
 * @param {number} firstSharedIndex - First shared-bond atom index in perimeter order.
 * @param {number} secondSharedIndex - Second shared-bond atom index in perimeter order.
 * @param {object} sharedBondProperties - Bond properties for the shared fused edge.
 * @returns {Molecule} Fused bicyclic template molecule.
 */
function createFusedPerimeterTemplate(templateId, atomSpecs, perimeterBondProperties, firstSharedIndex, secondSharedIndex, sharedBondProperties) {
  return createPolycyclicPerimeterTemplate(templateId, atomSpecs, perimeterBondProperties, [
    {
      firstIndex: firstSharedIndex,
      secondIndex: secondSharedIndex,
      properties: sharedBondProperties
    }
  ]);
}

/**
 * Creates normalized coordinates for a regular aromatic cycle template.
 * @param {string[]} atomIds - Ordered template atom IDs.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createRegularAromaticCycleGeometry(atomIds) {
  return freezeCoordEntries(centeredEntries(placeRegularPolygon(atomIds, { x: 0, y: 0 }, 1, Math.PI / 2)));
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

function createPyridineTemplate() {
  return createAromaticCycleTemplate('pyridine', ['N', 'C', 'C', 'C', 'C', 'C']);
}

function createPyrimidineTemplate() {
  return createAromaticCycleTemplate('pyrimidine', ['N', 'C', 'N', 'C', 'C', 'C']);
}

function createPyrazineTemplate() {
  return createAromaticCycleTemplate('pyrazine', ['N', 'C', 'C', 'N', 'C', 'C']);
}

function createPyridazineTemplate() {
  return createAromaticCycleTemplate('pyridazine', ['N', 'N', 'C', 'C', 'C', 'C']);
}

function createTriazine123Template() {
  return createAromaticCycleTemplate('triazine-1-2-3', ['N', 'N', 'N', 'C', 'C', 'C']);
}

function createTriazine124Template() {
  return createAromaticCycleTemplate('triazine-1-2-4', ['N', 'N', 'C', 'N', 'C', 'C']);
}

function createTriazine135Template() {
  return createAromaticCycleTemplate('triazine-1-3-5', ['N', 'C', 'N', 'C', 'N', 'C']);
}

function createPyrroleTemplate() {
  return createAromaticCycleTemplate('pyrrole', ['N', 'C', 'C', 'C', 'C']);
}

function createFuranTemplate() {
  return createAromaticCycleTemplate('furan', ['O', 'C', 'C', 'C', 'C']);
}

function createThiopheneTemplate() {
  return createAromaticCycleTemplate('thiophene', ['S', 'C', 'C', 'C', 'C']);
}

function createImidazoleTemplate() {
  return createAromaticCycleTemplate('imidazole', ['N', 'C', 'N', 'C', 'C']);
}

function createPyrazoleTemplate() {
  return createAromaticCycleTemplate('pyrazole', ['N', 'N', 'C', 'C', 'C']);
}

function createOxazoleTemplate() {
  return createAromaticCycleTemplate('oxazole', ['O', 'C', 'N', 'C', 'C']);
}

function createIsoxazoleTemplate() {
  return createAromaticCycleTemplate('isoxazole', ['O', 'N', 'C', 'C', 'C']);
}

function createThiazoleTemplate() {
  return createAromaticCycleTemplate('thiazole', ['S', 'C', 'N', 'C', 'C']);
}

function createIsothiazoleTemplate() {
  return createAromaticCycleTemplate('isothiazole', ['S', 'N', 'C', 'C', 'C']);
}

function createTriazole123Template() {
  return createAromaticCycleTemplate('triazole-1-2-3', ['N', 'N', 'N', 'C', 'C']);
}

function createTriazole124Template() {
  return createAromaticCycleTemplate('triazole-1-2-4', ['N', 'N', 'C', 'N', 'C']);
}

function createTetrazoleTemplate() {
  return createAromaticCycleTemplate('tetrazole', ['N', 'N', 'N', 'N', 'C']);
}

function createQuinolineTemplate() {
  return createFusedAromaticPerimeterTemplate('quinoline', ['C', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'N', 'C'], 4, 9);
}

function createIsoquinolineTemplate() {
  return createFusedAromaticPerimeterTemplate('isoquinoline', ['C', 'C', 'C', 'C', 'C', 'C', 'C', 'N', 'C', 'C'], 4, 9);
}

function createIndoleTemplate() {
  return createFusedAromaticPerimeterTemplate('indole', ['N', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'C'], 1, 6);
}

function createBenzimidazoleTemplate() {
  return createFusedAromaticPerimeterTemplate('benzimidazole', ['N', 'C', 'C', 'C', 'C', 'C', 'C', 'N', 'C'], 1, 6);
}

/**
 * Creates the protonated benzimidazolium fused template with localized imidazolium bonds.
 * @returns {Molecule} Protonated benzimidazolium template molecule.
 */
function createBenzimidazoliumTemplate() {
  return createFusedPerimeterTemplate(
    'benzimidazolium',
    [
      { element: 'N' },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'N', properties: { charge: 1 } },
      { element: 'C' }
    ],
    [{ order: 1 }, { aromatic: true }, { aromatic: true }, { aromatic: true }, { aromatic: true }, { aromatic: true }, { order: 1 }, { order: 2 }, { order: 1 }],
    1,
    6,
    { aromatic: true }
  );
}

function createBenzoxazoleTemplate() {
  return createFusedAromaticPerimeterTemplate('benzoxazole', ['O', 'C', 'C', 'C', 'C', 'C', 'C', 'N', 'C'], 1, 6);
}

function createBenzothiazoleTemplate() {
  return createFusedAromaticPerimeterTemplate('benzothiazole', ['S', 'C', 'C', 'C', 'C', 'C', 'C', 'N', 'C'], 1, 6);
}

function createIndazoleTemplate() {
  return createFusedAromaticPerimeterTemplate('indazole', ['N', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'N'], 1, 6);
}

function createBenzotriazoleTemplate() {
  return createFusedAromaticPerimeterTemplate('benzotriazole', ['N', 'C', 'C', 'C', 'C', 'C', 'C', 'N', 'N'], 1, 6);
}

function createPurineTemplate() {
  return createFusedAromaticPerimeterTemplate('purine', ['N', 'C', 'N', 'C', 'N', 'C', 'C', 'N', 'C'], 1, 6);
}

/**
 * Creates an acridine tricyclic aromatic perimeter template.
 * @returns {Molecule} Acridine scaffold template molecule.
 */
function createAcridineTemplate() {
  return createPolycyclicPerimeterTemplate(
    'acridine',
    [
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'N', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } }
    ],
    Array.from({ length: 14 }, () => ({ aromatic: true })),
    [
      { firstIndex: 3, secondIndex: 12, properties: { aromatic: true } },
      { firstIndex: 5, secondIndex: 10, properties: { aromatic: true } }
    ]
  );
}

/**
 * Creates an anthracene tricyclic aromatic perimeter template.
 * @returns {Molecule} Anthracene scaffold template molecule.
 */
function createAnthraceneTemplate() {
  return createPolycyclicPerimeterTemplate(
    'anthracene',
    Array.from({ length: 14 }, () => ({ element: 'C', properties: { aromatic: true } })),
    Array.from({ length: 14 }, () => ({ aromatic: true })),
    [
      { firstIndex: 3, secondIndex: 12, properties: { aromatic: true } },
      { firstIndex: 5, secondIndex: 10, properties: { aromatic: true } }
    ]
  );
}

/**
 * Creates a pyrene fused aromatic template from its exact heavy-atom graph.
 * @returns {Molecule} Pyrene scaffold template molecule.
 */
function createPyreneTemplate() {
  return createHeavyTemplateFromSmiles('pyrene', 'c1cc2ccc3cccc4ccc(c1)c2c34');
}

/**
 * Creates a perylene fused aromatic template from its exact heavy-atom graph.
 * @returns {Molecule} Perylene scaffold template molecule.
 */
function createPeryleneTemplate() {
  return createHeavyTemplateFromSmiles('perylene', 'C1=CC=C2C(=C1)C=C1C=CC3=CC=CC4=CC=C2C1=C34');
}

/**
 * Creates a fluorene fused tricyclic template from its exact ring-system graph.
 * @returns {Molecule} Fluorene scaffold template molecule.
 */
function createFluoreneTemplate() {
  return createRingSystemTemplateFromSmiles('fluorene', 'c1ccc2c(c1)Cc1ccccc12');
}

/**
 * Creates a porphine macrocycle template for the porphyrin core.
 * @returns {Molecule} Porphine scaffold template molecule.
 */
function createPorphineTemplate() {
  return createRingSystemTemplateFromSmiles('porphine', 'C1=CC2=CC3=CC=C(N3)C=C4C=CC(=N4)C=C5C=CC(=N5)C=C1N2');
}

/**
 * Creates an unsaturated steroid nucleus template shared by testosterone-like cores.
 * @returns {Molecule} Unsaturated steroid scaffold template molecule.
 */
function createSteroidCoreUnsaturatedTemplate() {
  return createRingSystemTemplateFromSmiles('steroid-core-unsaturated', 'C[C@]12CC[C@H]3[C@@H](CC=C4C[C@@H](O)CC[C@]34C)[C@@H]1CC[C@@H]2=O');
}

/**
 * Creates a saturated steroid nucleus template for the saturated test scaffold.
 * @returns {Molecule} Saturated steroid scaffold template molecule.
 */
function createSteroidCoreSaturatedTemplate() {
  return createRingSystemTemplateFromSmiles('steroid-core-saturated', 'C[C@]12CC[C@H]3[C@@H](CC[C@@H]4CC(=O)CC[C@]34C)[C@@H]1CC[C@@H]2O');
}

function createIndaneTemplate() {
  return createFusedPerimeterTemplate(
    'indane',
    [
      { element: 'C' },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C' },
      { element: 'C' }
    ],
    [{}, { aromatic: true }, { aromatic: true }, { aromatic: true }, { aromatic: true }, { aromatic: true }, {}, {}, {}],
    1,
    6,
    { aromatic: true }
  );
}

function createTetralinTemplate() {
  return createFusedPerimeterTemplate(
    'tetralin',
    [
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C' },
      { element: 'C' },
      { element: 'C' },
      { element: 'C' },
      { element: 'C', properties: { aromatic: true } }
    ],
    [{ aromatic: true }, { aromatic: true }, { aromatic: true }, { aromatic: true }, {}, {}, {}, {}, {}, { aromatic: true }],
    4,
    9,
    { aromatic: true }
  );
}

function createChromaneTemplate() {
  return createFusedPerimeterTemplate(
    'chromane',
    [
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'O' },
      { element: 'C' },
      { element: 'C' },
      { element: 'C' },
      { element: 'C', properties: { aromatic: true } }
    ],
    [{ aromatic: true }, { aromatic: true }, { aromatic: true }, { aromatic: true }, {}, {}, {}, {}, {}, { aromatic: true }],
    4,
    9,
    { aromatic: true }
  );
}

function createIsochromaneTemplate() {
  return createFusedPerimeterTemplate(
    'isochromane',
    [
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C', properties: { aromatic: true } },
      { element: 'C' },
      { element: 'O' },
      { element: 'C' },
      { element: 'C' },
      { element: 'C', properties: { aromatic: true } }
    ],
    [{ aromatic: true }, { aromatic: true }, { aromatic: true }, { aromatic: true }, {}, {}, {}, {}, {}, { aromatic: true }],
    4,
    9,
    { aromatic: true }
  );
}

function createQuinazolineTemplate() {
  return createFusedAromaticPerimeterTemplate('quinazoline', ['C', 'C', 'C', 'C', 'C', 'C', 'N', 'C', 'N', 'C'], 4, 9);
}

function createQuinoxalineTemplate() {
  return createFusedAromaticPerimeterTemplate('quinoxaline', ['C', 'C', 'C', 'C', 'C', 'N', 'C', 'C', 'N', 'C'], 4, 9);
}

function createPhthalazineTemplate() {
  return createFusedAromaticPerimeterTemplate('phthalazine', ['C', 'C', 'C', 'C', 'C', 'C', 'C', 'N', 'N', 'C'], 4, 9);
}

/**
 * Creates a cinnoline fused aromatic bicyclic template.
 * @returns {Molecule} Cinnoline scaffold template molecule.
 */
function createCinnolineTemplate() {
  return createFusedAromaticPerimeterTemplate('cinnoline', ['C', 'C', 'C', 'C', 'C', 'C', 'N', 'N', 'C', 'C'], 4, 9);
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

/**
 * Creates a cubane cage template as the cube graph.
 * @returns {Molecule} Cubane scaffold template molecule.
 */
function createCubaneTemplate() {
  const molecule = new Molecule('template-cubane');
  addAtomSeries(molecule, 'a', 8, 'C');
  molecule.addBond('b0', 'a0', 'a1', {}, false);
  molecule.addBond('b1', 'a1', 'a2', {}, false);
  molecule.addBond('b2', 'a2', 'a3', {}, false);
  molecule.addBond('b3', 'a3', 'a0', {}, false);
  molecule.addBond('b4', 'a4', 'a5', {}, false);
  molecule.addBond('b5', 'a5', 'a6', {}, false);
  molecule.addBond('b6', 'a6', 'a7', {}, false);
  molecule.addBond('b7', 'a7', 'a4', {}, false);
  molecule.addBond('b8', 'a0', 'a4', {}, false);
  molecule.addBond('b9', 'a1', 'a5', {}, false);
  molecule.addBond('b10', 'a2', 'a6', {}, false);
  molecule.addBond('b11', 'a3', 'a7', {}, false);
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

/**
 * Creates the oxabicyclo[2.2.2]octane scaffold graph used by bridged
 * oxygen-containing cage systems like `C12CCC(CO1)CC2`.
 * @returns {Molecule} Oxabicyclo[2.2.2]octane scaffold template molecule.
 */
function createOxabicyclo222Template() {
  return createHeavyTemplateFromSmiles('oxabicyclo-2-2-2', 'C12CCC(CO1)CC2');
}

/**
 * Creates the quinuclidine scaffold graph used by aza-bicyclo[2.2.2]octane cages.
 * @returns {Molecule} Quinuclidine scaffold template molecule.
 */
function createQuinuclidineTemplate() {
  return createHeavyTemplateFromSmiles('quinuclidine', 'C1CN2CCC1CC2');
}

/**
 * Creates the oxabicyclo[3.1.1]heptane scaffold graph used by bridged
 * oxygen-containing cage systems like `C1OC2CC(C1)C2`.
 * @returns {Molecule} Oxabicyclo[3.1.1]heptane scaffold template molecule.
 */
function createOxabicyclo311Template() {
  return createHeavyTemplateFromSmiles('oxabicyclo-3-1-1', 'C1OC2CC(C1)C2');
}

/**
 * Creates the compact spiro-bridged oxetane cage scaffold graph found in
 * small nitrile-substituted tricyclic ethers like `N#CC1CC2(C1)C1CCC2O1`.
 * @returns {Molecule} Spiro-bridged oxetane scaffold template molecule.
 */
function createSpiroBridgedOxetaneTemplate() {
  return createRingSystemTemplateFromSmiles('spiro-bridged-oxetane', 'N#CC1CC2(C1)C1CCC2O1');
}

/**
 * Creates the compact spiro-bridged aza cage scaffold graph found in
 * acyl-substituted ammonium cages like `CCC(=O)C1CC2(C1)[NH2+]C1CC2C1`.
 * @returns {Molecule} Spiro-bridged aza cage scaffold template molecule.
 */
function createSpiroBridgedAzaCageTemplate() {
  return createHeavyTemplateFromSmiles('spiro-bridged-aza-cage', 'C1CC2(C1)[NH2+]C1CC2C1');
}

/**
 * Creates the benzoxathiobicyclo scaffold graph used by bridged benzothiophene
 * cages like `CC1(C)CC2CC(C2)COC2=CC=C1S2`.
 * @returns {Molecule} Benzoxathiobicyclo scaffold template molecule.
 */
function createBenzoxathiobicycloCoreTemplate() {
  return createHeavyTemplateFromSmiles('benzoxathiobicyclo-core', 'C1CC2CC(C2)COC2=CC=C1S2');
}

/**
 * Creates the morphinan-style benzocyclohexane aza-bridged core found in
 * opioid-like scaffolds such as levorphanol and related salts.
 * @returns {Molecule} Morphinan-style ring-system template molecule.
 */
function createMorphinanCoreTemplate() {
  return createHeavyTemplateFromSmiles('morphinan-core', 'C1C2Cc3ccccc3C1CCN2');
}

/**
 * Creates the tropane scaffold graph used by cocaine-like bridged alkaloids.
 * @returns {Molecule} Tropane scaffold template molecule.
 */
function createTropaneTemplate() {
  return createHeavyTemplateFromSmiles('tropane', 'N1C2CCC1CC(C2)');
}

/**
 * Creates the adamantane cage as the real expanded-tetrahedron graph.
 * @returns {Molecule} Adamantane scaffold template molecule.
 */
function createAdamantaneTemplate() {
  const molecule = new Molecule('template-adamantane');
  addAtomSeries(molecule, 'a', 10, 'C');
  molecule.addBond('b0', 'a0', 'a1', {}, false);
  molecule.addBond('b1', 'a0', 'a5', {}, false);
  molecule.addBond('b2', 'a1', 'a2', {}, false);
  molecule.addBond('b3', 'a1', 'a8', {}, false);
  molecule.addBond('b4', 'a2', 'a3', {}, false);
  molecule.addBond('b5', 'a3', 'a4', {}, false);
  molecule.addBond('b6', 'a3', 'a9', {}, false);
  molecule.addBond('b7', 'a4', 'a5', {}, false);
  molecule.addBond('b8', 'a5', 'a6', {}, false);
  molecule.addBond('b9', 'a6', 'a7', {}, false);
  molecule.addBond('b10', 'a7', 'a8', {}, false);
  molecule.addBond('b11', 'a7', 'a9', {}, false);
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
    coords.set(atomIds[index], add(center, fromAngle(startAngle + index * stepAngle, radius)));
  }
  return coords;
}

function centeredEntries(coords) {
  const center = centroid([...coords.values()]);
  return [...coords.entries()].map(([atomId, position]) => [atomId, { x: position.x - center.x, y: position.y - center.y }]);
}

/**
 * Freezes a centered explicit coordinate set for a template geometry.
 * @param {ReadonlyArray<[string, {x: number, y: number}]>} entries - Raw coordinate entries.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createCenteredFrozenGeometry(entries) {
  return freezeCoordEntries(centeredEntries(new Map(entries)));
}

function createBenzeneGeometry() {
  return freezeCoordEntries(centeredEntries(placeRegularPolygon(['a0', 'a1', 'a2', 'a3', 'a4', 'a5'], { x: 0, y: 0 }, 1, Math.PI / 2)));
}

function createCyclohexaneGeometry() {
  return freezeCoordEntries(centeredEntries(placeRegularPolygon(['a0', 'a1', 'a2', 'a3', 'a4', 'a5'], { x: 0, y: 0 }, 1, Math.PI / 2)));
}

function createPyridineGeometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4', 'a5']);
}

function createPyrimidineGeometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4', 'a5']);
}

function createPyrazineGeometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4', 'a5']);
}

function createPyridazineGeometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4', 'a5']);
}

function createTriazine123Geometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4', 'a5']);
}

function createTriazine124Geometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4', 'a5']);
}

function createTriazine135Geometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4', 'a5']);
}

function createPyrroleGeometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4']);
}

function createFuranGeometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4']);
}

function createThiopheneGeometry() {
  return freezeCoordEntries(centeredEntries(placeRegularPolygon(['a0', 'a1', 'a2', 'a3', 'a4'], { x: 0, y: 0 }, 1, -Math.PI / 2)));
}

function createImidazoleGeometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4']);
}

function createPyrazoleGeometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4']);
}

function createOxazoleGeometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4']);
}

function createIsoxazoleGeometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4']);
}

function createThiazoleGeometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4']);
}

function createIsothiazoleGeometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4']);
}

function createTriazole123Geometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4']);
}

function createTriazole124Geometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4']);
}

function createTetrazoleGeometry() {
  return createRegularAromaticCycleGeometry(['a0', 'a1', 'a2', 'a3', 'a4']);
}

/**
 * Creates normalized coordinates for a fused aromatic 6+6 bicyclic perimeter.
 * The shared bond is vertical so the overall long axis is horizontal.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createSixSixFusedGeometry() {
  return freezeCoordEntries([
    ['a0', { x: -0.8660254037844388, y: 1 }],
    ['a1', { x: -1.7320508075688776, y: 0.5000000000000003 }],
    ['a2', { x: -1.732050807568878, y: -0.49999999999999994 }],
    ['a3', { x: -0.8660254037844392, y: -1.0000000000000004 }],
    ['a4', { x: -1.554312234475219e-16, y: -0.49999999999999994 }],
    ['a5', { x: 0.8660254037844395, y: -1.0000000000000004 }],
    ['a6', { x: 1.7320508075688779, y: -0.5000000000000001 }],
    ['a7', { x: 1.7320508075688779, y: 0.49999999999999983 }],
    ['a8', { x: 0.866025403784439, y: 1 }],
    ['a9', { x: 1.7763568394002506e-16, y: 0.5000000000000003 }]
  ]);
}

/**
 * Creates normalized coordinates for a fused aromatic 5+6 bicyclic perimeter.
 * The benzene ring sits on the right and the five-membered ring on the left.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createFiveSixFusedGeometry() {
  const pentagonRadius = circumradiusForRegularPolygon(5, 1);
  const pentagonApothem = apothemForRegularPolygon(5, 1);
  const pentagonCenter = { x: -pentagonApothem, y: 0 };
  const pentagonCoords = placePolygonWithStep(['a1', 'a6', 'a7', 'a8', 'a0'], pentagonCenter, pentagonRadius, Math.PI / 5, (-2 * Math.PI) / 5);

  return freezeCoordEntries(
    centeredEntries(
      new Map([
        ['a0', pentagonCoords.get('a0')],
        ['a1', pentagonCoords.get('a1')],
        ['a2', { x: 0.866025403784439, y: 1 }],
        ['a3', { x: 1.7320508075688779, y: 0.49999999999999983 }],
        ['a4', { x: 1.7320508075688779, y: -0.5000000000000001 }],
        ['a5', { x: 0.8660254037844395, y: -1.0000000000000004 }],
        ['a6', pentagonCoords.get('a6')],
        ['a7', pentagonCoords.get('a7')],
        ['a8', pentagonCoords.get('a8')]
      ])
    )
  );
}

/**
 * Creates normalized coordinates for a linear tricyclic aromatic 6+6+6 perimeter.
 * The long axis is horizontal and both shared bonds are vertical.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createLinearTricyclicAromaticGeometry() {
  const centerOffset = 2 * apothemForRegularPolygon(6, 1);
  const coords = new Map();
  const leftCoords = placeRegularPolygon(['a13', 'a0', 'a1', 'a2', 'a3', 'a12'], { x: -centerOffset, y: 0 }, 1, Math.PI / 2);
  const middleCoords = placeRegularPolygon(['a11', 'a12', 'a3', 'a4', 'a5', 'a10'], { x: 0, y: 0 }, 1, Math.PI / 2);
  const rightCoords = placeRegularPolygon(['a9', 'a10', 'a5', 'a6', 'a7', 'a8'], { x: centerOffset, y: 0 }, 1, Math.PI / 2);

  for (const [atomId, position] of leftCoords) {
    coords.set(atomId, position);
  }
  for (const [atomId, position] of middleCoords) {
    coords.set(atomId, position);
  }
  for (const [atomId, position] of rightCoords) {
    coords.set(atomId, position);
  }
  return freezeCoordEntries(centeredEntries(coords));
}

/**
 * Mirrors a normalized template geometry across the vertical axis.
 * @param {ReadonlyArray<[string, {x: number, y: number}]>} entries - Normalized coordinate entries.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen mirrored coords.
 */
function mirrorCoordEntries(entries) {
  return createCenteredFrozenGeometry(entries.map(([atomId, position]) => [atomId, { x: -position.x, y: position.y }]));
}

function createQuinolineGeometry() {
  return createSixSixFusedGeometry();
}

function createIsoquinolineGeometry() {
  return createSixSixFusedGeometry();
}

function createIndoleGeometry() {
  return createFiveSixFusedGeometry();
}

function createBenzimidazoleGeometry() {
  return createFiveSixFusedGeometry();
}

function createBenzoxazoleGeometry() {
  return createFiveSixFusedGeometry();
}

function createBenzothiazoleGeometry() {
  return createFiveSixFusedGeometry();
}

function createIndazoleGeometry() {
  return createFiveSixFusedGeometry();
}

function createBenzotriazoleGeometry() {
  return createFiveSixFusedGeometry();
}

function createPurineGeometry() {
  return createFiveSixFusedGeometry();
}

/**
 * Creates normalized coordinates for acridine with the long axis horizontal.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAcridineGeometry() {
  return createLinearTricyclicAromaticGeometry();
}

/**
 * Creates normalized coordinates for anthracene with the long axis horizontal.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAnthraceneGeometry() {
  return createLinearTricyclicAromaticGeometry();
}

/**
 * Creates normalized coordinates for pyrene with the widest axis horizontal.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createPyreneGeometry() {
  const xUnit = Math.sqrt(3) / 4;
  return createCenteredFrozenGeometry([
    ['C1', { x: 5 * xUnit, y: -1.25 }],
    ['C2', { x: 3 * xUnit, y: -1.75 }],
    ['C3', { x: xUnit, y: -1.25 }],
    ['C4', { x: -xUnit, y: -1.75 }],
    ['C5', { x: -3 * xUnit, y: -1.25 }],
    ['C6', { x: -3 * xUnit, y: -0.25 }],
    ['C7', { x: -5 * xUnit, y: 0.25 }],
    ['C8', { x: -5 * xUnit, y: 1.25 }],
    ['C9', { x: -3 * xUnit, y: 1.75 }],
    ['C10', { x: -xUnit, y: 1.25 }],
    ['C11', { x: xUnit, y: 1.75 }],
    ['C12', { x: 3 * xUnit, y: 1.25 }],
    ['C13', { x: 3 * xUnit, y: 0.25 }],
    ['C14', { x: 5 * xUnit, y: -0.25 }],
    ['C15', { x: xUnit, y: -0.25 }],
    ['C16', { x: -xUnit, y: 0.25 }]
  ]);
}

/**
 * Creates normalized coordinates for perylene on an exact honeycomb lattice.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createPeryleneGeometry() {
  const xUnit = Math.sqrt(3) / 2;
  return createCenteredFrozenGeometry([
    ['C1', { x: 3 * xUnit, y: 0.5 }],
    ['C2', { x: 3 * xUnit, y: -0.5 }],
    ['C3', { x: 2 * xUnit, y: -1 }],
    ['C4', { x: xUnit, y: -0.5 }],
    ['C5', { x: xUnit, y: 0.5 }],
    ['C6', { x: 2 * xUnit, y: 1 }],
    ['C7', { x: 0, y: 1 }],
    ['C8', { x: -xUnit, y: 0.5 }],
    ['C9', { x: -2 * xUnit, y: 1 }],
    ['C10', { x: -3 * xUnit, y: 0.5 }],
    ['C11', { x: -3 * xUnit, y: -0.5 }],
    ['C12', { x: -4 * xUnit, y: -1 }],
    ['C13', { x: -4 * xUnit, y: -2 }],
    ['C14', { x: -3 * xUnit, y: -2.5 }],
    ['C15', { x: -2 * xUnit, y: -2 }],
    ['C16', { x: -xUnit, y: -2.5 }],
    ['C17', { x: 0, y: -2 }],
    ['C18', { x: 0, y: -1 }],
    ['C19', { x: -xUnit, y: -0.5 }],
    ['C20', { x: -2 * xUnit, y: -1 }]
  ]);
}

/**
 * Creates normalized coordinates for fluorene with the bridge carbon at the top.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createFluoreneGeometry() {
  return createCenteredFrozenGeometry([
    ['C1', { x: 2.456295, y: 0.105532 }],
    ['C10', { x: -2.456295, y: 0.105532 }],
    ['C2', { x: 2.147278, y: -0.845524 }],
    ['C11', { x: -2.147278, y: -0.845524 }],
    ['C6', { x: 1.787165, y: 0.848677 }],
    ['C9', { x: -1.787165, y: 0.848677 }],
    ['C3', { x: 1.169131, y: -1.053436 }],
    ['C12', { x: -1.169131, y: -1.053436 }],
    ['C7', { x: 0, y: 1.228551 }],
    ['C5', { x: 0.809017, y: 0.640766 }],
    ['C8', { x: -0.809017, y: 0.640766 }],
    ['C4', { x: 0.5, y: -0.310291 }],
    ['C13', { x: -0.5, y: -0.310291 }]
  ]);
}

/**
 * Creates a square-like porphine core with meso bridge carbons at the corners.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createPorphineGeometry() {
  return createCenteredFrozenGeometry([
    ['N15', { x: 0, y: 0.7493491916479602 }],
    ['C14', { x: 0.8090169943749473, y: 1.3371344439404333 }],
    ['C13', { x: 0.5, y: 2.2881909602355868 }],
    ['C12', { x: -0.5, y: 2.2881909602355868 }],
    ['C11', { x: -0.8090169943749473, y: 1.3371344439404331 }],
    ['N21', { x: 0.7493491916479602, y: 0 }],
    ['C20', { x: 1.3371344439404331, y: -0.8090169943749473 }],
    ['C19', { x: 2.2881909602355868, y: -0.5 }],
    ['C18', { x: 2.2881909602355868, y: 0.5 }],
    ['C17', { x: 1.3371344439404333, y: 0.8090169943749475 }],
    ['N24', { x: 0, y: -0.7493491916479602 }],
    ['C23', { x: 0.8090169943749473, y: -1.3371344439404333 }],
    ['C1', { x: 0.5, y: -2.2881909602355868 }],
    ['C2', { x: -0.5, y: -2.2881909602355868 }],
    ['C3', { x: -0.8090169943749473, y: -1.3371344439404331 }],
    ['N9', { x: -0.7493491916479602, y: 0 }],
    ['C8', { x: -1.3371344439404333, y: 0.8090169943749473 }],
    ['C7', { x: -2.2881909602355868, y: 0.5 }],
    ['C6', { x: -2.2881909602355868, y: -0.5 }],
    ['C5', { x: -1.3371344439404333, y: -0.8090169943749473 }],
    ['C10', { x: -1.7290276913828766, y: 1.7290276913828768 }],
    ['C16', { x: 1.7290276913828766, y: 1.729027691382877 }],
    ['C22', { x: 1.7290276913828768, y: -1.7290276913828766 }],
    ['C4', { x: -1.7290276913828766, y: -1.7290276913828768 }]
  ]);
}

/**
 * Creates normalized coordinates for the unsaturated steroid nucleus with the D ring on the right.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createSteroidCoreUnsaturatedGeometry() {
  return createCenteredFrozenGeometry([
    ['C18', { x: -1.106105, y: 0.268188 }],
    ['C11', { x: -1.51365, y: -0.644997 }],
    ['C10', { x: -0.926581, y: -1.454534 }],
    ['C9', { x: 0.068033, y: -1.350886 }],
    ['C7', { x: 0.475578, y: -0.437701 }],
    ['C5', { x: -0.111491, y: 0.371836 }],
    ['C12', { x: -2.508264, y: -0.748645 }],
    ['C13', { x: -3.095333, y: 0.060892 }],
    ['C16', { x: -2.687788, y: 0.974077 }],
    ['C17', { x: -1.693174, y: 1.077725 }],
    ['C4', { x: 0.296055, y: 1.285021 }],
    ['C3', { x: 1.290669, y: 1.388669 }],
    ['C2', { x: 1.877737, y: 0.579132 }],
    ['C20', { x: 1.470192, y: -0.334053 }],
    ['C24', { x: 2.872166, y: 0.473723 }],
    ['C23', { x: 3.079212, y: -0.504608 }],
    ['C22', { x: 2.212744, y: -1.003841 }]
  ]);
}

/**
 * Creates normalized coordinates for the saturated steroid nucleus with the D ring on the right.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createSteroidCoreSaturatedGeometry() {
  return createCenteredFrozenGeometry([
    ['C16', { x: -2.687788, y: 0.974077 }],
    ['C17', { x: -1.693174, y: 1.077725 }],
    ['C18', { x: -1.106105, y: 0.268188 }],
    ['C11', { x: -1.51365, y: -0.644997 }],
    ['C13', { x: -2.508264, y: -0.748645 }],
    ['C14', { x: -3.095333, y: 0.060892 }],
    ['C10', { x: -0.926581, y: -1.454534 }],
    ['C9', { x: 0.068033, y: -1.350886 }],
    ['C7', { x: 0.475578, y: -0.437701 }],
    ['C5', { x: -0.111491, y: 0.371836 }],
    ['C4', { x: 0.296055, y: 1.285021 }],
    ['C3', { x: 1.290669, y: 1.388669 }],
    ['C2', { x: 1.877737, y: 0.579132 }],
    ['C20', { x: 1.470192, y: -0.334053 }],
    ['C24', { x: 2.872166, y: 0.473723 }],
    ['C23', { x: 3.079212, y: -0.504608 }],
    ['C22', { x: 2.212744, y: -1.003841 }]
  ]);
}

function createIndaneGeometry() {
  return mirrorCoordEntries(createFiveSixFusedGeometry());
}

function createTetralinGeometry() {
  return createSixSixFusedGeometry();
}

function createChromaneGeometry() {
  return createSixSixFusedGeometry();
}

function createIsochromaneGeometry() {
  return createSixSixFusedGeometry();
}

function createQuinazolineGeometry() {
  return createSixSixFusedGeometry();
}

function createQuinoxalineGeometry() {
  return createSixSixFusedGeometry();
}

function createPhthalazineGeometry() {
  return createSixSixFusedGeometry();
}

/**
 * Creates normalized coordinates for cinnoline with the diazine ring on the right.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createCinnolineGeometry() {
  return createSixSixFusedGeometry();
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

/**
 * Creates a conventional norbornane cage projection with the one-atom bridge up.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createNorbornaneGeometry() {
  return createCenteredFrozenGeometry([
    ['a0', { x: 0.45, y: 0.1 }],
    ['a1', { x: 0, y: -0.45 }],
    ['a2', { x: -0.75, y: 0.05 }],
    ['a3', { x: -1.1, y: -0.9 }],
    ['a4', { x: 1.35, y: -0.1 }],
    ['a5', { x: 1.05, y: -1.05 }],
    ['a6', { x: 0, y: 0.95 }]
  ]);
}

/**
 * Creates a conventional bicyclo[2.2.2]octane cage projection with a raised top bridge.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createBicyclo222Geometry() {
  return createCenteredFrozenGeometry([
    ['a0', { x: 0.25, y: 0.1 }],
    ['a1', { x: -0.2, y: -0.55 }],
    ['a2', { x: -0.95, y: -0.05 }],
    ['a3', { x: -1.35, y: -1 }],
    ['a4', { x: 1.4, y: -0.05 }],
    ['a5', { x: 1, y: -1 }],
    ['a6', { x: 0.25, y: 1.1 }],
    ['a7', { x: -0.45, y: 0.5 }]
  ]);
}

/**
 * Creates a conventional oxabicyclo[2.2.2]octane projection with the oxygen
 * on the right-hand bridge, the carbon-only bridge spread to the left, and
 * the third bridge rising to the top apex like the supplied reference sketch.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createOxabicyclo222Geometry() {
  return createCenteredFrozenGeometry([
    ['C1', { x: 0.25, y: 0.1 }],
    ['C4', { x: -0.2, y: -0.55 }],
    ['C2', { x: -0.95, y: -0.05 }],
    ['C3', { x: -1.35, y: -1.0 }],
    ['O6', { x: 1.4, y: -0.05 }],
    ['C5', { x: 1.0, y: -1.0 }],
    ['C8', { x: 0.25, y: 1.1 }],
    ['C7', { x: -0.45, y: 0.5 }]
  ]);
}

/**
 * Creates a conventional quinuclidine projection with the bridgehead nitrogen
 * low in the cage, a short vertical upper bridge, and the two side bridges
 * fanning left and right like the reference medicinal-chemistry depictions.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createQuinuclidineGeometry() {
  return createCenteredFrozenGeometry([
    ['N3', { x: 0, y: 0 }],
    ['C2', { x: 0, y: 0.92 }],
    ['C1', { x: 0.42, y: 1.72 }],
    ['C6', { x: 0.48, y: 0.52 }],
    ['C5', { x: -0.74, y: 0.37 }],
    ['C4', { x: -1.03, y: -0.53 }],
    ['C8', { x: 0.86, y: -0.55 }],
    ['C7', { x: 1.51, y: 0.11 }]
  ]);
}

/**
 * Creates a conventional oxabicyclo[3.1.1]heptane projection with the oxygen
 * on the lower-left bridge, a short right-hand bridge, and the one-atom bridge
 * rising to the top apex like the supplied reference sketch.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createOxabicyclo311Geometry() {
  return createCenteredFrozenGeometry([
    ['C3', { x: 0.18, y: -0.44 }],
    ['O2', { x: -0.38, y: -0.93 }],
    ['C1', { x: -1.0, y: -0.58 }],
    ['C6', { x: -0.78, y: 0.22 }],
    ['C5', { x: 0.52, y: 0.28 }],
    ['C4', { x: 1.32, y: -0.04 }],
    ['C7', { x: 0.08, y: 0.92 }]
  ]);
}

/**
 * Creates a planar compact spiro-bridged oxetane projection. The oxetane
 * bridge sits inside the wider carbon bridge, while the cyclobutane spiro ring
 * opens to the left so nitrile-like substituents leave the cage exterior.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createSpiroBridgedOxetaneGeometry() {
  return createCenteredFrozenGeometry([
    ['C7', { x: 0.0, y: 0.0 }],
    ['C10', { x: 0.0, y: 1.0 }],
    ['O11', { x: 0.55, y: 0.5 }],
    ['C5', { x: -0.75, y: 0.5 }],
    ['C8', { x: 1.2, y: 0.0 }],
    ['C9', { x: 1.2, y: 1.0 }],
    ['C4', { x: -1.504275, y: 1.143864 }],
    ['C3', { x: -2.189143, y: 0.40421 }],
    ['C6', { x: -1.421914, y: -0.251213 }]
  ]);
}

/**
 * Creates a compact projection for the acyl-substituted spiro-bridged aza
 * cage. The substituted cyclobutane opens left, while the ammonium bridge and
 * fused cyclobutane are folded into a short right-hand cage projection.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createSpiroBridgedAzaCageGeometry() {
  return createCenteredFrozenGeometry([
    ['C3', { x: 0.0, y: 0.0 }],
    ['C2', { x: -0.7, y: -0.7 }],
    ['C1', { x: -1.4, y: 0.0 }],
    ['C4', { x: -0.7, y: 0.7 }],
    ['N5', { x: 0.82, y: 0.94 }],
    ['C7', { x: 1.58, y: 0.08 }],
    ['C10', { x: 0.82, y: -0.24 }],
    ['C9', { x: 0.54, y: -1.02 }],
    ['C8', { x: 1.66, y: -0.9 }]
  ]);
}

/**
 * Creates a conventional bridged benzoxathiobicyclo projection matching the
 * supplied medicinal-chemistry sketch: gem-dimethyl-bearing junction on the
 * left, the cyclobutane bridge on the upper right, and the benzothiophene-like
 * sulfur/oxygen ring below the main span.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createBenzoxathiobicycloCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C1', { x: -1.638, y: 0.195 }],
    ['C2', { x: -0.78, y: 0.858 }],
    ['C3', { x: 0.351, y: 0.741 }],
    ['C4', { x: 0.351, y: -0.195 }],
    ['C5', { x: 1.209, y: -0.117 }],
    ['C6', { x: 1.287, y: 0.78 }],
    ['C7', { x: 1.833, y: -1.092 }],
    ['O8', { x: 1.053, y: -1.521 }],
    ['C9', { x: 0.156, y: -1.482 }],
    ['C10', { x: -0.741, y: -1.911 }],
    ['C11', { x: -1.638, y: -1.076 }],
    ['C12', { x: -1.01, y: -0.3 }],
    ['S13', { x: -0.1, y: -0.52 }]
  ]);
}

/**
 * Creates a morphinan-style projection with an exact fused benzene, an exact
 * central cyclohexane, and a compact aza bridge drawn outside the saturated
 * ring. The atom IDs match `C1C2Cc3ccccc3C1CCN2` as parsed above.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createMorphinanCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C9', { x: 0, y: -0.5 }],
    ['C10', { x: 0.8660254037844386, y: -1 }],
    ['C1', { x: 1.7320508075688772, y: -0.5 }],
    ['C2', { x: 1.7320508075688772, y: 0.5 }],
    ['C3', { x: 0.8660254037844386, y: 1 }],
    ['C4', { x: 0, y: 0.5 }],
    ['C5', { x: -0.8660254037844386, y: 1 }],
    ['C6', { x: -1.7320508075688772, y: 0.5 }],
    ['C7', { x: -1.7320508075688772, y: -0.5 }],
    ['C8', { x: -0.8660254037844386, y: -1 }],
    ['C11', { x: 1.3274545589330013, y: -1.7813766487939615 }],
    ['C12', { x: 1.9762468991775517, y: -1.060478569082301 }],
    ['N13', { x: 2.3520006876696793, y: -0.21553754832782718 }]
  ]);
}

/**
 * Creates a conventional tropane projection matching the common cocaine-style
 * drawing: a vertical aza bridge on the left, a compact left bridge, and a
 * longer right-hand bridge that descends toward the lower-right exit vector.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createTropaneGeometry() {
  return createCenteredFrozenGeometry([
    ['N1', { x: -0.058, y: 1.276 }],
    ['C2', { x: -0.058, y: 0.0 }],
    ['C3', { x: -0.9512, y: -0.3248 }],
    ['C4', { x: -0.696, y: 0.4408 }],
    ['C5', { x: 0.4872, y: 0.8352 }],
    ['C6', { x: 1.1368, y: 0.2784 }],
    ['C7', { x: 1.4848, y: -0.7888 }],
    ['C8', { x: 0.6032, y: -0.2784 }]
  ]);
}

/**
 * Creates a chair-like adamantane cage projection matching common drawing software.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAdamantaneGeometry() {
  return createCenteredFrozenGeometry([
    ['a5', { x: 0.0, y: 1.24 }],
    ['a0', { x: -0.77, y: 0.94 }],
    ['a1', { x: -1.2, y: 0.21 }],
    ['a6', { x: -0.47, y: 0.47 }],
    ['a7', { x: -0.47, y: -0.56 }],
    ['a8', { x: -1.24, y: -0.81 }],
    ['a4', { x: 1.15, y: 0.85 }],
    ['a3', { x: 1.15, y: -0.04 }],
    ['a2', { x: -0.04, y: -0.04 }],
    ['a9', { x: 0.56, y: -0.85 }]
  ]);
}

/**
 * Creates a standard 2D cube projection for cubane.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createCubaneGeometry() {
  const offset = 0.6;
  return createCenteredFrozenGeometry([
    ['a0', { x: -0.5, y: 0.5 }],
    ['a1', { x: 0.5, y: 0.5 }],
    ['a2', { x: 0.5, y: -0.5 }],
    ['a3', { x: -0.5, y: -0.5 }],
    ['a4', { x: -0.5 + offset, y: 0.5 + offset }],
    ['a5', { x: 0.5 + offset, y: 0.5 + offset }],
    ['a6', { x: 0.5 + offset, y: -0.5 + offset }],
    ['a7', { x: -0.5 + offset, y: -0.5 + offset }]
  ]);
}

function geometrySpec(kind, normalizedCoords, validation) {
  return Object.freeze({
    kind,
    normalizedCoords,
    validation: Object.freeze({ ...validation })
  });
}

/**
 * Freezes optional match-context metadata for a template descriptor.
 * @param {object|null|undefined} matchContext - Match-context descriptor.
 * @returns {object|null} Frozen match-context descriptor or `null`.
 */
function freezeMatchContext(matchContext) {
  if (!matchContext) {
    return null;
  }

  return Object.freeze({
    exocyclicNeighbors: Object.freeze((matchContext.exocyclicNeighbors ?? []).map(constraint => Object.freeze({ ...constraint }))),
    mappedAtoms: Object.freeze((matchContext.mappedAtoms ?? []).map(constraint => Object.freeze({ ...constraint })))
  });
}

/**
 * Creates one frozen scaffold-template descriptor.
 * @param {string} id - Template identifier.
 * @param {string} family - Template family.
 * @param {number} priority - Match priority.
 * @param {Molecule} molecule - Template molecule graph.
 * @param {object|null} geometry - Optional normalized geometry spec.
 * @param {object} [options] - Additional template options.
 * @param {object|null} [options.matchContext] - Optional match-context metadata.
 * @returns {object} Frozen template descriptor.
 */
function createTemplate(id, family, priority, molecule, geometry, options = {}) {
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
    matchContext: freezeMatchContext(options.matchContext),
    createCoords: normalizedCoords ? bondLength => scaleCoordEntries(normalizedCoords, bondLength) : null
  });
}

export const PLANAR_VALIDATION = TEMPLATE_PLANAR_VALIDATION;

/**
 * Builds the deterministic scaffold-template catalog prior to top-level freezing.
 * @returns {object[]} Ordered template descriptors.
 */
export function buildTemplateLibrary() {
  return [
    createTemplate('adamantane', 'bridged', 70, createAdamantaneTemplate(), geometrySpec('normalized-xy', createAdamantaneGeometry(), BRIDGED_VALIDATION)),
    createTemplate('bicyclo-2-2-2', 'bridged', 60, createBicyclo222Template(), geometrySpec('normalized-xy', createBicyclo222Geometry(), BRIDGED_VALIDATION)),
    createTemplate('oxabicyclo-2-2-2', 'bridged', 59, createOxabicyclo222Template(), geometrySpec('normalized-xy', createOxabicyclo222Geometry(), BRIDGED_VALIDATION)),
    createTemplate('quinuclidine', 'bridged', 58, createQuinuclidineTemplate(), geometrySpec('normalized-xy', createQuinuclidineGeometry(), BRIDGED_VALIDATION)),
    createTemplate('tropane', 'bridged', 57, createTropaneTemplate(), geometrySpec('normalized-xy', createTropaneGeometry(), BRIDGED_VALIDATION)),
    createTemplate('cubane', 'bridged', 55, createCubaneTemplate(), geometrySpec('normalized-xy', createCubaneGeometry(), BRIDGED_VALIDATION)),
    createTemplate('oxabicyclo-3-1-1', 'bridged', 54, createOxabicyclo311Template(), geometrySpec('normalized-xy', createOxabicyclo311Geometry(), OXABICYCLO311_VALIDATION)),
    createTemplate(
      'spiro-bridged-aza-cage',
      'bridged',
      53.75,
      createSpiroBridgedAzaCageTemplate(),
      geometrySpec('normalized-xy', createSpiroBridgedAzaCageGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C1', element: 'C', minCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'spiro-bridged-oxetane',
      'bridged',
      53.5,
      createSpiroBridgedOxetaneTemplate(),
      geometrySpec('normalized-xy', createSpiroBridgedOxetaneGeometry(), BRIDGED_VALIDATION)
    ),
    createTemplate(
      'benzoxathiobicyclo-core',
      'bridged',
      53,
      createBenzoxathiobicycloCoreTemplate(),
      geometrySpec('normalized-xy', createBenzoxathiobicycloCoreGeometry(), BRIDGED_VALIDATION)
    ),
    createTemplate('morphinan-core', 'bridged', 52, createMorphinanCoreTemplate(), geometrySpec('normalized-xy', createMorphinanCoreGeometry(), BRIDGED_VALIDATION)),
    createTemplate('norbornane', 'bridged', 50, createNorbornaneTemplate(), geometrySpec('normalized-xy', createNorbornaneGeometry(), BRIDGED_VALIDATION)),
    createTemplate('quinoline', 'fused', 49, createQuinolineTemplate(), geometrySpec('normalized-xy', createQuinolineGeometry(), PLANAR_VALIDATION)),
    createTemplate('isoquinoline', 'fused', 48, createIsoquinolineTemplate(), geometrySpec('normalized-xy', createIsoquinolineGeometry(), PLANAR_VALIDATION)),
    createTemplate('indole', 'fused', 47, createIndoleTemplate(), geometrySpec('normalized-xy', createIndoleGeometry(), PLANAR_VALIDATION)),
    createTemplate('benzimidazole', 'fused', 46, createBenzimidazoleTemplate(), geometrySpec('normalized-xy', createBenzimidazoleGeometry(), PLANAR_VALIDATION)),
    createTemplate('benzimidazolium', 'fused', 45.9, createBenzimidazoliumTemplate(), geometrySpec('normalized-xy', createBenzimidazoleGeometry(), PLANAR_VALIDATION), {
      matchContext: {
        mappedAtoms: [
          {
            templateAtomId: 'a7',
            charge: 1,
            aromatic: false
          }
        ]
      }
    }),
    createTemplate('benzoxazole', 'fused', 45, createBenzoxazoleTemplate(), geometrySpec('normalized-xy', createBenzoxazoleGeometry(), PLANAR_VALIDATION)),
    createTemplate('benzothiazole', 'fused', 44, createBenzothiazoleTemplate(), geometrySpec('normalized-xy', createBenzothiazoleGeometry(), PLANAR_VALIDATION)),
    createTemplate('indazole', 'fused', 43.5, createIndazoleTemplate(), geometrySpec('normalized-xy', createIndazoleGeometry(), PLANAR_VALIDATION)),
    createTemplate('benzotriazole', 'fused', 43.25, createBenzotriazoleTemplate(), geometrySpec('normalized-xy', createBenzotriazoleGeometry(), PLANAR_VALIDATION)),
    createTemplate('purine', 'fused', 43, createPurineTemplate(), geometrySpec('normalized-xy', createPurineGeometry(), PLANAR_VALIDATION)),
    createTemplate('indane', 'fused', 40.9, createIndaneTemplate(), geometrySpec('normalized-xy', createIndaneGeometry(), PLANAR_VALIDATION)),
    createTemplate('tetralin', 'fused', 40.8, createTetralinTemplate(), geometrySpec('normalized-xy', createTetralinGeometry(), PLANAR_VALIDATION)),
    createTemplate('chromane', 'fused', 40.7, createChromaneTemplate(), geometrySpec('normalized-xy', createChromaneGeometry(), PLANAR_VALIDATION)),
    createTemplate('isochromane', 'fused', 40.6, createIsochromaneTemplate(), geometrySpec('normalized-xy', createIsochromaneGeometry(), PLANAR_VALIDATION)),
    createTemplate('quinazoline', 'fused', 42.5, createQuinazolineTemplate(), geometrySpec('normalized-xy', createQuinazolineGeometry(), PLANAR_VALIDATION)),
    createTemplate('quinoxaline', 'fused', 41.5, createQuinoxalineTemplate(), geometrySpec('normalized-xy', createQuinoxalineGeometry(), PLANAR_VALIDATION)),
    createTemplate('acridine', 'fused', 41, createAcridineTemplate(), geometrySpec('normalized-xy', createAcridineGeometry(), PLANAR_VALIDATION)),
    createTemplate('porphine', 'macrocycle', 40.985, createPorphineTemplate(), geometrySpec('normalized-xy', createPorphineGeometry(), PLANAR_VALIDATION)),
    createTemplate(
      'steroid-core-unsaturated',
      'fused',
      40.97,
      createSteroidCoreUnsaturatedTemplate(),
      geometrySpec('normalized-xy', createSteroidCoreUnsaturatedGeometry(), PLANAR_VALIDATION)
    ),
    createTemplate(
      'steroid-core-saturated',
      'fused',
      40.96,
      createSteroidCoreSaturatedTemplate(),
      geometrySpec('normalized-xy', createSteroidCoreSaturatedGeometry(), PLANAR_VALIDATION)
    ),
    createTemplate('perylene', 'fused', 40.955, createPeryleneTemplate(), geometrySpec('normalized-xy', createPeryleneGeometry(), PLANAR_VALIDATION)),
    createTemplate('pyrene', 'fused', 40.95, createPyreneTemplate(), geometrySpec('normalized-xy', createPyreneGeometry(), PLANAR_VALIDATION)),
    createTemplate('fluorene', 'fused', 40.94, createFluoreneTemplate(), geometrySpec('normalized-xy', createFluoreneGeometry(), PLANAR_VALIDATION)),
    createTemplate('indanone', 'fused', 40.91, createIndaneTemplate(), geometrySpec('normalized-xy', createIndaneGeometry(), PLANAR_VALIDATION), {
      matchContext: {
        exocyclicNeighbors: [
          {
            templateAtomId: 'a0',
            element: 'O',
            bondOrder: 2,
            neighborDegree: 1,
            minCount: 1,
            maxCount: 1
          }
        ]
      }
    }),
    createTemplate('anthracene', 'fused', 40.75, createAnthraceneTemplate(), geometrySpec('normalized-xy', createAnthraceneGeometry(), PLANAR_VALIDATION)),
    createTemplate('phthalazine', 'fused', 40.5, createPhthalazineTemplate(), geometrySpec('normalized-xy', createPhthalazineGeometry(), PLANAR_VALIDATION)),
    createTemplate('cinnoline', 'fused', 40.49, createCinnolineTemplate(), geometrySpec('normalized-xy', createCinnolineGeometry(), PLANAR_VALIDATION)),
    createTemplate('naphthalene', 'fused', 40, createNaphthaleneTemplate(), geometrySpec('normalized-xy', createNaphthaleneGeometry(), PLANAR_VALIDATION)),
    createTemplate('pyridine', 'isolated-ring', 39, createPyridineTemplate(), geometrySpec('normalized-xy', createPyridineGeometry(), PLANAR_VALIDATION)),
    createTemplate('pyrimidine', 'isolated-ring', 38, createPyrimidineTemplate(), geometrySpec('normalized-xy', createPyrimidineGeometry(), PLANAR_VALIDATION)),
    createTemplate('pyrazine', 'isolated-ring', 37, createPyrazineTemplate(), geometrySpec('normalized-xy', createPyrazineGeometry(), PLANAR_VALIDATION)),
    createTemplate('pyridazine', 'isolated-ring', 36, createPyridazineTemplate(), geometrySpec('normalized-xy', createPyridazineGeometry(), PLANAR_VALIDATION)),
    createTemplate('triazine-1-2-3', 'isolated-ring', 35, createTriazine123Template(), geometrySpec('normalized-xy', createTriazine123Geometry(), PLANAR_VALIDATION)),
    createTemplate('triazine-1-2-4', 'isolated-ring', 34, createTriazine124Template(), geometrySpec('normalized-xy', createTriazine124Geometry(), PLANAR_VALIDATION)),
    createTemplate('triazine-1-3-5', 'isolated-ring', 33, createTriazine135Template(), geometrySpec('normalized-xy', createTriazine135Geometry(), PLANAR_VALIDATION)),
    createTemplate('benzene', 'isolated-ring', 30, createBenzeneTemplate(), geometrySpec('normalized-xy', createBenzeneGeometry(), PLANAR_VALIDATION)),
    createTemplate('pyrrole', 'isolated-ring', 29, createPyrroleTemplate(), geometrySpec('normalized-xy', createPyrroleGeometry(), PLANAR_VALIDATION)),
    createTemplate('furan', 'isolated-ring', 28, createFuranTemplate(), geometrySpec('normalized-xy', createFuranGeometry(), PLANAR_VALIDATION)),
    createTemplate('thiophene', 'isolated-ring', 27, createThiopheneTemplate(), geometrySpec('normalized-xy', createThiopheneGeometry(), PLANAR_VALIDATION)),
    createTemplate('imidazole', 'isolated-ring', 26, createImidazoleTemplate(), geometrySpec('normalized-xy', createImidazoleGeometry(), PLANAR_VALIDATION)),
    createTemplate('pyrazole', 'isolated-ring', 25, createPyrazoleTemplate(), geometrySpec('normalized-xy', createPyrazoleGeometry(), PLANAR_VALIDATION)),
    createTemplate('oxazole', 'isolated-ring', 24, createOxazoleTemplate(), geometrySpec('normalized-xy', createOxazoleGeometry(), PLANAR_VALIDATION)),
    createTemplate('isoxazole', 'isolated-ring', 23, createIsoxazoleTemplate(), geometrySpec('normalized-xy', createIsoxazoleGeometry(), PLANAR_VALIDATION)),
    createTemplate('thiazole', 'isolated-ring', 22.5, createThiazoleTemplate(), geometrySpec('normalized-xy', createThiazoleGeometry(), PLANAR_VALIDATION)),
    createTemplate('isothiazole', 'isolated-ring', 21.5, createIsothiazoleTemplate(), geometrySpec('normalized-xy', createIsothiazoleGeometry(), PLANAR_VALIDATION)),
    createTemplate('triazole-1-2-3', 'isolated-ring', 20.5, createTriazole123Template(), geometrySpec('normalized-xy', createTriazole123Geometry(), PLANAR_VALIDATION)),
    createTemplate('triazole-1-2-4', 'isolated-ring', 19.5, createTriazole124Template(), geometrySpec('normalized-xy', createTriazole124Geometry(), PLANAR_VALIDATION)),
    createTemplate('tetrazole', 'isolated-ring', 22, createTetrazoleTemplate(), geometrySpec('normalized-xy', createTetrazoleGeometry(), PLANAR_VALIDATION)),
    createTemplate('cyclohexane', 'isolated-ring', 20, createCyclohexaneTemplate(), geometrySpec('normalized-xy', createCyclohexaneGeometry(), PLANAR_VALIDATION)),
    createTemplate('spiro-5-5', 'spiro', 10, createSpiroTemplate(), geometrySpec('normalized-xy', createSpiroGeometry(), PLANAR_VALIDATION))
  ].sort((firstTemplate, secondTemplate) => {
    if (secondTemplate.priority !== firstTemplate.priority) {
      return secondTemplate.priority - firstTemplate.priority;
    }
    if (secondTemplate.atomCount !== firstTemplate.atomCount) {
      return secondTemplate.atomCount - firstTemplate.atomCount;
    }
    return String(firstTemplate.id).localeCompare(String(secondTemplate.id), 'en', { numeric: true });
  });
}
