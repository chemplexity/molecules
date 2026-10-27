**Layout engine review — September 8, 2026**

Reviewed commit: `b7ad456`. Environment: Node `v25.2.1`, macOS. Production code was unchanged during this review.

The highest-priority work is to make **fixed-coordinate constraints and audit results trustworthy**. Several small, reproducible inputs violate those contracts. The engine also has substantial structural debt: two files contain roughly one-third of the engine, and much of the final geometry modification happens outside the shared cleanup stage runner.

This was a risk-driven source review of the API, pipeline, placement/refinement boundaries, cleanup scheduling and scoring, audits, geometry helpers, topology, templates, stereo, and renderer integration. It does not establish correctness of every specialized chemistry rule in the 128,337-line engine.

**Evidence and validation**

- Ran `node --test 'tests/layout/**/*.test.js'`: **975 tests, 914 passed, 0 failed, 61 skipped**, approximately 131 seconds.
- The full stress and browser suites were not run. In addition to reported skips, the 242-entry audit corpus loop is only registered with `RUN_LAYOUT_STRESS=1`; the default result does not mean every corpus entry ran. See [audit-corpus.test.js:328](/Users/prismane/Documents/Git/molecules/tests/layout/engine/audit-corpus.test.js:328).
- Created and ran [layout-engine-repros.mjs](/Users/prismane/Documents/Git/molecules/docs/reviews/layout-engine-repros.mjs). Its assertions reproduce the current defects, rather than asserting desired behavior. Run it with `node docs/reviews/layout-engine-repros.mjs`. After fixes, convert the relevant cases into ordinary regression tests.
- Checked static local imports across the engine: no multi-file import cycles were found. The architectural concerns below concern responsibility and state management, rather than circular module loading.

**Current structure**

The main flow is public mutation API → engine API → options/topology/policy → component placement → cleanup stage graph → fragment packing/orientation/final retouches → stereo/audit/result → application to the molecule.

| Area                   | Size / role                                                                   | Assessment                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Entire engine          | 125 JavaScript files; 128,337 lines                                           | Large enough to require explicit contracts between subsystems. Counts include comments and blank lines. |
| `families/mixed.js`    | 23,581 lines                                                                  | Placement, attached-block search, motif recognition, and corrective geometry are highly concentrated.   |
| `pipeline.js`          | 18,715 lines; 426 top-level function declarations                             | Orchestration contains extensive domain algorithms. `runPipeline` itself spans about 2,478 lines.       |
| `audit/invariants.js`  | 5,909 lines                                                                   | General measurements and motif-specific exceptions share a module.                                      |
| Cleanup infrastructure | Stage graph, comparators, telemetry, sparse coordinate overlays, spatial grid | Useful foundations for incremental refactoring.                                                         |

The implementation has strong assets: broad molecule-specific tests, separated family modules, reusable topology indexes, sparse candidate overlays, spatial lookup, and stage telemetry. Preserve those capabilities while tightening the shared contracts.

**Prioritized findings**

“High” means a core constraint or validation result is wrong. “Medium” means reproducibility or API behavior is inconsistent. “Low” means reporting is wrong without changing the coordinates. Findings F1–F8 and F10 have executable reproductions; F9 is established by tracing the complete option path.

| ID  | Priority | Finding                                                                               |
| --- | -------- | ------------------------------------------------------------------------------------- |
| F1  | High     | Fixed coordinates are not reliably enforced across refinement, alignment, and stereo. |
| F2  | High     | Bond-length validation accepts lengths below configured minimums.                     |
| F3  | High     | Crossing exemptions leak across unrelated components.                                 |
| F4  | High     | Candidate safety and final audit disagree about crossing safety.                      |
| F5  | High     | Empty and nonfinite coordinate maps can pass the audit.                               |
| F6  | Medium   | Default cleanup scheduling makes output depend on elapsed time.                       |
| F7  | Medium   | Default and explicit hydrogen options differ; generation mutates input visibility.    |
| F8  | Medium   | Hydrogen suppression cannot be reversed through the public generation option.         |
| F9  | Medium   | Two advertised control options are silently ignored.                                  |
| F10 | Low      | Application summaries double-count hidden hydrogens present in the coordinate map.    |

