
/*
 // Elements
 var elements = [
 { symbol: 'H',  group: 1,  protons: 1,  neutrons: [0,1], abundance: [99.9885, 0.0115] },
 { symbol: 'B',  group: 13, protons: 5,  neutrons: [6,5], abundance: [80.1, 19.9] },
 { symbol: 'C',  group: 14, protons: 6,  neutrons: [6,7], abundance: [98.93, 1.07] },
 { symbol: 'N',  group: 15, protons: 7,  neutrons: [7,8], abundance: [99.636, 0.364] },
 { symbol: 'O',  group: 16, protons: 8,  neutrons: [8,10,9], abundance: [99.757, 0.205, 0.038] },
 { symbol: 'F',  group: 17, protons: 9,  neutrons: [10], abundance: [100.0] },
 { symbol: 'Si', group: 14, protons: 14, neutrons: [14,15,16], abundance: [92.223, 4.685, 3.092] },
 { symbol: 'P',  group: 15, protons: 15, neutrons: [16], abundance: [100.0] },
 { symbol: 'S',  group: 16, protons: 16, neutrons: [16,18,17,20], abundance: [94.99, 4.25, 0.75, 0.01] },
 { symbol: 'Cl', group: 17, protons: 17, neutrons: [18,20], abundance: [75.76, 24.24] },
 { symbol: 'Se', group: 16, protons: 34, neutrons: [46,44,42,48,43,40], abundance: [49.61, 23.77, 9.37, 8.73, 7.63, 0.89] },
 { symbol: 'Br', group: 17, protons: 35, neutrons: [44,46], abundance: [50.69, 49.31] },
 { symbol: 'I',  group: 17, protons: 53, neutrons: [74], abundance: [100] }
 ];

 // Properties
 var properties = {
 proton:   { mass: 1.00727646681290 },
 neutron:  { mass: 1.00866491600430 },
 electron: { mass: 0.00054857990900 }
 };

 function find(array, key, value) {

 // Search object array
 for (var i = 0; i < array.length; i++) {

 // Return value
 if (array[i][key] === value) { return array[i]; }
 }
 }

 mass: function(entry) {

 // Reference values
 var p = this.properties.proton["mass"],
 n = this.properties.neutron["mass"],
 e = this.properties.electron["mass"];

 // Calculate atomic mass
 return (entry.protons * p) + (entry.neutrons * n) + (entry.electrons * e);
 }
 };
 */

var molecule = new Molecule(1);

var tokens = molecule.parse('CCO=CClC1C([14C3-]I)C1N#Oc(C(C)C)c%10c');
var atoms = molecule.atoms(tokens);

console.log(tokens);