/** @module data/catalog */

import aminoAcidsCatalog from './amino-acids.js';
import polycyclicAromaticHydrocarbonsCatalog from './polycyclic-aromatic-hydrocarbons.js';
import fattyAcidsCatalog from './fatty-acids.js';
import steroidsCatalog from './steroids.js';
import nucleobasesCatalog from './nucleobases.js';
import terpenesAndTerpenoidsCatalog from './terpenes-and-terpenoids.js';

export {
  aminoAcidsCatalog,
  polycyclicAromaticHydrocarbonsCatalog,
  fattyAcidsCatalog,
  steroidsCatalog,
  nucleobasesCatalog,
  terpenesAndTerpenoidsCatalog
};

export const moleculeCatalog = [
  aminoAcidsCatalog,
  polycyclicAromaticHydrocarbonsCatalog,
  fattyAcidsCatalog,
  steroidsCatalog,
  nucleobasesCatalog,
  terpenesAndTerpenoidsCatalog
];

export default moleculeCatalog;
