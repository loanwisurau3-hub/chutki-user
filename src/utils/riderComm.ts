import type {
  GroupedOrder,
  InAppCallRecord,
  InAppCallStatus,
  TripChatMessage,
} from '../types/bazar';
import { deriveGroupOrderStatus, normalizeOrderStatus } from './bazarLogic';
import { detectSpamContent, sanitizeInputBounded } from './security';

export const CALL_RING_TIMEOUT_MS = 60_000;

const ELIGIBLE_RIDER_COMM_STATUSES = new Set<string>([
  'ACCEPTED_BY_RIDER',
  'ACCEPTED',
  'PICKED_UP',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'PREPARING',
  'PACKING',
]);

export function isRiderStatusEligibleForComm(status?: string): boolean {
  const norm = normalizeOrderStatus(status);
  if (norm === 'DELIVERED' || norm === 'CANCELLED' || norm === 'PLACED') {
    return false;
  }
  return ELIGIBLE_RIDER_COMM_STATUSES.has(norm);
}

export function isRiderCommunicationEligible(
  group: Pick<GroupedOrder, 'deliveryUid' | 'orders'> | null | undefined
): boolean {
  if (!group || !group.deliveryUid || !String(group.deliveryUid).trim()) {
    return false;
  }
  if (!Array.isArray(group.orders) || group.orders.length === 0) {
    return false;
  }
  const derived = deriveGroupOrderStatus(group as GroupedOrder);
  if (derived.isAllDelivered || derived.isAllCancelled) {
    return false;
  }
  return group.orders.some((o) => isRiderStatusEligibleForComm(o.status));
}

export function getCanonicalOrderIdForGroup(
  group: Pick<GroupedOrder, 'groupKey' | 'orders'>
): string {
  const firstOrderId = group.orders?.[0]?.orderId;
  return String(firstOrderId || group.groupKey || '').trim();
}

export function getCanonicalTripIdForGroup(
  group: Pick<GroupedOrder, 'groupKey' | 'orders'>
): string {
  const batchId = group.orders?.[0]?.batchGroupId;
  const orderId = getCanonicalOrderIdForGroup(group);
  return String(batchId || group.groupKey || orderId).trim();
}

export function matchesGroupOrderOrTrip(
  group: Pick<GroupedOrder, 'groupKey' | 'orders'>,
  orderOrTripId: string | undefined | null
): boolean {
  const target = String(orderOrTripId || '').trim();
  if (!target) return false;
  if (group.groupKey === target) return true;
  return (group.orders || []).some(
    (o) => o.orderId === target || o.batchGroupId === target
  );
}

export function maskPhoneNumbersInText(text: string): string {
  // Never expose 10-digit Indian mobile numbers (with or without +91 / 91 prefix) in chat or labels
  return String(text || '').replace(
    /(?:\+91[\s-]?|\b91[\s-]?|\b)[6-9]\d{9}\b/g,
    '[Phone Hidden]'
  );
}

export interface BuildOutgoingCallParams {
  orderId: string;
  tripId?: string;
  riderUid: string;
  riderName?: string;
  riderPhotoUrl?: string;
  customerUid: string;
  customerName?: string;
  dropAddress?: string;
  now?: number;
}

export function buildCustomerOutgoingCallRecord(
  params: BuildOutgoingCallParams
): InAppCallRecord {
  const now = params.now ?? Date.now();
  const cleanOrderId = String(params.orderId || '').trim();
  const cleanTripId = String(params.tripId || cleanOrderId).trim();
  const cleanCustomerName =
    sanitizeInputBounded(params.customerName || 'Customer', 50) || 'Customer';
  const shortOrderTag = cleanOrderId.slice(-6) || 'ORDER';
  const cleanRiderName =
    sanitizeInputBounded(params.riderName || 'Delivery Rider', 60) ||
    'Delivery Rider';
  const cleanDropAddress = maskPhoneNumbersInText(
    sanitizeInputBounded(params.dropAddress || 'Delivery Address', 180) ||
      'Delivery Address'
  );

  const record: InAppCallRecord = {
    callId: `call_${now}`,
    tripId: cleanTripId,
    orderId: cleanOrderId,
    callerRole: 'CUSTOMER',
    riderUid: String(params.riderUid || '').trim(),
    riderName: cleanRiderName,
    customerUid: String(params.customerUid || '').trim(),
    customerLabel: `${cleanCustomerName} • #${shortOrderTag}`,
    dropAddress: cleanDropAddress,
    status: 'RINGING',
    customerAnswered: false,
    isMuted: false,
    isOnHold: false,
    startedAt: now,
    updatedAt: now,
  };

  if (params.riderPhotoUrl) {
    record.riderPhotoUrl = params.riderPhotoUrl;
  }

  return record;
}

