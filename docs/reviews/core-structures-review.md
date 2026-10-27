**Core data structures and API review — September 9, 2026**

Reviewed commit: `b7ad456`, Node `v25.2.1`. Scope: `Atom`, `Bond`, `Molecule`, core support utilities, JSON persistence, and representative consumers in parsing, descriptors, SMARTS, SMIRKS, layout, and network code. The network classes themselves were not exhaustively reviewed.

**Overall assessment**

**Keep the Atom/Bond/Molecule architecture and the Map-based graph. Tighten ownership, state definitions, and method contracts.** The representation is practical for sparse molecular graphs, editing, and serialization. The main problem is that it permits several competing ways to change the same state, with different validation, caching, copying, and hydrogen behavior.

The fields are convenient but mix four categories: authoritative chemistry, derived chemistry, document metadata, and depiction state. Their ownership and lifecycle are insufficiently explicit. The methods are approachable individually, but the API as a whole does not reliably maintain a consistent molecule after edits.

This is supported by executable failures, including an incomplete cycle basis, stale ring caches after renaming IDs, partially committed failed updates, inconsistent chemistry helpers, and metadata lost or misdirected during copying. These are reasons to strengthen the existing design incrementally.

**What is already good**

- Atom IDs and bond IDs represent graph references without creating circular object references. This simplifies copying and persistence.
- `Map<id, Atom>`, `Map<id, Bond>`, per-atom adjacency, and an atom-pair index suit the dominant queries. Arrays are reasonable adjacency containers for small molecular degrees; replacing them wholesale with Sets would not address the main defects.
- Bond `kind` is separate from bond `order`, which provides a useful explicit distinction for covalent, coordinate, ionic, and haptic connections.
- Ordered bond endpoints preserve directional stereo semantics even though ordinary connectivity queries are undirected. Keep that distinction.
- Molecule-level construction checks duplicate atoms, duplicate bonds, nonexistent endpoints, and self-loops. Those are useful invariant boundaries to build on.
- Style normalization and defensive style getters demonstrate a stronger contract already present in the codebase.
- Graph/query algorithms can operate on the model without requiring renderer objects or an Atom-to-Molecule back-reference.

**Assessment by type**

| Type                     | Verdict                                                                                                   | Main action                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `Atom` — 820 lines       | Useful domain object; fields and chemistry lifecycle need clearer authority.                              | Keep identity, scalar chemistry, and convenient accessors. Centralize graph-dependent chemistry and route owned-atom edits through Molecule. |
| `Bond` — 419 lines       | Strong basic representation; construction and update semantics disagree.                                  | Keep ordered endpoints and semantic kind. Share validation/normalization across construction and mutation; protect structural endpoints.     |
| `Molecule` — 2,009 lines | Correct place for graph ownership; contains too many independently maintained policies and copying paths. | Make it the edit coordinator. Extract ring/stereo/property algorithms behind a stable facade and add a supported batch-edit API.             |
| Core support — 729 lines | Contains both reusable value validation and application editing behavior.                                 | Keep generic validation near the model; place fragment geometry and paste behavior in a document/editing layer.                              |

File sizes include comments and documentation. Size alone is not the problem: the critical issue is maintaining the same invariants across all entrypoints.

**Are the fields good?**

