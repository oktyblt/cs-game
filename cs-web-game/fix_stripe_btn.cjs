const fs = require('fs');
let code = fs.readFileSync('src/main.js', 'utf8');

code = code.replace(/if \(data && data\.checkout_url\) \{\n\s*window\.location\.href = data\.checkout_url;\n\s*\} else \{/g,
  `if (data && data.checkout_url) {
        btn.textContent = origText;
        btn.disabled = false;
        window.location.href = data.checkout_url;
      } else {`);

fs.writeFileSync('src/main.js', code);
console.log('Stripe button fixed');
