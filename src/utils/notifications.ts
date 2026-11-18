import type {
  AppNotification,
  GroupedOrder,
  WalletTransaction,
} from '../types/bazar';
import { deriveGroupOrderStatus, normalizeOrderStatus } from './bazarLogic';

export interface OrderSnapshotState {
  status: string;
  orderStatuses: Record<string, string>;
  deliveryUid: string | null;
  emergencyAlert: boolean;
}

export function buildOrderSnapshotMap(
  groups: GroupedOrder[]
): Record<string, OrderSnapshotState> {
  const map: Record<string, OrderSnapshotState> = {};
  groups.forEach((g) => {
    const derived = deriveGroupOrderStatus(g);
    const orderStatuses: Record<string, string> = {};
    g.orders.forEach((o) => {
      orderStatuses[o.orderId] = normalizeOrderStatus(o.status);
    });
    map[g.groupKey] = {
      status: derived.status,
      orderStatuses,
      deliveryUid: g.deliveryUid,
      emergencyAlert: g.emergencyAlert,
    };
  });
  return map;
}

export function buildOrderStatusPushContent(params: {
  status: string;
  shortId: string;
  deliveryOtp?: string;
}): { title: string; body: string } {
  const normalized = normalizeOrderStatus(params.status);
  const shortId = params.shortId;

  switch (normalized) {
    case 'ACCEPTED':
      return {
        title: `✅ Order ${shortId} Accepted!`,
        body: 'Partner store has accepted your order and is getting started.',
      };
    case 'PREPARING':
      return {
        title: `👨‍🍳 Order ${shortId} Preparing`,
        body: 'Partner store is preparing your order right now.',
      };
    case 'PACKING':
      return {
        title: `📦 Packing Order ${shortId}`,
        body: 'Your fresh groceries are being packed for 15-minute delivery.',
      };
    case 'READY_FOR_PICKUP':
      return {
        title: `🛍️ Order ${shortId} Ready for Pickup`,
        body: 'Order is packed! Delivery partner is picking it up now.',
      };
    case 'OUT_FOR_DELIVERY':
      return {
        title: `🛵 Order ${shortId} Out for Delivery!`,
        body: params.deliveryOtp
          ? `Rider is on the way! Keep Delivery PIN ${params.deliveryOtp} ready at doorstep.`
          : 'Your delivery partner is heading to your doorstep now.',
      };
    case 'DELIVERED':
      return {
        title: `🎉 Order ${shortId} Delivered!`,
        body: 'Enjoy your groceries! Tap to rate your rider & products.',
      };
    case 'CANCELLED':
      return {
        title: `❌ Order ${shortId} Cancelled`,
        body: 'Your order was cancelled. Check Orders tab for details.',
      };
    default: {
      const readable = normalized
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (ch) => ch.toUpperCase());
      return {
        title: `Order ${shortId} Update`,
        body: `Your order status is now ${readable}.`,
      };
    }
  }
}

export function detectOrderNotificationEvents(
  prevMap: Record<string, OrderSnapshotState>,
  groups: GroupedOrder[],
  now = Date.now()
): AppNotification[] {
  const events: AppNotification[] = [];

  groups.forEach((g) => {
    const prev = prevMap[g.groupKey];
    if (!prev) return; // Do not notify for initial historical load
    const derived = deriveGroupOrderStatus(g);
    const shortId = `#${g.groupKey.slice(-6)}`;

    let updatedSubOrderStatus: string | null = null;
    if (prev.status === derived.status) {
      for (const o of g.orders) {
        const curStatus = normalizeOrderStatus(o.status);
        const prevSubStatus = prev.orderStatuses?.[o.orderId];
        if (prevSubStatus && prevSubStatus !== curStatus) {
          updatedSubOrderStatus = curStatus;
          break;
        }
      }
    }

    if (prev.status !== derived.status || updatedSubOrderStatus !== null) {
      const effectiveStatus =
        prev.status !== derived.status ? derived.status : updatedSubOrderStatus!;
      const content = buildOrderStatusPushContent({
        status: effectiveStatus,
        shortId,
        deliveryOtp: g.deliveryOtp,
      });

      events.push({
        id: `order_${g.groupKey}_${effectiveStatus}_${now}`,
        title: content.title,
        body: content.body,
        tag: `gb-order-${g.groupKey}`,
        type: 'ORDER',
        targetTab: 'orders',
        createdAt: now,
        read: false,
      });
    } else if (!prev.deliveryUid && g.deliveryUid) {
      events.push({
        id: `rider_${g.groupKey}_${now}`,
        title: `🛵 Delivery Rider Assigned (${shortId})`,
        body: 'A nearby delivery partner has been assigned to your order!',
        tag: `gb-rider-${g.groupKey}`,
        type: 'ORDER',
        targetTab: 'orders',
        createdAt: now,
        read: false,
      });
    }

    if (!prev.emergencyAlert && g.emergencyAlert) {
      events.push({
        id: `alert_${g.groupKey}_${now}`,
        title: `⚠️ Delivery Delay Alert (${shortId})`,
        body: g.emergencyDetails || 'Temporary road delay reported by your rider.',
        tag: `gb-alert-${g.groupKey}`,
        type: 'ORDER',
        targetTab: 'orders',
        createdAt: now,
        read: false,
      });
    }
  });

  return events;
}

export function detectWalletNotificationEvents(
  prevKeys: Set<string>,
  txMap: Record<string, WalletTransaction>,
  now = Date.now()
): AppNotification[] {
  const events: AppNotification[] = [];
  Object.entries(txMap).forEach(([txId, tx]) => {
    if (prevKeys.has(txId)) return;
    const isCredit = tx.type === 'CREDIT';
    events.push({
      id: `wallet_${txId}`,
      title: isCredit
        ? `💰 ₹${Number(tx.amount || 0).toFixed(0)} Added to Wallet`
        : `💳 ₹${Number(tx.amount || 0).toFixed(0)} Wallet Payment`,
      body: tx.note || (isCredit ? 'Wallet credited successfully.' : 'Wallet debited.'),
      tag: `gb-wallet-${txId}`,
      type: 'WALLET',
      targetTab: 'wallet',
      createdAt: tx.createdAt || now,
      read: false,
    });
  });
  return events;
}
