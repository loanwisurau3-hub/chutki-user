import type { GroupedOrder, TripChatMessage } from '../types/bazar';
import { deriveGroupOrderStatus, normalizeOrderStatus } from './bazarLogic';
import { detectSpamContent, sanitizeInputBounded } from './security';

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

export function formatTelHref(phone?: string | null): string | null {
  const cleaned = String(phone || '')
    .replace(/[^\d+]/g, '')
    .trim();
  const digitsOnly = cleaned.replace(/\D/g, '');
  if (digitsOnly.length < 7 || digitsOnly.length > 15) {
    return null;
  }
  return `tel:${cleaned}`;
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
  const cleanMsg = sanitizeInputBounded(params.rawMessage, 500);
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
      const text = sanitizeInputBounded(String(item.message || ''), 500);
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
