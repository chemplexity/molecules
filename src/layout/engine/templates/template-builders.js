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

/** Template-specific validation for the strongly foreshortened dimethyl oxatricyclo cage projection. */
const DIMETHYL_OXATRICYCLO_CAGE_VALIDATION = Object.freeze({
  ...BRIDGED_VALIDATION,
  maxMeanDeviation: 0.38
});

/** Template-specific validation for the foreshortened planar triazaadamantane cage projection. */
const TRIAZAADAMANTANE_VALIDATION = Object.freeze({
  ...BRIDGED_VALIDATION,
  maxMeanDeviation: 0.44
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
 * Creates a calixarene-like macrocycle template with four methylene-bridged
 * aryl walls.
 * @returns {Molecule} Calixarene guanidine scaffold template molecule.
 */
function createCalixareneGuanidineCoreTemplate() {
  return createRingSystemTemplateFromSmiles(
    'calixarene-guanidine-core',
    'NC(=N)NCCOc1c2Cc3cccc(Cc4cccc(Cc5cccc(Cc1ccc2)c5O)c4OCC(=O)NC(=N)N)c3O'
  );
}

/**
 * Creates the trans-polyene macrolide scaffold found in fused oxazole and
 * pyrrolidone macrocycles like
 * `CC(C)[C@H]1OC(=O)C2=CCCN2C(=O)C2=COC(=N2)CC(=O)C[C@H](O)\C=C(/C)\C=C\CNC(=O)\C=C\[C@H]1C`.
 * @returns {Molecule} Trans-polyene macrolide scaffold template molecule.
 */
function createTransPolyeneMacrolideTemplate() {
  return createRingSystemTemplateFromSmiles(
    'trans-polyene-macrolide',
    String.raw`CC(C)[C@H]1OC(=O)C2=CCCN2C(=O)C2=COC(=N2)CC(=O)C[C@H](O)\C=C(/C)\C=C\CNC(=O)\C=C\[C@H]1C`
  );
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

/**
 * Creates the amino acyl aryl norbornane scaffold graph found in highly
 * substituted stereochemical norbornanes like
 * `[H][C@]12CC[C@]([H])(C1)[C@](N)(C(=O)c1ccccc1)[C@]2([H])c1ccccc1`.
 * @returns {Molecule} Amino acyl aryl norbornane scaffold template molecule.
 */
function createAminoAcylArylNorbornaneCoreTemplate() {
  return createRingSystemTemplateFromSmiles(
    'amino-acyl-aryl-norbornane-core',
    '[H][C@]12CC[C@]([H])(C1)[C@](N)(C(=O)C1=CC=CC=C1)[C@]2([H])C1=CC=CC=C1'
  );
}

/**
 * Creates a norbornene-like bridged scaffold with one unsaturated outer path.
 * @returns {Molecule} Norbornene scaffold template molecule.
 */
function createNorborneneTemplate() {
  const molecule = new Molecule('template-norbornene');
  addAtomSeries(molecule, 'a', 7, 'C');
  molecule.addBond('b0', 'a0', 'a2', {}, false);
  molecule.addBond('b1', 'a2', 'a3', {}, false);
  molecule.addBond('b2', 'a3', 'a1', {}, false);
  molecule.addBond('b3', 'a0', 'a4', {}, false);
  molecule.addBond('b4', 'a4', 'a5', { order: 2 }, false);
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
 * Creates the hydroxy diformyl bicyclooctadiene scaffold graph found in
 * substituted bridged dienes like `CCCC1C(O)C2C(C=O)=CC1C=C2C=O`.
 * @returns {Molecule} Hydroxy diformyl bicyclooctadiene scaffold template molecule.
 */
function createHydroxyDiformylBicyclooctadieneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('hydroxy-diformyl-bicyclooctadiene-core', 'CCCC1C(O)C2C(C=O)=CC1C=C2C=O');
}

/**
 * Creates the alkenyl phenyl oxabicycloheptane scaffold graph found in
 * substituted ether cages like
 * `CCCCC(C)(C)C(O)C=CC1C2CC(CO2)(C1CC=CCCCC([O-])=O)C1=CC=CC=C1`.
 * @returns {Molecule} Alkenyl phenyl oxabicycloheptane scaffold template molecule.
 */
function createAlkenylPhenylOxabicycloheptaneCoreTemplate() {
  return createRingSystemTemplateFromSmiles(
    'alkenyl-phenyl-oxabicycloheptane-core',
    'CCCCC(C)(C)C(O)C=CC1C2CC(CO2)(C1CC=CCCCC([O-])=O)C1=CC=CC=C1'
  );
}

/**
 * Creates the oxygenated caged lactone scaffold graph found in compact
 * gibberellin-like ring systems with one embedded lactone and carboxyl exit.
 * @returns {Molecule} Caged hydroxy lactone scaffold template molecule.
 */
function createCagedHydroxyLactoneCoreTemplate() {
  return createRingSystemTemplateFromSmiles(
    'caged-hydroxy-lactone-core',
    '[H][C@@]12C[C@@]3(CC1=C)[C@@]([H])(CC2)[C@@]12CC[C@]([H])(O)[C@@](C)(C(=O)O1)[C@@]2([H])[C@]3([H])C(O)=O'
  );
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
 * Creates the quinuclidinium scaffold graph used by charged
 * aza-bicyclo[2.2.2]octane cages.
 * @returns {Molecule} Quinuclidinium scaffold template molecule.
 */
function createQuinuclidiniumTemplate() {
  return createHeavyTemplateFromSmiles('quinuclidinium', '[N+]12CCC(CC1)C(C2)');
}

/**
 * Creates the diazatricyclodecane scaffold graph used by adamantane-like
 * bridged bis-amine cages such as `N1C2CC3CC1CC(C2)N3`.
 * @returns {Molecule} Diazatricyclodecane scaffold template molecule.
 */
function createDiazatricyclodecaneCoreTemplate() {
  return createHeavyTemplateFromSmiles('diazatricyclodecane-core', 'N1C2CC3CC1CC(C2)N3');
}

/**
 * Creates the triazaadamantane scaffold graph used by polyaza cages such as
 * `C12CN3CN(CN(C3)C1)C2`.
 * @returns {Molecule} Triazaadamantane scaffold template molecule.
 */
function createTriazaadamantaneCoreTemplate() {
  return createHeavyTemplateFromSmiles('triazaadamantane-core', 'C12CN3CN(CN(C3)C1)C2');
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
 * Creates the bridged bicyclic lactone scaffold graph used by compact
 * guanidinium-substituted oxabicyclic cores like
 * `CN(CCN)C(=[NH2+])C1CCC2CCC1OC2=O`.
 * @returns {Molecule} Bridged lactone scaffold template molecule.
 */
function createBridgedLactoneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('bridged-lactone-core', 'CN(CCN)C(=[NH2+])C1CCC2CCC1OC2=O');
}

/**
 * Creates the compact oxabicyclic lactone scaffold graph found in ammonium-
 * substituted bridged lactones like `CCC1OC2CC(=O)OC1CC2[NH3+]`.
 * @returns {Molecule} Oxabicyclic lactone scaffold template molecule.
 */
function createOxabicyclicLactoneAmmoniumCoreTemplate() {
  return createRingSystemTemplateFromSmiles('oxabicyclic-lactone-ammonium-core', 'CCC1OC2CC(=O)OC1CC2[NH3+]');
}

/**
 * Creates the compact oxazabicyclic lactam scaffold graph found in
 * gem-substituted bridged lactams like `CC1(CC#N)CC2COC1C(=O)N2`.
 * @returns {Molecule} Oxazabicyclic lactam scaffold template molecule.
 */
function createOxazabicyclicLactamCoreTemplate() {
  return createRingSystemTemplateFromSmiles('oxazabicyclic-lactam-core', 'CC1(CC#N)CC2COC1C(=O)N2');
}

/**
 * Creates the hydroxy oxazabicyclic lactam scaffold graph found in compact
 * beta-lactam-like cages such as `OC1C2CNC(=O)C1O2`.
 * @returns {Molecule} Hydroxy oxazabicyclic lactam scaffold template molecule.
 */
function createHydroxyOxazabicyclicLactamCoreTemplate() {
  return createRingSystemTemplateFromSmiles('hydroxy-oxazabicyclic-lactam-core', 'OC1C2CNC(=O)C1O2');
}

/**
 * Creates the compact azabicyclic ketone scaffold found in oxadiazole-
 * substituted ammonium cages like `O=C1C2C[NH2+]C1C2C1=NON=C1`.
 * @returns {Molecule} Azabicyclic ketone oxadiazole scaffold template molecule.
 */
function createAzabicycloKetoneOxadiazoleCoreTemplate() {
  return createRingSystemTemplateFromSmiles('azabicyclo-ketone-oxadiazole-core', 'O=C1C2C[NH2+]C1C2C1=NON=C1');
}

/**
 * Creates the compact hydroxy keto oxadiazole scaffold graph found in bridged
 * cyclopentane-fused oxadiazoles like `CCC1CC2(O)C(C)CC3=C(N=CO3)C1C2=O`.
 * @returns {Molecule} Hydroxy keto oxadiazole bridged scaffold template molecule.
 */
function createHydroxyKetoOxadiazoleBridgedCoreTemplate() {
  return createRingSystemTemplateFromSmiles('hydroxy-keto-oxadiazole-bridged-core', 'CCC1CC2(O)C(C)CC3=C(N=CO3)C1C2=O');
}

/**
 * Creates the compact N-acyl azabicyclo scaffold graph found in cyanoamide
 * cages like `O=C(C#N)N1CC2CC1C2`.
 * @returns {Molecule} Cyanoacyl azabicyclo scaffold template molecule.
 */
function createCyanoacylAzabicycloCoreTemplate() {
  return createRingSystemTemplateFromSmiles('cyanoacyl-azabicyclo-core', 'O=C(C#N)N1CC2CC1C2');
}

/**
 * Creates the aminonitrile acetal-bridged scaffold graph found in compact
 * heteroaryl-fused cages like `CC1NC2(C)CC1(OCOC1=C2C=CN1)C#N`.
 * @returns {Molecule} Aminonitrile acetal-bridged scaffold template molecule.
 */
function createAminonitrileAcetalBridgedCoreTemplate() {
  return createRingSystemTemplateFromSmiles('aminonitrile-acetal-bridged-core', 'CC1NC2(C)CC1(OCOC1=C2C=CN1)C#N');
}

/**
 * Creates the compact cyano formyl acetal scaffold graph found in saturated
 * bridged cages like `CC1CC2CC1(C#N)C1(COC(CO2)O1)C=O`.
 * @returns {Molecule} Cyano formyl acetal scaffold template molecule.
 */
function createCyanoFormylAcetalBridgedCoreTemplate() {
  return createRingSystemTemplateFromSmiles('cyano-formyl-acetal-bridged-core', 'CC1CC2CC1(C#N)C1(COC(CO2)O1)C=O');
}

/**
 * Creates the compact aminonitrile oxabicyclobutane scaffold graph found in
 * small ether-bridged cages like `CCC12CC(C1)(OC2C[NH3+])C(N)C#N`.
 * @returns {Molecule} Aminonitrile oxabicyclobutane scaffold template molecule.
 */
function createAminonitrileOxabicyclobutaneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('aminonitrile-oxabicyclobutane-core', 'CCC12CC(C1)(OC2C[NH3+])C(N)C#N');
}

/**
 * Creates the ammonium cyanomethyl oxatricyclo scaffold graph found in
 * compact bridged ether cages like `[NH3+]C1(CC#N)CC23CC(O2)C1C3`.
 * @returns {Molecule} Ammonium cyanomethyl oxatricyclo scaffold template molecule.
 */
function createAmmoniumCyanomethylOxatricycloCoreTemplate() {
  return createRingSystemTemplateFromSmiles('ammonium-cyanomethyl-oxatricyclo-core', '[NH3+]C1(CC#N)CC23CC(O2)C1C3');
}

/**
 * Creates the amino pyrimidine-cyclobutane scaffold graph found in compact
 * fused heterocycles like `CC(C[NH3+])OC1=NC(N)=C2C3CC(C3)N12`.
 * @returns {Molecule} Amino pyrimidine-cyclobutane scaffold template molecule.
 */
function createAminoPyrimidineCyclobutaneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('amino-pyrimidine-cyclobutane-core', 'CC(C[NH3+])OC1=NC(N)=C2C3CC(C3)N12');
}

/**
 * Creates the methyl azabicyclo cyclobutanone scaffold graph found in compact
 * ketone cages like `CC1CCCC23CC([NH+]1C2)C3=O`.
 * @returns {Molecule} Methyl azabicyclo cyclobutanone scaffold template molecule.
 */
function createMethylAzabicycloCyclobutanoneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('methyl-azabicyclo-cyclobutanone-core', 'CC1CCCC23CC([NH+]1C2)C3=O');
}

/**
 * Creates the methyl imino oxatricyclo scaffold graph found in compact
 * bridged iminium cages like `CN1CC23CC(C2)OC3C1=[NH2+]`.
 * @returns {Molecule} Methyl imino oxatricyclo scaffold template molecule.
 */
function createMethylIminoOxatricycloCoreTemplate() {
  return createRingSystemTemplateFromSmiles('methyl-imino-oxatricyclo-core', 'CN1CC23CC(C2)OC3C1=[NH2+]');
}

/**
 * Creates the N-methyl lactam diazatricyclo scaffold found in compact
 * ammonium-lactam cages with two fused five-member lanes around an aza ring.
 * @returns {Molecule} N-methyl lactam diazatricyclo scaffold template molecule.
 */
function createNMethylLactamDiazatricycloCoreTemplate() {
  return createRingSystemTemplateFromSmiles('n-methyl-lactam-diaza-tricyclo-core', 'CN1CCC2C3NC(=O)C2([NH3+])CC13');
}

/**
 * Creates the protonated cyclobutyl-pyrrolidine scaffold found in compact
 * ammonium bicyclic cores with a shared cyclobutane edge.
 * @returns {Molecule} Ammonium cyclobutyl-pyrrolidine scaffold template molecule.
 */
function createAmmoniumCyclobutylPyrrolidineCoreTemplate() {
  return createRingSystemTemplateFromSmiles('ammonium-cyclobutyl-pyrrolidine-core', 'C12CC(C1)C[NH2+]2');
}

/**
 * Creates the neutral azabicyclo-pyrrolidine scaffold found in compact
 * aminonitrile-substituted bicyclic amines with a shared aza bridgehead.
 * @returns {Molecule} Azabicyclo-pyrrolidine scaffold template molecule.
 */
function createAzabicycloPyrrolidineCoreTemplate() {
  return createRingSystemTemplateFromSmiles('azabicyclo-pyrrolidine-core', 'C12CN(C1)CC2');
}

/**
 * Creates the shared-edge tricyclic ether scaffold found in compact saturated
 * ether cages with one large oxacycle and paired five-member carbon lanes.
 * @returns {Molecule} Shared-edge tricyclic ether scaffold template molecule.
 */
function createSharedEdgeTricyclicEtherCoreTemplate() {
  return createRingSystemTemplateFromSmiles('shared-edge-tricyclic-ether-core', 'CC1COCCCC23CCCC12CCC3');
}

/**
 * Creates the substituted bicyclo[2.1.1]hexane scaffold found in compact
 * cyanomethyl azetidinium cages with a shared cyclobutane edge.
 * @returns {Molecule} Bicyclo[2.1.1]hexane scaffold template molecule.
 */
function createSubstitutedBicyclo211HexaneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('substituted-bicyclo-2-1-1-hexane-core', 'C12CC(C1)CC2');
}

/**
 * Creates the bicyclo[2.1.1]hexane scaffold found when the bridgehead carries
 * a trigonal carbon exit, such as a formyl or acyl substituent.
 * @returns {Molecule} Trigonal-carbon bicyclo[2.1.1]hexane scaffold template molecule.
 */
function createTrigonalCarbonBicyclo211HexaneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('trigonal-carbon-bicyclo-2-1-1-hexane-core', 'C12CC(C1)CC2');
}

/**
 * Creates the cyclopropane-capped azacyclooctane scaffold graph found in
 * compact ammonium cages with a fused cyclopentane lane.
 * @returns {Molecule} Cyclopropane-capped azacyclooctane scaffold template molecule.
 */
function createCyclopropaneAzacyclooctaneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('cyclopropane-azacyclooctane-core', 'CC1C2CC3(CC3)C1C(C)C[NH2+]C(C)(C)C2');
}

/**
 * Creates the hydroxy aminopropyl cyclobutane-decalin scaffold graph found in
 * compact saturated cages with a fused cyclobutane cap.
 * @returns {Molecule} Hydroxy aminopropyl cyclobutane-decalin scaffold template molecule.
 */
function createHydroxyAminopropylCyclobutaneDecalinCoreTemplate() {
  return createRingSystemTemplateFromSmiles('hydroxy-aminopropyl-cyclobutane-decalin-core', 'CC1CC2(C1)CC1(O)CCC2C(CC[NH3+])C1');
}

