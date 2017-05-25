# molecules.js

A chemical graph theory library for JavaScript. Latest demo of `molecules.js` + `d3.js` [here](http://bl.ocks.org/chemplexity/raw/180e960a6d9e68adf28429dd16f05fa0/). 

### Features 

* Import molecules encoded with [SMILES](http://www.daylight.com/dayhtml/doc/theory/theory.smiles.html) chemical line notation.
* Compute various graph matrices of a molecule (e.g. adjacency, degree, distance, Laplacian, Randic, reciprocal).
* Compute several topological indices of a molecule (e.g. Balaban, Harary, Hyper-Wiener, Randic, Wiener).
* Visualize molecules with `d3.js` force directed graphs.

![Imgur](http://i.imgur.com/idP2r6Q.jpg)

## Getting Started

The `Molecules` module contains the primary functions for loading, saving, computing graph matrices and computing topological indices.

````javascript
var Molecules = require('molecules.js');
````

### Introduction

A `molecule` is a graph comprised of nodes (`atoms`) and edges (`bonds`). In `molecules.js` a `molecule` is an object with the following schema:
 
 ````javascript
molecule = {
    id : Number,
    name : String,
    atoms : Object,
    bonds : Object,
    properties : {
        mass : Number,
        formula : Object
    } 
}
 ````
 
### Loading Molecules

````javascript
// Create a molecule by parsing a SMILES string 
var molecule = Molecules.load.smiles('NCC(O)O');
````

````javascript
// Import a molecule from a JSON file
var molecule = Molecules.load.json(url);
````

### Saving Molecules

````javascript
// Convert a molecule to JSON format
var data = Molecules.save.json(molecule);
````
````javascript
// Convert a molecule to a d3 graph object
var graph = Molecules.save.d3(molecule);
````

## Graph Matrices

````javascript
// Load a molecule of ethanol ('CCO')
var ethanol = Molecules.load.smiles('CCO');
````

### Adjacency Matrix

````javascript
// Compute the adjacency matrix of ethanol
var adjacencyMatrix = Molecules.topology.matrix.adjacency(ethanol);

//     C  C  O 
// C [ 0, 1, 0 ]
// C [ 1, 0, 1 ]
// O [ 0, 1, 0 ]
````

### Distance Matrix

````javascript
// Use the adjacency matrix to compute the distance matrix
var distanceMatrix = Molecules.topology.matrix.distance(adjacencyMatrix);

//     C  C  O
// C [ 0, 1, 2 ]
// C [ 1, 0, 1 ]
// O [ 2, 1, 0 ]
````

### Degree Matrix

````javascript
// Use the adjacency matrix to compute the degree matrix
var degreeMatrix = Molecules.topology.matrix.degree(adjacencyMatrix);

//     C  C  O
// C [ 1, 0, 0 ] 
// C [ 0, 2, 0 ]
// O [ 0, 0, 1 ]
````
### Reciprocal Matrix

````javascript
// Use the distance matrix to compute the reciprocal matrix
var reciprocalMatrix = Molecules.topology.matrix.reciprocal(distanceMatrix);

//      C    C    O
// C [ 0.0, 1.0, 0.5 ]
// C [ 1.0, 0.0, 1.0 ]
// C [ 0.5, 1.0, 0.0 ]
````

### Laplacian Matrix

````javascript
// Use the adjacency and degree matrix to compute the Laplacian matrix
var laplacianMatrix = Molecules.topology.matrix.laplacian(adjacencyMatrix, degreeMatrix);

//      C   C   O
// C [  1, -1,  0 ]
// C [ -1,  2, -1 ]
// C [  0, -1,  1 ]
````

### Randic Matrix

````javascript
// Use the adjacency and degree matrix to compute the Randic matrix
var randicMatrix = Molecules.topology.matrix.randic(adjacencyMatrix, degreeMatrix);

//       C      C      O
// C [ 0.000, 0.707, 0.000 ]
// C [ 0.707, 0.000, 0.707 ]
// O [ 0.000, 0.707, 0.000 ]
````

## Topological Indices

````javascript
// Load a molecule of ethanol ('CCO')
var ethanol = Molecules.load.smiles('CCO');

// Compute the following graph matrices
var adjacencyMatrix  = Molecules.topology.matrix.adjacency(ethanol);
var distanceMatrix   = Molecules.topology.matrix.distance(adjacencyMatrix);
var degreeMatrix     = Molecules.topology.matrix.degree(adjacencyMatrix);
var reciprocalMatrix = Molecules.topology.matrix.reciprocal(distanceMatrix);
var randicMatrix     = Molecules.topology.matrix.randic(adjacencyMatrix, degreeMatrix);
````

### Wiener Index

````javascript
// Use the distance matrix to compute the Wiener index
var wienerIndex = Molecules.topology.index.wiener(distanceMatrix);

// 4.0

````

### Hyper-Wiener Index

````javascript
// Use the distance matrix to compute the Hyper-Wiener index
var hyperwienerIndex = Molecules.topology.index.hyperwiener(distanceMatrix);

// 5.0

````

### Harary Index

````javascript
// Use the reciprocal matrix to compute the Harary index
var hararyIndex = Molecules.topology.index.harary(reciprocalMatrix);

// 2.5

````

### Balaban Index

````javascript
// Use the distance matrix to compute the Balaban index
var balabanIndex = Molecules.topology.index.balaban(distanceMatrix);

// 1.632993

````

### Randic Index

````javascript
// Use the Randic matrix to compute the Randic index
var randicIndex = Molecules.topology.index.randic(randicMatrix);

// 1.414213

````

    
