import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrderSnapshotMap,
  buildOrderStatusPushContent,
  detectOrderNotificationEvents,
  detectWalletNotificationEvents,
} from './notifications';
import type { GroupedOrder } from '../types/bazar';

function makeGroup(
  status: string,
  deliveryUid: string | null = null,
  emergencyAlert = false,
  secondStatus?: string
): GroupedOrder {
  const orders = [
    {
      orderId: 'o1',
      customerUid: 'u1',
      restaurantId: 's1',
      items: [],
      totalAmount: 120,
      status,
    },
  ];
  if (secondStatus) {
    orders.push({
      orderId: 'o2',
      customerUid: 'u1',
      restaurantId: 's2',
      items: [],
      totalAmount: 80,
      status: secondStatus,
    });
  }
  return {
    groupKey: 'COMBO_123456',
    orders,
    createdAt: 1000,
    deliveryOtp: '4321',
    paymentMode: 'COD',
    phone: '9876543210',
    address: 'Station Road',
    totalAmount: secondStatus ? 200 : 120,
    deliveryUid,
    riderLat: null,
    riderLng: null,
    customerLat: null,
    customerLng: null,
    locationLink: '',
    emergencyAlert,
    emergencyDetails: emergencyAlert ? 'Rain delay' : '',
  };
}

test('detects Preparing, Packing, Ready, Out for Delivery, Delivered and rider alerts without initial duplicates', () => {
  const initialGroups = [makeGroup('PLACED', null)];
  const prevMap = buildOrderSnapshotMap(initialGroups);

  // No change -> no notification
  assert.equal(detectOrderNotificationEvents(prevMap, initialGroups).length, 0);

  // Preparing (including mixed case string)
  const preparingGroups = [makeGroup('Preparing', null)];
  const prepAlerts = detectOrderNotificationEvents(prevMap, preparingGroups, 1500);
  assert.equal(prepAlerts.length, 1);
  assert.ok(prepAlerts[0].title.includes('Preparing'));
  assert.equal(prepAlerts[0].targetTab, 'orders');

  // Packing
  const prevPrep = buildOrderSnapshotMap(preparingGroups);
  const packingGroups = [makeGroup('PACKING', null)];
  const packAlerts = detectOrderNotificationEvents(prevPrep, packingGroups, 1800);
  assert.equal(packAlerts.length, 1);
  assert.ok(packAlerts[0].title.includes('Packing'));

  // Rider assigned
  const prevPack = buildOrderSnapshotMap(packingGroups);
  const withRider = [makeGroup('PACKING', 'rider1')];
  const riderAlerts = detectOrderNotificationEvents(prevPack, withRider, 2000);
  assert.equal(riderAlerts.length, 1);
  assert.ok(riderAlerts[0].title.includes('Rider Assigned'));

  // Out for delivery (with space-separated input)
  const prev2 = buildOrderSnapshotMap(withRider);
  const outGroups = [makeGroup('Out for Delivery', 'rider1')];
  const outAlerts = detectOrderNotificationEvents(prev2, outGroups, 3000);
  assert.equal(outAlerts.length, 1);
  assert.ok(outAlerts[0].title.includes('Out for Delivery'));
  assert.ok(outAlerts[0].body.includes('4321'));

  // Delivered
  const prevOut = buildOrderSnapshotMap(outGroups);
  const deliveredGroups = [makeGroup('DELIVERED', 'rider1')];
  const delivAlerts = detectOrderNotificationEvents(prevOut, deliveredGroups, 4000);
  assert.equal(delivAlerts.length, 1);
  assert.ok(delivAlerts[0].title.includes('Delivered'));
});

test('detects sub-order status updates inside multi-store orders and formats custom statuses cleanly', () => {
  const step1 = [makeGroup('OUT_FOR_DELIVERY', 'rider1', false, 'PLACED')];
  const prev1 = buildOrderSnapshotMap(step1);

  const step2 = [makeGroup('OUT_FOR_DELIVERY', 'rider1', false, 'Preparing')];
  const subAlerts = detectOrderNotificationEvents(prev1, step2, 5000);
  assert.equal(subAlerts.length, 1);
  assert.ok(subAlerts[0].title.includes('Preparing'));

  const customMsg = buildOrderStatusPushContent({
    status: 'AWAITING_RIDER',
    shortId: '#123456',
  });
  assert.equal(customMsg.title, 'Order #123456 Update');
  assert.ok(customMsg.body.includes('Awaiting Rider'));
});

test('detects newly added wallet transactions', () => {
  const prevKeys = new Set(['tx1']);
  const events = detectWalletNotificationEvents(prevKeys, {
    tx1: { type: 'CREDIT', amount: 25, note: 'Referral', createdAt: 1000 },
    tx2: { type: 'CREDIT', amount: 200, note: 'UPI Deposit Approved', createdAt: 2000 },
  });
  assert.equal(events.length, 1);
  assert.ok(events[0].title.includes('200'));
  assert.equal(events[0].targetTab, 'wallet');
});