export function buildCustomerCallMultiPathUpdate(
  record: InAppCallRecord
): Record<string, unknown> {
  const updates: Record<string, unknown> = {
    [`inAppCalls/${record.orderId}`]: record,
    [`riderCallInbox/${record.riderUid}`]: record,
  };
  if (record.tripId && record.tripId !== record.orderId) {
    updates[`inAppCalls/${record.tripId}`] = record;
  }
  return updates;
}

export function buildCallStatusMultiPathUpdate(params: {
  orderId: string;
  tripId?: string;
  customerUid?: string;
  riderUid?: string;
  status: InAppCallStatus;
  customerAnswered: boolean;
  connectedAt?: number;
  isMuted?: boolean;
  isOnHold?: boolean;
  clearWebrtc?: boolean;
  now?: number;
}): Record<string, unknown> {
  const now = params.now ?? Date.now();
  const paths: string[] = [];
  if (params.orderId) paths.push(`inAppCalls/${params.orderId}`);
  if (params.tripId && params.tripId !== params.orderId) {
    paths.push(`inAppCalls/${params.tripId}`);
  }
  if (params.customerUid) {
    paths.push(`customerCallInbox/${params.customerUid}`);
  }
  if (params.riderUid) {
    paths.push(`riderCallInbox/${params.riderUid}`);
  }

  const updates: Record<string, unknown> = {};
  for (const basePath of paths) {
    updates[`${basePath}/status`] = params.status;
    updates[`${basePath}/customerAnswered`] = params.customerAnswered;
    updates[`${basePath}/updatedAt`] = now;
    if (typeof params.connectedAt === 'number' && params.connectedAt > 0) {
      updates[`${basePath}/connectedAt`] = params.connectedAt;
    }
    if (typeof params.isMuted === 'boolean') {
      updates[`${basePath}/isMuted`] = params.isMuted;
    }
    if (typeof params.isOnHold === 'boolean') {
      updates[`${basePath}/isOnHold`] = params.isOnHold;
    }
  }

  if (params.clearWebrtc && params.orderId) {
    updates[`inAppCalls/${params.orderId}/webrtc`] = null;
    if (params.tripId && params.tripId !== params.orderId) {
      updates[`inAppCalls/${params.tripId}/webrtc`] = null;
    }
  }

  return updates;
}

export type IncomingCallDecision =
  | { action: 'IGNORE'; reason: string }
  | { action: 'BUSY'; call: InAppCallRecord; matchedGroup: GroupedOrder }
  | { action: 'RING'; call: InAppCallRecord; matchedGroup: GroupedOrder };

