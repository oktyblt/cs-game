const fs = require('fs');
const path = require('path');

const srcCstrike = path.join(process.env.HOME, 'Downloads/Counter-Strike/cstrike');
const srcValve = path.join(process.env.HOME, 'Downloads/Counter-Strike/valve');

const destCstrike = '/Users/oktaybulut/Desktop/2/Hlf/cstrike';
const destValve = '/Users/oktaybulut/Desktop/2/Hlf/valve';

const files = fs.readFileSync('missing_files.txt', 'utf-8').split('\n').map(l => l.trim()).filter(l => l);

for (const file of files) {
  const possibleSrcs = [
    { src: path.join(srcCstrike, file), dest: path.join(destCstrike, file) },
    { src: path.join(srcValve, file), dest: path.join(destValve, file) },
  ];

  let found = false;
  for (const { src, dest } of possibleSrcs) {
    if (fs.existsSync(src)) {
      found = true;
      const destDir = path.dirname(dest);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }
      fs.copyFileSync(src, dest);
      console.log(`Copied ${file} to ${dest}`);
      break;
    }
  }

  if (!found) {
    console.error(`ERROR: Could not find ${file} anywhere!`);
  }
}