| Current fields                                             | Assessment                                                                                                                                                              | Recommended contract                                                                                                                                                                   |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Molecule.atoms`, `Molecule.bonds`                         | Good primary storage, exposed as unrestricted mutable Maps.                                                                                                             | Molecule owns insertion/deletion. Expose iteration/read access; keep bulk mutation behind a builder/editor.                                                                            |
| `Atom.bonds`, `Bond.atoms`, `_bondIndex`                   | Useful redundant indexes; all can drift independently.                                                                                                                  | Every bond exists once, has two existing endpoints, appears once in each endpoint's adjacency, and has exactly one correct pair-index entry. Assert this in development/tests.         |
| `id`                                                       | Useful local graph identity; string type is documented but not consistently enforced.                                                                                   | One ID policy at all boundaries. Rename through Molecule and return the atom/bond ID maps. Use collision-safe pair keys.                                                               |
| `uuid`                                                     | Its meaning is ambiguous across copy operations. Copies preserve Atom/Bond UUIDs while a Molecule clone receives a fresh UUID. Internal uses are largely persistence.   | Decide whether it identifies an instance or tracks provenance. Make clone-versus-duplicate behavior explicit. If provenance is needed, represent it separately from instance identity. |
| `Atom.name`                                                | Actually an element symbol, unlike `Molecule.name`.                                                                                                                     | Prefer `element` or `symbol`, with a compatibility alias if needed. Choose one authoritative element identity.                                                                         |
| `protons`, `group`, `period`                               | Normally derivable from element identity, but independently writable.                                                                                                   | Derive from a shared element record unless an explicit query/pseudoatom model requires overrides.                                                                                      |
| `neutrons`                                                 | Used both for isotope adjustment and mass bookkeeping. Standard carbon has `6.0107` here.                                                                               | Separate nullable isotope mass number from standard atomic weight. Clarify whether mass APIs return average or isotope-specific values.                                                |
| `charge`, `electrons`                                      | Independently stored despite `setCharge` defining `electrons = protons - charge`.                                                                                       | Validate formal charge; derive electron count or update it through one shared transition.                                                                                              |
| `radical`                                                  | Validated count with a consistent accessor/setter is a good pattern.                                                                                                    | Keep explicit count and its documented support range; apply the same validation discipline to other scalar fields.                                                                     |
| `aromatic`, `order`, `localizedOrder`                      | Necessary distinctions, but partly synchronized depending on the API used.                                                                                              | Define allowed combinations and representation modes. Share normalization; preserve localized and averaged representations deliberately.                                               |
| `hybridization`                                            | Stored inference with no revision or validity marker.                                                                                                                   | Treat as derived data with chemistry revision, or explicitly name a user override separately.                                                                                          |
| `chirality`, directional bond `stereo`                     | Mix assigned descriptors, structural annotations, and source notation.                                                                                                  | Separate a stereochemical annotation from a derived CIP label and its validity. Centralize how edits preserve or invalidate them.                                                      |
| `display.centerId`, ring-fill atom IDs, reaction atom maps | Useful typed references, with different semantics.                                                                                                                      | Register internal graph references for remapping. Preserve reaction map numbers according to reaction semantics rather than automatically treating them as local IDs.                  |
| `x`, `y`, `z`, `visible`                                   | Practical for the current application, but one boolean conflates chemical H suppression and user visibility. One coordinate slot limits multiple depictions/conformers. | Introduce a clear depiction namespace and coordinate units/missingness contract. Separate display suppression from hydrogen provenance; expand conformer storage when needed.          |
| `Molecule.properties.charge/formula/mass`, `Molecule.name` | Duplicate computed values. `name` is populated as a formula string and overwritten by recomputation.                                                                    | Make derived properties cached read accessors, or expose an explicitly versioned property snapshot. Reserve a distinct field for a user-supplied title.                                |
| `tags`, arbitrary `properties`                             | Extensibility is useful; accepted types and copy behavior are inconsistent.                                                                                             | Declare JSON-compatible metadata or a richer supported type set. Keep extensions in a namespace with one cloning/serialization policy.                                                 |

The explicit-hydrogen graph is an established design choice: queries, valence logic, and stereo consume it. Retain it during the first refactor. Add provenance distinguishing inferred hydrogens from explicitly supplied/isotopic hydrogens so repair and display operations can make intentional decisions.

**Are the methods good?**

| Method family                                                    | Assessment and recommended direction                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addAtom`, `addBond`                                             | Good owning operations, but hidden side effects differ: `addBond` can create/remove H atoms, while its boolean `false` also skips aggregate recomputation. Separate structural insertion, hydrogen policy, and batch finalization.              |
| `removeAtom`, `removeBond`                                       | `removeBond` deletes newly isolated atoms by default. This is documented, but substantial for a graph primitive. Put editor cleanup in an explicit operation or policy and return the removed IDs.                                              |
| Atom/Bond setters and Molecule updates                           | Convenient accessors can remain. Owned state needs one validated edit path; constructors and updates should call the same normalizers. Validate the whole update before committing.                                                             |
| `getNeighbors`                                                   | `Atom.getNeighbors(molecule)` returns Atom objects; `Molecule.getNeighbors(id)` returns IDs. Prefer explicit `neighborAtoms`/`neighborIds` naming or a consistent return convention.                                                            |
| `isChiralCenter`, `getChiralCenters`                             | Without a molecule, the Atom method tests stored annotation; with a molecule it analyzes eligibility. Molecule's method returns annotated centers. Separate annotation queries from graph-based detection.                                      |
| `getRings`, `isInRing`                                           | Separate cycle rank, cycle-basis selection, ring membership, and chemistry-specific ring perception. Define completeness and tie-breaking guarantees; current `getRings` documentation and implementation disagree.                             |
| `getComponents`                                                  | Returning copied Molecules is useful for extraction, but expensive as a primitive query. Add a component-ID iterator/count and use it internally when copies are unnecessary.                                                                   |
| `clone`, `getSubgraph`, `merge`, `resetIds`, fragment paste      | All need a shared schema-aware copy/remapping service. Make structural extraction, snapshot cloning, and duplication distinct contracts. Subgraph extraction can legitimately leave open valences; document chemistry normalization separately. |
| Formula/mass getters                                             | Clear computations, but their `get...` names coexist with mutable stored copies. Choose live computation or versioned cached access as the authoritative interface.                                                                             |
| SMARTS methods                                                   | Thin convenience wrappers are reasonable; module-global registration makes availability depend on imports. Prefer explicit feature functions or a clear capability check/error.                                                                 |
| `repairImplicitHydrogens`, `neutralizeCharge`, resonance methods | These are chemistry operations with broader consequences than scalar assignment. Return a change summary and finalize all affected chemistry state through the same edit coordinator.                                                           |

