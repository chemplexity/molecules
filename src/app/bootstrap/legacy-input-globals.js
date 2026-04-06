/** @module app/bootstrap/legacy-input-globals */

export function initLegacyInputGlobals({ win, exampleMolecules }) {
  win.setInputFormat = (fmt, options = {}) => {
    win._setInputFormat?.(fmt, options);
  };

  win.renderExamples = () => {
    win._renderExamples?.();
  };

  win.pickRandomMolecule = () => {
    win._pickRandomMolecule?.();
  };

  win.parseInput = value => {
    win._parseInput?.(value);
  };

  win._getExampleMolecules = () => exampleMolecules;
}
