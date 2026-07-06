const dgram = require('dgram');

const ip = '35.159.95.54';
const port = 27015;

const client = dgram.createSocket('udp4');
const req = Buffer.from([0xFF, 0xFF, 0xFF, 0xFF, 0x54, 0x53, 0x6F, 0x75, 0x72, 0x63, 0x65, 0x20, 0x45, 0x6E, 0x67, 0x69, 0x6E, 0x65, 0x20, 0x51, 0x75, 0x65, 0x72, 0x79, 0x00]);

client.on('message', (msg) => {
  console.log('Received response length:', msg.length);
  console.log('Hex dump:', msg.toString('hex'));
  console.log('ASCII:', msg.toString('ascii'));
  client.close();
});

client.on('error', (err) => {
  console.error(err);
  client.close();
});

client.send(req, 0, req.length, port, ip, (err) => {
  if (err) console.error(err);
  console.log('Sent A2S_INFO to', ip, port);
});

setTimeout(() => {
  console.log('Timeout');
  client.close();
}, 5000);
