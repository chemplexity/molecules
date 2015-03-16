#Dynamic Molecules

|Create dynamic 2D molecules with HTML/JavaScript.|![Imgur](http://i.imgur.com/sVPFz7l.png)|
|:--|--:|

Dynamic molecules are responsive 2D representations of molecular structures based on chemical graph theory. Check out the latest examples [here](http://bl.ocks.org/chemplexity/raw/bcd198a9604d8943b5dc/).

### Features
* Interactive 2D molecules that run in your browser
* Real-time SMILES chemical notation parser
* Embeddable in HTML websites

####Rendering

Molecules this JSON schema are rendered in a force directed layout graph using the [d3.js](https://github.com/mbostock/d3/wiki/Force-Layout) visualization library.

#### Converting from SMILES

The fastest way to obtain a formatted JSON molecule is to convert a [SMILES](http://www.daylight.com/dayhtml/doc/theory/theory.smiles.html) identification code. The SMILES parsing engine included in this release is the current focus of development and has limited functionality at this time. To convert SMILES to JSON use the `smiles.js` file 
