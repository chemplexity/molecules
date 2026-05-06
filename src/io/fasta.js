/** @module io/fasta */

import aminoAcids from '../data/amino-acids.js';
import nucleotides, { rnaNucleotides } from '../data/nucleotides.js';
import { parseSMILES } from './smiles.js';

// ---------------------------------------------------------------------------
// Nucleotide sets — used by detectSequenceType
// ---------------------------------------------------------------------------

const DNA_ONLY = new Set(['T']);
const RNA_ONLY = new Set(['U']);
const NUCLEOTIDE_CHARS = new Set([...Object.keys(nucleotides), ...Object.keys(rnaNucleotides), 'R', 'Y', 'S', 'W', 'K', 'M', 'B', 'D', 'H', 'V', 'N']);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds a reverse lookup from three-letter code (upper-cased) to one-letter code.
 * @type {Record<string, string>}
 */
const THREE_TO_ONE = Object.fromEntries(Object.values(aminoAcids).map(({ three, one }) => [three.toUpperCase(), one]));

/**
 * Returns whether a stripped sequence string is in three-letter code format
 * (without hyphens). Requires the length to be divisible by 3 AND every
 * three-character token to be a recognised three-letter amino acid code.
 * This prevents ambiguous sequences like `'ACD'` (valid as one-letter A-C-D)
 * from being misidentified as three-letter format.
 * @param {string} stripped - Whitespace-free sequence string.
 * @returns {boolean} True if the string looks like concatenated three-letter codes.
 */
function isThreeLetterFormat(stripped) {
  if (stripped.length === 0 || stripped.length % 3 !== 0) {
    return false;
  }
  const tokens = stripped.match(/.{3}/g);
  return tokens.every(t => THREE_TO_ONE[t.toUpperCase()] !== undefined);
}

/**
 * Normalises a raw sequence string into a one-letter uppercase string.
 *
 * Accepts:
 * - Plain one-letter sequence (e.g. `'ACDEFG'`)
 * - Three-letter codes separated by hyphens (e.g. `'Ala-Gly-Pro'`)
 * - Concatenated three-letter codes where every token is a valid code
 *   (e.g. `'AlaGlyCys'`)
 * @param {string} input - Raw sequence string (FASTA body line(s) already stripped).
 * @returns {string} Uppercase one-letter sequence.
 * @throws {Error} If an unrecognised residue code is encountered.
 */
function normaliseSequence(input) {
  const stripped = input.replace(/\s/g, '');

  if (stripped.includes('-')) {
    return stripped
      .split('-')
      .map(t => {
        const one = THREE_TO_ONE[t.toUpperCase()];
        if (!one) {
          throw new Error(`Unknown amino acid three-letter code: ${t}`);
        }
        return one;
      })
      .join('');
  }

  if (isThreeLetterFormat(stripped)) {
    return stripped
      .match(/.{3}/g)
      .map(t => THREE_TO_ONE[t.toUpperCase()])
      .join('');
  }

  const upper = stripped.toUpperCase();
  for (const ch of upper) {
    if (!aminoAcids[ch]) {
      throw new Error(`Unknown amino acid one-letter code: ${ch}`);
    }
  }
  return upper;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a FASTA-formatted string into an array of sequence records.
 *
 * Multi-record FASTA files (multiple `>` headers) are fully supported.
 * Lines beginning with `;` are treated as comments and ignored.
 * @param {string} text - Raw FASTA text.
 * @returns {Array<{id: string, description: string, sequence: string}>}
 *   One entry per `>` header block. `id` is the first whitespace-delimited
 *   token after `>`; `description` is the remainder of the header line;
 *   `sequence` is the concatenated, whitespace-stripped body as uppercase
 *   one-letter codes.
 * @throws {Error} If the text contains no valid FASTA records, or if an
 *   unrecognised residue code is encountered.
 * @example
 * const records = parseFASTA('>sp|P69905|HBA_HUMAN Alpha haemoglobin\nMVLSPADK');
 * // [{ id: 'sp|P69905|HBA_HUMAN', description: 'Alpha haemoglobin', sequence: 'MVLSPADK' }]
 */
export function parseFASTA(text) {
  const records = [];
  let current = null;

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();

    if (line.startsWith(';') || line === '') {
      continue;
    }

    if (line.startsWith('>')) {
      if (current) {
        current.sequence = normaliseSequence(current._body);
        delete current._body;
        records.push(current);
      }
      const header = line.slice(1).trim();
      const spaceIdx = header.search(/\s/);
      const id = spaceIdx === -1 ? header : header.slice(0, spaceIdx);
      const description = spaceIdx === -1 ? '' : header.slice(spaceIdx + 1).trim();
      current = { id, description, sequence: '', _body: '' };
    } else if (current) {
      current._body += line;
    }
  }

  if (current) {
    current.sequence = normaliseSequence(current._body);
    delete current._body;
    records.push(current);
  }

  if (records.length === 0) {
    throw new Error('No valid FASTA records found in input');
  }

  return records;
}