Use ordinary method names consistently: query methods should not change graph identity or expose writable caches; edit methods should state their side effects and return changes when IDs or topology are affected. A boolean positional argument such as `addBond(..., false)` conceals too much policy.

**Concrete findings supporting this assessment**

All numbered groups below have observations in [core-structures-repros.mjs](/Users/prismane/Documents/Git/molecules/docs/reviews/core-structures-repros.mjs). Run `node docs/reviews/core-structures-repros.mjs`. Assertions capture the current defects and should be replaced with intended-behavior tests after fixes.

**C1 — High: `getRings()` can return an incomplete cycle basis.**

[Molecule.js:1009](/Users/prismane/Documents/Git/molecules/src/core/Molecule.js:1009) selects one shortest cycle per bond, then chooses an independent subset. Those candidates need not span the cycle space. The minimized diagnostic is connected, has seven carbon vertices, eleven edges, maximum degree four, and cycle rank `11 - 7 + 1 = 5`. The method returns only four triangles. It never fills the missing rank or reports incomplete perception.

This was found with seeded small-graph probes and reduced by removing edges while retaining the failure. [ringCount](/Users/prismane/Documents/Git/molecules/src/descriptors/physicochemical.js:614) uses the result length directly, so the issue reaches a public descriptor. Fix the basis algorithm/contract first, then consider which additional ring representation chemistry consumers need. Add rank and independence property tests; a basis count alone does not establish the desired smallest-ring semantics.

**C2 — High: ID reset leaves invalid caches and references; ring queries expose writable cache state.**

[resetIds](/Users/prismane/Documents/Git/molecules/src/core/Molecule.js:528) rewrites IDs and rebuilds the pair index, but leaves `_topologyVersion` unchanged and does not invalidate ring caches or remap ring fills. After warming caches on a triangle and resetting, `getRings()` returns nonexistent old IDs, while the renamed bond reports `isInRing() === false`. Ring-fill references also retain old IDs.

