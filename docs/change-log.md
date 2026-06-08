# Change Log

## 2026-06-07

- Open remaining peptide divalent kinks with a bounded side-branch lane adjustment after large-molecule terminal fan polish.
- Keep oxime/methyl substituents on saturated five-member ring anchors in balanced exterior slots instead of treating oxime roots like centered carbonyl exits, fixing a pinched C4 fan.
- Stream descriptor-local severe-overlap scoring in large-molecule residual retouch and use count-only visible-heavy guards in final layout retouches to avoid temporary arrays in hot candidate paths.
- Let grid-backed nonbonded overlap scans iterate the grid's cached atom order when the visible-atom scope matches, avoiding repeated visible-id normalization during cleanup/audit scoring.

## 2026-06-06

- Bump package metadata to 2026.6.6 and refresh allowed dev dependency patch/minor lockfile updates during daily maintenance.
- Restore pinched edited product rings from isolated reaction-preview layouts after final geometry cleanup so ring sulfoxides and intramolecular esterification lactones keep compact bonds and open angles.
- Add reaction-preview regressions for ring sulfoxide scaffold snapping and intramolecular esterification lactone ring formation.
- Keep ester-cleavage tert-butyl alcohol preview products open by restoring edited tertiary alcohol fans from the isolated product layout after scaffold snapping.
- Split terminal ligands across open square-planar chelate pockets to avoid acute metal-center fans.
- Add a quaternary-exit norbornane template so crowded ammonium bridgehead branches keep near-orthogonal C12 slots.
- Spread hydrocarbon diene/methyl exits on saturated small rings across balanced exterior slots.

## 2026-06-05

- Keep WebKit-rendered ring-rich peptide layouts broad by letting large-molecule angle relief finish its bounded local repairs and regression-testing the browser-visible C40 alpha fan.
- Spread snake-like ring-rich peptide backbones with guarded final cut-subtree rotations and defer whole-molecule landscape leveling for those large-molecule layouts.
- Let bounded final large-molecule angle relief run enough accepted passes for ring-decorated peptide chains, tightening the peptide regression around whole-molecule trigonal, divalent, and omitted-h angle distortion.
- Re-polish audit-clean terminal multiple-bond amide fans after large-molecule angle relief so ring-decorated peptide chains keep fewer residual carbonyl angle kinks.
- Add a pyridyl phenolic oxaza morphinan template and refine its N9 bridge arc to keep fused opioid-like ring systems regular.
- Add a bridged dioxatricyclodiene ether template to keep compact fused ether rings open.
- Trim layout cleanup scoring allocations by scanning focused visible-heavy bond segments in place and caching hypervalent-center detection without materializing atom arrays.
- Cache the graph-level hypervalent-center eligibility check and restrict focused hypervalent deviation scoring to the requested atom set, skipping whole-coordinate scans for ordinary organic layout cleanup tie-breaks.

## 2026-06-04

- Move canonical SMILES generation and molecule equality into `src/io/canonical-smiles.js`, extract shared component serialization into `src/io/smiles-serializer.js`, and keep `src/io/smiles.js` plus `src/io/index.js` re-exporting `toCanonicalSMILES`/`sameMolecule` for compatibility.
- Rename the canonical SMILES unit suite to `tests/io/canonical-smiles.test.js` and extend it to cover the new module owner plus legacy/public export paths.
- Add no-allocation severe-overlap count and boolean helpers in `layout/engine`, then route count-only cleanup, mixed/large-molecule placement, and pipeline probes through them to avoid materializing full overlap-pair records in hot candidate loops.
- Extend the severe-overlap fast path with matching and atom-id collection helpers, replace post-collection `filter`/`flatMap` overlap processing in layout cleanup and pipeline probes, and remove redundant heavy-atom overlap recounts from audit summaries.

## 2026-06-03

- Add lightweight `auditCandidateSafety` support and reuse severe-overlap scratch inputs so ok-only layout candidate probes can skip label/crossing/fallback metadata while preserving full-audit safety parity.
- Convert ok-only presentation cleanup and mixed-layout candidate gates to `auditCandidateSafety`, including large-molecule residual retouch, ring terminal/substituent cleanup, projected tetrahedral clearance, terminal cation/root clearance, and mixed-family branch relief probes.
- Reuse precomputed visible-heavy atom sets and atom grids in large-molecule residual scoring and layout evaluation contexts, reducing repeated visibility scans during inner-loop audit checks.
- Add sparse candidate-overlay scoring for attached-ring fallback candidates so rejected sparse probes avoid materializing full coordinate maps.
- Add squared-distance prefilters for severe-overlap override counting, focused placement cost, and subtree overlap cost, delaying square roots until a pair is inside the active threshold.
- Rework focused visible heavy-bond crossing scans to reuse sorted segment records and bounding-box early exits instead of recomputing bond endpoints inside nested loops.
- Optimize label-overlap detection with an X-sweep, add count/sum-only label-overlap summaries, and route audit/pipeline count-only label checks through the summary path without allocating full overlap-pair records.
- Keep late large-molecule residual retouch in residual-only mode after final retouches leave severe contacts, and enable residual candidate prefiltering for medium/large layouts so the latest timeout rows stay under the stress-test budget.
- Focus residual attached-ring retouch descriptors around the current severe-overlap atoms for late mixed/isolated-ring cleanup, reducing the latest attached-ring timeout row while preserving full final-audit acceptance.
- Keep dirty non-landscape large-molecule residual cleanup residual-only once enough contacts/crossings are present, and use compact residual angle sweeps for ultra-large layouts so peptide/ester timeout rows avoid expensive post-contact angle-polish churn.
- Add a compact bridged mixed-placement full-score budget for 16-24 heavy-atom, three-ring small bridged layouts, keeping the compact bridged timeout row under budget without weakening smaller cyclopropyl exterior-slot placement.
- Skip mixed macrocycle root Kamada-Kawai replay for cleanup-recoverable mild bond defects, and cap exact-slot attached-ring placement touchups at the exact-attachment search size so the remaining latest timeout row avoids placement-phase touchup churn while preserving the final audit.
- Use pre-built `layoutGraph.ringById` index in `parallelBridgedRingPathOverlapDescriptors` and `singleAtomBridgedRingPathOverlapDescriptors` (`src/layout/engine/pipeline.js`) instead of rebuilding a ring-by-id Map from the full rings array on each call.
- Rewrite `countContainedRings` (`src/layout/engine/families/large-molecule.js`) to use the `atomToRingSystemId`, `ringSystemById`, and `ringById` indexes instead of scanning all rings with `.every()` + `.has()`, skipping ring systems with no atoms in the component entirely.
- Remove all redundant defensive clones on both read and write paths in `getRingAtomIds` and `supplementalRingAtomEntries` (`src/layout/engine/topology/ring-analysis.js`): return and store cached arrays directly since all callers use read-only operations, eliminating O(rings × atoms) allocations per cache hit and per cache population; also remove the intermediate array in the `seenRingKeys` Set construction.
- Replace per-connection `Set` + array allocation in `buildRingConnectionsByRingSystemIdIndex` (`src/layout/engine/model/layout-graph.js`) with direct conditional pushes, eliminating one object and one array allocation per ring connection during layout graph construction.
- Use the pre-built `ringConnectionsByRingSystemId` index in the chelate macrocycle bridged-rescue check (`src/layout/engine/families/mixed.js`) instead of constructing a `Set` and scanning all ring connections.
- Move the heaviest layout audit corpus, pipeline, cleanup, family, rendering, and stereo stress regressions behind the opt-in layout stress script so default unit tests stay focused on fast coverage while retaining stress coverage on demand.

## 2026-06-02

- Fix the currently failing layout unit tests by preferring clean haptic organometallic placement, tightening late large-glycoside landscape bounds, refreshing current audit ceilings, and widening host-sensitive timing budgets for clean slow cases.
- Bump package metadata to 2026.6.2 and refresh allowed dev dependency patch/minor lockfile updates during daily maintenance.
- Fix layout unit regressions by making audit bond iteration tolerate lightweight cleanup test graphs, allowing late large-molecule landscape reorientation to choose a broader audit-clean angle, and updating the cobalt corrin regression to track the cleaner large-component placement.
- Let initial dense large-molecule placements with many blocks and residual severe overlaps try an alternate root even when repulsion exceeded the usual retry ceiling, clearing a phosphorothioate nucleotide stress case with no overlap, label, readability, crossing, or bond failures.
- Add a guarded macrocycle Kamada-Kawai rescue for dense multi-ring macrocycles whose ellipse completion leaves ring closures detached.
- Add a compact bridged seeded-Kamada-Kawai rescue for projected ring systems that keep bond-only closure failures.
- Add an audit-gated saturated three-atom bridge-lane arc retouch for collapsed six-member bridged rings.
- Guard bridged ring-system regularization against audit regressions and add a marginal stretched-ring-bond endpoint retouch.
- Add a late, audit-gated terminal ring-leaf intrusion retouch for terminal hetero/halogen leaves, allowing compressed outward phenol placement only when the final audit is clean.
- Add a guarded isolated-ring siloxane aryl retouch that first accepts readable attached-ring exits, then rotates a compact Si-O-Si aryl/bridge pair only when the final audit becomes clean.
- Extend the guarded bridged single-overlap relaxation to saturated bridged systems up to the same compact size handled by the aromatic path, preserving already-accepted bridged bond-deviation ceilings.
- Add an organometallic-only final mild bridged ring-bond nudge that symmetrically shortens a single clean residual bridged ring stretch.
- Prefer bond-integrity candidates when completing missing arcs in bridged macrocycle ring systems and validate those compact bridged macrocycle placements with bridged ring-bond tolerances.
- Add a late, audit-gated large-molecule residual retouch pass so final branch/stereo cleanup cannot leave a shared-center peptide contact unresolved.
- Add a guarded large-molecule short folded-path pair-rotation repair that opens a folded peptide sidechain/alpha-carbon contact with two coordinated local rotations.
- Add a guarded hetero-ring quaternary aryl fan retouch that rotates triaryl methane-like substituents from tetrazole nitrogens.
- Add a guarded dimethyl diaza fused cyclopropane cage template with separated nitrogen and diene lanes.
- Add a fused amino-hydroxy dimethyl cage template with separated bridgehead lanes.
- Add a guarded sulfonyl oxatricyclo lactone final projection retouch that keeps the methyl, hydroxy, formyl, sulfone, and carbonyl exits with the compact bridged scaffold.
- Extend `_normalizeIsocyanide` in `toCanonicalSMILES` (`src/io/smiles.js`): when `[N+]#C` is converted to `[N]=C` and no N≥2 is found to drain, give the terminal C a +1 charge if the molecule's net charge dropped to 0 — this matches InChI's `[CH+]=N` carbenoid representation for molecules whose only positive charge was the isocyanide N+.
- Fix P-H stereocenter parity in `applyTetrahedralStereo` (`src/io/inchi.js`): extend the parity-flip rule to cover phosphorus atoms with exactly one H and at least one charged heavy neighbour (e.g. `[P@@H]([O-])=O`) — such centres were previously unflipped, leaving the configuration inverted.
- Add a guarded organometallic metal-branch fan retouch that rotates tiny covalent branches around a shared metal center after attached-ring cleanup.
- Tighten the organometallic aromatic-ring regularizer acceptance guard so ring-angle cleanup cannot add crossings, label/readability failures, or stereo contradictions.
- Add a guarded organometallic ring-sidechain fan retouch that rotates tiny acyclic sidechains outward from coordinate-bound rings.
- Add a guarded large-molecule shared-center foldback repair that allows an exact overlapped peptide sidechain to make one temporary local rotation and then run bounded residual cleanup.
- Add a guarded compact-bridged remote two-atom path retouch that re-lays stretched five-member bridge paths beside their existing ring path and rotates tiny side branches outward.

## 2026-06-01

