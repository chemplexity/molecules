/**
 * File        : reference.js
 * Description : assorted chemical terms and constants
 *
 * Options     : reference.elements
 */

const reference = {

    /**
     * Name        : reference.elements
     * Description : dictionary of atomic properties
     *
     * element :
     *   protons   : # protons
     *   neutrons  : average # neutrons
     *   electrons : # electrons
     *   group     : periodic table column
     *   period    : periodic table row
     */

    elements: {
        H:  {protons: 1,  neutrons: 0.0079,  electrons: 1,  group: 1,  period: 1},
        D:  {protons: 1,  neutrons: 1.0000,  electrons: 1,  group: 1,  period: 1},
        He: {protons: 2,  neutrons: 2.0026,  electrons: 2,  group: 18, period: 1},
        Li: {protons: 3,  neutrons: 3.9410,  electrons: 3,  group: 1,  period: 2},
        Be: {protons: 4,  neutrons: 5.0122,  electrons: 4,  group: 2,  period: 2},
        B:  {protons: 5,  neutrons: 5.8110,  electrons: 5,  group: 13, period: 2},
        C:  {protons: 6,  neutrons: 6.0107,  electrons: 6,  group: 14, period: 2},
        N:  {protons: 7,  neutrons: 7.0067,  electrons: 7,  group: 15, period: 2},
        O:  {protons: 8,  neutrons: 7.9994,  electrons: 8,  group: 16, period: 2},
        F:  {protons: 9,  neutrons: 9.9984,  electrons: 9,  group: 17, period: 2},
        Ne: {protons: 10, neutrons: 10.1797, electrons: 10, group: 18, period: 2},
        Na: {protons: 11, neutrons: 11.9897, electrons: 11, group: 1,  period: 3},
        Mg: {protons: 12, neutrons: 12.3050, electrons: 12, group: 2,  period: 3},
        Al: {protons: 13, neutrons: 13.9815, electrons: 13, group: 13, period: 3},
        Si: {protons: 14, neutrons: 14.0855, electrons: 14, group: 14, period: 3},
        P:  {protons: 15, neutrons: 15.9738, electrons: 15, group: 15, period: 3},
        S:  {protons: 16, neutrons: 16.0650, electrons: 16, group: 16, period: 3},
        Cl: {protons: 17, neutrons: 18.4500, electrons: 17, group: 17, period: 3},
        Ar: {protons: 18, neutrons: 21.9480, electrons: 18, group: 18, period: 3},
        K:  {protons: 19, neutrons: 20.0983, electrons: 19, group: 1,  period: 4},
        Ca: {protons: 20, neutrons: 20.0780, electrons: 20, group: 2,  period: 4},
        Sc: {protons: 21, neutrons: 23.9559, electrons: 21, group: 3,  period: 4},
        Ti: {protons: 22, neutrons: 25.8670, electrons: 22, group: 4,  period: 4},
        V:  {protons: 23, neutrons: 27.9415, electrons: 23, group: 5,  period: 4},
        Cr: {protons: 24, neutrons: 27.9961, electrons: 24, group: 6,  period: 4},
        Mn: {protons: 25, neutrons: 29.9380, electrons: 25, group: 7,  period: 4},
        Fe: {protons: 26, neutrons: 29.8450, electrons: 26, group: 8,  period: 4},
        Co: {protons: 27, neutrons: 31.9332, electrons: 27, group: 9,  period: 4},
        Ni: {protons: 28, neutrons: 30.6934, electrons: 28, group: 10, period: 4},
        Cu: {protons: 29, neutrons: 34.5460, electrons: 29, group: 11, period: 4},
        Zn: {protons: 30, neutrons: 35.3900, electrons: 30, group: 12, period: 4},
        Ga: {protons: 31, neutrons: 38.7230, electrons: 31, group: 13, period: 4},
        Ge: {protons: 32, neutrons: 40.6100, electrons: 32, group: 14, period: 4},
        As: {protons: 33, neutrons: 41.9216, electrons: 33, group: 15, period: 4},
        Se: {protons: 34, neutrons: 44.9600, electrons: 34, group: 16, period: 4},
        Br: {protons: 35, neutrons: 44.9040, electrons: 35, group: 17, period: 4},
        Kr: {protons: 36, neutrons: 47.8000, electrons: 36, group: 18, period: 4},
        Rb: {protons: 37, neutrons: 48.4678, electrons: 37, group: 1,  period: 5},
        Sr: {protons: 38, neutrons: 49.6210, electrons: 38, group: 2,  period: 5},
        Y:  {protons: 39, neutrons: 49.9058, electrons: 39, group: 3,  period: 5},
        Zr: {protons: 40, neutrons: 52.2242, electrons: 40, group: 4,  period: 5},
        Nb: {protons: 41, neutrons: 51.9064, electrons: 41, group: 5,  period: 5},
        Mo: {protons: 42, neutrons: 53.9510, electrons: 42, group: 6,  period: 5},
        Tc: {protons: 43, neutrons: 55.0000, electrons: 43, group: 7,  period: 5},
        Ru: {protons: 44, neutrons: 57.0720, electrons: 44, group: 8,  period: 5},
        Rh: {protons: 45, neutrons: 57.9055, electrons: 45, group: 9,  period: 5},
        Pd: {protons: 46, neutrons: 60.4210, electrons: 46, group: 10, period: 5},
        Ag: {protons: 47, neutrons: 60.8682, electrons: 47, group: 11, period: 5},
        Cd: {protons: 48, neutrons: 64.4144, electrons: 48, group: 12, period: 5},
        In: {protons: 49, neutrons: 65.8181, electrons: 49, group: 13, period: 5},
        Sn: {protons: 50, neutrons: 68.7107, electrons: 50, group: 14, period: 5},
        Sb: {protons: 51, neutrons: 70.7601, electrons: 51, group: 15, period: 5},
        Te: {protons: 52, neutrons: 75.6030, electrons: 52, group: 16, period: 5},
        I:  {protons: 53, neutrons: 73.9045, electrons: 53, group: 17, period: 5},
        Xe: {protons: 54, neutrons: 77.2936, electrons: 54, group: 18, period: 5}
    }
};

/**
 * Exports
 */

export default reference.elements;