**F1 — Fixed coordinates are treated inconsistently**

There are several independent failure paths:

1. [buildComponentFixedCoords](/Users/prismane/Documents/Git/molecules/src/layout/engine/placement/refinement.js:120) copies explicit fixed coordinates, then overwrites them with existing coordinates. An ethane refinement with `a0` previously at `(0, 0)`, explicitly fixed at `(10, 10)`, and `a1` touched returns `a0 = (0, 0)`. Its final audit reports `ok: true`.
2. [preserveComponentPlacement](/Users/prismane/Documents/Git/molecules/src/layout/engine/placement/refinement.js:98) reads only existing coordinates. The preservation shortcut in [component-layout.js:790](/Users/prismane/Documents/Git/molecules/src/layout/engine/placement/component-layout.js:790) does not check whether an explicit fixed coordinate conflicts. A fully placed cyclohexane ignores a new anchor and is marked preserved.
3. [alignCoordsToFixed](/Users/prismane/Documents/Git/molecules/src/layout/engine/geometry/transforms.js:173) fits two anchors, then chooses between direct and mirrored fits for additional anchors. It never enforces the remaining points exactly. Fixing a three-carbon chain at `(0,0)`, `(1.5,0)`, `(1.5,1.5)` produces a middle point near `(1.1830,0.3170)`. Both requested bonds were already length 1.5; this is an angular constraint, not an impossible bond-distance request.
4. [enforceAcyclicEZStereo](/Users/prismane/Documents/Git/molecules/src/layout/engine/stereo/enforcement.js:609) does not consult fixed or frozen atoms. Directly enforcing `F/C=C/F` from conflicting, fully fixed Z geometry reflects a fixed fluorine. Its [stage caller](/Users/prismane/Documents/Git/molecules/src/layout/engine/cleanup/stage-pipeline.js:744) supplies only bond length. This helper-level reproduction demonstrates the missing constraint check; it does not establish that every full-pipeline input reaches that route.

**Impact:** editor anchors, partial relayout, and preservation requests can move or be ignored. The audit has no fixed-position invariant, so it cannot reliably expose the violation.

**Change:** define explicit anchors as hard constraints, with precedence over existing coordinates and preservation shortcuts. Seed compatible fixed geometry directly; solve only movable atoms. Check constraints at every candidate acceptance boundary and at finalization. If stereo and anchors conflict, retain the anchors and report the conflict. A final coordinate overwrite alone is insufficient because it can break the adjacent geometry.

**F2 — Asymmetric bond limits become a symmetric tolerance**

[measureBondLengthDeviation](/Users/prismane/Documents/Git/molecules/src/layout/engine/audit/invariants.js:5138) computes the allowed absolute deviation using the larger of the lower and upper tolerances. This changes the configured interval.

- [Bridged validation](/Users/prismane/Documents/Git/molecules/src/layout/engine/constants.js:101) specifies a ratio of `0.7–1.4`, but the audit effectively allows `0.6–1.4`. A bond at 65% of target length passes with zero failing bonds.
- Haptic validation specifies `0.05–2.1`. Symmetrizing around 1 permits a zero-length bond; the isolated two-atom diagnostic passes `audit.ok` with coincident endpoints when tagged haptic.
- [Template validation](/Users/prismane/Documents/Git/molecules/src/layout/engine/templates/validation.js:88) already checks the lower and upper limits separately, so template validation and layout auditing interpret the same settings differently.

**Change:** compare distance against `bondLength * minFactor` and `bondLength * maxFactor` independently. Keep absolute deviation as a separate ranking metric. Add boundary tests immediately below, at, and above each class limit. Some corpus expectations may change because previously accepted compression will become visible.

**F3 — Crossing exceptions apply to the entire molecule**

[audit.js:64](/Users/prismane/Documents/Git/molecules/src/layout/engine/audit/audit.js:64) grants one planar crossing allowance if any ring has at least eight atoms. It disables crossing failures entirely if the graph contains any bridged ring connection.

The reproduction begins with two crossing ethane fragments, each with an ideal bond length. The audit correctly fails. Adding a well-separated regular eight-membered ring, without changing the crossing, produces `crossingCount: 1`, `crossingFailureCount: 0`, and `ok: true`. The bridged branch has the same global scope by inspection.

