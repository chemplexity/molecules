/** @module data/nucleotides */

/**
 * Standard nucleotide reference data keyed by one-letter IUPAC code.
 *
 * Each entry contains:
 * - `one`              : One-letter IUPAC code (same as the key; included for
 *                        self-contained lookup after destructuring)
 * - `name`             : Full nucleoside name
 * - `base`             : Nucleobase name
 * - `type`             : `'dna'` — DNA only (thymine); `'rna'` — RNA only (uracil);
 *                        `'both'` — present in both DNA and RNA (adenine, guanine, cytosine)
 * - `smiles`           : Isomeric SMILES for the free nucleoside (base + sugar, no phosphate).
 *                        DNA nucleosides use 2'-deoxyribose; RNA nucleosides use ribose.
 * - `monoisotopicMass` : Exact mass of the free nucleoside (Da), computed from the most
 *                        abundant isotope of each element, per NIST values
 * - `averageMass`      : Standard atomic weight-based average molecular mass (Da)
 *
 * The four DNA nucleosides (A, T, G, C), four RNA nucleosides (A, U, G, C),
 * and the IUPAC ambiguity codes are included. Because A, G, and C appear in
 * both DNA and RNA with different sugars, separate `dna` and `rna` sub-tables
 * are provided for unambiguous lookup. The top-level export provides the DNA
 * form for A/G/C by default (most common use case).
 *
 * Ambiguity codes (R, Y, S, W, K, M, B, D, H, V, N) are intentionally omitted
 * here as they do not correspond to a single structure.
 * @type {Record<string, {one: string, name: string, base: string, type: 'dna'|'rna'|'both', smiles: string, monoisotopicMass: number, averageMass: number}>}
 */
const nucleotides = {
  // ---------------------------------------------------------------------------
  // DNA nucleosides (2'-deoxyribose — no 2'-OH)
  // ---------------------------------------------------------------------------
  A: { one: 'A', name: 'Deoxyadenosine', base: 'Adenine', type: 'both', smiles: 'OC[C@H]1O[C@@H](n2cnc3c(N)ncnc23)C[C@@H]1O', monoisotopicMass: 251.1018, averageMass: 251.246 },
  T: { one: 'T', name: 'Thymidine', base: 'Thymine', type: 'dna', smiles: 'OC[C@H]1O[C@@H](n2cc(C)c(=O)[nH]c2=O)C[C@@H]1O', monoisotopicMass: 242.0903, averageMass: 242.229 },
  G: { one: 'G', name: 'Deoxyguanosine', base: 'Guanine', type: 'both', smiles: 'OC[C@H]1O[C@@H](n2cnc3c2nc(N)[nH]c3=O)C[C@@H]1O', monoisotopicMass: 267.0968, averageMass: 267.245 },
  C: { one: 'C', name: 'Deoxycytidine', base: 'Cytosine', type: 'both', smiles: 'OC[C@H]1O[C@@H](n2ccc(N)nc2=O)C[C@@H]1O', monoisotopicMass: 227.0906, averageMass: 227.219 },
  // ---------------------------------------------------------------------------
  // RNA-only nucleoside (ribose — has 2'-OH)
  // ---------------------------------------------------------------------------
  U: { one: 'U', name: 'Uridine', base: 'Uracil', type: 'rna', smiles: 'OC[C@H]1O[C@@H](n2ccc(=O)[nH]c2=O)[C@H](O)[C@H]1O', monoisotopicMass: 244.0695, averageMass: 244.201 }
};

/**
 * RNA-specific nucleoside table (ribose sugar — has 2'-OH).
 *
 * Contains A, U, G, C with ribose SMILES. Use this table when building RNA
 * molecules to get the correct 2'-OH on the sugar.
 * @type {Record<string, {one: string, name: string, base: string, type: 'rna', smiles: string, monoisotopicMass: number, averageMass: number}>}
 */
export const rnaNucleotides = {
  A: { one: 'A', name: 'Adenosine', base: 'Adenine', type: 'rna', smiles: 'OC[C@H]1O[C@@H](n2cnc3c(N)ncnc23)[C@H](O)[C@H]1O', monoisotopicMass: 267.0968, averageMass: 267.244 },
  U: { one: 'U', name: 'Uridine', base: 'Uracil', type: 'rna', smiles: 'OC[C@H]1O[C@@H](n2ccc(=O)[nH]c2=O)[C@H](O)[C@H]1O', monoisotopicMass: 244.0695, averageMass: 244.201 },
  G: { one: 'G', name: 'Guanosine', base: 'Guanine', type: 'rna', smiles: 'OC[C@H]1O[C@@H](n2cnc3c2nc(N)[nH]c3=O)[C@H](O)[C@H]1O', monoisotopicMass: 283.0917, averageMass: 283.244 },
  C: { one: 'C', name: 'Cytidine', base: 'Cytosine', type: 'rna', smiles: 'OC[C@H]1O[C@@H](n2ccc(N)nc2=O)[C@H](O)[C@H]1O', monoisotopicMass: 243.0855, averageMass: 243.218 }
};

export default nucleotides;
