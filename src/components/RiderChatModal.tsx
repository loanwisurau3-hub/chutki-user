import React, { useEffect, useRef, useState } from 'react';
import type { DeliveryPartner, GroupedOrder, TripChatMessage } from '../types/bazar';
import { getCanonicalOrderIdForGroup } from '../utils/riderComm';
import { sanitizeSafeUrl } from '../utils/security';
import { triggerHaptic } from '../utils/haptics';

interface RiderChatModalProps {
  group: GroupedOrder | null;
  rider?: DeliveryPartner | null;
  messages: TripChatMessage[];
  allowVoiceCall?: boolean;
  isSending?: boolean;
  onClose: () => void;
  onSendMessage: (text: string) => void;
  onRetryMessage: (msg: TripChatMessage) => void;
  onStartVoiceCall: (group: GroupedOrder) => void;
}

const QUICK_REPLIES = [
  'Please call me when you arrive.',
  'I am waiting near the main gate.',
  'Please leave the order at the doorstep.',
];

export const RiderChatModal: React.FC<RiderChatModalProps> = ({
  group,
  rider,
  messages,
  allowVoiceCall = true,
  isSending = false,
  onClose,
  onSendMessage,
  onRetryMessage,
  onStartVoiceCall,
}) => {
  const [draft, setDraft] = useState('');
  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (group && listEndRef.current) {
      listEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [group, messages.length]);

  if (!group) return null;

  const orderId = getCanonicalOrderIdForGroup(group);
  const shortOrderId = `#${orderId.slice(-6)}`;
  const riderName = rider?.name || 'Delivery Rider';
  const isRiderOnline = rider?.online !== false;
  const rawPhoto = rider?.photoUrl || rider?.imageUrl || '';
  const safePhoto = sanitizeSafeUrl(rawPhoto, true);
  const initialLetter = riderName.trim().charAt(0).toUpperCase() || 'R';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || isSending) return;
    triggerHaptic('tap');
    onSendMessage(trimmed);
    setDraft('');
  };

  const renderStatusTicks = (msg: TripChatMessage) => {
    if (msg.status === 'SENDING') {
      return (
        <span className="text-[10px] text-emerald-100/80" title="Sending...">
          ⏳
        </span>
      );
    }
    if (msg.status === 'FAILED') {
      return (
        <button
          type="button"
          onClick={() => onRetryMessage(msg)}
          className="ml-1 inline-flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white"
          data-testid={`retry-msg-${msg.messageId}`}
        >
          ⚠️ Retry
        </button>
      );
    }
    if (msg.status === 'READ') {
      return (
        <span
          className="text-[11px] font-black text-sky-200"
          title="Read"
          data-testid={`msg-status-${msg.messageId}`}
        >
          ✓✓
        </span>
      );
    }
    if (msg.status === 'DELIVERED') {
      return (
        <span
          className="text-[11px] font-black text-emerald-100/90"
          title="Delivered"
          data-testid={`msg-status-${msg.messageId}`}
        >
          ✓✓
        </span>
      );
    }
    return (
      <span
        className="text-[11px] font-black text-emerald-100/85"
        title="Sent"
        data-testid={`msg-status-${msg.messageId}`}
      >
        ✓
      </span>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[9990] flex flex-col bg-slate-900/60 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={`Chat with rider ${riderName}`}
      data-testid="rider-chat-modal"
    >
      <div className="mx-auto flex h-full w-full max-w-[480px] flex-col bg-[#efeae2] shadow-2xl">
        {/* WhatsApp-style Chutki Green Header */}
        <header className="flex items-center justify-between bg-[#0c831f] px-3.5 py-3 text-white shadow-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => {
                triggerHaptic('tap');
                onClose();
              }}
              aria-label="Close rider chat"
              data-testid="close-rider-chat-btn"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <i className="fa-solid fa-arrow-left text-sm" aria-hidden="true" />
            </button>

            {safePhoto ? (
              <img
                src={safePhoto}
                alt={riderName}
                className="h-10 w-10 shrink-0 rounded-full object-cover border-2 border-white/40"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-white/40 bg-emerald-800 text-base font-black text-white">
                {initialLetter}
              </div>
            )}

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <strong
                  className="truncate text-sm font-black text-white"
                  data-testid="chat-header-rider-name"
                >
                  {riderName}
                </strong>
                <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-extrabold text-emerald-100">
                  {shortOrderId}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-100">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    isRiderOnline ? 'bg-lime-300' : 'bg-slate-300'
                  }`}
                />
                <span data-testid="chat-rider-presence">
                  {isRiderOnline ? 'Online • Active Trip' : 'Offline • Notifications On'}
                </span>
              </div>
            </div>
          </div>

          {allowVoiceCall && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic('tap');
                onStartVoiceCall(group);
              }}
              aria-label={`In-App Voice Call with ${riderName}`}
              data-testid="chat-header-call-btn"
              className="flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-black text-[#0c831f] shadow-sm active:scale-95 transition-transform"
            >
              <i className="fa-solid fa-phone text-xs" aria-hidden="true" />
              <span>Call</span>
            </button>
          )}
        </header>

        {/* Privacy Banner */}
        <div className="bg-amber-50 border-b border-amber-200/80 px-3 py-1.5 text-center text-[11px] font-bold text-amber-900">
          <i className="fa-solid fa-shield-halved mr-1 text-amber-700" aria-hidden="true" />
          Private Trip Chat • Phone numbers are hidden for your privacy
        </div>

        {/* Messages Body */}
        <div
          className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5"
          data-testid="rider-chat-messages-list"
        >
          {messages.length === 0 ? (
            <div
              className="my-6 mx-auto max-w-xs rounded-2xl bg-white/90 p-4 text-center shadow-xs"
              data-testid="rider-chat-empty-state"
            >
              <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-[#0c831f]">
                <i className="fa-solid fa-comments text-lg" aria-hidden="true" />
              </div>
              <p className="text-xs font-extrabold text-slate-800">
                Chat with {riderName} ({shortOrderId})
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Send delivery directions or tap a quick message below:
              </p>
              <div className="mt-3 flex flex-col gap-1.5">
                {QUICK_REPLIES.map((qr) => (
                  <button
                    key={qr}
                    type="button"
                    onClick={() => {
                      triggerHaptic('tap');
                      onSendMessage(qr);
                    }}
                    className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-3 py-1.5 text-left text-xs font-bold text-[#0c831f] hover:bg-emerald-100"
                  >
                    “{qr}”
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isCustomer = msg.senderRole === 'CUSTOMER';
              const timeStr = msg.timestamp
                ? new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '';

              return (
                <div
                  key={msg.messageId}
                  className={`flex ${isCustomer ? 'justify-end' : 'justify-start'}`}
                  data-testid={`chat-bubble-${msg.senderRole.toLowerCase()}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3.5 py-2 shadow-xs ${
                      isCustomer
                        ? 'rounded-br-xs bg-[#0c831f] text-white'
                        : 'rounded-bl-xs bg-white text-slate-800 border border-slate-200/70'
                    }`}
                  >
                    {!isCustomer && (
                      <div className="mb-0.5 text-[10px] font-black text-emerald-700">
                        {riderName}
                      </div>
                    )}
                    <div className="text-[13px] leading-snug break-words font-medium">
                      {msg.message}
                    </div>
                    <div
                      className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${
                        isCustomer ? 'text-emerald-100/90' : 'text-slate-400'
                      }`}
                    >
                      <span>{timeStr}</span>
                      {isCustomer && renderStatusTicks(msg)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={listEndRef} />
        </div>

        {/* Bottom Message Input */}
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-2.5"
        >
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a message to rider..."
            maxLength={500}
            aria-label="Message to rider"
            data-testid="rider-chat-input"
            className="flex-1 rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0c831f] focus:bg-white focus:outline-none"
          />
          <button
            type="submit"
            disabled={!draft.trim() || isSending}
            aria-label="Send message"
            data-testid="rider-chat-send-btn"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0c831f] text-white shadow-sm disabled:opacity-45 active:scale-95 transition-transform"
          >
            <i className="fa-solid fa-paper-plane text-sm" aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
  );
};
