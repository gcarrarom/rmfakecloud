
import { useState, useEffect, useRef, useCallback } from "react";
import { Container, Alert, Spinner, Button, Badge } from "react-bootstrap";
import { BsGearFill, BsFullscreenExit, BsArrowCounterclockwise, BsArrowClockwise } from "react-icons/bs";
import pako from "pako";
import constants from "../../common/constants";

const STATUS = {
  WAITING: "waiting",
  CONNECTING: "connecting",
  STREAMING: "streaming",
  ERROR: "error",
};

const BACKDROP_PRESETS = {
  white: "#FFFFFF",
  "off-white": "#F9F6F1",
  gray: "#2D2D2D",
  black: "#000000",
};

function getBackdrop() {
  return localStorage.getItem("screenshare-backdrop") || "black";
}

function setBackdropPref(val) {
  localStorage.setItem("screenshare-backdrop", val);
}

function getCustomColor() {
  return localStorage.getItem("screenshare-custom-color") || "#808080";
}

function setCustomColorPref(val) {
  localStorage.setItem("screenshare-custom-color", val);
}

function resolveBackdrop(pref) {
  return BACKDROP_PRESETS[pref] || pref;
}

function isLightColor(hex) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

function api(path, opts = {}) {
  return fetch(`${constants.ROOT_URL}/screenshare/${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
}

export default function ScreenShare() {
  const [status, setStatus] = useState(STATUS.WAITING);
  const [activeTab, setActiveTab] = useState("share");
  const [diagnostics, setDiagnostics] = useState([]);
  const [tabletConnected, setTabletConnected] = useState(false);
  const [streamConnected, setStreamConnected] = useState(false);
  const [retentionDays, setRetentionDays] = useState(7);
  const [errorMsg, setErrorMsg] = useState("");
  const [poppedOut, setPoppedOut] = useState(false);
  const [manualRotation, setManualRotation] = useState(0);
  const [backdrop, setBackdrop] = useState(getBackdrop);
  const [customColor, setCustomColor] = useState(getCustomColor);
  const [showControls, setShowControls] = useState(false);
  const [pinnedPosition, setPinnedPosition] = useState(null);
  const [controlsPosition, setControlsPosition] = useState("right");
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 767.98px)").matches);
  const controlsRef = useRef(null);
  const manualRotationRef = useRef(0);
  const statusRef = useRef(status);
  const tabletConnectedRef = useRef(tabletConnected);
  const disconnectedRef = useRef(false);
  const joinLockRef = useRef(false);
  const retryTimerRef = useRef(null);
  const connectionTimerRef = useRef(null);
  const retryCountRef = useRef(0);
  const tryJoinRef = useRef(null);
  statusRef.current = status;

  const recordDiagnostic = useCallback((event, message = "") => {
    fetch(`${constants.ROOT_URL}/screenshare/diagnostics`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({event, message}),
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767.98px)");
    const updateIsMobile = (event) => {
      setIsMobile(event.matches);
    };

    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener("change", updateIsMobile);

    return () => mediaQuery.removeEventListener("change", updateIsMobile);
  }, []);

  useEffect(() => {
    if (!showControls) return;
    const handler = (e) => {
      if (controlsRef.current && !controlsRef.current.contains(e.target)) {
        setShowControls(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showControls]);

  useEffect(() => {
    if (!poppedOut) return;
    const check = () => {
      const canvas = videoRef.current;
      if (!canvas || !canvas.width || !canvas.height) return;
      const rot = ((manualRotation % 360) + 360) % 360;
      const isRotated = rot % 180 !== 0;
      const aspect = isRotated ? canvas.height / canvas.width : canvas.width / canvas.height;
      const vpAspect = (window.innerWidth - 50) / window.innerHeight;
      setControlsPosition(isMobile ? "bottom" : aspect < vpAspect ? "right" : "top");
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [poppedOut, manualRotation, isMobile]);
  const videoRef = useRef(null);
  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const roomIdRef = useRef(null);
  const tabletClientIdRef = useRef(null);

  const cleanup = useCallback(() => {
    if (connectionTimerRef.current) clearTimeout(connectionTimerRef.current);
    connectionTimerRef.current = null;
    dcRef.current = null;
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    roomIdRef.current = null;
  }, []);

  const setupPeerConnection = useCallback(
    (iceServers) => {
      if (pcRef.current) pcRef.current.close();

      const config = {};
      if (iceServers?.length) {
        config.iceServers = iceServers.map((s) => ({
          urls: s.url || s.urls,
          username: s.username,
          credential: s.credential,
        }));
      }

      const pc = new RTCPeerConnection(config);
      pcRef.current = pc;

      pc.ondatachannel = (event) => {
        const dc = event.channel;
        dc.binaryType = "arraybuffer";
        dcRef.current = dc;

        let screenWidth = 0;
        let screenHeight = 0;
        const canvas = videoRef.current;
        let ctx = null;
        let lastPenX = 0;
        let lastPenY = 0;
        let rotation = 0;
        const frameQueue = [];
        let rafPending = false;
        let pendingBuffer = null;
        let pendingExpected = 0;
        let pendingReceived = 0;

        function updateCursor() {
          const cursor = document.getElementById("pen-cursor");
          if (!cursor || !canvas) return;
          if (lastPenX === 0 && lastPenY === 0) {
            cursor.style.display = "none";
            return;
          }
          const rect = canvas.getBoundingClientRect();
          const cw = canvas.width;
          const ch = canvas.height;
          const rot = ((manualRotationRef.current % 360) + 360) % 360;
          const isLandscape = rot === 90 || rot === 270;
          const renderedW = isLandscape ? rect.height : rect.width;
          const renderedH = isLandscape ? rect.width : rect.height;
          const scaleX = renderedW / cw;
          const scaleY = renderedH / ch;

          const cx = (lastPenX - cw / 2) * scaleX;
          const cy = (lastPenY - ch / 2) * scaleY;

          const rad = rot * Math.PI / 180;
          const rx = cx * Math.cos(rad) - cy * Math.sin(rad);
          const ry = cx * Math.sin(rad) + cy * Math.cos(rad);

          const screenX = rect.left + rect.width / 2 + rx;
          const screenY = rect.top + rect.height / 2 + ry;

          cursor.style.display = "block";
          cursor.style.left = (screenX - 4) + "px";
          cursor.style.top = (screenY - 4) + "px";
        }

        dc.onopen = () => {
          recordDiagnostic("datachannel_open", "WebRTC data channel opened");
          const header = new TextEncoder().encode("reMarkable");
          const buf = new ArrayBuffer(header.length + 2);
          new Uint8Array(buf).set(header);
          dc.send(buf);
          pc.getStats().then(stats => {
            stats.forEach(s => {
              if (s.type === "candidate-pair" && s.state === "succeeded") {
                const local = stats.get(s.localCandidateId);
                const remote = stats.get(s.remoteCandidateId);
                console.debug("[screenshare] selected candidate pair:", local?.candidateType, remote?.candidateType, s.nominated ? "(active)" : "");
              }
            });
          });
        };

        dc.onmessage = (e) => {
          const data = e.data;
          if (!(data instanceof ArrayBuffer)) return;
          const bytes = new Uint8Array(data);
          if (bytes.length === 0) return;

          if (pendingBuffer && pendingExpected > 0) {
            const chunk = new Uint8Array(data);
            const remaining = pendingExpected - pendingReceived;
            const take = Math.min(chunk.byteLength, remaining);
            pendingBuffer.set(chunk.subarray(0, take), pendingReceived);
            pendingReceived += take;
            if (pendingReceived < pendingExpected) return;
          }

          const msgType = pendingBuffer ? 0x00 : bytes[0];

          // 'h' = header with screen dimensions
          if (msgType === 0x68 && bytes.length >= 7) {
            const view = new DataView(data);
            screenWidth = view.getUint16(3, false);
            screenHeight = view.getUint16(5, false);
            if (canvas) {
              canvas.width = screenWidth;
              canvas.height = screenHeight;
              ctx = canvas.getContext("2d", {willReadFrequently: true});
            }
            if (connectionTimerRef.current) clearTimeout(connectionTimerRef.current);
            connectionTimerRef.current = null;
            setStatus(STATUS.STREAMING);
            recordDiagnostic("stream_started", `Screen dimensions ${screenWidth}x${screenHeight}`);
            return;
          }

          // 'g' = heartbeat, 'f' = flag
          if (msgType === 0x67) return;

          if (msgType === 0x66 && bytes.length >= 5) {
            const rv = new DataView(data, 1);
            const rawDeg = rv.getUint32(0, false);
            const newRotation = (360 - rawDeg) % 360;
            if (newRotation !== rotation) {
              const prev = rotation;
              rotation = newRotation;
              setManualRotation(r => {
                const target = r + ((newRotation - prev + 540) % 360 - 180);
                return target;
              });
            }
            return;
          }

          // 'd' = pen position (5 bytes: [0x64, x_hi, x_lo, y_hi, y_lo])
          if (msgType === 0x64 && bytes.length === 5 && ctx) {
            const penX = (bytes[1] << 8) | bytes[2];
            const penY = (bytes[3] << 8) | bytes[4];
            lastPenX = penX;
            lastPenY = penY;
            updateCursor();
            return;
          }

          // frame data: [type(1), rectCount(2), deflatedSize(4), zlib...]
          if ((pendingBuffer && pendingReceived >= pendingExpected) || (msgType === 0x00 && bytes.length > 7 && ctx)) {
            let frameBytes;
            if (pendingBuffer && pendingReceived >= pendingExpected) {
              frameBytes = pendingBuffer;
              pendingBuffer = null;
              pendingExpected = 0;
              pendingReceived = 0;
            } else {
              const declaredSize = new DataView(data, 3, 4).getUint32(0, false);
              const expectedLen = 7 + declaredSize;
              if (bytes.length < expectedLen) {
                pendingBuffer = new Uint8Array(expectedLen);
                pendingBuffer.set(new Uint8Array(data), 0);
                pendingExpected = expectedLen;
                pendingReceived = bytes.length;
                return;
              }
              frameBytes = new Uint8Array(bytes);
            }

            frameQueue.push(frameBytes);
            if (!rafPending) {
              rafPending = true;
              requestAnimationFrame(() => {
                rafPending = false;
                while (frameQueue.length > 0) {
                  const frame = frameQueue.shift();
                  try {
                    const fv = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
                    const rectCount = fv.getUint16(1, false);
                    const deflatedSize = fv.getUint32(3, false);
                    if (7 + deflatedSize > frame.byteLength) continue;
                    const compressed = new Uint8Array(frame.buffer.slice(frame.byteOffset + 7, frame.byteOffset + 7 + deflatedSize));
                    const raw = pako.inflate(compressed);
                    if (!raw || raw.length < 12) continue;

                    const rv = new DataView(raw.buffer);
                    let pos = 0;
                    for (let ri = 0; ri < rectCount; ri++) {
                      if (pos + 12 > raw.byteLength) break;
                      const regionX = rv.getUint16(pos, false);
                      const regionY = rv.getUint16(pos + 2, false);
                      const regionW = rv.getUint16(pos + 4, false);
                      const regionH = rv.getUint16(pos + 6, false);
                      const pxDataLen = rv.getUint32(pos + 8, false);
                      if (pos + 12 + pxDataLen > raw.byteLength) break;

                      const pxView = new DataView(raw.buffer, pos + 12, pxDataLen);
                      const imgData = new ImageData(regionW, regionH);
                      const out = imgData.data;
                      const pixels = regionW * regionH;
                      for (let i = 0; i < pixels; i++) {
                        const val = pxView.getUint16(i * 2, true);
                        const r5 = (val >> 11) & 0x1f;
                        const g6 = (val >> 5) & 0x3f;
                        const b5 = val & 0x1f;
                        out[i * 4] = (r5 << 3) | (r5 >> 2);
                        out[i * 4 + 1] = (g6 << 2) | (g6 >> 4);
                        out[i * 4 + 2] = (b5 << 3) | (b5 >> 2);
                        out[i * 4 + 3] = 255;
                      }
                      pos += 12 + pxDataLen;

                      if (regionX === 0 && regionY === 0 &&
                          regionW >= screenWidth * 0.9 && regionH >= screenHeight * 0.9) {
                        screenWidth = regionW;
                        screenHeight = regionH;
                        canvas.width = screenWidth;
                        canvas.height = screenHeight;
                      }
                      ctx.putImageData(imgData, regionX, regionY);
                    }

                  } catch (e) {
                    console.error("[screenshare] frame error:", e);
                    pendingBuffer = null;
                    pendingExpected = 0;
                    pendingReceived = 0;
                  }
                }
              });
            }
          }
        };

        dc.onclose = () => {
          if (pcRef.current !== pc) return;
          recordDiagnostic("peer_connection", "WebRTC data channel closed");
          if (!disconnectedRef.current) {
            setStatus(STATUS.WAITING);
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            retryTimerRef.current = setTimeout(() => tryJoinRef.current?.(), 1500);
          }
        };
      };

      // Don't trickle ICE candidates. The tablet crashes on mDNS candidates.
      // The SDP answer already contains our ICE info for LAN connectivity.
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.debug("[screenshare] local candidate:", event.candidate.protocol, event.candidate.type, event.candidate.address || "mDNS");
        }
      };

      pc.onicegatheringstatechange = () => {
        console.debug("[screenshare] ICE gathering:", pc.iceGatheringState);
        recordDiagnostic("ice_gathering", pc.iceGatheringState);
      };

      pc.oniceconnectionstatechange = () => {
        console.debug("[screenshare] ICE connection:", pc.iceConnectionState);
        recordDiagnostic("ice_connection", pc.iceConnectionState);
      };

      pc.onconnectionstatechange = () => {
        console.debug("[screenshare] peer connection:", pc.connectionState, "signaling:", pc.signalingState);
        recordDiagnostic("peer_connection", `${pc.connectionState}; signaling=${pc.signalingState}`);

        if (pc.connectionState === "connected") {
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }
        const recover = () => {
          cleanup();
          if (!disconnectedRef.current) {
            setStatus(STATUS.WAITING);
            if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
            retryTimerRef.current = setTimeout(() => tryJoinRef.current?.(), 1500);
          }
        };
        if (pc.connectionState === "failed") {
          recover();
        } else if (pc.connectionState === "disconnected") {
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            if (pc.connectionState === "disconnected") recover();
          }, 5000);
        }
      };

      return pc;
    },
    [cleanup, recordDiagnostic]
  );

  const joinRoom = useCallback(async () => {
    try {
      setStatus(STATUS.CONNECTING);

      const offerRes = await api("offer");
      if (!offerRes.ok) {
        const reason = await offerRes.json().catch(() => ({}));
        throw new Error(reason.error || `Could not get tablet offer (HTTP ${offerRes.status})`);
      }

      const data = await offerRes.json();
      roomIdRef.current = data.roomId;

      const pc = setupPeerConnection(data.iceServers);

      const msgs = data.messages || [];
      const offerMsg = msgs.find(m => {
        let p = m.payload;
        if (p && p.type === "webtrc" && p.payload) p = p.payload;
        return p && p.type === "offer";
      });

      if (!offerMsg) throw new Error("No offer received from device");

      if (offerMsg.clientId) tabletClientIdRef.current = offerMsg.clientId;
      let offerPayload = offerMsg.payload;
      if (offerPayload.type === "webtrc") offerPayload = offerPayload.payload;

      const sdp = offerPayload.description || offerPayload.sdp;
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));

      for (const msg of msgs) {
        let inner = msg.payload;
        if (!inner) continue;
        if (inner.type === "webtrc" && inner.payload) inner = inner.payload;
        if (inner.type === "candidate") {
          await pc.addIceCandidate(new RTCIceCandidate({
            candidate: inner.candidate,
            sdpMid: inner.mid || "0",
          }));
        }
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Wait for ICE gathering to complete so relay candidates are in the SDP
      if (pc.iceGatheringState !== "complete") {
        await new Promise((resolve) => {
          const check = () => {
            if (pc.iceGatheringState === "complete") {
              pc.removeEventListener("icegatheringstatechange", check);
              resolve();
            }
          };
          pc.addEventListener("icegatheringstatechange", check);
          setTimeout(resolve, 5000);
        });
      }

      const answerResponse = await api(`room/${data.roomId}/answer`, {
        method: "POST",
        body: JSON.stringify({
          targetClientId: offerMsg.clientId,
          payload: {
            type: "webtrc",
            payload: { type: "answer", description: pc.localDescription.sdp },
          },
        }),
      });
      if (!answerResponse.ok) throw new Error(`Could not send WebRTC answer (HTTP ${answerResponse.status})`);
      if (connectionTimerRef.current) clearTimeout(connectionTimerRef.current);
      connectionTimerRef.current = setTimeout(() => {
        if (statusRef.current !== STATUS.STREAMING) {
          recordDiagnostic("connection_error", "WebRTC connection did not start streaming within 20 seconds");
          cleanup();
          setErrorMsg("The tablet offer was received, but the WebRTC stream did not start. Reconnecting automatically.");
          setStatus(STATUS.ERROR);
        }
      }, 20000);
    } catch (e) {
      console.error("[screenshare] connection failed:", e);
      cleanup();
      setErrorMsg(e.message);
      setStatus(STATUS.ERROR);
      recordDiagnostic("connection_error", e.message || "Unknown screenshare connection error");
    }
  }, [setupPeerConnection, recordDiagnostic, cleanup]);

  const tryJoin = useCallback(async () => {
    if (!tabletConnectedRef.current || disconnectedRef.current || joinLockRef.current || statusRef.current === STATUS.STREAMING) return;
    joinLockRef.current = true;
    try {
      const room = await api("room");
      if (room.ok) {
        retryCountRef.current = 0;
        await joinRoom();
      }
    } catch (e) {
      recordDiagnostic("connection_error", e.message || "Could not check for an active tablet session");
    } finally {
      joinLockRef.current = false;
    }
  }, [joinRoom, recordDiagnostic]);
  tryJoinRef.current = tryJoin;

  useEffect(() => {
    let eventSource;
    let disposed = false;
    const scheduleRetry = () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      const delay = Math.min(1000 * (2 ** retryCountRef.current), 30000);
      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(() => tryJoinRef.current?.(), delay);
    };
    const connect = () => {
      eventSource = new EventSource(`${constants.ROOT_URL}/screenshare/diagnostics/stream`);
      eventSource.onopen = () => {
        setStreamConnected(true);
        recordDiagnostic("browser_connected", "Browser diagnostics stream connected");
      };
      eventSource.onerror = () => setStreamConnected(false);
      eventSource.addEventListener("snapshot", (event) => {
        const snapshot = JSON.parse(event.data);
        if (disposed) return;
        setTabletConnected(snapshot.tabletConnected);
        tabletConnectedRef.current = snapshot.tabletConnected;
        setRetentionDays(snapshot.retentionDays || 7);
        setDiagnostics(snapshot.events || []);
        tryJoinRef.current?.();
      });
      eventSource.addEventListener("diagnostic", (event) => {
        const item = JSON.parse(event.data);
        if (disposed) return;
        setDiagnostics((previous) => [...previous, item].slice(-200));
        if (item.event === "tablet_mqtt_connected") {
          setTabletConnected(true);
          tabletConnectedRef.current = true;
        }
        if (item.event === "tablet_mqtt_disconnected") {
          setTabletConnected(false);
          tabletConnectedRef.current = false;
        }
        if (["room_created", "tablet_joined_room", "tablet_mqtt_connected"].includes(item.event)) {
          retryCountRef.current = 0;
          tryJoinRef.current?.();
        }
        if (item.event === "connection_error" || item.event === "offer_timeout") scheduleRetry();
      });
    };
    connect();
    return () => {
      disposed = true;
      eventSource?.close();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [recordDiagnostic]);

  useEffect(() => { manualRotationRef.current = manualRotation; }, [manualRotation]);
  useEffect(() => cleanup, [cleanup]);

  const disconnect = () => {
    if (dcRef.current && dcRef.current.readyState === "open") {
      const buf = new ArrayBuffer(4);
      new DataView(buf).setInt32(0, 0x65, false);
      dcRef.current.send(buf);
    }
    cleanup();
    setPoppedOut(false);
    setShowControls(false);
    disconnectedRef.current = true;
    setStatus(STATUS.ERROR);
    setErrorMsg("Disconnected. Start a new screenshare session from the tablet to reconnect.");
  };

  const reconnect = () => {
    disconnectedRef.current = false;
    retryCountRef.current = 0;
    recordDiagnostic("reconnect_requested", "User requested screenshare reconnect");
    setStatus(STATUS.WAITING);
    tryJoinRef.current?.();
  };


  return (
    <Container className="mt-3 mt-md-4 pb-3">
      <div className="d-flex flex-wrap align-items-center gap-2 mb-3" role="tablist" aria-label="Screen share sections">
        <Button variant={activeTab === "share" ? "primary" : "outline-secondary"} role="tab" aria-selected={activeTab === "share"} onClick={() => setActiveTab("share")}>Screen share</Button>
        <Button variant={activeTab === "diagnostics" ? "primary" : "outline-secondary"} role="tab" aria-selected={activeTab === "diagnostics"} onClick={() => setActiveTab("diagnostics")}>Diagnostics <Badge bg={tabletConnected ? "success" : "secondary"}>{tabletConnected ? "Tablet online" : "Tablet offline"}</Badge></Button>
        <small className="text-muted ms-auto">Live updates: {streamConnected ? "connected" : "reconnecting…"}</small>
      </div>
      {activeTab === "diagnostics" ? (
        <section role="tabpanel" aria-label="Screen share diagnostics">
          <Alert variant={tabletConnected ? "success" : "warning"}>
            Tablet MQTT: <strong>{tabletConnected ? "connected" : "not connected"}</strong>. Live diagnostics reconnect automatically; only event summaries are stored, never SDP or ICE credentials.
          </Alert>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <strong>Recent events</strong><small className="text-muted">Retention: {retentionDays} days · showing latest 200</small>
          </div>
          <div className="table-responsive" style={{maxHeight: "65vh", overflowY: "auto"}}>
            <table className="table table-sm table-striped align-middle mb-0">
              <thead className="sticky-top"><tr><th>Time</th><th>Event</th><th>Details</th></tr></thead>
              <tbody>{diagnostics.length ? [...diagnostics].reverse().map((item, index) => <tr key={`${item.at}-${index}`}>
                <td className="text-nowrap">{new Date(item.at).toLocaleString()}</td><td className="text-nowrap">{item.event.replaceAll("_", " ")}</td><td className="text-break">{item.message || "—"}</td>
              </tr>) : <tr><td colSpan="3" className="text-center text-muted py-4">No diagnostics recorded yet.</td></tr>}</tbody>
            </table>
          </div>
        </section>
      ) : <>
      {status === STATUS.ERROR && (
        <Alert variant="info">
          {errorMsg || "The connection is retrying automatically."}
          <Button variant="outline-primary" size="sm" className="ms-3" onClick={reconnect}>Reconnect now</Button>
        </Alert>
      )}

      {status === STATUS.WAITING && (
        <Alert variant="info">
          <Spinner animation="border" size="sm" className="me-2" />
          {tabletConnected ? "Tablet connected. Waiting for it to start screen sharing…" : "Waiting for the tablet to connect. Open Diagnostics for connection details."}
        </Alert>
      )}

      {status === STATUS.CONNECTING && (
        <Alert variant="info">
          <Spinner animation="border" size="sm" className="me-2" />
          Connecting to reMarkable...
        </Alert>
      )}

      <div
        style={poppedOut ? {
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: resolveBackdrop(backdrop),
          display: status === STATUS.STREAMING ? "flex" : "none",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          paddingTop: controlsPosition === "top" ? 40 : 0,
          paddingRight: controlsPosition === "right" ? 50 : 0,
          paddingBottom: controlsPosition === "bottom" ? 80 : 0,
        } : {
          display: status === STATUS.STREAMING ? "flex" : "none",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
        }}
      >
        {(() => {
          const isRotated = ((manualRotation % 360) + 360) % 360 % 180 !== 0;
          const canvasStyle = {
            background: "#000",
            borderRadius: poppedOut ? 0 : "4px",
            transform: `rotate(${manualRotation}deg)`,
            transition: "transform 0.3s ease",
          };
          if (poppedOut) {
            const pad = controlsPosition === "right" ? 56 : 0;
            const topPad = controlsPosition === "top" ? 48 : 0;
            const bottomPad = controlsPosition === "bottom" ? 96 : 0;
            if (isRotated) {
              canvasStyle.maxWidth = `calc(100vh - ${topPad + bottomPad}px)`;
              canvasStyle.maxHeight = `calc(100vw - ${pad}px)`;
            } else {
              canvasStyle.maxWidth = `calc(100vw - ${pad}px)`;
              canvasStyle.maxHeight = `calc(100vh - ${topPad + bottomPad}px)`;
            }
            canvasStyle.width = "auto";
          } else if (isRotated) {
            canvasStyle.height = isMobile ? "55vh" : "70vh";
            canvasStyle.maxWidth = "100%";
            canvasStyle.width = "auto";
          } else {
            canvasStyle.width = "100%";
            canvasStyle.maxWidth = isMobile ? "100%" : "min(600px, 100%)";
            canvasStyle.maxHeight = isMobile ? "70vh" : "none";
          }
          return <canvas ref={videoRef} style={canvasStyle} />;
        })()}
        <div
          id="pen-cursor"
          style={{
            display: "none",
            position: "fixed",
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: "red",
            pointerEvents: "none",
            zIndex: 10000,
          }}
        />
        {(() => {
          const light = poppedOut && isLightColor(resolveBackdrop(backdrop));
          const btnVar = poppedOut ? (light ? "outline-dark" : "outline-light") : "outline-secondary";
          const thumbButtonStyle = poppedOut && isMobile ? {
            minHeight: 44,
            minWidth: 44,
            padding: "0.55rem 0.8rem",
          } : undefined;
          const thumbActionStyle = poppedOut && isMobile ? {
            flex: 1,
            minHeight: 44,
            whiteSpace: "nowrap",
          } : undefined;
          if (poppedOut) {
            return (
              <div ref={controlsRef} style={{
                position: "fixed",
                top: controlsPosition === "bottom" ? "auto" : 8,
                bottom: controlsPosition === "bottom" ? 8 : "auto",
                left: controlsPosition === "bottom" ? 8 : "auto",
                right: 8,
                zIndex: 10001,
                display: "flex",
                flexDirection: controlsPosition === "bottom" ? "row" : "column",
                alignItems: controlsPosition === "right" ? "center" : "flex-end",
                gap: isMobile ? 8 : 4,
                maxHeight: controlsPosition === "bottom" ? "none" : "calc(100vh - 16px)",
                maxWidth: controlsPosition === "bottom" ? "calc(100vw - 16px)" : "none",
                overflowY: "auto",
                width: controlsPosition === "bottom" ? "calc(100vw - 16px)" : "auto",
              }}>
                <div style={{ display: "flex", flexDirection: controlsPosition === "right" ? "column" : "row", gap: isMobile ? 8 : 4, width: controlsPosition === "bottom" ? "100%" : "auto" }}>
                  {controlsPosition === "right" ? (
                    <>
                      <Button variant={btnVar} size="sm" onClick={() => setPoppedOut(false)} title="Exit fullscreen" style={thumbButtonStyle}>
                        <BsFullscreenExit />
                      </Button>
                      <Button variant={btnVar} size="sm" onClick={() => { setShowControls((s) => { if (!s) setPinnedPosition(controlsPosition); return !s; }); }} title="Options" style={thumbButtonStyle}>
                        <BsGearFill />
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant={btnVar} size="sm" onClick={() => { setShowControls((s) => { if (!s) setPinnedPosition(controlsPosition); return !s; }); }} title="Options" style={thumbActionStyle}>
                        <BsGearFill />
                        {isMobile && <span style={{ marginLeft: 6 }}>Options</span>}
                      </Button>
                      <Button variant={btnVar} size="sm" onClick={() => setPoppedOut(false)} title="Exit fullscreen" style={thumbActionStyle}>
                        <BsFullscreenExit />
                        {isMobile && <span style={{ marginLeft: 6 }}>Exit</span>}
                      </Button>
                    </>
                  )}
                </div>
                {showControls && (
                  <div style={{
                    position: "fixed",
                    top: (pinnedPosition || controlsPosition) === "right" ? 90 : (pinnedPosition || controlsPosition) === "bottom" ? "auto" : 8,
                    bottom: (pinnedPosition || controlsPosition) === "bottom" ? 56 : "auto",
                    left: (pinnedPosition || controlsPosition) === "bottom" ? 8 : "auto",
                    right: (pinnedPosition || controlsPosition) === "right" ? 8 : (pinnedPosition || controlsPosition) === "bottom" ? 8 : 90,
                    zIndex: 10002,
                    display: "flex", flexDirection: "column", gap: 4,
                    background: light ? "rgba(255,255,255,0.95)" : "rgba(0,0,0,0.9)",
                    borderRadius: 10, padding: isMobile ? 10 : 8,
                    alignItems: "stretch", minWidth: 160,
                    maxWidth: "calc(100vw - 16px)",
                    width: (pinnedPosition || controlsPosition) === "bottom" ? "calc(100vw - 16px)" : "auto",
                  }}>
                    <div style={{ display: "flex", gap: isMobile ? 8 : 4, flexDirection: isMobile ? "column" : "row" }}>
                      <Button variant={btnVar} size="sm" onClick={() => setManualRotation((r) => r - 90)} title="Rotate counter-clockwise" style={{ flex: 1, whiteSpace: "nowrap", minHeight: isMobile ? 44 : undefined }}>
                        <BsArrowCounterclockwise /> Rotate L
                      </Button>
                      <Button variant={btnVar} size="sm" onClick={() => setManualRotation((r) => r + 90)} title="Rotate clockwise" style={{ flex: 1, whiteSpace: "nowrap", minHeight: isMobile ? 44 : undefined }}>
                        <BsArrowClockwise /> Rotate R
                      </Button>
                    </div>
                    <Button variant={btnVar} size="sm" onClick={disconnect} title="End screenshare session" style={{ minHeight: isMobile ? 44 : undefined }}>
                      Disconnect
                    </Button>
                    <div style={{ display: "flex", gap: isMobile ? 8 : 4, alignItems: "center", justifyContent: isMobile ? "space-between" : "center", marginTop: 2, flexWrap: "wrap" }}>
                      {Object.entries(BACKDROP_PRESETS).map(([name, color]) => (
                        <button
                          key={name}
                          title={name}
                          onClick={() => { setBackdrop(name); setBackdropPref(name); }}
                          style={{
                            width: isMobile ? 32 : 22, height: isMobile ? 32 : 22, borderRadius: 3,
                            border: backdrop === name ? "2px solid #0d6efd" : "1px solid #666",
                            background: color, cursor: "pointer", padding: 0,
                          }}
                        />
                      ))}
                      <label title="Custom color" style={{ position: "relative", width: isMobile ? 32 : 22, height: isMobile ? 32 : 22, cursor: "pointer" }}>
                        <span style={{
                          display: "block", width: isMobile ? 32 : 22, height: isMobile ? 32 : 22, borderRadius: 3,
                          border: !BACKDROP_PRESETS[backdrop] ? "2px solid #0d6efd" : "1px solid #666",
                          background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
                        }} />
                        <input
                          type="color"
                          value={customColor}
                          onClick={() => { setBackdrop(customColor); setBackdropPref(customColor); }}
                          onInput={(e) => {
                            setCustomColor(e.target.value);
                            setCustomColorPref(e.target.value);
                            setBackdrop(e.target.value);
                            setBackdropPref(e.target.value);
                          }}
                          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            );
          }
          return (
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap", width: "100%" }}>
              <Button variant={btnVar} size="sm" onClick={() => setManualRotation((r) => r - 90)} title="Rotate left">
                <BsArrowCounterclockwise />
              </Button>
              <Button variant={btnVar} size="sm" onClick={() => setManualRotation((r) => r + 90)} title="Rotate right">
                <BsArrowClockwise />
              </Button>
              <Button variant={btnVar} size="sm" onClick={() => setPoppedOut(true)}>
                Fullscreen
              </Button>
              <Button variant={btnVar} size="sm" onClick={disconnect}>
                Disconnect
              </Button>
            </div>
          );
        })()}
      </div>
      </>}
    </Container>
  );
}
