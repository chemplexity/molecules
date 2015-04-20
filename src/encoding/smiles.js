/*
  smiles.js

    description : parse SMILES chemical line notation
    imports     : elements
    exports     : tokenize, decode
*/

/*
  Imports
*/

// import {periodic_table} from './elements'
let {periodic_table} = require('./elements');


/*
  Variable: definitions
   -regular expressions for SMILES grammar
*/

var definitions = [
    {type: 'atom',     term: 'H',  tag: 'H',       expression: /[A-Z]?H(?=[^efgos]|$)([0-9]?)+/g},
    {type: 'atom',     term: 'B',  tag: 'B',       expression: /B(?=[^aehikr]|$)/g},
    {type: 'atom',     term: 'C',  tag: 'C',       expression: /C(?=[^adeflmnorsu]|$)/g},
    {type: 'atom',     term: 'N',  tag: 'N',       expression: /N(?=[^abdeiop]|$)/g},
    {type: 'atom',     term: 'O',  tag: 'O',       expression: /O(?=[^s]|$)/g},
    {type: 'atom',     term: 'F',  tag: 'F',       expression: /F(?=[^elmr]|$)/g},
    {type: 'atom',     term: 'Si', tag: 'Si',      expression: /Si/g},
    {type: 'atom',     term: 'P',  tag: 'P',       expression: /P(?=[^abdmortu]|$)/g},
    {type: 'atom',     term: 'S',  tag: 'S',       expression: /S(?=[^bcegimnr]|$)/g},
    {type: 'atom',     term: 'Cl', tag: 'Cl',      expression: /Cl/g},
    {type: 'atom',     term: 'Se', tag: 'Se',      expression: /Se/g},
    {type: 'atom',     term: 'Br', tag: 'Br',      expression: /Br/g},
    {type: 'atom',     term: 'I',  tag: 'I',       expression: /I(?=[^nr]|$)/g},
    {type: 'atom',     term: '*',  tag: '*',       expression: /[*]/g},
    {type: 'atom',     term: 'b',  tag: 'B',       expression: /b(?=[^aehikr]|$)/g},
    {type: 'atom',     term: 'c',  tag: 'C',       expression: /c(?=[^adeflmnorsu]|$)/g},
    {type: 'atom',     term: 'n',  tag: 'N',       expression: /n(?=[^abdeiop]|$)/g},
    {type: 'atom',     term: 'o',  tag: 'O',       expression: /o(?=[^s]|$)/g},
    {type: 'atom',     term: 'p',  tag: 'P',       expression: /p(?=[^abdmortu]|$)/g},
    {type: 'atom',     term: 's',  tag: 'S',       expression: /s(?=[^bcegimnr]|$)/g},
    {type: 'atom',     term: 'se', tag: 'Se',      expression: /se/g},
    {type: 'bond',     term: '-',  tag: 'single',  expression: /(?=[^d])[-](?=[^d])/g},
    {type: 'bond',     term: '=',  tag: 'double',  expression: /[=]/g},
    {type: 'bond',     term: '#',  tag: 'triple',  expression: /[#]/g},
    {type: 'bond',     term: '(',  tag: 'branch',  expression: /[(]/g},
    {type: 'bond',     term: ')',  tag: 'branch',  expression: /[)]/g},
    {type: 'bond',     term: '%',  tag: 'ring',    expression: /(?=[^+-])(?:[a-zA-Z]|[a-zA-Z]*.?[\]])[%]?\d(?=([^+-]|$))/g},
    {type: 'bond',     term: '.',  tag: 'dot',     expression: /[A-Z][+-]?[\[]?[.]/g},
    {type: 'property', term: '+',  tag: 'charge',  expression: /[a-zA-Z]{1,2}[0-9]*[+]+[0-9]*(?=[\]])/g},
    {type: 'property', term: '-',  tag: 'charge',  expression: /[a-zA-Z]{1,2}[0-9]*[-]+[0-9]*(?=[\]])/g},
    {type: 'property', term: 'n',  tag: 'isotope', expression: /[0-9]+[A-Z]{1,2}(?=.?[^\[]*[\]])/g},
    {type: 'property', term: '@',  tag: 'chiral',  expression: /[A-Z][a-z]?[@](?![A-Z]{2}[0-9]+|[@])/g},
    {type: 'property', term: '@@', tag: 'chiral',  expression: /[A-Z][a-z]?[@]{2}(?![A-Z]{2}[0-9]+)/g}
];