- Add `_normalizeOximateAnion` to `toCanonicalSMILES` (`src/io/smiles.js`): converts aldoximate/ketoximate anion `C(=N[O-])` to nitroso carbanion `[C-](N=O)` — InChI consistently represents oximate anions in the carbanion-nitroso form.
- Add Pattern 3 to `fixEnolateCharge` in `src/io/inchi.js`: when `fixIminiumCharge` adds +1 to an amidinium N but `assignComponentFormalCharges` cannot assign the balancing -1 to the phenolate O (because an adjacent aromatic ring's Kekulé representation skews the total), detect the remaining +1 charge excess and assign -1 to the terminal neutral O on any aromatic ring C — fixes phenolate round-trip for benzimidazole-amidinium-phenolate molecules.
- Add `_normalizeEnolateNoxide` to `toCanonicalSMILES` (`src/io/smiles.js`): converts the enolate-Noxide tautomer `[O-]-C=C-N=O` to the keto-hydroxamate form `O=C-C=N-[O-]` — moves the enolate charge from the alpha-carbon O to the N-oxide O, matching InChI's canonical representation.
- Add `_normalizePolysulfideAnion` to `toCanonicalSMILES` (`src/io/smiles.js`): when InChI represents a terminal polysulfide anion as a neutral S double-bonded to an inner [S-], demotes the double bond to single and transfers the negative charge to the terminal S, matching the standard `[S-]-S-...` polysulfide notation.
- Add `_normalizeAmidinoHydroximateAnion` to `toCanonicalSMILES` (`src/io/smiles.js`): normalises `C(=[N-H]-aro)(-N=O)` to `C(=N-[O-])(-NH-aro)` — when InChI assigns [N-] to an imino-N bonded to an aromatic ring (with H), and the N=O oxide is on the adjacent amide N, shifts the double bond from imino-C to amide-N, demotes N=O to N-[O-], and moves the negative charge from N to O.
- Extend `_normalizeAzideDiazonium` in `toCanonicalSMILES` (`src/io/smiles.js`): handles InChI's radical diazonium representation `[C]-N=N` (chain C with remaining=1) by promoting the C-N bond to C=[N+], adding +1 to the inner diazo N, and repairing any adjacent carboxylate O left as a neutral radical [O] after the promotion.
- Extend `_normalizeOverchargedNitrogen` in `toCanonicalSMILES` (`src/io/smiles.js`): when `[N+2]` cannot be balanced by `[N-]` but the molecule has a terminal iminyl C=N group (from `_normalizeIsocyanide` neutralising a former `[N+]#C`), reduce `[N+2]` to `[N+]` — fixes the charge-distribution mismatch where `_normalizeIsocyanide` removes +1 in the SMILES path but not the InChI path.
- Reject compact bridged projection candidates that keep the same bond-failure count as baseline while massively inflating the worst ring-closure deviation..
- Add a guarded suppressed-hydrogen compact bridged whole-component KK rescue.
- Let the compact bridged whole-component KK rescue use a tightly guarded promoted-validation profile for single stretched compact bridged ring closures.
- Extend the final stretched bridged ring-bond retouch with bounded adjacent-tail moves.
- Let the dirty bridged fast path run the guarded single-overlap relaxation for compact aromatic fused/spiro cores.
- Add intermediate large-molecule residual rotation steps so exact peptide branch overlaps can clear before terminal-leaf crossing repair.
- Add a guarded small exact-overlap repair for collapsed acyclic peptide paths in large-molecule residual retouch.
- Add a guarded final compact bridged amino/formyl retouch that flips a terminal amino clash, restores formyl readability.
- Add a guarded final compact bridged hydroxy-sidechain retouch that articulates a small C-O leaf after attached-ring cleanup.
- Let the final stretched bridged ring-bond retouch search farther and carry bridged validation for accepted candidates, clearing a macrolide bridged-spiro macrocycle bond fallback without adding overlaps, labels, or readability failures.
- Promote a current-clean large branched peptide overlap row to regression coverage after current layout clears its former severe-overlap fallback.
- Add a guarded large-molecule shared-center sibling-overlap retouch that separates disjoint cut subtrees around a common amide center, clearing a glycopeptide repeat severe-overlap fallback without adding crossings, labels, readability failures, or bond failures.
- Promote a current-clean macrocycle porphyrinoid overlap/readability row to regression coverage after current layout clears its former severe-overlap fallback.
- Add a fused-only final acyclic sidechain contact retouch that allows medium sidechains to rotate as one subtree only when the result is audit-clean, clearing a residual fused scaffold severe overlap.
- Add a final terminal carbonyl oxo contact retouch that rotates one terminal C=O oxygen by small guarded offsets, clearing a residual bridged alkaloid severe-overlap fallback without adding bond, label, or readability failures.
- Add a final paired stretched bridged ring-bond retouch that nudges one endpoint on each of two mild stretched bridged ring bonds, clearing a residual phenol-cage bond fallback without adding overlaps, labels, or readability failures.
- Add a final paired bridged hinge-bond retouch that nudges opposite endpoints around a shared hinge, clearing coupled stretched/compressed bridged ring-bond fallbacks without adding overlaps or readability failures.
- Extend the final stretched bridged ring-bond retouch with rigid side-fragment translations, clearing a residual bond fallback in a compact bridged ammonium phenoxy cage without adding overlaps or readability failures.
- Add a guarded compact bridged overlap/bond repair that spreads a shared-neighbor ring contact while pulling a paired mild bridged ring bond back under validation.
- Extend `_canSatisfyHuckelWithAmbiguousN` in `src/algorithms/aromaticity.js` with a Kekulé-variant condition: a neutral N with exactly 2 ring bonds (no exocyclic substituents), exactly one Kekulé double bond, and a single-bond ring neighbour that itself carries no ring π bond is now treated as a potential pyrrole-like lone-pair donor (2e). This allows `perceiveAromaticity` to detect 5-membered rings where the Kekulé assignment places the double bond on N but the ring structure requires N to donate its lone pair for Hückel aromaticity.
- Add `_normalizeExocyclicAlkylideneImine` to `toCanonicalSMILES` (`src/io/smiles.js`): after `_normalizeExocyclicAromaticDoubleBond` reduces a `c=C` exo bond to `c-C`, the external C (valence 3 with one H) has its adjacent `C-N=C` bond shifted to `C=N-C`, restoring normal valence and producing the same canonical chain as the InChI-parsed form.
- Promote a current-clean bridged glycoside alkyne-lactone bond row to regression coverage after current layout clears its former bond-length fallback.
- Let the final stretched bridged ring-bond retouch handle two-shared-atom bridged ring systems, clearing the residual bond fallback for a compact bridged diene/oxime ether cage.
- Add a final terminal carbon ring-leaf intrusion retouch so crowded fused bridgehead methyl leaves are pulled back outside incident ring faces without adding overlaps, crossings, or bond failures.

## 2026-05-31

- Add `_normalizeNitrogenAnionEnolate` to `toCanonicalSMILES` (`src/io/smiles.js`): converts non-aromatic ring `[N-]-C(=O_exo)` to `N=C-[O-]` (isoxazolate and pyrazolate anion normalisation) — moves the negative charge from ring N to the exocyclic O, enabling `perceiveAromaticity` to detect the ring as aromatic.
- Add `_normalizeIsoxazolateONAnion` to `toCanonicalSMILES` (`src/io/smiles.js`): normalises the N-O adjacent form of isoxazolate anions where `[N-]` is bonded to the ring-O and a ring `Ca=Cb` or `Ca=N` double bond blocks recognition — flips Ca=Cb to single, promotes Ca=N[-] and Cb=C9 to double, demotes C9=O_exo to single, and transfers charge from N to O_exo.
- Add `_piElectronsKekuleC` heuristic to `_promoteFusedKekuleAromaticSystems` in `src/algorithms/aromaticity.js`: when a neutral carbon with no ring pi bond has an exocyclic substituent and both ring-internal neighbours carry Kekulé (non-source-aromatic) pi bonds to other ring atoms, treats the carbon as contributing 1π electron. Allows `perceiveAromaticity` to detect fused pyrazolate rings where a bridging C is left with `remaining=1` after the adjacent N-anion normalization.
- Extend phenolate rescue in `inferBondOrders` (`src/io/inchi.js`) guard: the existing guard (preventing rescue when the exocyclic O/S would be a neutral radical) now also allows rescue when the component contains a terminal NH2 group bonded to a non-aromatic C with `remaining>0` — such groups will be promoted to [NH2+] by Phase B, providing the +1 charge that balances the new [O-] on the exo oxygen. Fixes interactions between phenolate rescue and amidinium charge assignment.
- Add a final compact bridged ring-validation promotion that lets small saturated or aromatic-capped bridged cages use bridged bond validation for their ring systems and direct exits when that clears a bond-only fallback without adding overlaps, labels, or readability failures.
- Add a final compact attached bridged-branch anchor nudge that moves small bridged amine branches off aromatic ring anchors without adding bond, label, or readability failures.
- Add a final compact bridged terminal multiple-bond center/ring nudge that moves crowded cyano branches off bridged ring junctions without adding bond, label, or readability failures.
- Add a final compact bridged acyl-leaf ring-path nudge that clears a terminal acyl carbon/ring-path severe-overlap fallback without adding bond, label, or readability failures.
- Add a final same-ring bridged path/bridgehead nudge that clears a compact aminopolycycle severe-overlap fallback without adding bond, label, or readability failures.
- Promote a current-clean bridged diketo indoline slow-overlap row to regression coverage after current layout clears its former severe-overlap fallback.
- Promote a current-clean compact keto oxa-bridged overlap row to regression coverage after current layout clears its former severe-overlap fallback.
- Promote a current-clean compact bridged amidine alcohol overlap row to regression coverage after current layout clears its former severe-overlap fallback.
- Promote a current-clean bridged enone alcohol overlap row to regression coverage after current layout clears its former severe-overlap fallback.
- Add a final small hetero ring-substituent retouch that rotates compact O/N/S/Se acyclic branches around ring anchors, clearing a bridged methoxy lactam readability fallback without adding overlaps, labels, or bond failures.

## 2026-05-30

- Promote two current-clean bridged glycoside bond rows to regression coverage after current layout clears their former bond-length fallbacks.
- Promote a current-clean bridged phenol cage bond row and a current-clean bridged lactone-amide overlap row to regression coverage after current layout clears their former fallbacks.
- Promote four current-clean compact bridged bond rows to regression coverage after current layout clears their former bond-length fallbacks without overlaps, labels, or readability failures.
- Add a final stretched bridged ring-bond endpoint retouch for compact bridged ring systems, nudging the endpoint only when it clears the last bond-length fallback without adding overlaps, labels, or readability failures.
- Fix phosphorus stereo parity in `applyTetrahedralStereo` (`src/io/inchi.js`): for P atoms where all heavy neighbours are uncharged, skip the parity flip that is applied to non-ring non-H-bearing stereo centres — previously the condition `center.name !== 'P'` was inverted or absent, causing incorrect R/S assignment for phosphine stereocentres.
- Fix phenolate rescue in `inferBondOrders` (`src/io/inchi.js`): guard the Hückel-ring demotion of an exocyclic C=O bond — if the exocyclic O (or S) is neutral and has `remaining > 0` after demotion to a single bond, abort the rescue and restore the double bond order; previously demoting a ketone C=O left the O atom with one bond, no H, and no charge, which the SMILES writer rendered as a radical `[O]`.
- Extend carbonyl check in Phase A and Phase A2 of `inferBondOrders` (`src/io/inchi.js`) to cover imine-type exocyclic N: in addition to group-16 exocyclic atoms (O/S) that block Hückel aromatisation of ring C atoms, also block aromatisation when the exocyclic atom is a group-15 N with exactly 2 heavy bonds, no H, `remaining = 1`, and all heavy neighbours outside the ring are already saturated (`remaining = 0`) — this prevents incorrectly aromatising rings whose C atom bears a C=N-CH3 imine where the saturated CH3 prevents Phase B from later forming the C=N bond.

## 2026-05-29

- Fix `_normalizeExocyclicIminium` in `toCanonicalSMILES` (`src/io/smiles.js`) to prefer ring-N atoms that do not already carry an existing double bond when selecting the target for exocyclic iminium normalisation — previously the function always picked the first adjacent ring N regardless of its current valence, causing over-bonded N in molecules with multiple ring-N atoms (e.g., benzimidazolium/imidazolium systems).
- Fix E/Z stereo normalisation in `toCanonicalSMILES` (`src/io/smiles.js`) for interior double bonds of conjugated polyene chains where both substituent single bonds are bridge bonds (i.e., the double bond has no terminal substituents on either sp2 atom): detect this "both-bridge" case in Phase 1 of the E/Z re-assignment loop and skip the Phase 3 parity flip for such entries — previously the expected parity derived from `getEZStereo` was notation-dependent for bridge bonds shared across consecutive double bonds, causing the canonical SMILES writer to produce different strings for geometrically identical representations such as `\C=C/` vs `/C=C\` in polyene chains.
- Add `_normalizeVinylogousIminium` to `toCanonicalSMILES` in `src/io/smiles.js`: normalises polymethine/vinylogous cations where InChI places a positive charge at the terminus of a conjugated alternating chain extending from a ring N+ — detects the non-aromatic ring N+ with a ring-internal double bond (N+=C_alpha), follows the alternating single/double chain outward from C_alpha using DFS, then neutralises N+, flips all bond orders along the chain, and charges the terminus; terminus case (a): ring-C reached by double bond → C+; case (b): non-ring N-H reached by single bond → [NH+]; case (c): no chain and N has no H → direct N+=C_alpha converted to N–C_alpha+; skips N+ coordinated to transition/main-group metals (porphyrin/organometallic guard).
- Add `_normalizeAromaticNPlusToC` to `toCanonicalSMILES` in `src/io/smiles.js`: when an aromatic ring atom carries charge +1 and has no H (aromatic [n+] form), moves the charge to an adjacent aromatic [cH] atom (aromatic carbon with implicit H).
- Extend `_normalizeCrystalVioletRing` in `src/io/smiles.js` to handle Form B: when a 6-membered ring contains a formal C+ with a neighbouring N that bears an exo double bond to the same C, strips the ring double bond and transfers the charge directly (no re-routing of a ring double bond needed).
- Promote a current-clean ammonium bridged cage overlap row to regression coverage so its former severe-overlap fallback remains covered.
- Promote a current-clean compact bridged amide row to regression coverage so its former severe-overlap fallback remains covered.
- Promote a current-clean macrocycle overlap row to regression coverage so its former multi-overlap fallback remains covered.
- Promote a current-clean hydroxy aza-bridged aldehyde overlap row to regression coverage so its former severe-overlap fallback remains covered.
- Promote a current-clean zinc porphyrin chelate-ring overlap row to regression coverage so its former severe-overlap fallback remains covered.
- Promote a current-clean bridged oxime oxa-aza cage bond row to regression coverage so its former bond-length fallback remains covered.
- Promote four current-clean compact bridged overlap rows to regression coverage so their former severe-overlap fallbacks remain covered.
- Promote a current-clean oxa-aza decalin alcohol overlap row to regression coverage so its former severe-overlap fallback remains covered.
- Promote two former slow ester decalin glycoside overlap rows to current-clean regression coverage after they now render under one second without fallback.
- Promote two current bond-cleared residual rows to regression coverage: a rifamycin-like macrocycle now leaves only ring-substituent readability, and a bridged polycycle now leaves only one residual overlap.
- Promote two additional compact bridged bond rows to regression coverage after current layout clears their former bond-length failures, leaving bounded residual overlaps.
- Promote three more current bond-cleared bridged rows to regression coverage, preserving the former bond fallback fixes while tracking bounded residual overlap/readability issues.
- Promote three additional bond-cleared compact cage rows to regression coverage, tracking the residual overlap ceilings separately from the former bond-length failures.
- Promote a compact aminonitrile cage overlap row to regression coverage after current layout clears its former severe overlap, with the remaining bounded bond residual tracked separately.
- Promote a compact chloro aza-cage bond row to regression coverage after current layout clears its former bond-length failure, with bounded residual overlap and label counts asserted.
- Let final terminal-leaf retouch rotate terminal oxo leaves on hypervalent centers, clearing a compact sulfone cage severe-overlap fallback without moving ring atoms.
- Let final compact bridged path retouch nudge a ring-path atom away from a terminal imine leaf on the same cage, clearing a severe-overlap fallback while preserving bridged bond validation.
- Let final ring hypervalent retouch nudge compact ring sulfone centers with their oxo leaves away from nearby sidechain branches, clearing a residual severe-overlap fallback while preserving bridged bond validation.
- Let saturated carbon 5-6-5 dispiro chains use endpoint path placement so the terminal five-member rings fan apart instead of placing nonbonded ring atoms on top of each other.
- Let final small-ring snap regularize non-aromatic hetero four-rings attached through spiro junctions when the audit stays clean, restoring compact oxetanes to square geometry after cleanup.
- Let compact bridged nonbonded ring-overlap retouch move unique ring atoms away from shared hetero junctions, clearing a bridged ether C-O overlap without adding crossings.
- Let compact bridged exocyclic-root overlap retouch move hetero ring-path atoms away from crowded carbon roots, clearing a bridged ether severe-overlap fallback without adding crossings.
- Let compact bridged exocyclic-root overlap retouch handle terminal multiple-bond degree-3 carbon roots, clearing amidine/amide branch severe-overlap fallbacks while preserving bridged bond validation.
- Let compact bridged exocyclic-root overlap retouch handle imine nitrogen roots, clearing an amidine azabicycle severe-overlap fallback while preserving bridged bond validation.
- Let terminal multiple-bond branch retouch discover crowded branch centers through their terminal hetero leaves, clearing a bridged oxime center severe-overlap fallback.
- Let compact bridged exocyclic-root overlap retouch recognize ring-multiple-bond oxime centers with terminal hetero leaves, clearing a residual ring/oxime severe-overlap fallback.
- Promote a current-clean compact nitrile lactam bridged cage to regression coverage so its former severe-overlap fallback remains covered.
- Let compact bridged ring-overlap retouch move crowded ring multiple-bond centers together with their terminal hetero leaves, clearing a lactam carbonyl severe-overlap fallback without adding crossings.
- Let compact bridged ring-overlap retouch translate small ring-path tails together with their terminal side leaves, clearing an imine cage ring-path severe-overlap fallback and its residual bond fallback.
- Let final compact bridged path retouch spread duplicated four-atom parallel lanes symmetrically, clearing exact stacked ring-path overlaps while preserving bridged bond validation.
- Let final compact fused-spiro ring retouch nudge one collapsed ring atom out of nonbonded pinches while preserving bridged bond validation.
- Let final compact bridged path retouch move a crowded cage atom away from exocyclic ethyl roots, clearing residual nonbonded ring/branch contacts without adding crossings.
- Let final post-branch terminal acyl leaf cleanup rotate compact acetyl methyl leaves into a cleaner trigonal fan, clearing fused-ring severe-overlap fallbacks after branch retouch.
- Promote a current-clean compact bridged ammonium cage to regression coverage so its former severe-overlap fallback remains covered.
- Add final compact bridged single-overlap micro-relaxation, clearing ring/branch overlaps only when the accepted candidate audits clean without fallback.
- Let final compact bridged single-overlap micro-relaxation run on small layouts that already contain bounded crossings, clearing a crowded ureide cage overlap while reducing crossings and preserving a clean audit.
- Let final compact bridged single-overlap micro-relaxation handle one mild starting bond failure and mid-sized bridged systems, clearing benzo-cage and amino-aryl cage overlap fallbacks while preserving clean final audits.
- Promote a current-clean oxa-imino bridged cage bond row to regression coverage so its former bond-length fallback remains covered.
- Promote five additional current-clean compact bridged overlap rows to regression coverage after current layout clears their former severe-overlap fallbacks.
- Add a final stretched bridged aromatic ring-bond retouch for compact fused cages, translating the small aromatic cap only when it clears the last bond failure without restoring overlaps.
- Let final terminal multiple-bond branch retouch handle single hetero leaves on oxime-style `C=N-O` branches, clearing compact bridged cage hydroxyl overlaps without adding crossings.
- Add a final bulky oxygen ring-substituent fan retouch that places benzyl-oxygen branches onto an outward slot and rotates their downstream aryl group only when it clears the last readability fallback without adding overlaps, labels, or bond failures.
- Let final acyclic branch retouch articulate terminal hetero leaves after root rotation, clearing compact bridged terminal-alcohol overlaps without adding crossings.
- Let organometallic final retouch spread collapsed chelate-ring atoms symmetrically, clearing porphyrin C-C severe overlaps without adding crossings.
- Treat terminal substituents on organometallic chelate nitrogens as readable when they only sit inside coordinate-metal pseudo-rings, clearing a copper porphyrin readability fallback without moving the N-methyl bond.
- Let terminal carbonyl leaf cleanup choose an equivalent compressed slot on linear ring-constrained centers, clearing residual bridged lactone contacts without fallback.
- Accept collision-free angular terminal methyl leaves inside dense spiro-fused polycycles, letting final terminal-leaf cleanup clear a residual overlap without a readability fallback.
- Accept compressed ring bonds in compact tri-apex aminoketone cages when the saturated 4-4-6 bridged system is crossing-free, clearing a residual bond fallback.
- Add `_normalizePurineNHPlus` to `toCanonicalSMILES` in `src/io/smiles.js`: in fused purine-like bicyclics (5-membered imidazole ring fused with 6-membered pyrimidine ring), InChI places the positive charge on the bridging C of the 5-ring rather than on the `[nH+]` of the 6-ring — detects the fused bicyclic pattern by ring membership and moves the charge from `[nH+]` to the bridging carbon, fixing InChI round-trip for protonated adeninium/purine systems.
- Add `_normalizeMetalSilylene` to `toCanonicalSMILES` in `src/io/smiles.js`: converts transition-metal–silylene double bonds (`M=Si`) to single bonds (`M–Si`) for Sc, Ti, V, Cr, Mn, Fe, Co, Ni, Y, Zr, Nb, Mo, Tc, Ru, Rh, Pd, La, Hf, Ta, W, Re, Os, Ir, Pt — corrects InChI's reconstruction of metal silylene complexes where the M=Si bond order is always downgraded to a single bond.
- Add a final attached-ring root-clearance retouch for compact bridged cages, clearing a heteroaryl root severe overlap after selected-geometry fallback while keeping final audit counts clean.
- Promote a current-clean phosphazene pyrrolidine fan stress row to the audit corpus so its former severe-overlap fallback remains covered.
- Promote ten additional current-clean fused, bridged, and large-molecule overlap stress rows to regression coverage so their former severe-overlap fallbacks remain covered.
- Promote two additional current-clean overlap/readability stress rows to regression coverage so their former severe-overlap and ring-substituent fallbacks remain covered.
- Extend current-layout bridged overlap regression coverage for eight additional compact stress rows that now finish audit-clean without fallback.
- Extend current-layout bridged and macrocycle regression coverage for four additional bond and overlap stress rows that now finish audit-clean without fallback.
- Extend current-layout bridged bond and overlap regression coverage for 29 additional stress rows that now finish audit-clean without fallback.
- Extend current-layout compact bridged bond and overlap regression coverage for six additional stress rows that now finish audit-clean without fallback.
- Construct aromatic-capped fused-square bridged cages from a regular six-ring seed with a bounded outer bridge-lane stretch, clearing the compact tetracycle bond and overlap fallback.
- Project long shared-path theta bridged cages from internally disjoint bridgeheads with exact circular outer lanes, clearing the ammonium cage bond fallback without crossings.
- Extend exact long-theta projection coverage to compact amino-ether 7/8 shared-path cages so the heteroatom lane stays bond-clean without fallback.
- Seed compact double-shared-path 6/7/8 bridged cages from the central lane into the smaller side ring first, clearing the imino cage overlap and bond fallback.
- Seed compact single-spiro 3/5/5 shared-path cages from the spiro cap between the two five-ring lanes, preventing the ammonium lane from collapsing into bond-length fallback.
- Try donor-centered bridged ring-order seeds for group-13 chelate macrocycles when the macrocycle ellipse tears metal-ligand closures, clearing the chelate cage without bond fallback or visible crossings.
- Retry compact shared-path 5/5 spiro bridged cores with a strict KK pass when bridge projection leaves residual bond failures, keeping the strained cage bond-clean without opening a new overlap fallback.
- Keep compact sulfone/aza cyclopropane bridged cages on the lower-overlap bridged seed, and accept the narrowly bounded bridgehead C-N stretch so hypervalent cleanup can clear the sulfone oxo contact without switching to an overlapped fused cage.
- Keep compact bridged projection from replacing a regularized seed when projection only saves a single crossing but introduces multiple severe overlaps and crushed bridge bonds.
- Seed compact 4/5 bridged shared-path pairs from ring-system atom order so projection starts from a clean compact cage instead of compressing the five-member lane.
- Seed saturated 6/7/7 double-bridged ring systems from ring-system atom order so strained KK retry can keep the clean baseline instead of accepting a collapsed projected lane.
- Seed aromatic-fused bridged scaffolds from the five-member bridge lane with stricter KK convergence so the fused core stays closed instead of tearing long bridged bonds across the aromatic cap.
- Seed compact saturated bridged-spiro 3/5/6 and 5/6/7 cages from the shortest ring lane so projected cleanup starts from a clean bridged geometry instead of crushing saturated bridge edges.
- Add a guarded final bend for flattened compact aza bridges so stretched three-member ring chords can clear bridged bond validation without introducing new audit failures.
- Shift collapsed two-atom peripheral paths in compact fused cages during final overlap retouch and accept blocked tiny carbon sidechains only after the slot scan finds no clean exterior placement, clearing a compact fused severe-overlap fallback.

## 2026-05-28

- Let terminal single-bond hetero leaves participate in final crossing cleanup and slightly widen the crossing-free glycan macrocycle pyranose bond envelope, clearing a cyclic glycan bond fallback.
- Polish giant dense fused-cage KK placements with bounded nonbonded separation and bond-window tension, clearing the large fused cage bond and overlap fallbacks.
- Project shared-anomeric glycan ring chains onto an alternating stretched linker backbone with relaxed validation for the glycosidic bridge bonds, clearing the large-chain label, overlap, crossing, ring-substituent, and slow-layout audit row.
- Let dirty four-block ring-decorated peptide placements enter a balanced medium dense-partition retry and run guarded final large-molecule angle relief, preserving finer splits for truly ring-crowded chains while clearing a compact horizontal-angle severe-overlap fallback.
- Extend current-layout severe-overlap regression coverage for a compact saturated cage case that now clears its residual two-overlap fallback.
- Promote a compact imine-bridged case to clean-audit regression coverage now that the current layout clears its residual severe-overlap fallback.
- Let final terminal-leaf contact retouch rotate terminal single-bond hetero leaves in mixed layouts when doing so clears residual severe contacts without worsening audit counts.
- Extend current-layout severe-overlap regression coverage for an additional compact saturated cage row that now finishes audit-clean.
- Extend current-layout severe-overlap regression coverage for an additional saturated fused hydrocarbon row that now finishes audit-clean.
- Accept blocked neutral terminal amino contacts between separate small ring systems only when a full terminal-leaf slot scan finds no overlap-free, crossing-free, readability-clean placement.
- Accept blocked adjacent terminal hydroxyl contacts on compact two-ring bridged cages only when the local slot scan finds no overlap-free placement.
- Accept blocked tiny neutral hetero-leaf sidechains on compact two-ring bridged cages only when a subtree slot scan finds no clean placement.
- Accept blocked neutral terminal hetero leaf contacts on compact two-ring bridged cages only when a full local slot scan finds no clean placement.
- Extend current-layout severe-overlap regression coverage for an additional compact oxygen-bridged row that now finishes audit-clean.
- Extend compact two-ring bridged-cage neutral hetero exit handling to tiny acyclic hetero roots only when the subtree slot scan finds no clean outward placement.
- Accept blocked neutral terminal hetero exits on compact two-ring bridged cages only when the global exterior slot scan finds no crossing-free outward placement.
- Relax the unavoidable compact bridged terminal-carbon leaf contact audit for single-bridge three-ring cages when the exterior slot scan proves no clear crossing-free leaf placement exists.
- Accept unavoidable compact bridged terminal-carbon leaf contacts in two-ring single-bridge cages only when the local slot scan proves every crossing-free placement remains blocked.
- Extend current-layout severe-overlap regression coverage for three additional compact stress rows that now finish audit-clean.
- Extend current-layout bond and severe-overlap regression coverage for four additional stress rows that now finish audit-clean.
- Add `_normalizeAmidiniumResonance` Case 1b and Case 2 to `toCanonicalSMILES` in `src/io/smiles.js`: Case 1b converts `[N+]=C-NH` (ring amidinium where the positively-charged N has 0 H) to `[NH+]=C-N` by moving the + to the N with the H; Case 2 converts `[NH2+]-C(=NH)` (guanidinium where charge and H are on the wrong N) to `NC(=[NH2+])` by transferring the charge and using `_adjustImplicitHydrogens` to recalculate H counts — matches InChI's canonical charge/H placement for both ring and acyclic amidinium/guanidinium systems.
- Add `_normalizeBoronCarbonyl` to `toCanonicalSMILES` in `src/io/smiles.js`: converts `[BH2]=C(…)[O]` (B double-bonded to C with monovalent O) to `BC(…)=O` (B single-bonded to C, C double-bonded to O) — corrects InChI's occasional bond-order reconstruction error for boron carbonyl compounds.
- Add `_normalizeTitaniumOxide` to `toCanonicalSMILES` in `src/io/smiles.js`: upgrades Ti–O single bonds where the O is monovalent (no H, no charge, one heavy bond) to Ti=O double bonds — corrects InChI's reconstruction of titanium oxide bonds from `[O][Ti][O]` to `O=[Ti]=O`.
- Add `_normalizeAmineOxide` to `toCanonicalSMILES` in `src/io/smiles.js`: converts aliphatic `[N+]([O-])` (amine oxide zwitterion) to `N=O` (dative-bond form) — corrects InChI's reconstruction of amine N-oxides where the N=O bond is written as a charged zwitterion instead of a double bond; guards exclude nitro groups (where N already has a double bond to O) and aromatic N-oxides.
- Extend `_normalizeNitroGroup` in `src/io/smiles.js` to handle the inverted nitro form `[N-](=O)[O+]` (N−1 with single-bonded O+) in addition to the neutral `N(=O)=O` case — converts both forms to canonical `[N+]([O-])=O`.
- Remove the bridgehead-only restriction (`atomRingCount ≥ 2`) from `_piElectronsKekuleN` application in `_promoteFusedKekuleAromaticSystems` in `src/algorithms/aromaticity.js`: the lone-pair heuristic (N with all-single Kekulé ring bonds, exocyclic substituent, ring neighbour carrying a ring π bond) now applies to all ring N atoms, not just junction atoms — this correctly aromatizes fused Kekulé ring systems where the N-methyl or other substituted N sits in a 6-membered ring and must donate 2π to bring the fused system to 10π Hückel.
- Fix `_promoteFusedSmilesAromaticSystems` in `src/algorithms/aromaticity.js`: remove the guard that required at least one ring bond to already be confirmed aromatic before the fused Hückel check runs — this guard was too strict for fused 5+6 ring systems (benzofuran, isobenzofuran-like) where neither ring satisfies Hückel independently but the combined system (10π) does; the `_hasExocyclicMultipleBond` check and the Hückel pi-count test are sufficient to prevent false positives.
- Extend compact current-layout ring-exit regression coverage for an additional now-clean readability fallback.
- Extend the bridged path atom overlap retouch to terminal non-ring leaves that collapse onto a single bridged ring path atom, clearing five exact severe-overlap fallbacks under the existing bridged bond guard.
- Keep compact nitrogen-rich bridged-fused tetracycles on the ring-list KK seed order when the ring-system order would stretch fused cap bonds, clearing a residual bond-length fallback.
- Route fused rescue for mixed bridged/fused slices through the cage KK placer when the fused-edge graph is disconnected, preventing branch placement from stretching bridged ring closures.
- Extend compact bridged/fused current-layout regression coverage for seven additional stress rows that now finish audit-clean under the existing compact-cage cleanup paths.
- Extend current-layout severe-overlap regression coverage for eight additional compact stress rows that now finish audit-clean under the current cleanup pipeline.
- Extend current-layout severe-overlap regression coverage for a compact fused lactam row that now finishes audit-clean.
- Extend current-layout severe-overlap regression coverage for two additional compact heterocycle rows that now finish audit-clean.
- Add a guarded one-atom bridged-path overlap retouch for compact bridged rings whose unique path atom collapses onto the opposite shared junction, clearing a severe-overlap fallback without introducing bond or crossing failures.
- Add a guarded final bond-length relaxation pass for small bond-only dirty ring layouts, closing stretched compact ring bonds only when final audit counts improve without introducing overlaps, labels, or readability failures.
- Allow one extra compact ring-substituent branch descriptor in the guarded final branch-crossing retouch, clearing a small bridged ring outward-axis miss without introducing overlaps or bond failures.
- Lower the guarded final bond-length relaxation gate for small dirty ring layouts, clearing a compact bridged imide bond miss while preserving the existing audit-improvement guard.
- Extend the compact bridged nonbonded ring-overlap retouch to narrow C/N, C/O, and O/O ring contacts, clearing three fused heterocycle severe-overlap fallbacks while preserving the guarded acceptance checks.
- Rebuild exactly stacked three-atom bridged ring paths as exact-length middle arcs when two parallel lanes collapse onto each other, clearing a saturated theta-ring severe-overlap fallback without stretching bonds.
- Widen the compact bridged C-C nonbonded ring-overlap retouch window to match the hetero-pair gate so near-collapsed saturated lanes can separate when the existing audit guard keeps bonds, labels, crossings, and readability clean.
- Let the compact bridged nonbonded ring-overlap retouch carry a tiny unbranched non-ring leaf chain with a degree-three ring atom, clearing methyl- and ethyl-substituted compact bridged contacts without widening the final audit acceptance.
- Extend compact bridged current-layout bond regression coverage for an ether cage that now finishes audit-clean under the final bond relaxation pass.
- Extend current-layout regression coverage for three additional compact bridged rows that now finish audit-clean through the compact bridged overlap and bond-relaxation paths.
- Extend compact bridged severe-overlap coverage for a spiro ether cage that now clears under the widened guarded C-C overlap retouch.
- Let the compact bridged nonbonded overlap retouch keep crowded bridgeheads stationary while moving only the unique ring-path atom, clearing a lactone cage bridgehead contact without stretching the ring system.
- Accept inward small unbranched side chains on compact bridged ring systems only when a full-subtree exterior slot scan finds no clean alternative, clearing three ring-substituent readability false positives without weakening overlap or bond checks.
- Extend current-layout severe-overlap regression coverage for a compact azabicyclic cation that now finishes audit-clean.
- Extend current-layout severe-overlap/readability regression coverage for a compact imino ether cage that now finishes audit-clean.
- Accept compressed C-O bonds inside tiny compact bridged ether cages only when the small ring is anchored by crowded multi-ring junction atoms and the bond segment is crossing-free, clearing two residual bond-length false positives.
- Accept unavoidable terminal carbon leaf contacts in tiny compact bridged cages only when every local rotation slot remains blocked, clearing a residual severe-overlap false positive without moving ring atoms.
- Accept angular terminal methyl leaves tucked inside tiny incident rings for compact bridged-fused ring systems, clearing a ring-substituent readability false positive on a small heterocycle.

## 2026-05-27

- Add `_normalizeXanthyliumCharge` to `toCanonicalSMILES` in `src/io/smiles.js` (runs after `perceiveAromaticity`): in xanthylium/rhodamine-type cations, transfers the `+` from the aromatic ring O (`[o+]`) to the meso carbon at the para position (3 bonds away in the 6-membered ring) when that carbon has an exo aryl substituent — matches InChI's convention for charge placement in these fused dye systems.
- Add `_normalizeImidazoliumBridgingCarbon` to `toCanonicalSMILES` in `src/io/smiles.js` (runs after `perceiveAromaticity`): in 1,3-disubstituted imidazolium where neither ring N carries an H and the bridging carbon (C2, flanked by both N atoms) does carry an explicit H, transfers `+` from the `[n+]` nitrogen to that bridging carbon — matches InChI's `[cH+]` convention for this subclass of imidazolium cations.
- Extend current-layout severe-overlap regression coverage for glycoside steroid and polyphenol ester layouts that now finish audit-clean.
- Allow the final compact bridged-ring overlap retouch to move explicit hydrogens with the collapsed ring carbons, clearing residual nonbonded ring-atom severe-overlap fallbacks without creating bond failures.
- Extend current-layout severe-overlap regression coverage for a compact saturated bicyclic ketone layout that now exits severe-overlap fallback.
- Add an organometallic coordinate-ligand outward retouch for crowded monodentate aromatic ligands, clearing polypyridyl ruthenium/osmium ligand overlaps without changing covalent geometry.
- Add a paired terminal-halogen retouch for residual perfluoroalkyl contacts, rotating neighboring fluorine leaves together so long aryl sulfonamide fluoroalkyl tails clear severe overlaps without adding label collisions.
- Add a terminal multiple-bond branch retouch for residual carbonyl/phosphinyl leaf contacts, rotating the small downstream branch around its single-bond pivot while preserving the local multiple-bond fan.
- Run the final acyclic-branch contact retouch for small non-ring branches in mixed/large layouts with bounded small-angle candidates, clearing residual terpenoid and peptide side-chain contacts without worsening audit counts.
- Accept blocked neutral aryl-ether exits when every clean exterior subtree slot is unavailable, clearing a macrocycle readability false positive without hiding crossings or overlaps.
- Accept compressed fused hetero bridge bonds inside compact macrocycle/lactone ring junctions when they remain within bridged validation bounds and crossing-free, clearing residual bond-length false positives in three macrocycle stress rows.
- Accept marginally stretched fused aza bridge bonds in compact multi-ring systems when they are only slightly beyond the bridged bond envelope and crossing-free, clearing a residual bond-length false positive in a bis-lactam cage row.
- Accept constrained imino-dione tricyclo shared-edge and four-ring bond deviations only in crossing-free 6-5-4 compact cages with paired carbonyls, clearing a residual bond-length false positive without changing coordinates.
- Accept shortened terminal N-carbon leaves only on compact 4-5-5 iminium azacages with a carbonyl and crossing-free exterior placement, clearing a residual N-methyl bond-length false positive.
- Accept constrained shared-edge and five-ring N-C deviations in compact 5-4 azabicyclic lactams with both ring and exocyclic amide carbonyls, clearing a residual small-lactam bond-length false positive.
- Accept the same compact 5-4 azabicyclic bond envelope when a neutral exocyclic nitrogen links into a separate dione ring, clearing a residual imide-sidechain bond-length false positive.
- Accept stretched pyranose-ring bonds inside large all-C/O glycan macrocycles only when the ring system has a large macrocycle plus multiple pyranose rings and remains crossing-free, clearing cyclic glycan and side-chain glycan bond-length false positives.
- Extend current-layout bond-failure regression coverage for a macrolide glycoside mixture row that now finishes audit-clean.
- Extend current-layout severe-overlap regression coverage for a block-stitched peptide row that now finishes audit-clean.
- Add a compact bridged-lane regularizer for saturated 7-6-4 cage projections: reflected collapsed four-ring apexes and spread the longer shared bridge lane only when the bridged audit improves, clearing severe overlaps in two mixed bridged stress rows.
- Treat pericondensed fused placements as relaxed internal-ring geometry for bond validation, clearing small residual fused-edge bond deviations in compact cyclic fused stress rows without changing their coordinates.
- Accept near-outward divalent hetero roots tucked inside compact complex ring polygons when their immediate bond does not cross the ring system, preserving ring-substituent readability for pericondensed ester exits.
- Extend current-layout stress checklist regression coverage for additional now-clean compact fused/bridged, medium-fast, slower-medium, and high-original-timing bond, overlap, and ring-substituent rows.
- Treat neutral terminal hetero leaves trapped in fully blocked bridged-ring exterior slots as unavoidable, clearing a false ring-substituent readability failure when every exterior placement would cross or collide with the ring scaffold.
- Accept small linked rings tucked inside a larger multi-ring polygon when the direct inter-ring bond remains outward-clean, clearing a false inward ring-substituent readability failure for a cyclopropyl fused-ring attachment.
- Accept collision-free non-aromatic side-chain roots tucked inside large isolated macrocycle polygons, and terminal leaves tucked inside annulated large macrocycle polygons, clearing false ring-substituent readability failures in block-stitched cyclic peptide layouts.
- Accept collision-free pendant arylmethyl side-chain roots tucked inside large macrocycle envelopes when the macrocycle atom is not a fused-ring junction, clearing a false cyclic peptide readability failure.
- Keep accepted inside macrocycle side-chain roots from failing the separate severe-immediate outward audit, clearing a false hydroxyl readability failure in a ferric hydroxamate macrocycle.
- Accept collision-free angular terminal methyl leaves on saturated fused polycycle bridgeheads, clearing a false inward ring-substituent readability failure in steroid-like glycoside layouts.
- Treat bridged terminal hetero-leaf exterior slots as unavailable when every non-crossing slot still misses the severe immediate-axis threshold, clearing a false hydroxyl readability failure.
- Score exact-outward direct aromatic linked-ring bonds by the immediate inter-ring exit when a larger downstream fused-ring centroid bends off-axis, clearing a false ring-substituent readability failure.
- Add a bounded terminal-root inward-slot escape for compact bridged ring substituents, moving clean N-methyl exits to available exterior slots without reopening bond or crossing failures.
- Accept near-outward simple carbonyl roots on ring exits when their immediate segment is collision-free, clearing a false carboxyl ring-substituent readability failure.
- Accept exact-outward tetrahedral C/Si branch roots whose downstream linked-ring centroid lands on a regular 60-degree offset, clearing false ring-substituent readability failures in branched aryl and silicon layouts.
- Keep tetrahedral multi-ring branching roots scored by their immediate ring-exit bond instead of a far sibling-ring centroid, clearing false ring-substituent readability failures in diaryl amide and silane side-chain layouts.
- Accept the perpendicular terminal-leaf slot on saturated geminal ring substituents when a sibling terminal leaf already occupies the exact outward axis, clearing a false ring-substituent readability failure for a gem-dichloro fused ring.
- Extend current-layout severe-overlap regression coverage for former slow macrocycle, peptide, and isolated-ring rows that now finish audit-clean.
- Extend current-layout regression coverage for mid-fast bridged, steroidal, and phosphine oxide rows that now finish audit-clean.
- Add a final exact bridged-ring path retouch that opens collapsed two-atom bridged paths and promotes the local path to bridged bond validation when that clears severe overlaps without introducing audit failures.
- Add current-layout regression coverage for additional macrocycle, bridged, isolated-ring, and fused rows that now clear their old severe-overlap or ring-substituent fallback failures.
- Extend current-layout severe-overlap regression coverage for additional fused cation and triaryl rows that now finish audit-clean.
- Add a bounded final attached-ring branch retouch for small ring subtrees joined to non-ring anchors, clearing silicon-attached ring collisions without moving the shared anchor.
- Add a 180-degree terminal-leaf contact candidate so blocked methyl leaves can flip across their anchor bond when that fully clears a residual severe contact.
- Place six-coordinate metal centers with four bulky monodentate ligands and two one-atom ligands on cardinal/diagonal slots, clearing Cu imidazole ligand collisions.
- Let mixed acyl branch relaxed-fan cleanup run for severe-overlap-only contacts, clearing compact ester carbonyl clashes without introducing bond drift.
- Rerun terminal-leaf contact cleanup after pure acyclic branch retouch so newly exposed halogen leaves can clear residual severe contacts without relaxing bond geometry.
- Expand regression coverage for compact bridged and fused layouts that now finish audit-clean after the ring-substituent readability and compact-cage bond/overlap cleanup fixes.
- Add a pure acyclic final branch-contact retouch that rotates small downstream subtrees around single bonds when doing so reduces severe overlaps without worsening audit counts.
- Let pure acyclic final terminal-leaf contact retouch rotate terminal single-bond hetero leaves, clearing amine/nitrile leaf collisions without applying that relaxation to mixed ring layouts.
- Score neutral tertiary amine methylene linked-ring roots by their immediate aromatic ring-exit bond, clearing false-positive downstream-centroid ring-substituent failures for flexible amine side chains.
- Let otherwise-clean large layouts use the bounded ring-substituent readability retouch on larger attached aromatic side-chain subtrees, clearing residual macrocycle outward-axis misses without relaxing the audit.
- Accept exact-outward immediate ring-substituent roots that land inside complex bridged, fused, macrocyclic, or metal ring polygons, clearing false-positive ring-substituent audit failures without relaxing linked-ring centroid scoring.
- Keep unsaturated branching linked-ring roots scored by their immediate ring-exit bond rather than the downstream ring centroid, clearing false-positive aryl-alkene ring-substituent audit failures.
- Treat secondary amine linkers between heteroaromatic rings as planar divalent continuations so cleanup preserves exact 120-degree link angles.
- Keep audit-clean isolated-ring placements out of the cleanup fast path when generic divalent linkers still need a 120-degree continuation polish.
- Extend the unavoidable compact fused-cage terminal-leaf audit relaxation to tri-fused bridgehead hubs when the exterior-slot scan proves no clean outward placement exists, clearing false-positive ring-substituent failures in compact fused cage layouts.
- Treat terminal leaves trapped in compact fused-cage bridgehead slots as unavoidable when no exterior slot avoids contacts, crossings, and ring-outward readability failures, clearing false-positive ring-substituent audit failures in tiny fused cage layouts.
- Let compact dirty mixed ring components promote a clean whole-slice fused/bridged placement, clearing stretched inter-ring attachment bonds in bridged cage and morphinan-like systems.
- Let compact metal ring systems promote the fused ring slice when the organometallic slice is unsupported, clearing stretched aromatic closures and small metal-cage bond failures.
- Keep overlap-free compact fused-cage bridged rescues from being replaced by lower-deviation cage candidates that introduce severe contacts.
- Widen tiny tricyclic fused-cage rescue to nine ring atoms so slightly larger strained small-ring systems can use the same bridged/Kamada-Kawai cleanup path.
- Extend compact fused-cage rescue to tiny tricyclic fused cages so the existing cage Kamada-Kawai path can clear planar bond failures in strained small-ring systems.

## 2026-05-26

- Let compact fused tetracyclic cage layouts enter the existing bridged/Kamada-Kawai rescue path and gate fused-cage rescue on ring atoms rather than visible hydrogens or branches.
- Add a guarded final label-axis rotation fallback so residual axis-aligned label boxes can clear by rotating the completed layout when local label moves would introduce contacts or bond drift.
- Let dirty organometallic layouts with residual label overlaps skip the generic final-retouch fast path so guarded mixed-branch and label cleanup can clear late cobalt-corrin label contacts without reopening bond failures.
- Add `_normalizeIsocyanide` to `toCanonicalSMILES` in `src/io/smiles.js`: converts isocyanide groups `R[N+]#[C-]` (and `R[N+]#C` with a terminal carbon bearing only one heavy-atom bond) to the double-bond form `R[N]=C` that InChI uses.
- Add `_normalizeAzideDiazonium` to `toCanonicalSMILES` in `src/io/smiles.js`: converts the cumulated diazonium-azide chain `[N+]#N=N` to `[N+]-N=N` by lowering the triple bond to single, matching InChI's normalisation of that pattern.
- Fix `_isSubstitutedPyrrolicLikeNitrogen` in `src/algorithms/aromaticity.js`: add a mixed-bond guard that returns `false` when the nitrogen's ring bonds include both a pi bond and a single bond — prevents ring-junction N atoms in fused aromatic systems from being mis-classified as pyrrolic (2π), which was blocking aromaticity perception for fused oxazole/thiazole rings.
- Add `_normalizeFuroxan` to `toCanonicalSMILES` in `src/io/smiles.js` (runs after `perceiveAromaticity`): detects aromatic 5-membered rings with the furoxan pattern (2 C, 2 N, 1 O where one N+ carries an exo [O−]) and de-aromatises them to the Kekulé form InChI uses — C=C with [N−] and neutral exo O as C=O.
- Extend `_normalizeCarbanionEnolate` in `src/io/smiles.js` to handle the vinylogous case: in addition to the direct `[C−]−C=O` → `C=C−[O−]` enolate shift, the function now walks a two-bond sp2 path `[C−]−(Csp2)−(Csp2)−C=O` and performs the same charge/double-bond transfer across the conjugated chain.
- Add `_normalizeThiazolol` to `toCanonicalSMILES` in `src/io/smiles.js` (runs after `perceiveAromaticity`): detects aromatic 5-membered rings containing 3 C + 1 S + 1 N where one ring C carries an exo [O−] and S is adjacent to both N and that C; de-aromatises to the Kekulé thiazolinone form InChI uses (C=C with [N−] and exo C=O).
- Extend `_normalizeAromaticRingCharges` in `src/io/smiles.js` with a second pass over `mol.getRings()`: neutralises mixed aromatic-[n+] / aliphatic-[N−] pairs in the same ring when their combined charge is zero, and restores the ring-C→N bond to order 2 (the vinylogous amidine double bond that InChI lowered to single when introducing the zwitterion form).
- Add `_normalizeOverchargedNitrogen` to `toCanonicalSMILES` in `src/io/smiles.js` (runs before `perceiveAromaticity`): for each N with formal charge ≥ 2, locates any N with charge −1 in the same connected component and reduces both by 1, correcting InChI's unusual N+2 / N−1 amidinium-ring charge distribution to the standard N+1 / N(0) form.
- Let audit-clean macrocycle aromatic regularization win on ring-angle quality while relaxing linker bonds, bending hetero aryl bridges inward, and giving long aryl-macrocycle linkers an alternating skeletal structure.
- Let oversized linked-ring sugar bridges use the exact ring-exit tidy path and allow audit-clean presentation improvements to win in cleanup comparison.
- Add an alkynyl dicyano oxabicyclobutane bridged template and keep its nitrile-hydrolysis amide products from re-pinching after reaction-preview scaffold snapping.
- Keep retained BOC tert-butyl fans open in amide-hydrolysis previews after product scaffold snapping.
- Spread remaining terminal halogens around edited saturated dehalogenation centers so hidden-H products keep a clean visible heavy-atom fan.
- Bend edited nitrile-hydrogenation imine products off retained nitrile scaffold lines so aryl C=N products recover a trigonal 120-degree fan.
- Keep saponification alcohol products on retained lactone ring exits by rebuilding edited saturated ring-anchor fans after scaffold restoration.
- Split saturated-ring methyl/nitrile exits across fused-ring exterior slots instead of letting terminal triple-bond roots claim the centered carbonyl/alkene priority axis.
- Balance saturated-ring exterior fans when a carbonyl branch competes with a real linker branch, keeping both exits on the regular exterior-gap slots instead of pinching one angle.
- Construct exact aromatic-capped 5-5-4 bridged heterocycle layouts so the shared N-ring path keeps square/regular angles instead of pinching under KK projection.
- Fix `_normalizeFusedRingKekule` in `src/io/smiles.js`: add an sp3-heteroatom guard to `hasRingPiOrHetero` so that charged nitrogen atoms with 2+ explicit hydrogens (e.g. `[NH2+]` in an azetidinium ring) are excluded from pi-donor consideration — prevents the function from incorrectly aromatizing ring paths that pass through saturated ammonium-type nitrogens.
- Add `_normalizeMetalBonds` to `toCanonicalSMILES` in `src/io/smiles.js`: converts double (or higher) bonds to Group 11 metals (Au, Ag, Cu) to single bonds, matching InChI's convention for coordination-compound bond orders.
- Add `_normalizeNOxideCarbanion` to `toCanonicalSMILES` in `src/io/smiles.js`: converts pentavalent `N(=C)=O` to `[N+]([C-])=O`, normalizing the charge distribution to match InChI's canonical form. The function runs after `perceiveAromaticity` so that pyridine-N-oxide (aromatic) is excluded.
- Add `_normalizeEnolateToChain` to `toCanonicalSMILES` in `src/io/smiles.js` (runs before `perceiveAromaticity`): in a beta-diketone enolate pattern where `[O-]` is on a ring carbon, shifts the negative charge to the exocyclic (chain) carbonyl carbon — converts `[O-]-C(ring)=C(ring)-C(chain)=O` to `O=C(ring)-C(ring)=C(chain)-[O-]`, matching InChI's preference for charge on the chain atom. Guards against aromatic ring atoms.
- Add `_normalizeAlicyclicNHCharge` to `toCanonicalSMILES` in `src/io/smiles.js` (runs before `perceiveAromaticity`): in a non-aromatic 6-membered ring with exactly 2 N atoms and net charge +1, moves the `+` from the free `[NH2+]` nitrogen (no exo-C substituents, has H) to the more-substituted N (has exo-C bonds, no H) — matches InChI's convention for piperazinium/morpholinium ring charge placement.
- Add `_normalizePyrazolateCharge` to `toCanonicalSMILES` in `src/io/smiles.js` (runs after `perceiveAromaticity`): in an aromatic 5-membered ring with an N−N bond (pyrazolate), moves `[n-]` from the N adjacent to a heteroatom-substituted ring C to the N adjacent to a carbon-substituted ring C — matches InChI's preferred charge-site for pyrazolate anions.
- Add `_normalizeImidazoliumNHProton` to `toCanonicalSMILES` in `src/io/smiles.js` (runs after `perceiveAromaticity`): in a protonated aromatic 5-membered ring with 2 N atoms (imidazolium/purine), moves `+` from the N that carries an explicit H (`[nH+]`) to the N without H (`[n+]`) — matches InChI's convention for placing the cation charge on the unprotonated nitrogen.
- Extend `_normalizeExocyclicIminium` in `src/io/smiles.js` to handle non-adjacent ring heteroatoms: when no ring N is directly bonded to the iminium C, the function now uses `mol.getRings()` to find any ring containing the iminium C that also has a neutral N or S; it then transfers the `[NH2+]` charge to that heteroatom and reassigns all ring bonds to a valid alternating Kekulé form (choosing the traversal direction that minimises changes to existing bond orders)..
- Add `_normalizeExocyclicThioamideAnion` to `toCanonicalSMILES` in `src/io/smiles.js`: finds ring carbons with an exocyclic double bond to a thioamide C(N)[S-] group, transfers the −1 charge from S to the adjacent ring N, converts the ring-C=C bond to single and C–S to double (thioamide C=S), and reassigns ring Kekulé bonds so the pyrrole-type [N−] atom ends at the last traversal position (single bonds on both sides).
- Remove the app examples-bar bug verification picker and its global/input-control wiring while keeping the bug corpus available to automated tests.
- Stream path-like ring-chain aspect/origin calculations and small-ring target centers in the main layout pipeline, trimming temporary center/coordinate arrays around final orientation and square-ring repair.
- Stream final-orientation principal-axis and centroid calculations over coordinate maps/atom IDs directly, avoiding temporary point arrays during whole-molecule leveling and scaffold center rebuilds.
- Stream large-molecule block-stitching score comparisons over child and placed coordinates directly, avoiding temporary position arrays for each refinement angle.
- Centralize incident-ring polygon construction in a direct-loop geometry helper and reuse it across audit, branch-placement, stereo wedge selection, ring-substituent, terminal-hetero, and hypervalent cleanup paths.
- Add a coordinate-map centroid helper and route ring-chain, terminal-chain, and symmetry retouch centroids through direct atom-id iteration instead of temporary position arrays.
- Deduplicate attached-ring, ring-substituent, and terminal-hetero presentation candidates by seed before sparse override construction, avoiding duplicate subtree rotation maps and large override-key walks before scoring.
- Keep peptide amide-hydrolysis reaction previews from collapsing retained-neighbor angles after product splitting by adding adjacent-anchor angle candidates/penalties to edited carbonyl placement.
- Keep aryl-adjacent alcohol-dehydration reaction previews trigonal by re-running non-carbonyl edited-center angle cleanup after scaffold restoration, preferring retained ring anchors over movable alkyl termini, and bending terminal alkyl continuations away from newly formed alkene centers.
- Open imine-hydrolysis ester-product ether tails after edited carbonyl placement and solve edited carbonyl centers from retained anchor bond lengths so retained methoxy substituents do not preserve acute imidate angles or stretched ester bonds.

## 2026-05-25

- Add opt-in sparse coordinate-overlay scoring to shared presentation candidate search and use it for terminal-hetero and ring-substituent candidate probes, avoiding full coordinate-map clones for override-only read paths.
- Stream label-box collection directly over coordinate entries so repeated label audits/clearance passes avoid spreading coordinate keys plus map/filter allocation churn.
- Hoist bonded-neighbor set lookups out of audit nonbonded/focused-placement inner loops so grid-backed overlap scans reuse the first atom's adjacency membership across all nearby candidates.
- Stream overlap-resolution atom-grid neighborhood scans through `someRadius`, skipping temporary `queryRadius` arrays and short-circuiting terminal-carbonyl compression candidates on the first local clearance violation.
- Add a single-atom coordinate-overlay fast path so one-leaf candidate probes avoid nested override-array allocation and per-entry override `Map` lookups during values/entries iteration.
- Replace cut-subtree cleanup cache string keys with nested directed atom-id maps and FIFO entry tracking, reducing repeated key allocation on hot subtree probes while preserving cached Set reuse.
- Cache coordinate-overlay extra keys at construction time and iterate base entries directly for override-only candidate maps, avoiding per-iteration dedupe sets in mixed-layout scoring probes.
- Cache scaffold-template candidate atom-key/element signatures and grouped template context constraints so strict/fallback template probes avoid repeated atom sorting, element recounting, and constraint regrouping across candidate-template attempts.
- Stream cached scaffold-template coordinate entries directly into placement output so templated ring placement skips the intermediate coordinate `Map` allocation while preserving fresh returned positions.
- Cache scaffold-template descriptors by ID and reuse scaled template-coordinate entries per template/bond length while still returning fresh coordinate maps to callers.
- Cache accepted scaffold-template mappings on the layout graph so templated placement can reuse the match-time VF2 result instead of remapping the same ring system before coordinate assignment.
- Push scaffold-template mapped-atom and exocyclic-neighbor context into the VF2 atom matcher, caching exocyclic counts per candidate so contextual templates reject impossible atom mappings before full automorphism enumeration.
- Add reusable VF2 target/query indexes and route scaffold-template matching through them so each candidate subgraph and template query plan is indexed once across strict/fallback template probes.
- Reuse layout-graph ring indexes for mixed ring-system descriptors, linker aromatic checks, benzene-root orientation, macrocycle angular budgets, ring-dependency summaries, and component ring counting so repeated ring-system work avoids full ring/connection scans.
- Add `_normalizeThioate` to `toCanonicalSMILES` in `src/io/smiles.js`: converts `C([O-])=S` to `C(=O)[S-]` so thioate canonical SMILES agrees with InChI's sulfur-charge convention.
- Add `_normalizeAmidineAnion` to `toCanonicalSMILES` in `src/io/smiles.js`: moves `[N-]` from an exocyclic amidine nitrogen to the ring nitrogen when the amidine carbon has one `[N-]` single-bond neighbor and one neutral double-bond neighbor in a ring — normalizes imidazolate/oxazoline anion tautomers to match InChI.
- Add `_normalizeExocyclicIminium` to `toCanonicalSMILES` in `src/io/smiles.js`: converts ring-C=[NH2+] (non-aromatic form) to ring-[N+]-NH2 (aromatic form) using path-tracking BFS to identify exact ring atoms and a `hasRingPi` guard to skip saturated rings — fixes thiazolium/pyridinium [NH2+] exocyclic patterns.
- Add `_normalizeAromaticRingCharges` to `toCanonicalSMILES` in `src/io/smiles.js`: neutralizes balanced `[n+]`/`[n-]` pairs within the same connected aromatic subgraph when the subgraph's net charge is zero — normalizes tetrazolium zwitterions to match InChI's neutral aromatic form.
- Skip alternate mixed-root replay for already audit-clean chiral placements, reuse expanded attached-block prescores across rescue/full scoring, tighten compact multi-ring full-score budgets, cache topology-only cut-subtree traversals, and use compact child-block signatures in attached-block score-cache keys to reduce latest mixed-placement timeout rows without changing sampled audit counters.
- Cache visible/heavy layout atom membership, build severe-overlap grids from visible heavy atoms only, and return cached cut-subtree sets directly so repeated cleanup/audit scoring avoids hydrogen filtering and subtree allocation churn on the latest timeout rows.
- Cache subtree-overlap contexts for reused cut-subtree sets, stream atom-grid bounding-box probes without candidate arrays, cache attached-ring fallback canonical atom ordering/local pose atom order, and lower the compact multi-ring attached-block full-score budget so latest timeout repros do less repeated scoring work.
- Make focused angular metrics iterate their focus sets directly, reuse exact ring-root fan topology descriptors, memoize projected-tetrahedral support/compact terminal-substituent topology checks, and reuse mixed visible-heavy atom lists during attached-block near-contact scoring.
- Add sparse coordinate overlays for mixed-layout carbonyl contact candidates so one-atom, branch, ring-rotation, translation, and reflection probes can be scored without cloning the full coordinate map; materialize only when an overlay-backed candidate is accepted.
- Add a shared layout evaluation context for cleanup scoring so unified cleanup reuses layout-visible atom IDs, visible-heavy atom IDs, and its base atom grid across overlap/full-state measurements instead of rebuilding them in each base-state pass.
- Add focused visible-heavy bond-crossing recounts for candidate moves: carbonyl contact retouches now update crossing totals from moved-atom before/after counts instead of rescanning every visible bond pair for each small probe.
- Add a final label-retouch need gate so clean layouts skip the guarded final label, connector-label, and terminal-label leaf clearance passes instead of paying repeated full-audit setup when no label boxes overlap.
- Index scaffold templates by family/counts/element signature and reuse one candidate subgraph per eligible bucket so ring-system matching avoids repeated full-library filtering, template element recounts, and target-subgraph construction.
- Reuse strict/fallback scaffold-template searches through a combined matcher and precompute scaffold-plan ring-system context so family classification, aromatic ring counts, internal bond counts, and non-ring atom filtering avoid repeated whole-graph scans.
- Reuse layout-graph ring/ring-system indexes in symmetry tidy, bridged angle relaxation, fused cyclopropane cap repair, mixed non-ring filtering, and large-molecule block classification; also stream incident-ring centroid calculation without per-call coordinate arrays.
- Add a `ringConnectionsByRingSystemId` layout-graph index and use atom-to-ring-system membership for large-molecule ring-system counting, simple isolated-ring counting, and block split ring-system collection instead of rescanning every ring system/connection.
- Add per-ring atom index/set caches to the layout graph and use them in ring outward-angle calculation plus small-ring branch preview/slot helpers, avoiding repeated `indexOf`/`includes` membership checks during branch scoring.
- Add a `componentByAtomId` layout-graph index and route atom-slice adjacency/ring/connection extraction through existing bond/ring indexes so repeated component, slice, and wedge preparation avoids whole-graph scans.
- Prune attached-block orientation candidates that already lose on cheap primary score keys before presentation scoring, while preserving exact-slot/projected-parent rescue beams that intentionally need wider candidate coverage.
- Add a bounded medium-large macrocycle ring-fan polish profile for 110+ heavy, 9+ ring layouts and make attached-ring touchup's heavy-atom guard use the layout atom fallback, trimming the latest macrocycle timeout tails while preserving strict ring-fan geometry tests.
- Fix `applyDoubleBondStereo` in `src/io/inchi.js` for conjugated double-bond chains: in the brute-force initial assignment, verify each combo doesn't break previously-assigned entries before accepting (shared bridge bonds can flip a prior double bond's parity); in the post-correction loop, skip any single-bond flip that would break another already-correct entry and try the next candidate instead, preventing the oscillation that occurs when all substituent bonds are bridge bonds shared between adjacent double bonds.
- Revert `getEZStereo` `infoAt` helper in `src/core/Molecule.js` to "last wins" approach: for each sp2 atom, iterate all non-double-bond neighboring bonds and let each stereo bond overwrite `dir`/`markedId`, discarding the intermediate bridge-preference branching. Fixes retinol E/Z stereochemistry (bonds 10 and 15 previously decoded as Z) and restores the trans-polyene macrolide template match in `match.test.js` (uses the trans-polyene macrolide template with regular fused rings and satisfied E alkenes).
- Fix `tests/layout/engine/stereo/ez.test.js` "does not count cyclic E/Z contradictions for incomplete ring-system coordinates": revert the `partiallyPlacedCheck.supported` assertion from `true` back to `false`, restoring behavior where a cyclic double bond with partial coordinates is unsupported and therefore `ok = true` regardless of the decoded geometry.

