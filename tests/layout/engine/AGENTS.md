# Layout Engine Test Organization

Keep this test tree organized by production behavior or subsystem, not by the
individual bug that introduced a regression test.

## Choosing a test file

- Add a regression to the existing suite that owns the behavior whenever one
  exists. Examples include `constraints/`, `families/`, `placement/`,
  `cleanup/`, `topology/`, and `stereo/`.
- Group closely related molecule fixtures as table-driven cases in one suite.
  Do not create a new test file for each molecule, corpus row, or reported bug.
- Create a new file only when the behavior has a distinct production owner,
  requires materially different setup, or uses a different execution mode.
- Keep browser, opt-in stress, and ordinary unit coverage separate because they
  have different dependencies, timeouts, and CI execution paths.
- Prefer suites of roughly 150–500 lines. Split files that mix unrelated
  subsystems or become difficult to navigate; do not grow `pipeline.test.js` or
  `families/mixed.test.js` with behavior that has a clearer owner.

## Fixtures and assertions

- Put reusable molecule or corpus data in `support/` when multiple suites need
  it. Keep a fixture local when its chemistry is meaningful only to one suite.
- Share generic assertions such as coordinate completeness, finiteness, fixed
  coordinate preservation, and standard audit invariants.
- Keep chemistry-specific geometry limits and regression expectations beside
  their cases. Do not hide important tolerances inside a generic helper.
- Preserve descriptive test names so `--test-name-pattern` remains useful.
- Cover relevant option matrices with loops or case tables instead of copied
  tests, including bond length, generate/refine entry points, and hydrogen
  suppression when those options affect the behavior.

## Consolidation and verification

- Consolidation must not remove tests or weaken assertions. Compare the total
  test count before and after a structural refactor.
- Run the affected suites first, then run the repository's CI commands:
  `npm run lint`, `npm test`, `npm run test:e2e`, `npm run build`, and
  `npm run test:package`.
- Run `git diff --check` and format every changed file before handing off.
- Update `docs/change-log.md` under the current date without referring to
  internal corpus row numbers.