**Impact:** a special ring elsewhere in a salt, mixture, or connected structure can hide an ordinary planar crossing unrelated to that ring.

**Change:** scope exceptions to the actual crossing bonds and their ring system/projection. Crossings in unrelated fragments must retain the same classification. Add a compositional test: adding a distant component must not erase an existing defect.

**F4 — The fast safety audit omits a hard final-audit condition**

[auditCandidateSafety](/Users/prismane/Documents/Git/molecules/src/layout/engine/audit/audit.js:137) is documented as checking the conditions that contribute to `auditLayout(...).ok`, but omits crossing failures. On the two crossing ethanes above, it returns `ok: true` while the full audit returns `ok: false`. All bond lengths are ideal and no atom-overlap threshold is violated.

This helper is used to accept candidates in mixed placement and presentation retouches, for example [mixed.js:8304](/Users/prismane/Documents/Git/molecules/src/layout/engine/families/mixed.js:8304) and [ring-substituent.js:733](/Users/prismane/Documents/Git/molecules/src/layout/engine/cleanup/presentation/ring-substituent.js:733).

**Impact:** a locally attractive crossing candidate can survive a purported safety gate. A later final audit may detect it, but that alone does not restore the previous candidate.

**Change:** share one set of hard validity predicates. A cheaper prescore can omit checks if its result explicitly means “eligible for full validation.” Require full validation before commitment, using a spatial broad phase or changed-bond checks to keep it affordable.

**F5 — Audit success does not guarantee a complete, finite layout**

For a nonempty ethane graph, [auditLayout](/Users/prismane/Documents/Git/molecules/src/layout/engine/audit/audit.js:39) returns `ok: true` for both an empty coordinate map and a map containing NaN at both atoms. The latter also returns NaN deviation metrics and zero failing bonds. Missing endpoints are skipped by [bond measurement](/Users/prismane/Documents/Git/molecules/src/layout/engine/audit/invariants.js:5147); NaN comparisons do not increment the failure count.

Partial coordinates are legitimate during placement, so blanket completeness checks in every inner-loop audit would be inappropriate. The problem is reusing the same success meaning for a finished result. [buildPipelineResult](/Users/prismane/Documents/Git/molecules/src/layout/engine/pipeline.js:16093) passes that audit into `qualityReport.ok` without a separate final validity gate.

**Change:** distinguish partial candidate assessment from final result validation. Final validation should report missing required atoms, nonfinite positions, invalid coordinate keys, and fixed-coordinate violations. The reproduction proves the audit gap; it does not show an ordinary unconstrained molecule spontaneously producing NaN through the full pipeline.

**F6 — Elapsed time changes the output**

[createCleanupStageBudget](/Users/prismane/Documents/Git/molecules/src/layout/engine/pipeline.js:475) always enables a wall-clock budget, between 900 and 4,500 ms. [stage-runner.js:69](/Users/prismane/Documents/Git/molecules/src/layout/engine/cleanup/stage-runner.js:69) skips optional stages after it expires. There is no normalized option for deterministic scheduling or disabling this budget.

Using audit corpus row 9646, the reproduction changes only the clock to simulate an unexpired versus expired budget. The maximum coordinate difference is approximately **0.419 layout units**, and the expired run skips five stages. Both final audits pass. This is a controlled scheduling experiment, not a measured claim that normal execution took the simulated time. A similar probe across all 46 plan-corpus entries found no coordinate differences; the divergence appeared in the larger audit corpus.

**Impact:** CPU speed, contention, debugging pauses, or instrumentation can select a different depiction for the same graph/options. Tests on one timing regime do not establish cross-runtime reproducibility.

**Change:** provide an explicit deterministic mode based on candidate/iteration counts. Keep wall-clock limits as an opt-in interactive responsiveness policy, with the skipped work and completion status in metadata. Extend that budget through final retouches if the goal is a total latency bound; the current stage budget does not bound the whole call.

**F7 — Hydrogen defaults are normalized too late**