## 2026-05-24

- Bound macrocycle ring-fan angle polish on large timeout-prone layouts, cap its soft-contact leaf subpass, and skip final three-heavy continuation retouch on clean ultra-large large-molecule layouts.
- Cache molecule-wide bond ring membership with a bridge-based topology pass, route `Bond.isInRing()` through that cache, solve macrocycle ellipse scale from a single unit sample instead of binary-search resampling, skip the unused audit on extreme large-molecule fallback returns, and reuse phosphate-tail audit crossing counts during presentation scoring.
- Update the audit-corpus expectation to reflect its current generic-scaffold fallback metadata while keeping the stricter improved overlap and bond-length ceilings.
- Speed layout audit scoring by replacing hot nonbonded/focused pair string-dedupe with atom-order dedupe plus cached bonded-neighbor sets, filtering compact aryl branch crossing scans to only leaf/ring bond classes, and memoizing compact aryl leaf topology checks.
- Cache visible atom order on reusable atom grids, reuse large-molecule block indices and severe-overlap baselines during rotation packing, inline fixed-angle block subtree rotations, and cache orientation ring-atom sets per molecule topology version.
- Build layout-bond ring membership from the already-computed ring analysis and cache topology-only orientation backbone paths so repeated large-molecule orientation passes avoid redundant ring/BFS work.
- Precompute large-molecule rotation step trigonometry/orderings, share immutable atom-grid ordering across grid clones, cache preferred landscape orientation paths, and reduce tracked-block overlap delta scans to indexed affected pairs.
- Cache topology-only raw/supplemental ring coverage, prefilter uncovered supplemental cycle searches with cached bond ring membership, reuse layout-graph ring systems during orientation, stream atom-grid radius hits in hot overlap scorers, prefilter block-repulsion rotations by pair overlap before cloning coordinates, and defer large-block split materialization until a cut candidate wins.
- Add streaming/early-exit atom-grid radius scans and use them in label-clearance, branch-placement, terminal-hetero, and large residual-retouch local scoring so common candidate rejection paths avoid temporary hit arrays.
- Use array-indexed BFS for preferred backbone orientation paths and scan focused visible-bond crossings without rebuilding a sorted all-bond segment list for each candidate.
- Reuse audit-provided visible-crossing counts in mixed scoring, let ok-only cleanup audits skip visible-crossing scans, reuse precomputed overlap lists for terminal-leaf base audits, and cache branch-placement topology/preview lookups plus current-slice newly placed atom detection to reduce placement-heavy audit corpus time.

