/** @module data/elements-extended */

/**
 * Isotope masses and natural abundances, keyed by element symbol.
 *
 * Companion table to `data/elements.js` (protons/neutrons/electrons/group/period/
 * electronegativity). This file adds the per-isotope breakdown behind each
 * element's standard atomic weight.
 *
 * Each entry is `{ averageMass, isotopes: [...] }`:
 * - `averageMass` : abundance-weighted mean of `exactMass` across an element's
 *                   naturally occurring isotopes (i.e. the standard atomic
 *                   weight); for elements with no natural abundance, this is
 *                   just the representative isotope's `exactMass`
 *
 * Each isotope in `isotopes` has:
 * - `massNumber` : total nucleon count (protons + neutrons)
 * - `exactMass`  : isotopic mass in atomic mass units (u); for the
 *                  synthetic/superheavy elements with no precisely measured
 *                  atomic mass, this is approximated by the mass number
 * - `abundance`  : natural terrestrial abundance as a fraction (0–1) of that
 *                  element's atoms; abundances for an element's naturally
 *                  occurring isotopes sum to ~1
 * - `halfLife`   : present on any radioactive isotope, whether or not it has
 *                  natural abundance. On an `abundance: 0` isotope it marks the
 *                  longest-lived known isotope of an element with no stable or
 *                  primordial isotope, included so the entry isn't mistaken for
 *                  missing data (mirrors the "longest-lived isotope" convention
 *                  already used for the `neutrons` field in `data/elements.js`).
 *                  On a naturally abundant isotope (e.g. K-40, Rb-87, U-235/238)
 *                  it notes that the isotope is itself radioactive despite
 *                  occurring naturally. Given as a plain magnitude string
 *                  (e.g. `'1.2e15 y'`), never a lower/upper bound comparison.
 *
 * `D` (deuterium) is listed separately from `H`, mirroring how `data/elements.js`
 * also treats it as its own symbol.
 * @type {Record<string, {averageMass: number, isotopes: Array<{massNumber: number, exactMass: number, abundance: number, halfLife?: string}>}>}
 */