[engine/api.js:147](/Users/prismane/Documents/Git/molecules/src/layout/engine/api.js:147) checks raw `options.suppressH` before [normalization](/Users/prismane/Documents/Git/molecules/src/layout/engine/options.js:92) supplies its default of `true`. With an initially hidden hydride in `[Fe][H]`, `generateCoords(molecule)` omits H coordinates, whereas `{ suppressH: true }` includes them.

The explicit call also changes the caller's hydrogen visibility through `showMetalBoundHydrogens` before the pipeline clones the molecule. This makes the engine's preparation phase observable on its input, even though coordinates are normally returned for a separate application step. Refinement duplicates the same sequence.

**Change:** normalize options once before hydrogen preparation; perform preparation on the working molecule. Define which visibility changes belong to the public mutating API. Add default-versus-explicit equivalence and input-mutation tests, including failed option validation.

**F8 — Turning hydrogen suppression off leaves atoms hidden**

The public [generateCoords](/Users/prismane/Documents/Git/molecules/src/layout/public-api.js:67) hides hydrogens when suppression is enabled, but has no inverse visibility update when it is disabled. Running ethane with suppression on and then off produces coordinates for all eight atoms, while all six H atoms still have `visible === false`.

**Impact:** toggling the option on an existing molecule can produce explicit-hydrogen geometry whose hydrogen labels and bonds remain hidden. The result depends on call history.

**Change:** specify and implement the inverse display operation. If manually hidden atoms must remain hidden, distinguish user visibility from layout suppression rather than storing both in one boolean. Test both toggle directions and fresh-versus-reused molecules.

**F9 — `freezeChiralCenters` and `allowBranchReflect` are no-op options**

[generateAndRefine2dCoords](/Users/prismane/Documents/Git/molecules/src/layout/public-api.js:152) accepts and forwards both options, but [refineExistingCoords](/Users/prismane/Documents/Git/molecules/src/layout/public-api.js:109) never reads or forwards them to the engine. Neither option has another implementation reference in `src`.

**Impact:** callers requesting center freezing or prohibiting reflection receive no indication that the request has no effect. This establishes an API contract defect; it is not evidence that every ignored request results in a stereochemical error.

**Change:** implement these controls through shared constraints, or explicitly deprecate/reject them. Make the supported public option surface clear; several internal engine options are intentionally absent from the public adapter, which should be documented separately from these advertised no-ops.

**F10 — Application counters can exceed atom count**

[applyCoords](/Users/prismane/Documents/Git/molecules/src/layout/engine/apply.js:248) applies every atom found in the map, including hidden hydrogens. [applyHiddenHydrogenMode](/Users/prismane/Documents/Git/molecules/src/layout/engine/apply.js:140) applies and counts the same hydrogens again. Applying a map containing all atoms of hidden-H ethane reports **14 applied atoms for an 8-atom molecule**.

**Change:** process hidden hydrogens in one place, or limit the second pass to atoms omitted by the first. Assert that application categories count distinct atoms.

**Further risks worth investigating**

These are design risks identified by inspection, not additional reproduced end-to-end failures.

- **Coordinate caches assume immutability without enforcing it.** [stage-pipeline.js:208](/Users/prismane/Documents/Git/molecules/src/layout/engine/cleanup/stage-pipeline.js:208) caches audits and presentation metrics by Map identity; [LayoutEvaluationContext](/Users/prismane/Documents/Git/molecules/src/layout/engine/audit/layout-evaluation-context.js:13) caches grids and coordinate-dependent atom lists. Maps and positions remain mutable. Specify ownership and add development-time mutation checks, or give coordinate states explicit revisions. No stale-cache failure was established in this review.
- **Checkpoints do not capture all geometry interpretation state.** The large-molecule checkpoint in [pipeline.js:16292](/Users/prismane/Documents/Git/molecules/src/layout/engine/pipeline.js:16292) captures coordinates and audit, while later retouches can update `placement.bondValidationClasses`; restoration near [pipeline.js:18657](/Users/prismane/Documents/Git/molecules/src/layout/engine/pipeline.js:18657) restores coordinates. Verify that restored coordinates cannot be interpreted using a later candidate's classes or display assignments. An atomic candidate/checkpoint object would make this easier to guarantee.
- **Label scoring estimates a different object from the renderer.** [atomLabelText](/Users/prismane/Documents/Git/molecules/src/layout/engine/geometry/label-box.js:11) primarily models element and charge; [getAtomLabel](/Users/prismane/Documents/Git/molecules/src/layout/engine/render-helpers.js:517) includes folded hydrogen labels and direction-dependent placement. `labelOverlapCount` also does not contribute to audit success. Expose separate geometry and presentation outcomes and share a renderer-aware label model before treating “audit clean” as “visually clean.”

