# Change Log

## 2026-03-17

- Improved 2D coordinate generation and geometry
- Added stereochemistry rendering and valence validation
- Enhanced the demo
- Added a script to generate a grid of test molecules

## 2026-03-18

- Added atom hybridisation detection, VF2 matching, SMARTS substructure search, and functional-group highlighting
- Fixed stereochemistry, 2D geometry, chirality/isotope handling, and InChI parsing issues

## 2026-03-19

- Expanded SMARTS and functional-group detection
- Added canonical SMILES, aromaticity calculation, drug-likeness indicators, and `toInChI`
- Improved SMILES/InChI parsing and demo integration

## 2026-03-20

- Added cleaner 2D geometry refinement
- Updated the README and getting-started guide
- Improved demo behavior and bond-hover details
- Minor refactors, optimisations, and import fixes

## 2026-03-21

- General fixes across the core algorithms

## 2026-03-22

- Added selection and pan mode
- Added delete-atoms/bonds controls
- Algorithm, selection, and demo bug fixes

## 2026-03-23

- Added bond and selection dragging
- Improved 2D coordinates and label placement
- Introduced radical support
- Miscellaneous fixes and refactors

## 2026-03-24

- Added support for the SMIRKS reaction language
- Various related fixes and improvements

## 2026-03-25

- Added atom and bond creation to the demo
- Introduced SMIRKS reaction templates
- Minor fixes

## 2026-03-26

- Added undo/redo controls
- Expanded bond-creation atom types
- Improved force-layout structures in the demo
- More fixes

## 2026-03-27

- Improved force-layout behavior

## 2026-03-28

- Minor fixes across the project

## 2026-03-29

- Fixed demo issues
- Added physicochemical descriptors to the demo
- Corrected bridge-atom drawing behavior

## 2026-03-30

- Added reaction preview support
- Refactored `index.html`
- Fixed demo issues
- Expanded reaction templates
- Improved PNG/SVG export
- Added atom/bond highlighting for physicochemical properties

## 2026-03-31

- Refactored `index.html` further
- Added a known-molecule catalog
- Enabled automatic SMILES/InChI input detection
- Fixed aromaticity perception to clear stale flags from non-aromatic rings
- Added Kekulisation of stale bonds to restore correct double-bond orders
- Fixed hydrogen-bond acceptor counting for guanidine nitrogens
- Added Ctrl/Cmd+A select-all shortcut
- Renamed UI label to "Molecule Catalog"
- Miscellaneous fixes
