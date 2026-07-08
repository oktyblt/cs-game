const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf8');

code = code.replace(/mapCountInfo\.textContent = `📁 \$\{maps\.length\} harita mevcut`;/g, '');
code = code.replace(/mapCountInfo\.textContent = `📁 \$\{maps\.length\} harita mevcut \(Varsayılan\)`;/g, '');

fs.writeFileSync('src/main.js', code);
console.log('mapCountInfo updates removed');