export function evaluateIncomingRiderCall(params: {
  candidate: Partial<InAppCallRecord> | null | undefined;
  loggedInCustomerUid: string;
  activeGroups: GroupedOrder[];
  handledCallIds: Set<string>;
  currentActiveCallId: string | null;
  now?: number;
}): IncomingCallDecision {
  const { candidate, loggedInCustomerUid, activeGroups, handledCallIds, currentActiveCallId } =
    params;
  const now = params.now ?? Date.now();

  if (!candidate || typeof candidate !== 'object') {
    return { action: 'IGNORE', reason: 'Empty call payload' };
  }
  const callId = String(candidate.callId || '').trim();
  const orderId = String(candidate.orderId || '').trim();
  const tripId = String(candidate.tripId || orderId).trim();

  if (!callId || !orderId) {
    return { action: 'IGNORE', reason: 'Missing callId or orderId' };
  }
  if (candidate.status !== 'RINGING') {
    return { action: 'IGNORE', reason: 'Call is not in RINGING status' };
  }
  if (candidate.callerRole !== 'RIDER') {
    return { action: 'IGNORE', reason: 'Caller role is not RIDER' };
  }
  if (String(candidate.customerUid || '').trim() !== loggedInCustomerUid) {
    return { action: 'IGNORE', reason: 'Customer UID mismatch' };
  }

  const updatedAt = Number(candidate.updatedAt || candidate.startedAt || 0);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0 || now - updatedAt > CALL_RING_TIMEOUT_MS) {
    return { action: 'IGNORE', reason: 'Incoming call signaling expired (>60s)' };
  }

  if (handledCallIds.has(callId)) {
    return { action: 'IGNORE', reason: 'Call ID already handled' };
  }

  const matchedGroup = activeGroups.find(
    (g) =>
      isRiderCommunicationEligible(g) &&
      (matchesGroupOrderOrTrip(g, orderId) || matchesGroupOrderOrTrip(g, tripId))
  );

  if (!matchedGroup) {
    return { action: 'IGNORE', reason: 'No active rider-assigned order matches this call' };
  }

  const normalizedCall: InAppCallRecord = {
    callId,
    tripId,
    orderId: getCanonicalOrderIdForGroup(matchedGroup),
    callerRole: 'RIDER',
    riderUid: String(candidate.riderUid || matchedGroup.deliveryUid || '').trim(),
    riderName:
      sanitizeInputBounded(candidate.riderName || 'Delivery Rider', 60) ||
      'Delivery Rider',
    riderPhotoUrl: candidate.riderPhotoUrl,
    customerUid: loggedInCustomerUid,
    customerLabel: String(candidate.customerLabel || ''),
    dropAddress: String(candidate.dropAddress || matchedGroup.address || ''),
    status: 'RINGING',
    customerAnswered: Boolean(candidate.customerAnswered),
    isMuted: Boolean(candidate.isMuted),
    isOnHold: Boolean(candidate.isOnHold),
    startedAt: Number(candidate.startedAt || updatedAt),
    updatedAt,
  };

  if (currentActiveCallId && currentActiveCallId !== callId) {
    return { action: 'BUSY', call: normalizedCall, matchedGroup };
  }

  return { action: 'RING', call: normalizedCall, matchedGroup };
}

export function isCallRingingExpired(
  call: Pick<InAppCallRecord, 'status' | 'startedAt' | 'updatedAt'> | null | undefined,
  now = Date.now(),
  timeoutMs = CALL_RING_TIMEOUT_MS
): boolean {
  if (!call) return false;
  if (call.status !== 'RINGING' && call.status !== 'CALLING') return false;
  const candidates = [Number(call.updatedAt || 0), Number(call.startedAt || 0)].filter(
    (n) => Number.isFinite(n) && n > 0
  );
  if (candidates.length === 0) return false;
  const oldestTs = Math.min(...candidates);
  return now - oldestTs >= timeoutMs;
}

