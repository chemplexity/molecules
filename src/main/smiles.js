/**
 * File        : smiles.js
 * Description : parse SMILES chemical line notation
 *
 * Options     : grammar, tokenize, decode
 */

import elements from './../utilities/reference';


/**
 * Name        : grammar
 * Description : regular expressions for parsing SMILES string
 *
 * Properties
 *   type       : token category
 *   term       : SMILES symbol
 *   tag        : token definition
 *   expression : SMILES regular expression
 */

const grammar = [
    {type: 'atom',     term: 'H',  tag: 'H',       expression: /(?=[A-Z])H(?=[^efgos]|$)([0-9]?)+/g},
    {type: 'atom',     term: 'D',  tag: 'H',       expression: /(?=[A-Z])D(?=[^bsy]|$)([0-9]?)+/g},
    {type: 'atom',     term: 'He', tag: 'He',      expression: /He/g},
    {type: 'atom',     term: 'Li', tag: 'Li',      expression: /Li/g},
    {type: 'atom',     term: 'Be', tag: 'Be',      expression: /Be/g},
    {type: 'atom',     term: 'B',  tag: 'B',       expression: /B(?=[^aehikr]|$)/g},
    {type: 'atom',     term: 'C',  tag: 'C',       expression: /C(?=[^adeflmnorsu]|$)/g},
    {type: 'atom',     term: 'N',  tag: 'N',       expression: /N(?=[^abdeiop]|$)/g},
    {type: 'atom',     term: 'O',  tag: 'O',       expression: /O(?=[^s]|$)/g},
    {type: 'atom',     term: 'F',  tag: 'F',       expression: /F(?=[^elmr]|$)/g},
    {type: 'atom',     term: 'Ne', tag: 'Ne',      expression: /Ne/g},
    {type: 'atom',     term: 'Na', tag: 'Na',      expression: /Na/g},
    {type: 'atom',     term: 'Mg', tag: 'Mg',      expression: /Mg/g},
    {type: 'atom',     term: 'Al', tag: 'Al',      expression: /Al/g},
    {type: 'atom',     term: 'Si', tag: 'Si',      expression: /Si/g},
    {type: 'atom',     term: 'P',  tag: 'P',       expression: /P(?=[^abdmortu]|$)/g},
    {type: 'atom',     term: 'S',  tag: 'S',       expression: /S(?=[^bcegimnr]|$)/g},
    {type: 'atom',     term: 'Cl', tag: 'Cl',      expression: /Cl/g},
    {type: 'atom',     term: 'Ar', tag: 'Ar',      expression: /Ar/g},
    {type: 'atom',     term: 'As', tag: 'As',      expression: /As/g},
    {type: 'atom',     term: 'Se', tag: 'Se',      expression: /Se/g},
    {type: 'atom',     term: 'Br', tag: 'Br',      expression: /Br/g},
    {type: 'atom',     term: 'I',  tag: 'I',       expression: /I(?=[^nr]|$)/g},
    //{type: 'atom',     term: '*',  tag: '*',       expression: /[*]/g},
    {type: 'atom',     term: 'b',  tag: 'B',       expression: /b(?=[^e]|$)/g},
    {type: 'atom',     term: 'c',  tag: 'C',       expression: /c(?=[^l]|$)/g},
    {type: 'atom',     term: 'n',  tag: 'N',       expression: /n(?=[^ae]|$)/g},
    {type: 'atom',     term: 'o',  tag: 'O',       expression: /o(?=[^s]|$)/g},
    {type: 'atom',     term: 'p',  tag: 'P',       expression: /p/g},
    {type: 'atom',     term: 's',  tag: 'S',       expression: /s(?=[^ei]|$)/g},
    {type: 'atom',     term: 'se', tag: 'Se',      expression: /se/g},
    {type: 'bond',     term: '-',  tag: 'single',  expression: /(?=([^0-9]))[-](?=[^0-9-\]])/g},
    {type: 'bond',     term: '=',  tag: 'double',  expression: /[=]/g},
    {type: 'bond',     term: '#',  tag: 'triple',  expression: /[#]/g},
    {type: 'bond',     term: '(',  tag: 'branch',  expression: /[(]/g},
    {type: 'bond',     term: ')',  tag: 'branch',  expression: /[)]/g},
    {type: 'bond',     term: '%',  tag: 'ring',    expression: /(?=[^+-])(?:[a-zA-Z]{1,2}[@]{1,2})?(?:[a-zA-Z]|[a-zA-Z]*.?[\]])[%]?\d+(?=([^+]|$))/g},
    {type: 'bond',     term: '.',  tag: 'dot',     expression: /(?:[A-Z][+-]?[\[])?[.]/g},
    {type: 'property', term: '+',  tag: 'charge',  expression: /[a-zA-Z]{1,2}[0-9]*[+]+[0-9]*(?=[\]])/g},
    {type: 'property', term: '-',  tag: 'charge',  expression: /[a-zA-Z]{1,2}[0-9]*[-]+[0-9]*(?=[\]])/g},
    {type: 'property', term: 'n',  tag: 'isotope', expression: /(?:[\[])[0-9]+[A-Z]{1,2}(?=.?[^\[]*[\]])/g},
    {type: 'property', term: 'S',  tag: 'chiral',  expression: /[A-Z][a-z]?[@](?![A-Z]{2}[0-9]+|[@])/g},
    {type: 'property', term: 'R',  tag: 'chiral',  expression: /[A-Z][a-z]?[@]{2}(?![A-Z]{2}[0-9]+)/g}
];

