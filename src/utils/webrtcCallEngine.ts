import {
  onChildAdded,
  onValue,
  push,
  ref,
  set,
  type Database,
  type Unsubscribe,
} from 'firebase/database';
import type {
  InAppCallStatus,
  WebRtcIceCandidatePayload,
  WebRtcSdpPayload,
} from '../types/bazar';
import { buildRtcConfiguration } from './riderComm';

export interface RingtoneController {
  stop: () => void;
}

export function startCallRingtone(mode: 'INCOMING' | 'OUTGOING'): RingtoneController {
  let stopped = false;
  let audioCtx: AudioContext | null = null;
  let intervalId: number | null = null;
  let vibrateIntervalId: number | null = null;

  const playBurst = () => {
    if (stopped) return;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) {
        audioCtx = new Ctx();
      }
      if (audioCtx.state === 'suspended') {
        void audioCtx.resume().catch(() => {});
      }
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      if (mode === 'INCOMING') {
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.18); // E5
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.46);
      } else {
        osc.frequency.setValueAtTime(440, now); // Standard ringback A4
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.65);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.66);
      }
    } catch {
      // Ignore Web Audio autoplay blocks
    }
  };

  playBurst();
  intervalId = window.setInterval(playBurst, mode === 'INCOMING' ? 1400 : 2400);

  if (mode === 'INCOMING' && typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate([300, 200, 300]);
    } catch {
      // Ignore vibration errors
    }
    vibrateIntervalId = window.setInterval(() => {
      if (stopped) return;
      try {
        navigator.vibrate([300, 200, 300]);
      } catch {
        // Ignore
      }
    }, 1800);
  }

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      if (vibrateIntervalId !== null) {
        window.clearInterval(vibrateIntervalId);
        vibrateIntervalId = null;
      }
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try {
          navigator.vibrate(0);
        } catch {
          // Ignore
        }
      }
      if (audioCtx) {
        void audioCtx.close().catch(() => {});
        audioCtx = null;
      }
    },
  };
}

export interface WebRtcSessionCallbacks {
  onStatusChange: (status: InAppCallStatus, detail?: string) => void;
  onPeerConnected: () => void;
  onMicPermissionError: (permanentlyDenied: boolean, message: string) => void;
  onMicPermissionResolved?: () => void;
}

export interface WebRtcCallSession {
  setMuted: (muted: boolean) => boolean;
  setSpeakerOn: (speakerOn: boolean) => Promise<boolean>;
  retryMicrophone: () => Promise<boolean>;
  cleanup: () => void;
}

function preferOpusCodec(sdp: string): string {
  if (!sdp || !sdp.includes('opus/48000')) return sdp;
  return sdp;
}

async function acquireHardwareMicStream(): Promise<MediaStream> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    throw new Error('MediaDevicesUnavailable');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (firstErr) {
    const errName = firstErr instanceof Error ? firstErr.name : '';
    if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
      throw firstErr;
    }
    // Retry with basic audio: true if advanced constraints failed on device
    return await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
  }
}

function createSilentFallbackStream(): {
  stream: MediaStream | null;
  close: () => void;
} {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return { stream: null, close: () => {} };
    const ctx = new Ctx();
    const dest = ctx.createMediaStreamDestination();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.00001; // Near-zero silent carrier so WebRTC RTP audio transceiver stays active
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    return {
      stream: dest.stream,
      close: () => {
        try {
          osc.stop();
        } catch {
          // Ignore
        }
        void ctx.close().catch(() => {});
      },
    };
  } catch {
    return { stream: null, close: () => {} };
  }
}

