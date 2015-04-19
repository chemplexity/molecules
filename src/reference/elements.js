/*
  elements.js

  description : atomic properties of the elements
  exports     : periodic_table
*/


/*
  Variable: periodic_table
   -basic atomic properties of the elements
*/

var periodic_table = {
    'H':  {protons: 1,  neutrons: 0.0079,  electrons: 1,  group: 1,  period: 1},
    'He': {protons: 2,  neutrons: 2.0026,  electrons: 2,  group: 18, period: 1},
    'Li': {protons: 3,  neutrons: 3.9410,  electrons: 3,  group: 1,  period: 2},
    'Be': {protons: 4,  neutrons: 5.0122,  electrons: 4,  group: 2,  period: 2},
    'B':  {protons: 5,  neutrons: 5.8110,  electrons: 5,  group: 13, period: 2},
    'C':  {protons: 6,  neutrons: 6.0107,  electrons: 6,  group: 14, period: 2},
    'N':  {protons: 7,  neutrons: 7.0067,  electrons: 7,  group: 15, period: 2},
    'O':  {protons: 8,  neutrons: 7.9994,  electrons: 8,  group: 16, period: 2},
    'F':  {protons: 9,  neutrons: 9.9984,  electrons: 9,  group: 17, period: 2},
    'Ne': {protons: 10, neutrons: 10.1797, electrons: 10, group: 18, period: 2},
    'Na': {protons: 11, neutrons: 11.9897, electrons: 11, group: 1,  period: 3},
    'Mg': {protons: 12, neutrons: 12.3050, electrons: 12, group: 2,  period: 3},
    'Al': {protons: 13, neutrons: 13.9815, electrons: 13, group: 13, period: 3},
    'Si': {protons: 14, neutrons: 14.0855, electrons: 14, group: 14, period: 3},
    'P':  {protons: 15, neutrons: 15.9738, electrons: 15, group: 15, period: 3},
    'S':  {protons: 16, neutrons: 16.0650, electrons: 16, group: 16, period: 3},
    'Cl': {protons: 17, neutrons: 18.4530, electrons: 17, group: 17, period: 3},
    'Ar': {protons: 18, neutrons: 21.9480, electrons: 18, group: 18, period: 3},
    'Se': {protons: 34, neutrons: 44.9600, electrons: 34, group: 16, period: 4},
    'Br': {protons: 35, neutrons: 44.9040, electrons: 35, group: 17, period: 4},
    'I':  {protons: 53, neutrons: 73.9045, electrons: 53, group: 17, period: 5}
};


/*
  Exports
*/

export { periodic_table };