/**
 * Creates the compact aminomethyl oxabicyclobutane scaffold graph found in
 * small ammonium ether cages like `CCC12CC(O1)C2C[NH3+]`.
 * @returns {Molecule} Aminomethyl oxabicyclobutane scaffold template molecule.
 */
function createAminomethylOxabicyclobutaneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('aminomethyl-oxabicyclobutane-core', 'CCC12CC(O1)C2C[NH3+]');
}

/**
 * Creates the compact cyclopropane-capped azabicyclic enone scaffold graph
 * found in bridged ring systems like `CCOCC1=CC(=O)C2CCNC1C1CC21`.
 * @returns {Molecule} Cyclopropane-capped azabicyclic enone scaffold template molecule.
 */
function createCyclopropaneAzabicyclicEnoneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('cyclopropane-azabicyclic-enone-core', 'CCOCC1=CC(=O)C2CCNC1C1CC21');
}

/**
 * Creates the compact hydroxy aminomethyl bicyclic ketone scaffold graph found
 * in ammonium-substituted hydroxy ketone cages like
 * `C[NH2+]CC12CC(O)(C1)C(=O)C2`.
 * @returns {Molecule} Hydroxy aminomethyl bicyclic ketone scaffold template molecule.
 */
function createHydroxyAminomethylBicycloKetoneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('hydroxy-aminomethyl-bicyclo-ketone-core', 'C[NH2+]CC12CC(O)(C1)C(=O)C2');
}

/**
 * Creates the compact hydroxy amino oxabicyclic acetal scaffold graph found in
 * polyhydroxy amino cages like `CC(O)C(O)C1C2COC(C2(C)O)C1(N)CO`.
 * @returns {Molecule} Hydroxy amino oxabicyclic acetal scaffold template molecule.
 */
function createHydroxyAminoOxabicyclicAcetalCoreTemplate() {
  return createRingSystemTemplateFromSmiles('hydroxy-amino-oxabicyclic-acetal-core', 'CC(O)C(O)C1C2COC(C2(C)O)C1(N)CO');
}

/**
 * Creates the aryl phosphite spiro scaffold graph found in compact
 * polyaryl-phosphite bridged systems like
 * `COP1OC2=CC=CC3=C2C2(C4=CC=CC=C4OC4=CC=CC(O1)=C24)C1=CC=CC=C1O3`.
 * @returns {Molecule} Aryl phosphite spiro scaffold template molecule.
 */
function createArylPhosphiteSpiroCoreTemplate() {
  return createRingSystemTemplateFromSmiles(
    'aryl-phosphite-spiro-core',
    'COP1OC2=CC=CC3=C2C2(C4=CC=CC=C4OC4=CC=CC(O1)=C24)C1=CC=CC=C1O3'
  );
}

/**
 * Creates the compact imino oxazocine lactam scaffold graph found in bridged
 * formamido lactams like `CC1CN=C(NC=O)C2CCC1NC(=O)CO2`.
 * @returns {Molecule} Imino oxazocine lactam scaffold template molecule.
 */
function createIminoOxazocineLactamCoreTemplate() {
  return createRingSystemTemplateFromSmiles('imino-oxazocine-lactam-core', 'CC1CN=C(NC=O)C2CCC1NC(=O)CO2');
}

/**
 * Creates the compact alkylidene oxime bicyclohexane scaffold graph found in
 * methyl-substituted theta cores like `CC(C)C(=NO)C1CC2(C)CC1C2`.
 * @returns {Molecule} Alkylidene oxime bicyclohexane scaffold template molecule.
 */
function createAlkylideneOximeBicyclohexaneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('alkylidene-oxime-bicyclohexane-core', 'CC(C)C(=NO)C1CC2(C)CC1C2');
}

/**
 * Creates the compact ammonium azabicyclo nitrile scaffold graph found in
 * gem-substituted cages like `C[NH+]1C2CCC1C2(C)CC#N`.
 * @returns {Molecule} Azabicyclo nitrile scaffold template molecule.
 */
function createAzabicycloNitrileCoreTemplate() {
  return createRingSystemTemplateFromSmiles('azabicyclo-nitrile-core', 'C[NH+]1C2CCC1C2(C)CC#N');
}

/**
 * Creates the compact bridged decalin-lactam scaffold graph found in
 * substituted bicyclic amides like `CC1CC(C)C2(C)CCC1CC(=O)N2CC[NH3+]`.
 * @returns {Molecule} Bridged decalin lactam scaffold template molecule.
 */
function createBridgedDecalinLactamCoreTemplate() {
  return createRingSystemTemplateFromSmiles('bridged-decalin-lactam-core', 'CC1CC(C)C2(C)CCC1CC(=O)N2CC[NH3+]');
}

/**
 * Creates the compact bridged oxadecalin scaffold graph found in
 * gem-dimethyl hydroxyethyl ethers like `CC1CC2COC(C)C(C1)C(C)(C)C2CCO`.
 * @returns {Molecule} Bridged oxadecalin scaffold template molecule.
 */
function createBridgedOxadecalinCoreTemplate() {
  return createRingSystemTemplateFromSmiles('bridged-oxadecalin-core', 'CC1CC2COC(C)C(C1)C(C)(C)C2CCO');
}

/**
 * Creates the compact hydroxy acetal oxadecalin scaffold graph found in
 * tricyclic ether cages like `CC1CC2C(O)C(C1)C1OCCOC2CC1C`.
 * @returns {Molecule} Hydroxy acetal oxadecalin scaffold template molecule.
 */
function createHydroxyAcetalOxadecalinCoreTemplate() {
  return createRingSystemTemplateFromSmiles('hydroxy-acetal-oxadecalin-core', 'CC1CC2C(O)C(C1)C1OCCOC2CC1C');
}

/**
 * Creates the compact formyl aza-oxatricyclo scaffold graph found in
 * N-formyl amine-oxirane cages like `CN1CC2CCC3(CO3)C(C1)CN2C=O`.
 * @returns {Molecule} Formyl aza-oxatricyclo scaffold template molecule.
 */
function createFormylAzaOxatricycloCoreTemplate() {
  return createRingSystemTemplateFromSmiles('formyl-aza-oxatricyclo-core', 'CN1CC2CCC3(CO3)C(C1)CN2C=O');
}

/**
 * Creates the methyl aza-oxa tricyclic scaffold graph found in compact
 * saturated amine-ether cages like `CC1CCC2NC(C)C3CC(CO3)C1CC2C`.
 * @returns {Molecule} Methyl aza-oxa tricyclic scaffold template molecule.
 */
function createMethylAzaOxaTricyclicCoreTemplate() {
  return createRingSystemTemplateFromSmiles('methyl-aza-oxa-tricyclic-core', 'CC1CCC2NC(C)C3CC(CO3)C1CC2C');
}

/**
 * Creates the ethyl dioxatricyclo oxetane scaffold graph found in compact
 * ether cages like `CCC12OCC11CC2CO1`.
 * @returns {Molecule} Ethyl dioxatricyclo oxetane scaffold template molecule.
 */
function createEthylDioxatricycloOxetaneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('ethyl-dioxatricyclo-oxetane-core', 'CCC12OCC11CC2CO1');
}

/**
 * Creates the hydroxy azatricyclo cyclohexene scaffold graph found in compact
 * hydroxy and aminomethyl substituted azatricyclic cages like
 * `CN1C2CC3C=C(CN)CC(C12)C3O`.
 * @returns {Molecule} Hydroxy azatricyclo cyclohexene scaffold template molecule.
 */
function createHydroxyAzatricycloCyclohexeneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('hydroxy-azatricyclo-cyclohexene-core', 'CN1C2CC3C=C(CN)CC(C12)C3O');
}

/**
 * Creates the imino oxa azatricyclo ketone scaffold graph found in compact
 * bridged imine-ketone cages like `CN1CCC2(C)CCOC=NC(CO2)C(=O)C1`.
 * @returns {Molecule} Imino oxa azatricyclo ketone scaffold template molecule.
 */
function createIminoOxaAzatricycloKetoneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('imino-oxa-azatricyclo-ketone-core', 'CN1CCC2(C)CCOC=NC(CO2)C(=O)C1');
}

/**
 * Creates the cyclopropyl lactam pentacycle scaffold graph found in compact
 * enone-lactam cages like `CC1C2C=C3C4C2C42C(CC(=O)N12)C3C=O`.
 * @returns {Molecule} Cyclopropyl lactam pentacycle scaffold template molecule.
 */
function createCyclopropylLactamPentacycleCoreTemplate() {
  return createRingSystemTemplateFromSmiles('cyclopropyl-lactam-pentacycle-core', 'CC1C2C=C3C4C2C42C(CC(=O)N12)C3C=O');
}

/**
 * Creates the ammonium benzocyclobutane scaffold graph found in compact
 * aromatic cyclobutane-fused cages like `CC1=CC=CC2=C1C1([NH3+])CC2(C)C1`.
 * @returns {Molecule} Ammonium benzocyclobutane scaffold template molecule.
 */
function createAmmoniumBenzocyclobutaneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('ammonium-benzocyclobutane-core', 'CC1=CC=CC2=C1C1([NH3+])CC2(C)C1');
}

/**
 * Creates the dimethyl oxatricyclo cage scaffold graph found in compact ether
 * cages like `CC12CC3CCC1C3(C)CO2`.
 * @returns {Molecule} Dimethyl oxatricyclo cage scaffold template molecule.
 */
function createDimethylOxatricycloCageCoreTemplate() {
  return createRingSystemTemplateFromSmiles('dimethyl-oxatricyclo-cage-core', 'CC12CC3CCC1C3(C)CO2');
}

/**
 * Creates the hydroxy dimethyl oxatricyclo cage scaffold graph found in
 * compact alcohol-substituted ether cages like `CC1(C)CC2CC3(C2)COC1C3O`.
 * @returns {Molecule} Hydroxy dimethyl oxatricyclo cage scaffold template molecule.
 */
function createHydroxyDimethylOxatricycloCageCoreTemplate() {
  return createRingSystemTemplateFromSmiles('hydroxy-dimethyl-oxatricyclo-cage-core', 'CC1(C)CC2CC3(C2)COC1C3O');
}

/**
 * Creates the hydroxy oxatricyclo diol scaffold graph found in compact
 * alcohol-substituted ether cages like `OC12CCC(O)(C1)C1CC2O1`.
 * @returns {Molecule} Hydroxy oxatricyclo diol scaffold template molecule.
 */
function createHydroxyOxatricycloDiolCoreTemplate() {
  return createRingSystemTemplateFromSmiles('hydroxy-oxatricyclo-diol-core', 'OC12CCC(O)(C1)C1CC2O1');
}

/**
 * Creates the cyclobutane-capped oxadecalin scaffold graph found in compact
 * tricyclic ethers like `CC1CC2(C1)C(C)CC1CCCC2CCO1`.
 * @returns {Molecule} Cyclobutane oxadecalin scaffold template molecule.
 */
function createCyclobutaneOxadecalinCoreTemplate() {
  return createRingSystemTemplateFromSmiles('cyclobutane-oxadecalin-core', 'CC1CC2(C1)C(C)CC1CCCC2CCO1');
}

/**
 * Creates the compact bridged pyrrolizidine dione scaffold graph found in
 * tricyclic enone lactam-like cores such as
 * `C\C=C\C=C\C(=O)C1=C(O)[C@@]2(C)[C@H]3CCCN3[C@@H]1[C@](C)(O)C2=O`.
 * @returns {Molecule} Bridged pyrrolizidine dione scaffold template molecule.
 */
function createBridgedPyrrolizidineDioneCoreTemplate() {
  return createRingSystemTemplateFromSmiles(
    'bridged-pyrrolizidine-dione-core',
    String.raw`C\C=C\C=C\C(=O)C1=C(O)[C@@]2(C)[C@H]3CCCN3[C@@H]1[C@](C)(O)C2=O`
  );
}

/**
 * Creates the acetal amino decalin scaffold graph found in ester-substituted
 * tricyclic saturated cores like
 * `COC(OC)[C@@]12CC[C@@H]3CCCC3(C1)[C@@H](N[C@@H]2C(=O)OC)C(=O)OC`.
 * @returns {Molecule} Acetal amino decalin scaffold template molecule.
 */
function createAcetalAminoDecalinCoreTemplate() {
  return createRingSystemTemplateFromSmiles(
    'acetal-amino-decalin-core',
    'COC(OC)[C@@]12CC[C@@H]3CCCC3(C1)[C@@H](N[C@@H]2C(=O)OC)C(=O)OC'
  );
}

/**
 * Creates the amino oxaza tricyclic scaffold graph found in compact
 * cyclopropylamine-fused bridged cages like `CC1=C2C(OC1)C1(N)C3NC3C2CC1N`.
 * @returns {Molecule} Amino oxaza tricyclo scaffold template molecule.
 */
function createAminoOxazaTricycloCoreTemplate() {
  return createRingSystemTemplateFromSmiles('amino-oxaza-tricyclo-core', 'CC1=C2C(OC1)C1(N)C3NC3C2CC1N');
}

/**
 * Creates the compact aza-oxa cyclopropyl oxetane scaffold graph found in
 * propyl-substituted tetracyclic cages like `CCCC1C2C3N2CC(O)C32OCC12`.
 * @returns {Molecule} Aza-oxa cyclopropyl oxetane scaffold template molecule.
 */
function createAzaOxaCyclopropylOxetaneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('aza-oxa-cyclopropyl-oxetane-core', 'CCCC1C2C3N2CC(O)C32OCC12');
}

/**
 * Creates the amino diaza tricyclic scaffold graph found in compact imine and
 * alcohol-substituted bridged cages like `CC1CC(O)C2CNC(=N)C1C1(C)NC=NC21`.
 * @returns {Molecule} Amino diaza tricyclo scaffold template molecule.
 */
function createAminoDiazaTricycloCoreTemplate() {
  return createRingSystemTemplateFromSmiles('amino-diaza-tricyclo-core', 'CC1CC(O)C2CNC(=N)C1C1(C)NC=NC21');
}

/**
 * Creates the imino thiazole-fused oxaza tricyclic scaffold graph found in
 * compact heteroaryl cages like `CC1C23COC(=N)C12NCC1=C3N=C(C)S1`.
 * @returns {Molecule} Imino thiazole oxaza tricyclo scaffold template molecule.
 */
function createIminoThiazoleOxazaTricycloCoreTemplate() {
  return createRingSystemTemplateFromSmiles('imino-thiazole-oxaza-tricyclo-core', 'CC1C23COC(=N)C12NCC1=C3N=C(C)S1');
}

/**
 * Creates the amino cyano thiazole-fused oxatricyclo scaffold graph found in
 * compact heteroaryl ether cages like `CC12CCC(C3=NSC=C3O1)C(C)(C#N)C2N`.
 * @returns {Molecule} Amino cyano thiazole oxatricyclo scaffold template molecule.
 */
function createAminoCyanoThiazoleOxatricycloCoreTemplate() {
  return createRingSystemTemplateFromSmiles('amino-cyano-thiazole-oxatricyclo-core', 'CC12CCC(C3=NSC=C3O1)C(C)(C#N)C2N');
}

/**
 * Creates the aza-annulene cyclohexadiene scaffold graph found in substituted
 * bridged indolizine-like ring systems such as `CCC1=NC(N)=CC(C)=CC=C2NC=CC1=C2`.
 * @returns {Molecule} Aza-annulene cyclohexadiene scaffold template molecule.
 */
function createAzaAnnuleneCyclohexadieneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('aza-annulene-cyclohexadiene-core', 'CCC1=NC(N)=CC(C)=CC=C2NC=CC1=C2');
}

/**
 * Creates the bridged cyclopropyl-decalin scaffold graph found in compact
 * cyclopropane-fused carbocages like `COC12CCC(CC11CC1)CCCCCC2`.
 * @returns {Molecule} Bridged cyclopropyl-decalin scaffold template molecule.
 */
function createBridgedCyclopropylDecalinCoreTemplate() {
  return createRingSystemTemplateFromSmiles('bridged-cyclopropyl-decalin-core', 'COC12CCC(CC11CC1)CCCCCC2');
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
 * Creates the compact sulfonyl-substituted azatricyclo cage scaffold found in
 * small charged cyclopropane-fused bridged systems.
 * @returns {Molecule} Sulfonyl azatricyclo cage scaffold template molecule.
 */
function createSulfonylAzatricycloCageTemplate() {
  return createRingSystemTemplateFromSmiles('sulfonyl-azatricyclo-cage', 'CC12C[NH+](C1)C1C2C1S([O-])(=O)=O');
}

/**
 * Creates the compact cyclopentenyl sulfone fused to an azocane ring found in
 * small aldehyde-substituted sulfone cages.
 * @returns {Molecule} Sulfonyl cyclopentenyl azocane scaffold template molecule.
 */
function createSulfonylCyclopentenylAzocaneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('sulfonyl-cyclopentenyl-azocane-core', 'CC1=C2CS(=O)(=O)C1C(CCNC2(C)C)C=O');
}

