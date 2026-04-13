/** @module templates/template-data */

import { buildTemplateLibrary } from './template-builders.js';

/** Frozen deterministic scaffold-template catalog. */
export const TEMPLATE_LIBRARY = Object.freeze(buildTemplateLibrary());
