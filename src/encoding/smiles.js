/*
  smiles.js

    description : parse SMILES chemical line notation
    imports     : elements
    exports     : grammar, tokenize, decode

*/


/*
  Imports
*/

import periodic_table from './../reference/elements';


/*
  Variable: grammar
  --regular expressions for SMILES grammar

    type       : token category
    term       : SMILES symbol
    tag        : SMILES definition
    expression : regular expression
*/

var grammar = [
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
    {type: 'property', term: 'n',  tag: 'isotope', expression: /(?:[\[])[0-9]+[A-Z]{1,2}(?=.?[^\[]*[\]])/g},
    {type: 'property', term: '@',  tag: 'chiral',  expression: /[A-Z][a-z]?[@](?![A-Z]{2}[0-9]+|[@])/g},
    {type: 'property', term: '@@', tag: 'chiral',  expression: /[A-Z][a-z]?[@]{2}(?![A-Z]{2}[0-9]+)/g}
];


/*
  Method: tokenize
  --parse input string with SMILES grammar

  Syntax
    tokens = tokenize(input)

  Arguments
    input : any SMILES encoded string

  Output
    tokens : array of token objects

  Examples
    tokens123 = tokenize('CC(=O)CC')
    tokensABC = tokenize('c1cccc1')
*/

function tokenize(input, tokens = []) {

    // Parse input with SMILES grammar
    for (let i = 0; i < grammar.length; i++) {

        let token = grammar[i];
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
  Method: decode
  --convert SMILES tokens into atoms (nodes) and bonds (edges)

  Syntax
    [atoms, bonds] = decode(tokens)

  Arguments
    tokens : array of tokens obtained from the output of 'tokenize'

  Output
    [atoms, bonds] : array of atom/bond objects describing connectivity and properties

  Examples
    [atomsABC, bondsABC] = decode(mytokensABC)
    [atoms123, bonds123] = decode(tokens123)
*/

function decode(tokens) {

    function validateTokens(tokens) {

        if (typeof(tokens) !== 'object') { throw 'Error: Tokens must be of type "object"'; }

        // Check tokens for required fields
        let fields = ['index', 'type', 'term', 'tag'];

        for (let i = 0; i < tokens.length; i++) {

            // Return binary comparison array
            let match = compare(fields, Object.keys(tokens[i]));

            // Check for invalid token
            if (match.reduce((a, b) => a + b) < 4) { throw 'Error: Invalid token at index "' + i + '"'; }
        }

        return true;
    }

    function readTokens(tokens, atoms = {}, bonds = {}, properties = {}, keys = {}) {

        let newKey = (x) => x.toString();

        // Parse tokens by category
        for (let i = 0; i < tokens.length; i++) {

            // Extract token values
            let {type, term, tag, index} = tokens[i],
                key = newKey(index);

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

        if (atoms.length < 1) { return false; }

        // Extract all token keys
        keys.all = [];

        for (let i = 0; i < tokens.length; i++) {
            keys.all[i] = newKey(tokens[i].index);
        }

        // Extract token keys by category
        keys.atoms = Object.keys(atoms);
        keys.bonds = Object.keys(bonds);
        keys.properties = Object.keys(properties);

        return [atoms, bonds, properties, keys];
    }

    function defaultAtoms(atoms, keys) {

        for (let i = 0; i < keys.atoms.length; i++) {

            let atomID = keys.atoms[i];

            // Check element
            if (periodic_table[atoms[atomID].name] === undefined) { continue; }

            // Element information
            let element = periodic_table[atoms[atomID].name];

            // Element properties
            atoms[atomID].group = element.group;
            atoms[atomID].protons = element.protons;
            atoms[atomID].neutrons = element.neutrons;
            atoms[atomID].electrons = element.electrons;

            // Bond properties
            atoms[atomID].bonds = {
                electrons: 0,
                atoms: []
            };

            // Other properties
            atoms[atomID].properties = {
                chiral: 0,
                charge: 0
            };
        }

        return atoms;
    }

    function customAtoms(atoms, properties, keys) {

        for (let i = 0; i < keys.properties.length; i++) {

            let propID = keys.properties[i];

            // Retrieve properties
            let {name, value} = properties[propID];

            switch (name) {

                case 'chiral':

                    if (atoms[propID] !== undefined) {
                        atoms[propID].properties.chiral = value.slice(value.indexOf('@'));
                        break;
                    }

                    break;

                case 'isotope':

                    // Determine neutrons, atomID
                    let neutrons = value.match(/[0-9]+/g),
                        atomID = 1 + neutrons.toString().length;

                    // Check value
                    if (neutrons > 0 && neutrons < 250 && atoms[atomID] !== undefined) {

                        // Subtract number of protons
                        neutrons = neutrons - atoms[atomID].protons;

                        if (neutrons > 0) {
                            atoms[atomID].neutrons = neutrons;
                            break;
                        }
                    }

                    break;

                case 'charge':

                    // Determine charge sign
                    let sign = value.indexOf('+') !== -1 ? 1 : -1;

                    // Check numeric charge (e.g. '3+')
                    let charge = value.match(/[0-9]+/g);

                    if (charge !== null && atoms[propID] !== undefined) {
                        atoms[propID].properties.charge = charge[0] * sign;
                        break;
                    }

                    // Check symbolic charge (e.g. '+++')
                    charge = value.match(/([+]+|[-]+)/g);

                    if (charge !== null && atoms[propID] !== undefined) {
                        atoms[propID].properties.charge = charge[0].length * sign;
                        break;
                    }

                    break;
            }
        }

        return atoms;
    }

    function explicitBonds(atoms, bonds, keys) {

        if (keys.bonds.length === 0) { return [atoms, bonds, keys]; }

        // Add bonds
        for (let i = 0; i < keys.bonds.length; i++) {

            // Retrieve bond key
            let bondID = keys.bonds[i];

            // Retrieve source/target atoms
            let sourceAtom = atoms[previousAtom(bondID, keys.all, atoms)],
                targetAtom = atoms[nextAtom(bondID, keys.all, atoms)];

            // Determine index values
            let bondIndex = keys.all.indexOf(bondID),
                sourceIndex = 0,
                targetIndex = 0;

            if (sourceAtom !== undefined && sourceAtom !== null) {
                sourceIndex = keys.all.indexOf(sourceAtom.id);
            }
            if (targetAtom !== undefined && targetAtom !== null) {
                targetIndex = keys.all.indexOf(targetAtom.id);
            }

            // Check for exceptions
            let exceptions = 0;

            if (targetIndex > bondIndex && bondIndex > sourceIndex) {

                // Check previous bond
                if (bonds[keys.all[bondIndex - 1]] !== undefined) {

                    let bond1 = bonds[keys.all[bondIndex - 1]].value,
                        bond2 = bonds[bondID].value;

                    // Exception #1: bond symbol follows branch end
                    if (bond1 === ')' && (bond2 === '-' || bond2 === '=' || bond2 === '#' || bond2 === '.')) {
                        exceptions = 1;
                    }
                }
            }

            // Bond type
            switch (bonds[bondID].name) {

                case 'single':
                    if (exceptions === 1) { continue; }
                    bonds[bondID].order = 1;
                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                    break;

                case 'double':
                    if (exceptions === 1) { continue; }
                    bonds[bondID].order = 2;
                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                    break;

                case 'triple':
                    if (exceptions === 1) { continue; }
                    bonds[bondID].order = 3;
                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                    break;

                case 'dot':
                    if (exceptions === 1) { continue; }
                    bonds[bondID].order = 0;
                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                    break;

                case 'branch':

                    // Keys before/after branch
                    let keysBefore = keys.all.slice(0, bondIndex).reverse(),
                        keysAfter = keys.all.slice(bondIndex+1, keys.all.length);

                    // Branch type
                    switch (bonds[bondID].value) {

                        // Start branch
                        case '(':

                            // Find start of branch
                            for (let j = 0, skip = 0; j < keysBefore.length; j++) {

                                // Determine source atom
                                sourceAtom = atoms[keysBefore[j]];

                                // Update bond
                                if (sourceAtom !== undefined && skip === 0) {
                                    bonds[bondID].order = 1;
                                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                                    break;
                                }

                                // Check for nested branch
                                else if (bonds[keysBefore[j]] !== undefined) {
                                    switch (bonds[keysBefore[j]].value) {
                                        case ')': skip++; break;
                                        case '(': skip--; break;
                                    }
                                }
                            }

                            break;

                        // End branch
                        case ')':

                            // Find start of branch
                            for (let j = 0, skip = 1; j < keysBefore.length; j++) {

                                // Retrieve source atom
                                sourceAtom = atoms[keysBefore[j]];

                                // Update bond
                                if (sourceAtom !== undefined && skip === 0) {
                                    bonds[bondID].order = 1;
                                    bonds[bondID].atoms[0] = sourceAtom.id;
                                    break;
                                }

                                // Check for nested branch
                                else if (bonds[keysBefore[j]] !== undefined) {
                                    switch (bonds[keysBefore[j]].value) {
                                        case ')': skip++; break;
                                        case '(': skip--; break;
                                    }
                                }
                            }

                            // Find end of branch
                            for (let j = 0, bondOrder = 1, skip = 0; j < keysAfter.length; j++) {

                                // Update bond order
                                if (bonds[keysAfter[j]] !== undefined && skip === 0) {

                                    switch (bonds[keysAfter[j]].value) {
                                        case '-': bondOrder = 1; break;
                                        case '=': bondOrder = 2; break;
                                        case '#': bondOrder = 3; break;
                                        case '.': bondOrder = 0; break;
                                    }
                                }

                                // Update bond
                                if (atoms[keysAfter[j]] !== undefined && skip === 0) {
                                    bonds[bondID].order = bondOrder;
                                    bonds[bondID].atoms[1] = atoms[keysAfter[j]].id;
                                    break;
                                }

                                // Check for nested branch
                                else if (bonds[keysAfter[j]] !== undefined) {
                                    switch (bonds[keysAfter[j]].value) {
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

                    // Keys after ring
                    let bondsAfter = keys.bonds.slice(keys.bonds.indexOf(bondID), keys.bonds.length);

                    // Find matching ring atom
                    for (let j = 0; j < bondsAfter.length; j++) {

                        if (bonds[bondID].atoms.length > 0 || j === 0) { continue; }

                        // Determine ring number
                        let ringID = /[0-9]+/g;

                        let sourceBond = bonds[bondID].value.match(ringID);
                        let targetBond = bonds[bondsAfter[j]].value.match(ringID);

                        // Add bond
                        if (sourceBond !== null && targetBond !== null && sourceBond[0] === targetBond[0]) {

                            bonds[bondID].order = 1;
                            bonds[bondID].atoms = [bondID, bondsAfter[j]];
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

                // Bond keys
                let bondID = bondsAfter[j],
                    a = bonds[keys.bonds[i]],
                    b = bonds[bondID];

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

            if (keys.bonds[i] === undefined) {
                keys.bonds.splice(i, 1);
                i--;
            }
        }

        // Add bond references to all atoms
        for (let i = 0; i < keys.bonds.length; i++) {

            // Bond key
            let bondID = keys.bonds[i];

            // Atom keys
            let sourceID = bonds[bondID].atoms[0],
                targetID = bonds[bondID].atoms[1];

            if (sourceID === undefined || targetID === undefined) { continue; }

            // Add bond reference to atom
            atoms[sourceID].bonds.atoms.push(targetID);
            atoms[targetID].bonds.atoms.push(sourceID);

            atoms[sourceID].bonds.electrons += bonds[bondID].order;
            atoms[targetID].bonds.electrons += bonds[bondID].order;
        }

        return [atoms, bonds, keys];
    }

    function implicitBonds (atoms, bonds, keys) {

        // Add bonds between adjacent atoms
        for (let i = 0; i < keys.atoms.length; i++) {

            // Check conditions to proceed
            if (keys.atoms.length === i + 1) { continue; }

            // Retrieve atoms
            let sourceAtom = atoms[keys.atoms[i]],
                targetAtom = atoms[keys.atoms[i+1]];

            // Determine electrons available
            let sourceElectrons = 18,
                targetElectrons = 18;

            // Check for hydrogen
            if (sourceAtom.group === 1) {
                sourceElectrons = 2;
            }
            if (targetAtom.group === 1) {
                targetElectrons = 2;
            }

            let sourceTotal = sourceElectrons - sourceAtom.group - sourceAtom.bonds.electrons,
                targetTotal = targetElectrons - targetAtom.group - targetAtom.bonds.electrons;

            // Account for atom charge
            if (sourceAtom.properties.charge > 0) {
                sourceTotal -= sourceAtom.properties.charge;
            }
            if (targetAtom.properties.charge > 0) {
                targetTotal -= targetAtom.properties.charge;
            }
            if (sourceTotal <= 0 || targetTotal <= 0) { continue; }

            // Check if bond exists
            if (sourceAtom.bonds.atoms.indexOf(targetAtom.id) !== -1) { continue; }

            // Determine number of tokens between source/target atoms
            let n = keys.all.indexOf(targetAtom.id) - keys.all.indexOf(sourceAtom.id),
                exceptions = 0;

            // Check tokens preventing implicit bond
            if (n > 1) {

                // Extract all keys between source/target atoms
                let keysBetween = keys.all.slice(keys.all.indexOf(sourceAtom.id) + 1, keys.all.indexOf(targetAtom.id));

                for (let j = 0; j < keysBetween.length; j++) {

                    // Check for bond symbol
                    if (bonds[keysBetween[j]] !== undefined) {
                        if (bonds[keysBetween[j]].name !== 'ring') {
                            exceptions = 1;
                        }
                    }
                }
            }

            if (exceptions === 0) {

                // Assign new bond key
                let bondID = (sourceAtom.name + sourceAtom.id) + (targetAtom.name + targetAtom.id),
                    bondName = sourceAtom.name + targetAtom.name;

                // Update bonds
                keys.bonds.push(bondID);
                bonds[bondID] = addBond(bondID, 'single', bondName, 1, [sourceAtom.id, targetAtom.id]);

                // Update atoms
                atoms[sourceAtom.id].bonds.atoms.push(targetAtom.id);
                atoms[targetAtom.id].bonds.atoms.push(sourceAtom.id);

                atoms[sourceAtom.id].bonds.electrons += 1;
                atoms[targetAtom.id].bonds.electrons += 1;
            }
        }

        // Add implicit hydrogen
        let H = periodic_table.H;

        for (let i = 0; i < keys.atoms.length; i++) {

            // Retrieve atoms
            let sourceAtom = atoms[keys.atoms[i]];

            // Check atom group
            if (sourceAtom.group < 13) { continue; }

            // Determine number of hydrogen to add
            let sourceTotal = 18 - sourceAtom.group - sourceAtom.bonds.electrons;

            // Account for atom charge
            if (sourceAtom.properties.charge > 0) {
                sourceTotal -= sourceAtom.properties.charge;
            }
            if (sourceTotal <= 0) { continue; }

            // Add hydrogen
            for (let j = 0; j < sourceTotal; j++) {

                // Assign bond key
                let bondID = 'H' + (j + 1) + sourceAtom.name + sourceAtom.id,
                    bondName = sourceAtom.name + 'H',
                    atomName = sourceAtom.name + 'H';

                // Add hydrogen atom/bond
                atoms[bondID] = addAtom(bondID, 'H', 'H', H.group, H.protons, H.neutrons, H.electrons);
                bonds[bondID] = addBond(bondID, 'hydrogen', bondName, 1, [sourceAtom.id, bondID]);

                // Update atoms
                atoms[sourceAtom.id].bonds.atoms.push(bondID);
                atoms[bondID].bonds.atoms.push(sourceAtom.id);

                atoms[sourceAtom.id].bonds.electrons += 1;
                atoms[bondID].bonds.electrons += 1;
            }
        }

        return [atoms, bonds, keys];
    }

    let atoms, bonds, properties, keys;

    // 1. Validate tokens
    if (!validateTokens(tokens)) { return false; }

    // 2. Categorize tokens
    [atoms, bonds, properties, keys] = readTokens(tokens);

    // 3. Add atoms
    atoms = defaultAtoms(atoms, keys);
    atoms = customAtoms(atoms, properties, keys);

    // 4. Add bonds
    [atoms, bonds, keys] = explicitBonds(atoms, bonds, keys);
    [atoms, bonds, keys] = implicitBonds(atoms, bonds, keys);

    return [atoms, bonds];
}


/*
  Utility: compare
  --compare values across two arrays
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
  --return new atom
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
            atoms: []
        },

        // Other properties
        properties: {
            chiral: 0,
            charge: 0
        }
    };
}


/*
  Utility: addBond
  --return new bond
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
  --find key of next atom in array
*/

function nextAtom(start, keys, atoms) {

    // Determine index of key in array
    let index = keys.indexOf(start);
    if (index === -1) { return null; }

    // Remove keys before index
    keys = keys.slice(index, keys.length);

    // Determine nearest atom to key
    for (let i = 1; i < keys.length; i++) {

        if (atoms[keys[i]] !== undefined) {
            return keys[i];
        }
    }

    return null;
}


/*
  Utility: previousAtom
  --find key of previous atom in array
*/

function previousAtom(start, keys, atoms) {

    if (start === '0' && atoms['0'] !== undefined) { return '0'; }

    // Determine index of key in array
    let index = keys.indexOf(start);
    if (index === -1) { return null; }

    // Remove keys after index
    keys = keys.slice(0, index).reverse();

    // Determine nearest atom to key
    for (let i = 0; i < keys.length; i++) {

        if (atoms[keys[i]] !== undefined) {
            return keys[i];
        }
    }

    return null;
}


/*
  Exports
*/

export { tokenize, decode, grammar };
