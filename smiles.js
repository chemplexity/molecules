/**
 * Convert SMILES to JSON
 * (C) 2014 by James Dillon
 * http://wwww.chemplexity.com
 *
 */

function smiles(input) {

    // Parse input using SMILES grammar
    var grammar = definitions();

    // Create a new molecule
    var molecule = {
        molecule_id: input,
        molecule_weight: 0,
        atoms: [],
        bonds: []
    };

    // Molecules are composed of atoms
    function atom(id, symbol, element, weight, valence, color) {
        this.atom_id = id;
        this.symbol = symbol;
        this.element = element;
        this.weight = weight;
        this.valence = valence;
        this.color = color;
    }

    // Atoms are connected by bonds
    function bond(id, source, target, type, value) {
        this.bond_id = id;
        this.source = source;
        this.target = target;
        this.type = type;
        this.order = value;
    }

    // Begin parsing input string
    var input = input.split(""),
        index = {atoms: [], non_atoms: [], branches: [], bonds: [], rings: []},
        counter = {branches: -1, empty: -1, last: "start"};

    // Find atoms
    for (i = 0; i < input.length; i++) {

        // Compare input with SMILES grammar
        var match = findObjects(grammar.atoms, 'symbol', input[i]);

        // Check match
        if (match != null) {

            // Check for two letter elements
            var exceptions = ["H", "B", "C", "S", "A"];

            if (exceptions.indexOf(match.symbol) && i < input.length) {

                // Compare concatenated string with SMILES grammar
                var matchSpecial = findObjects(grammar.atoms, 'symbol', match.symbol + input[i+1]);

                // Check special match
                if (matchSpecial != null) {

                    // Replace current element in array with two letter element
                    input[i] = matchSpecial.symbol;
                    match = matchSpecial;

                    // Remove extra element
                    input.splice(i+1, 1);
                }
            }

            // Set atom properties
            var properties = {
                atom_id:  match.symbol + i,
                symbol:   match.symbol,
                element:  match.element,
                weight:   match.weight,
                valence:  match.valence,
                color:    match.color
            };

            // Update molecule with new atom
            addAtom(properties);

            // Update index of atom locations
            updateIndex(index.atoms, i, molecule.atoms.length-1, 0, properties.valence[0])
        }

        // Update index of non-atoms
        else {updateIndex(index.non_atoms, i)}
    }

    // Find branches
    for (i = 0; i < index.non_atoms.length; i++) {

        // Retrieve input value
        var value = input[index.non_atoms[i].input],
            position = index.non_atoms[i].input;

        // Compare input with SMILES grammar
        var match = findObjects(grammar.branches, 'symbol', value);

        // Check match
        if (match != null) {

            switch (match.type) {

                // Branch starts
                case "start":
                    counter.branches += 1;
                    index.branches[counter.branches] = {start: position, end: -1};

                    // Update counters
                    if (counter.last == "start") {counter.empty = counter.branches-1}
                    counter.last = "start";
                    break;

                // Branch ends
                case "end":

                    // Last occurring start branch
                    if (counter.last == "start") {
                        index.branches[counter.branches].end = position
                    }

                    // Last empty start branch
                    else {
                        index.branches[counter.empty].end = position;
                        counter.empty += -1;
                    }

                    // Update counter
                    counter.last = "end";
                    break;
            }
        }
    }

    // Find nearest atoms to branches
    for (i = 0; i < index.branches.length; i++) {

        index.branches[i].left = -1;
        index.branches[i].node = -1;
        index.branches[i].right = -1;

        // Increment distance from branch index to nearest atom
        for (j = 1; j <= index.atoms.length; j++) {

            var left = findObjects(index.atoms, "input", index.branches[i].start - j);
            var node = findObjects(index.atoms, "input", index.branches[i].start + j);
            var right = findObjects(index.atoms, "input", index.branches[i].end + j);

            // Check match
            if (left != null && index.branches[i].left == -1) {index.branches[i].left = left.output;}
            if (node != null && index.branches[i].node == -1) {index.branches[i].node = node.output;}
            if (right != null && index.branches[i].right == -1) {index.branches[i].right = right.output;}
        }

        // Set bond properties for left to node atom
        var bondProperties = {
            bond_id: molecule.bonds.length,
            source:  index.branches[i].left,
            target:  index.branches[i].node,
            type:    "single",
            value:   1
        };

        // Update molecule with new bond
        addBond(bondProperties);

        // Update bond count for atom
        index.atoms[index.branches[i].left].bonds += 1;
        index.atoms[index.branches[i].node].bonds += 1;

        // Set bond properties for left to right atom
        var bondProperties = {
            bond_id: molecule.bonds.length,
            source:  index.branches[i].left,
            target:  index.branches[i].right,
            type:    "single",
            value:   1
        };

        // Update molecule with new bond
        addBond(bondProperties);

        // Update bond count for atom
        index.atoms[index.branches[i].left].bonds += 1;
        index.atoms[index.branches[i].right].bonds += 1;
    }

    // Find implicit bonds
    for (i = 1; i < index.atoms.length; i++) {

        // Determine distance between atoms
        if (index.atoms[i].input - index.atoms[i - 1].input == 1) {

            // Set bond properties for right to node atom
            var bondProperties = {
                bond_id: molecule.bonds.length,
                source:  index.atoms[i-1].output,
                target:  index.atoms[i].output,
                type:    "single",
                value:   1
            };

            // Update molecule with new bond
            addBond(bondProperties);

            // Update bond count for atom
            index.atoms[i].bonds += 1;
            index.atoms[i-1].bonds += 1;
        }
    }

    // Find explicit bonds
    for (i = 0; i < index.non_atoms.length; i++) {

        // Retrieve input value
        var value = input[index.non_atoms[i].input],
            position = index.non_atoms[i].input;

        // Compare input with SMILES grammar
        var match = findObjects(grammar.bonds, 'symbol', value);

        // Check match
        if (match != null) {

            // Update index
            index.bonds.push({input: position, type: match.type, value: match.value});
        }
    }

    // Find nearest atoms to bonds
    for (i = 0; i < index.bonds.length; i++) {

        index.bonds[i].left = -1;
        index.bonds[i].right = -1;

        // Increment distance from bond index to nearest atom
        for (j = 1; j <= index.atoms.length; j++) {

            var left = findObjects(index.atoms, "input", index.bonds[i].input - j);
            var right = findObjects(index.atoms, "input", index.bonds[i].input + j);

            // Check match
            if (left != null && index.bonds[i].left == -1) {index.bonds[i].left = left.output}
            if (right != null && index.bonds[i].right == -1) {index.bonds[i].right = right.output}
        }

        // Set bond properties for left to node atom
        var bondProperties = {
            bond_id: molecule.bonds.length,
            source:  index.bonds[i].left,
            target:  index.bonds[i].right,
            type:    index.bonds[i].type,
            value:   index.bonds[i].value
        };

        // Update molecule with new bond
        addBond(bondProperties);

        // Update bond count for atom
        index.atoms[index.bonds[i].left].bonds += index.bonds[i].value;
        index.atoms[index.bonds[i].right].bonds += index.bonds[i].value;
    }

    // Find explicit rings
    for (i = 0; i < index.non_atoms.length; i++) {

        // Retrieve input value
        var value = input[index.non_atoms[i].input],
            position = index.non_atoms[i].input;

        // Compare input with SMILES grammar
        var match = findObjects(grammar.rings, 'symbol', value);

        // Check match
        if (match != null) {

            // Update ring index
            index.rings.push({output: findObjects(index.atoms, "input", position-1), value: value});
        }
    }

    // Find nearest atoms to rings
    var x = index.rings.length / 2

    for (i = 0; i < x; i++) {

        // Ring starting position
        var left = index.rings[i].output,
            right = -1;

        // Locate ring end position
        for (j = 1; j < index.rings.length-1; j++) {

            // Check match
            if (index.rings[i].value == index.rings[i+j].value) {

                // Set ring end position
                right = index[i + j].output;


                // Set bond properties for ring atoms
                var bondProperties = {
                    bond_id: molecule.bonds.length,
                    source: left,
                    target: right,
                    type: "single",
                    value: 1
                };
            }
        }
    }

    // Add hydrogen to available atoms
    for (i = 0; i < index.atoms.length; i++) {

        // Determine number of hydrogen to add
        var hydrogen = index.atoms[i].valence - index.atoms[i].bonds;

            // Create new atom
            for (j = 1; j <= hydrogen; j++) {

                // Set atom properties
                var properties = {
                    atom_id:  "H" + molecule.atoms.length,
                    symbol:   "H",
                    element:  1,
                    weight:   1.008,
                    valence:  1,
                    color:    "#E9E9E9"
                };

                // Update molecule with new atom
                addAtom(properties);

                // Set bond properties for left to node atom
                var bondProperties = {
                    bond_id: molecule.bonds.length,
                    source:  index.atoms[i].output,
                    target:  molecule.atoms.length-1,
                    type:    "hydrogen",
                    value:   1
                };

                // Update molecule with new bond
                addBond(bondProperties);
            }
    }

        //Add atom to molecule
    function addAtom(a) {

        // Create atom
        var newAtom = new atom(a.atom_id, a.symbol, a.element, a.weight, a.valence, a.color);

        // Update molecule
        molecule.atoms.push(newAtom);
    }

    // Add bond to molecule
    function addBond(b) {

        // Create atom
        var newBond = new bond(b.bond_id, b.source, b.target, b.type, b.value);

        // Update molecule
        molecule.bonds.push(newBond);
    }

    // Determine molecular weight
    for (i = 0; i < molecule.atoms.length; i++) {
        molecule.molecule_weight += molecule.atoms[i].weight;
    }

    // Round value to two decimal places
    molecule.molecule_weight = Math.round(molecule.molecule_weight*100)/100

    // Output molecule in JSON format
    return molecule;
}