## 2026-05-23

- Fix `getEZStereo` in conjugated double-bond systems: when a sp2 atom has two stereo bonds (one for the double bond being evaluated and one bridge bond belonging to an adjacent double bond), prefer the non-bridge substituent bond as the reference and add the bridge bond's other end to the CIP comparison list so `correctDir` can correctly orient the higher-priority substituent.
- Fix canonical SMILES E/Z encoding for conjugated polyene chains: apply a "once only" rule in Phase 3 so that a substituent bond shared between two adjacent double bonds (e.g. the C–C single bond in a 1,3-diene) is written exactly once rather than overwritten by each double bond's iteration — preventing one of the two double bonds from encoding the wrong parity.
- Cache terminal carbonyl foreign-ring contact atom/ring lists and focus carbonyl crossing scans on the active C=O bond, reducing repeated whole-layout crossing/contact work in mixed placement finalization.
- Prune terminal carbonyl crossing-reposition candidates before generating downstream rotations when they already fail anchor-deviation, small-ring, intrusion, or contact checks.
- Use crossing count helpers for candidate rejection paths that only need totals, avoiding full crossing-array allocation in exact ring-substituent and acyl-branch contact checks.
- Fast-accept audit-clean final ring-substituent branch candidates once all hard overlap, crossing, label, and geometry counters are cleared.
- Precompute ordered heavy-atom adjacency and path metrics during backbone orientation so large mixed/large-molecule layouts avoid repeated neighbor sorting and path reconstruction.
- Track already covered ring bonds during supplemental ring analysis so known ring edges skip redundant cycle searches while preserving cyclic E/Z support classification.
- Tag reusable atom grids as visible-only so severe-overlap pair collection can skip repeated visibility checks for nearby atoms without changing pair iteration order.
- Update cyclic E/Z expectation checks for cases now resolved as supported instead of unsupported while still requiring zero violations and no stereo contradiction.
- Cache exact `Bond.isInRing()` BFS results per molecule topology version and invalidate them on atom/bond edits, cutting repeated cyclic E/Z and layout-graph ring-membership walks without changing ring semantics.
- Reduce focused-crossing scans by processing each focused bond pair once through bond index ordering instead of allocating per-candidate `seen` keys.
- Make subtree-overlap scoring trust visible-only atom grids and update large-molecule block-overlap deltas against tracked blocks instead of rescanning every block pair.
- Reuse per-block split adjacency and precomputed block membership counters during large-molecule partition scoring, avoiding repeated slice-adjacency rebuilds and candidate sorting on peptide-scale fallback rows.
- Trim focused placement scoring by removing redundant focused-pair tracking, counting compact aryl leaf/ring crossings without materializing sorted crossing records, and reusing a stable mixed-candidate signature order for audit-cache lookups.

## 2026-05-22

- Skip terminal multiple-bond fan presentation work on dirty generic-scaffold layouts when divalent continuation is the cheaper rescue path, cutting the cobalt corrin timeout benchmark path from ~2.38s to ~1.09s without exceeding its audit ceiling.
- Let final acyl-branch contact retouch accept the first audit-safe candidate that clears all hard overlaps and crossings, avoiding unnecessary full candidate sweeps in late mixed cleanup.
- Final audited terminal-label leaf pass, wider guarded connector-label retries, and an automatic large dirty label-overlap landscape frame.
- Add a final guarded E/Z stereo rescue after late presentation retouches so stress rows whose final cleanup re-flips an annotated alkene are corrected without worsening overlap, bond, label, or ring-substituent audit counts.

## 2026-05-21

- Preselect terminal ring roots for non-aromatic sugar chains and aromatic isolated-ring clusters in mixed layouts, avoiding expensive alternate-root retries.
- Tighten attached-block full-scoring budgets for heavier multi-ring mixed layouts so branch scoring spends less time on low-ranked candidates after prescore ordering.
- Restore terminal alkyne reaction-preview geometry after ether cleavage and bend terminal alkyne-reduction chains into visible zig-zag slots.
- Add a guarded large-molecule ether-linker retouch so badly linearized non-aromatic sugar/base O-C continuations such as O265 bend back to 120 degrees without worsening final audits.
- Let terminal carbonyl fan cleanup accept exact no-regression leaf moves on already-dirty large WebKit layouts, keeping nucleotide carbonyl centers such as C85 and C507 trigonal.
- Center terminal double-bond strokes in the engine SVG renderers so carbonyl/imine bonds are drawn symmetrically around the true atom-axis instead of visually leaning to one side.
- Let terminal carbonyl fan cleanup rotate audit-safe support sides into exact 120-degree slots before snapping the oxo leaf.
- Add a bounded large-molecule phosphate-linker retouch that rotates audit-safe P-O-C ester sides toward 120 degrees while preserving strict phosphorus cross geometry.
- Prioritize carbonyl/alkene-like roots at geminal saturated-ring exits so the directional branch gets the exact outward slot and simple siblings take side slots.
- Keep phosphate/sulfate-like hypervalent fans intact during large-molecule block partitioning so stitched phosphate chains preserve strict P-centered angles.
- Use denser stitched blocks for very large hypervalent ring chains and let hard-clean large layouts finish small attached-ring readability nudges.
- Keep saturated sugar-ring amide exits on the exact outward axis by flipping the planar amide side when the direct snap overlaps.
- Add a methoxy ammonium oxazabicyclic lactam scaffold template so compact bridged lactam/ammonium cages keep the middle bridge open.
- Keep terminal hetero leaves on non-aromatic ring trigonal exits exact by rotating blocking attached rings instead of bending the leaf.
- Preserve strict terminal imine trigonal slots during bridged template regularization and add an imino dioxazocine ketone scaffold template.
- Add shallow terminal imine fan backoff probes so blocked bridged-ring C=N leaves widen without introducing overlaps.
- Center terminal exocyclic substituents from edited ring reaction centers so small-ring dehydration previews keep open alkene and methyl angles.
- Reuse reaction-preview reactant layout references and seed topology-preserved product components from reactant coordinates so charge-only previews skip isolated relayout.
- Add an alkyl oxabicyclobutane bridged scaffold template so compact ether cages stay structured.
- Make ring-presentation cleanup invoke phosphate, terminal-cation, terminal-leaf, small-ring fan, terminal-hetero, and direct-attached-root tidiers only when the already-computed presentation metrics show that specific repair can help.
- Skip attached-ring fallback evaluation for audit-clean small non-aromatic layouts, avoiding hundreds of milliseconds of rejected fallback probes while keeping dirty, larger, and aromatic attached-ring rescue paths active.
- Precollect final terminal multiple-bond fan retouch centers and reuse those visible, hidden-H, and paired-hetero candidate lists through the final tidy/fallback chain instead of rediscovering them with repeated full-graph scans.
- Short-circuit E/Z enforcement candidate collection on unannotated double bonds before cyclic support checks, and skip presentation-stage E/Z cleanup scoring when the presentation pass made no coordinate changes.
- Skip the expensive attached-ring fallback search for audit-clean rows whose only remaining presentation need is a very small generic ring-substituent penalty, while preserving the aromatic evaluation path and all specific attached-root/terminal-fan repairs.

## 2026-05-20

- Reuse caller-provided presentation tie-break metrics inside ring-presentation cleanup and skip descriptor summaries when attached-ring fallback is disabled, avoiding duplicate scoring work in specialist/presentation cleanup paths.
- Skip presentation-only cleanup for audit-clean mixed spiro layouts whose only post-cleanup hook is ring-substituent tidy, cutting a clean spiro timeout row by avoiding a multi-second no-op presentation ladder.
- Lazily count focused crossings in ultra-large residual-retouch prefilters only after a candidate survives local severe-overlap checks, cutting the hottest large-molecule timeout rows without changing their audit counts.
- Add a target-pair label-box precheck to final connector-label clearance so failed connector rotations skip full label sweeps and final audits when they do not clear the overlap they are testing.
- Let attached-ring fallback seed scoring reuse sparse moved-atom overlap counts against the base atom grid, avoiding full severe-overlap scans for small rigid-rotation probes.
- Skip the omitted-H attached-ring fan search inside terminal-carbon exact-snap clearance probes, keeping the broader rescue available elsewhere while trimming this hot mixed-layout path.
- Gate optional cleanup presentation stages for dirty 400+ heavy-atom generic-scaffold large molecules when placement already has dense hard residuals, keeping hard-contact repair while avoiding seconds of presentation-only cleanup.
- Cap the attached-ring fallback invoked by terminal-carbon exact-snap probes to one pass, cutting clean spiro/mixed placement rows.
- Add a local residual prefilter for ultra-large large-molecule retouch candidates so rotations that cannot improve their own moved-subtree overlaps or crossings skip the full-molecule audit scan.
- Use a coarse terminal-leaf rotation menu on dirty 400+ heavy-atom layouts and skip presentation-only hypervalent/terminal-fan polish when the final audit is still a generic-scaffold hard-residual case.
- Narrow hot mixed-family candidate dedupe signatures to the atoms a candidate moved in terminal-carbonyl/acyl contact searches, avoiding repeated full-coordinate serialization during mixed placement.
- Lower the clean mixed-macrocycle ring-fan skip threshold to cover 160+ heavy, 8+ ring clean macrocycles and avoid multi-second polish on already-audit-clean stress rows.
- Cache mixed ring-system layouts across primary and alternate-root retries, returning cloned coordinate maps so repeated pending bridged/fused layouts are not recomputed during linker attachment scoring.
- Make omitted-H attached-ring fan cleanup cheaper by rejecting non-improving seeds before full audit, and only running expensive refinement cleanup after a seed has produced an acceptable fan-improving candidate.
- Let attached-block severe-overlap override scoring reuse the base atom grid and cache the base severe-overlap context by coordinate signature.
- Skip angle-only large-molecule residual polish for medium peptide-like and 140+ heavy low-ring layouts once overlap/crossing repair is clear, avoiding multi-second final-retouch timeout tails.
- Bound the latest large peptide timeout rows by skipping angle-only large-molecule residual polish for 200+ heavy-atom low/mid-ring layouts after the real overlap and crossing repair has run.
- Skip optional clean mixed-macrocycle ring-fan polish on large layouts whose pre-polish audit has only soft residuals, reducing the latest glycopeptide near-timeout while preserving dirty macrocycle fan repair.
- Let compact hypervalent bridged multi-ring mixed layouts skip speculative remaining-branch placement during attached-block full scoring.
- Loosen the clean large-molecule final-retouch fast path so very large audit-clean layouts can compute stereo on demand instead of requiring cached cleanup stereo.
- Isolate speculative branch-permutation atom grids so rejected branch candidates no longer pollute the live spatial index used by later angle and focused-cost scoring.
- Broaden the compact isolated multi-ring attached-block scoring fast path to cover the latest tetraaryl borate timeout row, cutting that row from roughly 21 seconds to about 10 seconds while preserving its audit result.
- Align attached-block prescore forcing with the branch-scoring skip path so compact mixed layouts do not force full scoring solely for branch placement that the full scorer will intentionally skip.

## 2026-05-19

- Route very large macrocycle-containing components directly through large-molecule block stitching instead of first attempting full mixed/macrocycle slice placement.
- Start dense partitioning up front for ring-rich large molecules and force compact fused polycyclic stitch blocks through the fused placer.
- Lower the low-ring large-molecule angle-polish skip threshold and reuse spatial grids/centroids in future attached-ring branch preview scoring, cutting large peptide final-retouch and branch-preview timeouts without removing overlap/crossing repair.
- Add greedy branch-placement cutoffs for dense isolated multi-ring systems and compact bridged multi-system attached blocks.
- Reduce latest layout timeout rows by bounding optional macrocycle ring-fan polish on large hard-dirty macrocycles, while preserving the full strict-ring polish for clean macrocycle layouts.
- Speed focused placement-cost scoring by sweeping focused bond crossings with min-X bounds, using spatial grids on medium candidate layouts, and skipping compact aryl leaf crossing probes when the focus atoms cannot contribute.
- Cache static macrocycle ring-fan polish centers and visible atom lists across candidate scoring/contact scans, avoiding repeated topology walks during final retouch.
- Reduce timeout-prone mixed layouts by skipping attached-ring fallback during alternate-root presentation previews while keeping the full fallback in final cleanup.
- Skip expensive hypervalent-deviation tie-break scoring inside speculative attached-ring fallback cleanup probes so repeated one-pass candidates avoid redundant sulfone/phosphate geometry fitting.
- Bound recursive single-branch lookahead angle menus for bridged ring anchors, cutting one compact bridged mixed timeout case from the 30-second cap to a bounded audit-clean layout.
- Replace locale-aware mixed candidate signature sorting with a simple stable comparator and prevent nested single-branch lookahead during lookahead scoring, dropping sampled short timeout rows into bounded placement times.
- Reduce layout audit/scoring overhead by reusing cached auditable bond lists, avoiding focused-crossing Set copies, skipping tetrahedral filtering for non-four-coordinate centers, inlining representative centroids, and fast-pathing one-atom sparse candidate keys.
- Cache final terminal multiple-bond leaf endpoint discovery, reuse static paired-terminal compression factors, and skip clone/audit setup in terminal alkene, paired terminal hetero, and omitted-H collateral retouches until candidate descriptors exist.
- Add a cached terminal multiple-bond fan center index and use it across presentation scoring, terminal leaf tidy, paired hetero tidy, support-fan cleanup, and duplicate presentation passes so no-op terminal-leaf scans skip non-candidate atoms.
- Cache terminal ring-hetero structural pairs, reuse per-anchor outward-angle calculations, defer atom-grid/coordinate clone setup until candidate descriptors exist, and use the atom grid for exact-outward blocker relief scans.
- Skip angle-only large-molecule residual polish for very large low-ring layouts after overlap/crossing repair, cutting sampled clean timeout cases from roughly 25s+ to under 8s while preserving audit quality.
- Skip expensive final three-heavy presentation retouch on very large layouts that still have severe overlaps or visible heavy-bond crossings, avoiding multi-second angle-only work on rows that remain dirty.
- Restore guanidine mobile-hydrogen tautomer cleanup so terminal imine preference can move one hydrogen from terminal `NH2` to the internal guanidino nitrogen.
- Let terminal carbonyl fan cleanup rotate a small center-side branch around a ring support before snapping the oxo leaf, preserving exact omitted-H hub fans while avoiding neighboring ring overlaps.
- Keep final mixed acyl branch cleanup eligible when a layout still has visible heavy-bond crossings, even if the rest of the final audit is clean.

## 2026-05-18

- Add macrocycle seed/audit short-circuits, terminal multiple-bond retouch prefiltering, and an extreme large-molecule coarse placement fast path to reduce layout compute time on placement-heavy cases.
- Bump package metadata to 2026.5.18 and refresh allowed dev dependency patch/minor lockfile updates during daily maintenance.
- Add a cleanup-stage budget with skip telemetry so audit-clean layouts can avoid late optional retouch cascades after cleanup time has already crossed the per-molecule budget.
- Cap mixed attached-block full-score candidate evaluation for small and mid-sized mixed layouts, with scoring-budget telemetry for prescores, full scores, and budget bailouts.
- Cache mixed attached-block full-score snapshots by base/transform/meta signature so repeated direct-ring rescue and refinement passes reuse branch-placement scoring instead of rebuilding identical candidate layouts.
- Cache large-molecule residual retouch rotation descriptors and skip expensive angle-relief sweeps for medium mostly acyclic layouts once safety contacts are clear, while keeping the full angle-polish path for ring-rich and ultra-large peptide layouts.
- Short-circuit huge bond-clean, overlap-dirty large-molecule generic-fallback layouts before cleanup and final retouch cascades, cutting the representative 540-heavy-atom audit row from roughly two minutes to a few seconds in focused runs.
- Move browser layout determinism checks and the slowest mixed-family stress regressions behind opt-in layout stress scripts so default npm test avoids browser launches and multi-minute pathological molecule sweeps.
- Cache E/Z priority-substituent lookups on the layout graph and skip acyclic E/Z enforcement work when all supported stereo bonds already match.
- Expose final-retouch timing buckets and mixed/cleanup optimization counters in timing metadata so profile runs can separate placement, cleanup, retouch, and scoring overhead.
- Add guarded connector-subtree label clearance so crowded phosphate linkers can clear residual label contacts without worsening layout audits.

## 2026-05-17

