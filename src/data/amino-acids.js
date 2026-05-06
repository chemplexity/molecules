/** @module data/amino-acids */

/**
 * Standard amino acid reference data keyed by one-letter code.
 *
 * Each entry contains:
 * - `one`               : IUPAC one-letter code (same as the key; included for
 *                         self-contained lookup after destructuring)
 * - `three`             : Three-letter abbreviation (e.g. `'Ala'`)
 * - `name`              : Full IUPAC name
 * - `smiles`            : Isomeric SMILES for the free (zwitterion-neutral) amino acid
 * - `monoisotopicMass`  : Exact mass computed from the most abundant isotope of
 *                         each element (Da), per NIST values
 * - `averageMass`       : Standard atomic weight-based average molecular mass (Da)
 *
 * The 20 canonical amino acids plus selenocysteine (U) and pyrrolysine (O) are
 * included. Ambiguity codes (B, Z, X, J) are intentionally omitted as they do
 * not correspond to a single structure.
 * @type {Record<string, {one: string, three: string, name: string, smiles: string, monoisotopicMass: number, averageMass: number}>}
 */
const aminoAcids = {
  // ---------------------------------------------------------------------------
  // Aliphatic non-polar
  // ---------------------------------------------------------------------------
  G: { one: 'G', three: 'Gly', name: 'Glycine', smiles: 'NCC(=O)O', monoisotopicMass: 75.032, averageMass: 75.0666 },
  A: { one: 'A', three: 'Ala', name: 'Alanine', smiles: 'N[C@@H](C)C(=O)O', monoisotopicMass: 89.0477, averageMass: 89.0935 },
  V: { one: 'V', three: 'Val', name: 'Valine', smiles: 'N[C@@H](C(C)C)C(=O)O', monoisotopicMass: 117.079, averageMass: 117.1469 },
  L: { one: 'L', three: 'Leu', name: 'Leucine', smiles: 'N[C@@H](CC(C)C)C(=O)O', monoisotopicMass: 131.0946, averageMass: 131.1736 },
  I: { one: 'I', three: 'Ile', name: 'Isoleucine', smiles: 'N[C@@H]([C@@H](C)CC)C(=O)O', monoisotopicMass: 131.0946, averageMass: 131.1736 },
  P: { one: 'P', three: 'Pro', name: 'Proline', smiles: 'OC(=O)[C@@H]1CCCN1', monoisotopicMass: 115.0633, averageMass: 115.131 },
  // ---------------------------------------------------------------------------
  // Aromatic
  // ---------------------------------------------------------------------------
  F: { one: 'F', three: 'Phe', name: 'Phenylalanine', smiles: 'N[C@@H](Cc1ccccc1)C(=O)O', monoisotopicMass: 165.079, averageMass: 165.19 },
  W: { one: 'W', three: 'Trp', name: 'Tryptophan', smiles: 'N[C@@H](Cc1c[nH]c2ccccc12)C(=O)O', monoisotopicMass: 204.0899, averageMass: 204.2262 },
  Y: { one: 'Y', three: 'Tyr', name: 'Tyrosine', smiles: 'N[C@@H](Cc1ccc(O)cc1)C(=O)O', monoisotopicMass: 181.0739, averageMass: 181.1894 },
  // ---------------------------------------------------------------------------
  // Polar uncharged
  // ---------------------------------------------------------------------------
  S: { one: 'S', three: 'Ser', name: 'Serine', smiles: 'N[C@@H](CO)C(=O)O', monoisotopicMass: 105.0426, averageMass: 105.093 },
  T: { one: 'T', three: 'Thr', name: 'Threonine', smiles: 'N[C@@H]([C@H](O)C)C(=O)O', monoisotopicMass: 119.0582, averageMass: 119.1197 },
  C: { one: 'C', three: 'Cys', name: 'Cysteine', smiles: 'N[C@@H](CS)C(=O)O', monoisotopicMass: 121.0197, averageMass: 121.159 },
  M: { one: 'M', three: 'Met', name: 'Methionine', smiles: 'N[C@@H](CCSC)C(=O)O', monoisotopicMass: 149.051, averageMass: 149.2124 },
  N: { one: 'N', three: 'Asn', name: 'Asparagine', smiles: 'N[C@@H](CC(=O)N)C(=O)O', monoisotopicMass: 132.0535, averageMass: 132.1184 },
  Q: { one: 'Q', three: 'Gln', name: 'Glutamine', smiles: 'N[C@@H](CCC(=O)N)C(=O)O', monoisotopicMass: 146.0691, averageMass: 146.1451 },
  // ---------------------------------------------------------------------------
  // Positively charged
  // ---------------------------------------------------------------------------
  K: { one: 'K', three: 'Lys', name: 'Lysine', smiles: 'N[C@@H](CCCCN)C(=O)O', monoisotopicMass: 146.1055, averageMass: 146.1882 },
  R: { one: 'R', three: 'Arg', name: 'Arginine', smiles: 'N[C@@H](CCCNC(=N)N)C(=O)O', monoisotopicMass: 174.1117, averageMass: 174.2017 },
  H: { one: 'H', three: 'His', name: 'Histidine', smiles: 'N[C@@H](Cc1cnc[nH]1)C(=O)O', monoisotopicMass: 155.0695, averageMass: 155.1552 },
  // ---------------------------------------------------------------------------
  // Negatively charged
  // ---------------------------------------------------------------------------
  D: { one: 'D', three: 'Asp', name: 'Aspartic Acid', smiles: 'N[C@@H](CC(=O)O)C(=O)O', monoisotopicMass: 133.0375, averageMass: 133.1032 },
  E: { one: 'E', three: 'Glu', name: 'Glutamic Acid', smiles: 'N[C@@H](CCC(=O)O)C(=O)O', monoisotopicMass: 147.0532, averageMass: 147.1299 },
  // ---------------------------------------------------------------------------
  // Special
  // ---------------------------------------------------------------------------
  U: { one: 'U', three: 'Sec', name: 'Selenocysteine', smiles: 'N[C@@H](C[SeH])C(=O)O', monoisotopicMass: 168.9642, averageMass: 168.053 },
  O: { one: 'O', three: 'Pyl', name: 'Pyrrolysine', smiles: 'N[C@@H](CCCCNC(=O)[C@@H]1C[C@H](C)C=N1)C(=O)O', monoisotopicMass: 255.1583, averageMass: 255.3134 }
};

export default aminoAcids;