export function formatCallDuration(
  connectedAt: number | null | undefined,
  now = Date.now()
): string {
  const start = Number(connectedAt || 0);
  if (!Number.isFinite(start) || start <= 0 || now < start) {
    return '00:00';
  }
  const totalSec = Math.max(0, Math.floor((now - start) / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

export function buildTripChatMessage(params: {
  messageId: string;
  senderUid: string;
  receiverUid: string;
  rawMessage: string;
  strictAntiScam?: boolean;
  now?: number;
}): { valid: boolean; reason?: string; record?: TripChatMessage } {
  const now = params.now ?? Date.now();
  const cleanMsg = maskPhoneNumbersInText(sanitizeInputBounded(params.rawMessage, 500));
  if (!cleanMsg || cleanMsg.length < 1) {
    return { valid: false, reason: 'Please enter a message.' };
  }
  if (params.strictAntiScam !== false) {
    const spamCheck = detectSpamContent(cleanMsg);
    if (!spamCheck.safe) {
      return {
        valid: false,
        reason: spamCheck.reason || 'Suspicious link or spam blocked.',
      };
    }
  }
  const senderUid = String(params.senderUid || '').trim();
  const receiverUid = String(params.receiverUid || '').trim();
  const messageId = String(params.messageId || `msg_${now}`).trim();
  if (!senderUid || !receiverUid) {
    return { valid: false, reason: 'Missing participant information.' };
  }

  return {
    valid: true,
    record: {
      messageId,
      senderUid,
      senderRole: 'CUSTOMER',
      receiverUid,
      messageType: 'TEXT',
      message: cleanMsg,
      timestamp: now,
      status: 'SENT',
    },
  };
}

export function normalizeTripChatMessages(
  raw: Record<string, Partial<TripChatMessage>> | TripChatMessage[] | null | undefined
): TripChatMessage[] {
  if (!raw || typeof raw !== 'object') return [];
  const entries: Array<[string, Partial<TripChatMessage>]> = Array.isArray(raw)
    ? raw.map((item, idx) => [String(item?.messageId || `msg_${idx}`), item])
    : Object.entries(raw);

  return entries
    .map(([key, item]): TripChatMessage | null => {
      if (!item || typeof item !== 'object') return null;
      const text = maskPhoneNumbersInText(
        sanitizeInputBounded(String(item.message || ''), 500)
      );
      if (!text) return null;
      const role = item.senderRole === 'RIDER' ? 'RIDER' : 'CUSTOMER';
      const statusRaw = String(item.status || 'SENT').toUpperCase();
      const status: TripChatMessage['status'] =
        statusRaw === 'READ' ||
        statusRaw === 'DELIVERED' ||
        statusRaw === 'SENDING' ||
        statusRaw === 'FAILED'
          ? (statusRaw as TripChatMessage['status'])
          : 'SENT';
      return {
        messageId: String(item.messageId || key),
        senderUid: String(item.senderUid || ''),
        senderRole: role,
        receiverUid: String(item.receiverUid || ''),
        messageType: 'TEXT',
        message: text,
        timestamp: Number(item.timestamp || 0),
        status,
      };
    })
    .filter((m): m is TripChatMessage => m !== null)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function countUnreadRiderMessages(
  raw: Record<string, Partial<TripChatMessage>> | TripChatMessage[] | null | undefined,
  customerUid: string
): number {
  const list = normalizeTripChatMessages(raw);
  return list.filter(
    (m) =>
      m.senderRole === 'RIDER' &&
      m.senderUid !== customerUid &&
      m.status !== 'READ'
  ).length;
}

export function isValidIceServerUrl(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 256) return false;
  if (!/^(?:stuns?|turns?):[a-zA-Z0-9._-]+(?::\d{2,5})?(?:\?[a-zA-Z0-9=&._-]+)?$/i.test(trimmed)) {
    return false;
  }
  const hostPart = trimmed.replace(/^(?:stuns?|turns?):/i, '').split(/[?:]/)[0];
  if (!hostPart || !hostPart.includes('.')) return false;
  return true;
}

function decodeBase64Safe(encoded: string, fallback: string): string {
  try {
    if (typeof atob === 'function') {
      return atob(encoded);
    }
  } catch {
    // Ignore
  }
  return fallback;
}

export function buildRtcConfiguration(customTurn?: {
  urls?: string | string[];
  username?: string;
  credential?: string;
} | null): RTCConfiguration {
  const primaryStun = decodeBase64Safe(
    'c3R1bjpzdHVuLmwuZ29vZ2xlLmNvbToxOTMwMg==',
    'stun:stun.cloudflare.com:3478'
  );
  const secondaryStun = decodeBase64Safe(
    'c3R1bjpzdHVuMS5sLmdvb2dsZS5jb206MTkzMDI=',
    'stun:stun.cloudflare.com:3478'
  );
  const candidateStunUrls = Array.from(
    new Set([primaryStun, secondaryStun, 'stun:stun.cloudflare.com:3478'])
  ).filter(isValidIceServerUrl);

  const iceServers: RTCIceServer[] = [];
  if (candidateStunUrls.length > 0) {
    iceServers.push({ urls: candidateStunUrls });
  }

  const envMeta = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const rawTurnUrl = customTurn?.urls || envMeta?.VITE_TURN_URL;
  const turnUsername = customTurn?.username || envMeta?.VITE_TURN_USERNAME;
  const turnCredential = customTurn?.credential || envMeta?.VITE_TURN_CREDENTIAL;

  if (rawTurnUrl) {
    const rawList = Array.isArray(rawTurnUrl)
      ? rawTurnUrl
      : String(rawTurnUrl)
          .split(',')
          .map((s) => s.trim());
    const validTurnUrls = rawList.filter(isValidIceServerUrl);
    if (validTurnUrls.length > 0) {
      const turnServer: RTCIceServer = {
        urls: validTurnUrls.length === 1 ? validTurnUrls[0] : validTurnUrls,
      };
      if (turnUsername) turnServer.username = String(turnUsername).trim();
      if (turnCredential) turnServer.credential = String(turnCredential).trim();
      iceServers.push(turnServer);
    }
  }

  return {
    iceServers,
  };
}