/*
  Method: Tokenize
   -parse string for valid SMILES definitions

  Syntax
    tokens = tokenize(input)

  Arguments
    input : any SMILES encoded string

  Output
    tokens : array of token objects matching input

  Examples
    tokens123 = tokenize('CC(=O)CC')
    tokensABC = tokenize('c1cccc1')
*/

function tokenize(input, tokens = []) {

    // Parse input with definitions
    for (let i = 0; i < definitions.length; i++) {

        let token = definitions[i];
        let text = [];

        // Check input for match
        while ((text = token.expression.exec(input))) {

            // Update tokens
            tokens.push({
                index: text.index,
                type:  token.type,
                term:  text[0],
                tag:   token.tag
            });
        }
    }

    // Sort tokens by index
    tokens.sort(function (a, b) {
        if (a.index < b.index) { return -1; }
        if (a.index > b.index) { return +1; }
        return 0;
    });

    return tokens;
}


/*
  Method: Decode
   -convert SMILES tokens into atoms (nodes) and bonds (edges)

  Syntax
    [atoms, bonds] = decode(tokens)

  Arguments
    tokens : array of SMILES tokens obtained from the output of 'tokenize'

  Output
    [atoms, bonds] : array of atom/bond objects describing connectivity and properties

  Examples
    [atoms, bonds] = decode(tokensABC)
    [atoms, bonds] = decode(tokens123)
*/

