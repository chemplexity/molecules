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
 *
 * @type {Object.<string, {protons: number, neutrons: number, electrons: number, group: number, period: number}>}
 */
const elements = {
  // Period 1
  H: { protons: 1, neutrons: 0.0079, electrons: 1, group: 1, period: 1 },
  D: { protons: 1, neutrons: 1.0000, electrons: 1, group: 1, period: 1 },
  He: { protons: 2, neutrons: 2.0026, electrons: 2, group: 18, period: 1 },
  // Period 2
  Li: { protons: 3, neutrons: 3.9410, electrons: 3, group: 1, period: 2 },
  Be: { protons: 4, neutrons: 5.0122, electrons: 4, group: 2, period: 2 },
  B: { protons: 5, neutrons: 5.8110, electrons: 5, group: 13, period: 2 },
  C: { protons: 6, neutrons: 6.0107, electrons: 6, group: 14, period: 2 },
  N: { protons: 7, neutrons: 7.0067, electrons: 7, group: 15, period: 2 },
  O: { protons: 8, neutrons: 7.9994, electrons: 8, group: 16, period: 2 },
  F: { protons: 9, neutrons: 9.9984, electrons: 9, group: 17, period: 2 },
  Ne: { protons: 10, neutrons: 10.1797, electrons: 10, group: 18, period: 2 },
  // Period 3
  Na: { protons: 11, neutrons: 11.9897, electrons: 11, group: 1, period: 3 },
  Mg: { protons: 12, neutrons: 12.3050, electrons: 12, group: 2, period: 3 },
  Al: { protons: 13, neutrons: 13.9815, electrons: 13, group: 13, period: 3 },
  Si: { protons: 14, neutrons: 14.0855, electrons: 14, group: 14, period: 3 },
  P: { protons: 15, neutrons: 15.9738, electrons: 15, group: 15, period: 3 },
  S: { protons: 16, neutrons: 16.0650, electrons: 16, group: 16, period: 3 },
  Cl: { protons: 17, neutrons: 18.4500, electrons: 17, group: 17, period: 3 },
  Ar: { protons: 18, neutrons: 21.9480, electrons: 18, group: 18, period: 3 },
  // Period 4
  K: { protons: 19, neutrons: 20.0983, electrons: 19, group: 1, period: 4 },
  Ca: { protons: 20, neutrons: 20.0780, electrons: 20, group: 2, period: 4 },
  Sc: { protons: 21, neutrons: 23.9559, electrons: 21, group: 3, period: 4 },
  Ti: { protons: 22, neutrons: 25.8670, electrons: 22, group: 4, period: 4 },
  V: { protons: 23, neutrons: 27.9415, electrons: 23, group: 5, period: 4 },
  Cr: { protons: 24, neutrons: 27.9961, electrons: 24, group: 6, period: 4 },
  Mn: { protons: 25, neutrons: 29.9380, electrons: 25, group: 7, period: 4 },
  Fe: { protons: 26, neutrons: 29.8450, electrons: 26, group: 8, period: 4 },
  Co: { protons: 27, neutrons: 31.9332, electrons: 27, group: 9, period: 4 },
  Ni: { protons: 28, neutrons: 30.6934, electrons: 28, group: 10, period: 4 },
  Cu: { protons: 29, neutrons: 34.5460, electrons: 29, group: 11, period: 4 },
  Zn: { protons: 30, neutrons: 35.3900, electrons: 30, group: 12, period: 4 },
  Ga: { protons: 31, neutrons: 38.7230, electrons: 31, group: 13, period: 4 },
  Ge: { protons: 32, neutrons: 40.6100, electrons: 32, group: 14, period: 4 },
  As: { protons: 33, neutrons: 41.9216, electrons: 33, group: 15, period: 4 },
  Se: { protons: 34, neutrons: 44.9600, electrons: 34, group: 16, period: 4 },
  Br: { protons: 35, neutrons: 44.9040, electrons: 35, group: 17, period: 4 },
  Kr: { protons: 36, neutrons: 47.8000, electrons: 36, group: 18, period: 4 },
  // Period 5
  Rb: { protons: 37, neutrons: 48.4678, electrons: 37, group: 1, period: 5 },
  Sr: { protons: 38, neutrons: 49.6210, electrons: 38, group: 2, period: 5 },
  Y: { protons: 39, neutrons: 49.9058, electrons: 39, group: 3, period: 5 },
  Zr: { protons: 40, neutrons: 52.2242, electrons: 40, group: 4, period: 5 },
  Nb: { protons: 41, neutrons: 51.9064, electrons: 41, group: 5, period: 5 },
  Mo: { protons: 42, neutrons: 53.9510, electrons: 42, group: 6, period: 5 },
  Tc: { protons: 43, neutrons: 55.0000, electrons: 43, group: 7, period: 5 },
  Ru: { protons: 44, neutrons: 57.0720, electrons: 44, group: 8, period: 5 },
  Rh: { protons: 45, neutrons: 57.9055, electrons: 45, group: 9, period: 5 },
  Pd: { protons: 46, neutrons: 60.4210, electrons: 46, group: 10, period: 5 },
  Ag: { protons: 47, neutrons: 60.8682, electrons: 47, group: 11, period: 5 },
  Cd: { protons: 48, neutrons: 64.4144, electrons: 48, group: 12, period: 5 },
  In: { protons: 49, neutrons: 65.8181, electrons: 49, group: 13, period: 5 },
  Sn: { protons: 50, neutrons: 68.7107, electrons: 50, group: 14, period: 5 },
  Sb: { protons: 51, neutrons: 70.7601, electrons: 51, group: 15, period: 5 },
  Te: { protons: 52, neutrons: 75.6030, electrons: 52, group: 16, period: 5 },
  I: { protons: 53, neutrons: 73.9045, electrons: 53, group: 17, period: 5 },
  Xe: { protons: 54, neutrons: 77.2936, electrons: 54, group: 18, period: 5 },
  // Period 6
  Cs: { protons: 55, neutrons: 77.9050, electrons: 55, group: 1, period: 6 },
  Ba: { protons: 56, neutrons: 81.3270, electrons: 56, group: 2, period: 6 },
  // Lanthanides: La and Lu are d-block (group 3); Ce–Yb are f-block (group 0)
  La: { protons: 57, neutrons: 81.9050, electrons: 57, group: 3, period: 6 },
  Ce: { protons: 58, neutrons: 82.1160, electrons: 58, group: 0, period: 6 },
  Pr: { protons: 59, neutrons: 81.9080, electrons: 59, group: 0, period: 6 },
  Nd: { protons: 60, neutrons: 84.2420, electrons: 60, group: 0, period: 6 },
  Pm: { protons: 61, neutrons: 84.0000, electrons: 61, group: 0, period: 6 },
  Sm: { protons: 62, neutrons: 88.3600, electrons: 62, group: 0, period: 6 },
  Eu: { protons: 63, neutrons: 88.9640, electrons: 63, group: 0, period: 6 },
  Gd: { protons: 64, neutrons: 93.2500, electrons: 64, group: 0, period: 6 },
  Tb: { protons: 65, neutrons: 93.9250, electrons: 65, group: 0, period: 6 },
  Dy: { protons: 66, neutrons: 96.5000, electrons: 66, group: 0, period: 6 },
  Ho: { protons: 67, neutrons: 97.9300, electrons: 67, group: 0, period: 6 },
  Er: { protons: 68, neutrons: 99.2590, electrons: 68, group: 0, period: 6 },
  Tm: { protons: 69, neutrons: 99.9340, electrons: 69, group: 0, period: 6 },
  Yb: { protons: 70, neutrons: 103.0450, electrons: 70, group: 0, period: 6 },
  Lu: { protons: 71, neutrons: 103.9670, electrons: 71, group: 3, period: 6 },
  // Period 6 transition metals and main-group
  Hf: { protons: 72, neutrons: 106.4900, electrons: 72, group: 4, period: 6 },
  Ta: { protons: 73, neutrons: 107.9480, electrons: 73, group: 5, period: 6 },
  W: { protons: 74, neutrons: 109.8400, electrons: 74, group: 6, period: 6 },
  Re: { protons: 75, neutrons: 111.2070, electrons: 75, group: 7, period: 6 },
  Os: { protons: 76, neutrons: 114.2300, electrons: 76, group: 8, period: 6 },
  Ir: { protons: 77, neutrons: 115.2170, electrons: 77, group: 9, period: 6 },
  Pt: { protons: 78, neutrons: 117.0840, electrons: 78, group: 10, period: 6 },
  Au: { protons: 79, neutrons: 117.9670, electrons: 79, group: 11, period: 6 },
  Hg: { protons: 80, neutrons: 120.5920, electrons: 80, group: 12, period: 6 },
  Tl: { protons: 81, neutrons: 123.3800, electrons: 81, group: 13, period: 6 },
  Pb: { protons: 82, neutrons: 125.2000, electrons: 82, group: 14, period: 6 },
  Bi: { protons: 83, neutrons: 125.9800, electrons: 83, group: 15, period: 6 },
  Po: { protons: 84, neutrons: 125.0000, electrons: 84, group: 16, period: 6 },
  At: { protons: 85, neutrons: 125.0000, electrons: 85, group: 17, period: 6 },
  Rn: { protons: 86, neutrons: 136.0000, electrons: 86, group: 18, period: 6 },
  // Period 7
  Fr: { protons: 87, neutrons: 136.0000, electrons: 87, group: 1, period: 7 },
  Ra: { protons: 88, neutrons: 138.0000, electrons: 88, group: 2, period: 7 },
  // Actinides: Ac and Lr are d-block (group 3); Th–No are f-block (group 0)
  Ac: { protons: 89, neutrons: 138.0000, electrons: 89, group: 3, period: 7 },
  Th: { protons: 90, neutrons: 142.0380, electrons: 90, group: 0, period: 7 },
  Pa: { protons: 91, neutrons: 140.0360, electrons: 91, group: 0, period: 7 },
  U: { protons: 92, neutrons: 146.0290, electrons: 92, group: 0, period: 7 },
  Np: { protons: 93, neutrons: 144.0000, electrons: 93, group: 0, period: 7 },
  Pu: { protons: 94, neutrons: 150.0000, electrons: 94, group: 0, period: 7 },
  Am: { protons: 95, neutrons: 148.0000, electrons: 95, group: 0, period: 7 },
  Cm: { protons: 96, neutrons: 151.0000, electrons: 96, group: 0, period: 7 },
  Bk: { protons: 97, neutrons: 150.0000, electrons: 97, group: 0, period: 7 },
  Cf: { protons: 98, neutrons: 153.0000, electrons: 98, group: 0, period: 7 },
  Es: { protons: 99, neutrons: 153.0000, electrons: 99, group: 0, period: 7 },
  Fm: { protons: 100, neutrons: 157.0000, electrons: 100, group: 0, period: 7 },
  Md: { protons: 101, neutrons: 157.0000, electrons: 101, group: 0, period: 7 },
  No: { protons: 102, neutrons: 157.0000, electrons: 102, group: 0, period: 7 },
  Lr: { protons: 103, neutrons: 163.0000, electrons: 103, group: 3, period: 7 },
  // Period 7 transition metals (transactinides)
  Rf: { protons: 104, neutrons: 163.0000, electrons: 104, group: 4, period: 7 },
  Db: { protons: 105, neutrons: 163.0000, electrons: 105, group: 5, period: 7 },
  Sg: { protons: 106, neutrons: 165.0000, electrons: 106, group: 6, period: 7 },
  Bh: { protons: 107, neutrons: 163.0000, electrons: 107, group: 7, period: 7 },
  Hs: { protons: 108, neutrons: 169.0000, electrons: 108, group: 8, period: 7 },
  Mt: { protons: 109, neutrons: 169.0000, electrons: 109, group: 9, period: 7 },
  Ds: { protons: 110, neutrons: 171.0000, electrons: 110, group: 10, period: 7 },
  Rg: { protons: 111, neutrons: 171.0000, electrons: 111, group: 11, period: 7 },
  Cn: { protons: 112, neutrons: 173.0000, electrons: 112, group: 12, period: 7 },
  Nh: { protons: 113, neutrons: 173.0000, electrons: 113, group: 13, period: 7 },
  Fl: { protons: 114, neutrons: 175.0000, electrons: 114, group: 14, period: 7 },
  Mc: { protons: 115, neutrons: 175.0000, electrons: 115, group: 15, period: 7 },
  Lv: { protons: 116, neutrons: 177.0000, electrons: 116, group: 16, period: 7 },
  Ts: { protons: 117, neutrons: 177.0000, electrons: 117, group: 17, period: 7 },
  Og: { protons: 118, neutrons: 176.0000, electrons: 118, group: 18, period: 7 }
};

export default elements;
