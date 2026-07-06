const fs = require('fs');

function patchWasm(filePath) {
  const buf = fs.readFileSync(filePath);
  let offset = 8; // skip magic and version
  while(offset < buf.length) {
    const id = buf[offset++];
    let size = 0, shift = 0;
    const sizeOffset = offset;
    let sizeLen = 0;
    while(true) {
      const b = buf[offset++];
      sizeLen++;
      size |= (b & 0x7f) << shift;
      shift += 7;
      if((b & 0x80) === 0) break;
    }
    
    if (id === 5) { // Memory section
      console.log('Found Memory section in ' + filePath);
      const sectionStart = offset;
      
      let numMem = 0; shift = 0;
      while(true) {
        const b = buf[offset++];
        numMem |= (b & 0x7f) << shift;
        shift += 7;
        if((b & 0x80) === 0) break;
      }
      
      const flagsOffset = offset;
      const flags = buf[offset++];
      
      let initial = 0; shift = 0;
      while(true) {
        const b = buf[offset++];
        initial |= (b & 0x7f) << shift;
        shift += 7;
        if((b & 0x80) === 0) break;
      }
      
      if (flags & 1) { // Has Max Pages
        console.log('Removing maximum memory limit...');
        const maxOffset = offset;
        let max = 0; shift = 0;
        let maxLen = 0;
        while(true) {
          const b = buf[offset++];
          maxLen++;
          max |= (b & 0x7f) << shift;
          shift += 7;
          if((b & 0x80) === 0) break;
        }
        
        // We will change flags from 1 to 0 (or clear bit 0)
        const newFlags = flags & ~1;
        
        // Calculate new section size
        const newSize = size - maxLen;
        
        // We assume section size was represented in 1 byte (since it's very small)
        if (sizeLen !== 1 || newSize > 127) {
          console.error('Complex LEB128 size, skipping ' + filePath);
          return;
        }
        
        // Create new buffer
        const newBuf = Buffer.alloc(buf.length - maxLen);
        
        // Copy up to size byte
        buf.copy(newBuf, 0, 0, sizeOffset);
        // Write new size
        newBuf[sizeOffset] = newSize;
        // Copy until flags
        buf.copy(newBuf, sizeOffset + 1, sizeOffset + 1, flagsOffset);
        // Write new flags
        newBuf[flagsOffset] = newFlags;
        // Copy initial pages
        buf.copy(newBuf, flagsOffset + 1, flagsOffset + 1, maxOffset);
        // Copy the rest of the file, skipping max bytes
        buf.copy(newBuf, maxOffset, maxOffset + maxLen);
        
        fs.writeFileSync(filePath, newBuf);
        console.log('Successfully patched ' + filePath);
      } else {
        console.log('No max memory limit found in ' + filePath);
      }
      break;
    } else {
      offset += size;
    }
  }
}

const files = [
  '/Users/oktaybulut/Desktop/Hlf/cs-web-game/node_modules/xash3d-fwgs/dist/xash.wasm',
  '/Users/oktaybulut/Desktop/Hlf/cs-web-game/public/wasm/dlls/cs_emscripten_wasm32.wasm',
  '/Users/oktaybulut/Desktop/Hlf/cs-web-game/public/wasm/cl_dlls/client_emscripten_wasm32.wasm',
  '/Users/oktaybulut/Desktop/Hlf/cs-web-game/public/wasm/cl_dlls/menu_emscripten_wasm32.wasm'
];

for (const file of files) {
  if (fs.existsSync(file)) {
    patchWasm(file);
  }
}
