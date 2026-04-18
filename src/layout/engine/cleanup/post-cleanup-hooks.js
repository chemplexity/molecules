/** @module cleanup/post-cleanup-hooks */

import { runBridgedBondTidy } from './bridged-bond-tidy.js';
import { runHypervalentAngleTidy } from './hypervalent-angle-tidy.js';
import { runLigandAngleTidy } from './ligand-angle-tidy.js';
import { runRingPerimeterCorrection } from './ring-perimeter-correction.js';
import { runRingSubstituentTidy } from './ring-substituent-tidy.js';
import { runRingTerminalHeteroTidy } from './ring-terminal-hetero-tidy.js';

/**
 * Runs the configured post-cleanup hook sequence in policy order.
 * @param {object} layoutGraph - Layout graph shell.
 * @param {Map<string, {x: number, y: number}>} inputCoords - Starting coordinates.
 * @param {{postCleanupHooks?: string[]}} policy - Resolved policy bundle.
 * @param {{bondLength: number, frozenAtomIds?: Set<string>|null, onHook?: ((hookName: string, coords: Map<string, {x: number, y: number}>, nudges: number) => void)|null}} options - Hook execution options.
 * @returns {{coords: Map<string, {x: number, y: number}>, hookNudges: number}} Final coords and summed hook nudges.
 */
export function runPostCleanupHooks(layoutGraph, inputCoords, policy, options) {
  const onHook = typeof options.onHook === 'function' ? options.onHook : null;
  const hookRunners = new Map([
    [
      'ring-perimeter-correction',
      coords =>
        runRingPerimeterCorrection(layoutGraph, coords, {
          bondLength: options.bondLength
        })
    ],
    [
      'bridged-bond-tidy',
      coords =>
        runBridgedBondTidy(layoutGraph, coords, {
          bondLength: options.bondLength
        })
    ],
    [
      'hypervalent-angle-tidy',
      coords =>
        runHypervalentAngleTidy(layoutGraph, coords, {
          bondLength: options.bondLength
        })
    ],
    [
      'ligand-angle-tidy',
      coords =>
        runLigandAngleTidy(layoutGraph, coords, {
          bondLength: options.bondLength
        })
    ],
    [
      'ring-substituent-tidy',
      coords =>
        runRingSubstituentTidy(layoutGraph, coords, {
          bondLength: options.bondLength,
          frozenAtomIds: options.frozenAtomIds
        })
    ],
    [
      'ring-terminal-hetero-tidy',
      coords =>
        runRingTerminalHeteroTidy(layoutGraph, coords, {
          bondLength: options.bondLength
        })
    ]
  ]);
  let coords = inputCoords;
  let hookNudges = 0;

  for (const hookName of policy.postCleanupHooks ?? []) {
    const runHook = hookRunners.get(hookName);
    if (!runHook) {
      continue;
    }
    const result = runHook(coords);
    coords = result.coords;
    hookNudges += result.nudges ?? 0;
    onHook?.(hookName, coords, result.nudges ?? 0);
  }

  return { coords, hookNudges };
}