/**
 * Converts a biological sequence into a `Molecule`.
 *
 * Auto-detects the sequence type via {@link detectSequenceType} and dispatches
 * to the appropriate builder:
 * - DNA (contains `T`) → {@link sequenceToOligonucleotide} with `type: 'dna'`
 * - RNA (contains `U`) → {@link sequenceToOligonucleotide} with `type: 'rna'`
 * - Protein / ambiguous (`A`/`C`/`G`/`N` only) → {@link sequenceToPeptide}
 *
 * For protein sequences, both one-letter (`'GA'`) and three-letter formats
 * (`'Gly-Ala'`, `'GlyAla'`) are accepted.
 * @param {string} sequence - One-letter sequence string (or three-letter for proteins).
 * @returns {import('../core/Molecule.js').Molecule} Molecule graph for the sequence.
 * @throws {Error} If the sequence is empty or contains an unknown residue code.
 * @example
 * sequenceToMolecule('GA');    // Gly-Ala dipeptide
 * sequenceToMolecule('ATG');   // DNA trinucleotide
 * sequenceToMolecule('AUG');   // RNA trinucleotide
 */
export function sequenceToMolecule(sequence) {
  const upper = sequence.replace(/\s/g, '').toUpperCase();
  const type = detectSequenceType(upper);

  if (type === 'dna' || type === 'rna') {
    return sequenceToOligonucleotide(upper, { type });
  }

  return sequenceToPeptide(sequence);
}

/**
 * Converts a one-letter amino acid sequence into a `Molecule` by joining
 * residue SMILES strings via peptide bonds and parsing the result.
 *
 * The N-terminus retains a free amine (`H2N-`) and the C-terminus retains a
 * free carboxyl (`-COOH`), matching the free amino acid SMILES stored in the
 * amino acids table.
 * @param {string} sequence - Uppercase one-letter amino acid sequence. May also
 *   be in three-letter format (`'Gly-Ala'`, `'GlyAla'`) — normalised internally.
 * @returns {import('../core/Molecule.js').Molecule} Molecule graph for the peptide.
 * @throws {Error} If the sequence is empty or contains an unknown residue code.
 * @example
 * sequenceToPeptide('GA');       // Gly-Ala dipeptide
 * sequenceToPeptide('Gly-Ala'); // same result
 */
export function sequenceToPeptide(sequence) {
  const seq = normaliseSequence(sequence);

  if (seq.length === 0) {
    throw new Error('Sequence must contain at least one residue');
  }

  if (seq.length === 1) {
    return parseSMILES(aminoAcids[seq].smiles);
  }

  // Build a linear peptide SMILES by removing the C-terminal -OH from each
  // residue except the last, then concatenating (the next residue's N bonds
  // directly to the open carbonyl).
  const parts = seq.split('').map((code, i) => {
    const { smiles } = aminoAcids[code];
    if (i < seq.length - 1) {
      return smiles.replace(/C\(=O\)O$/, 'C(=O)');
    }
    return smiles;
  });

  const mol = parseSMILES(parts.join(''));
  mol.name = seq;
  return mol;
}

/**
 * Detects whether a sequence string is a protein, DNA, RNA, or ambiguous.
 *
 * Detection rules (applied to the uppercase one-letter sequence):
 * - Contains `T` (thymine) → `'dna'`
 * - Contains `U` (uracil)  → `'rna'`
 * - Contains only `A`, `C`, `G`, `N` and no `T`/`U` → `'ambiguous'`
 * - Contains any letter outside the nucleotide alphabet → `'protein'`
 * @param {string} sequence - Uppercase one-letter sequence.
 * @returns {'protein'|'dna'|'rna'|'ambiguous'} Detected sequence type.
 * @example
 * detectSequenceType('ATGC');   // 'dna'
 * detectSequenceType('AUGC');   // 'rna'
 * detectSequenceType('MVLS');   // 'protein'
 * detectSequenceType('ACGN');   // 'ambiguous'
 */
export function detectSequenceType(sequence) {
  const upper = sequence.toUpperCase();
  let hasT = false;
  let hasU = false;

  for (const ch of upper) {
    if (!NUCLEOTIDE_CHARS.has(ch)) {
      return 'protein';
    }
    if (DNA_ONLY.has(ch)) {
      hasT = true;
    }
    if (RNA_ONLY.has(ch)) {
      hasU = true;
    }
  }

  if (hasT) {
    return 'dna';
  }
  if (hasU) {
    return 'rna';
  }
  return 'ambiguous';
}