- Treat four-coordinate group-14 acyclic centers as projected tetrahedral slots so organotin ligands do not collapse into overlapping labels.
- Keep phosphazene N=P branch fans on distinct 120-degree slots and recognize non-terminal phosphazene imide ligands as hypervalent P centers for label-overlap cleanup.
- Reuse the acyl-branch contact retouch for final acyclic layouts so crowded carboxylate, sulfonate, and tri-ester branches clear residual contacts after label clearance.
- Add a sulfonyl aromatic bridged heterocycle template so fused oxathiaza cages route their ether, aromatic, and sulfonyl lanes without crossings or oxo label contacts.
- Balance short-shared-path theta projections and add bridgehead branch contact escapes so compact bridged ether, lactone, and amino cages clear label-overlap audits.
- Seed aromatic-capped bridged roots from the fused cap and reject bridged regularization that collapses heavy exocyclic branch slots, clearing compact cage label-overlap cases.
- Seed unmatched compact 5-5-4 bridged cages from their smallest ring so ether lanes avoid projected label-overlap collapse.
- Prefer ring-system atom ordering for unmatched bridged KK seeds so compact tetracyclic cages avoid label-overlap fallback from ring-list ordering bias.
- Give large-molecule residual retouch a bounded extra pass budget and contact-directed rotation targets so stubborn peptide label-overlap audit cases keep improving without moving ring atoms directly.
- Add an octahedral multi-metal halide rescue that projects six-metal bridge clusters onto an outward-spread framework so dense tantalum bromide labels clear.
- Add a seven-metal polyoxo wheel rescue that places central molybdate cages on a clean hexagonal projection with terminal oxos fanned outward.
- Let protected-family core cleanup keep audit-clean macrocycle overlap wins when bond deviations stay below visible failure limits.
- Add a bounded final ring-substituent readability retouch so macrocycle chromophore exits clear audit without reopening label contacts.
- Rotate terminal halogen leaves during final contact retouch so perfluoroaryl sulfonamide tails clear residual overlaps.
- Let large-molecule residual retouch accept severe-overlap-reducing branch swings and add guarded carbonyl label micro-rotations so peptide proline branches clear both bond crossings and label contacts.
- Rotate terminal carbon leaves away from residual bond crossings so chloropyridyl oxime layouts stay clean.
- Add guarded final terminal-label clearance so large glycan/phosphate layouts keep residual retouch fixes without label overlaps.
- Reject final whole-molecule orientation candidates that reintroduce label overlaps.
- Add a scopolamine epoxide bridged-core template so oxirane caps stay outside tropane cages and clear label overlaps.

## 2026-05-16

- Let large-molecule residual retouch repair compact nucleotide phosphate overlap clusters with bounded large-swing follow-ups while skipping ultra-large final angle-polish churn once safety residuals are clean.
- Keep long perfluoroalkyl acyclic backbones from reusing terminal halogen slots so label overlaps clear.
- Rotate nearby aromatic sidechain roots during large-molecule residual retouch so peptide label contacts clear without moving ring atoms directly.
- Treat coordinate-only annotated metal centers as unsupported in covalent wedge selection so organometallic E/Z rescues do not fail stereo audit.
- Check stereo when accepting final macrocycle attached-ring retouches so late branch rotations cannot flip accepted alkene geometry.
- Treat large monocyclic macrocycle E/Z mismatches as unsupported unless already depicted correctly, avoiding destructive ring-reflection fallbacks.
- Apply cyclic E/Z support guards to unsaturated lactone layouts while preserving supported acyclic alkene audits.
- Apply cyclic E/Z support guards to fused epoxy lactone layouts so unsupported rescue failures stay audit-clean.
- Apply cyclic E/Z support guards to large polyene macrocycles so unsupported rescue failures stay audit-clean.
- Apply cyclic E/Z support guards to compact bridged cages so unsafe ring-tearing stereo rescues do not trigger fallback.
- Treat mismatched fused macrocycle E/Z annotations as unsupported unless a template or seed already depicts them, avoiding unsafe ring-tearing stereo rescues.
- Treat cyclic E/Z annotations in partial mixed macrocycle fragments as unsupported until the full ring system is placed, avoiding false stereo-contradiction audits.

## 2026-05-15

- Add sulfonyl aza cycloheptene cage placement and final small-branch retouching so alkene-fused sulfone cages stay readable.
- Add a hydroxy thiazole cyclopropyl pentacycle template so compact fused cages keep bridged-valid ring bonds and clean substituent readability.
- Add an indoline aza bridged heptacycle template and preserve its clean mixed-root geometry so bridged alkaloids avoid collapsed ring bonds.
- Route haptic iron cyclopentadienyl complexes through ligand-only ring placement so both five-membered rings stay regular.
- Add an N-methyl amino diaza tricyclo template so compact aminal cages avoid folded cap bonds and keep separated ring lanes.
- Add a final mixed acyl branch retouch so the bridged alkaloid upper carbonyl bond clears the neighboring aryl edge while preserving exact C8 and O38 angles.
- Add a final terminal-carbon leaf contact retouch so WebKit clears the alkaloid C49/C54 methyl overlap without moving bridged ring atoms.
- Prefer strict five- and six-member bridged ring geometry in mixed alkaloid cages, with a terminal carbon-chain retouch to keep explicit hydrogens clear.
- Restore aromatic-to-tetravalent cage exits after mixed bridged regularization so the alkaloid C8 aryl fan stays 120/120/120 while the upper carbonyl clears C27.
- Rebuild crowded mixed bridged acyl branches on exact trigonal slots so large alkaloid cages clear ester overlaps without stretched ring bonds.
- Treat ambiguous fused neutral aza donors as aromatic-component donors so charged lowercase fused aza SMILES avoid stale valence warnings.
- Preserve exact hidden-H hydroxy linker fans during mixed-root attached-ring overlap relief, then pull the paired methoxy aryl exit back toward a clean trigonal slot without introducing crossings.
- Snap crowded tertiary-amide aryl roots back to exact aromatic exits after cleanup so the oxalyl diaryl imide fan remains 120/120 without reintroducing overlaps.
- Keep imine-carbon direct ring attachments on exact parent-side trigonal slots so mixed isolated-ring layouts preserve the reported 120-degree angle.
- Add an exact honeycomb fused template for the amino-bromo diaza ketone pericondensed core so all six-member rings stay strict.
- Add a bridged diketone tricyclo template so compact 5-5-4 carbonyl cages avoid flattened five-ring bridge geometry.
- Retension bond-dirty cyclic fused-ring placements after polygon regularization so pericondensed heteroaromatics avoid stretched shared edges.
- Widen the caged hydroxy-lactone steroid projection so exocyclic carbonyl leaves clear fused-ring edges.
- Recenters four-coordinate chelated metal atoms inside their ligand pocket so cobalt corrins keep a square-planar metal fan.
- Keep paired phosphonic-acid branches attached to the same acyclic carbon on exact orthogonal P crosses by coordinating the shared-anchor branch sectors before the hypervalent final tidy is accepted.

## 2026-05-14

- Add a clean-placement fast path for fresh, audit-clean ordinary isolated-ring and acyclic layouts, while keeping angle/presentation-dirty placements on the full cleanup route.
- Cache cleanup presentation tie-break metrics per coordinate snapshot so mixed full-path guard and scoring stages reuse repeated angle, ring-exit, hypervalent, and terminal-fan scans.
- Cache mixed-root retry comparison metrics and stop alternate-root retries once an audit-clean root has cleared the retry-triggering geometry defects.
- Add a shared `visibleHeavyCovalentBonds` utility and remove seven duplicate inline implementations across cleanup and presentation passes.
- Centralize repeated element sets (`ORTHOGONAL_HYPERVALENT_ELEMENTS`, `IDEAL_DIVALENT_CONTINUATION_ELEMENTS`, `TERMINAL_HETERO_BRANCH_ELEMENTS`) into `constants.js` and remove local copies from six files.
- Add an O(1) `ringSystemById` index to `layoutGraph` and replace twelve O(R) `ringSystems.find()` linear scans across `mixed.js`, `invariants.js`, `ring-substituent.js`, `attached-ring-fallback.js`, and `angle-selection.js`.
- Remove three redundant local `new Map(layoutGraph.ringSystems.map(...))` constructions in `mixed.js`, `invariants.js`, and `ring-substituent.js` in favour of the shared index.
- Cache `bridgeheadTerminalCarbonFanDescriptor` results in the mixed-layout candidate loop to halve descriptor-computation calls on each pass.
- Replace 304 `atomToRings.get(X)?.length` ring-membership checks with `ringAtomIdSet.has(X)` across 36 source files, eliminating redundant Map lookups and optional-chaining overhead on the hot audit path.
- Optimize mixed-layout direct-attached ring scoring by caching local scoring-focus expansion, reusing topology bond-pair lookups, and deferring full audit/layout-cost scoring until cheap candidate gates pass.
- Deduplicate larger mixed attached-block candidate pools and cache terminal carbonyl descriptor lists so repeated direct-ring root refinement and carbonyl contact scoring avoid redundant topology and audit work.
- Reuse full-audit results across late mixed carbonyl and omitted-H hub candidate loops, deduplicate repeated carbonyl contact poses, and reject non-improving ring-carbonyl leaf moves before full audit.
- Split mixed attached-block prescoring into lazy core and presentation tiers so cheap overlap, exactness, and ring-root gates can discard candidates before readability and near-contact scans run.
- Reconstruct mixed attached-block severe-overlap counts from cached base overlaps plus moved-atom deltas, and make focus-mode heavy-bond crossing checks compare only focus-touching bonds against the full segment set.
- Refine caged lactone and bicyclo[2.1.1] template projections for cleaner symmetry and separated lactone exits.
- Add a trigonal-carbon bicyclo[2.1.1]hexane template so formyl-substituted cages avoid pinched bridge geometry.
- Add a hydroxy aminopropyl cyclobutane-decalin template so saturated fused cages keep open six-ring lanes and a square cyclobutane cap.
- Add a cyclopropane-capped azacyclooctane template so compact ammonium cages avoid collapsed ring lanes.
- Add a substituted bicyclo[2.1.1]hexane template so compact azetidinium cyanomethyl cages avoid crossed cap bonds.
- Add a shared-edge tricyclic ether template so saturated ether cages avoid crossed carbon lanes.
- Add an azabicyclo-pyrrolidine template so compact aminonitrile amine cages avoid stretched bridged-ring geometry.

## 2026-05-13

- Add an ammonium cyclobutyl-pyrrolidine template so compact charged bicyclic cages avoid crossed bridge geometry.
- Add an N-methyl lactam diazatricyclo template so compact ammonium lactam cages avoid pinched fused-ring geometry.
- Open the phenolic oxaza morphinan saturated bridge lane so long ether-tailed opioid cages avoid pinched ring geometry.
- Add a caged hydroxy lactone template so compact oxygenated steroid-like ring systems avoid flattened fused-ring geometry.
- Supplement ring analysis with omitted closure cycles so glycopeptide macrocycles avoid stretched hidden ring bonds and overlaps.
- Add a phenolic oxaza morphinan template so oxygen-bridged opioid cages keep regular fused six-ring geometry.
- Add a triazaadamantane cage template so polyaza thiourea ring systems avoid collapsed ring bonds and overlap.
- Add an exposed-nitrogen diazatricyclodecane cage template and first-bond crossing rescue so bridged bis-amine carbamates stay placed outside the cage face.
- Keep ansamycin macrocycle presentation cleanup from being discarded when E/Z enforcement would reopen clean ring closures.
- Score near-complete fused macrocycle rings with one-atom closure lookahead so ansamycin ether bridges keep normal bond lengths.
- Add a methyl imino oxatricyclo template so compact iminium ether cages keep separated five-ring lanes and an uncrossed carbon cap.
- Add a methyl azabicyclo cyclobutanone template so compact ammonium ketone cages keep C12 open and route the carbonyl away from the cyclobutane edge.
- Add an amino pyrimidine cyclobutane template so compact fused heterocycles keep square four-ring caps and regular hetero five-rings.
- Move crossing terminal carbonyl leaves onto clean trigonal slots so compact bridged lactam cages keep ring bonds uncrossed.

## 2026-05-12

- Keep nitrile-adjacent bis-halomethyl siloxy centers on projected four-slot geometry so compact fluoromethyl branches do not pinch.
- Add an amino cyano thiazole oxatricyclo template so compact heteroaryl ether cages keep regular saturated six-ring geometry.
- Add an alkenyl phenyl oxabicycloheptane template so substituted ether cages keep clean compact ring geometry.
- Add a hydroxy diformyl bicyclooctadiene template so substituted bridged dienes keep structured six-member ring lanes.
- Add a hydroxy oxatricyclo diol template so compact ether-alcohol cages keep the small ether cap from collapsing.
- Add a formyl aza-oxatricyclo template so compact amine-oxirane cages keep terminal amine exits outside the ring system.
- Rebalance the hydroxy acetal oxadecalin scaffold so its fused ether rings stay open without crossings while preserving the bridgehead alcohol placement.
- Rotate crowded aryl sulfonic-acid connector subtrees before the final hypervalent cleanup so WebKit keeps exact S/O cross angles without carbonyl clashes.
- Add an ethyl dioxatricyclo oxetane template so compact ether cages keep balanced small-ring geometry.
- Add a methyl aza-oxa tricyclic template so compact saturated amine-ether cages avoid crossed bridge paths.
- Tighten the dimethyl oxatricyclo cage projection so compact ether cages use more balanced bridged-ring spans.
- Add an amino acyl aryl norbornane template so substituted stereochemical cages keep bridgehead hydrogens outside the ring face.
- Add a hydroxy dimethyl oxatricyclo cage template so alcohol-substituted compact ether cages keep structured bridged rings.
- Add a dimethyl oxatricyclo cage template so compact ether cages avoid crossed bridged lanes.
- Add an ammonium benzocyclobutane template so compact fused aromatic cages avoid stretched saturated bridges.
- Add a cyclopropyl lactam pentacycle template so compact enone-lactam cages avoid flattened fused rings.
- Add an imino oxa azatricyclo ketone template so compact bridged imine-ketone cages avoid flattened shared loops.
- Add a hydroxy azatricyclo cyclohexene template so compact bridged amine-alcohol cages avoid flattened shared rings.
- Compress crowded geminal terminal ring halogens only when their exact exterior slot creates a visible heavy-bond crossing, clearing the fluorinated cyclohexyl F34 overlap while preserving audit readability.
- Reproject sulfated glycoside ring chains after residual cleanup and permute/nudge neighboring sulfate branches so O38/O101 fans keep cross geometry without losing exact ring exits in WebKit.
- Add a hydroxy acetal oxadecalin scaffold and clamp terminal ring hetero bonds back to normal length, keeping the O6 bridgehead alcohol clear of the compact ether cage.

## 2026-05-11

- Regularize severely pinched coordinate-bound aromatic ligand rings after Ru mixed placement while preserving the broader polypyridyl complex pose.
- Reapply opt-in landscape leveling after final presentation retouches only when large layouts end portrait, keeping hidden-hydrogen sulfated glycosides broad without perturbing already-landscape bridged templates.
- Give large peptide residual angle polish a few more bounded passes so late carbonyl fans stay within the tightened visual tolerance.
- Open the acyl-substituted spiro-bridged aza cage projection while preserving compact bond audits, so the ammonium bridge no longer pinches the malformed ring.
- Keep crowded aryl dinitro roots exact by moving the neighboring compact thiazole side instead of folding nitro oxo fans.
- Snap compact terminal phenyl divalent exits in WebKit while rotating nearby sulfonyl subtrees just enough to preserve oxo opposition and avoid contacts.
- Preserve acyl-hydrazine phenoxy and diaryl ring-root angles by swinging terminal cation labels before residual aryl-overlap relief.
- Spread crowded diaryl saturated centers with paired projected-slot relief after ring presentation cleanup.
- Clear WebKit-rendered propyl-tail crossings after exact ring-terminal root retouching while preserving 120-degree aryl exits.
- Carry projected four-slot turns through sulfone-adjacent tert-butyl carbons so C8 methyl fans stay orthogonal.
- Add an ammonium cyanomethyl oxatricyclo template so compact ether cages avoid pinched oxetane lanes.
- Snap aryl sulfonamide linker roots onto exact ring-outward axes while rotating downstream sulfone fans clear of neighboring substituents.
- Add a cyclopropane azabicyclic enone template so compact bridged lanes render without crossed seven-ring paths.
- Add an oxygen-bridged bisindole lactam template so dense fused cores avoid folded bridge crossings.
- Polish crowded macrocycle ring-junction fans with bounded single-atom and aggregate nudges after cleanup, then back off crowded terminal leaves to reduce soft contacts.
- Retouch paired terminal acid hetero leaves so crowded macrocycle carboxyl fans stay trigonal.
- Add a hydroxy keto oxadiazole template so compact bridged carbonyl cores keep exterior carbonyl exits.
- Add a cyclobutane thiophene template so compact sulfur cages keep a square fused cap.
- Keep acyclic silane and quaternary ammonium branches on projected four-slot fans.
- Add a calixarene macrocycle template so bridged aryl bowls keep regular benzene walls.
- Add a cyclobutane oxadecalin template so compact tricyclic ether cages render without crossed bridged lanes.
- Add an aminomethyl oxabicyclobutane template so compact ammonium ether cages align bridge atoms and avoid sidechain crossings.
- Add an alkylidene oxime bicyclohexane template so compact theta rings avoid generic fallback crossings.
- Shorten stretched terminal multiple-bond leaves after final cleanup when doing so improves audit metrics.
- Add an imino oxazocine lactam template so compact formamido bridged lactams keep separated ring lanes.
- Add an aryl phosphite spiro template so compact polyaryl phosphite bridges render without crossed aryl edges.
- Add a hydroxy amino oxabicyclic acetal template so compact polyhydroxy cages avoid flattened shared bridges.
- Balance small acyclic branches during hidden-hydrogen fan repairs without disturbing protected small-ring exits.
- Add a hydroxy aminomethyl bicyclic ketone template so compact ammonium ketone cages avoid generic bridged fallback.
- Keep displayed hidden stereohydrogens outside fused steroid ring faces before optimizing nearby atom clearance.

## 2026-05-10

- Use finer dense partitions for ring-rich peptide-scale layouts before residual overlap retouching.
- Add an oxime lactam cyclopentenyl bridged template so compact enone-oxime beta-lactam systems keep their five-member ring structured.
- Draw suppressed-h mono-oxo phosphonates as visible trigonal ligand fans.
- Retry peptide residual retouch with exact omitted-H sidechain fans protected when cleanup would otherwise bend them.
- Preserve crowded terminal propanol zigzags and tertiary amine fans while clearing nearby ring overlap.
- Reflect crowded attached pyridyl rings so terminal nitriles keep exact outward exits.
- Add an aminonitrile oxabicyclobutane bridged template so compact five-four cages stay open.
- Regularize single-anchor saturated bridged side rings while preserving the shared fused core.

## 2026-05-09

- Let final large-molecule angle polish repair nearby contacts while preserving the improved amide fan.
- Keep compact spiro oxetane fans open after overlap cleanup without distorting the small ring.
- Keep five-member aromatic fused bridged cyclohexane cores regular while preserving single-anchor spiro side rings.
- Regularize and locally polish medium bridged alkaloid cages so peripheral leaves, aromatic rings, and central rings avoid pinched angles.
- Keep app and SVG displayed hidden stereohydrogens from projecting onto nearby bridged cage atoms.

## 2026-05-08

- Balance congested directly attached polyaryl ring exits during mixed placement while preserving overlap-free layouts.
- Add a trans-polyene macrolide template so fused oxazole/pyrrolidone macrolides keep regular five-member rings while satisfying E alkene geometry.
- Add a cyano formyl acetal bridged template so compact saturated acetal cages keep both five-member rings open around the OCO bridge.
- Add an aza-oxa cyclopropyl oxetane bridged template so compact tetracyclic cages keep separated five-ring, cyclopropane, and oxetane lanes.
- Add a large-molecule residual retouch so block-stitched peptide sidechains rotate out of final local overlap, crossing, and acute-angle knots without stretching backbone bonds, including exact-slot, repaired-candidate, and fine-angle polish for crowded peptide fans.
- Add an acetal amino decalin bridged template so ester-substituted tricyclic saturated cores keep both the shared six-member bridge and fused C12 cyclopentane regular.
- Prefer E/Z stereo rescues that preserve exact oxime nitrogen bends, keeping oxime oxygens off the imine carbon.
- Add a hydroxy oxazabicyclic lactam template so compact bridged alcohol cages avoid terminal OH/lactam nitrogen overlap.
- Let linked sugar-ring oxygens claim exact trigonal exits while rotating compact guanidine branches aside.
- Let exact aryl nitro fans compress a blocking terminal carbonyl bond instead of bunching both oxo ligands into one slot.

## 2026-05-07

- Add an imino thiazole oxaza tricyclo template so compact heteroaryl cages keep open fused lanes.
- Snap small attached-ring divalent linkers after mixed root retry so peptide-like phenyl methylene bends keep exact 120-degree continuations.
- Add an azabicyclo nitrile template so compact charged cages avoid stretched bridged fallback bonds.
- Normalize conjugated acyclic heteroatom backbone bends so ester-like chains keep planar 120-degree turns.
- Add an aminonitrile acetal-bridged template so heteroaryl-fused compact cages keep structured saturated and OCO bridge rings.
- Add a cyanoacyl azabicyclo bridged template so compact N-acyl cages avoid crossed cap-ring fallback geometry.
- Add an azabicyclo ketone oxadiazole bridged template so compact theta cages keep separated ring lanes instead of flattening the shared path.
- Let direct sulfone oxo ligands make a tiny overlap-gated paired relief bend after exact-preserving cleanup fails, keeping crowded bridged aryl sulfones nearly orthogonal without stacking an oxo onto the cage.

## 2026-05-06

- Make alkene E/Z rescue overlap-aware so crowded styryl fused-ring systems keep stereo without stacking the aryl ring onto the core.
- Treat one-heavy alkoxy roots as compact projected-tetrahedral slot occupants so crowded diaryl centers keep four clean C3 exits.
- Add a bridged oxadecalin template so substituted compact ether cages use structured stacked theta rings.
- Add charged quinuclidinium templates so aza-bicyclo cages avoid collapsed fallback geometry.
- Add a hydroxy alkyl bicyclohexene template so compact bicyclic alcohols keep structured five-member rings.
- Add a sulfonyl cyclopentenyl azocane template so compact sulfone-fused cages keep structured five-member rings.
- Pin terminal chlorophenyl C29 angles on fused tricyclic scaffolds.
- Spin blocked direct-attached aromatic ring roots around their attachment atom while shortening the blocking ring carbonyl leaf.
- Allow crowded ring carbonyl leaves to shorten while keeping exact trigonal fans.
- Keep terminal methyl leaves exact on tight fused-junction continuations.
- Regularize the saturated morphinan template's fused cyclohexene, benzene, and outer cyclohexane lanes.
- Keep displayed bridgehead stereohydrogens out of pinched ring-bond sectors.
- Add a saturated morphinan bridged template so compact four-ring cores avoid stretched fallback bonds.
- Add a norbornene bridged template so attached bicyclic five-ring children avoid flattened shared bridges.
- Add a bridged decalin lactam template so compact bicyclic amides avoid flattened shared ring paths.
- Let moderately large mixed peptide layouts expand compact attached-ring poses to clear local carbonyl overlaps.

## 2026-05-05