const elementsExtended = {
  // Period 1
  H: {
    averageMass: 1.007941,
    isotopes: [
      { massNumber: 1, exactMass: 1.007825, abundance: 0.999885 },
      { massNumber: 2, exactMass: 2.014102, abundance: 0.000115 },
      { massNumber: 3, exactMass: 3.016049, abundance: 0, halfLife: '12.32 y' }
    ]
  },
  D: {
    averageMass: 2.014102,
    isotopes: [{ massNumber: 2, exactMass: 2.014102, abundance: 1 }]
  },
  He: {
    averageMass: 4.002601,
    isotopes: [
      { massNumber: 3, exactMass: 3.016029, abundance: 0.000002 },
      { massNumber: 4, exactMass: 4.002603, abundance: 0.999998 }
    ]
  },
  // Period 2
  Li: {
    averageMass: 6.940036,
    isotopes: [
      { massNumber: 6, exactMass: 6.015123, abundance: 0.0759 },
      { massNumber: 7, exactMass: 7.016003, abundance: 0.9241 }
    ]
  },
  Be: {
    averageMass: 9.012183,
    isotopes: [{ massNumber: 9, exactMass: 9.012183, abundance: 1 }]
  },
  B: {
    averageMass: 10.811028,
    isotopes: [
      { massNumber: 10, exactMass: 10.012937, abundance: 0.199 },
      { massNumber: 11, exactMass: 11.009305, abundance: 0.801 }
    ]
  },
  C: {
    averageMass: 12.010736,
    isotopes: [
      { massNumber: 12, exactMass: 12.0, abundance: 0.9893 },
      { massNumber: 13, exactMass: 13.003355, abundance: 0.0107 },
      { massNumber: 14, exactMass: 14.003242, abundance: 0, halfLife: '5730 y' }
    ]
  },
  N: {
    averageMass: 14.006703,
    isotopes: [
      { massNumber: 14, exactMass: 14.003074, abundance: 0.99636 },
      { massNumber: 15, exactMass: 15.000109, abundance: 0.00364 }
    ]
  },
  O: {
    averageMass: 15.999405,
    isotopes: [
      { massNumber: 16, exactMass: 15.994915, abundance: 0.99757 },
      { massNumber: 17, exactMass: 16.999132, abundance: 0.00038 },
      { massNumber: 18, exactMass: 17.99916, abundance: 0.00205 }
    ]
  },
  F: {
    averageMass: 18.998403,
    isotopes: [{ massNumber: 19, exactMass: 18.998403, abundance: 1 }]
  },
  Ne: {
    averageMass: 20.180046,
    isotopes: [
      { massNumber: 20, exactMass: 19.99244, abundance: 0.9048 },
      { massNumber: 21, exactMass: 20.993847, abundance: 0.0027 },
      { massNumber: 22, exactMass: 21.991386, abundance: 0.0925 }
    ]
  },
  // Period 3
  Na: {
    averageMass: 22.98977,
    isotopes: [{ massNumber: 23, exactMass: 22.98977, abundance: 1 }]
  },
  Mg: {
    averageMass: 24.305052,
    isotopes: [
      { massNumber: 24, exactMass: 23.985042, abundance: 0.7899 },
      { massNumber: 25, exactMass: 24.985837, abundance: 0.1 },
      { massNumber: 26, exactMass: 25.982593, abundance: 0.1101 }
    ]
  },
  Al: {
    averageMass: 26.981538,
    isotopes: [{ massNumber: 27, exactMass: 26.981538, abundance: 1 }]
  },
  Si: {
    averageMass: 28.085499,
    isotopes: [
      { massNumber: 28, exactMass: 27.976927, abundance: 0.92223 },
      { massNumber: 29, exactMass: 28.976495, abundance: 0.04685 },
      { massNumber: 30, exactMass: 29.97377, abundance: 0.03092 }
    ]
  },
  P: {
    averageMass: 30.973762,
    isotopes: [{ massNumber: 31, exactMass: 30.973762, abundance: 1 }]
  },
  S: {
    averageMass: 32.064787,
    isotopes: [
      { massNumber: 32, exactMass: 31.972071, abundance: 0.9499 },
      { massNumber: 33, exactMass: 32.971459, abundance: 0.0075 },
      { massNumber: 34, exactMass: 33.967867, abundance: 0.0425 },
      { massNumber: 36, exactMass: 35.967081, abundance: 0.0001 }
    ]
  },
  Cl: {
    averageMass: 35.452938,
    isotopes: [
      { massNumber: 35, exactMass: 34.968853, abundance: 0.7576 },
      { massNumber: 37, exactMass: 36.965903, abundance: 0.2424 }
    ]
  },
  Ar: {
    averageMass: 39.947798,
    isotopes: [
      { massNumber: 36, exactMass: 35.967545, abundance: 0.003336 },
      { massNumber: 38, exactMass: 37.962732, abundance: 0.000629 },
      { massNumber: 40, exactMass: 39.962383, abundance: 0.996035 }
    ]
  },
  // Period 4
  K: {
    averageMass: 39.098301,
    isotopes: [
      { massNumber: 39, exactMass: 38.963707, abundance: 0.932581 },
      { massNumber: 40, exactMass: 39.963998, abundance: 0.000117, halfLife: '1.248e9 y' },
      { massNumber: 41, exactMass: 40.961826, abundance: 0.067302 }
    ]
  },
  Ca: {
    averageMass: 40.078023,
    isotopes: [
      { massNumber: 40, exactMass: 39.962591, abundance: 0.96941 },
      { massNumber: 42, exactMass: 41.958618, abundance: 0.00647 },
      { massNumber: 43, exactMass: 42.958767, abundance: 0.00135 },
      { massNumber: 44, exactMass: 43.955481, abundance: 0.02086 },
      { massNumber: 46, exactMass: 45.953693, abundance: 0.00004 },
      { massNumber: 48, exactMass: 47.952523, abundance: 0.00187 }
    ]
  },
  Sc: {
    averageMass: 44.955908,
    isotopes: [{ massNumber: 45, exactMass: 44.955908, abundance: 1 }]
  },
  Ti: {
    averageMass: 47.866745,
    isotopes: [
      { massNumber: 46, exactMass: 45.952628, abundance: 0.0825 },
      { massNumber: 47, exactMass: 46.951759, abundance: 0.0744 },
      { massNumber: 48, exactMass: 47.947942, abundance: 0.7372 },
      { massNumber: 49, exactMass: 48.947866, abundance: 0.0541 },
      { massNumber: 50, exactMass: 49.944787, abundance: 0.0518 }
    ]
  },
  V: {
    averageMass: 50.941465,
    isotopes: [
      { massNumber: 50, exactMass: 49.947156, abundance: 0.0025, halfLife: '1.5e17 y' },
      { massNumber: 51, exactMass: 50.943957, abundance: 0.9975 }
    ]
  },
  Cr: {
    averageMass: 51.996131,
    isotopes: [
      { massNumber: 50, exactMass: 49.946042, abundance: 0.04345 },
      { massNumber: 52, exactMass: 51.940505, abundance: 0.83789 },
      { massNumber: 53, exactMass: 52.940646, abundance: 0.09501 },
      { massNumber: 54, exactMass: 53.938878, abundance: 0.02365 }
    ]
  },
  Mn: {
    averageMass: 54.938043,
    isotopes: [{ massNumber: 55, exactMass: 54.938043, abundance: 1 }]
  },
  Fe: {
    averageMass: 55.845144,
    isotopes: [
      { massNumber: 54, exactMass: 53.939608, abundance: 0.05845 },
      { massNumber: 56, exactMass: 55.934936, abundance: 0.91754 },
      { massNumber: 57, exactMass: 56.935392, abundance: 0.02119 },
      { massNumber: 58, exactMass: 57.933274, abundance: 0.00282 }
    ]
  },
  Co: {
    averageMass: 58.933194,
    isotopes: [{ massNumber: 59, exactMass: 58.933194, abundance: 1 }]
  },
  Ni: {
    averageMass: 58.693347,
    isotopes: [
      { massNumber: 58, exactMass: 57.935342, abundance: 0.68077 },
      { massNumber: 60, exactMass: 59.930785, abundance: 0.26223 },
      { massNumber: 61, exactMass: 60.931055, abundance: 0.011399 },
      { massNumber: 62, exactMass: 61.928345, abundance: 0.036346 },
      { massNumber: 64, exactMass: 63.927966, abundance: 0.009255 }
    ]
  },
  Cu: {
    averageMass: 63.546039,
    isotopes: [
      { massNumber: 63, exactMass: 62.929597, abundance: 0.6915 },
      { massNumber: 65, exactMass: 64.927789, abundance: 0.3085 }
    ]
  },
  Zn: {
    averageMass: 65.377782,
    isotopes: [
      { massNumber: 64, exactMass: 63.929142, abundance: 0.4917 },
      { massNumber: 66, exactMass: 65.926033, abundance: 0.2773 },
      { massNumber: 67, exactMass: 66.927127, abundance: 0.0404 },
      { massNumber: 68, exactMass: 67.924844, abundance: 0.1845 },
      { massNumber: 70, exactMass: 69.925319, abundance: 0.0061 }
    ]
  },
  Ga: {
    averageMass: 69.723066,
    isotopes: [
      { massNumber: 69, exactMass: 68.925573, abundance: 0.60108 },
      { massNumber: 71, exactMass: 70.924702, abundance: 0.39892 }
    ]
  },
  Ge: {
    averageMass: 72.62755,
    isotopes: [
      { massNumber: 70, exactMass: 69.924249, abundance: 0.2057 },
      { massNumber: 72, exactMass: 71.922076, abundance: 0.2745 },
      { massNumber: 73, exactMass: 72.923459, abundance: 0.0775 },
      { massNumber: 74, exactMass: 73.921178, abundance: 0.365 },
      { massNumber: 76, exactMass: 75.921403, abundance: 0.0773 }
    ]
  },
  As: {
    averageMass: 74.921595,
    isotopes: [{ massNumber: 75, exactMass: 74.921595, abundance: 1 }]
  },
  Se: {
    averageMass: 78.959389,
    isotopes: [
      { massNumber: 74, exactMass: 73.922476, abundance: 0.0089 },
      { massNumber: 76, exactMass: 75.919214, abundance: 0.0937 },
      { massNumber: 77, exactMass: 76.919914, abundance: 0.0763 },
      { massNumber: 78, exactMass: 77.917309, abundance: 0.2377 },
      { massNumber: 80, exactMass: 79.916522, abundance: 0.4961 },
      { massNumber: 82, exactMass: 81.9167, abundance: 0.0873 }
    ]
  },
  Br: {
    averageMass: 79.903527,
    isotopes: [
      { massNumber: 79, exactMass: 78.918338, abundance: 0.5069 },
      { massNumber: 81, exactMass: 80.916288, abundance: 0.4931 }
    ]
  },
  Kr: {
    averageMass: 83.798007,
    isotopes: [
      { massNumber: 78, exactMass: 77.920367, abundance: 0.00355 },
      { massNumber: 80, exactMass: 79.916379, abundance: 0.02286 },
      { massNumber: 82, exactMass: 81.913484, abundance: 0.11593 },
      { massNumber: 83, exactMass: 82.914136, abundance: 0.115 },
      { massNumber: 84, exactMass: 83.911507, abundance: 0.56987 },
      { massNumber: 86, exactMass: 85.910611, abundance: 0.17279 }
    ]
  },
  // Period 5
  Rb: {
    averageMass: 85.467664,
    isotopes: [
      { massNumber: 85, exactMass: 84.91179, abundance: 0.7217 },
      { massNumber: 87, exactMass: 86.909181, abundance: 0.2783, halfLife: '4.97e10 y' }
    ]
  },
  Sr: {
    averageMass: 87.616644,
    isotopes: [
      { massNumber: 84, exactMass: 83.913419, abundance: 0.0056 },
      { massNumber: 86, exactMass: 85.90926, abundance: 0.0986 },
      { massNumber: 87, exactMass: 86.908877, abundance: 0.07 },
      { massNumber: 88, exactMass: 87.905612, abundance: 0.8258 }
    ]
  },
  Y: {
    averageMass: 88.905838,
    isotopes: [{ massNumber: 89, exactMass: 88.905838, abundance: 1 }]
  },
  Zr: {
    averageMass: 91.223642,
    isotopes: [
      { massNumber: 90, exactMass: 89.904698, abundance: 0.5145 },
      { massNumber: 91, exactMass: 90.90564, abundance: 0.1122 },
      { massNumber: 92, exactMass: 91.905035, abundance: 0.1715 },
      { massNumber: 94, exactMass: 93.906313, abundance: 0.1738 },
      { massNumber: 96, exactMass: 95.908275, abundance: 0.028 }
    ]
  },
  Nb: {
    averageMass: 92.906373,
    isotopes: [{ massNumber: 93, exactMass: 92.906373, abundance: 1 }]
  },
  Mo: {
    averageMass: 95.959787,
    isotopes: [
      { massNumber: 92, exactMass: 91.906807, abundance: 0.1453 },
      { massNumber: 94, exactMass: 93.905084, abundance: 0.0915 },
      { massNumber: 95, exactMass: 94.905837, abundance: 0.1584 },
      { massNumber: 96, exactMass: 95.904675, abundance: 0.1667 },
      { massNumber: 97, exactMass: 96.906017, abundance: 0.096 },
      { massNumber: 98, exactMass: 97.905404, abundance: 0.2439 },
      { massNumber: 100, exactMass: 99.907468, abundance: 0.0982 }
    ]
  },
  Tc: {
    averageMass: 97.907212,
    isotopes: [{ massNumber: 98, exactMass: 97.907212, abundance: 0, halfLife: '4.2e6 y' }]
  },
  Ru: {
    averageMass: 101.064939,
    isotopes: [
      { massNumber: 96, exactMass: 95.907589, abundance: 0.0554 },
      { massNumber: 98, exactMass: 97.905287, abundance: 0.0187 },
      { massNumber: 99, exactMass: 98.905934, abundance: 0.1276 },
      { massNumber: 100, exactMass: 99.90421, abundance: 0.126 },
      { massNumber: 101, exactMass: 100.905573, abundance: 0.1706 },
      { massNumber: 102, exactMass: 101.904344, abundance: 0.3155 },
      { massNumber: 104, exactMass: 103.905427, abundance: 0.1862 }
    ]
  },
  Rh: {
    averageMass: 102.905498,
    isotopes: [{ massNumber: 103, exactMass: 102.905498, abundance: 1 }]
  },
  Pd: {
    averageMass: 106.415328,
    isotopes: [
      { massNumber: 102, exactMass: 101.905602, abundance: 0.0102 },
      { massNumber: 104, exactMass: 103.904031, abundance: 0.1114 },
      { massNumber: 105, exactMass: 104.90508, abundance: 0.2233 },
      { massNumber: 106, exactMass: 105.90348, abundance: 0.2733 },
      { massNumber: 108, exactMass: 107.903892, abundance: 0.2646 },
      { massNumber: 110, exactMass: 109.905172, abundance: 0.1172 }
    ]
  },
  Ag: {
    averageMass: 107.86815,
    isotopes: [
      { massNumber: 107, exactMass: 106.905092, abundance: 0.51839 },
      { massNumber: 109, exactMass: 108.904756, abundance: 0.48161 }
    ]
  },
  Cd: {
    averageMass: 112.411558,
    isotopes: [
      { massNumber: 106, exactMass: 105.90646, abundance: 0.0125 },
      { massNumber: 108, exactMass: 107.904184, abundance: 0.0089 },
      { massNumber: 110, exactMass: 109.903008, abundance: 0.1249 },
      { massNumber: 111, exactMass: 110.904184, abundance: 0.128 },
      { massNumber: 112, exactMass: 111.902764, abundance: 0.2413 },
      { massNumber: 113, exactMass: 112.904408, abundance: 0.1222 },
      { massNumber: 114, exactMass: 113.903365, abundance: 0.2873 },
      { massNumber: 116, exactMass: 115.904763, abundance: 0.0749 }
    ]
  },
  In: {
    averageMass: 114.818086,
    isotopes: [
      { massNumber: 113, exactMass: 112.904062, abundance: 0.0429 },
      { massNumber: 115, exactMass: 114.903878, abundance: 0.9571, halfLife: '4.4e14 y' }
    ]
  },
  Sn: {
    averageMass: 118.710113,
    isotopes: [
      { massNumber: 112, exactMass: 111.904824, abundance: 0.0097 },
      { massNumber: 114, exactMass: 113.902784, abundance: 0.0066 },
      { massNumber: 115, exactMass: 114.903344, abundance: 0.0034 },
      { massNumber: 116, exactMass: 115.901743, abundance: 0.1454 },
      { massNumber: 117, exactMass: 116.902954, abundance: 0.0768 },
      { massNumber: 118, exactMass: 117.901607, abundance: 0.2422 },
      { massNumber: 119, exactMass: 118.903311, abundance: 0.0859 },
      { massNumber: 120, exactMass: 119.902202, abundance: 0.3258 },
      { massNumber: 122, exactMass: 121.903445, abundance: 0.0463 },
      { massNumber: 124, exactMass: 123.905277, abundance: 0.0579 }
    ]
  },
  Sb: {
    averageMass: 121.759784,
    isotopes: [
      { massNumber: 121, exactMass: 120.903812, abundance: 0.5721 },
      { massNumber: 123, exactMass: 122.904213, abundance: 0.4279 }
    ]
  },
  Te: {
    averageMass: 127.603128,
    isotopes: [
      { massNumber: 120, exactMass: 119.90406, abundance: 0.0009 },
      { massNumber: 122, exactMass: 121.903044, abundance: 0.0255 },
      { massNumber: 123, exactMass: 122.90427, abundance: 0.0089 },
      { massNumber: 124, exactMass: 123.902817, abundance: 0.0474 },
      { massNumber: 125, exactMass: 124.904431, abundance: 0.0707 },
      { massNumber: 126, exactMass: 125.903312, abundance: 0.1884 },
      { massNumber: 128, exactMass: 127.904463, abundance: 0.3174 },
      { massNumber: 130, exactMass: 129.906224, abundance: 0.3408 }
    ]
  },
  I: {
    averageMass: 126.904473,
    isotopes: [{ massNumber: 127, exactMass: 126.904473, abundance: 1 }]
  },
  Xe: {
    averageMass: 131.292761,
    isotopes: [
      { massNumber: 124, exactMass: 123.905289, abundance: 0.000952 },
      { massNumber: 126, exactMass: 125.904298, abundance: 0.00089 },
      { massNumber: 128, exactMass: 127.903531, abundance: 0.019102 },
      { massNumber: 129, exactMass: 128.90478, abundance: 0.264006 },
      { massNumber: 130, exactMass: 129.903509, abundance: 0.04071 },
      { massNumber: 131, exactMass: 130.905084, abundance: 0.212324 },
      { massNumber: 132, exactMass: 131.904155, abundance: 0.269086 },
      { massNumber: 134, exactMass: 133.905394, abundance: 0.104357 },
      { massNumber: 136, exactMass: 135.907219, abundance: 0.088573 }
    ]
  },
  // Period 6
  Cs: {
    averageMass: 132.905452,
    isotopes: [{ massNumber: 133, exactMass: 132.905452, abundance: 1 }]
  },
  Ba: {
    averageMass: 137.326892,
    isotopes: [
      { massNumber: 130, exactMass: 129.906321, abundance: 0.00106 },
      { massNumber: 132, exactMass: 131.905061, abundance: 0.00101 },
      { massNumber: 134, exactMass: 133.904508, abundance: 0.02417 },
      { massNumber: 135, exactMass: 134.905689, abundance: 0.06592 },
      { massNumber: 136, exactMass: 135.904576, abundance: 0.07854 },
      { massNumber: 137, exactMass: 136.905827, abundance: 0.11232 },
      { massNumber: 138, exactMass: 137.905247, abundance: 0.71698 }
    ]
  },
  // Lanthanides
  La: {
    averageMass: 138.905465,
    isotopes: [
      { massNumber: 138, exactMass: 137.907112, abundance: 0.0009, halfLife: '1.02e11 y' },
      { massNumber: 139, exactMass: 138.906364, abundance: 0.9991 }
    ]
  },
  Ce: {
    averageMass: 140.115727,
    isotopes: [
      { massNumber: 136, exactMass: 135.907129, abundance: 0.00185 },
      { massNumber: 138, exactMass: 137.905991, abundance: 0.00251 },
      { massNumber: 140, exactMass: 139.905439, abundance: 0.8845 },
      { massNumber: 142, exactMass: 141.909249, abundance: 0.11114 }
    ]
  },
  Pr: {
    averageMass: 140.907658,
    isotopes: [{ massNumber: 141, exactMass: 140.907658, abundance: 1 }]
  },
  Nd: {
    averageMass: 144.241595,
    isotopes: [
      { massNumber: 142, exactMass: 141.907729, abundance: 0.27152 },
      { massNumber: 143, exactMass: 142.90982, abundance: 0.12174 },
      { massNumber: 144, exactMass: 143.910093, abundance: 0.23798 },
      { massNumber: 145, exactMass: 144.912579, abundance: 0.08293 },
      { massNumber: 146, exactMass: 145.913123, abundance: 0.17189 },
      { massNumber: 148, exactMass: 147.916893, abundance: 0.05756 },
      { massNumber: 150, exactMass: 149.920891, abundance: 0.05638 }
    ]
  },
  Pm: {
    averageMass: 144.912756,
    isotopes: [{ massNumber: 145, exactMass: 144.912756, abundance: 0, halfLife: '17.7 y' }]
  },
  Sm: {
    averageMass: 150.366355,
    isotopes: [
      { massNumber: 144, exactMass: 143.912006, abundance: 0.0307 },
      { massNumber: 147, exactMass: 146.914904, abundance: 0.1499 },
      { massNumber: 148, exactMass: 147.914829, abundance: 0.1124 },
      { massNumber: 149, exactMass: 148.917191, abundance: 0.1382 },
      { massNumber: 150, exactMass: 149.917282, abundance: 0.0738 },
      { massNumber: 152, exactMass: 151.919739, abundance: 0.2675 },
      { massNumber: 154, exactMass: 153.922218, abundance: 0.2275 }
    ]
  },
  Eu: {
    averageMass: 151.964377,
    isotopes: [
      { massNumber: 151, exactMass: 150.919857, abundance: 0.4781 },
      { massNumber: 153, exactMass: 152.921237, abundance: 0.5219 }
    ]
  },
  Gd: {
    averageMass: 157.25213,
    isotopes: [
      { massNumber: 152, exactMass: 151.919799, abundance: 0.002 },
      { massNumber: 154, exactMass: 153.920873, abundance: 0.0218 },
      { massNumber: 155, exactMass: 154.922629, abundance: 0.148 },
      { massNumber: 156, exactMass: 155.92213, abundance: 0.2047 },
      { massNumber: 157, exactMass: 156.923967, abundance: 0.1565 },
      { massNumber: 158, exactMass: 157.924112, abundance: 0.2484 },
      { massNumber: 160, exactMass: 159.927062, abundance: 0.2186 }
    ]
  },
  Tb: {
    averageMass: 158.925354,
    isotopes: [{ massNumber: 159, exactMass: 158.925354, abundance: 1 }]
  },
  Dy: {
    averageMass: 162.499472,
    isotopes: [
      { massNumber: 156, exactMass: 155.924284, abundance: 0.00056 },
      { massNumber: 158, exactMass: 157.924415, abundance: 0.00095 },
      { massNumber: 160, exactMass: 159.925203, abundance: 0.02329 },
      { massNumber: 161, exactMass: 160.926939, abundance: 0.18889 },
      { massNumber: 162, exactMass: 161.926804, abundance: 0.25475 },
      { massNumber: 163, exactMass: 162.928737, abundance: 0.24896 },
      { massNumber: 164, exactMass: 163.929181, abundance: 0.2826 }
    ]
  },
  Ho: {
    averageMass: 164.930332,
    isotopes: [{ massNumber: 165, exactMass: 164.930332, abundance: 1 }]
  },
  Er: {
    averageMass: 167.259082,
    isotopes: [
      { massNumber: 162, exactMass: 161.928787, abundance: 0.00139 },
      { massNumber: 164, exactMass: 163.929207, abundance: 0.01601 },
      { massNumber: 166, exactMass: 165.930299, abundance: 0.33503 },
      { massNumber: 167, exactMass: 166.932054, abundance: 0.22869 },
      { massNumber: 168, exactMass: 167.932376, abundance: 0.26978 },
      { massNumber: 170, exactMass: 169.935471, abundance: 0.1491 }
    ]
  },
  Tm: {
    averageMass: 168.934219,
    isotopes: [{ massNumber: 169, exactMass: 168.934219, abundance: 1 }]
  },
  Yb: {
    averageMass: 173.054168,
    isotopes: [
      { massNumber: 168, exactMass: 167.933889, abundance: 0.00123 },
      { massNumber: 170, exactMass: 169.934767, abundance: 0.02982 },
      { massNumber: 171, exactMass: 170.93633, abundance: 0.14086 },
      { massNumber: 172, exactMass: 171.936386, abundance: 0.21686 },
      { massNumber: 173, exactMass: 172.938216, abundance: 0.16103 },
      { massNumber: 174, exactMass: 173.938867, abundance: 0.32026 },
      { massNumber: 176, exactMass: 175.942576, abundance: 0.12996 }
    ]
  },
  Lu: {
    averageMass: 174.966817,
    isotopes: [
      { massNumber: 175, exactMass: 174.940777, abundance: 0.97401 },
      { massNumber: 176, exactMass: 175.942691, abundance: 0.02599, halfLife: '3.76e10 y' }
    ]
  },
  // Period 6 transition metals and main-group
  Hf: {
    averageMass: 178.484981,
    isotopes: [
      { massNumber: 174, exactMass: 173.940048, abundance: 0.0016 },
      { massNumber: 176, exactMass: 175.94141, abundance: 0.0526 },
      { massNumber: 177, exactMass: 176.943229, abundance: 0.186 },
      { massNumber: 178, exactMass: 177.943708, abundance: 0.2728 },
      { massNumber: 179, exactMass: 178.945826, abundance: 0.1362 },
      { massNumber: 180, exactMass: 179.946561, abundance: 0.3508 }
    ]
  },
  Ta: {
    averageMass: 180.947896,
    isotopes: [
      { massNumber: 180, exactMass: 179.947465, abundance: 0.0001, halfLife: '1.2e15 y' },
      { massNumber: 181, exactMass: 180.947996, abundance: 0.9999 }
    ]
  },
  W: {
    averageMass: 183.841778,
    isotopes: [
      { massNumber: 180, exactMass: 179.946704, abundance: 0.0012 },
      { massNumber: 182, exactMass: 181.948204, abundance: 0.265 },
      { massNumber: 183, exactMass: 182.950223, abundance: 0.1431 },
      { massNumber: 184, exactMass: 183.950931, abundance: 0.3064 },
      { massNumber: 186, exactMass: 185.954365, abundance: 0.2843 }
    ]
  },
  Re: {
    averageMass: 186.206707,
    isotopes: [
      { massNumber: 185, exactMass: 184.952958, abundance: 0.374 },
      { massNumber: 187, exactMass: 186.955752, abundance: 0.626, halfLife: '4.12e10 y' }
    ]
  },
  Os: {
    averageMass: 190.224862,
    isotopes: [
      { massNumber: 184, exactMass: 183.952493, abundance: 0.0002 },
      { massNumber: 186, exactMass: 185.953838, abundance: 0.0159 },
      { massNumber: 187, exactMass: 186.95575, abundance: 0.0196 },
      { massNumber: 188, exactMass: 187.955837, abundance: 0.1324 },
      { massNumber: 189, exactMass: 188.958146, abundance: 0.1615 },
      { massNumber: 190, exactMass: 189.958446, abundance: 0.2626 },
      { massNumber: 192, exactMass: 191.961481, abundance: 0.4078 }
    ]
  },
  Ir: {
    averageMass: 192.216054,
    isotopes: [
      { massNumber: 191, exactMass: 190.960591, abundance: 0.373 },
      { massNumber: 193, exactMass: 192.962924, abundance: 0.627 }
    ]
  },
  Pt: {
    averageMass: 195.084456,
    isotopes: [
      { massNumber: 190, exactMass: 189.95993, abundance: 0.00012 },
      { massNumber: 192, exactMass: 191.961039, abundance: 0.00782 },
      { massNumber: 194, exactMass: 193.96268, abundance: 0.3286 },
      { massNumber: 195, exactMass: 194.964791, abundance: 0.3378 },
      { massNumber: 196, exactMass: 195.964952, abundance: 0.2521 },
      { massNumber: 198, exactMass: 197.967893, abundance: 0.07356 }
    ]
  },
  Au: {
    averageMass: 196.96657,
    isotopes: [{ massNumber: 197, exactMass: 196.96657, abundance: 1 }]
  },
  Hg: {
    averageMass: 200.599167,
    isotopes: [
      { massNumber: 196, exactMass: 195.965833, abundance: 0.0015 },
      { massNumber: 198, exactMass: 197.966769, abundance: 0.0997 },
      { massNumber: 199, exactMass: 198.968281, abundance: 0.1687 },
      { massNumber: 200, exactMass: 199.968327, abundance: 0.231 },
      { massNumber: 201, exactMass: 200.970303, abundance: 0.1318 },
      { massNumber: 202, exactMass: 201.970644, abundance: 0.2986 },
      { massNumber: 204, exactMass: 203.973494, abundance: 0.0687 }
    ]
  },
  Tl: {
    averageMass: 204.383412,
    isotopes: [
      { massNumber: 203, exactMass: 202.972344, abundance: 0.2952 },
      { massNumber: 205, exactMass: 204.974427, abundance: 0.7048 }
    ]
  },
  Pb: {
    averageMass: 207.216908,
    isotopes: [
      { massNumber: 204, exactMass: 203.973044, abundance: 0.014 },
      { massNumber: 206, exactMass: 205.974465, abundance: 0.241 },
      { massNumber: 207, exactMass: 206.975897, abundance: 0.221 },
      { massNumber: 208, exactMass: 207.976652, abundance: 0.524 }
    ]
  },
  Bi: {
    averageMass: 208.980399,
    isotopes: [{ massNumber: 209, exactMass: 208.980399, abundance: 1 }]
  },
  Po: {
    averageMass: 208.98243,
    isotopes: [{ massNumber: 209, exactMass: 208.98243, abundance: 0, halfLife: '125.2 y' }]
  },
  At: {
    averageMass: 209.987148,
    isotopes: [{ massNumber: 210, exactMass: 209.987148, abundance: 0, halfLife: '8.1 h' }]
  },
  Rn: {
    averageMass: 222.017578,
    isotopes: [{ massNumber: 222, exactMass: 222.017578, abundance: 0, halfLife: '3.82 d' }]
  },
  // Period 7
  Fr: {
    averageMass: 223.019736,
    isotopes: [{ massNumber: 223, exactMass: 223.019736, abundance: 0, halfLife: '22.0 min' }]
  },
  Ra: {
    averageMass: 226.02541,
    isotopes: [{ massNumber: 226, exactMass: 226.02541, abundance: 0, halfLife: '1600 y' }]
  },
  // Actinides
  Ac: {
    averageMass: 227.027752,
    isotopes: [{ massNumber: 227, exactMass: 227.027752, abundance: 0, halfLife: '21.8 y' }]
  },
  Th: {
    averageMass: 232.038054,
    isotopes: [{ massNumber: 232, exactMass: 232.038054, abundance: 1, halfLife: '1.4e10 y' }]
  },
  Pa: {
    averageMass: 231.035882,
    isotopes: [{ massNumber: 231, exactMass: 231.035882, abundance: 1, halfLife: '3.28e4 y' }]
  },
  U: {
    averageMass: 238.028909,
    isotopes: [
      { massNumber: 234, exactMass: 234.040947, abundance: 0.000054, halfLife: '2.46e5 y' },
      { massNumber: 235, exactMass: 235.04393, abundance: 0.007204, halfLife: '7.04e8 y' },
      { massNumber: 238, exactMass: 238.050787, abundance: 0.992742, halfLife: '4.47e9 y' }
    ]
  },
  Np: {
    averageMass: 237.048173,
    isotopes: [{ massNumber: 237, exactMass: 237.048173, abundance: 0, halfLife: '2.14e6 y' }]
  },
  Pu: {
    averageMass: 244.064205,
    isotopes: [{ massNumber: 244, exactMass: 244.064205, abundance: 0, halfLife: '8.00e7 y' }]
  },
  Am: {
    averageMass: 243.061381,
    isotopes: [{ massNumber: 243, exactMass: 243.061381, abundance: 0, halfLife: '7370 y' }]
  },
  Cm: {
    averageMass: 247.070354,
    isotopes: [{ massNumber: 247, exactMass: 247.070354, abundance: 0, halfLife: '1.56e7 y' }]
  },
  Bk: {
    averageMass: 247.070307,
    isotopes: [{ massNumber: 247, exactMass: 247.070307, abundance: 0, halfLife: '1380 y' }]
  },
  Cf: {
    averageMass: 251.079587,
    isotopes: [{ massNumber: 251, exactMass: 251.079587, abundance: 0, halfLife: '898 y' }]
  },
  Es: {
    averageMass: 252.08298,
    isotopes: [{ massNumber: 252, exactMass: 252.08298, abundance: 0, halfLife: '471.7 d' }]
  },
  Fm: {
    averageMass: 257.095105,
    isotopes: [{ massNumber: 257, exactMass: 257.095105, abundance: 0, halfLife: '100.5 d' }]
  },
  Md: {
    averageMass: 258.098431,
    isotopes: [{ massNumber: 258, exactMass: 258.098431, abundance: 0, halfLife: '51.5 d' }]
  },
  No: {
    averageMass: 259.10103,
    isotopes: [{ massNumber: 259, exactMass: 259.10103, abundance: 0, halfLife: '58 min' }]
  },
  Lr: {
    averageMass: 266,
    isotopes: [{ massNumber: 266, exactMass: 266.0, abundance: 0, halfLife: '11 h' }]
  },
  // Period 7 transition metals (transactinides) — no precisely measured atomic
  // mass exists for these; exactMass is approximated by the mass number of the
  // longest-lived known isotope (matching the `neutrons` field already chosen
  // for these elements in `data/elements.js`).
  Rf: {
    averageMass: 267,
    isotopes: [{ massNumber: 267, exactMass: 267.0, abundance: 0, halfLife: '1.3 h' }]
  },
  Db: {
    averageMass: 268,
    isotopes: [{ massNumber: 268, exactMass: 268.0, abundance: 0, halfLife: '16 h' }]
  },
  Sg: {
    averageMass: 271,
    isotopes: [{ massNumber: 271, exactMass: 271.0, abundance: 0, halfLife: '2.4 min' }]
  },
  Bh: {
    averageMass: 270,
    isotopes: [{ massNumber: 270, exactMass: 270.0, abundance: 0, halfLife: '3.8 min' }]
  },
  Hs: {
    averageMass: 277,
    isotopes: [{ massNumber: 277, exactMass: 277.0, abundance: 0, halfLife: '12 min' }]
  },
  Mt: {
    averageMass: 278,
    isotopes: [{ massNumber: 278, exactMass: 278.0, abundance: 0, halfLife: '4.5 s' }]
  },
  Ds: {
    averageMass: 281,
    isotopes: [{ massNumber: 281, exactMass: 281.0, abundance: 0, halfLife: '12.7 s' }]
  },
  Rg: {
    averageMass: 282,
    isotopes: [{ massNumber: 282, exactMass: 282.0, abundance: 0, halfLife: '100 s' }]
  },
  Cn: {
    averageMass: 285,
    isotopes: [{ massNumber: 285, exactMass: 285.0, abundance: 0, halfLife: '29 s' }]
  },
  Nh: {
    averageMass: 286,
    isotopes: [{ massNumber: 286, exactMass: 286.0, abundance: 0, halfLife: '10 s' }]
  },
  Fl: {
    averageMass: 289,
    isotopes: [{ massNumber: 289, exactMass: 289.0, abundance: 0, halfLife: '2.1 s' }]
  },
  Mc: {
    averageMass: 290,
    isotopes: [{ massNumber: 290, exactMass: 290.0, abundance: 0, halfLife: '0.65 s' }]
  },
  Lv: {
    averageMass: 293,
    isotopes: [{ massNumber: 293, exactMass: 293.0, abundance: 0, halfLife: '57 ms' }]
  },
  Ts: {
    averageMass: 294,
    isotopes: [{ massNumber: 294, exactMass: 294.0, abundance: 0, halfLife: '51 ms' }]
  },
  Og: {
    averageMass: 294,
    isotopes: [{ massNumber: 294, exactMass: 294.0, abundance: 0, halfLife: '0.7 ms' }]
  }
};

export default elementsExtended;
