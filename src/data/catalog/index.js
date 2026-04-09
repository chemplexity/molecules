/** @module data/catalog */

import aminoAcidsCatalog from './amino-acids.js';
import polycyclicAromaticHydrocarbonsCatalog from './polycyclic-aromatic-hydrocarbons.js';
import fattyAcidsCatalog from './fatty-acids.js';
import steroidsCatalog from './steroids.js';
import nucleobasesCatalog from './nucleobases.js';
import terpenesAndTerpenoidsCatalog from './terpenes-and-terpenoids.js';
import psychoactiveCompoundsCatalog from './psychoactive-compounds.js';
import vitaminsCatalog from './vitamins.js';

export {
  aminoAcidsCatalog,
  polycyclicAromaticHydrocarbonsCatalog,
  fattyAcidsCatalog,
  steroidsCatalog,
  nucleobasesCatalog,
  terpenesAndTerpenoidsCatalog,
  psychoactiveCompoundsCatalog,
  vitaminsCatalog
};

const unsortedMoleculeCatalog = [
  aminoAcidsCatalog,
  polycyclicAromaticHydrocarbonsCatalog,
  fattyAcidsCatalog,
  steroidsCatalog,
  nucleobasesCatalog,
  terpenesAndTerpenoidsCatalog,
  psychoactiveCompoundsCatalog,
  vitaminsCatalog
];

export const moleculeCatalog = unsortedMoleculeCatalog.slice().sort((a, b) => a.name.localeCompare(b.name));

export default moleculeCatalog;
