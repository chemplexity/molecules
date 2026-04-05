/** @module data/elements */

/**
 * Periodic table element data.
 *
 * Each entry maps an element symbol to its atomic properties:
 * - `protons`   : atomic number
 * - `neutrons`  : average neutron count (standard atomic weight − protons);
 *                 for radioactive elements with no stable isotopes the mass
 *                 number of the longest-lived isotope is used instead.
 * - `electrons` : number of electrons (equals protons for neutral atom)
 * - `group`     : periodic table column (1–18); La, Lu, Ac, Lr are d-block
 *                 (group 3); inner f-block elements (Ce–Yb, Th–No) use group 0.
 * - `period`    : periodic table row (1–7)
 * - `electronegativity` : Pauling electronegativity (2 decimal places); `null` for
 *                 noble gases and elements with no reliable Pauling value
 *                 (most f-block and all superheavy elements).
 *
 * @type {Object.<string, {protons: number, neutrons: number, electrons: number, group: number, period: number, electronegativity: number|null}>}
 */
const elements = {
  // Period 1
  H: { protons: 1, neutrons: 0.0079, electrons: 1, group: 1, period: 1, electronegativity: 2.2 },
  D: { protons: 1, neutrons: 1.0, electrons: 1, group: 1, period: 1, electronegativity: 2.2 },
  He: { protons: 2, neutrons: 2.0026, electrons: 2, group: 18, period: 1, electronegativity: null },
  // Period 2
  Li: { protons: 3, neutrons: 3.941, electrons: 3, group: 1, period: 2, electronegativity: 0.98 },
  Be: { protons: 4, neutrons: 5.0122, electrons: 4, group: 2, period: 2, electronegativity: 1.57 },
  B: { protons: 5, neutrons: 5.811, electrons: 5, group: 13, period: 2, electronegativity: 2.04 },
  C: { protons: 6, neutrons: 6.0107, electrons: 6, group: 14, period: 2, electronegativity: 2.55 },
  N: { protons: 7, neutrons: 7.0067, electrons: 7, group: 15, period: 2, electronegativity: 3.04 },
  O: { protons: 8, neutrons: 7.9994, electrons: 8, group: 16, period: 2, electronegativity: 3.44 },
  F: { protons: 9, neutrons: 9.9984, electrons: 9, group: 17, period: 2, electronegativity: 3.98 },
  Ne: { protons: 10, neutrons: 10.1797, electrons: 10, group: 18, period: 2, electronegativity: null },
  // Period 3
  Na: { protons: 11, neutrons: 11.9897, electrons: 11, group: 1, period: 3, electronegativity: 0.93 },
  Mg: { protons: 12, neutrons: 12.305, electrons: 12, group: 2, period: 3, electronegativity: 1.31 },
  Al: { protons: 13, neutrons: 13.9815, electrons: 13, group: 13, period: 3, electronegativity: 1.61 },
  Si: { protons: 14, neutrons: 14.0855, electrons: 14, group: 14, period: 3, electronegativity: 1.9 },
  P: { protons: 15, neutrons: 15.9738, electrons: 15, group: 15, period: 3, electronegativity: 2.19 },
  S: { protons: 16, neutrons: 16.065, electrons: 16, group: 16, period: 3, electronegativity: 2.58 },
  Cl: { protons: 17, neutrons: 18.45, electrons: 17, group: 17, period: 3, electronegativity: 3.16 },
  Ar: { protons: 18, neutrons: 21.948, electrons: 18, group: 18, period: 3, electronegativity: null },
  // Period 4
  K: { protons: 19, neutrons: 20.0983, electrons: 19, group: 1, period: 4, electronegativity: 0.82 },
  Ca: { protons: 20, neutrons: 20.078, electrons: 20, group: 2, period: 4, electronegativity: 1.0 },
  Sc: { protons: 21, neutrons: 23.9559, electrons: 21, group: 3, period: 4, electronegativity: 1.36 },
  Ti: { protons: 22, neutrons: 25.867, electrons: 22, group: 4, period: 4, electronegativity: 1.54 },
  V: { protons: 23, neutrons: 27.9415, electrons: 23, group: 5, period: 4, electronegativity: 1.63 },
  Cr: { protons: 24, neutrons: 27.9961, electrons: 24, group: 6, period: 4, electronegativity: 1.66 },
  Mn: { protons: 25, neutrons: 29.938, electrons: 25, group: 7, period: 4, electronegativity: 1.55 },
  Fe: { protons: 26, neutrons: 29.845, electrons: 26, group: 8, period: 4, electronegativity: 1.83 },
  Co: { protons: 27, neutrons: 31.9332, electrons: 27, group: 9, period: 4, electronegativity: 1.88 },
  Ni: { protons: 28, neutrons: 30.6934, electrons: 28, group: 10, period: 4, electronegativity: 1.91 },
  Cu: { protons: 29, neutrons: 34.546, electrons: 29, group: 11, period: 4, electronegativity: 1.9 },
  Zn: { protons: 30, neutrons: 35.39, electrons: 30, group: 12, period: 4, electronegativity: 1.65 },
  Ga: { protons: 31, neutrons: 38.723, electrons: 31, group: 13, period: 4, electronegativity: 1.81 },
  Ge: { protons: 32, neutrons: 40.61, electrons: 32, group: 14, period: 4, electronegativity: 2.01 },
  As: { protons: 33, neutrons: 41.9216, electrons: 33, group: 15, period: 4, electronegativity: 2.18 },
  Se: { protons: 34, neutrons: 44.96, electrons: 34, group: 16, period: 4, electronegativity: 2.55 },
  Br: { protons: 35, neutrons: 44.904, electrons: 35, group: 17, period: 4, electronegativity: 2.96 },
  Kr: { protons: 36, neutrons: 47.8, electrons: 36, group: 18, period: 4, electronegativity: null },
  // Period 5
  Rb: { protons: 37, neutrons: 48.4678, electrons: 37, group: 1, period: 5, electronegativity: 0.82 },
  Sr: { protons: 38, neutrons: 49.621, electrons: 38, group: 2, period: 5, electronegativity: 0.95 },
  Y: { protons: 39, neutrons: 49.9058, electrons: 39, group: 3, period: 5, electronegativity: 1.22 },
  Zr: { protons: 40, neutrons: 52.2242, electrons: 40, group: 4, period: 5, electronegativity: 1.33 },
  Nb: { protons: 41, neutrons: 51.9064, electrons: 41, group: 5, period: 5, electronegativity: 1.6 },
  Mo: { protons: 42, neutrons: 53.951, electrons: 42, group: 6, period: 5, electronegativity: 2.16 },
  Tc: { protons: 43, neutrons: 55.0, electrons: 43, group: 7, period: 5, electronegativity: 1.9 },
  Ru: { protons: 44, neutrons: 57.072, electrons: 44, group: 8, period: 5, electronegativity: 2.2 },
  Rh: { protons: 45, neutrons: 57.9055, electrons: 45, group: 9, period: 5, electronegativity: 2.28 },
  Pd: { protons: 46, neutrons: 60.421, electrons: 46, group: 10, period: 5, electronegativity: 2.2 },
  Ag: { protons: 47, neutrons: 60.8682, electrons: 47, group: 11, period: 5, electronegativity: 1.93 },
  Cd: { protons: 48, neutrons: 64.4144, electrons: 48, group: 12, period: 5, electronegativity: 1.69 },
  In: { protons: 49, neutrons: 65.8181, electrons: 49, group: 13, period: 5, electronegativity: 1.78 },
  Sn: { protons: 50, neutrons: 68.7107, electrons: 50, group: 14, period: 5, electronegativity: 1.96 },
  Sb: { protons: 51, neutrons: 70.7601, electrons: 51, group: 15, period: 5, electronegativity: 2.05 },
  Te: { protons: 52, neutrons: 75.603, electrons: 52, group: 16, period: 5, electronegativity: 2.1 },
  I: { protons: 53, neutrons: 73.9045, electrons: 53, group: 17, period: 5, electronegativity: 2.66 },
  Xe: { protons: 54, neutrons: 77.2936, electrons: 54, group: 18, period: 5, electronegativity: null },
  // Period 6
  Cs: { protons: 55, neutrons: 77.905, electrons: 55, group: 1, period: 6, electronegativity: 0.79 },
  Ba: { protons: 56, neutrons: 81.327, electrons: 56, group: 2, period: 6, electronegativity: 0.89 },
  // Lanthanides: La and Lu are d-block (group 3); Ce–Yb are f-block (group 0)
  La: { protons: 57, neutrons: 81.905, electrons: 57, group: 3, period: 6, electronegativity: 1.1 },
  Ce: { protons: 58, neutrons: 82.116, electrons: 58, group: 0, period: 6, electronegativity: null },
  Pr: { protons: 59, neutrons: 81.908, electrons: 59, group: 0, period: 6, electronegativity: null },
  Nd: { protons: 60, neutrons: 84.242, electrons: 60, group: 0, period: 6, electronegativity: null },
  Pm: { protons: 61, neutrons: 84.0, electrons: 61, group: 0, period: 6, electronegativity: null },
  Sm: { protons: 62, neutrons: 88.36, electrons: 62, group: 0, period: 6, electronegativity: null },
  Eu: { protons: 63, neutrons: 88.964, electrons: 63, group: 0, period: 6, electronegativity: null },
  Gd: { protons: 64, neutrons: 93.25, electrons: 64, group: 0, period: 6, electronegativity: null },
  Tb: { protons: 65, neutrons: 93.925, electrons: 65, group: 0, period: 6, electronegativity: null },
  Dy: { protons: 66, neutrons: 96.5, electrons: 66, group: 0, period: 6, electronegativity: null },
  Ho: { protons: 67, neutrons: 97.93, electrons: 67, group: 0, period: 6, electronegativity: null },
  Er: { protons: 68, neutrons: 99.259, electrons: 68, group: 0, period: 6, electronegativity: null },
  Tm: { protons: 69, neutrons: 99.934, electrons: 69, group: 0, period: 6, electronegativity: null },
  Yb: { protons: 70, neutrons: 103.045, electrons: 70, group: 0, period: 6, electronegativity: null },
  Lu: { protons: 71, neutrons: 103.967, electrons: 71, group: 3, period: 6, electronegativity: 1.27 },
  // Period 6 transition metals and main-group
  Hf: { protons: 72, neutrons: 106.49, electrons: 72, group: 4, period: 6, electronegativity: 1.3 },
  Ta: { protons: 73, neutrons: 107.948, electrons: 73, group: 5, period: 6, electronegativity: 1.5 },
  W: { protons: 74, neutrons: 109.84, electrons: 74, group: 6, period: 6, electronegativity: 2.36 },
  Re: { protons: 75, neutrons: 111.207, electrons: 75, group: 7, period: 6, electronegativity: 1.9 },
  Os: { protons: 76, neutrons: 114.23, electrons: 76, group: 8, period: 6, electronegativity: 2.2 },
  Ir: { protons: 77, neutrons: 115.217, electrons: 77, group: 9, period: 6, electronegativity: 2.2 },
  Pt: { protons: 78, neutrons: 117.084, electrons: 78, group: 10, period: 6, electronegativity: 2.28 },
  Au: { protons: 79, neutrons: 117.967, electrons: 79, group: 11, period: 6, electronegativity: 2.54 },
  Hg: { protons: 80, neutrons: 120.592, electrons: 80, group: 12, period: 6, electronegativity: 2.0 },
  Tl: { protons: 81, neutrons: 123.38, electrons: 81, group: 13, period: 6, electronegativity: 1.62 },
  Pb: { protons: 82, neutrons: 125.2, electrons: 82, group: 14, period: 6, electronegativity: 2.33 },
  Bi: { protons: 83, neutrons: 125.98, electrons: 83, group: 15, period: 6, electronegativity: 2.02 },
  Po: { protons: 84, neutrons: 125.0, electrons: 84, group: 16, period: 6, electronegativity: 2.0 },
  At: { protons: 85, neutrons: 125.0, electrons: 85, group: 17, period: 6, electronegativity: 2.2 },
  Rn: { protons: 86, neutrons: 136.0, electrons: 86, group: 18, period: 6, electronegativity: null },
  // Period 7
  Fr: { protons: 87, neutrons: 136.0, electrons: 87, group: 1, period: 7, electronegativity: 0.7 },
  Ra: { protons: 88, neutrons: 138.0, electrons: 88, group: 2, period: 7, electronegativity: 0.9 },
  // Actinides: Ac and Lr are d-block (group 3); Th–No are f-block (group 0)
  Ac: { protons: 89, neutrons: 138.0, electrons: 89, group: 3, period: 7, electronegativity: 1.1 },
  Th: { protons: 90, neutrons: 142.038, electrons: 90, group: 0, period: 7, electronegativity: 1.3 },
  Pa: { protons: 91, neutrons: 140.036, electrons: 91, group: 0, period: 7, electronegativity: 1.5 },
  U: { protons: 92, neutrons: 146.029, electrons: 92, group: 0, period: 7, electronegativity: 1.38 },
  Np: { protons: 93, neutrons: 144.0, electrons: 93, group: 0, period: 7, electronegativity: 1.36 },
  Pu: { protons: 94, neutrons: 150.0, electrons: 94, group: 0, period: 7, electronegativity: null },
  Am: { protons: 95, neutrons: 148.0, electrons: 95, group: 0, period: 7, electronegativity: null },
  Cm: { protons: 96, neutrons: 151.0, electrons: 96, group: 0, period: 7, electronegativity: null },
  Bk: { protons: 97, neutrons: 150.0, electrons: 97, group: 0, period: 7, electronegativity: null },
  Cf: { protons: 98, neutrons: 153.0, electrons: 98, group: 0, period: 7, electronegativity: null },
  Es: { protons: 99, neutrons: 153.0, electrons: 99, group: 0, period: 7, electronegativity: null },
  Fm: { protons: 100, neutrons: 157.0, electrons: 100, group: 0, period: 7, electronegativity: null },
  Md: { protons: 101, neutrons: 157.0, electrons: 101, group: 0, period: 7, electronegativity: null },
  No: { protons: 102, neutrons: 157.0, electrons: 102, group: 0, period: 7, electronegativity: null },
  Lr: { protons: 103, neutrons: 163.0, electrons: 103, group: 3, period: 7, electronegativity: null },
  // Period 7 transition metals (transactinides)
  Rf: { protons: 104, neutrons: 163.0, electrons: 104, group: 4, period: 7, electronegativity: null },
  Db: { protons: 105, neutrons: 163.0, electrons: 105, group: 5, period: 7, electronegativity: null },
  Sg: { protons: 106, neutrons: 165.0, electrons: 106, group: 6, period: 7, electronegativity: null },
  Bh: { protons: 107, neutrons: 163.0, electrons: 107, group: 7, period: 7, electronegativity: null },
  Hs: { protons: 108, neutrons: 169.0, electrons: 108, group: 8, period: 7, electronegativity: null },
  Mt: { protons: 109, neutrons: 169.0, electrons: 109, group: 9, period: 7, electronegativity: null },
  Ds: { protons: 110, neutrons: 171.0, electrons: 110, group: 10, period: 7, electronegativity: null },
  Rg: { protons: 111, neutrons: 171.0, electrons: 111, group: 11, period: 7, electronegativity: null },
  Cn: { protons: 112, neutrons: 173.0, electrons: 112, group: 12, period: 7, electronegativity: null },
  Nh: { protons: 113, neutrons: 173.0, electrons: 113, group: 13, period: 7, electronegativity: null },
  Fl: { protons: 114, neutrons: 175.0, electrons: 114, group: 14, period: 7, electronegativity: null },
  Mc: { protons: 115, neutrons: 175.0, electrons: 115, group: 15, period: 7, electronegativity: null },
  Lv: { protons: 116, neutrons: 177.0, electrons: 116, group: 16, period: 7, electronegativity: null },
  Ts: { protons: 117, neutrons: 177.0, electrons: 117, group: 17, period: 7, electronegativity: null },
  Og: { protons: 118, neutrons: 176.0, electrons: 118, group: 18, period: 7, electronegativity: null }
};

export default elements;