/**
 * Converts a one-letter nucleotide sequence into a `Molecule` by joining
 * nucleoside SMILES strings via phosphodiester bonds.
 *
 * The 5'-terminus retains a free hydroxyl and the 3'-terminus retains a free
 * hydroxyl, matching a linear oligonucleotide with no terminal phosphates.
 * @param {string} sequence - Uppercase one-letter nucleotide sequence (e.g. `'ATGC'`
 *   for DNA or `'AUGC'` for RNA). Type is auto-detected via
 *   {@link detectSequenceType}; pass `options.type` to force.
 * @param {object} [options] - Options.
 * @param {'dna'|'rna'} [options.type] - Force `'dna'` or `'rna'` sugar type.
 *   When omitted, inferred from the sequence.
 * @returns {import('../core/Molecule.js').Molecule} Molecule graph for the oligonucleotide.
 * @throws {Error} If the sequence is empty, contains unknown codes, or type
 *   cannot be determined.
 * @example
 * const mol = sequenceToNucleicAcid('ATG');   // DNA
 * const mol = sequenceToNucleicAcid('AUG');   // RNA
 * const mol = sequenceToNucleicAcid('ACG', { type: 'rna' });  // force RNA
 */
export function sequenceToOligonucleotide(sequence, { type } = {}) {
  const seq = sequence.toUpperCase().replace(/\s/g, '');

  if (seq.length === 0) {
    throw new Error('Sequence must contain at least one nucleotide');
  }

  const resolvedType = type ?? detectSequenceType(seq);
  if (resolvedType === 'protein') {
    throw new Error('Sequence appears to be a protein; use sequenceToMolecule instead');
  }

  // Choose the appropriate nucleoside lookup table.
  // For 'ambiguous' (only A/G/C/N), default to DNA.
  const table = resolvedType === 'rna' ? rnaNucleotides : nucleotides;

  // Build a phosphodiester-linked SMILES:
  // 5'-HO-sugar(base)-3'-O-P(=O)(O)-O-5'-sugar(base)-3'-OH
  //
  // Strategy: strip the 5'-OH from each nucleoside except the first, and
  // insert a phosphodiester linker (OP(=O)(O)O) between residues.
  // Each nucleoside SMILES starts with OC[C@H]1... where the leading O is
  // the 5'-hydroxyl. We remove it for all but the first residue and prepend
  // the phosphate linker.
  const PHOSPHATE_LINKER = 'OP(=O)(O)O';

  const parts = seq.split('').map((code, i) => {
    const entry = table[code];
    if (!entry) {
      throw new Error(`Unknown nucleotide code: ${code}`);
    }
    if (i === 0) {
      return entry.smiles;
    }
    // Strip leading 'O' (5'-OH) and prepend phosphodiester linker
    return PHOSPHATE_LINKER + entry.smiles.replace(/^O/, '');
  });

  const mol = parseSMILES(parts.join(''));
  mol.name = seq;
  return mol;
}

/**
 * Serialises a sequence string (or a Molecule whose `name` is a sequence) to
 * FASTA format.
 * @param {string|import('../core/Molecule.js').Molecule} sequenceOrMolecule
 *   Either a one-letter sequence string or a `Molecule` with a sequence stored
 *   in `mol.name`.
 * @param {string} [id]   - Identifier placed after `>`.
 * @param {string} [description]  - Optional free-text description on the header line.
 * @returns {string} FASTA-formatted string with 60-character line wrapping.
 * @example
 * toFASTA('MVLSPADK', 'HBA_HUMAN', 'Alpha haemoglobin subunit');
 * // '>HBA_HUMAN Alpha haemoglobin subunit\nMVLSPADK'
 */
export function toFASTA(sequenceOrMolecule, id = 'sequence', description = '') {
  const sequence = typeof sequenceOrMolecule === 'string' ? sequenceOrMolecule : sequenceOrMolecule.name;

  const header = description ? `>${id} ${description}` : `>${id}`;
  const lines = [header];
  for (let i = 0; i < sequence.length; i += 60) {
    lines.push(sequence.slice(i, i + 60));
  }
  return lines.join('\n');
}

/**
 * Converts a one-letter sequence to three-letter code notation separated by
 * hyphens (e.g. `'AG'` → `'Ala-Gly'`).
 * @param {string} sequence - Uppercase one-letter sequence.
 * @returns {string} Hyphen-separated three-letter codes.
 * @throws {Error} If the sequence contains an unknown residue code.
 */
export function toThreeLetter(sequence) {
  const seq = normaliseSequence(sequence);
  return seq
    .split('')
    .map(code => aminoAcids[code].three)
    .join('-');
}
