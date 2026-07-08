const fs = require('fs');

const transcriptPath = '/Users/oktaybulut/.gemini/antigravity-ide/brain/08d45265-f13b-403a-b9aa-721d6f4337de/.system_generated/logs/transcript_full.jsonl';

const mainJsPath = '/Users/oktaybulut/Desktop/Hlf/cs-web-game/src/main.js';
const authJsPath = '/Users/oktaybulut/Desktop/Hlf/cs-web-game/src/auth.js';

let mainJsContent = fs.readFileSync(mainJsPath, 'utf8');
let authJsContent = fs.readFileSync(authJsPath, 'utf8');

const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');

// Stop at 2 hours ago (e.g. 2026-07-08T20:40:00Z - wait, local time was 20:40+03:00, which is 17:40Z).
// Actually, I can just stop before 19:00Z (since my last session started around 19:27Z).
// Let's stop at 18:30Z to be perfectly safe, because the user said "2 hours ago" which is 20:40 TRT -> 17:40 UTC.
const CUTOFF_TIME = new Date('2026-07-08T17:40:00Z').getTime();

for (const line of lines) {
  if (!line.trim()) continue;
  try {
    const obj = JSON.parse(line);
    
    if (obj.created_at) {
      const ts = new Date(obj.created_at).getTime();
      if (ts > CUTOFF_TIME) {
        console.log(`Stopping replay at ${obj.created_at} because it is past the cutoff time.`);
        break; // Stop replaying!
      }
    }
    
    // Check if the step has tool calls (from MODEL)
    if (obj.tool_calls) {
      for (const call of obj.tool_calls) {
        if (call.name === 'replace_file_content' || call.name === 'multi_replace_file_content') {
          const args = call.args;
          const targetFile = args.TargetFile;
          
          if (targetFile === mainJsPath || targetFile === authJsPath) {
            let content = targetFile === mainJsPath ? mainJsContent : authJsContent;
            
            // Extract chunks
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
              chunks = args.ReplacementChunks || [];
            }
            
            for (const chunk of chunks) {
              const fileLines = content.split('\n');
              const startIdx = Math.max(0, chunk.StartLine - 1);
              const endIdx = Math.min(fileLines.length, chunk.EndLine);
              
              const targetStr = chunk.TargetContent;
              const repStr = chunk.ReplacementContent;
              
              const block = fileLines.slice(startIdx, endIdx).join('\n');
              
              let newBlock = block;
              if (chunk.AllowMultiple) {
                newBlock = block.split(targetStr).join(repStr);
              } else {
                newBlock = block.replace(targetStr, repStr);
              }
              
              // Only apply if it actually matches
              if (block.includes(targetStr)) {
                content = [
                  ...fileLines.slice(0, startIdx),
                  newBlock,
                  ...fileLines.slice(endIdx)
                ].join('\n');
              }
            }
            
            if (targetFile === mainJsPath) {
              mainJsContent = content;
            } else {
              authJsContent = content;
            }
          }
        }
      }
    }
  } catch(e) {
    // ignore parse errors for a line
  }
}

fs.writeFileSync('/Users/oktaybulut/Desktop/Hlf/cs-web-game/src/main.recovered.js', mainJsContent);
fs.writeFileSync('/Users/oktaybulut/Desktop/Hlf/cs-web-game/src/auth.recovered.js', authJsContent);
console.log('Recovery complete!');
