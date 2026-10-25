# The Babel — two-person connection test (R07.9)

R12.3 adds optional partial/final transcripts and translated messages to the existing reliable data channel. Each device uses its own microphone; the WebRTC media stream remains video-only. See [SPEECH.md](SPEECH.md) for opt-in behavior, access-code setup and lifecycle. Earlier camera-only descriptions below refer to the visual/media transport.

Each computer runs the existing R07.6 single-person vision pipeline. The local artwork canvas is captured at up to 1280×720 / 20 fps and sent with WebRTC. The remote artwork is played directly: no second face, hand or segmentation inference is run for the remote participant. A is always on the left and B on the right.

## Try it

1. Open the same deployed HTTPS site on both computers (Chrome recommended).
2. On computer A, open **双人联机**, select the camera or explicitly labelled demo, and choose **创建房间**.
3. Copy the invitation link and open it on computer B. Choose the source and click **加入房间**. Opening the link alone does not start the camera or join the room.
4. Keep the host tab open. A room admits one guest. A third participant is rejected before their media is accepted.
5. **离开房间** closes transmission and returns to solo; **退出** also closes the camera. When a guest leaves, the host keeps the room available. Rejoin uses the same invitation while that host remains online.

## Transport and privacy

- PeerJS 1.5.5 uses the public PeerServer Cloud signaling service (`0.peerjs.com`). The service is shared and has no availability guarantee for this prototype.
- Signaling exchanges connection information; the room host handles the one-guest admission handshake. There is no persistent user account or room database.
- Joining sends the processed artwork, **including the photographic camera background**, to the admitted participant. Raw camera frames stay inside local processing. Only the local artwork canvas is transmitted; the remote-containing display is never captured again.
- A separate data connection sends normalized hand positions and bounded facial movement values at most 10 times per second. These are movement values, not psychological diagnoses or emotion probabilities.
- No microphone, speech recognition, semantic model, recording service or media storage is enabled.
- Invitation links grant access to the room. Share them only with the intended partner. Room IDs contain 128 random bits; the host page must remain open.

## Network limits

The default configuration uses STUN for direct connectivity. PeerServer Cloud does not provide a free TURN relay. Some campus, enterprise and cellular networks will require TURN. A successful test between two browser sessions on one computer does not establish cross-network reliability.

The UI reports that relay is not configured, and connection failures surface a retry/network message. Try two physical computers on Wi-Fi, then one on a phone hotspot. Do not promise a particular latency or FPS until these tests pass on the intended devices.

`api/rtc-config.js` supports a Coturn-compatible time-limited credential service when **both** `TURN_URLS` (comma-separated `turn:` / `turns:` addresses) and `TURN_SHARED_SECRET` are set as Vercel environment variables. Credentials expire after one hour; the shared secret stays on the server. No relay subscription or paid resource is provisioned by this project. Long-term production deployment should add access control and rate limits to relay credential issuance.

## Local development and Vercel

Requires Node.js 24+. No runtime npm dependency is needed.

```sh
npm install --ignore-scripts
npm run build
npm test
npm start
```

`npm run build` fetches pinned Three.js, MediaPipe and PeerJS assets and verifies their SHA-256 values against `assets-manifest.json`. Existing correct local assets are reused. The output goes to `dist/`; Vercel serves that folder and the `/api/rtc-config` function. This avoids storing large models and WASM binaries in Git.

Vercel project settings: framework **Other**, build `npm run build`, output `dist`, Node.js **24.x**. `vercel.json` includes the same settings. The local server intentionally listens only on loopback; use the deployed HTTPS URL for cross-device tests.

The facial expression, particle, fingertip and six/seven detection algorithms remain byte-identical to R07.6. The new room code only subscribes to their output. The proposed shared emotion artwork and cross-border collision layer are not implemented in this version.