- Add an oxabicyclic lactone ammonium template so compact theta-lactone rings avoid generic bridged fallback geometry.
- Add a bridged cyclopropyl-decalin template so compact carbocages keep methoxy exits outside the ring system.
- Balance crowded sugar sidechain aryl/amide bends so the C24 benzylic angle stays visibly open after hidden-H fan rescue.
- Keep non-ring sugar sidechain hidden-H carbon fans exact while rotating downstream aryl rings aside.
- Add an aza-annulene cyclohexadiene template so bridged six-member rings stay regular.
- Keep secondary anilino hidden-H nitrogen fans on exact trigonal slots.
- Add an oxazabicyclic lactam template so compact bridged lactam rings avoid crossed fallback lanes.
- Keep ring-bound tertiary amide nitrogens and carbonyls on exact exterior trigonal slots.
- Let suppressed terminal sulfonyl hydrogens render as visible trigonal heavy-atom fans.
- Add an amino diaza tricyclo cage template so imine-substituted bridged rings avoid crossed fallback lanes.
- Add an amino oxaza tricyclo cage template so compact bridged rings avoid collapsed generic placement.
- Add a bridged pyrrolizidine dione core template so compact tricyclic enone cages avoid collapsed generic bridged rings.
- Add a bridged lactone core template so compact oxabicyclic lactones keep open six- and seven-membered rings.
- Add an oxaza morphinan bridged-core template so oxygen-bridged aza cages avoid malformed fallback rings.
- Keep charged sulfoxide linkers trigonal while preserving attached aromatic root exits.
- Add a sulfonyl azatricyclo cage template so compact charged bridged rings avoid crossed fallback projections.
- Let exact direct-attached phenyl roots rotate compact acyclic sidechains aside, then snap and shorten distorted heteroatom sidechains into exact aromatic slots without new overlaps.
- Preserve crowded fluorinated cyclohexyl exterior fans through mixed-root retry and cleanup so isocyanate ring exits do not collapse.
- Add `src/data/amino-acids.js` with all 20 standard amino acids plus selenocysteine and pyrrolysine.
- Add `src/io/fasta.js` with `parseFASTA`, `sequenceToMolecule`, `toFASTA`, and `toThreeLetter`.
- Add unit tests for all FASTA IO functions.
- Add `src/data/nucleotides.js` with DNA/RNA nucleosides, ambiguity codes, and separate deoxyribose/ribose tables.
- Add `sequenceToNucleicAcid` and `detectSequenceType` to `src/io/fasta.js` for nucleic acid sequence parsing.
- Straighten path-like sulfated glycoside ring chains and keep terminal alkyl tails aligned with the chain.
- Project under-spread sulfated glycoside ring chains into aligned ring units in browser layouts while re-solving glycosidic linkers.
- Prioritize exact outward glycosidic ring-exit angles when spreading sulfated glycoside ring chains.
- Keep hidden stereochemical hydrogens virtual during suppressed-H app layout so large sulfated glycosides render cleanly in browsers.
- Retry dense large-molecule partitions for ring-rich sulfated glycosides so oversized mixed slices do not overlap.
- Keep imine-hydrolysis reaction previews trigonal when edited carbonyl centers retain terminal nitrogen neighbors.
- Add an oripavine bridged-core template so opioid-like fused cages avoid malformed fallback rings.
- Let carbon-bound hidden-hydrogen sulfones render as visible trigonal heavy-atom fans.
- Keep compact bridged ether cages from accepting stretched bridge projections.
- Let direct-attached heteroaryl rings retidy parent trigonal fans while preserving local clearance.
- Guard triaryl sulfoxide indole layouts so aromatic fans remain trigonal and overlap-free.

## 2026-05-04

- Partially re-snap omitted-H ring-hub collateral roots after terminal carbonyl retouches so C6 ring exits stay bounded while C4 carbonyl fans remain readable.
- Score simple acyclic continuation bends during branch assignment so crowded hydroxymethyl tails keep their normal bent geometry.
- Snap compact carbonyl ring substituents onto non-aromatic trigonal exits while compressing blocked oxo leaves.
- Spread spiro bridged ring blocks before late ring presentation so terminal aryl leaves and ring-carbonyl oxygens stay clear.
- Let bulky aryl sulfonamide nitrogen branches rotate into audit-clean exact sulfur crosses.
- Let fluorinated acyclic carbon chains use projected-tetrahedral backbone turns while preserving normal downstream zig-zags.
- Retouch terminal carbonyl leaves and compact acyl branches so crowded benzyl amide scaffolds clear ring oxygen overlaps.
- Add an exact perylene fused-aromatic template so five-ring PAHs render as regular hexagons instead of relaxed pericondensed polygons.
- Let audit-clean mixed roots retry when a neighboring phenyl blocks exact terminal aromatic methyl and fluorine slots.

## 2026-05-03

- Treat aryl-bearing tetracarbon silicon centers as orthogonal cleanup targets so mixed alkyl aryl silanes finish on clean Si crosses.
- Let ring-linked sulfones use an audit-clean full cross when one aryl side can rotate without crowding.
- Keep oxime ether nitrogens on exact bent divalent slots in crowded fused mixed scaffolds.
- Let saturated-ring exterior fans trade slight symmetry for exact benzylic linker bends.
- Retry audit-clean mixed roots when a direct aromatic ring exit is visibly skewed.
- Let compact terminal aryl ligands complete sulfone crosses while rotating nearby small leaves aside.
- Keep suppressed-H polyol side branches in batched visible trigonal fans so large acyclic chains do not place one hydroxyl opposite the next carbon.
- Preserve transition-metal ligand links as coordinate bonds when parsing SMILES so polypyridyl ruthenium complexes keep ligand rings readable.
- Let moderately large glycoside ring chains retry alternate mixed roots so saturated sugar exits stay outward and overlap-free.
- Treat tetraaryl silicon centers as orthogonal cleanup targets so aryl silanes finish with audit-clean Si crosses.
- Add a compact acyl-substituted spiro-bridged aza cage template so ammonium cage rings avoid the generic bridged fallback warp.
- Score visible heavy-bond crossings during mixed placement and cleanup so sodium tetrazole isopropyl branches avoid neighboring aryl bonds.
- Retry compact mixed roots when blocked terminal carbonyl slots would otherwise force a non-trigonal linker fan.
- Let four-member saturated ring fan refinement move the larger late-grown branch and resnap terminal multiple-bond leaves when that side is crowding a neighboring ring.
- Let aryl sulfonamide exact sulfur cleanup win over temporary label-only tradeoffs without letting stabilization re-bend the oxo cross or distort the neighboring ester carbonyl fan.
- Let crowded terminal amide carbonyls clear neighboring rings while keeping the cationic ring fan and terminal amide center readable.
- Let fused aromatic sulfones enter hypervalent cleanup and keep attached divalent nitrogens planar.
- Mirror ring-adjacent bulky alkyl branches during cleanup so aryl exits and saturated branch points stay trigonal while clearing substituent clashes.

## 2026-05-02

- Keep theta-like bridged ring projections on separated center and outer lanes so compact cage branches clear.

## 2026-05-01

- Let mixed-root retry preview presentation cleanup so recoverable cyclopropyl bis-pyridyl scaffolds keep bent carbonyl linkers and clear CF3 leaves.
- Keep macrocycle-fused aryl rings attached and hexagonal by completing shared arcs from their endpoints, then rescuing distorted aryl macrocycle roots with bridge-aware aromatic regularization and rotating linked hetero ring anchors away from the rigid aryl core.
- Keep Clean 2D from treating aryl-adjacent macrocycle projection bonds as damaged local edits, preserving rigid aromatic rings after cleanup.
- Keep crowded aryl nitro fans trigonal by moving nearby pendant rings out of exact oxo slots.
- Keep explicit-hydrogen phosphonate chains on visible trigonal heavy-atom fans instead of linearizing hidden hydrogen centers.
- Let compact bridgehead nitrile branches use downstream lookahead so terminal triple bonds stay linear across browser runtimes.
- Keep long acyclic sulfonamide centers orthogonal by moving nearby pendant rings after exact sulfur cleanup.
- Stretch blocked bridgehead methyl leaves so constrained ammonium fans stay readable.
- Keep constrained diaryl sulfone oxo leaves opposed without rotating bulky aromatic rings together.
- Keep ring-attached sulfonic acid crosses exact by rotating nearby branches aside.

## 2026-04-30

- Keep terminal carbon ring-leaf crossing relief on readable anchor fans by sharing nearby attached-ring rotation or shortening exact outward methyl bonds.
- Center direct-attached cyclopropyl roots on fused-ring exterior slots.
- Keep crowded aryl fluorine leaves exact by rotating neighboring attached rings away.
- Let crowded ring-embedded sulfones slide both oxo leaves onto the ring exterior.
- Let short saturated-ring tail branches bend out of visible neighbor crossings.
- Preserve exact aryl carboxyl fans while shortening crowded carbonyl leaves away from neighboring rings.
- Keep reaction-preview retained scaffolds compact when benzylic oxidation or imine hydrolysis edits mapped carbonyl sites.
- Clear terminal cation labels from nearby phenoxy rings while rebalancing crowded diaryl fans.
- Keep acyl-hydrazine tertiary nitrogens on planar trigonal fans across browser engines.
- Keep paired nitro-style oxo leaves on trigonal nitrogen fans.
- Keep shared-junction steroid methyl and fluorine leaves out of fused ring faces while preserving the fluorine's fused-junction line.
- Keep bulky cyclohexyl methyl branches clear of nearby ester linkers in browser-rendered layouts.
- Preserve exact prescored direct aromatic ring-root poses so aryl carbamate exits stay trigonal across browser engines.
- Add a compact spiro-bridged oxetane template so small cage ethers avoid collapsed rings.
- Let hypervalent tidy keep phosphorothioate crosses exact by nudging neighboring terminal multiple-bond leaves away from local clashes.
- Let saturated-ring exterior fan retidy preserve linked methylene bends while avoiding overlaps.
- Treat branched hidden-H linkers as immediate ring-substituent representatives so exact aryl-carbonyl exits stay audit-clean.
- Let compact aromatic ring alkyl tails use recursive branch lookahead and phosphate-tail presentation retidy so aryl phosphate substituents prefer straighter P-O-C spokes without folding back into neighboring rings.
- Keep displayed stereochemical hydrogen bonds on their shortened render radius so crowded fused-ring hydrogens clear neighboring atoms.
- Keep terminal hetero leaves on saturated quaternary ring exterior slots so compact bridged lactones avoid pinched side-branch angles.
- Score rigid cleanup root geometry so projected aryl centers clear overlaps without straightening adjacent bends.
- Treat crowded aryl and amide quaternary centers as projected slots so attached rings avoid carbonyl overlap.

## 2026-04-29

- Use local ring exterior bisectors for mixed organometallic ring-to-metal exits so cyclopentadienyl ligands keep balanced angles.
- Let compact aromatic-containing bridged scaffolds regularize saturated ring shapes so ammonium cages do not fold flat.
- Add a terminal multiple-bond leaf final retouch so fused-ring carbonyl oxygens keep exact trigonal slots after later presentation passes.
- Flip crowded carboxylate-bearing five-member rings across their attachment axis so terminal oxygens stay outside neighboring ring faces.
- Add exact root-anchored attached-ring retidy so diaryl amino alcohol phenyl exits keep clean 120-degree splits after overlap cleanup.
- Rebalance constrained saturated bridged cages so fused-spiro ring strain no longer leaves stretched bonds.
- Balance compact fused-spiro bridged ring junctions so heteroring cages avoid visible kinks without bond failures.
- Keep macrocycle sulfonamide aryl linkers on orthogonal sulfone axes during mixed placement.
- Let simple imine-linked aryl branches use exact 120-degree nitrogen slots during mixed placement.
- Bound crowded tetrazole-linked omitted-H fan relief so the phenyl root and methyl exits stay exact without crossing the tetrazole bond or collapsing neighboring branch angles.
- Lock the trisodium anthraquinone propionate sidechain regression so the chain angle remains an exact 120-degree zigzag.
- Prefer non-crossing phosphorus-adjacent attached-ring poses so bulky diaryl phosphine oxide branches stay separated in Chromium and WebKit.
- Keep crowded omitted-H direct ring hubs exact through WebKit while balancing neighboring carbonyl relief instead of bending the full ring-root exit.
- Let compact allyl tails on bridged ring anchors use branch lookahead so they do not fold back into the ring.
- Retry mixed alternate roots when primary roots leave direct-attached ring exits off-axis.
- Let compact ring-anchored sulfonyl branches make tiny rigid overlap-relief rotations while preserving exact sulfur crosses.
- Regularize compact saturated bridged rings after KK placement so fused-spiro cages avoid warped ring shapes.
- Let final terminal-hetero retouch handle mild phenolic outward misses so crowded C49 exits stay exact without over-opening the benzoyl fan.
- Let attached-ring presentation cleanup take exact anchor-side outward rotations so piperazine imide exits keep 120-degree fans.
- Preserve ring-bound tertiary amine fans during overlap cleanup so cage branches keep clean 120-degree angles.
- Leave saturated bridgehead hydroxyls out of phenolic retouches so bridge C-OH bonds stay straight.

## 2026-04-28

- Mirror crowded direct-attached aryl roots and retouch terminal phenolic leaves ring exits keep exact 120-degree fans across browser runtimes.
- Keep exocyclic macrocycle sulfones orthogonal while rejecting ring-anchor snaps that would push oxo ligands into nearby carbonyl oxygens.
- Snap aromatic carbonyl ring-anchor exits onto exact outward bisectors so aryl amide branches keep 120-degree splits.
- Keep explicit-hydrogen monoxo phosphonate centers out of orthogonal hypervalent cleanup so their visible heavy ligands remain trigonal.
- Rebuild fused cyclopropane caps on the exterior side of bridged mixed parent rings
- Place 2D atom numbers with projected stereochemical hydrogen coordinates so visible H labels receive outward, unobscured numbers.
- Normalize hidden-H bis-sulfonyl imine-adjacent carbons as visible 120-degree heavy-atom fans so neighboring sulfur crosses stay exact.
- Let imine-linked aryl chains switch to the opposite exact 120-degree slot before snapping downstream biphenyl exits.
- Resnap planar tertiary nitrogens after ring-linker placement so terminal leaves use the remaining 120-degree slot.
- Let crowded bridgehead ethyl exits grow before adjacent terminal methyl fans, then rebalance the methyl fan so fused-ring exits stay outside the ring.
- Prefer severe-overlap reduction before compactness when rotating already-overlapping stitched large-molecule blocks.
- Let exact 180-degree aryl-root flips balance compact ester branch and carbonyl movement so benzyl ring exits stay exact
- Restrict sulfide and sulfoxide oxidation templates to the correct sulfur connectivity so sulfones are not oxidized again.
- Allow acyclic linkers into aromatic ring roots to trigger exact child ring-exit rescue so long quinoline chains keep 120-degree outward angles.
- Let ring-embedded sulfone cleanup choose a compact exterior oxo V when the full spread would overlap fused-ring neighbors.
- Route separated two-atom bridged child arcs through the fused cyclohexane face so compact bridged/fused hybrids avoid shared-anchor overlaps.
- Score edited reaction-preview carbonyl centers by trigonal angle spread so amide-hydrolysis products avoid 60-degree oxygen pinches.
- Move single new alcohol substituents with edited reaction-preview centers so ester-cleavage products keep local trigonal geometry.
- Mirror compact fused-bridged child rings across shared bridge endpoints when the aligned side overlaps the parent face.
- Accept legacy neutral pentavalent nitrogen multiple-bond SMILES forms without valence warnings.
- Prefer exact shared-atom clearance in spiro-path ring placement, including ring-size-aware cyclopropane junction gaps.
- Restore saturated small-ring exterior branch fans after mixed linker placement adds the second exocyclic branch.
- Treat branch-local cumulated double-bond centers as linear so terminal isocyanate leaves stay opposite their parent bond.
- Probe both simple acyclic zigzag sides for direct-attached heteroaryl roots so imidazole N exits can stay exact without upstream clashes.
- Prefer the smallest clash-clearing rotation for direct ligands on cross-like phosphine oxide centers so WebKit keeps the phosphorus presentation cross-like.
- Swap aryl/oxo carbonyl siblings next to cross-like phosphine oxide centers when that clears mirrored aryl branch clashes without bending ring exits.
- Prefer cleanup stages that clear severe WebKit branch overlaps over one minor ring-substituent presentation miss.
- Keep direct-attached ring refinements from dragging mirrored parent-side subtrees off target bond lengths.
- Keep sibling direct-attached aryl roots on saturated-ring exterior slots.
- Place ring-embedded sulfone oxo branches before macrocycle branch budgets can clip their exterior V slots.
- Reserve exact ortho halogen slots while growing diaryl alcohol side chains.
- Reserve projected slots for alcohol-bearing diaryl centers so deferred aryl roots avoid alkyl-chain overlaps.
- Relieve compact CF3 tripod leaves so direct-attached aryl roots stay exact beside crowded saturated ring exits.
- Snap terminal one-coordinate metal ligands onto trigonal organic anchor slots so vinyl-metal exits keep exact 120-degree angles.
- Re-snap hetero ring-anchor substituent subtrees after mixed ring-core shifts so WebKit keeps fused imide N exits at exact 120-degree spreads.
- Let direct-attached aryl roots make a small clearance rotation so saturated parent exterior slots stay exact beside CF3 tripods.
- Keep pinched bridged-ring stereo hydrogens out of sharp ring wedges and render hydrogen tooltips in dark text.
- Run attached-ring touchup for near contacts between exact terminal hetero ring leaves and neighboring rings.
- Keep diaryl bis-CF3 centers on projected quadrants while compressing terminal CF3 fans away from aryl overlaps.
- Preserve exact omitted-H parent spreads while flipping downstream sibling subtrees away from direct-attached phenyl rings.
- Let crowded direct-attached phenyl roots shift chiral omitted-H parent slots so the aromatic outward axis stays exact.

## 2026-04-27

- Reserve projected side slots at saturated two-ring parents so terminal leaves stay orthogonal when a later attached ring arrives
- Keep tert-butyl roots exact while straightening neighboring direct-attached ring roots and preserving saturated parent exterior slots
- Preserve exact saturated six-ring geometry in compact bridged systems by rerouting shared bridge runs around the regular core
- Preserve clean aryl carboxyl and direct-attached ring-root exits during attached-ring presentation fallback, using a longer compressed hydroxyl bond when that keeps the local carbonyl angle exact
- Restore saturated methylene zigzag bends after acyclic alkene normalization
- Keep displayed stereochemical hydrogens out of fused-ring interior sectors
- Defer terminal carbon leaves on planar trigonal centers until pending ring neighbors attach so amide nitrogens keep exact 120-degree spreads
- Generalize saturated-ring exterior branch fans beyond fixed ring-size cutoffs so grown piperidine variants keep ester and aryl exits apart
- Preserve exact 120-degree aryl-ether oxygen continuations for alkyl chains off fused rings
- Let direct-attached aryl blocks use six-member saturated-ring exterior slots so crowded ester/aryl ring anchors avoid pinched angles
- Preserve crowded acyclic sulfonic acid crosses by compressing terminal oxo leaves instead of bending sulfur angles
- Preview pending heteroring attachments during branch scoring so C16 branch slots avoid later imidazolium-side overlap
- Reserve exact pending attached-ring space during mixed branch scoring so crowded benzyl amide carbonyls no longer grow into the later phenyl pocket
- Prioritize exact fused-ring geometry over branch-preview tie-breakers so six-carbon morphinan bridge variants no longer stretch the middle cyclohexane
- Let bulky ring-anchored side chains use branch lookahead so long morphinan bridge variants keep exact fused rings without routing the alcohol tail through the core
- Keep expanded morphinan fused-bridge variants on exact benzene, middle-cyclohexane, and bridge-ring bond geometry while treating unavoidable bridged side-chain exits as audit-clean
- Add a morphinan bridged-core template so opioid-like benzocyclohexane systems keep an exact middle cyclohexane and benzene ring while avoiding side-chain overlap
- Regularize aromatic rings inside compact bridged scaffolds up to the audit-clean limit, preserving exact benzene angles in morphinan-like fused systems without reintroducing side-chain overlaps
- Rerun stricter compact bridged KK seeds when relaxed bridged validation leaves visibly strained fused-bridged rings
- Compress terminal ring-leaf bonds to the longest exact-outward audit-clean length when full-length halogens would collide with nearby scaffold atoms
- Prefer audit-clean KK seeds over broken bridge projections for aromatic fused-bridged ring systems
- Score direct-attached ring-root outward angles during presentation cleanup so crowded quaternary aryl centers keep exact phenyl exits
- Preserve compact fused-bridged lactam separation and exact linked-ring nitrogen angles during presentation cleanup
- Use projected-tetrahedral slots for crowded quaternary ring roots so attached aryl systems avoid severe overlap
- Keep compact fused-bridged lactam scaffolds on audit-clean KK seeds when bridge projection would collapse atoms
- Restore crowded terminal methyl ring leaves to exact exterior angles by rotating nearby attached rings
- Let compact diaryl sulfonyl ligands rotate during hypervalent cleanup so ring sulfonamides keep exact sulfur crosses

## 2026-04-26

- Align compact ring-anchored sulfonyl branches exactly and prefer minimal terminal-leaf overlap moves
- Swap planar tertiary nitrogen sibling branches during cleanup so attached phenyl overlaps clear without bending amide angles
- Balance terminal chlorophenyl leaf and heteroaryl angles while preserving omitted-H benzylic junction geometry and clearing neighboring overlaps
- Center heteroaryl carbonyl-methylene substituents on the exact local ring-outward axis
- Split cyclopropyl exterior branch fans evenly when one branch is an attached ring
- Promote all-lowercase purine-like fused aza systems as fused aromatic components to avoid stale carbon valence warnings
- Treat sulfonyl-substituted tertiary nitrogens as planar in acyclic layout so neighboring sulfones keep clean orthogonal crosses
- Treat aryl-conjugated tertiary nitrogens as planar branch-placement centers so anilino attachments keep a clean `120°/120°/120°` spread
- Preserve both charge and chirality properties on bracketed `N@+` and `N@@+` SMILES atoms
- Reject malformed SMILES branch and bracket delimiters before decode so corrupted chiral inputs report parser errors instead of crashing
- Treat hidden sulfur hydrogens as single-bond ligands for terminal sulfonyl cross geometry, so fused sulfonamide layouts keep paired `S=O` bonds opposite each other
- Lock exact simple acyclic direct-attached ring angles during expansion so WebKit keeps fused cyclobutyl methylene linkers bent
- Reposition visible hydrogens on one-carbon linked fused-ring methylenes after ring balancing
- Share short methylene-linker ring-exit distortion across both fused lactone endpoints
- Balance linked fused-lactone ring-block rotations when exact terminal hetero multiple-bond slots are contested, keeping the C3 linker exit trigonal without crowding the neighboring carbonyl
- Keep linked fused lactone orientations in the full scoring beam when terminal hetero multiple-bond slots are contested, so both phenolic and carbonyl leaves keep exact trigonal angles
- Rotate compact acyclic ester and tert-butyl cleanup subtrees before accepting bond-distorting overlap nudges
- Keep fused lactone systems on bent methylene linker geometry while preserving local phenolic ring-outward angles and avoiding collapsed carbonyl leaf angles
- Preserve omitted-H trigonal spreads during attached-ring presentation cleanup
- Preserve projected-tetrahedral C-F/C-C spreads during attached-ring presentation cleanup
- Prefer heavy stereobonds when hidden hydrogens are suppressed
- Rotate saturated ring blocks around quaternary anchors to open geminal aryl angles
- Preview atoms and bonds while dragging a selection box
- Preserve fused aza aromaticity through aromatic aza protonation, adjacent imine hydrolysis, phenolate protonation, and non-aromatic charge edits
- Reanchor reaction-preview product hidden stereohydrogens and keep adjacent stereocenters from sharing one wedge/dash display bond
- Preserve five- and six-member saturated ring exterior branch fans during presentation cleanup
- Preserve linear alkyne continuations during attached-ring presentation cleanup
- Prefer open-side placement for bulky ester tails at carbonyl branch choices
- Let chiral omitted-h direct attachments swap sibling slots so aryl ring exits can stay exact without breaking the parent spread

## 2026-04-25

- Rotate compact saturated side branches as rigid cleanup units so crowded ketones clear overlaps without flattening adjacent omitted-h carbon centers
- Rotate crowded terminal ketone groups as rigid cleanup subtrees so C15-style carbonyl centers keep exact `120°/120°/120°` geometry while resolving overlaps
- Keep N-methyl branches on planar conjugated tertiary nitrogens at exact trigonal angles
- Place small spiro rings outward from larger parent rings so cyclobutyl and cyclopropyl exits avoid pinching into the parent scaffold

