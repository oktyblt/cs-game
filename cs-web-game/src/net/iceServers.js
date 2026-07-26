/**
 * WebRTC ICE servers (from live Cloudflare deploy 2026-07-26).
 */
const BCS_TURN_HOST = '35.159.95.54';
const BCS_TURN_USER = 'browsercs';
const BCS_TURN_PASS = 'BcsTurn2026Relay';

export function getIceServers() {
  return [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    {
      urls: [
        `turn:${BCS_TURN_HOST}:3478?transport=udp`,
        `turn:${BCS_TURN_HOST}:3478?transport=tcp`,
      ],
      username: BCS_TURN_USER,
      credential: BCS_TURN_PASS,
    },
  ];
}