function decode(tokens) {

    // Validate tokens
    function validateTokens(tokens) {

        // Check supplied tokens type
        if (typeof(tokens) !== 'object') { throw 'Error: Tokens must be of type "object"'; }

        // Required token fields
        let fields = ['index', 'type', 'term', 'tag'];

        // Check tokens for required fields
        for (let i = 0; i < tokens.length; i++) {

            // Return binary comparison array
            let match = compare(fields, Object.keys(tokens[i]));

            // Check for invalid token
            if (match.reduce((a, b) => a + b) < 4) { throw 'Error: Invalid token at index #' + i; }
        }

        return true;
    }

    // Read tokens
    function readTokens(tokens, atoms = {}, bonds = {}, properties = {}, keys = {}) {

        // Generate unique key
        let newKey = (x) => x.toString();

        // Parse tokens by category
        for (let i = 0; i < tokens.length; i++) {

            // Extract token values
            let {type, term, tag, index} = tokens[i];

            // Assign unique key
            let key = newKey(index);

            // Categorize tokens
            switch (type) {

                case 'atom':
                    atoms[key] = addAtom(key, tag, term);
                    break;

                case 'bond':
                    bonds[key] = addBond(key, tag, term);
                    break;

                case 'property':
                    properties[key] = {id: key, name: tag, value: term};
                    break;
            }
        }

        // Check for atoms
        if (atoms.length < 1) { return false; }

        keys.all = [];

        // Extract all token keys
        for (let i = 0; i < tokens.length; i++) {
            keys.all[i] = newKey(tokens[i].index);
        }

        // Extract token keys by category
        keys.atoms = Object.keys(atoms);
        keys.bonds = Object.keys(bonds);
        keys.properties = Object.keys(properties);

        return [atoms, bonds, properties, keys];
    }

    // Default atom properties
    function defaultAtoms(atoms, keys){

        // Add default properties to atoms
        for (let key of keys.atoms) {

            // Element
            let element = periodic_table[atoms[key].name];

            // Element properties
            atoms[key].group = element.group;
            atoms[key].protons = element.protons;
            atoms[key].neutrons = element.neutrons;
            atoms[key].electrons = element.electrons;

            // Bond properties
            atoms[key].bonds = {
                electrons: 0,
                chiral: 0,
                atoms: []
            };

            // Other properties
            atoms[key].properties = {
                charge: 0
            };
        }

        return atoms;
    }

    // Custom atom properties
    function customAtoms(atoms, properties, keys) {

        // Add custom properties to atoms
        for (let key of keys.properties) {

            // Retrieve properties
            let {name, value} = properties[key];

            // Property name
            switch (name) {

                // Set chiral property
                case 'chiral':
                    atoms[key].bonds.chiral = value.slice(value.indexOf('@'));
                    break;

                // Set neutrons
                case 'isotope':
                    break;

                // Set charge property
                case 'charge':

                    // Determine charge sign
                    let sign = value.indexOf('+') !== -1 ? 1 : -1;

                    // Check numeric charge (e.g. '3+')
                    let charge = value.match(/[0-9]+/g);

                    if (charge !== null) {
                        atoms[key].properties.charge = charge[0] * sign;
                        break;
                    }

                    // Check symbolic charge (e.g. '+++')
                    charge = value.match(/([+]+|[-]+)/g);

                    if (charge !== null) {
                        atoms[key].properties.charge = charge[0].length * sign;
                        break;
                    }

                    break;
            }
        }

        return atoms;
    }

    // Explicit bonds
    function explicitBonds(atoms, bonds, keys) {

        // Check for any explicit bonds
        if (keys.bonds.length === 0) { return bonds; }

        // Find bonding atoms
        let source = (key) => previousAtom(key, keys.all, atoms);
        let target = (key) => nextAtom(key, keys.all, atoms);

        // Add explicit bonds
        for (let i = 0; i < keys.bonds.length; i++) {

            // Retrieve key
            let key = keys.bonds[i];

            // Bond type
            switch (bonds[key].name) {

                case 'single':
                    bonds[key].order = 1;
                    bonds[key].atoms = [source(key), target(key)];
                    break;

                case 'double':
                    bonds[key].order = 2;
                    bonds[key].atoms = [source(key), target(key)];
                    break;

                case 'triple':
                    bonds[key].order = 3;
                    bonds[key].atoms = [source(key), target(key)];
                    break;

                case 'dot':
                    bonds[key].order = 0;
                    bonds[key].atoms = [source(key), target(key)];
                    break;

                case 'branch':

                    // Key index
                    let keyIndex = keys.all.indexOf(key);

                    // Tokens before/after branch
                    let tokensBefore = keys.all.slice(0, keyIndex).reverse();
                    let tokensAfter = keys.all.slice(keyIndex+1, keys.all.length);

                    switch (bonds[key].value) {

                        // Start branch
                        case '(':

                            // Find start of branch
                            for (let j = 0, skip = 0; j < tokensBefore.length; j++) {

                                // Token ID
                                let tokenID = tokensBefore[j];

                                // Update bond
                                if (keys.atoms.indexOf(tokenID) !== -1 && skip === 0) {
                                    bonds[key].order = 1;
                                    bonds[key].atoms = [tokenID, target(key)];
                                    break;
                                }

                                // Check for bond
                                else if (keys.bonds.indexOf(tokenID) !== -1) {

                                    // Nested branch
                                    switch (bonds[tokenID].value) {
                                        case ')': skip++; break;
                                        case '(': skip--; break;
                                    }
                                }
                            }

                            break;

                        // End branch
                        case ')':

                            // Find start of branch
                            for (let j = 0, skip = 1; j < tokensBefore.length; j++) {

                                // Token ID
                                let tokenID = tokensBefore[j];

                                // Update bond
                                if (keys.atoms.indexOf(tokenID) !== -1 && skip === 0) {
                                    bonds[key].order = 1;
                                    bonds[key].atoms[0] = tokenID;
                                    break;
                                }

                                // Check for bond
                                else if (keys.bonds.indexOf(tokenID) !== -1) {

                                    // Nested branch
                                    switch (bonds[tokenID].value) {
                                        case ')': skip++; break;
                                        case '(': skip--; break;
                                    }
                                }
                            }

                            // Find end of branch
                            for (let j = 0, skip = 0; j < tokensAfter.length; j++) {

                                // Token ID
                                let tokenID = tokensAfter[j];

                                // Update bond
                                if (keys.atoms.indexOf(tokenID) !== -1 && skip === 0) {
                                    bonds[key].atoms[1] = tokenID;
                                    break;
                                }

                                // Check for bond
                                else if (keys.bonds.indexOf(tokenID) !== -1) {

                                    // Nested branch
                                    switch (bonds[tokenID].value) {
                                        case ')': skip--; break;
                                        case '(': skip++; break;
                                    }
                                }
                            }

                            break;
                    }

                    break;

                // Ring
                case 'ring':

                    // Extract bonds after key
                    let bondsAfter = keys.bonds.slice(keys.bonds.indexOf(key), keys.bonds.length);

                    // Find matching ring atom
                    for (let j = 0; j < bondsAfter.length; j++) {

                        // Check for existing bond
                        if (bonds[key].atoms.length > 0 || j === 0) { continue; }

                        // Bond ID
                        let bondID = bondsAfter[j];

                        // Ring ID
                        let ringID = /[0-9]+/g;

                        let a = bonds[key].value.match(ringID);
                        let b = bonds[bondID].value.match(ringID);

                        // Add ring bond
                        if (a !== null && b !== null && a[0] === b[0]) {

                            bonds[key].order = 1;
                            bonds[key].atoms = [key, bondID];

                            bonds[bondID].order = 1;
                            bonds[bondID].atoms = [key, bondID];

                            break;
                        }
                    }

                    break;
            }
        }

        // Remove duplicate bonds
        for (let i = 0; i < keys.bonds.length; i++) {

            // Extract bonds after index
            let bondsAfter = keys.bonds.slice(i, keys.bonds.length);

            // Check for duplicate bonds
            for (let j = 0; j < bondsAfter.length; j++) {

                // Bond ID
                let bondID = bondsAfter[j];

                // Bond keys
                let a = bonds[keys.bonds[i]];
                let b = bonds[bondID];

                // Check bond for atoms
                if (a === undefined || b === undefined || j === 0) { continue; }

                // Compare atom keys
                if (a.atoms[0] === b.atoms[0] && a.atoms[1] === b.atoms[1]) {

                    // Duplicate ring bond
                    if (a.name === 'ring' && b.name === 'ring') {
                        delete bonds[bondID];
                        delete keys.bonds[keys.bonds.indexOf(bondID)];
                    }

                    // Duplicate branching bonds
                    else if (a.name === 'branch' && (b.name === 'single' || b.name === 'double' || b.name === 'triple')) {
                        delete bonds[keys.bonds[i]];
                        delete keys.bonds[i];
                    }

                    else if ((a.name === 'single' || a.name === 'double' || a.name === 'triple') && b.name === 'branch') {
                        delete bonds[bondID];
                        delete keys.bonds[keys.bonds.indexOf(bondID)];
                    }

                    // Other duplicate bonds
                    else {
                        delete bonds[bondID];
                        delete keys.bonds[keys.bonds.indexOf(bondID)];
                    }

                    i--;
                    break;
                }
            }
        }

        // Remove empty references from keys
        for (let i = 0; i < keys.bonds.length; i++) {
            if (keys.bonds[i] === undefined) { keys.bonds.splice(i, 1); i--; }
        }

        // Add bond references to atom properties
        for (let i = 0; i < keys.bonds.length; i++) {

            // Bond ID
            let bondID = keys.bonds[i];

            // Atom keys
            let a = bonds[bondID].atoms[0];
            let b = bonds[bondID].atoms[1];

            // Add bond reference to atom
            atoms[a].bonds.atoms.push(bondID);
            atoms[b].bonds.atoms.push(bondID);

            // Update total bonding electrons
            atoms[a].bonds.electrons += bonds[bondID].order;
            atoms[b].bonds.electrons += bonds[bondID].order;
        }

        return [atoms, bonds, keys];
    }

    // Implicit bonds
    function implicitBonds (atoms, bonds, keys) {

        // Generate unique key
        let newKey = (a, b) => a + b;

        // Add bonds to nearest neighbor
        for (let i = 0; i < keys.atoms.length; i++) {

            // Check if last element in array
            if (keys.atoms.length === i + 1) { continue; }

            // Atom key
            let atomID = keys.atoms[i];

            // Check availability
            if (18 - atoms[atomID].group - atoms[atomID].bonds.electrons > 0) {

                // Locate next atom
                let source = keys.all[keys.all.indexOf(atomID)+1];
                let target = nextAtom(source, keys.all, atoms);

                // Recalculate if source is equal to target
                let counter = 2;

                while (source === target) {
                    source = keys.all[keys.all.indexOf(atomID) + counter];
                    target = nextAtom(source, keys.all, atoms);
                    counter += 1;
                }

                // Check if bond exists
                if (atoms[atomID].bonds.atoms.indexOf(target) !== -1) { continue; }

                // Determine tokens between atoms
                let d = keys.all.indexOf(target) - keys.all.indexOf(atomID);

                // Check for any branches
                if (d > 1) {

                    // Extract keys between atoms
                    let betweenAtoms = keys.all.slice(keys.all.indexOf(atomID)+1, keys.all.indexOf(target));

                    for (let j = 0; j < betweenAtoms.length; j++) {

                        // Key ID
                        let keyID = betweenAtoms[j];

                        // Check if key exists
                        let bondKey = keys.bonds.indexOf(keyID);
                        let atomKey = keys.atoms.indexOf(keyID);

                        // Check bond type
                        if (bondKey !== -1 && atomKey === -1) { break; }

                        // Assign key
                        let a = atomID + atoms[atomID].name;
                        let b = target + atoms[target].name;

                        let key = newKey(a, b);

                        // Update keys
                        keys.bonds.push(key);

                        // Update bonds
                        let bondName = atoms[atomID].name + atoms[target].name;

                        bonds[key] = addBond(key, 'single', bondName, 1, [atomID, target]);

                        // Update atoms
                        atoms[atomID].bonds.atoms.push(key);
                        atoms[target].bonds.atoms.push(key);

                        // Update total bonding electrons
                        atoms[atomID].bonds.electrons += 1;
                        atoms[target].bonds.electrons += 1;
                    }
                }

                else if (d === 1) {

                    // Assign key
                    let a = atomID + atoms[atomID].name;
                    let b = target + atoms[target].name;

                    let key = newKey(a, b);

                    // Update keys
                    keys.bonds.push(key);

                    // Add bond
                    let bondName = atoms[atomID].name + atoms[target].name;

                    bonds[key] = addBond(key, 'single', bondName, 1, [atomID, target]);

                    // Update atoms
                    atoms[atomID].bonds.atoms.push(key);
                    atoms[target].bonds.atoms.push(key);

                    // Update total bonding electrons
                    atoms[atomID].bonds.electrons += 1;
                    atoms[target].bonds.electrons += 1;
                }
            }
        }

        // Add implicit hydrogen
        let H = periodic_table.H;

        for (let i = 0; i < keys.atoms.length; i++) {

            // Atom details
            let atomID = keys.atoms[i];
            let atom = atoms[atomID];

            // Check atom group
            if (atom.group < 13) { continue; }

            // Determine number of hydrogen to add
            let total = 18 - atom.group - atom.bonds.electrons;

            // Adjust total hydrogen for charge
            let charge = atom.properties.charge;

            if (charge > 0) { total += -charge; }
            else if (charge < 0) { total += charge; }

            // Add hydrogens
            if (total <= 0) { continue; }

            for (let j = 0; j < total; j++) {

                // Assign key
                let key = atomID + atom.name + (j + 1) + 'H';

                // Add hydrogen bond
                bonds[key] = addBond(key, 'hydrogen', atom.name + 'H', 1, [atomID, key]);

                // Add hydrogen atom
                atoms[key] = addAtom(key, 'H', 'H', H.group, H.protons, H.neutrons, H.electrons);

                // Update hydrogen properties
                atoms[key].bonds.electrons = 1;
                atoms[key].bonds.atoms.push(key);

                // Update atom properties
                atoms[atomID].bonds.electrons += 1;
                atoms[atomID].bonds.atoms.push(key);
            }
        }

        return [atoms, bonds, keys];
    }

    // Variables
    let atoms, bonds, properties, keys;

    // 1. Validate
    if (!validateTokens(tokens)) { return false; }

    // 2. Categorize
    [atoms, bonds, properties, keys] = readTokens(tokens);

    // 3. Atoms
    atoms = defaultAtoms(atoms, keys);
    atoms = customAtoms(atoms, properties, keys);

    // 4. Bonds
    [atoms, bonds, keys] = explicitBonds(atoms, bonds, keys);
    [atoms, bonds, keys] = implicitBonds(atoms, bonds, keys);

    return [atoms, bonds];
}


