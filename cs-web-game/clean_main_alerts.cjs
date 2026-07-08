const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf8');

code = code.replace(/alert\(/g, 'window.customAlert(');

// But don't replace it in the definition itself!
// window.alert = (msg) => { window.customAlert(msg); };
code = code.replace(/window\.customAlert\(msg\); \};/g, 'alert(msg); };');
// wait, the definition is:
// window.alert = (msg) => { window.customAlert(msg); };
// So it became window.customAlert(msg) => { window.customAlert(msg); } ? NO.
// I'll just sed the specific lines to be safe.
