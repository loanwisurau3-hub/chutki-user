import React, { useEffect, useRef, useState } from 'react';
import type { DeliveryPartner, GroupedOrder, TripChatMessage } from '../types/bazar';
import { formatTelHref, getCanonicalOrderIdForGroup } from '../utils/riderComm';
import { sanitizeSafeUrl } from '../utils/security';
import { triggerHaptic } from '../utils/haptics';

interface RiderChatModalProps {
  group: GroupedOrder | null;
  rider?: DeliveryPartner | null;
  messages: TripChatMessage[];
  allowRiderCall?: boolean;
  isSending?: boolean;
  onClose: () => void;
  onSendMessage: (text: string) => void;
  onRetryMessage: (msg: TripChatMessage) => void;
  onCallUnavailable?: () => void;
}

const QUICK_REPLIES = [
  '📍 Arrived near gate, call me',
  '🚪 Please leave at doorstep',
  '⏳ Coming down in 2 mins',
  '💵 I have exact cash ready',
];

export const RiderChatModal: React.FC<RiderChatModalProps> = ({
  group,
  rider,
  messages,
  allowRiderCall = true,
  isSending = false,
  onClose,
  onSendMessage,
  onRetryMessage,
  onCallUnavailable,
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
  const shortOrderId = `#${orderId.slice(-6).toUpperCase()}`;
  const riderName = rider?.name || 'Delivery Partner';
  const riderTelHref = formatTelHref(rider?.phone);
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

  const handleQuickSend = (text: string) => {
    triggerHaptic('tap');
    onSendMessage(text);
  };

  const renderStatusTicks = (msg: TripChatMessage) => {
    if (msg.status === 'SENDING') {
      return (
        <span className="text-[10px] text-white/70" title="Sending...">
          ⏳
        </span>
      );
    }
    if (msg.status === 'FAILED') {
      return (
        <button
          type="button"
          onClick={() => onRetryMessage(msg)}
          className="ml-1 inline-flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-xs"
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
          className="text-[11px] font-black text-white/90"
          title="Delivered"
          data-testid={`msg-status-${msg.messageId}`}
        >
          ✓✓
        </span>
      );
    }
    return (
      <span
        className="text-[11px] font-black text-white/75"
        title="Sent"
        data-testid={`msg-status-${msg.messageId}`}
      >
        ✓
      </span>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[9990] flex flex-col bg-slate-950/70 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={`Chat with rider ${riderName}`}
      data-testid="rider-chat-modal"
    >
      <div className="mx-auto flex h-full w-full max-w-[480px] flex-col bg-[#efeae2] shadow-2xl">
        {/* Top Header */}
        <header className="flex items-center justify-between bg-linear-to-r from-[#0c831f] to-[#075e14] px-3.5 py-2.5 text-white shadow-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={() => {
                triggerHaptic('tap');
                onClose();
              }}
              aria-label="Back"
              data-testid="close-rider-chat-btn"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-white active:scale-95 transition-transform"
            >
              <i className="fa-solid fa-arrow-left text-sm" aria-hidden="true" />
            </button>

            {/* Rider Avatar with Online Ping */}
            <div className="relative shrink-0">
              {safePhoto ? (
                <img
                  src={safePhoto}
                  alt={riderName}
                  className="h-10 w-10 rounded-full object-cover border-2 border-white/60 shadow-xs"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white/60 bg-emerald-800 text-sm font-black text-white shadow-xs">
                  {initialLetter}
                </div>
              )}
              <span
                className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${
                  isRiderOnline ? 'bg-lime-400' : 'bg-slate-400'
                }`}
              />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <strong
                  className="truncate text-sm font-extrabold text-white"
                  data-testid="chat-header-rider-name"
                >
                  {riderName}
                </strong>
                <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-black text-emerald-100">
                  {shortOrderId}
                </span>
              </div>
              <div className="flex items-center gap-1 text-[11px] font-semibold text-emerald-100/90">
                <span>{isRiderOnline ? 'Online • Active Order' : 'Offline'}</span>
              </div>
            </div>
          </div>

          {/* Normal Phone Call Dialer Button */}
          {allowRiderCall && (
            riderTelHref ? (
              <a
                href={riderTelHref}
                onClick={() => triggerHaptic('tap')}
                aria-label={`Call ${riderName}`}
                data-testid="chat-header-call-btn"
                className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-black text-[#0c831f] shadow-sm active:scale-95 transition-transform"
              >
                <i className="fa-solid fa-phone text-xs" aria-hidden="true" />
                <span>Call</span>
              </a>
            ) : (
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('tap');
                  onCallUnavailable?.();
                }}
                aria-label={`Call ${riderName}`}
                data-testid="chat-header-call-btn"
                className="flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1.5 text-xs font-black text-[#0c831f] shadow-sm active:scale-95 transition-transform"
              >
                <i className="fa-solid fa-phone text-xs" aria-hidden="true" />
                <span>Call</span>
              </button>
            )
          )}
        </header>

        {/* Security & Direct Delivery Strip */}
        <div className="flex items-center justify-center gap-1.5 bg-[#fefce8] px-3 py-1.5 border-b border-amber-200/70 text-[11px] font-bold text-amber-900">
          <i className="fa-solid fa-shield-halved text-amber-700" aria-hidden="true" />
          <span>Direct rider chat for order directions & delivery notes</span>
        </div>

        {/* Messages Body */}
        <div
          className="flex-1 overflow-y-auto p-3.5 space-y-2.5"
          data-testid="rider-chat-messages-list"
          style={{
            backgroundImage:
              'radial-gradient(rgba(12, 131, 31, 0.04) 1px, transparent 0)',
            backgroundSize: '20px 20px',
          }}
        >
          {/* Today Divider */}
          <div className="flex justify-center my-1">
            <span className="rounded-full bg-black/10 px-3 py-0.5 text-[10px] font-bold tracking-wide text-slate-600 uppercase">
              Today
            </span>
          </div>

          {messages.length === 0 ? (
            <div
              className="mx-auto my-6 max-w-xs rounded-2xl bg-white/95 p-4 text-center shadow-sm border border-slate-200/80"
              data-testid="rider-chat-empty-state"
            >
              <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-100 text-[#0c831f]">
                <i className="fa-solid fa-message text-lg" aria-hidden="true" />
              </div>
              <h4 className="text-xs font-black text-slate-900">
                Message {riderName}
              </h4>
              <p className="mt-1 text-[11px] text-slate-500">
                Send a quick note or tap one of the suggested replies below:
              </p>
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
                    className={`relative max-w-[82%] px-3.5 py-2 shadow-sm ${
                      isCustomer
                        ? 'rounded-2xl rounded-br-xs bg-linear-to-r from-[#0c831f] to-[#0a701a] text-white'
                        : 'rounded-2xl rounded-bl-xs bg-white text-slate-900 border border-slate-200/80'
                    }`}
                  >
                    {!isCustomer && (
                      <div className="mb-0.5 text-[10px] font-black text-[#0c831f]">
                        {riderName}
                      </div>
                    )}
                    <div className="text-[13.5px] leading-snug font-medium break-words">
                      {msg.message}
                    </div>
                    <div
                      className={`mt-1 flex items-center justify-end gap-1.5 text-[10px] ${
                        isCustomer ? 'text-white/80' : 'text-slate-400'
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

        {/* Quick Suggestion Chips */}
        <div className="bg-[#efeae2] px-3 pt-1 pb-2">
          <div className="flex gap-2 overflow-x-auto no-scrollbar py-0.5">
            {QUICK_REPLIES.map((text) => (
              <button
                type="button"
                key={text}
                onClick={() => handleQuickSend(text)}
                className="shrink-0 rounded-full border border-emerald-300 bg-white/95 px-3 py-1.5 text-[11px] font-bold text-[#0c831f] shadow-xs active:scale-95 transition-transform"
              >
                {text}
              </button>
            ))}
          </div>
        </div>

        {/* Input Bar */}
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-2.5 pb-[max(0.65rem,env(safe-area-inset-bottom))]"
        >
          <div className="relative flex flex-1 items-center">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type delivery instructions..."
              maxLength={500}
              aria-label="Message to delivery partner"
              data-testid="rider-chat-input"
              className="w-full rounded-full border border-slate-300 bg-slate-50 py-2.5 pl-4 pr-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0c831f] focus:bg-white focus:outline-none transition-colors"
            />
            {draft.trim() && (
              <button
                type="button"
                onClick={() => setDraft('')}
                className="absolute right-3 text-slate-400 hover:text-slate-600 text-xs"
                aria-label="Clear text"
              >
                <i className="fa-solid fa-circle-xmark" aria-hidden="true" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={!draft.trim() || isSending}
            aria-label="Send SMS"
            data-testid="rider-chat-send-btn"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0c831f] text-white shadow-md disabled:opacity-40 disabled:scale-100 active:scale-95 transition-all"
          >
            {isSending ? (
              <i className="fa-solid fa-spinner fa-spin text-sm" aria-hidden="true" />
            ) : (
              <i className="fa-solid fa-paper-plane text-sm" aria-hidden="true" />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
