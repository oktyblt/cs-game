const express = require('express');
const cors = require('cors');
const dgram = require('dgram');
const nodeDataChannel = require('node-datachannel');

const app = express();
app.use(cors());
app.use(express.json());

// Log seviyesini ayarla (kaldırıldı)

// Aktif bağlantıları tutacağımız harita
const peers = new Map();

// STUN/TURN sunucuları
const rtcConfig = {
  iceServers: ['stun:stun.l.google.com:19302']
};

app.post('/webrtc/offer', (req, res) => {
  const { gamePort, sdp } = req.body;
  if (!gamePort || !sdp) return res.status(400).json({ error: 'Missing gamePort or sdp' });

  const peerId = Math.random().toString(36).substr(2, 9);
  const peer = new nodeDataChannel.PeerConnection(peerId, rtcConfig);

  const udpSocket = dgram.createSocket('udp4');
  let dataChannel = null;

  // İstemciden gelen DataChannel
  peer.onDataChannel((dc) => {
    dataChannel = dc;
    dataChannel.onMessage((msg) => {
      // Tarayıcıdan UDP'ye (Oyun sunucusuna)
      const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
      udpSocket.send(buf, gamePort, '127.0.0.1');
    });
    
    dataChannel.onClosed(() => {
      try { udpSocket.close(); } catch(e) {}
    });
  });

  // UDP'den tarayıcıya
  udpSocket.on('message', (msg) => {
    if (dataChannel && dataChannel.isOpen()) {
      dataChannel.sendMessageBinary(msg);
    }
  });

  // node-datachannel otomatik answer ürettiğinde bu tetiklenir
  let answerSent = false;
  peer.onLocalDescription((answerSdp, type) => {
    if (!answerSent) {
      answerSent = true;
      res.json({ peerId, sdp: answerSdp, type });
    }
  });

  // ICE Adaylarını topla
  const candidates = [];
  peer.onLocalCandidate((candidate, mid) => {
    candidates.push({ candidate, mid });
  });

  peer.onStateChange((state) => {
    console.log(`[WebRTC] Peer ${peerId} state: ${state}`);
    if (state === 'failed' || state === 'closed') {
      try { udpSocket.close(); } catch(e) {}
      peers.delete(peerId);
      peer.close();
    }
  });

  // Uzak SDP'yi (Offer) ayarla -> otomatik olarak answer üretecektir
  try {
    peer.setRemoteDescription(sdp, 'offer');
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }

  peers.set(peerId, { peer, udpSocket, candidates });
});

app.get('/webrtc/candidates/:peerId', (req, res) => {
  const p = peers.get(req.params.peerId);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const toSend = [...p.candidates];
  p.candidates = [];
  res.json(toSend);
});

app.post('/webrtc/candidate/:peerId', (req, res) => {
  const p = peers.get(req.params.peerId);
  if (!p) return res.status(404).json({ error: 'Not found' });
  
  const { candidate, mid } = req.body;
  if (candidate && mid !== undefined) {
    p.peer.addRemoteCandidate(candidate, mid);
  }
  res.json({ success: true });
});

const PORT = 37000;
app.listen(PORT, () => {
  console.log(`[WebRTC] Signaling server listening on port ${PORT}`);
});
