/** @module smarts */

export { parseSMARTS } from './parser.js';
export { compileAtomExpr, compileBondToken, defaultSmartsBondPred } from './primitives.js';
export { functionalGroups } from './reference.js';

import { findSMARTS, findSMARTSRaw, firstSMARTS, firstSMARTSRaw, matchesSMARTS } from './search.js';
export { findSMARTS, findSMARTSRaw, firstSMARTS, firstSMARTSRaw, matchesSMARTS };

// Register SMARTS search functions into Molecule to break the circular
// dependency (Molecule.js no longer imports smarts/index.js statically).
import { Molecule } from '../core/Molecule.js';
Molecule._registerSMARTS(findSMARTS, firstSMARTS, matchesSMARTS);
