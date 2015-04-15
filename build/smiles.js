'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});
//
// smiles.js
//
// description : parse SMILES chemical line notation
// functions   : tokenize, decode
//

//
// SMILES Grammar
//
var definitions = [{ type: 'atom', term: 'H', tag: 'H', expression: /[A-Z]?H(?=[^efgos]|$)([0-9]?)+/g }, { type: 'atom', term: 'B', tag: 'B', expression: /B(?=[^aehikr]|$)/g }, { type: 'atom', term: 'C', tag: 'C', expression: /C(?=[^adeflmnorsu]|$)/g }, { type: 'atom', term: 'N', tag: 'N', expression: /N(?=[^abdeiop]|$)/g }, { type: 'atom', term: 'O', tag: 'O', expression: /O(?=[^s]|$)/g }, { type: 'atom', term: 'F', tag: 'F', expression: /F(?=[^elmr]|$)/g }, { type: 'atom', term: 'Si', tag: 'Si', expression: /Si/g }, { type: 'atom', term: 'P', tag: 'P', expression: /P(?=[^abdmortu]|$)/g }, { type: 'atom', term: 'S', tag: 'S', expression: /S(?=[^bcegimnr]|$)/g }, { type: 'atom', term: 'Cl', tag: 'Cl', expression: /Cl/g }, { type: 'atom', term: 'Se', tag: 'Se', expression: /Se/g }, { type: 'atom', term: 'Br', tag: 'Br', expression: /Br/g }, { type: 'atom', term: 'I', tag: 'I', expression: /I(?=[^nr]|$)/g }, { type: 'atom', term: '*', tag: '*', expression: /[*]/g }, { type: 'atom', term: 'b', tag: 'B', expression: /b(?=[^aehikr]|$)/g }, { type: 'atom', term: 'c', tag: 'C', expression: /c(?=[^adeflmnorsu]|$)/g }, { type: 'atom', term: 'n', tag: 'N', expression: /n(?=[^abdeiop]|$)/g }, { type: 'atom', term: 'o', tag: 'O', expression: /o(?=[^s]|$)/g }, { type: 'atom', term: 'p', tag: 'P', expression: /p(?=[^abdmortu]|$)/g }, { type: 'atom', term: 's', tag: 'S', expression: /s(?=[^bcegimnr]|$)/g }, { type: 'atom', term: 'se', tag: 'Se', expression: /se/g }, { type: 'bond', term: '-', tag: 'single', expression: /(?=[^d])[-](?=[^d])/g }, { type: 'bond', term: '=', tag: 'double', expression: /[=]/g }, { type: 'bond', term: '#', tag: 'triple', expression: /[#]/g }, { type: 'bond', term: '(', tag: 'branch', expression: /[(]/g }, { type: 'bond', term: ')', tag: 'branch', expression: /[)]/g }, { type: 'bond', term: '%', tag: 'ring', expression: /(?=[^+-])(?:[a-zA-Z]|[a-zA-Z]*.?[\]])[%]?\d(?=([^+-]|$))/g }, { type: 'bond', term: '.', tag: 'dot', expression: /[A-Z][+-]?[\[]?[.]/g }, { type: 'property', term: '+', tag: 'charge', expression: /[a-zA-Z]{1,2}[0-9]*[+]+[0-9]*(?=[\]])/g }, { type: 'property', term: '-', tag: 'charge', expression: /[a-zA-Z]{1,2}[0-9]*[-]+[0-9]*(?=[\]])/g }, { type: 'property', term: 'n', tag: 'isotope', expression: /[0-9]+[A-Z]{1,2}(?=.?[^\[]*[\]])/g }, { type: 'property', term: '@', tag: 'chiral', expression: /[A-Z][a-z]?[@](?![A-Z]{2}[0-9]+|[@])/g }, { type: 'property', term: '@@', tag: 'chiral', expression: /[A-Z][a-z]?[@]{2}(?![A-Z]{2}[0-9]+)/g }];

//
// Tokenize
//
function tokenize(input) {
    var tokens = arguments[1] === undefined ? [] : arguments[1];

    // Parse input with definitions
    for (var i = 0; i < definitions.length; i++) {

        var token = definitions[i];
        var text = [];

        // Check input for match
        while (text = token.expression.exec(input)) {

            // Update tokens
            tokens.push({
                index: text.index,
                type: token.type,
                term: text[0],
                tag: token.tag
            });
        }
    }

    // Sort tokens by index
    tokens.sort(function (a, b) {
        if (a.index < b.index) {
            return -1;
        }
        if (a.index > b.index) {
            return +1;
        }
        return 0;
    });

    return tokens;
}

//
// Decode
//
function decode(tokens) {

    var atoms = {};
    var bonds = {};
    var properties = {};

    // Parse tokens by type
    for (var i = 0; i < tokens.length; i++) {

        // Extract token values
        var _tokens$i = tokens[i];
        var type = _tokens$i.type;
        var term = _tokens$i.term;
        var tag = _tokens$i.tag;
        var index = _tokens$i.index;

        // Assign unique key
        var key = index.toString();

        switch (type) {

            case 'atom':
                atoms[key] = { id: key, name: tag };
                break;

            case 'bond':
                bonds[key] = { id: key, name: tag };
                break;

            case 'property':
                properties[key] = { id: key, name: tag, value: term };
                break;
        }
    }

    // Extract keys
    var keys = {
        atoms: Object.keys(atoms),
        bonds: Object.keys(bonds),
        properties: Object.keys(properties)
    };

    // Assign atom properties
    var _iteratorNormalCompletion = true;
    var _didIteratorError = false;
    var _iteratorError = undefined;

    try {
        for (var _iterator = keys.atoms[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
            var key = _step.value;

            // Add default properties
            atoms[key].protons = 0;
            atoms[key].neutrons = 0;
            atoms[key].electrons = 0;

            atoms[key].bonds = {
                chiral: 0,
                atoms: []
            };

            atoms[key].properties = {
                charge: 0
            };
        }
    } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
    } finally {
        try {
            if (!_iteratorNormalCompletion && _iterator['return']) {
                _iterator['return']();
            }
        } finally {
            if (_didIteratorError) {
                throw _iteratorError;
            }
        }
    }

    var _iteratorNormalCompletion2 = true;
    var _didIteratorError2 = false;
    var _iteratorError2 = undefined;

    try {
        for (var _iterator2 = keys.properties[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
            var key = _step2.value;

            // Extract property values
            var _properties$key = properties[key];
            var _name = _properties$key.name;
            var value = _properties$key.value;

            // Add custom properties
            switch (_name) {

                case 'chiral':
                    atoms[key].bonds.chiral = value.slice(value.indexOf('@'));
                    break;

                case 'isotope':
                    break;

                case 'charge':

                    // Charge sign
                    var sign = value.indexOf('+');
                    if (sign !== -1) {
                        sign = 1;
                    }

                    // Numeric charge
                    var charge = value.match(/[0-9]+/g);

                    if (charge !== null) {
                        atoms[key].properties.charge = charge[0] * sign;
                        break;
                    }

                    // Symbolic charge
                    charge = value.match(/([+]+|[-]+)/g);

                    if (charge !== null) {
                        atoms[key].properties.charge = charge[0].length * sign;
                        break;
                    }
            }
        }
    } catch (err) {
        _didIteratorError2 = true;
        _iteratorError2 = err;
    } finally {
        try {
            if (!_iteratorNormalCompletion2 && _iterator2['return']) {
                _iterator2['return']();
            }
        } finally {
            if (_didIteratorError2) {
                throw _iteratorError2;
            }
        }
    }

    return { atoms: atoms, bonds: bonds, properties: properties, keys: keys };
}

//
// Exports
//
exports.tokenize = tokenize;
exports.decode = decode;