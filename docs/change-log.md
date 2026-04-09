# Change Log

## 2026-04-08

- Fix bugs with new charge state buttons
- Optimizations to 2d coordinate generation
- Fix SMILES tokenizer for ring closures (example: [C@]%10%11 and c7%11)
- Fix bugs with aromaticity detection
- Fix charge button right click functionality
- Raise max character limit for input box to 2000
- Fix issue with implicit hydrogen when editing atoms

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
