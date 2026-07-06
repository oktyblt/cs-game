const originalSendto = Net.prototype.sendto;
Net.prototype.sendto = function(fd, bufPtr, bufLen, flags, sockaddrPtr, socklenPtr) {
    const data = this.em.HEAPU8.subarray(bufPtr, bufPtr + bufLen);
    
    // Check if it's a fragmented packet (bit 30 of sequence is set)
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data.length >= 8) {
        const seq = view.getUint32(0, true);
        if (seq & 0x40000000) { // Contains fragments
            let hex = [];
            for (let i = 0; i < Math.min(data.length, 128); i++) {
                hex.push(data[i].toString(16).padStart(2, '0'));
            }
            console.log(`[Net.sendto] FRAGMENTED PACKET (${data.length} bytes): ${hex.join(' ')}`);
            
            // Try to find LZSS_ID
            for (let i = 0; i < data.length - 4; i++) {
                if (data[i] === 0x4C && data[i+1] === 0x5A && data[i+2] === 0x53 && data[i+3] === 0x53) {
                    console.log(`[Net.sendto] Found LZSS_ID at offset ${i}!`);
                }
            }
        }
    }
    
    return originalSendto.call(this, fd, bufPtr, bufLen, flags, sockaddrPtr, socklenPtr);
};

const originalRecvfrom2 = Net.prototype.recvfrom;
Net.prototype.recvfrom = function(fd, bufPtr, bufLen, flags, sockaddrPtr, socklenPtr) {
    const ret = originalRecvfrom2.call(this, fd, bufPtr, bufLen, flags, sockaddrPtr, socklenPtr);
    if (ret > 0) {
        const data = this.em.HEAPU8.subarray(bufPtr, bufPtr + ret);
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        if (data.length >= 8) {
            const seq = view.getUint32(0, true);
            if (seq & 0x40000000) { // Contains fragments
                let hex = [];
                for (let i = 0; i < Math.min(data.length, 128); i++) {
                    hex.push(data[i].toString(16).padStart(2, '0'));
                }
                console.log(`[Net.recvfrom] FRAGMENTED PACKET (${data.length} bytes): ${hex.join(' ')}`);
                
                // Try to find LZSS_ID
                for (let i = 0; i < data.length - 4; i++) {
                    if (data[i] === 0x4C && data[i+1] === 0x5A && data[i+2] === 0x53 && data[i+3] === 0x53) {
                        console.log(`[Net.recvfrom] Found LZSS_ID at offset ${i}!`);
                    }
                }
            }
        }
    }
    return ret;
};
