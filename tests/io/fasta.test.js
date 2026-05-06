import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFASTA, sequenceToMolecule, sequenceToPeptide, sequenceToOligonucleotide, detectSequenceType, toFASTA, toThreeLetter } from '../../src/io/fasta.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Count atoms of a given element symbol in a molecule.
 * @param {object} mol - Molecule graph.
 * @param {string} symbol - Element symbol.
 * @returns {number} Number of matching atoms.
 */
function countElement(mol, symbol) {
  let n = 0;
  for (const atom of mol.atoms.values()) {
    if (atom.name === symbol) {
      n++;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// parseFASTA — input validation
// ---------------------------------------------------------------------------

describe('parseFASTA — input validation', () => {
  it('throws on empty string', () => assert.throws(() => parseFASTA(''), /No valid FASTA records/));
  it('throws on string with no > header', () => assert.throws(() => parseFASTA('ACDEF'), /No valid FASTA records/));
  it('throws on unknown one-letter code', () => assert.throws(() => parseFASTA('>id\nACDEFX'), /Unknown amino acid one-letter code: X/));
  it('throws on unknown three-letter code', () => assert.throws(() => parseFASTA('>id\nAla-Xyz'), /Unknown amino acid three-letter code: Xyz/));
});

// ---------------------------------------------------------------------------
// parseFASTA — single record
// ---------------------------------------------------------------------------

describe('parseFASTA — single record', () => {
  const input = '>sp|P69905|HBA_HUMAN Alpha haemoglobin subunit\nMVLSPADK';
  const [record] = parseFASTA(input);

  it('parses id', () => assert.equal(record.id, 'sp|P69905|HBA_HUMAN'));
  it('parses description', () => assert.equal(record.description, 'Alpha haemoglobin subunit'));
  it('parses sequence', () => assert.equal(record.sequence, 'MVLSPADK'));
});

describe('parseFASTA — header with no description', () => {
  const [record] = parseFASTA('>SEQ1\nACDEF');
  it('id is correct', () => assert.equal(record.id, 'SEQ1'));
  it('description is empty string', () => assert.equal(record.description, ''));
  it('sequence is correct', () => assert.equal(record.sequence, 'ACDEF'));
});

describe('parseFASTA — sequence split across multiple lines', () => {
  const input = '>id\nACDE\nFGHI';
  const [record] = parseFASTA(input);
  it('concatenates lines into one sequence', () => assert.equal(record.sequence, 'ACDEFGHI'));
});

describe('parseFASTA — lowercased sequence', () => {
  const [record] = parseFASTA('>id\nacdef');
  it('uppercases sequence', () => assert.equal(record.sequence, 'ACDEF'));
});

describe('parseFASTA — comment lines are ignored', () => {
  const input = ';this is a comment\n>id\nACD';
  const records = parseFASTA(input);
  it('returns one record', () => assert.equal(records.length, 1));
  it('sequence is correct', () => assert.equal(records[0].sequence, 'ACD'));
});

describe('parseFASTA — blank lines are ignored', () => {
  const input = '>id\nACD\n\nEF';
  const [record] = parseFASTA(input);
  it('concatenates across blank lines', () => assert.equal(record.sequence, 'ACDEF'));
});

// ---------------------------------------------------------------------------
// parseFASTA — multi-record
// ---------------------------------------------------------------------------

describe('parseFASTA — multi-record', () => {
  const input = '>seq1 first\nACDE\n>seq2 second\nFGHI';
  const records = parseFASTA(input);

  it('returns two records', () => assert.equal(records.length, 2));
  it('first record id', () => assert.equal(records[0].id, 'seq1'));
  it('first record sequence', () => assert.equal(records[0].sequence, 'ACDE'));
  it('second record id', () => assert.equal(records[1].id, 'seq2'));
  it('second record sequence', () => assert.equal(records[1].sequence, 'FGHI'));
});

// ---------------------------------------------------------------------------
// parseFASTA — three-letter code input
// ---------------------------------------------------------------------------

describe('parseFASTA — three-letter hyphen-separated sequence', () => {
  const [record] = parseFASTA('>id\nAla-Gly-Pro');
  it('converts to one-letter sequence', () => assert.equal(record.sequence, 'AGP'));
});

// ---------------------------------------------------------------------------
// sequenceToMolecule — input validation
// ---------------------------------------------------------------------------

describe('sequenceToMolecule — input validation', () => {
  it('throws on empty sequence', () => assert.throws(() => sequenceToMolecule(''), /at least one/));
  it('throws on unknown code', () => assert.throws(() => sequenceToMolecule('AXG'), /Unknown amino acid one-letter code: X/));
});

// ---------------------------------------------------------------------------
// sequenceToMolecule — DNA/RNA dispatch
// ---------------------------------------------------------------------------

describe('sequenceToMolecule — dispatches DNA sequence to sequenceToOligonucleotide', () => {
  const dna = sequenceToMolecule('AT');
  const ref = sequenceToOligonucleotide('AT');
  it('produces same atom count as sequenceToOligonucleotide', () => assert.equal(dna.atoms.length, ref.atoms.length));
  it('name is set', () => assert.equal(dna.name, 'AT'));
});

describe('sequenceToMolecule — dispatches RNA sequence to sequenceToOligonucleotide', () => {
  const rna = sequenceToMolecule('AU');
  const ref = sequenceToOligonucleotide('AU');
  it('produces same atom count as sequenceToOligonucleotide', () => assert.equal(rna.atoms.length, ref.atoms.length));
  it('name is set', () => assert.equal(rna.name, 'AU'));
});

describe('sequenceToMolecule — dispatches protein sequence to sequenceToPeptide', () => {
  const mol = sequenceToMolecule('GA');
  const ref = sequenceToPeptide('GA');
  it('produces same atom count as sequenceToPeptide', () => assert.equal(mol.atoms.length, ref.atoms.length));
});

// ---------------------------------------------------------------------------
// sequenceToPeptide — input validation
// ---------------------------------------------------------------------------

describe('sequenceToPeptide — input validation', () => {
  it('throws on empty sequence', () => assert.throws(() => sequenceToPeptide(''), /at least one residue/));
  it('throws on unknown code', () => assert.throws(() => sequenceToPeptide('AXG'), /Unknown amino acid one-letter code: X/));
});

// ---------------------------------------------------------------------------
// sequenceToPeptide — single residue (free amino acid)
// ---------------------------------------------------------------------------

describe('sequenceToPeptide — single residue G (Glycine)', () => {
  const mol = sequenceToPeptide('G');
  it('contains nitrogen', () => assert.equal(countElement(mol, 'N') >= 1, true));
  it('contains oxygen', () => assert.equal(countElement(mol, 'O') >= 1, true));
  it('contains carbon', () => assert.equal(countElement(mol, 'C') >= 1, true));
});

describe('sequenceToPeptide — single residue A (Alanine)', () => {
  const mol = sequenceToPeptide('A');
  it('has 3 carbons', () => assert.equal(countElement(mol, 'C'), 3));
  it('has 1 nitrogen', () => assert.equal(countElement(mol, 'N'), 1));
  it('has 2 oxygens', () => assert.equal(countElement(mol, 'O'), 2));
});

// ---------------------------------------------------------------------------
// sequenceToPeptide — dipeptide
// ---------------------------------------------------------------------------

describe('sequenceToPeptide — dipeptide GA (Gly-Ala)', () => {
  const mol = sequenceToPeptide('GA');
  // Gly: C2, N1, O2; Ala: C3, N1, O2 → peptide bond removes 1 O → C5, N2, O3
  it('name is set to sequence', () => assert.equal(mol.name, 'GA'));
  it('has 5 carbons', () => assert.equal(countElement(mol, 'C'), 5));
  it('has 2 nitrogens', () => assert.equal(countElement(mol, 'N'), 2));
  it('has 3 oxygens', () => assert.equal(countElement(mol, 'O'), 3));
});

// ---------------------------------------------------------------------------
// sequenceToPeptide — three-letter input
// ---------------------------------------------------------------------------

describe('sequenceToPeptide — accepts three-letter input', () => {
  const mol = sequenceToPeptide('Gly-Ala');
  it('name is normalised sequence', () => assert.equal(mol.name, 'GA'));
  it('has 5 carbons', () => assert.equal(countElement(mol, 'C'), 5));
});

// ---------------------------------------------------------------------------
// toFASTA
// ---------------------------------------------------------------------------

describe('toFASTA — string sequence', () => {
  it('basic output', () => assert.equal(toFASTA('MVLSPADK', 'HBA', 'haemoglobin'), '>HBA haemoglobin\nMVLSPADK'));
  it('no description omits trailing space', () => assert.equal(toFASTA('ACD', 'id'), '>id\nACD'));
  it('default id', () => assert.match(toFASTA('ACD'), /^>sequence\n/));
});

describe('toFASTA — long sequence is wrapped at 60 chars', () => {
  const seq = 'A'.repeat(70);
  const result = toFASTA(seq, 'id');
  const lines = result.split('\n');
  it('has 3 lines (header + 2 body lines)', () => assert.equal(lines.length, 3));
  it('first body line is 60 chars', () => assert.equal(lines[1].length, 60));
  it('second body line is 10 chars', () => assert.equal(lines[2].length, 10));
});

describe('toFASTA — accepts Molecule with name', () => {
  const mol = sequenceToMolecule('GA');
  const result = toFASTA(mol, 'peptide');
  it('uses mol.name as sequence', () => assert.equal(result, '>peptide\nGA'));
});

// ---------------------------------------------------------------------------
// toThreeLetter
// ---------------------------------------------------------------------------

describe('toThreeLetter', () => {
  it('converts one-letter to three-letter', () => assert.equal(toThreeLetter('AG'), 'Ala-Gly'));
  it('handles single residue', () => assert.equal(toThreeLetter('C'), 'Cys'));
  it('lowercased input works', () => assert.equal(toThreeLetter('ag'), 'Ala-Gly'));
  it('throws on unknown code', () => assert.throws(() => toThreeLetter('AXG'), /Unknown amino acid one-letter code: X/));
  it('round-trips through three-letter format', () => assert.equal(toThreeLetter('ACDEF'), 'Ala-Cys-Asp-Glu-Phe'));
});

// ---------------------------------------------------------------------------
// detectSequenceType
// ---------------------------------------------------------------------------

describe('detectSequenceType', () => {
  it('detects DNA (contains T)', () => assert.equal(detectSequenceType('ATGC'), 'dna'));
  it('detects RNA (contains U)', () => assert.equal(detectSequenceType('AUGC'), 'rna'));
  it('detects protein (non-nucleotide letters)', () => assert.equal(detectSequenceType('MVLS'), 'protein'));
  it('returns ambiguous for A/C/G/N only', () => assert.equal(detectSequenceType('ACGN'), 'ambiguous'));
  it('lowercased input works', () => assert.equal(detectSequenceType('atgc'), 'dna'));
  it('single T is dna', () => assert.equal(detectSequenceType('T'), 'dna'));
  it('single U is rna', () => assert.equal(detectSequenceType('U'), 'rna'));
});

// ---------------------------------------------------------------------------
// sequenceToNucleicAcid — input validation
// ---------------------------------------------------------------------------

describe('sequenceToNucleicAcid — input validation', () => {
  it('throws on empty sequence', () => assert.throws(() => sequenceToOligonucleotide(''), /at least one nucleotide/));
  it('throws on unknown code', () => assert.throws(() => sequenceToOligonucleotide('ATR'), /Unknown nucleotide code: R/));
  it('throws when sequence is protein', () => assert.throws(() => sequenceToOligonucleotide('MVLS'), /appears to be a protein/));
});

// ---------------------------------------------------------------------------
// sequenceToNucleicAcid — single nucleoside
// ---------------------------------------------------------------------------

describe('sequenceToNucleicAcid — single nucleoside A (deoxyadenosine)', () => {
  const mol = sequenceToOligonucleotide('A');
  // Deoxyadenosine: C10H13N5O3
  it('contains nitrogen', () => assert.equal(countElement(mol, 'N') >= 1, true));
  it('contains oxygen', () => assert.equal(countElement(mol, 'O') >= 1, true));
  it('name is set', () => assert.equal(mol.name, 'A'));
});

describe('sequenceToNucleicAcid — single nucleoside U (uridine, RNA)', () => {
  const mol = sequenceToOligonucleotide('U');
  it('name is U', () => assert.equal(mol.name, 'U'));
  it('contains nitrogen', () => assert.equal(countElement(mol, 'N') >= 1, true));
});

// ---------------------------------------------------------------------------
// sequenceToNucleicAcid — dinucleotide
// ---------------------------------------------------------------------------

describe('sequenceToNucleicAcid — DNA dinucleotide AT', () => {
  const mol = sequenceToOligonucleotide('AT');
  // dA + phosphate + dT
  it('name is set to sequence', () => assert.equal(mol.name, 'AT'));
  it('contains phosphorus from phosphodiester bond', () => assert.equal(countElement(mol, 'P'), 1));
  it('has more than one nitrogen', () => assert.equal(countElement(mol, 'N') > 1, true));
});

describe('sequenceToNucleicAcid — RNA dinucleotide AU (forced type)', () => {
  const mol = sequenceToOligonucleotide('AC', { type: 'rna' });
  it('name is set to sequence', () => assert.equal(mol.name, 'AC'));
  it('contains phosphorus', () => assert.equal(countElement(mol, 'P'), 1));
});

// ---------------------------------------------------------------------------
// sequenceToNucleicAcid — type forcing
// ---------------------------------------------------------------------------

describe('sequenceToNucleicAcid — force dna type on ambiguous sequence', () => {
  const dna = sequenceToOligonucleotide('AC', { type: 'dna' });
  const rna = sequenceToOligonucleotide('AC', { type: 'rna' });
  it("DNA and RNA AC have different atom counts (2'-OH difference)", () => {
    assert.notEqual(countElement(dna, 'O'), countElement(rna, 'O'));
  });
});
