const fs = require('fs');
let html = fs.readFileSync('src/index.html', 'utf8');
const modals = fs.readFileSync('supabase_modals.html', 'utf8');
if (!html.includes('login-modal')) {
  html = html.replace('</body>', modals + '\n</body>');
  fs.writeFileSync('src/index.html', html);
  console.log('Injected modals successfully.');
} else {
  console.log('Already injected.');
}
