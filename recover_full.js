const fs = require('fs');

const transcriptPath = '/Users/oktaybulut/.gemini/antigravity-ide/brain/08d45265-f13b-403a-b9aa-721d6f4337de/.system_generated/logs/transcript_full.jsonl';

// Files to restore
const FILES = [
  '/Users/oktaybulut/Desktop/Hlf/cs-web-game/src/main.js',
  '/Users/oktaybulut/Desktop/Hlf/cs-web-game/src/auth.js',
  '/Users/oktaybulut/Desktop/Hlf/cs-web-game/src/index.html',
];

// Start from HEAD versions (git checkout -- . already done)
const fileContents = {};
for (const f of FILES) {
  if (fs.existsSync(f)) {
    fileContents[f] = fs.readFileSync(f, 'utf8');
  }
}

// Cutoff: 23:05 TRT - 3 hours = 20:05 TRT = 17:05 UTC
// But user said 21:00, so let's use 18:00 UTC (21:00 TRT)
const CUTOFF_TIME = new Date('2026-07-08T18:00:00Z').getTime();

const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');

let appliedCount = 0;
let stoppedAt = null;

for (const line of lines) {
  if (!line.trim()) continue;
  
  let obj;
  try { obj = JSON.parse(line); } catch(e) { continue; }
  
  if (!obj.created_at) continue;
  const ts = new Date(obj.created_at).getTime();
  
  if (ts > CUTOFF_TIME) {
    if (!stoppedAt) stoppedAt = obj.created_at;
    break;
  }
  
  if (!obj.tool_calls) continue;
  
  for (const call of obj.tool_calls) {
    if (call.name !== 'replace_file_content' && call.name !== 'multi_replace_file_content') continue;
    
    const args = call.args;
    const targetFile = args.TargetFile;
    
    if (!fileContents.hasOwnProperty(targetFile)) continue;
    
    let content = fileContents[targetFile];
    
    let chunks = [];
    if (call.name === 'replace_file_content') {
      chunks.push({
        TargetContent: args.TargetContent,
        ReplacementContent: args.ReplacementContent,
        StartLine: args.StartLine,
        EndLine: args.EndLine,
        AllowMultiple: args.AllowMultiple
      });
    } else {
      // multi_replace_file_content - ReplacementChunks can be string or array
      let rc = args.ReplacementChunks;
      if (typeof rc === 'string') {
        try { rc = JSON.parse(rc); } catch(e) { continue; }
      }
      chunks = Array.isArray(rc) ? rc : [];
    }
    
    for (const chunk of chunks) {
      if (!chunk.TargetContent || chunk.ReplacementContent === undefined) continue;
      
      const fileLines = content.split('\n');
      const startIdx = Math.max(0, (chunk.StartLine || 1) - 1);
      const endIdx = Math.min(fileLines.length, chunk.EndLine || fileLines.length);
      
      const block = fileLines.slice(startIdx, endIdx).join('\n');
      
      if (!block.includes(chunk.TargetContent)) {
        // Try full-file search as fallback
        if (content.includes(chunk.TargetContent)) {
          if (chunk.AllowMultiple) {
            content = content.split(chunk.TargetContent).join(chunk.ReplacementContent);
            appliedCount++;
          } else {
            const idx = content.indexOf(chunk.TargetContent);
            if (idx !== -1) {
              content = content.slice(0, idx) + chunk.ReplacementContent + content.slice(idx + chunk.TargetContent.length);
              appliedCount++;
            }
          }
        }
        continue;
      }
      
      let newBlock;
      if (chunk.AllowMultiple) {
        newBlock = block.split(chunk.TargetContent).join(chunk.ReplacementContent);
      } else {
        newBlock = block.replace(chunk.TargetContent, chunk.ReplacementContent);
      }
      
      content = [
        ...fileLines.slice(0, startIdx),
        newBlock,
        ...fileLines.slice(endIdx)
      ].join('\n');
      appliedCount++;
    }
    
    fileContents[targetFile] = content;
  }
}

console.log(`Stopped at: ${stoppedAt}`);
console.log(`Applied ${appliedCount} patches`);

// Write recovered files
for (const [filePath, content] of Object.entries(fileContents)) {
  const ext = filePath.split('.').pop();
  const recovered = filePath.replace(`.${ext}`, `.recovered.${ext}`);
  fs.writeFileSync(recovered, content);
  console.log(`Written: ${recovered}`);
}

console.log('Done!');
