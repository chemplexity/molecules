/** @module utils/format-chem-text */

const NORMAL = 'normal';
const SUBSCRIPT = 'sub';
const SUPERSCRIPT = 'super';
const HEAT_SYMBOL = '\u0394';

function isDigit(char) {
  return char >= '0' && char <= '9';
}

function isAsciiLetter(char) {
  return (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z');
}

function isChargeSign(char) {
  return char === '+' || char === '-';
}

function isFormulaBeforeSubscript(char) {
  return isAsciiLetter(char) || char === ')' || char === ']';
}

function isFormulaBeforeCharge(char) {
  return isAsciiLetter(char) || isDigit(char) || char === ')' || char === ']';
}

function isChargeTerminator(char) {
  return char === undefined || /[\s,;:./)]/.test(char);
}

function appendToken(tokens, text, baseline = NORMAL) {
  if (!text) {
    return;
  }
  const previous = tokens[tokens.length - 1];
  if (previous?.baseline === baseline) {
    previous.text += text;
    return;
  }
  tokens.push({ text, baseline });
}

function appendNormalText(tokens, text) {
  let cursor = 0;
  for (const match of text.matchAll(/\bheat\b/gi)) {
    appendToken(tokens, text.slice(cursor, match.index), NORMAL);
    appendToken(tokens, HEAT_SYMBOL, NORMAL);
    cursor = match.index + match[0].length;
  }
  appendToken(tokens, text.slice(cursor), NORMAL);
}

/**
 * Tokenizes formula-like chemistry text for renderer-neutral subscript and
 * superscript display.
 *
 * The parser intentionally keeps source text plain ASCII. Digits that follow a
 * formula token are marked as subscripts, while terminal charge signs are marked
 * as superscripts. Non-formula numbers such as `1 equiv` or `2-methyl` remain
 * normal text.
 * @param {string} text - Plain chemistry label or reagent text.
 * @returns {{text: string, baseline: 'normal'|'sub'|'super'}[]} Display tokens.
 * @example
 * tokenizeChemText('H2SO4, heat');
 * // [
 * //   { text: 'H', baseline: 'normal' },
 * //   { text: '2', baseline: 'sub' },
 * //   { text: 'SO', baseline: 'normal' },
 * //   { text: '4', baseline: 'sub' },
 * //   { text: ', \u0394', baseline: 'normal' }
 * // ]
 */
export function tokenizeChemText(text) {
  if (typeof text !== 'string') {
    throw new TypeError('tokenizeChemText expects a string');
  }

  const tokens = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const previous = text[index - 1];

    if (isDigit(char)) {
      let digits = '';
      while (index < text.length && isDigit(text[index])) {
        digits += text[index++];
      }

      if ((previous === ')' || previous === ']') && isChargeSign(text[index]) && isChargeTerminator(text[index + 1])) {
        appendToken(tokens, `${digits}${text[index++]}`, SUPERSCRIPT);
      } else {
        appendToken(tokens, digits, isFormulaBeforeSubscript(previous) ? SUBSCRIPT : NORMAL);
      }
      continue;
    }

    if (isChargeSign(char) && isFormulaBeforeCharge(previous) && isChargeTerminator(text[index + 1])) {
      let signs = '';
      while (index < text.length && isChargeSign(text[index])) {
        signs += text[index++];
      }
      appendToken(tokens, signs, SUPERSCRIPT);
      continue;
    }

    let normal = '';
    while (index < text.length && !isDigit(text[index])) {
      const current = text[index];
      const before = text[index - 1];
      if (isChargeSign(current) && isFormulaBeforeCharge(before) && isChargeTerminator(text[index + 1])) {
        break;
      }
      normal += current;
      index++;
    }
    appendNormalText(tokens, normal);
  }

  return tokens;
}