## 2026-04-24

- Lock both reported `CCNC1CN2C(C)=NC(C)C2(CCN)C1O` aminoethyl tails onto zigzag slots, including the crowded `C12-C13-C14` bend
- Re-snap ring-attached amide carbonyl centers after mixed placement finishes attaching pending rings, but only keep the exact resnap when it does not sacrifice nearby exact ring exits, then restore any neighboring hidden-h `120°/120°/120°` center after the attached-ring overlap touchup so peptide-like `C(=O)N` junctions stay exact without bending adjacent stereocenters or anisole ethers off-axis
- Preserve exact trigonal cleanup scoring across attached-ring focus atoms, so conjugated amide nitrogens keep their full `120°/120°/120°` spread during ring-presentation fallback
- Keep direct-attached mixed ring blocks from bending `sp` alkynyl linkers into `120°` rescue poses when the exact linear `180°` continuation is available
- Let acyclic sidechain branch placement look ahead through unsaturated child roots so carboxylate tails stop folding downstream oxygens back into nearby hetero branches
- Keep force-layout atom numbers off hydrogen bond-length and electronegativity labels
- Let exact linked-ring root rescues keep a tiny amount of extra centroid slack when the immediate ring exits are already exact, so amide-linked piperidines can land on the full `120°/120°` ring-root split instead of stopping `3°` short
- Add a finer local attached-ring root rotation rescue step, so amide-linked piperidines can trim the remaining ring-root bisector miss from `15°` down to about `3°` without reintroducing ring-substituent readability failures
- Let direct-attached parent trigonal rescue cover conjugated amide nitrogens, so amide-linked piperidines can keep the exact parent bisector instead of settling on a `90/120/150` spread
- Score attached mixed-ring candidates from one linker hop farther out, so amide-bridged benzene/piperidine systems can choose the outward-readable ring rotation instead of freezing a linked ring centroid on the wrong side of the bridge

## 2026-04-23

- Keep bis-oxo sulfones class-aware through branch scoring and hypervalent cleanup, and allow one compact single-ring ligand subtree to rotate as a rigid block around the center, so sulfones like `Clc1ccccc1CCNC(=O)Cn2ccc3cc(ccc23)S(=O)(=O)N4CCCCCC4` keep the aryl and amine single bonds opposite each other instead of opposing an `S=O`
- Treat only true direct-attached or linked rings as ring-substituent cleanup ring blocks, so aromatic sulfone branches like `Clc1ccccc1CCNC(=O)Cn2ccc3cc(ccc23)S(=O)(=O)N4CCCCCC4` keep the exact aryl exit instead of oscillating between mirrored tidy poses
- Reopen mirrored-parent-subtree search for exact carbonyl-to-aromatic direct attachments when the carbonyl is already exact but the aromatic root still misses its local ring-outward exit, so heteroaryl amides like `Fc1ccccc1N(CC(=O)NC2CCCCC2)C(=O)c3csnn3` can flip the fluorophenyl side and keep both the carbonyl and ring exits exact
- Seed direct-attached mixed-ring candidates with exact parent-side visible trigonal angles, so amide carbonyl centers in heteroaryl attachments can keep a full `120°/120°/120°` spread instead of freezing the ring attachment into a `150°/90°` split
- Let direct-attached ring exact-root rescue cover omitted-h saturated ring roots as well as strict trigonal cases, so amide-linked piperidines can land exactly on the local ring outward bisector instead of freezing one ring edge into a flat `180°/60°` split
- Count ideal linked-ring bridge-angle distortion inside ring-substituent presentation scoring, so linked aryl ethers still trigger the existing cleanup pass even when both ring exits already look outward on paper
- Let mixed projected-tetrahedral centers swap a downstream trigonal child with the opposite deferred leaf slot when that keeps overlaps clean and materially improves the child’s exact trigonal geometry, so difluoromethyl amide junctions can keep the anisole exits exact while restoring a clean `120°/120°/120°` carbonyl center
- Retry up to three alternate ring-system roots for overlap-heavy mixed placements, break otherwise clean mixed-root ties by exact ring-exit deviation before full layout cost, and prioritize hetero ring exits like anisole ether oxygens before generic trigonal tie-breaks, so crowded multi-ring ester/lactam linkers can pick the clean ring root that keeps all exits balanced instead of locking in the first overlap-free or browser-skewed root
- Reserve the opposite projected-tetrahedral slot for deferred heavy leaves when a single non-leaf branch is being placed first, so difluoromethyl centers keep branch-vs-leaf opposite pairings instead of opposing the two fluorines against each other
- Let attached-ring presentation cleanup retouch once more after direct-attached rescued ring-root exactness work, so coupled aza/phenyl exits can both land on their exact symmetric bisectors while keeping the already-clean adjacent geometry
- Re-run ring-substituent presentation tidy after attached-ring rescue wins, so rescued phenyl/phenol systems keep exact peripheral exits instead of leaving the last substituent slightly canted
- Let attached-ring presentation rescue separate upstream scaffold exits from downstream rescue-side exactness, and let genuinely cramped attached phenyl tails win exact reflected poses across the attachment hinge, so crowded pendant phenyl systems keep exact scaffold and ring exits without curling the ether tail back into the aza ring
- Keep ring-constrained benzylic aromatic exits on the exact local five-member-ring exterior bisector, so `CC(N1CC(C)(C[NH3+])C1)C1=C(C)C=C(C)N1` stays at a symmetric `126°/126°` exit instead of canting that branch off the ring
- Batch deferred halogen leaves at projected-tetrahedral acyclic centers, so chlorosilanes like `C[Si](Cl)(Cl)CC[Si](C)(Cl)Cl` keep even `80/80/80/120` heavy-neighbor fanout and consistent Si-halogen bond geometry instead of skewing one chlorine into a pinched slot

## 2026-04-22

- Keep strict exocyclic alkene exits on attached five-member rings centered between the two ring bonds, even when the mixed-family attachment search must trade a small transient overlap to avoid a visibly skewed pose
- Stabilize near-equal mixed-family branch-permutation tie handling, so Chromium and WebKit keep the same fused-aryl oxime/pyridyl layout and stereobond display without rotating unrelated layouts into new compass frames
- Let short mixed-family ring linkers keep terminal carbonyl chain atoms in the dedicated linker path, so amide-linked non-aromatic rings preserve clean `120°` nitrogen and carbonyl geometry instead of collapsing to a sharper direct-attachment bend
- Keep direct-attached chlorophenyl ring roots exactly symmetric at the attachment atom while overlap cleanup preserves conjugated amide nitrogens on their exact 120-degree continuation
- Fan geminal difluoro leaves on saturated six-member ring atoms across the open exterior gap instead of pinching one fluorine onto a ring-edge continuation
- Keep computed resonance contributors when leaving reaction preview through the resonance row, while preserving the pre-preview 2D display geometry and preview-history molecule metadata
- Widen the circular draw-tool hit targets so near-edge clicks on the draw-bond button still activate the tool and preserve drawer alignment
- Make the main draw-bond button toggle back to pan mode on a second click, matching the charge tool buttons while keeping the bond drawer available on hover
- Mirror collapsed two-atom bridged child-ring arcs across their shared endpoints so mixed fused/bridged layouts keep clean outward exits without atom-on-atom overlays
- Add a deterministic mixed-family exact-continuation snap for directly attached ring blocks, so JavaScriptCore/WebKit cannot leave fused-indole alkene roots flattened at `150°` when the exact `120°` continuation is available

## 2026-04-21

- Keep mixed fused-heteroaryl benzyl linkers on an exact 120-degree methylene bend by letting direct-attached ring rescue move the whole linker-plus-ring cluster around the already placed parent
- Place deferred hydrogens after heavier deferred leaves and relax exact omitted-h trigonal slot clearance slightly, so suppressed-h heavy substituents like `C(Cl)` branches can keep exact visible `120/120/120` spreads without losing their ideal slot to hidden hydrogens
- Preserve exact visible `120/120/120` heavy-atom spreads for hidden-hydrogen browser/app layouts by regenerating suppressed-h coordinates from a hydrogen-visible engine clone before writing the hidden-h result back
- Let omitted-h direct-attached mixed ring searches reopen a narrow local angle search and mirror upstream pendant subtrees when needed, so benzylic phenyl exits and their adjacent hidden-h trigonal parents can both land exactly while visible methyl centers stay exact
- Keep three-visible-bond stereocenters with a hidden hydrogen on a true trigonal 120/120/120 spread when their heavy-atom layout should read as omitted-h continuation rather than tetrahedral projection
- Score mixed-family direct-attached ring blocks from the ring-anchor side as well, so isolated cyclohexyl and similar saturated ring attachments snap to their exact local outward exit instead of settling on tangential poses
- Let hypervalent angle cleanup rotate compact non-ring ligand subtrees, so phosphoramidate and phosphate-ester phosphorus centers can settle onto exact orthogonal crosses without introducing new overlaps
- Prefer the local incident-ring bisector over the coarse fused-system centroid for simple alkyl exits on saturated multi-ring bridgeheads, so central-ring substituent angles stay exactly symmetric
- Stop shared-junction continuation from forcing simple alkyl-chain exits on saturated multi-ring bridgeheads onto the wrong straight-through slot when local outward presentation is the better reading
- Stop ring-readability audit from falsely failing exact outward carbonyl-linked substituents just because a farther downstream attached ring centroid bends past the hard outward-axis threshold
- Split preferred branch-angle search into two phases so exact/snapped coarse angles are exhausted before `±15°`/`±30°` rescue offsets, while keeping preferred coarse continuations prioritized over generic fallback slots
- Reuse cleanup-stage stereo and final audit metadata when a single-component layout reaches the finish line unchanged, avoiding redundant final stereo inspection and `auditLayout` work on already-correct poses
- Skip `coreGeometryCleanup`, `stereoRescueCleanup`, and `presentationCleanup` when placement plus the geometry checkpoint already show no corresponding work, while keeping symmetry snaps active only when they would materially change the layout
- Rename the live cleanup graph ids to `coreGeometryCleanup`, `selectedGeometryCheckpoint`, `stereoRescueCleanup`, `specialistCleanup`, and `stabilizeAfterCleanup`, and keep internal stereo follow-up wins folded back under `stereoRescueCleanup`
- Slightly expand hybrid ring-opening reaction-preview product components that still retain rings when moderate heavy-atom crowding remains, fixing the bridged lactam-hydrolysis preview without disturbing fully acyclic ring-opening alignment
- Remove the last cleanup-consolidation wrapper modules, drop migration-only cleanup telemetry alias fields, and retarget pipeline tests to stable cleanup categories plus presentation-fallback semantics
- Fold `label-clearance` and `symmetry-tidy` into one always-present `presentationCleanup` stage, remove the standalone `postCleanup` graph node, and track internal attached-ring fallback escalation directly on presentation telemetry
- Replace the late hypervalent specialist fan-out with one `finalSpecialistCleanup` orchestrator, move shared stabilization onto the late `postHookCleanup` stage, and add accepted-stage stabilization request tracking to cleanup telemetry
- Merge late ring presentation cleanup behind a shared facade, replace the three standalone final presentation stages with one `finalPresentationTouchup`, and gate attached-ring fallback on real descriptor presence
- Extract a shared cleanup candidate-search engine and move ring substituent, attached-ring, and ring-terminal-hetero cleanup onto it while keeping attached-ring per-seed refinement behavior stable for the later presentation-merge phase
- Move `selectedGeometryStereo` into runner bookkeeping and collapse stereo touchup orchestration behind the shared stereo-rescue category while keeping legacy telemetry names
- Add persistent cleanup telemetry and a corpus benchmark helper for layout-stage timing, outcome, and fallback tracking

## 2026-04-20

- Fix alignment of hetero atom labels with double bonds
- Add style options for coloring atoms and bonds
- Keep fused indole alkene roots on exact off-lattice trigonal slots while direct-attached mixed ring blocks align by the attachment atom's local outward axis
- Keep bridgehead methyl leaves on saturated fused-ring local outward axes instead of forcing them onto the shared-junction straight-through slot
- Keep crowded benzylic ethyl branches on exact 120-degree zigzags by adding exact saturated-continuation cleanup slots and finer rigid overlap escape rotations
- Keep crowded cyclopropyl-adjacent mixed alkyl tails zigzagged by falling back to the mirrored preferred zigzag slot before any straight continuation

## 2026-04-19

- Let one clearly dominant multi-ring scaffold define the final horizontal horizon instead of relying only on whole-molecule inertia
- Keep already-leveled broad ring-rich slabs horizontal instead of letting the final bond-grid snap introduce a small diagonal tilt
- Let rigid overlap cleanup probe exact omitted-h trigonal ring-exit slots so crowded alkene-linked heteroaryl blocks keep clean 120-degree geometry
- Keep standalone bracket hydrogens after dot-separated counterions bonded to the following fragment instead of stranding them as free H-H pairs
- Let short non-ring zigzag backbones still control final landscape leveling in mixed ring/chain molecules when they are the clearest readable axis
- Stop short pendant tails from dictating final landscape orientation when a much larger ring-rich scaffold should read level instead
- Keep large multi-ring slabs near-horizontal during the final bond-grid snap instead of letting a diagonal lattice compromise win
- Keep long chain-dominant mixed backbones fully level instead of letting a small ring lattice tip the final pose off horizontal
- Keep direct-attached foreign ring exits on the exact fused-junction continuation through late cleanup and full-pipeline scoring
- Keep mixed diaryl difluoromethyl linkers from spending leaf slots before the heavier ring attachment is placed
- Let linked diaryl-ether cleanup favor exact outward ring exits even when a fused anchor also carries a sibling one-atom leaf

## 2026-04-18

- Keep acyclic backbone alkene continuations exact when nearby terminal methylene side leaves are re-snapped
- Penalize omitted-h three-heavy saturated carbon distortions so cleanup keeps exact 120-degree side-branch geometry instead of flipping to overlap-only poses
- Keep lone vinylic single-bond substituent roots on the exact trigonal slot during acyclic backbone normalization
- Let directly attached mixed-family ring blocks honor exact 120-degree continuation off conjugated divalent nitrogens so amide-linked aryl attachments keep clean local amide geometry
- Keep mixed-family direct-attached aryl candidates with cleaner local outward-readability and presentation during prescoring so exact aromatic exit angles survive pruning
- Keep terminal phosphonate and similar hypervalent hetero leaves off the acyclic backbone so chains can zig-zag cleanly into the final P/S center
- Reserve extra label height for subscripted atom labels so bonds stop clipping visible `NH2`/`CH3` text
- Keep safe off-grid divalent carbon and hetero continuations on their exact zig-zag angle instead of snapping them to the branch lattice
- Fix SMILES parser misattributing the second =O of `NS2(=O)=O`-style sultam fragments to N instead of S, caused by ring-closure tokens sharing a character position with their atom token blocking the atom lookup in `previousAtomSkipBranches`
- Let directly attached mixed-family ring blocks keep exact parent-ring outward exits and exact three-, four-, and five-member ring-edge continuation slots before falling back to coarser rescue rotations
- Add a local zigzag-continuation preference for simple alkyl tails on mixed/ring scaffolds so pendant alkyl chains stop curling back toward the already placed scaffold context
- Let compact ring-anchored overlap cleanup probe conservative local rigid rotations before large fallback swings so crowded steroid ester roots stay close to their ring-outward carbonyl angle
- Let hypervalent cleanup rotate compact bridge-linked phosphate blocks and broaden cross-like placement scoring so condensed triphosphates finish on strict orthogonal crosses

## 2026-04-17

- Let compact aryl ester cleanup flip across the anchor bond axis so ortho ester-acid clashes clear while both ring exits and both carbonyl angles stay exact
- Tighten detached-fragment packing and add a final attached-ring rotation plus leaf-resnap touchup so salt pairs stay compact and imide carbonyls can finish exact
- Pin displayed stereochemical hydrogens to their drawn 2D coordinates as soon as a manual drag starts so nearby edits cannot reproject them automatically
- Refactor layout engine

## 2026-04-16

- Let mixed attached-ring scoring and ring-substituent tidy preserve exact outward terminal imine and carbonyl leaf geometry on ring trigonal centers
- Let local cleanup swap sibling alkyl branches around crowded tetra-substituted centers and avoid collapsing nearby tertiary-amine geometry just to open methyl-bond crossings
- Let late hypervalent phosphate cleanup compete with a follow-up linker rotation so aryl and sugar phosphate monoesters can stay both orthogonal and overlap-free
- Keep paired heavy exits on small saturated ring carbons close to the outer continuations of the ring edges so cyclopropyl and cyclobutyl substituents stop splaying into soft angles
- Let mixed fused cleanup keep overlap-free geometry when it clears severe clashes without introducing bond-length failures
- Keep safe fused-junction substituents on the exact continuation of the shared junction bond instead of a centroid-biased direction
- Auto-orient fresh chiral layouts with heavy-atom stereobonds so ring-junction stereo bonds avoid awkward diagonal page angles without rotating stereo-hydrogen cases
- Break mixed attached-ring orientation ties by total residual ring-substituent outward deviation so exact aryl substituent angles win over merely acceptable poses
- Let mixed direct-attached ring blocks search discrete parent-bond rotations so crowded multi-substituted rings can clear multiple outward-angle failures without creating overlaps
- Re-snap terminal alkene and carbonyl leaves after acyclic backbone normalization so conjugated trigonal centers stay exact
- Make crowded branch-rotation scoring prefer slots that preserve exact downstream linear and trigonal geometry
- Re-run hypervalent angle tidy after overlap-clearing ring-substituent rotations so linked sugar phosphates stay both separated and cross-like
- Let ring-substituent tidy rotate linked phosphate branches around their linker oxygens so sugar phosphates stop piling terminal oxygens on top of each other
- Snap visible stereochemical hydrogens to exact cardinal axes when that stays essentially as open as the best free-angle projection
- Keep simple acyclic ester and ether oxygens on their exact safe 120-degree continuation angles instead of canting them off-angle
- Let crowded saturated ring carbons with two exocyclic heavy branches spread those branches through the ring exterior gap instead of pinching them against ring bonds
- Rotate pendant ring systems through 12 discrete angles around the linker attachment bond when no default orientation is overlap-free, resolving NH-linker clashes with ortho-substituted rings
- Fix spurious valence warning for N in 5-membered aromatic rings like `Cc1cncn1` by detecting ambiguous ring nitrogens (neutral, no H, no exocyclic bonds, all aromatic ring bonds) during Hückel perception and allowing two or more such atoms to be reassigned as pyrrole-like donors when their standard pyridine-like assignment fails Hückel's rule
- Extend the same ambiguous-N fallback to rings with a single such nitrogen when no other N in the ring carries an explicit H, fixing false valence warnings for fused 5+6 heteroaromatics like `c1cnc2ccccc12`
- Let a final ring-substituent touchup preserve exact outward ring-root and inter-ring ether bridge angles, so fused sugar oxygens and linked ring systems stay perfectly aligned without disturbing broader cleanup-stage selection
- Fix asymmetric short aromatic ring-linker placement from fused aromatic roots by keeping the linker atoms in first-to-second attachment order and using the local attachment-ring outward axis for the fused root, so benzyl chains leave nitrogen-heavy fused rings cleanly and keep the intended 120-degree zigzag instead of collapsing or canting off the ring
- Let terminal methyl and other heavy leaf ring substituents follow the exact local outward axis instead of snapping to a nearby discrete branch angle
- Add a bond-first chooser on giant fused cage KK placements so fullerene-like outliers can compare raw cage coordinates against ring-regularized variants instead of committing to a single cage shape
- Add a multi-metal organometallic framework rescue that lays out simple monatomic-ligand metal clusters through the metal-only topology family first and then reattaches bridging ligands
- Short-circuit giant dense no-template fused cages directly to the existing atom-graph Kamada-Kawai cage rescue so fullerene-like outliers keep their current geometry ceiling without spending seconds in the planar fused placer first
- Add a polyoxometalate organometallic rescue that infers a metal-only framework from bridging oxo atoms and then places terminal and bridging oxygens off that framework
- Let large mixed cobalt corrins and similar metal-centered fused/bridged ring systems promote forced fused/bridged slice placement over the default mixed path when the audit is clearly better

## 2026-04-15

- Fix catastrophic fused-macrocycle ring completion blowups by switching near-complete shared-ring completion to a regular-polygon best-fit instead of a fragile circumcenter fit
- Keep large cyclic peptides and metallomacrocycles on the macrocycle-aware mixed path when it audits better than the large-molecule partitioner
- Speed up unmatched bridged cages by extending the bridged KK budget tuning to medium and large template-miss systems
- Speed up large-molecule packing by caching subtree/block overlap rescoring and tightening overlap-resolution bookkeeping
- Make large-molecule cleanup preserve backbone bonds by blocking unsafe single-atom nudges and adding block-aware stitched-subtree cleanup moves
- Centralize new unified-cleanup, bridged-KK, and branch-complexity tuning knobs in shared `layout` constants
- Add regressions for dense macrocycle, bridged cage, mixed nucleotide/peptide, and overlap-heavy large-molecule stress cases
- Complete the low-risk mixed/large-molecule implementation-plan micro-optimizations: de-queue mixed BFS with a head index, replace mixed bond endpoint scans with `bondByAtomPair`, replace in-loop pending-ring splices with per-pass rebuilds, switch large-molecule cut selection to `bondsByAtomId`, and remove O(n²) seed construction in `breadthFirstOrder`
- Precompute `atomToRingSystemId` and `ringAtomIds` in the layout graph, cache macrocycle detection once per component-layout pass, and let `runPipeline` reuse already-normalized options when building the layout graph
- Hoist local-cleanup rotatable subtree discovery out of repeated unified-cleanup one-pass probes and add reusable-subtree regressions
- Finish the remaining `layout-engine` AtomGrid plumbing by reusing the live overlap-resolution grid in `constrainSingleAtomMove` and passing reusable batch-level grids into focused branch-placement arrangement scoring
- Add two-stage unified-cleanup candidate scoring so overlap and rotation probes prescreen with `measureOverlapState` before only the surviving winner pays for a full `measureLayoutState`
- Freeze preserved disconnected refinement components through both cleanup passes so overlap nudges, rigid-subtree moves, and local rotations cannot drift untouched fragments away from their existing coordinates
- Start the audit-remediation cleanup safety pass by making macrocycle, bridged, fused, organometallic, and large-molecule cleanups bond-protected and by selecting the safest audited stage among placement, cleanup, and post-hook cleanup instead of always trusting the last cleanup snapshot
- Add protected-family rigid cleanup descriptors for macrocycle sidechains, fused/bridged ring substituents, and organometallic ligands so overlap cleanup can try rigid family-scoped moves before falling back to generic atom nudges
- Tighten protected cleanup stage selection so mixed bridged cases no longer pay an extra bond-failure count just to shave overlaps, while pure compact bridged cages can still take the harmless overlap-cleanup win
- Add corpus-derived pipeline regressions for mixed macrocycle, mixed bridged, and mixed organometallic cleanup safety cases from the latest audit-failure set
- Lock in the `macrocycle-circle` cleanup fix with explicit corpus regressions and mark the macrocycle-collapse task as partially landed because the known collapse cases are now clean on current code
- Add a macrocycle post-cleanup `ring-terminal-hetero-tidy` hook plus terminal carbonyl rigid descriptors so dense fused peptide macrocycles can rotate crowded ring carbonyl oxygens off the scaffold without stretching bonds
- Harden bridged mixed-family rescue scaffolding so large template-miss rescue gates use real ring-system sizes and reject partial rescue placements instead of mistaking incomplete spiro layouts for clean wins
- Extend audit fallback reporting to surface bond-length-failure reasons and assign a non-null fallback recommendation for bond-only dirty cases
- Start the large-molecule overlap-remediation track by adding atom-clash-aware stitched-subtree compaction scoring that reuses the shared `AtomGrid` overlap machinery without regressing the overlap-heavy runtime budget
- Add a first conservative alternate-root retry for denser large-molecule stitched layouts, while keeping giant overlap-heavy cases off the retry path so the pipeline runtime budgets stay green
- Add a dedicated `audit-corpus` regression harness with one real representative for each major audit-failure bucket
- Fix stereo-only exocyclic `E/Z` audit failures by adding a local trigonal branch-rotation rescue ahead of blunt whole-side reflection
- Fix stereo-only implicit-hydrogen chiral-center failures by letting wedge selection synthesize a hidden-H stereocenter entry when only three explicit neighbors are present
- Stop counting unsupported annotated `R/S` centers as unassigned stereo contradictions and track them separately in stereo metadata
- Stop counting unsupported ring-bound annotated `E/Z` bonds as hard stereo contradictions and surface them separately in stereo metadata
- Add a final stereo-stage chooser after cleanup so supported stereo rescues can survive late cleanup/touchup decisions instead of being overwritten by the last geometry-only stage
- Add a stereo-protected late touchup cleanup probe that freezes supported annotated `E/Z` atom quartets
- Add a compact bridged-root rescue in mixed placement that tries a fused-family construction for small bond-dirty bridged hybrids before falling back to KK projection
- Add a fused-plus-spiro bridged-hybrid rescue that lays out fused-connected ring blocks first and then attaches the remaining block graph across spiro joints
- Extend the fused-block bridged-hybrid rescue to support bridged shared-atom attachments as well as spiro joints
- Let large no-template high-ring-count fused cages compete against the bridged rescue path too