/**
 * Creates the compact hydroxy alkyl bicyclohexene scaffold graph found in
 * dimethylamino-substituted bicyclic alcohols.
 * @returns {Molecule} Hydroxy alkyl bicyclohexene scaffold template molecule.
 */
function createHydroxyAlkylBicyclohexeneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('hydroxy-alkyl-bicyclohexene-core', 'CCC1(O)C2C(CN(C)C)C1(CC)C=C2C');
}

/**
 * Creates the oxime lactam cyclopentenyl scaffold graph found in compact
 * bridged enone-oxime beta-lactam systems.
 * @returns {Molecule} Oxime lactam cyclopentenyl scaffold template molecule.
 */
function createOximeLactamCyclopentenylCoreTemplate() {
  return createRingSystemTemplateFromSmiles('oxime-lactam-cyclopentenyl-core', 'CC1C2CC=C1C(=NO)C(C)C1N(CC1=O)C2');
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
 * Creates the compact cyclobutane-fused thiophene scaffold graph found in
 * ethyl-substituted sulfur cages like `CCC1=C2C3CC(CC)(C3)C2=CS1`.
 * @returns {Molecule} Cyclobutane thiophene scaffold template molecule.
 */
function createCyclobutaneThiopheneCoreTemplate() {
  return createRingSystemTemplateFromSmiles('cyclobutane-thiophene-core', 'CCC1=C2C3CC(CC)(C3)C2=CS1');
}

/**
 * Creates the oxygen-bridged bisindole lactam core found in densely fused
 * indolocarbazole-like scaffolds with a small oxygen bridge across one edge.
 * @returns {Molecule} Oxygen-bridged bisindole lactam scaffold template molecule.
 */
function createOxygenBridgedBisindoleLactamCoreTemplate() {
  return createRingSystemTemplateFromSmiles(
    'oxygen-bridged-bisindole-lactam-core',
    '[H][C@@]12C[C@H](C(=O)OOC)[C@](C)(O1)N1C3=C(C=C(CSCC)C=C3)C3=C4CNC(=O)C4=C4C5=C(C=CC(CSCC)=C5)N2C4=C13'
  );
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
 * Creates the saturated four-ring morphinan scaffold graph found in compact
 * aza-bridged phenanthrene cores.
 * @returns {Molecule} Saturated morphinan-style ring-system template molecule.
 */
function createSaturatedMorphinanCoreTemplate() {
  return createRingSystemTemplateFromSmiles('saturated-morphinan-core', '[H][C@@]12CCCC[C@@]11CCN(CC=C)[C@@H]2CC2=C1C=C(O)C=C2');
}

/**
 * Creates the larger oripavine-style morphinan core with the oxygen bridge and
 * bicyclic saturated ring found in buprenorphine-like scaffolds.
 * @returns {Molecule} Oripavine-style ring-system template molecule.
 */
function createOripavineCoreTemplate() {
  return createRingSystemTemplateFromSmiles(
    'oripavine-core',
    '[H][C@@]12OC3=C(O)C=CC4=C3[C@@]11CCN(CC3CC3)[C@]([H])(C4)[C@]11CC[C@@]2(OC)[C@H](C1)C(C)(C)O'
  );
}

/**
 * Creates the oxygen-bridged aza-morphinan cyclohexadienone core found in
 * highly substituted naloxone/naltrexone-like scaffolds.
 * @returns {Molecule} Oxygen-bridged aza-morphinan ring-system template molecule.
 */
function createOxazaMorphinanCoreTemplate() {
  return createRingSystemTemplateFromSmiles(
    'oxaza-morphinan-core',
    'COC1(NC(=O)C(=CC2=CC=CC=C2)C(F)(F)F)C=C(O)C2=C3C1OC1CCCC4C(C2)[N+](CC2CC2)(CCC314)C(C)C'
  );
}

/**
 * Creates the phenolic oxygen-bridged aza-morphinan core found in
 * naloxone-like cages where the benzene ring is retained next to an ether
 * bridge and saturated aza lane.
 * @returns {Molecule} Phenolic oxygen-bridged aza-morphinan ring-system template molecule.
 */
function createPhenolicOxazaMorphinanCoreTemplate() {
  return createRingSystemTemplateFromSmiles(
    'phenolic-oxaza-morphinan-core',
    'O[C@H]1CC[C@@]2(O)[C@H]3CC4=CC=C(O)C5=C4[C@@]2(CCN3CC2CCC2)[C@H]1O5'
  );
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
 * Creates a calixarene-like bowl projection with regular aryl walls and
 * short methylene bridges between neighboring rings.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createCalixareneGuanidineCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C8', { x: 0, y: 2.8 }],
    ['C9', { x: 0.866025, y: 2.3 }],
    ['C10', { x: 1.583013, y: 1.583013 }],
    ['C11', { x: 2.3, y: 0.866025 }],
    ['C12', { x: 1.3, y: 0.866025 }],
    ['C13', { x: 0.8, y: 0 }],
    ['C14', { x: 1.3, y: -0.866025 }],
    ['C15', { x: 2.3, y: -0.866025 }],
    ['C16', { x: 1.583013, y: -1.583013 }],
    ['C17', { x: 0.866025, y: -2.3 }],
    ['C18', { x: 0.866025, y: -1.3 }],
    ['C19', { x: 0, y: -0.8 }],
    ['C20', { x: -0.866025, y: -1.3 }],
    ['C21', { x: -0.866025, y: -2.3 }],
    ['C22', { x: -1.583013, y: -1.583013 }],
    ['C23', { x: -2.3, y: -0.866025 }],
    ['C24', { x: -1.3, y: -0.866025 }],
    ['C25', { x: -0.8, y: 0 }],
    ['C26', { x: -1.3, y: 0.866025 }],
    ['C27', { x: -2.3, y: 0.866025 }],
    ['C28', { x: -1.583013, y: 1.583013 }],
    ['C29', { x: -0.866025, y: 2.3 }],
    ['C30', { x: -0.866025, y: 1.3 }],
    ['C31', { x: 0, y: 0.8 }],
    ['C32', { x: 0.866025, y: 1.3 }],
    ['C33', { x: -2.8, y: 0 }],
    ['C35', { x: 0, y: -2.8 }],
    ['C44', { x: 2.8, y: 0 }]
  ]);
}

