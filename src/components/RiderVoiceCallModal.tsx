import React, { useEffect, useState } from 'react';
import type { DeliveryPartner, InAppCallRecord } from '../types/bazar';
import { formatCallDuration } from '../utils/riderComm';
import { sanitizeSafeUrl } from '../utils/security';
import { triggerHaptic } from '../utils/haptics';

interface RiderVoiceCallModalProps {
  call: InAppCallRecord | null;
  rider?: DeliveryPartner | null;
  isMuted: boolean;
  isSpeakerOn: boolean;
  micPermissionError?: string | null;
  onAnswerIncoming: () => void;
  onDeclineIncoming: () => void;
  onEndCall: () => void;
  onToggleMute: () => void;
  onToggleSpeaker: () => void;
  onRetryMicrophone?: () => void;
}

export const RiderVoiceCallModal: React.FC<RiderVoiceCallModalProps> = ({
  call,
  rider,
  isMuted,
  isSpeakerOn,
  micPermissionError,
  onAnswerIncoming,
  onDeclineIncoming,
  onEndCall,
  onToggleMute,
  onToggleSpeaker,
  onRetryMicrophone,
}) => {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!call || call.status !== 'CONNECTED' || !call.connectedAt) {
      return undefined;
    }
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [call?.callId, call?.status, call?.connectedAt]);

  if (!call) return null;

  const isIncomingRinging =
    call.callerRole === 'RIDER' &&
    call.status === 'RINGING' &&
    !call.customerAnswered;

  const riderName = call.riderName || rider?.name || 'Delivery Rider';
  const rawPhoto = call.riderPhotoUrl || rider?.photoUrl || rider?.imageUrl || '';
  const safePhoto = sanitizeSafeUrl(rawPhoto, true);
  const shortOrderId = `#${(call.orderId || call.tripId || '').slice(-6)}`;
  const initialLetter = riderName.trim().charAt(0).toUpperCase() || 'R';

  const getStatusLabel = (): string => {
    switch (call.status) {
      case 'CALLING':
        return 'Calling Rider...';
      case 'RINGING':
        return call.callerRole === 'RIDER' ? 'Incoming voice call' : 'Ringing...';
      case 'CONNECTING':
        return 'Connecting WebRTC audio...';
      case 'CONNECTED':
        return formatCallDuration(call.connectedAt, nowMs);
      case 'DECLINED':
        return 'Call Declined';
      case 'BUSY':
        return 'Rider is busy on another call';
      case 'TIMEOUT':
        return 'No Answer (Timed Out)';
      case 'FAILED':
        return 'Call Connection Failed';
      case 'ENDED':
        return 'Call Ended';
      default:
        return call.status;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col justify-between bg-gradient-to-b from-[#075e54] via-[#064e3b] to-[#022c22] text-white p-6 select-none"
      role="dialog"
      aria-modal="true"
      aria-label={isIncomingRinging ? 'Incoming voice call from rider' : 'In-app voice call with rider'}
      data-testid="rider-voice-call-modal"
    >
      {/* Top Header */}
      <div className="flex flex-col items-center pt-4 text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1 text-xs font-bold tracking-wide text-emerald-200 mb-4">
          <i className="fa-solid fa-lock text-[11px]" aria-hidden="true" />
          <span>CHUTKI IN-APP VOICE CALL • NUMBER PROTECTED</span>
        </div>

        <div className="text-xs font-semibold uppercase tracking-widest text-emerald-300/90 mb-1">
          Order {shortOrderId}
        </div>
        <h2
          className="text-2xl font-black tracking-tight text-white mt-0.5"
          data-testid="call-rider-name"
        >
          {riderName}
        </h2>
        <p
          className="mt-1.5 text-sm font-bold text-emerald-100"
          data-testid="call-status-label"
        >
          {getStatusLabel()}
        </p>
      </div>

      {/* Center Avatar & Status */}
      <div className="flex flex-col items-center justify-center my-auto">
        <div className="relative flex items-center justify-center">
          {(call.status === 'RINGING' || call.status === 'CALLING') && (
            <span
              className="absolute inset-0 rounded-full bg-emerald-400/25 animate-ping"
              aria-hidden="true"
            />
          )}
          {safePhoto ? (
            <img
              src={safePhoto}
              alt={riderName}
              className="relative z-10 h-28 w-28 rounded-full object-cover border-4 border-emerald-300/40 shadow-2xl"
            />
          ) : (
            <div className="relative z-10 flex h-28 w-28 items-center justify-center rounded-full border-4 border-emerald-300/40 bg-emerald-700 text-4xl font-black text-white shadow-2xl">
              {initialLetter}
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl bg-black/20 px-3.5 py-1.5 text-xs font-semibold text-emerald-100">
          <i className="fa-solid fa-motorcycle text-emerald-300" aria-hidden="true" />
          <span>Assigned Delivery Partner • Order {shortOrderId}</span>
        </div>

        {micPermissionError && (
          <div
            className="mt-4 max-w-xs rounded-xl border border-amber-300/40 bg-amber-950/75 p-3 text-center text-xs font-semibold text-amber-100"
            role="alert"
            data-testid="call-mic-error"
          >
            <div>
              <i className="fa-solid fa-microphone-slash mr-1.5 text-amber-300" />
              {micPermissionError}
            </div>
            {onRetryMicrophone && (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('tap');
                  onRetryMicrophone();
                }}
                data-testid="call-retry-mic-btn"
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-extrabold text-white shadow hover:bg-emerald-400 active:scale-95 transition-transform"
              >
                <i className="fa-solid fa-microphone" aria-hidden="true" />
                <span>Enable Mic / Retry</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bottom Call Controls */}
      {isIncomingRinging ? (
        <div className="pb-6">
          <p className="text-center text-xs font-semibold text-emerald-200 mb-5">
            Incoming voice call regarding your active delivery {shortOrderId}
          </p>
          <div className="flex items-center justify-around max-w-xs mx-auto">
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('warning');
                  onDeclineIncoming();
                }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-xl active:scale-95 transition-transform"
                aria-label="Decline incoming call"
                data-testid="decline-incoming-call-btn"
              >
                <i className="fa-solid fa-phone-slash text-xl" aria-hidden="true" />
              </button>
              <span className="text-xs font-bold text-red-200">Decline</span>
            </div>

            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('success');
                  onAnswerIncoming();
                }}
                className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-xl active:scale-95 transition-transform"
                aria-label="Answer incoming call"
                data-testid="answer-incoming-call-btn"
              >
                <i className="fa-solid fa-phone text-xl" aria-hidden="true" />
              </button>
              <span className="text-xs font-bold text-emerald-200">Answer</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="pb-6">
          <div className="mx-auto flex max-w-xs items-center justify-around rounded-3xl bg-black/25 px-5 py-4 backdrop-blur-md">
            {/* Mute / Unmute */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('tap');
                  onToggleMute();
                }}
                aria-pressed={isMuted}
                aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                data-testid="call-mute-toggle-btn"
                className={`flex h-13 w-13 items-center justify-center rounded-full transition-colors ${
                  isMuted
                    ? 'bg-white text-slate-900'
                    : 'bg-white/15 text-white hover:bg-white/25'
                }`}
              >
                <i
                  className={`fa-solid ${
                    isMuted ? 'fa-microphone-slash' : 'fa-microphone'
                  } text-lg`}
                  aria-hidden="true"
                />
              </button>
              <span className="text-[11px] font-bold text-emerald-100">
                {isMuted ? 'Muted' : 'Mute'}
              </span>
            </div>

            {/* End Call */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('warning');
                  onEndCall();
                }}
                aria-label="End voice call"
                data-testid="call-end-btn"
                className="flex h-15 w-15 items-center justify-center rounded-full bg-red-600 text-white shadow-lg active:scale-95 transition-transform"
              >
                <i className="fa-solid fa-phone-slash text-xl" aria-hidden="true" />
              </button>
              <span className="text-[11px] font-bold text-red-200">End Call</span>
            </div>

            {/* Speaker ON / OFF */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('tap');
                  onToggleSpeaker();
                }}
                aria-pressed={isSpeakerOn}
                aria-label={isSpeakerOn ? 'Turn speaker off' : 'Turn speaker on'}
                data-testid="call-speaker-toggle-btn"
                className={`flex h-13 w-13 items-center justify-center rounded-full transition-colors ${
                  isSpeakerOn
                    ? 'bg-white text-slate-900'
                    : 'bg-white/15 text-white hover:bg-white/25'
                }`}
              >
                <i
                  className={`fa-solid ${
                    isSpeakerOn ? 'fa-volume-high' : 'fa-volume-low'
                  } text-lg`}
                  aria-hidden="true"
                />
              </button>
              <span className="text-[11px] font-bold text-emerald-100">
                {isSpeakerOn ? 'Speaker ON' : 'Speaker'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
