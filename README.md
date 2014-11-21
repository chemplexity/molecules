#Dynamic Molecules

|Create dynamic 2D molecules with HTML/JavaScript.|![Imgur](http://i.imgur.com/sVPFz7l.png)|
|:--|--:|

Dynamic molecules are responsive 2D representations of molecular structures based on chemical graph theory. Check out the latest examples [here](http://bl.ocks.org/chemplexity/raw/bcd198a9604d8943b5dc/).

### Features
* Interactive 2D molecules that run in your browser
* Real-time SMILES chemical notation parser
* Embeddable in HTML websites

### Documentation

Dynamic molecules are generated from JSON structures with the following schema: 

####Molecule
Each molecule consists of an array of atoms and bonds.

````json
{
  "molecule_id": "CC(O)CC=C",
  "atoms": [],
  "bonds": []
}
````

####Atom
Atoms are represented by elemental symbols, and have a certain number of protons, neutrons, and valence electrons.

````json
{
  "atom_id": "C2",
  "element": "C",
  "protons": 6,
  "neutrons": 6,
  "electrons": 4 
}
````

####Bonds
Bonds take place between two atoms and can vary in magnitude (e.g. single, double, triple).

````json
{
  "bond_id": "C2C3",
  "source": "C2",
  "target": "C3",
  "type": "single",
  "value": 1
}
````

####Rendering

Molecules with this JSON schema are rendered in a force directed layout graph using the [d3.js](https://github.com/mbostock/d3/wiki/Force-Layout) visualization library.

#### Converting from SMILES

The fastest way to obtain a formatted JSON molecule is to convert a [SMILES](http://www.daylight.com/dayhtml/doc/theory/theory.smiles.html) identification code. The SMILES parsing engine included in this release is the current focus of development and has limited functionality at this time. To convert SMILES to JSON use the `smiles.js` file 