/**
 * Creates a trans-polyene macrolide projection with the pyrrolidone and oxazole
 * fused rings kept regular while the macrocycle perimeter bends through
 * alternating alkene lanes that satisfy the three annotated E double bonds.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createTransPolyeneMacrolideGeometry() {
  return createCenteredFrozenGeometry([
    ['C4', { x: 9.852369, y: -0.65063 }],
    ['O6', { x: 9.470217, y: -1.575692 }],
    ['C7', { x: 8.894763, y: -2.394456 }],
    ['C9', { x: 8.201609, y: -3.116675 }],
    ['C10', { x: 8.799963, y: -3.91828 }],
    ['C11', { x: 8.222886, y: -4.735055 }],
    ['C12', { x: 7.267729, y: -4.438594 }],
    ['N13', { x: 7.254058, y: -3.438384 }],
    ['C14', { x: 6.277249, y: -3.21919 }],
    ['C16', { x: 5.329207, y: -2.898515 }],
    ['C17', { x: 5.684273, y: -1.963737 }],
    ['O18', { x: 4.905298, y: -1.336342 }],
    ['C19', { x: 4.067841, y: -1.882747 }],
    ['N20', { x: 4.329855, y: -2.848201 }],
    ['C21', { x: 3.636526, y: -0.979637 }],
    ['C22', { x: 3.396062, y: -0.008345 }],
    ['C24', { x: 3.367755, y: 0.991917 }],
    ['C25', { x: 3.575871, y: 1.970592 }],
    ['C28', { x: 4.167188, y: 2.777699 }],
    ['C29', { x: 4.68687, y: 3.632638 }],
    ['C31', { x: 5.544184, y: 4.148328 }],
    ['C32', { x: 6.544471, y: 4.166465 }],
    ['C33', { x: 7.540189, y: 4.264356 }],
    ['N34', { x: 8.453662, y: 3.856217 }],
    ['C35', { x: 9.179594, y: 3.167654 }],
    ['C37', { x: 9.536183, y: 2.232662 }],
    ['C38', { x: 9.98134, y: 1.336514 }],
    ['C39', { x: 10.017451, y: 0.336363 }]
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
 * Creates a non-crossing norbornane projection for amino acyl aryl substituted
 * stereochemical cages. The bridgehead paths are separated into upper and lower
 * arcs so the displayed bridgehead hydrogen can project into the outside face.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAminoAcylArylNorbornaneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C2', { x: -0.90445, y: -0.49554 }],
    ['C3', { x: -0.38185, y: -0.98584 }],
    ['C4', { x: 0.43262, y: -0.77445 }],
    ['C5', { x: 0.65421, y: -0.09178 }],
    ['C7', { x: -0.27815, y: 0.29028 }],
    ['C8', { x: 0.76839, y: -1.4395 }],
    ['C18', { x: -0.35147, y: -1.73069 }]
  ]);
}

/**
 * Creates a norbornene cage projection with the shared one-atom bridge lifted
 * out of the two outer paths. This prevents the central bridge atom from
 * collapsing into a straight line when the unsaturated path is attached as a
 * mixed child scaffold.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createNorborneneGeometry() {
  return createCenteredFrozenGeometry([
    ['a0', { x: -0.65, y: 0 }],
    ['a1', { x: 0.65, y: 0 }],
    ['a2', { x: -0.55, y: -1 }],
    ['a3', { x: 0.55, y: -1 }],
    ['a4', { x: -0.65, y: 1.05 }],
    ['a5', { x: 0.65, y: 1.05 }],
    ['a6', { x: 0, y: 0.75 }]
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
 * Creates a two-lane bicyclooctadiene projection for hydroxy diformyl cores.
 * The two alkene lanes sit above and below the saturated shared bridge so
 * aldehyde and alcohol exits can project outward without crossing ring bonds.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createHydroxyDiformylBicyclooctadieneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C7', { x: 0.0, y: -1.2 }],
    ['C12', { x: 0.0, y: 1.2 }],
    ['C8', { x: -0.95, y: -0.5 }],
    ['C11', { x: -0.95, y: 0.5 }],
    ['C14', { x: -0.35, y: -0.5 }],
    ['C13', { x: -0.35, y: 0.5 }],
    ['C5', { x: 0.8, y: -0.5 }],
    ['C4', { x: 0.8, y: 0.5 }]
  ]);
}

/**
 * Creates a split-lobe projection for alkenyl phenyl oxabicycloheptane cores.
 * The carbocycle lobe sits on one side of the shared three-atom bridge while
 * the ether lobe sits on the other, leaving the alkenyl and aryl exits outside
 * the compact cage instead of threading them through the ring face.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAlkenylPhenylOxabicycloheptaneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C12', { x: 0.503, y: 0.795 }],
    ['C13', { x: -0.782, y: 0.514 }],
    ['C14', { x: -0.946, y: -0.488 }],
    ['C15', { x: -0.058, y: -0.941 }],
    ['C16', { x: 0.421, y: -0.399 }],
    ['O17', { x: -0.08, y: 0.583 }],
    ['C18', { x: 0.943, y: -0.065 }]
  ]);
}

/**
 * Creates a broad five-ring cage projection for oxygenated lactone steroids.
 * The left decalin lobe and right lactone lobe are separated by the central
 * C4-C8-C12-C23-C25 bridge so the fused six-rings remain recognizable instead
 * of being flattened into one compact tangle.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createCagedHydroxyLactoneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C2', { x: -2.058559, y: -0.728619 }],
    ['C3', { x: -1.511418, y: -0.234759 }],
    ['C4', { x: -0.815283, y: -0.383528 }],
    ['C5', { x: -0.772924, y: -1.391128 }],
    ['C6', { x: -1.602098, y: -1.598035 }],
    ['C8', { x: -0.596352, y: 0.425993 }],
    ['C10', { x: -1.832147, y: 0.972438 }],
    ['C11', { x: -2.653825, y: -0.104642 }],
    ['C12', { x: 0.406603, y: 0.455854 }],
    ['C13', { x: 1.329074, y: 1.465429 }],
    ['C14', { x: 2.520000, y: 1.250000 }],
    ['C15', { x: 2.750000, y: 0.110000 }],
    ['C18', { x: 1.648680, y: -0.427585 }],
    ['C20', { x: 1.718060, y: 0.272484 }],
    ['O22', { x: 1.100000, y: 0.650000 }],
    ['C23', { x: 0.665153, y: -0.329353 }],
    ['C25', { x: -0.039519, y: -0.899416 }]
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
 * Creates a charged quinuclidinium projection with the three ethylene bridges
 * separated enough that neither six-membered ring collapses at the bridgeheads.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createQuinuclidiniumGeometry() {
  return createCenteredFrozenGeometry([
    ['N1', { x: -0.5856, y: 0.8679 }],
    ['C2', { x: 0.5538, y: 0.7243 }],
    ['C3', { x: 1.2977, y: -0.1971 }],
    ['C4', { x: 0.4142, y: -0.8954 }],
    ['C5', { x: -0.7714, y: -0.664 }],
    ['C6', { x: -1.4, y: 0.25 }],
    ['C7', { x: 0.5941, y: -0.0651 }],
    ['C8', { x: -0.1695, y: 0.0421 }]
  ]);
}

/**
 * Creates an exposed-nitrogen projection for diazatricyclodecane cages. The
 * adamantane-like carbon frame is opened into two broad outer lanes so both
 * bridge nitrogens can carry exocyclic substituents without collapsing into
 * the cage face.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createDiazatricyclodecaneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['N1', { x: -1.25, y: 0.0 }],
    ['C2', { x: -0.7, y: -0.7 }],
    ['C3', { x: 0.0, y: -1.05 }],
    ['C4', { x: 0.7, y: -0.7 }],
    ['C5', { x: 0.2, y: -0.2 }],
    ['C6', { x: -0.7, y: 0.7 }],
    ['C7', { x: 0.0, y: 1.05 }],
    ['C8', { x: 0.7, y: 0.7 }],
    ['C9', { x: -0.2, y: 0.2 }],
    ['N10', { x: 1.25, y: 0.0 }]
  ]);
}

/**
 * Creates a planar triazaadamantane cage projection. The unique carbon
 * bridgehead is placed on the exposed left corner while the three nitrogen
 * bridgeheads form the other K4 vertices, keeping the subdivided cage edges
 * from crossing in compact thiourea-substituted depictions.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createTriazaadamantaneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C1', { x: -1.55, y: 0.0 }],
    ['C2', { x: -0.55, y: -0.88 }],
    ['N3', { x: 0.8, y: -1.15 }],
    ['C4', { x: 1.05, y: 0.0 }],
    ['N5', { x: 0.8, y: 1.15 }],
    ['C6', { x: 0.4, y: 0.575 }],
    ['N7', { x: 0.0, y: 0.0 }],
    ['C8', { x: 0.4, y: -0.575 }],
    ['C9', { x: -0.775, y: 0.0 }],
    ['C10', { x: -0.55, y: 0.88 }]
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
 * Creates a theta-style bridged lactone projection with the six-membered
 * lactone ring above the carbon bridge and the longer carbocycle opened below.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createBridgedLactoneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C12', { x: 0, y: 0 }],
    ['C17', { x: 0.5, y: 0.866025 }],
    ['O16', { x: 1.5, y: 0.866025 }],
    ['C15', { x: 2, y: 0 }],
    ['C14', { x: 1.5, y: -0.866025 }],
    ['C13', { x: 0.5, y: -0.866025 }],
    ['C11', { x: -0.15, y: -1.05 }],
    ['C10', { x: 1, y: -1.55 }],
    ['C9', { x: 2.15, y: -1.05 }]
  ]);
}

/**
 * Creates a three-lane projection for compact oxazabicyclic lactam cages. The
 * lactam carbonyl lane sits above the shared bridge, the ether lane stays open
 * through the middle, and the gem-substituted carbon lane opens below.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createOxazabicyclicLactamCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C7', { x: 0, y: 0 }],
    ['C10', { x: 2.3, y: 0 }],
    ['C8', { x: 0.65, y: 0.5 }],
    ['O9', { x: 1.65, y: 0.5 }],
    ['N13', { x: 0.65, y: 1.08 }],
    ['C11', { x: 1.65, y: 1.08 }],
    ['C6', { x: 0.65, y: -1.08 }],
    ['C2', { x: 1.65, y: -1.08 }]
  ]);
}

/**
 * Creates a compact theta projection for hydroxy oxazabicyclic lactam cages.
 * The one-carbon hydroxy bridge sits above the bridgehead pair, while the
 * lactam and ether paths stay in separated lower lanes so the terminal alcohol
 * can point outward without landing on the ring nitrogen.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createHydroxyOxazabicyclicLactamCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C3', { x: -0.85, y: 0.0 }],
    ['C8', { x: 0.85, y: 0.0 }],
    ['C2', { x: 0.0, y: 1.0 }],
    ['O9', { x: 0.0, y: -0.3 }],
    ['C4', { x: -1.1, y: -1.05 }],
    ['N5', { x: 0.0, y: -1.65 }],
    ['C6', { x: 1.1, y: -1.05 }]
  ]);
}

/**
 * Creates a compact theta-like projection for the azabicyclic ketone cage. The
 * carbonyl bridge carbon and ammonium span stay below the shared path while
 * the oxadiazole exit atom gets a clean exterior side.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAzabicycloKetoneOxadiazoleCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C2', { x: -0.00084, y: -0.219462 }],
    ['C3', { x: -0.776375, y: 0.308365 }],
    ['C4', { x: -0.529669, y: -0.674974 }],
    ['N5', { x: 0.532141, y: -0.679035 }],
    ['C7', { x: 0.77513, y: 0.308365 }],
    ['C8', { x: -0.000388, y: 0.956742 }]
  ]);
}

/**
 * Creates a separated-lane projection for hydroxy keto oxadiazole bridged
 * cores. The oxadiazole stays on a regular right-hand five-ring while the
 * carbonyl-bearing cyclopentane lane is drawn below the bridge so the carbonyl
 * substituent exits the ring system instead of pointing through its interior.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createHydroxyKetoOxadiazoleBridgedCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C7', { x: -0.710814, y: -1.377908 }],
    ['C9', { x: -1.245471, y: -0.542765 }],
    ['C10', { x: -0.899583, y: 0.406226 }],
    ['C11', { x: 0.06205, y: 0.697527 }],
    ['C15', { x: 0.892287, y: 0.113545 }],
    ['C16', { x: 0.906042, y: -0.776282 }],
    ['C5', { x: 0.282233, y: -1.415059 }],
    ['C4', { x: 1.374115, y: -1.649521 }],
    ['C3', { x: 1.831031, y: -0.498786 }],
    ['O14', { x: -1.466726, y: 1.231398 }],
    ['C13', { x: -0.87615, y: 2.032299 }],
    ['N12', { x: 0.085839, y: 1.707631 }]
  ]);
}

/**
 * Creates a three-lane projection for compact N-acyl azabicyclo cages. The
 * shared bridgeheads stay apart, the cyclobutyl cap reads as a diamond, and the
 * amide-bearing nitrogen sits on the exterior lower lane.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createCyanoacylAzabicycloCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C9', { x: -0.725, y: 0 }],
    ['C10', { x: 0, y: 0.7 }],
    ['C7', { x: 0.725, y: 0 }],
    ['C8', { x: 0, y: -0.575 }],
    ['N5', { x: -0.6, y: -1.15 }],
    ['C6', { x: 0.6, y: -1.15 }]
  ]);
}

/**
 * Creates a structured projection for the aminonitrile acetal-bridged core. The
 * saturated N-ring stays below the acetal bridge, the OCO arc remains open, and
 * the fused heteroaryl ring sits as a regular exterior cap.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAminonitrileAcetalBridgedCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C13', { x: 1.563574, y: -0.947245 }],
    ['C14', { x: 2.301577, y: -0.253377 }],
    ['C6', { x: -0.605, y: -0.005216 }],
    ['C9', { x: -1.075598, y: 1.515185 }],
    ['C12', { x: 0.690625, y: -0.470327 }],
    ['C11', { x: 0.888029, y: 0.549241 }],
    ['C2', { x: -1.644495, y: -1.027484 }],
    ['C4', { x: -0.124809, y: -0.694025 }],
    ['C7', { x: -1.444801, y: -0.054079 }],
    ['N3', { x: -0.766244, y: -1.45361 }],
    ['N15', { x: 1.875901, y: 0.665842 }],
    ['O10', { x: 0.111703, y: 1.450716 }],
    ['O8', { x: -1.770462, y: 0.724378 }]
  ]);
}

/**
 * Creates a compact three-lane projection for cyano formyl acetal bridged
 * cages. The carbocycle stays regular on the left, the acetal five-ring opens
 * on the right, and the larger OCO bridge arcs below the shared center.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createCyanoFormylAcetalBridgedCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C3', { x: -0.69666, y: -1.103136 }],
    ['C5', { x: -1.409109, y: 0.215257 }],
    ['C13', { x: 1.06558, y: -0.808298 }],
    ['C10', { x: 0.577654, y: 1.601828 }],
    ['C2', { x: -0.151298, y: -0.4786 }],
    ['C4', { x: -1.448696, y: -0.810506 }],
    ['C12', { x: 1.139069, y: 0.158409 }],
    ['C6', { x: -0.675271, y: 0.390862 }],
    ['C9', { x: -0.067217, y: 0.831806 }],
    ['O14', { x: -0.164834, y: -1.320022 }],
    ['O11', { x: 1.403531, y: 1.038351 }],
    ['O15', { x: 0.427252, y: 0.28405 }]
  ]);
}

/**
 * Creates a compact projection for aminonitrile oxabicyclobutane cages. The
 * shared two-bond bridge sits above the carbon cap while the ether arc stays on
 * the lower lane, preventing the four-member ring from stretching across the
 * five-member ether ring.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAminonitrileOxabicyclobutaneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C3', { x: -0.742169, y: 0.032046 }],
    ['C6', { x: -0.071177, y: 0.806388 }],
    ['C5', { x: 0.802418, y: 0.262412 }],
    ['C4', { x: 0.140749, y: -0.588441 }],
    ['C8', { x: -0.258599, y: -1.056866 }],
    ['O7', { x: 0.65977, y: -0.919843 }]
  ]);
}

/**
 * Creates a compact tricyclic oxetane projection for ammonium cyanomethyl
 * cages. The C8-C10 oxetane lane stays open while the two five-member bridge
 * paths remain separated for the ammonium and cyanomethyl exits.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAmmoniumCyanomethylOxatricycloCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C12', { x: 0.064623, y: -0.939363 }],
    ['C8', { x: 1.519889, y: -0.869028 }],
    ['C13', { x: 0.842778, y: -1.166115 }],
    ['C10', { x: 0.274837, y: 0.184893 }],
    ['O11', { x: 1.356793, y: 0.136599 }],
    ['C9', { x: 0.585204, y: -0.603575 }],
    ['C7', { x: 1.494046, y: -1.891436 }],
    ['C3', { x: 0.224179, y: -1.960153 }]
  ]);
}

/**
 * Creates a fused aminopyrimidine-cyclobutane projection. The heteroaryl
 * five-ring stays regular on one side of the shared N-C edge while the compact
 * four-ring is drawn as a square on the other fused edge.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAminoPyrimidineCyclobutaneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C14', { x: 0.0, y: 0.0 }],
    ['C15', { x: 1.0, y: 0.0 }],
    ['C12', { x: 1.0, y: 1.0 }],
    ['C13', { x: 0.0, y: 1.0 }],
    ['N16', { x: -0.544639, y: 0.838671 }],
    ['C11', { x: 0.162227, y: 1.546018 }],
    ['C9', { x: -0.292067, y: 2.43687 }],
    ['N8', { x: -1.279702, y: 2.280099 }],
    ['C7', { x: -1.4358, y: 1.292357 }]
  ]);
}

/**
 * Creates a compact azabicyclo cyclobutanone projection. The C12 ketone
 * junction is kept open so the carbonyl exits away from the cyclobutane cap
 * instead of crossing the C7-C8 edge.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createMethylAzabicycloCyclobutanoneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C12', { x: 0.0, y: 0.0 }],
    ['C6', { x: 0.587785, y: 0.809017 }],
    ['C11', { x: 1.538842, y: 0.5 }],
    ['N9', { x: 1.538842, y: -0.5 }],
    ['C8', { x: 0.587785, y: -0.809017 }],
    ['C7', { x: 1.175571, y: 0.0 }],
    ['C2', { x: 2.482776, y: -0.169866 }],
    ['C3', { x: 2.781176, y: 0.784575 }],
    ['C4', { x: 2.193391, y: 1.593592 }],
    ['C5', { x: 1.193453, y: 1.604735 }]
  ]);
}

/**
 * Creates a split-lane projection for methyl imino oxatricyclo cages. The
 * oxacycle and azacycle sit on opposite sides of the C4-C9 bridge, while the
 * four-member carbon cap stays compact but clear of the oxacycle bond lane.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createMethylIminoOxatricycloCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C4', { x: 0.0, y: 0.0 }],
    ['C9', { x: 1.0, y: 0.0 }],
    ['C7', { x: -0.22, y: 0.96 }],
    ['C6', { x: 0.62, y: 1.52 }],
    ['O8', { x: 1.38, y: 0.88 }],
    ['C3', { x: -0.22, y: -0.96 }],
    ['N2', { x: 0.62, y: -1.52 }],
    ['C10', { x: 1.38, y: -0.88 }],
    ['C5', { x: 0.82, y: 0.55 }]
  ]);
}

/**
 * Creates a compact projection for the N-methyl lactam diazatricyclo cage.
 * The six-member aza lane stays broad on top while the paired five-member
 * lactam and ammonium lanes share a compact lower bridge without crossing.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createNMethylLactamDiazatricycloCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C14', { x: -0.386713, y: 0.858948 }],
    ['C6', { x: -0.395243, y: -0.186512 }],
    ['C5', { x: 0.441905, y: -0.762141 }],
    ['C4', { x: -0.440608, y: -1.239799 }],
    ['C3', { x: -1.227406, y: -0.598131 }],
    ['N2', { x: -1.288691, y: 0.419539 }],
    ['C10', { x: 1.355810, y: -0.282069 }],
    ['C13', { x: 0.729554, y: 0.901707 }],
    ['N7', { x: 0.181913, y: 0.553758 }],
    ['C8', { x: 1.020000, y: 0.334700 }]
  ]);
}

/**
 * Creates a compact, open projection for protonated cyclobutyl-pyrrolidines.
 * The cyclobutane face sits below the shared bridge while the ammonium lane
 * stays above it, preventing the generic bridged fallback from crossing the
 * C-C and C-N cage spans.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAmmoniumCyclobutylPyrrolidineCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C1', { x: -0.540000, y: 0.000000 }],
    ['C2', { x: 0.000000, y: -0.840000 }],
    ['C3', { x: 0.540000, y: 0.000000 }],
    ['C4', { x: 0.000000, y: 0.480000 }],
    ['C5', { x: 0.690000, y: 0.710000 }],
    ['N6', { x: -0.690000, y: 0.710000 }]
  ]);
}

/**
 * Creates an open theta projection for neutral azabicyclo-pyrrolidine cages.
 * The cyclobutane path sits above the bridgeheads while the longer carbon lane
 * runs below, keeping both ring paths visible without crossing the aza span.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAzabicycloPyrrolidineCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C1', { x: -0.550000, y: 0.000000 }],
    ['C2', { x: 0.000000, y: 0.800000 }],
    ['N3', { x: 0.550000, y: 0.000000 }],
    ['C4', { x: 0.000000, y: -0.550000 }],
    ['C5', { x: 0.680000, y: -1.050000 }],
    ['C6', { x: -0.680000, y: -1.050000 }]
  ]);
}

/**
 * Creates a broad shared-edge projection for saturated tricyclic ether cages.
 * The oxacycle opens left of the bridgehead edge while the two five-membered
 * carbon lanes nest to the right without crossing.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createSharedEdgeTricyclicEtherCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C12', { x: 0.000000, y: 0.500000 }],
    ['C8', { x: 0.000000, y: -0.500000 }],
    ['C2', { x: -0.780000, y: 1.000000 }],
    ['C3', { x: -1.550000, y: 0.720000 }],
    ['O4', { x: -1.950000, y: 0.100000 }],
    ['C5', { x: -1.950000, y: -0.600000 }],
    ['C6', { x: -1.550000, y: -1.180000 }],
    ['C7', { x: -0.780000, y: -1.000000 }],
    ['C11', { x: 0.720000, y: 0.700000 }],
    ['C10', { x: 1.330000, y: 0.000000 }],
    ['C9', { x: 0.720000, y: -0.700000 }],
    ['C13', { x: 1.250000, y: 0.950000 }],
    ['C14', { x: 2.050000, y: 0.000000 }],
    ['C15', { x: 1.250000, y: -0.950000 }]
  ]);
}

/**
 * Creates an open projection for substituted bicyclo[2.1.1]hexane cores.
 * The cyclobutane path stays square-like while the longer carbon bridge sits
 * below it, preventing the generic fallback from crossing the two cap bonds.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createSubstitutedBicyclo211HexaneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C1', { x: -0.750000, y: 0.000000 }],
    ['C2', { x: 0.000000, y: 0.750000 }],
    ['C3', { x: 0.750000, y: 0.000000 }],
    ['C4', { x: 0.000000, y: -0.550000 }],
    ['C5', { x: 0.700000, y: -1.150000 }],
    ['C6', { x: -0.700000, y: -1.150000 }]
  ]);
}

/**
 * Creates a less-pinched projection for trigonal-carbon substituted
 * bicyclo[2.1.1]hexanes. The exocyclic bridgehead is pulled outward while the
 * second bridge bows to the opposite side, keeping both the cyclobutane cap and
 * five-member lane visible around a compact shared edge.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createTrigonalCarbonBicyclo211HexaneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C1', { x: -0.750000, y: 0.000000 }],
    ['C2', { x: 0.000000, y: 0.750000 }],
    ['C3', { x: 0.750000, y: 0.000000 }],
    ['C4', { x: 0.000000, y: -0.550000 }],
    ['C5', { x: 0.700000, y: -1.150000 }],
    ['C6', { x: -0.700000, y: -1.150000 }]
  ]);
}

/**
 * Creates a split-lane projection for cyclopropane-capped azacyclooctane
 * scaffolds. The five-member carbon lane sits below the shared bridge edge
 * while the ammonium lane wraps over it, leaving the cyclopropane cap outside.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createCyclopropaneAzacyclooctaneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C2', { x: -0.550000, y: 0.000000 }],
    ['C8', { x: 0.550000, y: 0.000000 }],
    ['C3', { x: -0.800000, y: -0.900000 }],
    ['C4', { x: 0.000000, y: -1.450000 }],
    ['C5', { x: 0.850000, y: -0.900000 }],
    ['C6', { x: 1.650000, y: -1.350000 }],
    ['C7', { x: 1.750000, y: -0.450000 }],
    ['C17', { x: -1.600000, y: -0.550000 }],
    ['C14', { x: -2.000000, y: 0.350000 }],
    ['N12', { x: -1.450000, y: 1.100000 }],
    ['C11', { x: -0.450000, y: 1.250000 }],
    ['C9', { x: 0.450000, y: 0.850000 }]
  ]);
}

/**
 * Creates a split projection for hydroxy aminopropyl cyclobutane-decalin
 * scaffolds. The cyclobutane cap stays square on one face while the two
 * saturated six-ring lanes remain separated around the shared bridge path.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createHydroxyAminopropylCyclobutaneDecalinCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C4', { x: -1.000000, y: 0.000000 }],
    ['C6', { x: -0.227424, y: -1.039169 }],
    ['C7', { x: 0.856222, y: -0.927161 }],
    ['C9', { x: 1.385254, y: 0.209200 }],
    ['C10', { x: 0.514255, y: 0.988010 }],
    ['C11', { x: -0.434749, y: 0.933701 }],
    ['C12', { x: -0.016081, y: 0.148941 }],
    ['C17', { x: 0.924370, y: -0.128096 }],
    ['C5', { x: -1.700000, y: -0.600000 }],
    ['C2', { x: -2.300000, y: 0.100000 }],
    ['C3', { x: -1.650000, y: 0.800000 }]
  ]);
}

/**
 * Creates a theta projection for compact aminomethyl oxabicyclobutane cages.
 * The oxygen bridge, carbon cap, and aminomethyl-bearing bridge share a
 * centerline so the compact cage reads as a stacked theta system without
 * crossing the aminomethyl sidechain.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAminomethylOxabicyclobutaneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C3', { x: -0.875, y: 0.0 }],
    ['C5', { x: 0.875, y: 0.0 }],
    ['O6', { x: 0.0, y: 0.9 }],
    ['C4', { x: 0.0, y: -0.48 }],
    ['C7', { x: 0.0, y: -1.035 }]
  ]);
}

/**
 * Creates a separated theta projection for cyclopropane-capped azabicyclic
 * enone cages. The cyclopropane cap sits on the right while the carbocyclic
 * and aza lanes remain distinct on the left, avoiding the generic bridged
 * fallback's crossed C5-C13 and C9-C10 paths.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createCyclopropaneAzabicyclicEnoneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C13', { x: 0.0, y: 1.09263 }],
    ['C9', { x: 0.0, y: -1.09263 }],
    ['C14', { x: 0.778084, y: 0.483584 }],
    ['C16', { x: 0.778084, y: -0.483584 }],
    ['C15', { x: 1.653382, y: 0.0 }],
    ['C5', { x: -1.255983, y: 1.052304 }],
    ['C6', { x: -1.662073, y: 0.0 }],
    ['C7', { x: -1.255983, y: -1.052304 }],
    ['N12', { x: -0.6384, y: 0.722741 }],
    ['C11', { x: -0.902904, y: 0.0 }],
    ['C10', { x: -0.6384, y: -0.722741 }]
  ]);
}

/**
 * Creates a compact two-lane projection for hydroxy aminomethyl bicyclic
 * ketone cages. The cyclobutane cap stays below the shared path while the
 * ketone five-ring opens above, avoiding the generic bridged fallback's
 * stretched crossing.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createHydroxyAminomethylBicycloKetoneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C5', { x: -0.670019, y: 0.0 }],
    ['C9', { x: 0.0, y: 0.351838 }],
    ['C7', { x: 0.670019, y: 0.0 }],
    ['C6', { x: 0.0, y: -0.689074 }],
    ['C12', { x: -0.608962, y: 1.138979 }],
    ['C10', { x: 0.608962, y: 1.138979 }]
  ]);
}

/**
 * Creates a three-lane theta projection for compact hydroxy amino oxabicyclic
 * acetal cages. The ether path stays below the shared bridge, the carbocyclic
 * path opens above it, and the shared carbon path remains bent instead of
 * flattening across both five-member rings.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createHydroxyAminoOxabicyclicAcetalCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C10', { x: -0.95, y: 0.0 }],
    ['C7', { x: 0.95, y: 0.0 }],
    ['C11', { x: 0.0, y: 0.38 }],
    ['O9', { x: -0.65, y: -0.85 }],
    ['C8', { x: 0.65, y: -0.85 }],
    ['C14', { x: -0.7, y: 1.0 }],
    ['C6', { x: 0.7, y: 1.0 }]
  ]);
}

/**
 * Creates a rectangular four-aryl projection for the compact aryl phosphite
 * spiro scaffold. Each aromatic lobe stays regular, the spiro carbon stays in
 * the center, and the phosphite bridge is routed through the left gap instead
 * of across the neighboring aryl edges.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createArylPhosphiteSpiroCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C11', { x: 0, y: 0 }],
    ['C10', { x: -0.6, y: -0.8 }],
    ['C25', { x: -0.6, y: 0.8 }],
    ['C12', { x: 0.6, y: 0.8 }],
    ['C26', { x: 0.6, y: -0.8 }],
    ['C9', { x: -0.6, y: -1.8 }],
    ['C8', { x: -1.466, y: -2.3 }],
    ['C7', { x: -2.332, y: -1.8 }],
    ['C6', { x: -2.332, y: -0.8 }],
    ['C5', { x: -1.466, y: -0.3 }],
    ['C19', { x: -0.6, y: 1.8 }],
    ['C20', { x: -1.466, y: 2.3 }],
    ['C21', { x: -2.332, y: 1.8 }],
    ['C22', { x: -2.332, y: 0.8 }],
    ['C23', { x: -1.466, y: 0.3 }],
    ['C17', { x: 0.6, y: 1.8 }],
    ['C16', { x: 1.466, y: 2.3 }],
    ['C15', { x: 2.332, y: 1.8 }],
    ['C14', { x: 2.332, y: 0.8 }],
    ['C13', { x: 1.466, y: 0.3 }],
    ['C31', { x: 0.6, y: -1.8 }],
    ['C30', { x: 1.466, y: -2.3 }],
    ['C29', { x: 2.332, y: -1.8 }],
    ['C28', { x: 2.332, y: -0.8 }],
    ['C27', { x: 1.466, y: -0.3 }],
    ['O18', { x: 0, y: 2.6 }],
    ['O32', { x: 0, y: -2.6 }],
    ['O4', { x: -2.515, y: -0.28 }],
    ['O24', { x: -2.515, y: 0.28 }],
    ['P3', { x: -3.475, y: 0 }]
  ]);
}

/**
 * Creates a separated-lane projection for compact imino oxazocine lactams. The
 * imino/formamidine ring and lactam/ether ring use opposite lanes around the
 * shared C9-C10-C11-C12 bridge, keeping the ether oxygen away from the C2 bridge exit.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createIminoOxazocineLactamCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C9', { x: -1.5, y: 0.0 }],
    ['C10', { x: -0.55, y: 0.65 }],
    ['C11', { x: 0.55, y: 0.65 }],
    ['C12', { x: 1.5, y: 0.0 }],
    ['C5', { x: -1.45, y: -1.05 }],
    ['N4', { x: -0.65, y: -1.65 }],
    ['C3', { x: 0.55, y: -1.6 }],
    ['C2', { x: 1.35, y: -0.9 }],
    ['O17', { x: -1.87, y: 0.6 }],
    ['C16', { x: -0.68, y: 1.3 }],
    ['C14', { x: 0.68, y: 1.3 }],
    ['N13', { x: 1.87, y: 0.6 }]
  ]);
}

/**
 * Creates a three-lane projection for compact alkylidene oxime bicyclohexanes.
 * The C12-C9 bridgeheads stay separated, with the one-atom C13 bridge above,
 * the one-atom C11 bridge inside, and the longer C7-C8 bridge below.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAlkylideneOximeBicyclohexaneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C12', { x: -1.0, y: 0.0 }],
    ['C9', { x: 1.0, y: 0.0 }],
    ['C13', { x: 0.0, y: 0.9 }],
    ['C11', { x: 0.0, y: -0.4 }],
    ['C7', { x: -0.65, y: -1.05 }],
    ['C8', { x: 0.65, y: -1.05 }]
  ]);
}

/**
 * Creates a three-lane projection for compact ammonium azabicyclo nitriles. The
 * quaternary nitrile-bearing carbon sits on the upper lane, the charged
 * nitrogen sits on the lower lane, and the longer carbon bridge stays open
 * outside the compressed four-member ring.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAzabicycloNitrileCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C4', { x: -0.8, y: 0 }],
    ['C7', { x: 0.8, y: 0 }],
    ['C8', { x: 0, y: 0.6 }],
    ['N2', { x: 0, y: -0.55 }],
    ['C5', { x: -0.5, y: -1.35 }],
    ['C6', { x: 0.5, y: -1.35 }]
  ]);
}

/**
 * Creates a separated three-lane projection for bridged decalin lactams. The
 * carbocycle arc sits above the shared bridge path while the lactam arc opens
 * below, preventing the two seven-member rings from collapsing onto one line.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createBridgedDecalinLactamCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C10', { x: -1.25, y: 0.0 }],
    ['C9', { x: -0.45, y: 0.3 }],
    ['C8', { x: 0.45, y: 0.3 }],
    ['C6', { x: 1.25, y: 0.0 }],
    ['C2', { x: -1.3, y: 0.9 }],
    ['C3', { x: 0.0, y: 1.25 }],
    ['C4', { x: 1.3, y: 0.9 }],
    ['C11', { x: -1.25, y: -0.95 }],
    ['C12', { x: 0.0, y: -1.25 }],
    ['N14', { x: 1.25, y: -0.95 }]
  ]);
}

/**
 * Creates a theta projection for compact bridged oxadecalins. The shared
 * C4-C14-C11-C9 bridge sits on the upper exterior arc while the carbon and
 * oxygen paths bow below it, keeping both perceived seven-membered rings
 * readable instead of pinched into a cage scribble.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createBridgedOxadecalinCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C4', { x: -1.2, y: 0.0 }],
    ['C14', { x: -0.71, y: 0.79 }],
    ['C11', { x: 0.54, y: 0.78 }],
    ['C9', { x: 1.2, y: 0.0 }],
    ['C3', { x: -0.79, y: -0.66 }],
    ['C2', { x: 0.29, y: -1.06 }],
    ['C10', { x: 1.01, y: -0.74 }],
    ['C5', { x: -1.0, y: -1.34 }],
    ['O6', { x: 0.03, y: -1.94 }],
    ['C7', { x: 1.18, y: -1.32 }]
  ]);
}

/**
 * Creates a stacked three-lane projection for hydroxy acetal oxadecalins. The
 * lower cyclohexane and upper dioxepane lanes share a bridged middle path but
 * stay on opposite sides of it, leaving the bridgehead hydroxy substituent an
 * open exterior slot instead of projecting back through the cage.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createHydroxyAcetalOxadecalinCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C5', { x: 0.68, y: 2.187 }],
    ['C4', { x: 1.153, y: 3.068 }],
    ['C3', { x: 2.153, y: 3.098 }],
    ['C2', { x: 2.679, y: 2.248 }],
    ['C8', { x: 2.203, y: 1.424 }],
    ['C7', { x: 1.206, y: 1.336 }],
    ['C14', { x: 1.981, y: 3.677 }],
    ['C15', { x: 2.708, y: 2.816 }],
    ['C16', { x: 3.032, y: 1.611 }],
    ['C9', { x: 2.228, y: 0.834 }],
    ['O13', { x: 2.98, y: 3.94 }],
    ['C12', { x: 3.79, y: 2.9 }],
    ['C11', { x: 3.82, y: 1.68 }],
    ['O10', { x: 3.05, y: 0.67 }]
  ]);
}

/**
 * Creates a separated three-lane projection for compact formyl
 * aza-oxatricyclo cages. The shared C10-C12-N13-C4 bridge stays between the
 * two seven-member lanes while the oxirane cap sits below the lower lane,
 * leaving the N-formyl exit on the exterior side instead of crossing the cage.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createFormylAzaOxatricycloCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C10', { x: 3.158, y: 1.803 }],
    ['C12', { x: 3.742, y: 0.73 }],
    ['N13', { x: 3.319, y: -0.485 }],
    ['C4', { x: 2.311, y: -1.075 }],
    ['C3', { x: 1.281, y: -0.146 }],
    ['N2', { x: 1.104, y: 0.844 }],
    ['C11', { x: 1.79, y: 1.58 }],
    ['C5', { x: 1.953, y: -0.344 }],
    ['C6', { x: 1.871, y: 0.618 }],
    ['C7', { x: 2.461, y: 1.383 }],
    ['C8', { x: 2.551, y: 0.626 }],
    ['O9', { x: 3.226, y: 1.016 }]
  ]);
}

/**
 * Creates a separated three-ring projection for methyl aza-oxa tricyclic
 * cages. The saturated seven-ring bows below the shared carbon path, the amine
 * bridge bows above it, and the fused ether five-ring stays on the exterior
 * side so the N6-C5 bridge cannot cross the lower saturated ring bond.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createMethylAzaOxaTricyclicCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C2', { x: -1.66899, y: -0.9844 }],
    ['C3', { x: -0.87677, y: -1.82283 }],
    ['C4', { x: 0.30223, y: -1.77898 }],
    ['C5', { x: 0.87075, y: -0.87474 }],
    ['N6', { x: 1.74086, y: -0.36504 }],
    ['C7', { x: 1.70292, y: 0.6745 }],
    ['C9', { x: 0.79601, y: 1.14101 }],
    ['C10', { x: 0.07562, y: 0.57869 }],
    ['C11', { x: -0.86209, y: 0.7414 }],
    ['C12', { x: -0.78729, y: 1.76903 }],
    ['O13', { x: 0.26906, y: 2.0145 }],
    ['C14', { x: -1.2422, y: -0.1418 }],
    ['C15', { x: -0.55998, y: -0.576 }],
    ['C16', { x: 0.23988, y: -0.37535 }]
  ]);
}

/**
 * Creates a compact dioxatricyclo projection for fused oxetane ether cages.
 * The left oxetane stays square while the right bridge carbon is pulled out of
 * the compressed generic slot, balancing both four-member rings and keeping the
 * upper ether five-ring exterior to the shared bridge.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createEthylDioxatricycloOxetaneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C3', { x: -0.59425, y: 0.45667 }],
    ['O4', { x: -1.48692, y: -0.16067 }],
    ['C5', { x: -0.89958, y: -0.97533 }],
    ['C6', { x: -0.07558, y: -0.36333 }],
    ['C7', { x: 0.72175, y: 0.124 }],
    ['C8', { x: 0.25175, y: 1.08933 }],
    ['C9', { x: 1.22508, y: 0.38133 }],
    ['O10', { x: 0.85775, y: -0.552 }]
  ]);
}

/**
 * Creates a separated theta projection for hydroxy azatricyclo cyclohexenes.
 * The two six-member lanes sit on opposite sides of the shared C11-C13-C5
 * bridge and the fused aziridine cap stays equilateral above the upper lane,
 * preventing the generic bridged fallback from flattening the bridge atom.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createHydroxyAzatricycloCyclohexeneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C11', { x: -1.2, y: 0.0 }],
    ['C5', { x: 1.2, y: 0.0 }],
    ['C13', { x: 0.0, y: -0.35 }],
    ['C10', { x: -0.8, y: -0.95 }],
    ['C7', { x: 0.0, y: -1.55 }],
    ['C6', { x: 0.8, y: -0.95 }],
    ['C12', { x: -0.8, y: 0.95 }],
    ['C3', { x: 0.0, y: 1.55 }],
    ['C4', { x: 0.8, y: 0.95 }],
    ['N2', { x: -0.92, y: 1.94 }]
  ]);
}

/**
 * Creates a two-lane projection for imino oxa azatricyclo ketone cages. The
 * imino ether loop bows above the shared O14-C13-C12-C5 path while the
 * azacyclic ketone loop bows below it, keeping both large rings visibly open
 * instead of flattening the shared bridge atoms.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createIminoOxaAzatricycloKetoneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C5', { x: -1.0, y: 0.0 }],
    ['O14', { x: -0.4, y: 0.5 }],
    ['C13', { x: 0.4, y: 0.5 }],
    ['C12', { x: 1.0, y: 0.0 }],
    ['C7', { x: -1.35, y: 0.9 }],
    ['C8', { x: -0.85, y: 1.65 }],
    ['O9', { x: 0.0, y: 2.0 }],
    ['C10', { x: 0.85, y: 1.65 }],
    ['N11', { x: 1.35, y: 0.9 }],
    ['C4', { x: -1.35, y: -0.9 }],
    ['C3', { x: -0.85, y: -1.65 }],
    ['N2', { x: 0.0, y: -2.0 }],
    ['C17', { x: 0.85, y: -1.65 }],
    ['C15', { x: 1.35, y: -0.9 }]
  ]);
}

/**
 * Creates a compact projection for cyclopropyl lactam pentacycles. The
 * cyclopropane bridge stays central, the lactam lane opens above it, and the
 * two carbon cages bow to opposite sides so the generic bridged fallback does
 * not flatten the fused five-member rings.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createCyclopropylLactamPentacycleCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C2', { x: 1.539, y: 0.03 }],
    ['C3', { x: 1.037, y: -0.937 }],
    ['C4', { x: 0.174, y: -1.814 }],
    ['C5', { x: -0.845, y: -1.12 }],
    ['C6', { x: -0.294, y: -0.65 }],
    ['C7', { x: 0.406, y: -0.582 }],
    ['C8', { x: -0.033, y: 0.298 }],
    ['C9', { x: -0.915, y: 0.691 }],
    ['C10', { x: -0.687, y: 1.697 }],
    ['C11', { x: 0.365, y: 1.797 }],
    ['N13', { x: 0.776, y: 0.849 }],
    ['C14', { x: -1.522, y: -0.257 }]
  ]);
}

/**
 * Creates a benzene-fused cage projection for ammonium benzocyclobutanes. The
 * aromatic ring stays regular while the saturated five-ring and fused
 * cyclobutane sit below the shared aryl edge, avoiding the long bridge bond
 * produced by generic bridged placement.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAmmoniumBenzocyclobutaneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C7', { x: 2.5, y: -0.004 }],
    ['C6', { x: 3.5, y: -0.004 }],
    ['C5', { x: 4.0, y: 0.862 }],
    ['C4', { x: 3.5, y: 1.728 }],
    ['C3', { x: 2.5, y: 1.728 }],
    ['C2', { x: 2.0, y: 0.862 }],
    ['C8', { x: 2.24, y: -0.949 }],
    ['C11', { x: 3.002, y: -0.253 }],
    ['C12', { x: 3.76, y: -0.948 }],
    ['C14', { x: 3.0, y: -1.594 }]
  ]);
}

/**
 * Creates a compact three-face projection for dimethyl oxatricyclo ether
 * cages. The three five-member rings wrap around the C7-C8 shared bridge with
 * balanced bond lengths so the ether lane does not cross the carbocyclic lanes.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createDimethylOxatricycloCageCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C2', { x: -0.99657, y: -0.24268 }],
    ['C3', { x: -0.32302, y: -0.52543 }],
    ['C4', { x: 0.76595, y: 0.22934 }],
    ['C5', { x: 0.18097, y: -0.17576 }],
    ['C6', { x: -0.62076, y: 0.24631 }],
    ['C7', { x: -0.52447, y: 0.95865 }],
    ['C8', { x: 0.57921, y: 0.91692 }],
    ['C10', { x: 0.92688, y: -0.36252 }],
    ['O11', { x: 0.01183, y: -1.04483 }]
  ]);
}

/**
 * Creates a regularized three-face projection for hydroxy dimethyl oxatricyclo
 * ether cages. The ether five-ring uses a pentagonal arc while the fused
 * cyclobutane bridge is held square, avoiding the nearly linear shared
 * bridgehead produced by generic bridged placement.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createHydroxyDimethylOxatricycloCageCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C2', { x: 1.46036, y: -0.58854 }],
    ['C4', { x: 1.17176, y: 0.57838 }],
    ['C5', { x: 0.03454, y: 1.12871 }],
    ['C6', { x: 0.51052, y: 0.29547 }],
    ['C7', { x: -0.61403, y: -0.33783 }],
    ['C8', { x: -1.01562, y: 0.54755 }],
    ['C9', { x: -0.92035, y: -1.35217 }],
    ['O10', { x: -0.07625, y: -1.86615 }],
    ['C11', { x: 0.64026, y: -1.134 }],
    ['C12', { x: 0.17482, y: -0.33967 }]
  ]);
}

/**
 * Creates a compact 6/5/4-ring projection for hydroxy oxatricyclo diols. The
 * oxetane-like C8-C9-C10-O11 lane is drawn as a real diamond instead of
 * collapsing the opposite atom pair, while the five-member carbocycle stays on
 * the opposite face to leave both alcohol substituents outside the cage.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createHydroxyOxatricycloDiolCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C2', { x: -1.4, y: 0.2 }],
    ['C7', { x: -0.9, y: 0.8 }],
    ['C5', { x: 0.2, y: 1.0 }],
    ['C8', { x: 0.7, y: -0.2 }],
    ['O11', { x: 0.0, y: 0.45 }],
    ['C10', { x: -0.7, y: -0.2 }],
    ['C3', { x: -1.5, y: 1.2 }],
    ['C4', { x: -0.7, y: 1.8 }],
    ['C9', { x: 0.0, y: -1.1 }]
  ]);
}

/**
 * Creates a separated-lane projection for the cyclobutane-capped oxadecalin
 * cage. The two four-atom paths between C13 and C9 sit above and below the
 * bent C13-C4-C6-C8-C9 bridge, while the cyclobutane cap stays square and
 * outside the ether lane instead of collapsing into a diamond.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createCyclobutaneOxadecalinCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C4', { x: 0.6, y: 0.2 }],
    ['C3', { x: 1.3, y: 0.9 }],
    ['C5', { x: 1.3, y: -0.5 }],
    ['C2', { x: 2.0, y: 0.2 }],
    ['C13', { x: 0.891, y: -0.907 }],
    ['C6', { x: 0.019, y: 1.017 }],
    ['C8', { x: -1.121, y: 1.237 }],
    ['C9', { x: -1.861, y: 0.455 }],
    ['C10', { x: -2.022, y: -0.454 }],
    ['C11', { x: -1.192, y: -1.317 }],
    ['C12', { x: -0.148, y: -1.547 }],
    ['C14', { x: 0.129, y: -1.041 }],
    ['C15', { x: -0.699, y: -0.885 }],
    ['O16', { x: -1.041, y: -0.134 }]
  ]);
}

/**
 * Creates a three-lane bridged projection for compact pyrrolizidine dione
 * cages, with the pyrrolizidine ring above and the dione bridge below the
 * alkene-bearing middle path.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createBridgedPyrrolizidineDioneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C19', { x: -1.35, y: 0 }],
    ['C11', { x: 1.35, y: 0 }],
    ['N18', { x: -0.5, y: 0.8 }],
    ['C13', { x: 0.5, y: 0.8 }],
    ['C8', { x: -0.5, y: -0.15 }],
    ['C9', { x: 0.5, y: -0.15 }],
    ['C21', { x: -0.65, y: -1 }],
    ['C24', { x: 0.65, y: -1 }],
    ['C17', { x: -0.8, y: 1.72 }],
    ['C16', { x: 0, y: 2.35 }],
    ['C15', { x: 0.8, y: 1.72 }]
  ]);
}

/**
 * Creates a separated-lane projection for acetal amino decalin cages. The two
 * six-membered rings share the central V-shaped bridge path, one lane opens
 * below it, the nitrogen lane opens above it, and the fused cyclopentane
 * remains on the exterior side of the right-hand ring edge.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAcetalAminoDecalinCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C6', { x: -0.866025, y: 0.0 }],
    ['C15', { x: 0.0, y: 0.5 }],
    ['C14', { x: 0.866025, y: 0.0 }],
    ['C7', { x: -0.866025, y: -1.0 }],
    ['C8', { x: 0.0, y: -1.5 }],
    ['C9', { x: 0.866025, y: -1.0 }],
    ['C16', { x: 1.28, y: 1.13 }],
    ['N18', { x: 0.0, y: 1.6 }],
    ['C19', { x: -1.28, y: 1.13 }],
    ['C13', { x: 1.817082, y: 0.309017 }],
    ['C12', { x: 2.404867, y: -0.5 }],
    ['C11', { x: 1.817082, y: -1.309017 }]
  ]);
}

/**
 * Creates a stacked theta projection for compact amino oxaza tricyclo cages,
 * keeping the oxolane loop below the shared edge and the aziridine cap open
 * between the upper and middle bridged lanes.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAminoOxazaTricycloCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C12', { x: -1.08, y: 0 }],
    ['C7', { x: 1.08, y: 0 }],
    ['C13', { x: -0.54, y: 0.92 }],
    ['C14', { x: 0.54, y: 0.92 }],
    ['C11', { x: -0.42, y: -0.38 }],
    ['C9', { x: 0.42, y: -0.38 }],
    ['N10', { x: 0, y: 0.25 }],
    ['C3', { x: -0.62, y: -1.15 }],
    ['C4', { x: 0.62, y: -1.15 }],
    ['C2', { x: -0.62, y: -2.02 }],
    ['C6', { x: 0.13, y: -2.48 }],
    ['O5', { x: 0.82, y: -1.88 }]
  ]);
}

/**
 * Creates a separated projection for compact aza-oxa cyclopropyl oxetane cages.
 * The fused five-member rings sit on opposite sides of the shared C6-C11 edge,
 * while the cyclopropane cap stays above and the oxetane bridge stays below.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAzaOxaCyclopropylOxetaneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C6', { x: 0.0, y: 0.0 }],
    ['C11', { x: 0.0, y: -1.0 }],
    ['C5', { x: -0.6, y: 0.8 }],
    ['N7', { x: 0.6, y: 0.8 }],
    ['C4', { x: -1.55, y: 0.1 }],
    ['C14', { x: -1.25, y: -1.0 }],
    ['C8', { x: 1.55, y: 0.1 }],
    ['C9', { x: 1.25, y: -1.0 }],
    ['C13', { x: -1.15, y: -1.95 }],
    ['O12', { x: -0.25, y: -1.95 }]
  ]);
}

/**
 * Creates a separated-lane projection for amino diaza tricyclo cages, with
 * the imine-bearing bridge below the shared top span and the diaza five-ring
 * cap projected above it.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAminoDiazaTricycloCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C11', { x: -1.25, y: 0 }],
    ['C12', { x: -0.4, y: 0.9 }],
    ['C17', { x: 0.4, y: 0.9 }],
    ['C6', { x: 1.25, y: 0 }],
    ['C2', { x: -1.19, y: -1.39 }],
    ['C3', { x: 0, y: -2.09 }],
    ['C4', { x: 1.19, y: -1.39 }],
    ['C9', { x: -0.6, y: -0.75 }],
    ['N8', { x: 0, y: -0.18 }],
    ['C7', { x: 0.6, y: -0.75 }],
    ['N14', { x: -0.647214, y: 1.660845 }],
    ['C15', { x: 0, y: 2.131073 }],
    ['N16', { x: 0.647214, y: 1.660845 }]
  ]);
}

/**
 * Creates a separated-lane projection for imino thiazole oxaza tricyclo cages.
 * The thiazole-fused six-ring occupies the lower lane, the oxaza arc opens
 * above the shared bridgeheads, and the cyclopropane cap stays visible inside
 * the upper lane instead of collapsing the shared bridge edge.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createIminoThiazoleOxazaTricycloCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C3', { x: 0.0, y: 0.0 }],
    ['C8', { x: 1.0, y: 0.0 }],
    ['C2', { x: 0.15, y: 0.8 }],
    ['C4', { x: -0.4, y: 1.1 }],
    ['O5', { x: 0.5, y: 1.65 }],
    ['C6', { x: 1.5, y: 1.0 }],
    ['C12', { x: -0.5, y: -0.866025 }],
    ['C11', { x: 0.0, y: -1.732051 }],
    ['C10', { x: 1.0, y: -1.732051 }],
    ['N9', { x: 1.5, y: -0.866025 }],
    ['N13', { x: -1.478148, y: -1.073937 }],
    ['C14', { x: -1.582676, y: -2.068459 }],
    ['S16', { x: -0.669131, y: -2.475196 }]
  ]);
}

/**
 * Creates a separated-lane projection for amino cyano thiazole oxatricyclo
 * cages. The saturated six-ring stays on a regular hexagonal face, the ether
 * bridge opens around one edge, and the thiazole cap is projected outside the
 * shared C6-C10 span instead of flattening the C2-C5 carbocycle lane.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAminoCyanoThiazoleOxatricycloCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C16', { x: 1.732, y: 0.5 }],
    ['C12', { x: 0.866, y: 1.0 }],
    ['C5', { x: 0.0, y: 0.5 }],
    ['C4', { x: 0.0, y: -0.5 }],
    ['C3', { x: 0.866, y: -1.0 }],
    ['C2', { x: 1.732, y: -0.5 }],
    ['O11', { x: 1.32, y: -1.35 }],
    ['C10', { x: 0.2, y: -1.1 }],
    ['C6', { x: -0.7, y: -0.3 }],
    ['C9', { x: -0.282, y: -2.203 }],
    ['S8', { x: -1.48, y: -2.085 }],
    ['N7', { x: -1.739, y: -0.909 }]
  ]);
}

/**
 * Creates a publication-style projection for aza-annulene cyclohexadiene
 * bridged cores. The six-member aza ring is an exact hexagon while the larger
 * aromatic perimeter follows a long outer arc sharing the same two-bond cap.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createAzaAnnuleneCyclohexadieneCoreGeometry() {
  const hexX = Math.sqrt(3) / 2;
  return createCenteredFrozenGeometry([
    ['C17', { x: 0, y: 1 }],
    ['C16', { x: hexX, y: 0.5 }],
    ['C15', { x: hexX, y: -0.5 }],
    ['C14', { x: 0, y: -1 }],
    ['N13', { x: -hexX, y: -0.5 }],
    ['C12', { x: -hexX, y: 0.5 }],
    ['C11', { x: -1.489368, y: 1.281969 }],
    ['C10', { x: -1.521276, y: 2.281476 }],
    ['C8', { x: -0.94908, y: 3.101612 }],
    ['C7', { x: 0, y: 3.416698 }],
    ['C5', { x: 0.94908, y: 3.101612 }],
    ['N4', { x: 1.521276, y: 2.281476 }],
    ['C3', { x: 1.489368, y: 1.281969 }]
  ]);
}

/**
 * Creates a bridged cyclopropyl-decalin projection with the six-membered ring
 * kept open, the larger carbocycle drawn on a separate lower arc, and the
 * cyclopropane cap outside the shared bridgehead.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createBridgedCyclopropylDecalinCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C3', { x: 1.0, y: 0.0 }],
    ['C4', { x: 0.5, y: -0.866025 }],
    ['C5', { x: -0.5, y: -0.866025 }],
    ['C6', { x: -1.0, y: 0.0 }],
    ['C7', { x: -0.5, y: 0.866025 }],
    ['C8', { x: 0.5, y: 0.866025 }],
    ['C9', { x: 0.5, y: 1.866025 }],
    ['C10', { x: 1.366025, y: 1.366025 }],
    ['C11', { x: -1.6, y: -0.65 }],
    ['C12', { x: -1.25, y: -1.55 }],
    ['C13', { x: -0.45, y: -2.18 }],
    ['C14', { x: 0.45, y: -2.18 }],
    ['C15', { x: 1.25, y: -1.55 }],
    ['C16', { x: 1.6, y: -0.65 }]
  ]);
}

/**
 * Creates a theta-style projection for compact oxabicyclic lactones. The
 * shared three-bond lane stays between the ether and lactone arcs so the
 * carbonyl/ammonium exits have open exterior space.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createOxabicyclicLactoneAmmoniumCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C5', { x: -0.988398, y: 0.0 }],
    ['C10', { x: 0.988398, y: 0.0 }],
    ['O4', { x: -0.699, y: 0.957 }],
    ['C3', { x: 0.699, y: 0.957 }],
    ['C12', { x: -0.353391, y: -0.41 }],
    ['C11', { x: 0.353391, y: -0.41 }],
    ['C6', { x: -1.342, y: -1.222744 }],
    ['C7', { x: 0.014613, y: -1.556373 }],
    ['O9', { x: 1.282495, y: -0.966467 }]
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
    ['N5', { x: 0.829673, y: 0.813118 }],
    ['C7', { x: 1.554484, y: 0.178331 }],
    ['C10', { x: 0.816864, y: -0.204458 }],
    ['C9', { x: 0.481239, y: -0.977612 }],
    ['C8', { x: 1.636313, y: -0.849128 }]
  ]);
}

/**
 * Creates a compact planar projection for the sulfonyl azatricyclo cage. The
 * cyclopropane cap opens outward from the five-member ring so the sulfone
 * branch leaves the cage exterior instead of cutting across the ammonium span.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createSulfonylAzatricycloCageGeometry() {
  return createCenteredFrozenGeometry([
    ['C2', { x: 0.0, y: 0.0 }],
    ['C6', { x: 1.0, y: 0.0 }],
    ['N4', { x: 1.0, y: 1.0 }],
    ['C3', { x: 0.15, y: 0.95 }],
    ['C7', { x: 0.25, y: 1.65 }],
    ['C8', { x: -0.45, y: 0.75 }],
    ['C9', { x: -0.84, y: 1.85 }]
  ]);
}

/**
 * Creates a compact projection for the cyclopentenyl sulfone azocane core. The
 * sulfone-containing five-member ring stays as a true pentagon while the larger
 * nitrogen ring takes the opposite side of the shared C8-C2-C3 path.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createSulfonylCyclopentenylAzocaneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C2', { x: -0.5, y: 0 }],
    ['C3', { x: 0.5, y: 0 }],
    ['C4', { x: 0.809017, y: -0.951057 }],
    ['S5', { x: 0, y: -1.538842 }],
    ['C8', { x: -0.809017, y: -0.951057 }],
    ['C9', { x: -1.698, y: -0.493 }],
    ['C10', { x: -1.975, y: 0.468 }],
    ['C11', { x: -1.465, y: 1.328 }],
    ['N12', { x: -0.489, y: 1.547 }],
    ['C13', { x: 0.339, y: 0.987 }]
  ]);
}

/**
 * Creates a compact projection for hydroxy alkyl bicyclohexene cores. The
 * unsaturated five-membered ring remains a true pentagon while the saturated
 * one-atom bridge sits on the opposite side of the bridgehead span.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createHydroxyAlkylBicyclohexeneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C5', { x: -0.84453, y: 0 }],
    ['C11', { x: 0.84453, y: 0 }],
    ['C3', { x: 0, y: 0.753901 }],
    ['C6', { x: -0.30355, y: -0.51837 }],
    ['C15', { x: -0.36479, y: -1.11295 }],
    ['C14', { x: 0.58928, y: -1.03519 }]
  ]);
}

/**
 * Creates a separated projection for oxime lactam cyclopentenyl cores. The
 * cyclopentenyl ring stays pentagonal, while the fused beta-lactam occupies a
 * compact right-hand lane and the larger bridged ring bows above the shared
 * cyclopentene edge instead of flattening through it.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createOximeLactamCyclopentenylCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C6', { x: -0.809, y: 0.263 }],
    ['C5', { x: 0, y: 0.851 }],
    ['C4', { x: 0.809, y: 0.263 }],
    ['C3', { x: 0.5, y: -0.688 }],
    ['C2', { x: -0.5, y: -0.688 }],
    ['C7', { x: -0.4, y: 1.45 }],
    ['C10', { x: 0.8, y: 1.55 }],
    ['C12', { x: 1.65, y: 0.75 }],
    ['N13', { x: 1.65, y: -0.25 }],
    ['C17', { x: 1.1, y: -1.15 }],
    ['C15', { x: 2.65, y: 0.75 }],
    ['C14', { x: 2.65, y: -0.25 }]
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
 * Creates a fused thiophene-cyclobutane cage projection. The aromatic
 * thiophene stays on a regular left-hand five-ring, while the saturated
 * C5-C6-C7-C10 cap is drawn as a near-square on the right so the central
 * bridged ring does not stretch one edge across the cap.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createCyclobutaneThiopheneCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C3', { x: -0.95, y: -1.0 }],
    ['C4', { x: 0.0, y: -0.7 }],
    ['C5', { x: 0.8, y: -0.8 }],
    ['C6', { x: 0.05, y: 0.0 }],
    ['C7', { x: 0.8, y: 0.8 }],
    ['C10', { x: 1.55, y: 0.0 }],
    ['C11', { x: 0.0, y: 0.7 }],
    ['C12', { x: -0.95, y: 1.0 }],
    ['S13', { x: -1.85, y: 0.0 }]
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
 * Creates a compact saturated morphinan projection with regular benzene,
 * cyclohexene, and outer cyclohexane lanes. The aza bridge is the one
 * deliberately foreshortened lane because it shares two adjacent edges with
 * the cyclohexene corner and cannot be regularized in a planar projection
 * without lying directly on top of the central ring.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createSaturatedMorphinanCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C14', { x: 0, y: 0 }],
    ['C2', { x: 0.939693, y: 0.34202 }],
    ['C7', { x: 1.113341, y: 1.326828 }],
    ['C18', { x: 0.347296, y: 1.969616 }],
    ['C17', { x: -0.592396, y: 1.627595 }],
    ['C16', { x: -0.766044, y: 0.642788 }],
    ['C3', { x: 1.705737, y: -0.300768 }],
    ['C4', { x: 2.64543, y: 0.041253 }],
    ['C5', { x: 2.819078, y: 1.02606 }],
    ['C6', { x: 2.053033, y: 1.668848 }],
    ['C23', { x: -1.358441, y: 2.270383 }],
    ['C22', { x: -1.184793, y: 3.255191 }],
    ['C20', { x: -0.2451, y: 3.597211 }],
    ['C19', { x: 0.520945, y: 2.954423 }],
    ['C8', { x: 1.863341, y: 0.576828 }],
    ['C9', { x: 1.15, y: -0.35 }],
    ['N10', { x: 0.05, y: -0.85 }]
  ]);
}

/**
 * Creates a conventional oripavine-style projection with exact aromatic and
 * middle cyclohexane rings, while keeping the oxygen bridge and lower bridged
 * saturated ring on separate readable arcs.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createOripavineCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C2', { x: -0.149116, y: -1.662136 }],
    ['O3', { x: -1.143917, y: -1.752225 }],
    ['C4', { x: -1.301000, y: -0.765000 }],
    ['C5', { x: -2.167000, y: -0.265000 }],
    ['C7', { x: -2.167000, y: 0.735000 }],
    ['C8', { x: -1.301000, y: 1.235000 }],
    ['C9', { x: -0.435000, y: 0.735000 }],
    ['C10', { x: -0.435000, y: -0.265000 }],
    ['C11', { x: 0.431000, y: -0.765000 }],
    ['C12', { x: 0.044988, y: 0.205440 }],
    ['C13', { x: 0.898667, y: 0.231343 }],
    ['N14', { x: 1.962189, y: 0.037944 }],
    ['C19', { x: 1.297000, y: 0.735000 }],
    ['C21', { x: 0.431000, y: 1.235000 }],
    ['C22', { x: 1.297000, y: -0.265000 }],
    ['C23', { x: 1.752023, y: -1.246220 }],
    ['C24', { x: 1.185812, y: -2.154354 }],
    ['C25', { x: 0.239300, y: -2.668457 }],
    ['C28', { x: 0.534436, y: -1.832202 }],
    ['C30', { x: 1.055017, y: -1.132125 }]
  ]);
}

/**
 * Creates a projected oxygen-bridged aza-morphinan core with the cyclohexadienone
 * and saturated bridge arcs separated around the shared bridgehead edge. The
 * atom IDs match the ring-system extracted by `createOxazaMorphinanCoreTemplate`.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createOxazaMorphinanCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C19', { x: -2, y: 0 }],
    ['C28', { x: 3, y: 0 }],
    ['C29', { x: 2.5, y: 0.866025 }],
    ['C27', { x: 2.5, y: -0.866025 }],
    ['C39', { x: 1.9, y: 0.45 }],
    ['C38', { x: 2, y: 1.45 }],
    ['C32', { x: 0, y: 1.732051 }],
    ['C20', { x: -1.5, y: 0.866025 }],
    ['C22', { x: -0.5, y: 0.866025 }],
    ['C23', { x: 0, y: 0 }],
    ['C30', { x: 1.5, y: 0.866025 }],
    ['C31', { x: 1, y: 1.732051 }],
    ['C26', { x: 1.5, y: -0.866025 }],
    ['C24', { x: -0.5, y: -0.866025 }],
    ['C3', { x: -1.5, y: -0.866025 }],
    ['C40', { x: 1, y: 0 }],
    ['N33', { x: 1.5, y: 2.3 }],
    ['O25', { x: 0.5, y: -1.4 }]
  ]);
}

/**
 * Creates a phenolic oxygen-bridged aza-morphinan projection with exact
 * benzene, outer cyclohexane, and central cyclohexane lanes. The saturated
 * aza and ether bridges use the same separated projection as the cyclohexadienone
 * variant so the five-ring bridges stay readable without crossing the core.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createPhenolicOxazaMorphinanCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C13', { x: -2, y: 0 }],
    ['C4', { x: 3, y: 0 }],
    ['C5', { x: 2.5, y: 0.8660254037844386 }],
    ['C2', { x: 2.5, y: -0.8660254037844386 }],
    ['C19', { x: 2.000000, y: 0.250000 }],
    ['C20', { x: 2.150000, y: 1.350000 }],
    ['C10', { x: 0, y: 1.7320508075688772 }],
    ['C12', { x: -1.5, y: 0.8660254037844386 }],
    ['C11', { x: -0.5, y: 0.8660254037844386 }],
    ['C17', { x: 0, y: 0 }],
    ['C6', { x: 1.5, y: 0.8660254037844386 }],
    ['C8', { x: 1, y: 1.7320508075688772 }],
    ['C27', { x: 1.5, y: -0.8660254037844386 }],
    ['C16', { x: -0.5, y: -0.8660254037844386 }],
    ['C14', { x: -1.5, y: -0.8660254037844386 }],
    ['C18', { x: 1, y: 0 }],
    ['N21', { x: 1.550000, y: 2.250000 }],
    ['O29', { x: 0.5, y: -1.4 }]
  ]);
}

/**
 * Creates a fused indolocarbazole-like projection with regular aromatic
 * sidewalls, open five-member lactam/indole lanes, and the oxygen bridge
 * carried outside the central fused hexagon.
 * @returns {ReadonlyArray<[string, {x: number, y: number}]>} Frozen normalized coords.
 */