/**
 * Method      : tokenize(input)
 * Description : parse string with SMILES grammar
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

    // Check tokens for exceptions
    for (let i = 0; i < tokens.length; i++) {

        // Check for multi-digit ring number
        if (tokens[i].tag === 'ring') {

            // Get ring number
            let ringID = tokens[i].term.match(/[0-9]+/g);

            // Limit to first match
            if (ringID !== null) { ringID = ringID[0]; }
            else { continue; }

            // Confirm ring number is valid
            if (ringID.length > 1) {

                let exception = 0;

                // Check tokens for matching ring number
                for (let j = 0; j < tokens.length; j++) {

                    if (i === j || tokens[j].tag !== 'ring') { continue; }

                    // Get ring number
                    let checkID = tokens[j].term.match(/[0-9]+/g);

                    if (checkID !== null) { checkID = checkID[0]; }
                    else { continue; }

                    // Compare ring numbers
                    if (ringID === checkID) {
                        exception = 1;
                        break;
                    }
                }

                // Matching ring number found
                if (exception === 1) { continue; }

                // Get ring prefix
                let prefix = tokens[i].term.match(/[a-zA-Z]/g)[0];

                // Parse multi-digit ring number
                for (let j = 0; j < ringID.length; j++) {

                    // Create new tokens
                    tokens.splice(i+1, 0, {
                        index: tokens[i].index + j,
                        type:  tokens[i].type,
                        term:  prefix + ringID.substr(j, j+1),
                        tag:   tokens[i].tag
                    });
                }

                // Remove original token
                tokens.splice(i, 1);
            }
        }
    }

    return { tokens: tokens };
}

/**
 * Method      : decode(tokens)
 * Description : convert SMILES tokens into atoms (nodes) and bonds (edges)
 */

