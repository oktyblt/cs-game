const fs = require('fs');
const path = require('path');

const CSTRIKE_DIR = path.join(__dirname, '..', 'Hlf', 'cstrike');
const VALVE_DIR = path.join(__dirname, '..', 'Hlf', 'valve');

const REPORT_JSON = path.join(__dirname, 'asset-report.json');
const REPORT_HTML = path.join(__dirname, 'asset-report.html');
const MISSING_CSV = path.join(__dirname, 'missing-assets.csv');

console.log(`[Auditor] Tarama başlatılıyor...`);

if (!fs.existsSync(CSTRIKE_DIR)) {
  console.error(`[Auditor] HATA: ${CSTRIKE_DIR} bulunamadı!`);
  process.exit(1);
}

// Tüm dosyaları recursive al
function getAllFiles(dirPath, arrayOfFiles = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const files = fs.readdirSync(dirPath);
  files.forEach(file => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  });
  return arrayOfFiles;
}

const cstrikeFiles = getAllFiles(CSTRIKE_DIR);
const valveFiles = getAllFiles(VALVE_DIR);
const allFiles = [...cstrikeFiles, ...valveFiles];

// Büyük küçük harf kontrolü için map
const lowerCaseMap = new Map();
const exactFilesSet = new Set();
const caseIssues = [];

allFiles.forEach(file => {
  let relativePath;
  if (file.startsWith(CSTRIKE_DIR)) {
      relativePath = 'cstrike/' + path.relative(CSTRIKE_DIR, file).replace(/\\/g, '/');
  } else {
      relativePath = 'valve/' + path.relative(VALVE_DIR, file).replace(/\\/g, '/');
  }
  
  exactFilesSet.add(relativePath);
  
  const lowerPath = relativePath.toLowerCase();
  if (lowerCaseMap.has(lowerPath)) {
    caseIssues.push({
      issue: 'Case Sensitivity Çakışması',
      file1: lowerCaseMap.get(lowerPath),
      file2: relativePath
    });
  } else {
    lowerCaseMap.set(lowerPath, relativePath);
  }
});

function fileExistsCI(reqPath) {
    // Exact match
    if (exactFilesSet.has(reqPath)) return true;
    // Fallback to case-insensitive match
    return lowerCaseMap.has(reqPath.toLowerCase());
}

// BSP Parse: String çıkarma
function extractDependenciesFromBSP(bspPath) {
  const deps = { wad: new Set(), mdl: new Set(), spr: new Set(), wav: new Set() };
  try {
    const buffer = fs.readFileSync(bspPath);
    // Çok basit bir string extractor
    let currentString = '';
    for (let i = 0; i < buffer.length; i++) {
      const char = buffer[i];
      if (char >= 32 && char <= 126) {
        currentString += String.fromCharCode(char);
      } else {
        if (currentString.length > 4) {
          const lowerStr = currentString.toLowerCase();
          if (lowerStr.endsWith('.wad')) deps.wad.add(currentString);
          else if (lowerStr.endsWith('.mdl')) deps.mdl.add(currentString);
          else if (lowerStr.endsWith('.spr')) deps.spr.add(currentString);
          else if (lowerStr.endsWith('.wav')) deps.wav.add(currentString);
        }
        currentString = '';
      }
    }
  } catch (e) {
    console.error(`BSP Okunurken Hata: ${bspPath}`);
  }
  return {
    wad: Array.from(deps.wad),
    mdl: Array.from(deps.mdl),
    spr: Array.from(deps.spr),
    wav: Array.from(deps.wav)
  };
}

const mapDeps = {};
const missingAssets = [];

const mapsDir = path.join(CSTRIKE_DIR, 'maps');
if (fs.existsSync(mapsDir)) {
  const bspFiles = fs.readdirSync(mapsDir).filter(f => f.toLowerCase().endsWith('.bsp'));
  bspFiles.forEach(bspFile => {
    const bspPath = path.join(mapsDir, bspFile);
    console.log(`[Auditor] Analiz ediliyor: ${bspFile}`);
    const deps = extractDependenciesFromBSP(bspPath);
    mapDeps[bspFile] = deps;

    // Check if dependencies exist
    const checkExist = (list, type) => {
        list.forEach(item => {
            let searchPath = '';
            if (type === 'wad') searchPath = `cstrike/${item}`; // WADs are usually root
            else if (type === 'mdl') searchPath = `cstrike/${item}`;
            else if (type === 'spr') searchPath = `cstrike/${item}`;
            else if (type === 'wav') searchPath = `cstrike/sound/${item}`;

            // Check cstrike, then valve
            if (!fileExistsCI(searchPath) && !fileExistsCI(searchPath.replace('cstrike/', 'valve/'))) {
                missingAssets.push({ map: bspFile, type, file: item });
            }
        });
    };

    checkExist(deps.wad, 'wad');
    checkExist(deps.mdl, 'mdl');
    checkExist(deps.spr, 'spr');
    checkExist(deps.wav, 'wav');
  });
}

// Raporları Oluştur
const report = {
  scannedFilesCount: allFiles.length,
  caseIssuesFound: caseIssues.length,
  caseIssues,
  mapDependencies: mapDeps,
  missingAssets
};

fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));

// CSV Çıktısı
let csvContent = "Map,Type,Missing File\n";
missingAssets.forEach(m => {
    csvContent += `${m.map},${m.type},${m.file}\n`;
});
fs.writeFileSync(MISSING_CSV, csvContent);

// HTML Çıktısı
const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Asset Audit Report</title>
    <style>
        body { font-family: sans-serif; padding: 20px; background: #1e1e1e; color: #fff; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
        th, td { border: 1px solid #444; padding: 8px; text-align: left; }
        th { background-color: #333; }
        .missing { color: #ff6b6b; font-weight: bold; }
    </style>
</head>
<body>
    <h1>BrowserCS Asset Audit Report</h1>
    <p>Total Scanned Files: ${allFiles.length}</p>
    <p>Case Issues: ${caseIssues.length}</p>
    
    <h2>Eksik Dosyalar (Missing Assets)</h2>
    <table>
        <tr><th>Map</th><th>Type</th><th>File</th></tr>
        ${missingAssets.map(m => `<tr><td>${m.map}</td><td>${m.type}</td><td class="missing">${m.file}</td></tr>`).join('')}
    </table>
</body>
</html>
`;
fs.writeFileSync(REPORT_HTML, htmlContent);

console.log(`[Auditor] Tarama tamamlandı!`);
console.log(`- Eksik Asset: ${missingAssets.length}`);
console.log(`- Case Sorunu: ${caseIssues.length}`);
console.log(`Raporlar kaydedildi: asset-report.html, missing-assets.csv`);