function createOxygenBridgedBisindoleLactamCoreGeometry() {
  return createCenteredFrozenGeometry([
    ['C26', { x: -1.000000, y: 0.000000 }],
    ['C31', { x: -0.500000, y: 0.866025 }],
    ['C32', { x: 0.500000, y: 0.866025 }],
    ['C44', { x: 1.000000, y: 0.000000 }],
    ['C45', { x: 0.500000, y: -0.866025 }],
    ['C25', { x: -0.500000, y: -0.866025 }],
    ['C29', { x: -1.169131, y: 1.609170 }],
    ['N28', { x: -2.082676, y: 1.202434 }],
    ['C27', { x: -1.978148, y: 0.207912 }],
    ['N14', { x: 0.809017, y: -1.817082 }],
    ['C15', { x: 0.000000, y: -2.404867 }],
    ['C16', { x: -0.809017, y: -1.817082 }],
    ['C33', { x: 1.169131, y: 1.609170 }],
    ['C34', { x: 2.082676, y: 1.202434 }],
    ['N43', { x: 1.978148, y: 0.207912 }],
    ['C24', { x: -0.104528, y: -3.399389 }],
    ['C23', { x: -1.018074, y: -3.806126 }],
    ['C18', { x: -1.827091, y: -3.218340 }],
    ['C17', { x: -1.722562, y: -2.223819 }],
    ['C35', { x: 2.891693, y: 1.790219 }],
    ['C36', { x: 2.787165, y: 2.784741 }],
    ['C37', { x: 1.873619, y: 3.191477 }],
    ['C42', { x: 1.064602, y: 2.603692 }],
    ['C11', { x: 1.803946, y: -1.716507 }],
    ['O13', { x: 2.798876, y: -1.615932 }],
    ['C2', { x: 2.388512, y: -0.704010 }],
    ['C4', { x: 2.700750, y: -2.190800 }],
    ['C3', { x: 3.247600, y: -1.243500 }]
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
    mappedAtoms: Object.freeze((matchContext.mappedAtoms ?? []).map(constraint => Object.freeze({ ...constraint }))),
    mappedBonds: Object.freeze((matchContext.mappedBonds ?? []).map(constraint => Object.freeze({
      ...constraint,
      templateAtomIds: Object.freeze([...(constraint.templateAtomIds ?? [])])
    })))
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
    createTemplate(
      'hydroxy-diformyl-bicyclooctadiene-core',
      'bridged',
      59.5,
      createHydroxyDiformylBicyclooctadieneCoreTemplate(),
      geometrySpec('normalized-xy', createHydroxyDiformylBicyclooctadieneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C4', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C5', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C8', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C14', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'alkenyl-phenyl-oxabicycloheptane-core',
      'bridged',
      59.45,
      createAlkenylPhenylOxabicycloheptaneCoreTemplate(),
      geometrySpec('normalized-xy', createAlkenylPhenylOxabicycloheptaneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C12', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C15', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C18', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'caged-hydroxy-lactone-core',
      'bridged',
      59.4,
      createCagedHydroxyLactoneCoreTemplate(),
      geometrySpec('normalized-xy', createCagedHydroxyLactoneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C6', element: 'C', bondOrder: 2, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C15', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C18', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C20', element: 'O', bondOrder: 2, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C25', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate('oxabicyclo-2-2-2', 'bridged', 59, createOxabicyclo222Template(), geometrySpec('normalized-xy', createOxabicyclo222Geometry(), BRIDGED_VALIDATION)),
    createTemplate('quinuclidine', 'bridged', 58, createQuinuclidineTemplate(), geometrySpec('normalized-xy', createQuinuclidineGeometry(), BRIDGED_VALIDATION)),
    createTemplate('quinuclidinium-oxygen-exit', 'bridged', 57.95, createQuinuclidiniumTemplate(), geometrySpec('normalized-xy', createQuinuclidiniumGeometry(), BRIDGED_VALIDATION), {
      matchContext: {
        exocyclicNeighbors: [
          { templateAtomId: 'C3', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 }
        ]
      }
    }),
    createTemplate('quinuclidinium', 'bridged', 57.9, createQuinuclidiniumTemplate(), geometrySpec('normalized-xy', createQuinuclidiniumGeometry(), BRIDGED_VALIDATION)),
    createTemplate('diazatricyclodecane-core', 'bridged', 57.85, createDiazatricyclodecaneCoreTemplate(), geometrySpec('normalized-xy', createDiazatricyclodecaneCoreGeometry(), BRIDGED_VALIDATION)),
    createTemplate('triazaadamantane-core', 'bridged', 57.8, createTriazaadamantaneCoreTemplate(), geometrySpec('normalized-xy', createTriazaadamantaneCoreGeometry(), TRIAZAADAMANTANE_VALIDATION)),
    createTemplate('tropane', 'bridged', 57, createTropaneTemplate(), geometrySpec('normalized-xy', createTropaneGeometry(), BRIDGED_VALIDATION)),
    createTemplate('cubane', 'bridged', 55, createCubaneTemplate(), geometrySpec('normalized-xy', createCubaneGeometry(), BRIDGED_VALIDATION)),
    createTemplate('oxabicyclo-3-1-1', 'bridged', 54, createOxabicyclo311Template(), geometrySpec('normalized-xy', createOxabicyclo311Geometry(), OXABICYCLO311_VALIDATION)),
    createTemplate(
      'bridged-lactone-core',
      'bridged',
      53.9,
      createBridgedLactoneCoreTemplate(),
      geometrySpec('normalized-xy', createBridgedLactoneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C17', element: 'O', bondOrder: 2, minCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'oxabicyclic-lactone-ammonium-core',
      'bridged',
      53.89,
      createOxabicyclicLactoneAmmoniumCoreTemplate(),
      geometrySpec('normalized-xy', createOxabicyclicLactoneAmmoniumCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C7', element: 'O', bondOrder: 2, minCount: 1 },
            { templateAtomId: 'C12', element: 'N', neighborDegree: 4, minCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'oxazabicyclic-lactam-core',
      'bridged',
      53.88,
      createOxazabicyclicLactamCoreTemplate(),
      geometrySpec('normalized-xy', createOxazabicyclicLactamCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C11', element: 'O', bondOrder: 2, minCount: 1 },
            { templateAtomId: 'C2', element: 'C', minCount: 2, maxCount: 2 }
          ]
        }
      }
    ),
    createTemplate(
      'hydroxy-oxazabicyclic-lactam-core',
      'bridged',
      53.879,
      createHydroxyOxazabicyclicLactamCoreTemplate(),
      geometrySpec('normalized-xy', createHydroxyOxazabicyclicLactamCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C2', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C6', element: 'O', bondOrder: 2, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'azabicyclo-ketone-oxadiazole-core',
      'bridged',
      53.875,
      createAzabicycloKetoneOxadiazoleCoreTemplate(),
      geometrySpec('normalized-xy', createAzabicycloKetoneOxadiazoleCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C2', element: 'O', bondOrder: 2, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C8', element: 'C', bondOrder: 1, neighborDegree: 3, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'hydroxy-keto-oxadiazole-bridged-core',
      'bridged',
      53.8745,
      createHydroxyKetoOxadiazoleBridgedCoreTemplate(),
      geometrySpec('normalized-xy', createHydroxyKetoOxadiazoleBridgedCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C5', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C16', element: 'O', bondOrder: 2, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'cyanoacyl-azabicyclo-core',
      'bridged',
      53.872,
      createCyanoacylAzabicycloCoreTemplate(),
      geometrySpec('normalized-xy', createCyanoacylAzabicycloCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'N5', element: 'C', bondOrder: 1, neighborDegree: 3, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'aminonitrile-acetal-bridged-core',
      'bridged',
      53.871,
      createAminonitrileAcetalBridgedCoreTemplate(),
      geometrySpec('normalized-xy', createAminonitrileAcetalBridgedCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C7', element: 'C', bondOrder: 1, neighborDegree: 2, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'cyano-formyl-acetal-bridged-core',
      'bridged',
      53.8708,
      createCyanoFormylAcetalBridgedCoreTemplate(),
      geometrySpec('normalized-xy', createCyanoFormylAcetalBridgedCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C6', element: 'C', bondOrder: 1, neighborDegree: 2, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C9', element: 'C', bondOrder: 1, neighborDegree: 3, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'aminonitrile-oxabicyclobutane-core',
      'bridged',
      53.8707,
      createAminonitrileOxabicyclobutaneCoreTemplate(),
      geometrySpec('normalized-xy', createAminonitrileOxabicyclobutaneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C5', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C8', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'ammonium-cyanomethyl-oxatricyclo-core',
      'bridged',
      53.87068,
      createAmmoniumCyanomethylOxatricycloCoreTemplate(),
      geometrySpec('normalized-xy', createAmmoniumCyanomethylOxatricycloCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C3', element: 'N', bondOrder: 1, neighborDegree: 4, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C3', element: 'C', bondOrder: 1, neighborDegree: 4, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'amino-pyrimidine-cyclobutane-core',
      'bridged',
      53.87067,
      createAminoPyrimidineCyclobutaneCoreTemplate(),
      geometrySpec('normalized-xy', createAminoPyrimidineCyclobutaneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C7', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C9', element: 'N', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'methyl-azabicyclo-cyclobutanone-core',
      'bridged',
      53.87066,
      createMethylAzabicycloCyclobutanoneCoreTemplate(),
      geometrySpec('normalized-xy', createMethylAzabicycloCyclobutanoneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C2', element: 'C', bondOrder: 1, neighborDegree: 4, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C12', element: 'O', bondOrder: 2, neighborDegree: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'methyl-imino-oxatricyclo-core',
      'bridged',
      53.870655,
      createMethylIminoOxatricycloCoreTemplate(),
      geometrySpec('normalized-xy', createMethylIminoOxatricycloCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'N2', element: 'C', bondOrder: 1, neighborDegree: 4, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C10', element: 'N', bondOrder: 2, neighborDegree: 3, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'n-methyl-lactam-diaza-tricyclo-core',
      'bridged',
      53.870652,
      createNMethylLactamDiazatricycloCoreTemplate(),
      geometrySpec('normalized-xy', createNMethylLactamDiazatricycloCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'N2', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C8', element: 'O', bondOrder: 2, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C10', element: 'N', bondOrder: 1, neighborDegree: 4, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'ammonium-cyclobutyl-pyrrolidine-core',
      'bridged',
      53.870651,
      createAmmoniumCyclobutylPyrrolidineCoreTemplate(),
      geometrySpec('normalized-xy', createAmmoniumCyclobutylPyrrolidineCoreGeometry(), BRIDGED_VALIDATION)
    ),
    createTemplate(
      'azabicyclo-pyrrolidine-core',
      'bridged',
      53.8706505,
      createAzabicycloPyrrolidineCoreTemplate(),
      geometrySpec('normalized-xy', createAzabicycloPyrrolidineCoreGeometry(), BRIDGED_VALIDATION)
    ),
    createTemplate(
      'shared-edge-tricyclic-ether-core',
      'bridged',
      53.8706504,
      createSharedEdgeTricyclicEtherCoreTemplate(),
      geometrySpec('normalized-xy', createSharedEdgeTricyclicEtherCoreGeometry(), BRIDGED_VALIDATION)
    ),
    createTemplate(
      'trigonal-carbon-bicyclo-2-1-1-hexane-core',
      'bridged',
      53.8705055,
      createTrigonalCarbonBicyclo211HexaneCoreTemplate(),
      geometrySpec('normalized-xy', createTrigonalCarbonBicyclo211HexaneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C1', element: 'C', bondOrder: 1, neighborDegree: 3, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'substituted-bicyclo-2-1-1-hexane-core',
      'bridged',
      53.870505,
      createSubstitutedBicyclo211HexaneCoreTemplate(),
      geometrySpec('normalized-xy', createSubstitutedBicyclo211HexaneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C1', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'aminomethyl-oxabicyclobutane-core',
      'bridged',
      53.87065,
      createAminomethylOxabicyclobutaneCoreTemplate(),
      geometrySpec('normalized-xy', createAminomethylOxabicyclobutaneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C3', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C7', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'cyclopropane-azabicyclic-enone-core',
      'bridged',
      53.87063,
      createCyclopropaneAzabicyclicEnoneCoreTemplate(),
      geometrySpec('normalized-xy', createCyclopropaneAzabicyclicEnoneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C7', element: 'O', bondOrder: 2, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'cyclopropane-azacyclooctane-core',
      'bridged',
      53.870625,
      createCyclopropaneAzacyclooctaneCoreTemplate(),
      geometrySpec('normalized-xy', createCyclopropaneAzacyclooctaneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          mappedAtoms: [
            { templateAtomId: 'N12', element: 'N', charge: 1 }
          ],
          exocyclicNeighbors: [
            { templateAtomId: 'C2', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C9', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C14', element: 'C', bondOrder: 1, minCount: 2, maxCount: 2 }
          ]
        }
      }
    ),
    createTemplate(
      'hydroxy-aminopropyl-cyclobutane-decalin-core',
      'bridged',
      53.87062,
      createHydroxyAminopropylCyclobutaneDecalinCoreTemplate(),
      geometrySpec('normalized-xy', createHydroxyAminopropylCyclobutaneDecalinCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C2', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C7', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C12', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'hydroxy-aminomethyl-bicyclo-ketone-core',
      'bridged',
      53.8706,
      createHydroxyAminomethylBicycloKetoneCoreTemplate(),
      geometrySpec('normalized-xy', createHydroxyAminomethylBicycloKetoneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C5', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C7', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C10', element: 'O', bondOrder: 2, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'hydroxy-amino-oxabicyclic-acetal-core',
      'bridged',
      53.87055,
      createHydroxyAminoOxabicyclicAcetalCoreTemplate(),
      geometrySpec('normalized-xy', createHydroxyAminoOxabicyclicAcetalCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C11', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C14', element: 'N', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C14', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'aryl-phosphite-spiro-core',
      'bridged',
      53.870525,
      createArylPhosphiteSpiroCoreTemplate(),
      geometrySpec('normalized-xy', createArylPhosphiteSpiroCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'P3', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'imino-oxazocine-lactam-core',
      'bridged',
      53.870515,
      createIminoOxazocineLactamCoreTemplate(),
      geometrySpec('normalized-xy', createIminoOxazocineLactamCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C14', element: 'O', bondOrder: 2, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C5', element: 'N', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C2', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'alkylidene-oxime-bicyclohexane-core',
      'bridged',
      53.87051,
      createAlkylideneOximeBicyclohexaneCoreTemplate(),
      geometrySpec('normalized-xy', createAlkylideneOximeBicyclohexaneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C7', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C9', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'azabicyclo-nitrile-core',
      'bridged',
      53.8705,
      createAzabicycloNitrileCoreTemplate(),
      geometrySpec('normalized-xy', createAzabicycloNitrileCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          mappedAtoms: [
            { templateAtomId: 'N2', element: 'N', charge: 1 }
          ],
          exocyclicNeighbors: [
            { templateAtomId: 'N2', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C8', element: 'C', bondOrder: 1, minCount: 2, maxCount: 2 }
          ]
        }
      }
    ),
    createTemplate(
      'bridged-decalin-lactam-core',
      'bridged',
      53.87,
      createBridgedDecalinLactamCoreTemplate(),
      geometrySpec('normalized-xy', createBridgedDecalinLactamCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C12', element: 'O', bondOrder: 2, minCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'bridged-oxadecalin-core',
      'bridged',
      53.86,
      createBridgedOxadecalinCoreTemplate(),
      geometrySpec('normalized-xy', createBridgedOxadecalinCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C11', element: 'C', bondOrder: 1, minCount: 2, maxCount: 2 },
            { templateAtomId: 'C14', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'hydroxy-acetal-oxadecalin-core',
      'bridged',
      53.858,
      createHydroxyAcetalOxadecalinCoreTemplate(),
      geometrySpec('normalized-xy', createHydroxyAcetalOxadecalinCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C5', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C16', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'formyl-aza-oxatricyclo-core',
      'bridged',
      53.8575,
      createFormylAzaOxatricycloCoreTemplate(),
      geometrySpec('normalized-xy', createFormylAzaOxatricycloCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'N2', element: 'C', bondOrder: 1, neighborDegree: 4, minCount: 1, maxCount: 1 },
            { templateAtomId: 'N13', element: 'C', bondOrder: 1, neighborDegree: 3, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'methyl-aza-oxa-tricyclic-core',
      'bridged',
      53.857,
      createMethylAzaOxaTricyclicCoreTemplate(),
      geometrySpec('normalized-xy', createMethylAzaOxaTricyclicCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C2', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C7', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C16', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'ethyl-dioxatricyclo-oxetane-core',
      'bridged',
      53.8565,
      createEthylDioxatricycloOxetaneCoreTemplate(),
      geometrySpec('normalized-xy', createEthylDioxatricycloOxetaneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C3', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'hydroxy-azatricyclo-cyclohexene-core',
      'bridged',
      53.856,
      createHydroxyAzatricycloCyclohexeneCoreTemplate(),
      geometrySpec('normalized-xy', createHydroxyAzatricycloCyclohexeneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C13', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C7', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'N2', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'imino-oxa-azatricyclo-ketone-core',
      'bridged',
      53.8555,
      createIminoOxaAzatricycloKetoneCoreTemplate(),
      geometrySpec('normalized-xy', createIminoOxaAzatricycloKetoneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C15', element: 'O', bondOrder: 2, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C5', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'N2', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'cyclopropyl-lactam-pentacycle-core',
      'bridged',
      53.85525,
      createCyclopropylLactamPentacycleCoreTemplate(),
      geometrySpec('normalized-xy', createCyclopropylLactamPentacycleCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C2', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C11', element: 'O', bondOrder: 2, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C14', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'ammonium-benzocyclobutane-core',
      'bridged',
      53.855125,
      createAmmoniumBenzocyclobutaneCoreTemplate(),
      geometrySpec('normalized-xy', createAmmoniumBenzocyclobutaneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C2', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C8', element: 'N', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C12', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'dimethyl-oxatricyclo-cage-core',
      'bridged',
      53.855,
      createDimethylOxatricycloCageCoreTemplate(),
      geometrySpec('normalized-xy', createDimethylOxatricycloCageCoreGeometry(), DIMETHYL_OXATRICYCLO_CAGE_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C2', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C8', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'hydroxy-dimethyl-oxatricyclo-cage-core',
      'bridged',
      53.8550625,
      createHydroxyDimethylOxatricycloCageCoreTemplate(),
      geometrySpec('normalized-xy', createHydroxyDimethylOxatricycloCageCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C2', element: 'C', bondOrder: 1, minCount: 2, maxCount: 2 },
            { templateAtomId: 'C12', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'hydroxy-oxatricyclo-diol-core',
      'bridged',
      53.85503125,
      createHydroxyOxatricycloDiolCoreTemplate(),
      geometrySpec('normalized-xy', createHydroxyOxatricycloDiolCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C2', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C5', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'cyclobutane-oxadecalin-core',
      'bridged',
      53.855,
      createCyclobutaneOxadecalinCoreTemplate(),
      geometrySpec('normalized-xy', createCyclobutaneOxadecalinCoreGeometry(), BRIDGED_VALIDATION)
    ),
    createTemplate(
      'bridged-pyrrolizidine-dione-core',
      'bridged',
      53.85,
      createBridgedPyrrolizidineDioneCoreTemplate(),
      geometrySpec('normalized-xy', createBridgedPyrrolizidineDioneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C24', element: 'O', bondOrder: 2, minCount: 1 },
            { templateAtomId: 'C21', element: 'O', bondOrder: 1, minCount: 1 },
            { templateAtomId: 'C9', element: 'O', bondOrder: 1, minCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'acetal-amino-decalin-core',
      'bridged',
      53.84,
      createAcetalAminoDecalinCoreTemplate(),
      geometrySpec('normalized-xy', createAcetalAminoDecalinCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C6', element: 'C', bondOrder: 1, neighborDegree: 4, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C16', element: 'C', bondOrder: 1, neighborDegree: 3, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C19', element: 'C', bondOrder: 1, neighborDegree: 3, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'amino-oxaza-tricyclo-core',
      'bridged',
      53.8,
      createAminoOxazaTricycloCoreTemplate(),
      geometrySpec('normalized-xy', createAminoOxazaTricycloCoreGeometry(), BRIDGED_VALIDATION)
    ),
    createTemplate(
      'aza-oxa-cyclopropyl-oxetane-core',
      'bridged',
      53.79,
      createAzaOxaCyclopropylOxetaneCoreTemplate(),
      geometrySpec('normalized-xy', createAzaOxaCyclopropylOxetaneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C4', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C9', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'amino-diaza-tricyclo-core',
      'bridged',
      53.78,
      createAminoDiazaTricycloCoreTemplate(),
      geometrySpec('normalized-xy', createAminoDiazaTricycloCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C9', element: 'N', bondOrder: 2, minCount: 1 },
            { templateAtomId: 'C4', element: 'O', bondOrder: 1, minCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'imino-thiazole-oxaza-tricyclo-core',
      'bridged',
      53.77,
      createIminoThiazoleOxazaTricycloCoreTemplate(),
      geometrySpec('normalized-xy', createIminoThiazoleOxazaTricycloCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C2', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C6', element: 'N', bondOrder: 2, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C14', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'amino-cyano-thiazole-oxatricyclo-core',
      'bridged',
      53.765,
      createAminoCyanoThiazoleOxatricycloCoreTemplate(),
      geometrySpec('normalized-xy', createAminoCyanoThiazoleOxatricycloCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C2', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C12', element: 'C', bondOrder: 1, minCount: 2, maxCount: 2 },
            { templateAtomId: 'C16', element: 'N', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
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
      'sulfonyl-azatricyclo-cage',
      'bridged',
      53.25,
      createSulfonylAzatricycloCageTemplate(),
      geometrySpec('normalized-xy', createSulfonylAzatricycloCageGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C9', element: 'S', minCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'sulfonyl-cyclopentenyl-azocane-core',
      'bridged',
      53.1,
      createSulfonylCyclopentenylAzocaneCoreTemplate(),
      geometrySpec('normalized-xy', createSulfonylCyclopentenylAzocaneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'S5', element: 'O', bondOrder: 2, minCount: 2, maxCount: 2 },
            { templateAtomId: 'C13', element: 'C', minCount: 2, maxCount: 2 },
            { templateAtomId: 'C9', element: 'C', minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'hydroxy-alkyl-bicyclohexene-core',
      'bridged',
      53.05,
      createHydroxyAlkylBicyclohexeneCoreTemplate(),
      geometrySpec('normalized-xy', createHydroxyAlkylBicyclohexeneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C3', element: 'O', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C3', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C6', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C11', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C15', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'oxime-lactam-cyclopentenyl-core',
      'bridged',
      53.04,
      createOximeLactamCyclopentenylCoreTemplate(),
      geometrySpec('normalized-xy', createOximeLactamCyclopentenylCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C7', element: 'N', bondOrder: 2, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C15', element: 'O', bondOrder: 2, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C2', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C10', element: 'C', bondOrder: 1, minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'benzoxathiobicyclo-core',
      'bridged',
      53,
      createBenzoxathiobicycloCoreTemplate(),
      geometrySpec('normalized-xy', createBenzoxathiobicycloCoreGeometry(), BRIDGED_VALIDATION)
    ),
    createTemplate(
      'cyclobutane-thiophene-core',
      'bridged',
      52.95,
      createCyclobutaneThiopheneCoreTemplate(),
      geometrySpec('normalized-xy', createCyclobutaneThiopheneCoreGeometry(), BRIDGED_VALIDATION)
    ),
    createTemplate(
      'oxygen-bridged-bisindole-lactam-core',
      'bridged',
      52.925,
      createOxygenBridgedBisindoleLactamCoreTemplate(),
      geometrySpec('normalized-xy', createOxygenBridgedBisindoleLactamCoreGeometry(), BRIDGED_VALIDATION)
    ),
    createTemplate(
      'aza-annulene-cyclohexadiene-core',
      'bridged',
      52.9,
      createAzaAnnuleneCyclohexadieneCoreTemplate(),
      geometrySpec('normalized-xy', createAzaAnnuleneCyclohexadieneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C3', element: 'C', minCount: 1, maxCount: 1 },
            { templateAtomId: 'C5', element: 'N', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C8', element: 'C', minCount: 1, maxCount: 1 }
          ]
        }
      }
    ),
    createTemplate(
      'bridged-cyclopropyl-decalin-core',
      'bridged',
      52.85,
      createBridgedCyclopropylDecalinCoreTemplate(),
      geometrySpec('normalized-xy', createBridgedCyclopropylDecalinCoreGeometry(), BRIDGED_VALIDATION)
    ),
    createTemplate('oxaza-morphinan-core', 'bridged', 52.75, createOxazaMorphinanCoreTemplate(), geometrySpec('normalized-xy', createOxazaMorphinanCoreGeometry(), BRIDGED_VALIDATION)),
    createTemplate(
      'phenolic-oxaza-morphinan-core',
      'bridged',
      52.7,
      createPhenolicOxazaMorphinanCoreTemplate(),
      geometrySpec('normalized-xy', createPhenolicOxazaMorphinanCoreGeometry(), BRIDGED_VALIDATION)
    ),
    createTemplate('oripavine-core', 'bridged', 52.5, createOripavineCoreTemplate(), geometrySpec('normalized-xy', createOripavineCoreGeometry(), BRIDGED_VALIDATION)),
    createTemplate('saturated-morphinan-core', 'bridged', 52.25, createSaturatedMorphinanCoreTemplate(), geometrySpec('normalized-xy', createSaturatedMorphinanCoreGeometry(), BRIDGED_VALIDATION)),
    createTemplate('morphinan-core', 'bridged', 52, createMorphinanCoreTemplate(), geometrySpec('normalized-xy', createMorphinanCoreGeometry(), BRIDGED_VALIDATION)),
    createTemplate(
      'amino-acyl-aryl-norbornane-core',
      'bridged',
      50.75,
      createAminoAcylArylNorbornaneCoreTemplate(),
      geometrySpec('normalized-xy', createAminoAcylArylNorbornaneCoreGeometry(), BRIDGED_VALIDATION),
      {
        matchContext: {
          exocyclicNeighbors: [
            { templateAtomId: 'C8', element: 'N', bondOrder: 1, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C8', element: 'C', bondOrder: 1, neighborDegree: 3, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C18', element: 'C', bondOrder: 1, neighborDegree: 3, minCount: 1, maxCount: 1 },
            { templateAtomId: 'C7', element: 'H', bondOrder: 1, minCount: 2, maxCount: 2 }
          ]
        }
      }
    ),
    createTemplate('norbornene', 'bridged', 50.5, createNorborneneTemplate(), geometrySpec('normalized-xy', createNorborneneGeometry(), BRIDGED_VALIDATION)),
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
    createTemplate(
      'calixarene-guanidine-core',
      'macrocycle',
      40.986,
      createCalixareneGuanidineCoreTemplate(),
      geometrySpec('normalized-xy', createCalixareneGuanidineCoreGeometry(), PLANAR_VALIDATION)
    ),
    createTemplate('porphine', 'macrocycle', 40.985, createPorphineTemplate(), geometrySpec('normalized-xy', createPorphineGeometry(), PLANAR_VALIDATION)),
    createTemplate(
      'trans-polyene-macrolide',
      'macrocycle',
      40.982,
      createTransPolyeneMacrolideTemplate(),
      geometrySpec('normalized-xy', createTransPolyeneMacrolideGeometry(), PLANAR_VALIDATION),
      {
        matchContext: {
          mappedBonds: [
            { templateAtomIds: ['C28', 'C29'], order: 2, ez: 'E' },
            { templateAtomIds: ['C31', 'C32'], order: 2, ez: 'E' },
            { templateAtomIds: ['C37', 'C38'], order: 2, ez: 'E' }
          ]
        }
      }
    ),
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
