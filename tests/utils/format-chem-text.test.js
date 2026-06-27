import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeChemText } from '../../src/utils/index.js';

describe('tokenizeChemText', () => {
  it('marks formula counts as subscripts', () => {
    assert.deepEqual(tokenizeChemText('H2SO4'), [
      { text: 'H', baseline: 'normal' },
      { text: '2', baseline: 'sub' },
      { text: 'SO', baseline: 'normal' },
      { text: '4', baseline: 'sub' }
    ]);
  });

  it('marks terminal charge signs as superscripts', () => {
    assert.deepEqual(tokenizeChemText('H3O+'), [
      { text: 'H', baseline: 'normal' },
      { text: '3', baseline: 'sub' },
      { text: 'O', baseline: 'normal' },
      { text: '+', baseline: 'super' }
    ]);
  });

  it('keeps non-formula numbers at the normal baseline', () => {
    assert.deepEqual(tokenizeChemText('1 equiv mCPBA'), [{ text: '1 equiv mCPBA', baseline: 'normal' }]);
    assert.deepEqual(tokenizeChemText('2-methyl-2-butene'), [{ text: '2-methyl-2-butene', baseline: 'normal' }]);
  });

  it('handles reagent labels that mix formula text and prose', () => {
    assert.deepEqual(tokenizeChemText('NaOH, heat; H3O+ workup'), [
      { text: 'NaOH, \u0394; H', baseline: 'normal' },
      { text: '3', baseline: 'sub' },
      { text: 'O', baseline: 'normal' },
      { text: '+', baseline: 'super' },
      { text: ' workup', baseline: 'normal' }
    ]);
  });

  it('renders standalone heat as a delta symbol without changing embedded words', () => {
    assert.deepEqual(tokenizeChemText('H2SO4, heat'), [
      { text: 'H', baseline: 'normal' },
      { text: '2', baseline: 'sub' },
      { text: 'SO', baseline: 'normal' },
      { text: '4', baseline: 'sub' },
      { text: ', \u0394', baseline: 'normal' }
    ]);
    assert.deepEqual(tokenizeChemText('preheat then HEAT'), [{ text: 'preheat then \u0394', baseline: 'normal' }]);
  });

  it('supports condensed reagent abbreviations with counts', () => {
    assert.deepEqual(tokenizeChemText('Bu3SnH, AIBN'), [
      { text: 'Bu', baseline: 'normal' },
      { text: '3', baseline: 'sub' },
      { text: 'SnH, AIBN', baseline: 'normal' }
    ]);
  });

  it('marks bracketed ion charges as superscripts', () => {
    assert.deepEqual(tokenizeChemText('[Fe(CN)6]3-'), [
      { text: '[Fe(CN)', baseline: 'normal' },
      { text: '6', baseline: 'sub' },
      { text: ']', baseline: 'normal' },
      { text: '3-', baseline: 'super' }
    ]);
  });

  it('throws for non-string input', () => {
    assert.throws(() => tokenizeChemText(null), /expects a string/);
  });
});