// SMILES grammar definitions
function definitions() {

    // TODO: Add more atom types
    var atomDefinitions = [
        {symbol: "H",   element: 1,   weight: 1.008,   valence: [1],     color: "#E9E9E9"},
        {symbol: "He",  element: 2,   weight: 4.002,   valence: [1],     color: "#272727"},
        {symbol: "B",   element: 5,   weight: 10.81,   valence: [3],     color: "#272727"},
        {symbol: "C",   element: 6,   weight: 12.01,   valence: [4],     color: "#272727"},
        {symbol: "N",   element: 7,   weight: 14.01,   valence: [3,5],   color: "#0033CC"},
        {symbol: "O",   element: 8,   weight: 16.00,   valence: [2],     color: "#FF1919"},
        {symbol: "F",   element: 9,   weight: 19.00,   valence: [1],     color: "#272727"},
        {symbol: "Si",  element: 14,  weight: 28.09,   valence: [4],     color: "#272727"},
        {symbol: "P",   element: 15,  weight: 30.97,   valence: [3,5],   color: "#272727"},
        {symbol: "S",   element: 16,  weight: 32.06,   valence: [2,4,6], color: "#272727"},
        {symbol: "Cl",  element: 17,  weight: 35.45,   valence: [1],     color: "#272727"},
        {symbol: "As",  element: 33,  weight: 74.92,   valence: [1],     color: "#272727"},
        {symbol: "Se",  element: 34,  weight: 78.96,   valence: [1],     color: "#272727"},
        {symbol: "Br",  element: 35,  weight: 79.90,   valence: [1],     color: "#272727"},
        {symbol: "I",   element: 53,  weight: 126.90,  valence: [1],     color: "#272727"},
        {symbol: "c",   element: 6,   weight: 12.01,   valence: [1],     color: "#272727"},
        {symbol: "n",   element: 7,   weight: 14.01,   valence: [1],     color: "#272727"},
        {symbol: "o",   element: 8,   weight: 16.00,   valence: [1],     color: "#272727"},
        {symbol: "p",   element: 15,  weight: 30.97,   valence: [1],     color: "#272727"},
        {symbol: "s",   element: 16,  weight: 32.06,   valence: [1],     color: "#272727"},
        {symbol: "as",  element: 33,  weight: 74.92,   valence: [1],     color: "#272727"},
        {symbol: "se",  element: 34,  weight: 78.96,   valence: [1],     color: "#272727"}
    ];

    var bondDefinitions = [
        {symbol: "-",    type: "single",   value: 1},
        {symbol: "=",    type: "double",   value: 2},
        {symbol: "#",    type: "triple",   value: 3},
        {symbol: "$",    type: "triple",   value: 3},
        {symbol: ":",    type: "aromatic", value: 1.5},
        {symbol: "//",   type: "double",   value: "cis"},
        {symbol: "\\\\", type: "double",   value: "cis"},
        {symbol: "/\\",  type: "double",   value: "trans"},
        {symbol: "\\/",  type: "double",   value: "trans"},
        {symbol: ".",    type: "ionic",    value: 0}
    ];

    var branchDefinitions = [
        {symbol: "(",   type: "start"},
        {symbol: ")",   type: "end"}
    ];

    var ringDefinitions = [
        {symbol: "1"},
        {symbol: "2"},
        {symbol: "3"},
        {symbol: "4"},
        {symbol: "5"},
        {symbol: "6"},
        {symbol: "7"},
        {symbol: "8"},
        {symbol: "9"}
    ];

    var chargeDefinitions = [
        {symbol: "+",   value: 1},
        {symbol: "-",   value: -1},
        {symbol: "++",  value: 2},
        {symbol: "--",  value: -2}
    ];

    // TODO: Add more chirality types
    var chiralityDefinitions = [
        {symbol: "@",   value: "R"},
        {symbol: "@@",  value: "S"}
    ];

    return {
        atoms: atomDefinitions,
        bonds: bondDefinitions,
        branches: branchDefinitions,
        rings: ringDefinitions,
        charges: chargeDefinitions,
        chirality: chiralityDefinitions
    }
}

// Utility functions
function findObjects(array, key, value) {

    // Find matching key/value
    for (var i = 0; i < array.length; i++) {
        if (array[i][key] == value) {return array[i]}
    }
    return null
}

// Index values for two arrays
function updateIndex(array, input, output, bonds, valence) {

    // Update array with new entry
    array.push({input: input, output: output, bonds: bonds, valence: valence})
}
