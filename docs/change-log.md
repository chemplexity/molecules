# Change Log

## 2026-04-01

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