function decode(tokens) {

    function validateTokens(tokens) {

        // Check input type
        if (typeof(tokens) !== 'object') {
            console.log('Error: Tokens must be of type "object"');
            return false;
        }

        else if (tokens.tokens !== undefined) {
            tokens = tokens.tokens;
        }

        // Check tokens for required fields
        let fields = ['index', 'type', 'term', 'tag'];

        for (let i = 0; i < tokens.length; i++) {

            // Compare fields
            let match = compareArrays(fields, Object.keys(tokens[i]));

            // Check for invalid tokens
            if (match.reduce((a, b) => a + b) < 4) {
                console.log('Error: Invalid token at index "' + i + '"');
                return false;
            }
        }

        return tokens;
    }

    function readTokens(tokens, atoms = {}, bonds = {}, properties = {}, keys = {}) {

        // Parse tokens by category
        for (let i = 0; i < tokens.length; i++) {

            // Get token info
            let {type, term, tag, index} = tokens[i];

            // Use token index as key
            let key = index.toString();

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

        // Extract token keys
        keys.all = [];

        for (let i = 0; i < tokens.length; i++) {
            keys.all[i] = tokens[i].index.toString();
        }

        // Check number of atoms
        if (atoms.length < 1) {
            console.log('Error: Could not find atoms');
            return false;
        }

        // Get token keys by category
        keys.atoms = Object.keys(atoms);
        keys.bonds = Object.keys(bonds);
        keys.properties = Object.keys(properties);

        return [atoms, bonds, properties, keys];
    }

    function defaultAtoms(atoms, keys) {

        for (let i = 0; i < keys.atoms.length; i++) {

            let atomID = keys.atoms[i];

            // Check element
            if (elements[atoms[atomID].name] === undefined) { continue; }

            // Element information
            let element = elements[atoms[atomID].name];

            // Exception: 'deuterium'
            if (atoms[atomID].value === 'D') {
                element = elements[atoms[atomID].value];
            }

            // Element properties
            atoms[atomID].group = element.group;
            atoms[atomID].protons = element.protons;
            atoms[atomID].neutrons = element.neutrons;
            atoms[atomID].electrons = element.electrons;

            // Bond properties
            atoms[atomID].bonds = {
                id: [],
                atoms: [],
                electrons: 0
            };

            // Other properties
            atoms[atomID].properties = {
                chiral: 0,
                charge: 0,
                aromatic: 0
            };

            // Check aromatic
            if (atoms[atomID].value === atoms[atomID].value.toLowerCase()) {
                atoms[atomID].properties.aromatic = 1;
            }
        }

        return atoms;
    }

    function updateAtoms(atoms, properties, keys) {

        for (let i = 0; i < keys.properties.length; i++) {

            let propertyID = keys.properties[i];

            // Get properties
            let {name, value} = properties[propertyID];

            // Update atom properties
            switch (name) {

                case 'chiral':

                    if (atoms[propertyID] !== undefined) {

                        // Update chiral property
                        atoms[propertyID].properties.chiral = value.slice(value.indexOf('@'));
                        break;
                    }

                    break;

                case 'isotope':

                    // Get isotope number and id
                    let isotope = value.match(/[0-9]+/g);
                    let atomID = 1 + isotope.toString().length + parseInt(propertyID);

                    // Check value
                    if (isotope >= 0 && isotope < 250 && atoms[atomID] !== undefined) {

                        // Subtract protons from isotope number
                        let neutrons = isotope - atoms[atomID].protons;

                        if (neutrons >= 0) {
                            atoms[atomID].neutrons = neutrons;
                            break;
                        }
                    }

                    break;

                case 'charge':

                    // Charge type (positive/negative)
                    let sign = value.indexOf('+') !== -1 ? 1 : -1;

                    // Check for numeric charge (e.g. '3+')
                    let charge = value.match(/(?:[^H])[0-9]+/g);

                    if (charge !== null && atoms[propertyID] !== undefined) {

                        // Update charge
                        charge  = charge[0].substr(1);
                        atoms[propertyID].properties.charge = charge * sign;
                        break;
                    }

                    // Check for symbolic charge (e.g. '+++')
                    charge = value.match(/([+]+|[-]+)/g);

                    if (charge !== null && atoms[propertyID] !== undefined) {

                        // Update charge
                        atoms[propertyID].properties.charge = charge[0].length * sign;
                        break;
                    }

                    break;
            }
        }

        return atoms;
    }

    function explicitBonds(atoms, bonds, keys) {

        if (keys.bonds.length === 0 || keys.bonds === undefined) {
            return [atoms, bonds, keys];
        }

        // Add bonds
        for (let i = 0; i < keys.bonds.length; i++) {

            // Get bond key
            let bondID = keys.bonds[i];

            // Get source/target atoms
            let sourceAtom = atoms[previousAtom(bondID, keys.all, atoms)];
            let targetAtom = atoms[nextAtom(bondID, keys.all, atoms)];

            // Get bond index
            let bondIndex = keys.all.indexOf(bondID);
            let sourceIndex = 0;
            let targetIndex = 0;

            // Validate source atom
            if (sourceAtom !== undefined && sourceAtom !== null) {

                // Get source index
                sourceIndex = keys.atoms.indexOf(sourceAtom.id);

                // Check source atom for hydrogen
                if ((bonds[bondID].name === 'double' || bonds[bondID].name === 'triple') && sourceAtom.name === 'H') {

                    // Change source atom to nearest non-hydrogen atom
                    while ((sourceAtom.name === 'H' || atoms[keys.atoms[sourceIndex]] === undefined) && sourceIndex > -1) {
                        sourceAtom = atoms[keys.atoms[sourceIndex]];
                        sourceIndex -= 1;
                    }
                }

                // Update source index
                sourceIndex = keys.all.indexOf(sourceAtom.id);
            }

            if (sourceIndex < 0) { continue; }

            // Get target index
            if (targetAtom !== undefined && targetAtom !== null) {
                targetIndex = keys.all.indexOf(targetAtom.id);
            }

            // Check for exceptions
            let exceptions = 0;

            if (targetIndex > bondIndex && bondIndex > sourceIndex) {

                // Check previous bond
                if (bonds[keys.all[bondIndex - 1]] !== undefined) {

                    let bond1 = bonds[keys.all[bondIndex - 1]].value;
                    let bond2 = bonds[bondID].value;

                    // Case: bond declared next to branch (e.g. 'CC(CC)=CC' or 'CC(=CC)CC')
                    switch (bond1) {
                        case ')':
                        case '(':

                            switch (bond2) {
                                case '-':
                                case '=':
                                case '#':
                                case '.':

                                    exceptions = 1;
                            }
                    }

                    //if ((bond1 === ')' || bond1 === '(') && (bond2 === '-' || bond2 === '=' || bond2 === '#' || bond2 === '.')) {
                    //    exceptions = 1;
                    //}
                }
            }

            // Bond type
            switch (bonds[bondID].name) {

                case 'single':
                    if (exceptions === 1 || sourceAtom === undefined || targetAtom === undefined) { continue; }
                    bonds[bondID].order = 1;
                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                    break;

                case 'double':
                    if (exceptions === 1 || sourceAtom === undefined || targetAtom === undefined) { continue; }
                    else if (targetAtom.name === 'H') { continue; }

                    bonds[bondID].order = 2;
                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                    break;

                case 'triple':
                    if (exceptions === 1 || sourceAtom === undefined || targetAtom === undefined) { continue; }
                    else if (targetAtom.name === 'H') { continue; }

                    bonds[bondID].order = 3;
                    bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
                    break;

                case 'dot':
                    if (exceptions === 1 || sourceAtom === undefined || targetAtom === undefined) { continue; }
                    bonds[bondID].order = 0;
                    //bonds[bondID].atoms = [sourceAtom.id, targetAtom.id];
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
                                if (sourceAtom !== undefined && sourceAtom.name !== 'H' && skip === 0) {

                                    // Default bond properties
                                    let bondOrder = 1;

                                    // Check aromatic ring
                                    if (sourceAtom.properties.aromatic === 1 && targetAtom.properties.aromatic === 1) {
                                        bondOrder = 1.5;
                                    }

                                    bonds[bondID].order = bondOrder;
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

                            // Find target atom
                            for (let j = 0, bondOrder = bonds[bondID].order, skip = 0; j < keysAfter.length; j++) {

                                // Update bond order
                                if (bonds[keysAfter[j]] !== undefined && skip === 0) {

                                    switch (bonds[keysAfter[j]].value) {
                                        case '-': bondOrder = 1; break;
                                        case '=': bondOrder = 2; break;
                                        case '#': bondOrder = 3; break;
                                        case '.': bondOrder = 0; break;
                                    }
                                }

                                // Update bond order
                                if (skip === 0) {
                                    bonds[bondID].order = bondOrder;
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

                        // End branch
                        case ')':

                            // Find start of branch
                            for (let j = 0, skip = 1; j < keysBefore.length; j++) {

                                // Retrieve source atom
                                sourceAtom = atoms[keysBefore[j]];

                                // Update bond
                                if (sourceAtom !== undefined && sourceAtom.name !== 'H' && skip === 0) {

                                    // Default bond properties
                                    let bondOrder = 1;

                                    // Check aromatic ring
                                    if (sourceAtom.properties.aromatic === 1) {
                                        bondOrder = 1.5;
                                    }

                                    bonds[bondID].order = bondOrder;
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
                            for (let j = 0, bondOrder = bonds[bondID].order, skip = 0; j < keysAfter.length; j++) {

                                // Retrieve target atom
                                targetAtom = atoms[keysAfter[j]];

                                // Update bond
                                if (bonds[keysAfter[j]] !== undefined && skip === 0) {

                                    switch (bonds[keysAfter[j]].value) {
                                        case '-': bondOrder = 1; break;
                                        case '=': bondOrder = 2; break;
                                        case '#': bondOrder = 3; break;
                                        case '.': bondOrder = 0; break;
                                    }
                                }

                                // Update bond
                                if (targetAtom !== undefined && skip === 0) {

                                    // Check aromatic ring
                                    if (targetAtom.properties.aromatic === 1) {
                                        bondOrder = 1.5;
                                    }

                                    bonds[bondID].order = bondOrder;
                                    bonds[bondID].atoms[1] = targetAtom.id;
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

                case 'ring':

                    let sourceID = bonds[bondID].value.match(/[0-9]+/g);

                    // Keys before/after ring token
                    let bondsBefore = keys.bonds.slice(0, keys.bonds.indexOf(bondID)),
                        bondsAfter = keys.bonds.slice(keys.bonds.indexOf(bondID), keys.bonds.length);

                    // Check keys after ring token
                    for (let j = 1; j < bondsAfter.length; j++) {

                        if (bonds[bondsAfter[j]].name !== 'ring') { continue; }

                        let targetID = bonds[bondsAfter[j]].value.match(/[0-9]+/g),
                            targetIndex = bondsAfter[j],
                            sourceIndex = bondID;

                        if (sourceID !== null && targetID !== null && sourceID[0] === targetID[0]) {

                            while (atoms[sourceIndex] === undefined && sourceIndex >= -1) { sourceIndex -= 1; }
                            while (atoms[targetIndex] === undefined && targetIndex >= -1) { targetIndex -= 1; }

                            if (sourceIndex === -1 || targetIndex === -1) { break; }

                            // Update bond
                            let bondOrder = 1;

                            // Check aromatic
                            if (atoms[sourceIndex].properties.aromatic === 1 && atoms[targetIndex].properties.aromatic === 1) {
                                bondOrder = 1.5;
                            }

                            bonds[bondID].order = bondOrder;
                            bonds[bondID].atoms = [sourceIndex.toString(), targetIndex.toString()];

                            break;
                        }

                        // Check keys before ring token
                        if (j === bondsAfter.length - 1) {

                            // Find matching ring atom
                            for (let k = 0; k < bondsBefore.length; k++) {

                                if (bonds[bondsAfter[j]].name !== 'ring') { continue; }

                                let targetID = bonds[bondsBefore[k]].value.match(/[0-9]+/g),
                                    targetIndex = bondID,
                                    sourceIndex = bondsBefore[k];

                                if (sourceID !== null && targetID !== null && sourceID[0] === targetID[0]) {

                                    // Determine atom index
                                    while (atoms[sourceIndex] === undefined && sourceIndex >= -1) { sourceIndex -= 1; }
                                    while (atoms[targetIndex] === undefined && targetIndex >= -1) { targetIndex -= 1; }

                                    if (sourceIndex === -1 || targetIndex === -1) { break; }

                                    // Update bond
                                    let bondOrder = 1;

                                    // Check aromatic
                                    if (atoms[sourceIndex].properties.aromatic === 1 && atoms[targetIndex].properties.aromatic === 1) {
                                        bondOrder = 1.5;
                                    }

                                    bonds[bondID].order = bondOrder;
                                    bonds[bondID].atoms = [sourceIndex.toString(), targetIndex.toString()];

                                    break;
                                }
                            }
                        }
                    }

                    break;
            }
        }

        // Remove duplicate bonds
        for (let i = 0; i < keys.bonds.length; i++) {

            // Check for empty key
            if (keys.bonds[i] === undefined) {
                keys.bonds.splice(i, 1);
                i--;
                continue;
            }

            // Check for empty bond
            if (bonds[keys.bonds[i]].atoms.length !== 2) {
                delete bonds[keys.bonds[i]];
                keys.bonds.splice(i, 1);
                i--;
                continue;
            }

            if (i === keys.bonds.length - 1) {
                continue;
            }

            // Extract bonds after index
            let bondsAfter = keys.bonds.slice(i, keys.bonds.length);

            // Check for duplicate/empty bonds
            for (let j = 0; j < bondsAfter.length; j++) {

                if (j === 0) { continue; }

                // Bond keys
                let bondID = bondsAfter[j],
                    a = bonds[keys.bonds[i]],
                    b = bonds[bondID];

                if (a === undefined || b === undefined) { continue; }

                // Compare atom keys
                if ((a.atoms[0] === b.atoms[0] && a.atoms[1] === b.atoms[1]) ||
                    (a.atoms[0] === b.atoms[1] && a.atoms[1] === b.atoms[0])) {

                    // Duplicate ring bond
                    if (a.name === 'ring' && b.name === 'ring') {
                        delete bonds[bondID];
                        keys.bonds.splice(keys.bonds.indexOf(bondID), 1);
                    }

                    // Duplicate branching bonds
                    else if (a.name === 'branch' && (b.name === 'single' || b.name === 'double' || b.name === 'triple')) {
                        delete bonds[keys.bonds[i]];
                        keys.bonds.splice(i, 1);
                    }

                    else if ((a.name === 'single' || a.name === 'double' || a.name === 'triple') && b.name === 'branch') {
                        delete bonds[bondID];
                        keys.bonds.splice(keys.bonds.indexOf(bondID), 1);
                    }

                    // Other duplicate bonds
                    else {
                        delete bonds[keys.bonds[i]];
                        keys.bonds.splice(i, 1);
                    }

                    i--;
                    break;
                }
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
            atoms[sourceID].bonds.id.push(bondID);
            atoms[targetID].bonds.id.push(bondID);

            atoms[sourceID].bonds.atoms.push(targetID);
            atoms[targetID].bonds.atoms.push(sourceID);

            atoms[sourceID].bonds.electrons += bonds[bondID].order;
            atoms[targetID].bonds.electrons += bonds[bondID].order;
        }

        return [atoms, bonds, keys];
    }

    function implicitBonds (atoms, bonds, keys) {

        // Calculate valence electrons
        let valence = (group, electrons = 18) => {
            if (group <= 2) { return 2; }
            else if (group > 2 && group <= 12) { return 12; }
            else if (group > 12 && group <= 18) { return 18; }
        };

        // Adjust for charge
        let charge = (electrons, charge) => {
            if (charge > 0) { return electrons -= charge; }
        };

        // Adjust for row
        let checkRow = (group, protons, electrons) => {
            if (group > 12 && protons > 10 && electrons <= 0) { return electrons += 4; }
            else { return electrons; }
        };

        // Update atoms/bonds
        let updateAtoms = (sourceID, targetID, bondID, bondOrder) => {

            atoms[sourceID].bonds.id.push(bondID);
            atoms[targetID].bonds.id.push(bondID);

            atoms[sourceID].bonds.atoms.push(targetID);
            atoms[targetID].bonds.atoms.push(sourceID);

            atoms[sourceID].bonds.electrons += bondOrder;
            atoms[targetID].bonds.electrons += bondOrder;
        };

        // Add bonds between adjacent atoms
        for (let i = 0; i < keys.atoms.length - 1; i++) {

            // Retrieve atoms
            let sourceAtom = atoms[keys.atoms[i]],
                targetAtom = atoms[keys.atoms[i+1]];

            // Check for hydrogen
            let sourceIndex = i;

            while ((sourceAtom.name === 'H' || atoms[keys.atoms[sourceIndex]] === undefined) && sourceIndex > -1) {
                sourceAtom = atoms[keys.atoms[sourceIndex]];
                sourceIndex -= 1;
            }

            if (sourceIndex === -1) { continue; }

            let sourceTotal = charge(valence(sourceAtom.group) - sourceAtom.bonds.electrons, sourceAtom.properties.charge),
                targetTotal = charge(valence(targetAtom.group) - targetAtom.bonds.electrons, targetAtom.properties.charge);

            // Check atoms for exceptions
            sourceTotal = checkRow(sourceTotal);
            targetTotal = checkRow(targetTotal);

            if (sourceTotal <= 0 || targetTotal <= 0) { continue; }

            // Check if bond exists
            if (sourceAtom.bonds.atoms.indexOf(targetAtom.id) !== -1) { continue; }

            // Determine number of tokens between source/target atoms
            let n = keys.all.indexOf(targetAtom.id) - keys.all.indexOf(sourceAtom.id),
                exceptions = 0;

            // Check for tokens preventing implicit bond
            if (n > 1) {

                // Extract all keys between source/target atoms
                let keysBetween = keys.all.slice(keys.all.indexOf(sourceAtom.id) + 1, keys.all.indexOf(targetAtom.id));

                // Check for bond symbol
                for (let j = 0; j < keysBetween.length; j++) {
                    if (bonds[keysBetween[j]] === undefined) { exceptions += 0; }
                    else if (bonds[keysBetween[j]].name !== 'ring') { exceptions += 1; }
                }
            }

            if (exceptions === 0) {

                // Assign new bond key
                let bondID = (sourceAtom.name + sourceAtom.id) + (targetAtom.name + targetAtom.id),
                    bondValue = sourceAtom.name + targetAtom.name,
                    bondName = 'single',
                    bondOrder = 1;

                if (sourceAtom.name === 'H' || targetAtom.name === 'H') {
                    bondName = 'H';
                }

                // Check aromatic atoms
                if (sourceAtom.properties.aromatic === 1 && targetAtom.properties.aromatic === 1) {
                    bondName = 'aromatic';
                    bondOrder = 1.5;
                }

                // Update bonds
                keys.bonds.push(bondID);
                bonds[bondID] = addBond(bondID, bondName, bondValue, bondOrder, [sourceAtom.id, targetAtom.id]);

                // Update atoms
                updateAtoms(sourceAtom.id, targetAtom.id, bondID, bondOrder);
            }
        }

        // Add implicit hydrogen
        var H = elements.H;

        let update = (x, sourceID, sourceName) => {

            let bondID = 'H' + (x + 1) + sourceName + sourceID;
            let targetID = bondID;

            atoms[targetID] = addAtom(targetID, 'H', 'H', H.group, H.protons, H.neutrons, H.electrons);
            bonds[bondID] = addBond(bondID, 'H', 'H', 1, [sourceID, targetID]);

            atoms[sourceID].bonds.id.push(bondID);
            atoms[sourceID].bonds.atoms.push(targetID);
            atoms[sourceID].bonds.electrons += 1;

            atoms[targetID].bonds.id.push(bondID);
            atoms[targetID].bonds.atoms.push(sourceID);
            atoms[targetID].bonds.electrons += 1;
        };

        for (let i = 0; i < keys.atoms.length; i++) {

            // Retrieve atoms
            let sourceAtom = atoms[keys.atoms[i]];

            // Check atom group
            if (sourceAtom.group < 13 && sourceAtom.group > 1) { continue; }

            let bondCount = sourceAtom.bonds.atoms.length;

            // Exception: explicit number of hydrogen
            if (sourceAtom.name !== 'H' && bondCount > 0) {

                for (let j = 0; j < bondCount; j++) {

                    // Retrieve target atom
                    let targetID = sourceAtom.bonds.atoms[j],
                        targetAtom = atoms[targetID];

                    // Check for hydrogen
                    if (targetAtom.name === 'H') {

                        // Check for value
                        let count = parseInt(targetAtom.value.match(/[0-9]+/g));

                        // Add hydrogen if electrons are available
                        if (count > 1 && count < sourceAtom.electrons) {

                            // Add hydrogen
                            for (let k = 0; k < count - 1; k++) {
                                update(k, sourceAtom.id, sourceAtom.name);
                            }
                        }
                    }
                }
            }

            // Exception: single uncharged hydrogen atom
            else if (sourceAtom.name === 'H' && sourceAtom.properties.charge === 0 && bondCount === 0) {
                update(i, sourceAtom.id, sourceAtom.name);
            }

            let total = 18 - sourceAtom.group - sourceAtom.bonds.electrons,
                charge = sourceAtom.properties.charge;

            if (total <= 0 || sourceAtom.group === 1) { continue; }

            // Positive charge
            if (charge > 0) {
                total -= charge;
            }

            // Negitive charge
            else if (charge < 0) {
                total += charge;

                // Exception: lone pair
                if (total === 1) {
                    total -= 1;
                    atoms[sourceAtom.id].bonds.electrons += 1;
                }
            }

            if (total <= 0) { continue; }

            // Add hydrogen
            for (let j = 0; j < total; j++) {

                // Check aromatic
                if (sourceAtom.properties.aromatic === 1 && j > 1) { continue; }

                update(j, sourceAtom.id, sourceAtom.name);
            }
        }

        return [atoms, bonds, keys];
    }

    function clean(atoms, bonds) {

        let atomID = Object.keys(atoms),
            bondID = Object.keys(bonds);

        for (let i = 0; i < bondID.length; i++) {

            // Re-label bond value
            let source = atoms[bonds[bondID[i]].atoms[0]],
                target = atoms[bonds[bondID[i]].atoms[1]],
                order = bonds[bondID[i]].order;

            // Format: source element + bond order + target element (e.g. C1C, C2O, O1H)
            bonds[bondID[i]].value = source.name + order + target.name;
        }

        let getID = (name, i) => name + (i + 1);

        let setID = (obj, a, b) => {
            if (obj.hasOwnProperty(a)) {
                obj[b] = obj[a];
                delete obj[a];
            }
        };

        // Re-label atom id
        for (let i = 0; i < atomID.length; i++) {

            let oldID = atomID[i],
                newID = getID(atoms[oldID].name, i);

            // Set ID
            atoms[oldID].id = newID;

            // Update bond pointers
            for (let j = 0; j < atoms[oldID].bonds.id.length; j++) {

                let key = atoms[oldID].bonds.id[j],
                    index = bonds[key].atoms.indexOf(oldID);

                if (index !== -1) {
                    bonds[key].atoms[index] = newID;
                }

                key = atoms[oldID].bonds.atoms[j];
                index = atoms[key].bonds.atoms.indexOf(oldID);

                if (index !== -1) {
                    atoms[key].bonds.atoms[index] = newID;
                }
            }

            setID(atoms, oldID, newID);
        }

        return [atoms, bonds];
    }

    let atoms, bonds, properties, keys;

    // 1. Validate tokens
    tokens = validateTokens(tokens);

    if (!tokens) { return false; }

    // 2. Categorize tokens
    [atoms, bonds, properties, keys] = readTokens(tokens);

    // 3. Add atoms
    atoms = defaultAtoms(atoms, keys);
    atoms = updateAtoms(atoms, properties, keys);

    // 4. Add bonds
    [atoms, bonds, keys] = explicitBonds(atoms, bonds, keys);
    [atoms, bonds, keys] = implicitBonds(atoms, bonds, keys);

    // 5. Clean atoms/bonds
    [atoms, bonds] = clean(atoms, bonds);

    return { atoms: atoms, bonds: bonds};
}

/**
 * Method      : compareArrays
 * Description : compare values across two arrays
 */

function compareArrays(a, b, ab = []) {

    for (let i = 0; i < a.length; i++) {
        ab[i] = b.indexOf(a[i]) > -1 ? 1 : 0;
    }

    return ab;
}

/**
 * Method      : addAtom
 * Description : return new atom
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
            id: [],
            atoms: [],
            electrons: 0
        },

        // Other properties
        properties: {
            chiral: 0,
            charge: 0,
            aromatic: 0
        }
    };
}

/**
 * Method      : addBond
 * Description : return new bond
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

/**
 * Method      : nextAtom
 * Description : find key of next atom in array
 */

function nextAtom(start, keys, atoms) {

    let index = keys.indexOf(start);

    if (index !== -1) {
        keys = keys.slice(index, keys.length);

        for (let i = 1, ii = keys.length; i < ii; i++) {
            if (atoms[keys[i]] !== undefined) { return keys[i]; }
        }
    }

    return null;
}

/**
 * Method      : previousAtom
 * Description : find key of previous atom in array
 */

function previousAtom(start, keys, atoms) {

    if (start === '0' && atoms['0'] !== undefined) { return '0'; }

    let index = keys.indexOf(start);

    if (index !== -1) {
        keys = keys.slice(0, index).reverse();

        for (let i = 0, ii = keys.length; i < ii; i++) {
            if (atoms[keys[i]] !== undefined) { return keys[i]; }
        }
    }

    return null;
}

/**
 * Exports
 */

export { grammar, tokenize, decode };