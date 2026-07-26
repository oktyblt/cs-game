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

// STUN/TURN sunucuları - birden fazla STUN + TURN ile NAT traversal güvenilirliği artırıldı
const rtcConfig = {
  iceServers: [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun2.l.google.com:19302',
    'stun:stun3.l.google.com:19302',
    'stun:stun.cloudflare.com:3478',
    'stun:relay.metered.ca:80',
    'turn:relay.metered.ca:80?transport=udp&username=openrelayproject&credential=openrelayproject',
    'turn:relay.metered.ca:443?transport=tcp&username=openrelayproject&credential=openrelayproject',
    'turns:relay.metered.ca:443?transport=tcp&username=openrelayproject&credential=openrelayproject'
  ],
  iceTransportPolicy: 'all'
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
      console.log(`[WebRTC] DataChannel kapandı - peer ${peerId} disconnect`);
      // Xash3D disconnect paketi gönder (0xff 0xff 0xff 0xff "disconnect\n")
      const disc = Buffer.from([0xff,0xff,0xff,0xff,...Buffer.from('disconnect\n')]);
      try { udpSocket.send(disc, gamePort, '127.0.0.1'); } catch(e) {}
      setTimeout(() => { try { udpSocket.close(); } catch(e) {} }, 500);
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
    if (state === 'failed' || state === 'closed' || state === 'disconnected') {
      // Disconnect sinyali gönder
      const disc = Buffer.from([0xff,0xff,0xff,0xff,...Buffer.from('disconnect\n')]);
      try { udpSocket.send(disc, gamePort, '127.0.0.1'); } catch(e) {}
      // Cleanup'ı geciktir: client hala candidates polling yapıyor olabilir
      setTimeout(() => {
        try { udpSocket.close(); } catch(e) {}
        peers.delete(peerId);
        try { peer.close(); } catch(e) {}
      }, 5000);
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
  // 404 yerine boş array dön - client retry yapabilsin
  if (!p) return res.json([]);
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
