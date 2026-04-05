# Change Log

## 2026-04-05

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