[getRings](/Users/prismane/Documents/Git/molecules/src/core/Molecule.js:1010) returns the cache array itself. Setting the returned array's length to zero changes subsequent query results. Use immutable internal results plus defensive public access, and make renaming an atomic remap/invalidation operation. Audit other mutation routes against the same cache lifecycle; `_adjustImplicitHydrogens` directly changes the graph and relies on callers to finalize it.

**C3 — High: validation differs across entrypoints, and failed updates can commit partially.**

[Bond.setOrder](/Users/prismane/Documents/Git/molecules/src/core/Bond.js:227) rejects `-1`, while [Molecule.updateBond](/Users/prismane/Documents/Git/molecules/src/core/Molecule.js:937) accepts it through `Object.assign`. The latter can retain `aromatic: true` with a newly assigned order that would clear aromaticity through the setter. An update `{ kind: 'ionic', stereo: 'bad' }` changes kind before throwing on stereo.

[Atom.setCharge](/Users/prismane/Documents/Git/molecules/src/core/Atom.js:190) accepts NaN; [setResonanceState](/Users/prismane/Documents/Git/molecules/src/core/Molecule.js:1717) accepts NaN as a state index. Constructors also validate only selected fields. Introduce complete shared normalizers and validate proposed state before assigning any fields. This should be a local invariant guarantee, separate from whether a whole intermediate molecule satisfies chemical valence rules.

**C4 — High: derived chemistry and resonance state drift after normal method calls.**

Calling `atom.setCharge(1)` on parsed ethane makes `molecule.getCharge()` return 1 while `molecule.properties.charge` remains 0. This matters because [the application formula display](/Users/prismane/Documents/Git/molecules/src/app/ui/descriptors.js:192) reads the stored value. `assignHybridizations()` followed by `updateBond(..., { order: 3 })` leaves the adjacent atoms marked `sp3`; [descriptor inference](/Users/prismane/Documents/Git/molecules/src/descriptors/physicochemical.js:74) prefers stored hybridization.

Selecting resonance state 2 of `[O-]C=O` changes charges without updating electron counts. Updating a bond afterward leaves old resonance tables available; selecting state 1 overwrites the edit. `neutralizeCharge` and `changeAtomElement` also lack the resonance invalidation performed by several other Molecule setters.

Use a chemistry revision distinct from topology revision. Classify each derived value and cached ensemble by its dependencies. A chemistry edit should invalidate or recompute the relevant assignments once, at commit.

**C5 — High for metadata integrity: ID changes are not schema-aware.**

[merge](/Users/prismane/Documents/Git/molecules/src/core/Molecule.js:1414) remaps the second molecule's bond endpoints but not `display.centerId`. In a merge of two ethanes, the copied bond connects `C3–C4` while its display center remains `C1`, an atom in the first component. The diagnostic deliberately supplies display metadata to test reference integrity, without claiming ethane is a stereocenter.

Separately, [getBond](/Users/prismane/Documents/Git/molecules/src/core/Molecule.js:923) uses comma-joined endpoint keys. IDs `('a', 'b,c')` collide with `('a,b', 'c')`: lookup returns an unrelated bond, and insertion rejects a legitimate new pair. These are currently accepted string IDs.

Use nested Maps or an unambiguous pair encoding. Have one remapping service cover every declared AtomId/BondId reference, returning mappings to callers. Preserve endpoint ordering when remapping directional stereo.

**C6 — Medium: clone, fragment paste, and JSON have incompatible preservation rules.**

[Molecule._copyAtom](/Users/prismane/Documents/Git/molecules/src/core/Molecule.js:629) and `_copyBond` JSON-clone properties and then restore extra fields with `Object.assign`. Fragment paste [passes properties through constructors](/Users/prismane/Documents/Git/molecules/src/core/support/molecule-fragment.js:503), which discard unrecognized fields. A captured fragment contains `hybridization: 'sp2'` and a custom property; the pasted atom has `hybridization: null` and loses the custom property. The hybridization example is a field-preservation diagnostic, not an assertion that this annotation is chemically appropriate for the fixture.