/*
  Utility: compare
   -compare values of two arrays
*/

function compare(a, b) {

    let ab = [];

    // Return binary array
    for (let i = 0; i < a.length; i++) {
        ab[i] = b.indexOf(a[i]) > -1 ? 1 : 0;
    }

    return ab;
}


/*
  Utility: addAtom
   -return new atom
*/

function addAtom(id, name, value, group = 0, protons = 0, neutrons = 0, electrons = 0) {

    return {

        // Atom name
        id: id,
        name: name,
        value: value,

        // Atom propeties
        group: group,
        protons: protons,
        neutrons: neutrons,
        electrons: electrons,

        // Bond properties
        bonds: {
            electrons: 0,
            chiral: 0,
            atoms: []
        },

        // Other properties
        properties: {
            charge: 0
        }
    };
}


/*
  Utility: addBond
   -return new bond
*/

function addBond(id, name, value, order = 0, atoms = []) {

    return {

        //Bond name
        id: id,
        name: name,
        value: value,

        // Bond properties
        order: order,
        atoms: atoms
    };
}


/*
  Utility: nextAtom
   -find key of next atom in array
*/

function nextAtom(start, keys, atoms) {

    // Determine index of key in array
    let index = keys.indexOf(start);

    // Return if key not in array
    if (index === -1) { return []; }

    // Remove keys before index
    keys = keys.slice(index, keys.length);

    // Determine nearest atom to key
    for (let i = 0; i < keys.length; i++) {

        if (atoms[keys[i]] !== undefined) {
            return keys[i];
        }
    }
}


/*
  Utility: previousAtom
   -find key of previous atom in array
*/

function previousAtom(start, keys, atoms) {

    // Determine index of key in array
    let index = keys.indexOf(start);

    // Return if key not in array
    if (index === -1) { return []; }

    // Remove keys after index
    keys = keys.slice(0, index).reverse();

    // Determine nearest atom to key
    for (let i = 0; i < keys.length; i++) {

        if (atoms[keys[i]] !== undefined) {
            return keys[i];
        }
    }
}


/*
  Exports
*/

export { tokenize, decode };