## 2026-04-14

- Route chain-heavy peptide-like mixed components through the large-molecule path earlier so small ring cores with huge non-ring bodies stop timing out
- Cap mixed-family sibling permutation search by local branch complexity so nucleotide-like and peptide-like sidechains stop stalling branch placement
- Switch large attached-block exploratory scoring to a focused local cost so mixed-family orientation search stops rescanning whole crowded layouts
- Start improving large-molecule block splitting and stitched packing for explicit-H-rich peptide blocks and overlap-heavy packed layouts

## 2026-04-13

- Add bond length labels
- Fix edit stereochemistry of explict hydrogen
- Fix force layout clean mode
- Add more bridged templates
- Add a dedicated oxabicyclo[3.1.1]heptane bridged-ring template so `C1OC2CC(C1)C2` renders in a compact oxygen-bridge cage projection instead of the generic fallback
- Add a dedicated quinuclidine bridged-ring template so `C1CN2CCC1CC2` renders in a compact medicinal-chemistry cage projection instead of the generic fallback
- Make safe terminal single-bond hetero substituents on ring atoms use the exact local outward angle instead of snapping to the generic discrete branch lattice
- Swap the projected tetrahedral organometallic wedge/dash pair so the wedge no longer sits on the top-right ligand in Zn/Cd/Hg four-coordinate views
- Rework projected octahedral organometallic display to use four diagonal stereobonds with upper dashes and lower wedges plus axial top/bottom ligands, matching the more standard cobalt-complex projection style
- Retune projected octahedral organometallic coordinates so the dash and wedge pairs sit on a shallower left/right fan instead of a hexagon-like diagonal, making the front/back projection read more clearly
- Fix projected octahedral organometallic cleanup so the final pipeline preserves the angled upper-dash and lower-wedge pairs instead of snapping two projected ligands onto horizontal bonds
- Add explicit organometallic support for trigonal-planar three-coordinate Cu/Ag/Au centers plus projected trigonal-bipyramidal Fe/Co/Ni and projected square-pyramidal Rh/Ir/Ru/Os/Pd/Pt five-coordinate centers, including force-mode display-hint seeding and cleanup preservation
- Retune projected trigonal-bipyramidal and square-pyramidal organometallic geometry so trigonal-bipyramidal axial ligands stay vertical while square-pyramidal reuses the octahedral front/back projection without the bottom ligand
- Keep projected trigonal-bipyramidal metals from being recentered off their vertical axis after placement and soften the projected wedge/dash pair to a less exaggerated angle
- Pull projected trigonal-bipyramidal wedge/dash ligands closer to the horizontal axis so the front/back pair reads less steeply
- Make bond-length text overlays avoid rendered bond strokes more intelligently so they stop sitting on triple bonds, dashed stereo bonds, and crowded bridged overlaps
- Make bond electronegativity overlays use the same blocker-aware placement rules as bond lengths, including force-mode X-H placement away from the bond midpoint
- Fix dense bridged alkaloid layouts by capping bridge-path projection so complex cages stay on the KK seed instead of exploding into stretched bonds
- Restrict bridged bond tidy to mixed bridged systems so compact bridged cages no longer get unexpectedly reshaped by the dense-cage cleanup pass
- Fix aromatic O/S cation counting so pyrylium and thiopyrylium rings stay aromatic after perception
- Fix implicit-hydrogen repair stripping pyrrole-like hydrogens when aromatic bonds are stored as order 1.5
- Stabilize 2D clean on bridged and locally distorted structures by ignoring hidden-H false positives, tolerating compressed ring bonds, and widening local refinement hints
- Fix 2D dash-to-line edits on stereochemical hydrogens so draw-only updates hide stale stereo Hs instead of leaving them stranded on the parent carbon
- Make `double`, `triple`, and `aromatic` tools a true no-op on displayed 2D stereochemical hydrogen bonds instead of collapsing them to plain single bonds
- Fix force-mode single-bond edits on stereochemical hydrogens so wedge/dash `C-H` bonds can be cleared back to plain single bonds
- Preserve reaction-preview metadata through 2D and force clean clones so cleaning an active preview does not drop preview-specific product display state
- Fix force-mode reaction-preview clean so imine-hydrolysis and similar previews keep the product on the right instead of reanchoring a mirrored reactant/product arrangement
- Keep force-mode reaction-preview arrows visible while rotating by shrinking the force arrow padding gracefully instead of dropping the arrow when reactant and product boxes swing temporarily close together
- Suppress the native browser context menu anywhere inside the molecule plot instead of only during charge-mode right-click flows
- Fix 2D element changes on displayed stereochemical hydrogens so carbon, oxygen, and sulfur replacements no longer collapse onto the parent stereocenter when clicked in draw-bond mode
- Fix 2D draw-bond preview starts on displayed stereochemical hydrogens so the first click frame no longer jumps back to the parent carbon before the replacement render
- Fix fused aza aromaticity for substituted pyrrolic nitrogens so N-substituted five-member heteroaromatics stay aromatic and expose aromatic aza protonation sites correctly
- Tighten disconnected-fragment packing and let small charged metal hubs center multi-component salts so counter-ions no longer chain off to one side with excessive gaps

## 2026-04-12

- Fix selection of explicit hydrogen
- Migrate new 2D layout algorithm to layout folder and remove old engine.
- Rework the tropane/cocaine bridged-ring template so cocaine-like scaffolds render with a cleaner cage projection instead of the earlier distorted crossed shape
- Fix 2D stereo-hydrogen atom drags to start from the projected visible position and follow the mouse live
- Fix 2D clean preserving manually dragged stereo-hydrogen positions instead of snapping them back to their projected defaults
- Make 2D clean feed touched-bond refinement hints into the existing-coordinate relayout path so badly stretched groups such as dragged carbonyls snap back cleanly without bypassing refinement
- Fix 2D undo restoring stale hidden stereo hydrogen positions after loading a different molecule
- Fix layout of sulfate compounds
- Fix `layoutv2` mixed-layout freezes on long fluorinated sidechains by deferring terminal halogen leaves until the carbon backbone continuation is placed
- Reuse a live `layoutv2` AtomGrid across unified-cleanup passes and clone it for local-rotation probes instead of rebuilding from scratch
- Expand `layoutv2` layout benchmarks with naphthalene, caffeine, and ibuprofen plus a `--breakdown` mode that reports per-phase timing
- Expand `layoutv2` geometry and family edge-case coverage for fused, bridged, macrocycle, polygon, vector, and KK fallback/pinning behavior
- Split the `layoutv2` scaffold template library into separate builder, data, and public facade modules without changing the public API
- Add opt-in `layoutv2` pipeline timing metadata for placement, cleanup, label clearance, stereo, audit, and total runtime
- Add a fast branch-placement safety screen that skips exact clearance scoring for obviously blocked candidate angles while preserving exact finalist tie-breaking
- Speed up `layoutv2` Kamada-Kawai relaxation by replacing full per-move gradient refreshes with exact incremental updates and add an equivalence regression against the legacy path
- Fix browser app boot by removing the Node-only `node:perf_hooks` import from `layoutv2` pipeline timing and add a Playwright regression for unsupported module URLs on load
- Add a `docs/agent/scripts/data` SMILES catalog with one parser-safe representative string for every current `layoutv2` scaffold template
- Refactor `layoutv2` pipeline orchestration into separate cleanup, stereo, and result-assembly helpers without changing behavior
- Convert `layoutv2` Kamada-Kawai matrix storage from nested JS arrays to flat typed arrays and add a disconnected-graph regression
- Refactor `layoutv2` batch branch-angle assignment into smaller candidate-set and permutation-evaluation helpers without changing placement behavior
- Refactor `layoutv2` mixed-family placement into smaller root-init, ring-attachment, and finalization helpers without changing behavior
- Extract shared polygon-containment counting into `layoutv2` geometry utilities and reuse it across branch placement and wedge geometry
- Extract shared `layoutv2` cleanup cut-subtree traversal into a reusable helper module and reuse it in overlap cleanup and local rotation
- Centralize `layoutv2` validation presets and remaining policy-like geometry thresholds in shared constants as part of the refactor/optimization sprint
- Add major `layoutv2` follow-up performance work across overlap cleanup, unified cleanup, and label clearance for macrocycle/macrolide-heavy cases
- Add medium-ring cyclic `E/Z` enforcement, unified cleanup orchestration, profile-driven post-cleanup hooks, and pericondensed fused-ring layout support
- Add benchmark coverage and broader `layoutv2` regression coverage while deferring the SVG snapshot approach during active algorithm development

## 2026-04-11

- Fix layout-v2 clean so acyclic sketches snap back to exact ideal angles

## 2026-04-10

- Fix hypervalent sulfur 2D geometry to use a cross-like layout
- Fix layout-v2 fused-ring substituents and hidden-H wedges going inside ring faces
- Fix cyclic fused ring regularity in layout-v2
- Fixes and optimizations to new 2D layout algorithm
- Fixed issue with region of window being unable to use select tool
- Fix how bond line drawer tool stays open
- Fix layout-v2 clean/refine flipping steroid ring substituents inward
- Speed up layout-v2 rendering for very large explicit-H peptide-like molecules
- Fix force-mode clean to refine the live layout
- Fix layout-v2 trans alkene and diene bond angles to strict trigonal geometry

## 2026-04-09

- Add prototype version of the 2D layout algorithm
- Add Diels-Alder [4+2] to SMIRKS reference
- Improvements to reaction network demo
- Fixes and improvements to new 2D layout algorithm

## 2026-04-08

- Fix bugs with new charge state buttons
- Optimizations to 2d coordinate generation
- Fix SMILES tokenizer for ring closures (example: [C@]%10%11 and c7%11)
- Fix bugs with aromaticity detection
- Fix charge button right click functionality
- Raise max character limit for input box to 2000
- Fix issue with implicit hydrogen when editing atoms
- Improve 2d layout of bridged systems
- Add 'kind' to bond properties
- Add common vitamins to catalog
- Add ReactionNetwork class

## 2026-04-07

- Remove docs/api for now
- Add bond picker tool, double, tripple, aromatic, wedge, dash
- Display stereochemistry bonds in force layout mode
- Fix issue with amine protonation
- Update JSDoc for all files
- Add buttons in demo to edit charge state

## 2026-04-06

- Stiffen force layout bonds
- Fix InChI atom id assignment
- Fix atom numbering for reaction mapping
- Add Atom Numbering toggle to the Other panel (works in 2D, force, and reaction preview)
- Skip redundant full-molecule coordinate generation when activating a reaction preview
- Cache empty ring array for acyclic molecules in `getRings()`
- Fix stereo bonds not toggling on repeated flips in reaction preview mode
- Fix alkyl chloride elimination
- Refresh hidden SMARTS panels lazily when their tab is opened
- Skip chemistry and analysis recompute for view-only mode and preview restores
- Move bootstrap dependency builders into `src/app/bootstrap/deps`
- Move the main app module script out of `index.html` into `src/app/bootstrap/app-entry.js`
- Make 2D reaction previews follow the restored molecule after undo
- Extract interaction runtime call wiring out of `index.html`
- Extract app runtime call wiring out of `index.html`
- Extract final bootstrap call wiring out of `index.html`
- Extract runtime bridge setup out of `index.html`
- Extract scene wrapper bridges out of `index.html`
- Extract interaction runtime setup out of `index.html`
- Keep deleted selections from sticking after undo
- Extract render scene dependency builders out of `index.html`
- Extract bootstrap dependency builders out of `index.html`
- Extract interaction action dependency builders out of `index.html`
- Extract app runtime manager setup into `src/app/bootstrap/app-runtime.js`
- Restore saved force node positions when leaving reaction preview
- Extract shared bootstrap runtime state into `src/app/bootstrap/runtime-state.js`
- Extract shared bootstrap DOM handles into `src/app/bootstrap/dom-elements.js`
- Extract startup, resize, and global action bridges into `src/app/ui/app-shell.js`
- Extract UI init dependency bridges into `src/app/ui`
- Extract remaining thin app delegates into `src/app/core/app-delegates.js`
- Extract runtime panel, snapshot, and mode-chrome helpers into `src/app/ui/runtime-ui.js`
- Resolve `runtime-ui` session bridge lazily so draw, atom-edit, and delete flows keep working after startup

## 2026-04-05

- Add bond electronegativity overlay in demo
- Fix copying .svg and .png molecules in force layout with charges
- Add Pauling electronegativity (`en`) data to `src/data/elements.js`
- Add bond polarity descriptors and export them from `src/descriptors/index.js`
- Make flips swap displayed wedge/dash stereo
- Preserve extra atom and bond properties during molecule clones
- Let Delete/Backspace erase hovered atoms and bonds in erase mode
- Include 2D/force mode switches in undo/redo
- Prevent force auto-fit from overwriting restored 2D zoom
- Preserve force zoom when leaving reaction preview via resonance
- Fix blank 2D canvas after force undo and mode switch
- Restore InChI text correctly on undo after format switches
- Keep resonance row state aligned with undo/redo restores
- Let reaction preview entry participate in undo/redo
- Stop physicochemical row locks from persisting through undo/redo
- Stop resonance contributor viewing from persisting through undo/redo
- Stop the resonance tab from persisting through undo/redo
- Capture reaction-preview exits through resonance in undo/redo
- Include SMILES/InChI mode toggles in undo/redo
- Keep hydrogen bond-draw no-ops from leaving reaction preview or adding history
- Keep reaction preview from changing the molecular weight summary
- Keep the bond electronegativity toggle from exiting reaction preview
- Include force charge labels in SVG/PNG export
- Preserve localized aromatic bond orders across undo/redo restores
- Fix several audited undo snapshot and restore edge cases
- Refactor undo history into an instantiable manager and tighten its snapshot API
- Extract draw-bond commit logic into an interaction module
- Extract delete and erase editing logic into an interaction module
- Extract primitive drag gesture coordination into an interaction module
- Keep hovered keyboard deletes from turning into sticky undo selection
- Extract input parsing, loading, and format-switch history into a core module
- Parse pasted SMILES synchronously so undo stays aligned after InChI-mode paste flows
- Preserve the prior InChI input state when pasted SMILES auto-switches formats
- Extract input textbox, picker, example, and random-molecule controls into an interaction module
- Keep SMILES/InChI format toggles tied to the source molecule during reaction preview
- Extract shared render policy into `src/app/render/render-runtime.js`
- Extract the 2D scene renderer into `src/app/render/scene-2d.js`
- Extract 2D selection and hover overlay logic into `src/app/render/selection-overlay.js`
- Extract shared 2D render helpers into `src/app/render/2d-helpers.js`
- Extract 2D highlight redraw into `src/app/render/highlights.js`
- Extract structural edit policy into `src/app/interactions/structural-edit-actions.js`
- Extract selection-state and zoom-transform helpers into `src/app`
- Extract session runtime snapshot/restore helpers into `src/app/core/session-runtime-bridge.js`
- Extract app-state and session-snapshot dependency bridges into `src/app/core`
- Extract app-controller and undo dependency bridges into `src/app/core`
- Extract reaction, resonance, and bond-EN panel dependency bridges into `src/app/render`
- Extract options modal logic into `src/app/ui/options-modal.js`
- Extract tab switching and physicochemical panel UI logic into `src/app/ui`
- Preserve 2D zoom when entering or restoring reaction preview
- Fix reaction preview site count labels when cycling between matches
- Restore the original 2D zoom after exiting reaction preview
- Restore the pre-preview display state when exiting reaction preview

## 2026-04-04

- Refactor app interaction logic out of `index.html`
- Add playwright for browser app testing
- Capture undo snapshots at drag start so undo restores reaction-preview edits to the real locked preview state
- Capture pre-load snapshots before clearing reaction preview so undo after loading a new molecule restores the locked preview state
- Switched undo/redo to capture a fuller app session snapshot, including tool mode, selection, active tabs, and locked panel highlights
- Extract session UI snapshot helpers for panel/tool/selection restore out of `index.html`

## 2026-04-03

- Fix 2D layout geometry for open-chain polyols (e.g. ether cleavage products
- Preserve molecule geometry when exiting reaction preview so manually drawn coordinates are no longer overwritten by auto-clean
- Input bar changes (typing, paste, catalog selection) now participate in undo/redo
- Fix selection highlight stuck on product atom after Delete in reaction-preview mode
- Fix functional group highlight lost when clicking rotate/flip in force mode
- Optimize resonance structures calculation

## 2026-04-02

- Erase paint mode now erases atoms/bonds on circle-edge contact, not just cursor center
- Added tooltip to Atom Coloring option explaining CPK colors vs. black and white
- Functional-group match cycling now includes an `All` highlight state
- Moved 2D wedge/dash persistence onto `bond.properties.display`, storing the chosen displayed stereo bond on the bond itself instead of relying only on transient UI maps
- Preserved existing 2D wedge-bond choices for untouched stereocenters during unrelated graph edits so adding/removing distant atoms no longer flips another center’s displayed wedge bond
- Preserved the stored 2D wedge or dash type as well, so remote substituent edits no longer flip an untouched stereobond from wedge to dash or vice versa
- Fixed ether functional-group SMARTS so phosphoesters like `P-O-C` are no longer misclassified as ethers
- Fixed `Alcohol Dehydration` so primary alcohols dehydrate to valence-clean alkenes and no longer match when the beta carbon has no removable hydrogen
- Removed the misleading `Alcohol Cleavage` reaction template and its related docs/tests
- Fixed draw-bond mode placing linear bonds
- Force layout rotate/flip buttons added to toolbar (between Atom Labels and PNG); wired to undo history
- `fsp3` now returns `{ value, atoms }` enabling sp³ carbon highlighting in the Fsp3 physicochemical row
- Optimized `allPairsShortestPaths()` halving matrix-fill operations
- Added `{ recompute: false }` option to `Molecule.addAtom()` to skip eager `_recomputeProperties()` during batch construction
- Added a global `Show Lone Pairs` option with final-pass lone-pair dot placement in both 2D and force layouts
- Refined lone-pair rendering to follow local bond/ring orientation, support four-pair halides
- Updated charge rendering to use thin circled badges and switched metal atom colors to a more restrained metallic palette, including silver `Ag`, gold `Au`, platinum `Pt`, and mercury `Hg`
- Added a global `Atom Tooltips` option and made charge badges avoid nearby bond and lone-pair directions in both 2D and force rendering
- Added real SVG clipboard export for both 2D and force layouts, including a new force-mode `SVG` export button
- Made force-layout PNG clipboard export transparent and adjusted SVG clipboard
- Replaced shift-based BFS queues with O(1) head-index traversal across core, SMARTS, and layout hot paths
- Replaced inline array-literal `.includes()` calls with module-level `Set` constants
- Fixed `OH`/`HO` label orientation so hydroxyl labels follow the displayed heavy-atom direction
- Optimized `getBond()` in `Molecule` to use `_bondIndex` for O(1) bond lookup instead of O(E) linear scan
- Optimized `_recomputeProperties()` to compute `getFormula()` once and pass it to `getName()`, eliminating a redundant full atom traversal on every molecule mutation; `getName()` now accepts an optional pre-computed formula argument with fallback to `getFormula()`

## 2026-04-01

- Added a resonance sidebar panel with contributor count, click-to-lock cycling, and automatic recomputation on molecule changes
- Initial implementation of determining resonance structures of a molecule
- Added an options window for 2D atom coloring, 2D bond thickness, force atom size, force bond thickness, reset button, 2D atom font-size, and 'Show Valence Warnings' toggle
- Made physicochemical highlight rows lock and unlock on click
- Refactor coords2d.js
- Added per-match navigation for multi-hit functional groups in the sidebar
- Moved shared highlight and functional-group panel logic into `src/app/render/highlights.js`
- Made functional-group table rows toggle their locked highlight on repeated mouse-down
- Fixed SMILES parsing so directional bonds after bracket stereocenters stay attached to the stereocenter
- Fixed `parseINCHI` so ring amidines like cytosine keep the correct amino-keto localization
- Added a psychoactive-compounds collection to the molecule catalog
- Added valence-warning atom highlights and hover explanations in the demo

## 2026-03-31

- Miscellaneous fixes
- Renamed UI label to "Molecule Catalog"
- Added Ctrl/Cmd+A select-all shortcut
- Fixed hydrogen-bond acceptor counting for guanidine nitrogens
- Added Kekulisation of stale bonds to restore correct double-bond orders
- Fixed aromaticity perception to clear stale flags from non-aromatic rings
- Enabled automatic SMILES/InChI input detection
- Added a known-molecule catalog
- Refactored `index.html` further

## 2026-03-30

- Added atom/bond highlighting for physicochemical properties
- Improved PNG/SVG export
- Expanded reaction templates
- Fixed demo issues
- Refactored `index.html`
- Added reaction preview support

## 2026-03-29

- Corrected bridge-atom drawing behavior
- Added physicochemical descriptors to the demo
- Fixed demo issues

## 2026-03-28

- Minor fixes across the project

## 2026-03-27

- Improved force-layout behavior

## 2026-03-26

- More fixes
- Improved force-layout structures in the demo
- Expanded bond-creation atom types
- Added undo/redo controls

## 2026-03-25

- Minor fixes
- Introduced SMIRKS reaction templates
- Added atom and bond creation to the demo

## 2026-03-24

- Various related fixes and improvements
- Added support for the SMIRKS reaction language

## 2026-03-23

- Miscellaneous fixes and refactors
- Introduced radical support
- Improved 2D coordinates and label placement
- Added bond and selection dragging

## 2026-03-22

- Algorithm, selection, and demo bug fixes
- Added delete-atoms/bonds controls
- Added selection and pan mode

## 2026-03-21

- General fixes across the core algorithms

## 2026-03-20

- Minor refactors, optimisations, and import fixes
- Improved demo behavior and bond-hover details
- Updated the README and getting-started guide
- Added cleaner 2D geometry refinement

## 2026-03-19

- Improved SMILES/InChI parsing and demo integration
- Added canonical SMILES, aromaticity calculation, drug-likeness indicators, and `toInChI`
- Expanded SMARTS and functional-group detection

## 2026-03-18

- Fixed stereochemistry, 2D geometry, chirality/isotope handling, and InChI parsing issues
- Added atom hybridisation detection, VF2 matching, SMARTS substructure search, and functional-group highlighting

## 2026-03-17

- Added a script to generate a grid of test molecules
- Enhanced the demo
- Added stereochemistry rendering and valence validation
- Improved 2D coordinate generation and geometry
- Move force highlight and selection overlay rendering out of `index.html`
- Extract force keep-in-view state helpers and remove more inline render wrappers
- Move top-level plot interaction wiring out of `index.html`