`clone()` advertises a deep copy but shallow-copies tags: editing an object nested in the clone's tags changes the source. [fromJSON](/Users/prismane/Documents/Git/molecules/src/io/json.js:93) recomputes aggregates, then replaces them with serialized `properties`; a stale charge snapshot survives a round trip.

Define a versioned document schema and a copy policy per category. Treat derived annotations as explicitly preserved snapshots or deliberately invalidated data; avoid losing them accidentally through constructor whitelists. Define metadata type support instead of assuming all values survive JSON cloning.

**C7 — High for stereo, medium for helper semantics: duplicated chemistry rules disagree.**

[Atom.implicitHydrogenCount](/Users/prismane/Documents/Git/molecules/src/core/Atom.js:403) and `isSaturated` use `18 - group` for group 13, while [Molecule's hydrogen adjustment](/Users/prismane/Documents/Git/molecules/src/core/Molecule.js:369) uses 3. Creating a B–C bond with automatic hydrogens gives boron valence 3 and two attached H atoms, yet its helper reports two additional implicit hydrogens and says it is unsaturated.

`new Atom(..., 'O', { charge: -1 }).resolveElement()` stores eight electrons, contradicting the charge/electron relation enforced by `setCharge`. It also overwrites isotope-related element fields rather than merely filling missing data.

The stereo hierarchy code is duplicated in Atom and Molecule. For `[C@]([H])([2H])(F)Cl`, parsing assigns `S` and `assignCIPRanks` returns four distinct ranks, but `isChiralCenter(molecule)` returns false because its [two-H shortcut](/Users/prismane/Documents/Git/molecules/src/core/Atom.js:805) ignores isotope differences. This report establishes the internal disagreement; it is not a comprehensive validation of the CIP implementation. Both hierarchy builders also impose depth 10, which should be an explicit support limitation rather than silently equating unresolved ligands.

Extract shared valence/hydrogen and stereo analysis services with documented supported cases and indeterminate results. The Atom methods can remain convenient delegates.

**C8 — Medium: fragment coordinates turn missing values into real zeroes.**

[finiteNumber](/Users/prismane/Documents/Git/molecules/src/core/support/molecule-fragment.js:24) applies `Number(value)`, so `null` becomes zero. A fragment with one atom at `(10,10)` and one unplaced atom at `(null,null)` gets center `(5,5)`. The unplaced atom participates as if positioned at the origin.

Use an explicit missing-coordinate predicate and finite numeric validation. Decide separately whether deserialization may coerce numeric strings. A null default should retain its meaning throughout the model and editing layers.

**C9 — Medium, size-dependent: ring membership can exhaust the JavaScript stack.**

[The bridge traversal](/Users/prismane/Documents/Git/molecules/src/core/Molecule.js:130) is recursive. A constructed 8,000-atom linear chain raises `RangeError: Maximum call stack size exceeded` when checking one bond's ring membership on this runtime. The exact threshold is runtime-dependent.

Use an explicit DFS stack. Also separate connected-component discovery from copying: [getRings](/Users/prismane/Documents/Git/molecules/src/core/Molecule.js:1024) calls `getComponents().length`, and [getComponents](/Users/prismane/Documents/Git/molecules/src/core/Molecule.js:1204) materializes complete Molecule copies. Each extraction scans all bonds, adding work proportional to component count times total bonds. A topology query should have a lightweight component-count path.

**C10 — Medium API issue: SMARTS method availability depends on import side effects.**

With a core-only import, `new Molecule().matchesSMARTS('C')` throws `_smartsMatches is not a function`. [The registration happens in smarts/index.js](/Users/prismane/Documents/Git/molecules/src/smarts/index.js:13), while the wrappers are present on every Molecule.

Expose optional algorithms explicitly, or make unsupported capability errors actionable. Check the package's `sideEffects: false` declaration against registration-based behavior in a consumer bundle. That bundler failure mode was not reproduced here. Runtime coupling also deserves attention: constructors import `node:crypto`; the browser demo supplies an import-map shim. Put UUID generation behind a shared runtime abstraction if raw browser consumption is a supported target.

**Recommended architecture changes**

The most valuable new abstraction is a **Molecule edit transaction**. It should validate requested changes, apply topology/chemistry mutations, handle reference remapping, invalidate dependency-specific caches, and return a `ChangeSet`. Parsing and bulk imports can use the same machinery in a batch mode. This gives existing uses of `_recomputeProperties`, `_rebuildBondIndex`, and `_adjustImplicitHydrogens` a supported public replacement.

Keep these responsibilities distinct:

| Responsibility                                                  | Owner / suggested boundary                                            |
| --------------------------------------------------------------- | --------------------------------------------------------------------- |
| Atom/bond existence, adjacency, pair index, local IDs           | Molecule graph/editor                                                 |
| Immutable scalar records and validated field transitions        | Atom/Bond value schema                                                |
| Cycle basis, membership, valence, stereo, hybridization         | Analysis modules with thin Molecule/Atom delegates where useful       |
| Cached derived results                                          | Per-Molecule analysis cache keyed by topology and chemistry revisions |
| Coordinates, visibility, styles, ring fills, clipboard geometry | Depiction/document editing layer                                      |
| JSON import/export and extension metadata                       | Versioned document schema and shared copy/remapping helpers           |

A read-only graph view can be a documented interface first; it need not immediately replace the current Maps or require fully immutable molecule snapshots. Type annotations or `checkJs` would help enforce AtomId versus BondId, nullable coordinates, computed-state validity, and the distinction between partial and committed edits.

For performance, fix avoidable repeated work before changing the representation. [_generateAutoAtomId](/Users/prismane/Documents/Git/molecules/src/core/Molecule.js:588) scans all existing IDs on every automatic insertion, despite having a counter field. Use a monotonic per-prefix allocator with collision checks. Batch aggregate computation. Replace recursive graph traversal and avoid component copies for counts. Measure import/edit/query latency and allocations on disconnected structures, polymers, and explicit-H molecules; no broad throughput claim is made from the small diagnostics here.

**Implementation order**

1. Fix the ring basis and ID-reset/reference defects; add a graph invariant checker and independent cycle-rank tests.
2. Unify constructor/update validation and make updates atomic. Add consistent chemistry/topology invalidation, including resonance and hybridization.
3. Consolidate copy, remapping, and persistence schemas. Resolve ID/UUID, metadata, and null-coordinate semantics.
4. Centralize duplicated valence/hydrogen/stereo logic and distinguish annotation queries from analysis queries.
5. Introduce the supported batch editor and lightweight topology queries, then migrate direct field writers in parsers, SMIRKS, and UI code.
6. Separate depiction and optional feature wiring where it improves ownership. Preserve compatible public facades during migration.

**Validation and limits**

- Core baseline: **268 tests passed**, no failures or skips.
- Broader baseline: **1,944 tests passed**, no failures or skips, across core, I/O, algorithms, SMARTS, SMIRKS, validation, descriptors, matrices, and networks. The 268 core tests are included in this total.
- Executed the attached diagnostic script and additional seeded graph probes. The graph counterexample was minimized, and the recursion failure was observed at 8,000 and 16,000 atoms on Node `v25.2.1`.
- UI/browser and layout stress suites were not rerun for this review. Full chemistry standard conformance, all resonance structures, and complete stereo algorithm correctness remain outside this architectural assessment.
- Production files were unchanged; the deliverables are this report and its diagnostic script.

The best next step is a focused core-contract cleanup: keep the model approachable, make edits coherent, and ensure every cached or copied field has a declared source of truth and lifecycle.