**Refactoring and improvement plan**

| Order | Work                                                    | Concrete completion criterion                                                                                                                                                         |
| ----- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Repair hard constraints and validation: F1–F5           | Small reproductions assert intended behavior; final success guarantees finite required coordinates, valid constraints, and correctly scoped geometry checks.                          |
| 2     | Repair API semantics: F7–F10                            | Default/explicit options agree, display toggles are reversible under a documented policy, advertised options work or are rejected, application counts are distinct.                   |
| 3     | Make scheduling explicit: F6                            | Deterministic mode produces the same coordinates under controlled clock changes; interactive mode reports omitted work.                                                               |
| 4     | Move final retouches into the common stage system       | Each retouch declares applicability, candidate changes, constraints, scoring, acceptance, and telemetry; one shared commit boundary enforces invariants.                              |
| 5     | Split large modules around responsibilities             | `pipeline.js` orchestrates phases; mixed placement separates root selection, attached-block search, linker placement, and motif-specific repairs. Preserve execution order initially. |
| 6     | Make candidate state and measurement contracts explicit | Coordinates, validation classes, stereo/display metadata, and audit revision travel together. Partial measurements cannot masquerade as a final validity result.                      |
| 7     | Measure performance and visual quality together         | Benchmarks report latency distributions and audit/presentation regressions across a stable, held-out corpus.                                                                          |

Use the existing stage runner, overlays, and spatial grid as the starting point. The pipeline currently has 100 `timeFinalRetouch(...)` call sites, including calls on different branches, illustrating how much work sits outside the shared stage graph. Moving those operations behind a consistent acceptance boundary has more value than mechanically splitting the file by line count.

Introduce shared JSDoc types with `checkJs`, or a focused TypeScript boundary, for `LayoutGraph`, `LayoutConstraints`, candidate state, validation classes, and stage results. The current convention of attaching many `_...` scratch fields to a graph described as immutable makes ownership hard to reason about. Keep topology indexes, options, per-run scratch, and candidate geometry distinct.

For performance, add a topology/preparation timing bucket: current timing starts before graph construction but does not report that work separately from the other named phases. Track candidate counts, full audits, accepted changes, and time spent in stages that repeatedly find no applicable work. Cache safe topology-only descriptors once per run and use sparse overrides for local candidates. Profile before broadening caching; stronger state ownership should precede additional identity-based caches.

The Kamada–Kawai solver already uses typed arrays and BFS distance construction. Its all-pairs distance matrix is still quadratic in atom count, so keep whole-component solves bounded and prefer existing block decomposition for large inputs. This is a scaling consideration, not a measured bottleneck claim from this review.

**Tests that would add the most confidence**

- A constraint matrix covering fixed/existing conflicts, one/two/three anchors, touched atoms and bonds, preserved ring components, and stereo conflicts.
- Independent final-result checks for finite coordinates, required-atom coverage, exact anchors, and configured bond intervals. Avoid verifying every result only with the engine's own audit implementation.
- Full-versus-fast safety parity tests, or tests enforcing a mandatory full validation after prescoring.
- Compositional tests: a distant macrocycle, ion, or bridged fragment must not erase another component's defect.
- API state-transition tests: repeated generation/refinement, defaults versus explicit defaults, hydrogen toggles, and every advertised control option.
- Scheduling tests with an injected clock and deterministic work budget; retain browser checks for floating-point and runtime differences.
- A separate held-out visual corpus spanning labels, salts, projected cages, macrocycles, and large molecules. Keep rendering snapshots alongside structural invariants, and review quality changes when tightening the audit.

The current tests are valuable, but the successful default run and these failures show a clear coverage gap around subsystem contracts. Closing that gap should come before adding more molecule-specific repair rules.
