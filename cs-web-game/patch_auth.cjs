const fs = require('fs');
let code = fs.readFileSync('src/auth.js', 'utf8');

code = code.replace(/alert\(/g, 'window.customAlert(');
code = code.replace(/prompt\(/g, 'await window.customPrompt(');

fs.writeFileSync('src/auth.js', code);
console.log('auth.js patched for modals');
