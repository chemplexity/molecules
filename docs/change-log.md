# Change Log

## 2026-04-20

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