export async function startWebRtcVoiceSession(params: {
  db: Database;
  orderId: string;
  tripId?: string;
  role: 'CALLER' | 'RECEIVER';
  beforeSignalingPromise?: Promise<unknown>;
  callbacks: WebRtcSessionCallbacks;
}): Promise<WebRtcCallSession | null> {
  const { db, orderId, tripId, role, beforeSignalingPromise, callbacks } = params;
  let cleanedUp = false;
  let localStream: MediaStream | null = null;
  let fallbackAudioCloser: (() => void) | null = null;
  let usingFallbackMic = false;
  let pc: RTCPeerConnection | null = null;
  let audioSender: RTCRtpSender | null = null;
  let remoteAudioEl: HTMLAudioElement | null = null;
  let speakerAudioCtx: AudioContext | null = null;
  let speakerGainNode: GainNode | null = null;
  const unsubscribers: Unsubscribe[] = [];
  const pendingIceCandidates: RTCIceCandidateInit[] = [];
  const addedCandidateKeys = new Set<string>();
  let remoteDescriptionSet = false;
  let connectedNotified = false;
  let isCurrentlyMuted = false;

  // 1. Request audio-only microphone permission (with non-fatal WebRTC fallback so signaling never dies)
  try {
    localStream = await acquireHardwareMicStream();
    usingFallbackMic = false;
    callbacks.onMicPermissionResolved?.();
  } catch (err) {
    const errName = err instanceof Error ? err.name : '';
    const isPermDenied =
      errName === 'NotAllowedError' || errName === 'PermissionDeniedError';

    const fallback = createSilentFallbackStream();
    localStream = fallback.stream;
    fallbackAudioCloser = fallback.close;
    usingFallbackMic = true;

    callbacks.onMicPermissionError(
      isPermDenied,
      isPermDenied
        ? 'Microphone access blocked by browser/webview. Call is still connecting (you can hear the Rider) — tap "Enable Mic" below or allow Microphone in browser settings.'
        : 'Microphone unavailable on this device. Connecting call in listen-ready mode — tap "Enable Mic" to retry.'
    );
  }

  if (beforeSignalingPromise) {
    try {
      await beforeSignalingPromise;
    } catch {
      localStream?.getTracks().forEach((t) => t.stop());
      fallbackAudioCloser?.();
      return null;
    }
  }

  if (cleanedUp) {
    localStream?.getTracks().forEach((t) => t.stop());
    fallbackAudioCloser?.();
    return null;
  }

  // 2. Setup remote audio playback element + Web Audio gain node for Speaker mode
  remoteAudioEl = document.createElement('audio');
  remoteAudioEl.autoplay = true;
  remoteAudioEl.setAttribute('playsinline', 'true');
  remoteAudioEl.style.display = 'none';
  document.body.appendChild(remoteAudioEl);

  try {
    pc = new RTCPeerConnection(buildRtcConfiguration());
  } catch {
    try {
      pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }],
      });
    } catch {
      pc = new RTCPeerConnection();
    }
  }

  if (localStream && localStream.getAudioTracks().length > 0) {
    localStream.getAudioTracks().forEach((track) => {
      if (pc && localStream) {
        audioSender = pc.addTrack(track, localStream);
      }
    });
  } else {
    try {
      const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
      audioSender = transceiver.sender;
    } catch {
      // Ignore if addTransceiver not supported
    }
  }

  pc.ontrack = (event) => {
    if (cleanedUp || !remoteAudioEl) return;
    const [remoteStream] = event.streams;
    if (remoteStream) {
      remoteAudioEl.srcObject = remoteStream;
      void remoteAudioEl.play().catch(() => {});
    }
  };

  const localCandidatesPath =
    role === 'CALLER'
      ? `inAppCalls/${orderId}/webrtc/callerCandidates`
      : `inAppCalls/${orderId}/webrtc/receiverCandidates`;
  const remoteCandidatesPath =
    role === 'CALLER'
      ? `inAppCalls/${orderId}/webrtc/receiverCandidates`
      : `inAppCalls/${orderId}/webrtc/callerCandidates`;

  pc.onicecandidate = (event) => {
    if (cleanedUp || !event.candidate) return;
    const candidateJson: WebRtcIceCandidatePayload = {
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid ?? null,
      sdpMLineIndex: event.candidate.sdpMLineIndex ?? null,
      usernameFragment: event.candidate.usernameFragment ?? null,
      createdAt: Date.now(),
    };
    void push(ref(db, localCandidatesPath), candidateJson).catch(() => {});
    if (tripId && tripId !== orderId) {
      const tripLocalCandidatesPath =
        role === 'CALLER'
          ? `inAppCalls/${tripId}/webrtc/callerCandidates`
          : `inAppCalls/${tripId}/webrtc/receiverCandidates`;
      void push(ref(db, tripLocalCandidatesPath), candidateJson).catch(() => {});
    }
  };

  const notifyConnectedOnce = () => {
    if (cleanedUp || connectedNotified) return;
    connectedNotified = true;
    callbacks.onPeerConnected();
  };

  pc.onconnectionstatechange = () => {
    if (cleanedUp || !pc) return;
    const st = pc.connectionState;
    if (st === 'connecting') {
      callbacks.onStatusChange('CONNECTING');
    } else if (st === 'connected') {
      notifyConnectedOnce();
    } else if (st === 'disconnected') {
      try {
        pc.restartIce();
      } catch {
        // Ignore
      }
    } else if (st === 'failed') {
      callbacks.onStatusChange('FAILED', 'Peer connection failed');
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (cleanedUp || !pc) return;
    const ice = pc.iceConnectionState;
    if (ice === 'checking') {
      callbacks.onStatusChange('CONNECTING');
    } else if (ice === 'connected' || ice === 'completed') {
      notifyConnectedOnce();
    } else if (ice === 'disconnected') {
      try {
        pc.restartIce();
      } catch {
        // Ignore
      }
    } else if (ice === 'failed') {
      callbacks.onStatusChange('FAILED', 'ICE negotiation failed');
    }
  };

  const flushQueuedCandidates = async () => {
    if (!pc || !remoteDescriptionSet) return;
    while (pendingIceCandidates.length > 0) {
      const cand = pendingIceCandidates.shift();
      if (cand) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch {
          // Ignore malformed candidate
        }
      }
    }
  };

  const handleIncomingCandidate = (key: string, val: WebRtcIceCandidatePayload | null) => {
    if (cleanedUp || !pc || !val || !val.candidate) return;
    if (addedCandidateKeys.has(key)) return;
    addedCandidateKeys.add(key);

    const candidateInit: RTCIceCandidateInit = {
      candidate: val.candidate,
      sdpMid: val.sdpMid ?? null,
      sdpMLineIndex: val.sdpMLineIndex ?? null,
      usernameFragment: val.usernameFragment ?? undefined,
    };

    if (!remoteDescriptionSet) {
      pendingIceCandidates.push(candidateInit);
    } else {
      void pc.addIceCandidate(new RTCIceCandidate(candidateInit)).catch(() => {});
    }
  };

  // Listen to remote ICE candidates on primary orderId (and tripId fallback)
  unsubscribers.push(
    onChildAdded(ref(db, remoteCandidatesPath), (snap) => {
      handleIncomingCandidate(
        snap.key || `${Date.now()}_${Math.random()}`,
        snap.val() as WebRtcIceCandidatePayload | null
      );
    })
  );
  if (tripId && tripId !== orderId) {
    const tripRemoteCandidatesPath =
      role === 'CALLER'
        ? `inAppCalls/${tripId}/webrtc/receiverCandidates`
        : `inAppCalls/${tripId}/webrtc/callerCandidates`;
    unsubscribers.push(
      onChildAdded(ref(db, tripRemoteCandidatesPath), (snap) => {
        handleIncomingCandidate(
          snap.key || `${Date.now()}_${Math.random()}`,
          snap.val() as WebRtcIceCandidatePayload | null
        );
      })
    );
  }

  // 3. Negotiate Offer / Answer
  if (role === 'CALLER') {
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: false,
    });
    const offerPayload: WebRtcSdpPayload = {
      type: 'offer',
      sdp: preferOpusCodec(offer.sdp || ''),
    };
    await pc.setLocalDescription(offerPayload);
    await set(ref(db, `inAppCalls/${orderId}/webrtc/offer`), offerPayload);
    if (tripId && tripId !== orderId) {
      await set(ref(db, `inAppCalls/${tripId}/webrtc/offer`), offerPayload).catch(
        () => {}
      );
    }

    const handleRemoteAnswer = async (ans: WebRtcSdpPayload | null) => {
      if (cleanedUp || !pc || remoteDescriptionSet) return;
      if (!ans || ans.type !== 'answer' || !ans.sdp) return;
      try {
        callbacks.onStatusChange('CONNECTING');
        await pc.setRemoteDescription(new RTCSessionDescription(ans));
        remoteDescriptionSet = true;
        await flushQueuedCandidates();
      } catch {
        // Ignore duplicate setRemoteDescription
      }
    };

    unsubscribers.push(
      onValue(ref(db, `inAppCalls/${orderId}/webrtc/answer`), (snap) => {
        void handleRemoteAnswer(snap.val() as WebRtcSdpPayload | null);
      })
    );
    if (tripId && tripId !== orderId) {
      unsubscribers.push(
        onValue(ref(db, `inAppCalls/${tripId}/webrtc/answer`), (snap) => {
          void handleRemoteAnswer(snap.val() as WebRtcSdpPayload | null);
        })
      );
    }
  } else {
    // role === 'RECEIVER' (Customer answering Rider's call)
    callbacks.onStatusChange('CONNECTING');
    const handleRemoteOffer = async (offer: WebRtcSdpPayload | null) => {
      if (cleanedUp || !pc || remoteDescriptionSet) return;
      if (!offer || offer.type !== 'offer' || !offer.sdp) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        remoteDescriptionSet = true;
        await flushQueuedCandidates();
        const answer = await pc.createAnswer();
        const answerPayload: WebRtcSdpPayload = {
          type: 'answer',
          sdp: preferOpusCodec(answer.sdp || ''),
        };
        await pc.setLocalDescription(answerPayload);
        await set(ref(db, `inAppCalls/${orderId}/webrtc/answer`), answerPayload);
        if (tripId && tripId !== orderId) {
          await set(ref(db, `inAppCalls/${tripId}/webrtc/answer`), answerPayload).catch(
            () => {}
          );
        }
      } catch {
        callbacks.onStatusChange('FAILED', 'Failed to negotiate call answer');
      }
    };

    unsubscribers.push(
      onValue(ref(db, `inAppCalls/${orderId}/webrtc/offer`), (snap) => {
        void handleRemoteOffer(snap.val() as WebRtcSdpPayload | null);
      })
    );
    if (tripId && tripId !== orderId) {
      unsubscribers.push(
        onValue(ref(db, `inAppCalls/${tripId}/webrtc/offer`), (snap) => {
          void handleRemoteOffer(snap.val() as WebRtcSdpPayload | null);
        })
      );
    }
  }

  return {
    setMuted: (muted: boolean) => {
      isCurrentlyMuted = muted;
      if (!localStream) return muted;
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !muted;
      });
      return muted;
    },
    retryMicrophone: async () => {
      if (cleanedUp || !pc) return false;
      try {
        const liveStream = await acquireHardwareMicStream();
        const newTrack = liveStream.getAudioTracks()[0];
        if (!newTrack) return false;
        newTrack.enabled = !isCurrentlyMuted;

        if (audioSender) {
          await audioSender.replaceTrack(newTrack);
        } else {
          audioSender = pc.addTrack(newTrack, liveStream);
        }

        if (localStream) {
          localStream.getTracks().forEach((t) => {
            try {
              t.stop();
            } catch {
              // Ignore
            }
          });
        }
        fallbackAudioCloser?.();
        fallbackAudioCloser = null;
        localStream = liveStream;
        usingFallbackMic = false;
        callbacks.onMicPermissionResolved?.();
        return true;
      } catch (err) {
        const errName = err instanceof Error ? err.name : '';
        const isPermDenied =
          errName === 'NotAllowedError' || errName === 'PermissionDeniedError';
        callbacks.onMicPermissionError(
          isPermDenied,
          isPermDenied
            ? 'Microphone still blocked. Tap the lock icon in your browser address bar -> Permissions -> Allow Microphone.'
            : 'Could not capture microphone audio. Please check your audio device.'
        );
        return !usingFallbackMic;
      }
    },
    setSpeakerOn: async (speakerOn: boolean) => {
      if (!remoteAudioEl) return false;
      remoteAudioEl.volume = 1.0;
      const sinkEl = remoteAudioEl as HTMLAudioElement & {
        setSinkId?: (sinkId: string) => Promise<void>;
      };
      if (typeof sinkEl.setSinkId === 'function' && navigator.mediaDevices?.enumerateDevices) {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audioOutputs = devices.filter((d) => d.kind === 'audiooutput');
          if (speakerOn) {
            const speakerDev =
              audioOutputs.find((d) => /speaker|handsfree/i.test(d.label)) ||
              audioOutputs[0];
            if (speakerDev?.deviceId) {
              await sinkEl.setSinkId(speakerDev.deviceId);
            }
          } else {
            const earpieceDev =
              audioOutputs.find((d) => /earpiece|communications|default/i.test(d.label)) ||
              audioOutputs[0];
            if (earpieceDev?.deviceId) {
              await sinkEl.setSinkId(earpieceDev.deviceId);
            }
          }
        } catch {
          // Fallback to Web Audio gain boost below
        }
      }
      try {
        if (speakerOn && remoteAudioEl.srcObject instanceof MediaStream) {
          const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
              .webkitAudioContext;
          if (Ctx && !speakerAudioCtx) {
            speakerAudioCtx = new Ctx();
            const source = speakerAudioCtx.createMediaStreamSource(
              remoteAudioEl.srcObject
            );
            speakerGainNode = speakerAudioCtx.createGain();
            speakerGainNode.gain.value = 1.65;
            source.connect(speakerGainNode);
            speakerGainNode.connect(speakerAudioCtx.destination);
          } else if (speakerGainNode) {
            speakerGainNode.gain.value = 1.65;
          }
        } else if (speakerGainNode) {
          speakerGainNode.gain.value = 1.0;
        }
      } catch {
        // Ignore Web Audio routing errors
      }
      return speakerOn;
    },
    cleanup: () => {
      if (cleanedUp) return;
      cleanedUp = true;
      unsubscribers.forEach((unsub) => {
        try {
          unsub();
        } catch {
          // Ignore
        }
      });
      unsubscribers.length = 0;
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch {
            // Ignore
          }
        });
        localStream = null;
      }
      fallbackAudioCloser?.();
      fallbackAudioCloser = null;
      if (pc) {
        try {
          pc.ontrack = null;
          pc.onicecandidate = null;
          pc.onconnectionstatechange = null;
          pc.oniceconnectionstatechange = null;
          pc.close();
        } catch {
          // Ignore
        }
        pc = null;
      }
      if (speakerAudioCtx) {
        void speakerAudioCtx.close().catch(() => {});
        speakerAudioCtx = null;
        speakerGainNode = null;
      }
      if (remoteAudioEl) {
        try {
          remoteAudioEl.pause();
          remoteAudioEl.srcObject = null;
          remoteAudioEl.remove();
        } catch {
          // Ignore
        }
        remoteAudioEl = null;
      }
    },
  };
}
