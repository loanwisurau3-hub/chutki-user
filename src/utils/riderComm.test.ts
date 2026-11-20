import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTripChatMessage,
  countUnreadRiderMessages,
  formatTelHref,
  isRiderCommunicationEligible,
} from './riderComm';
import type { GroupedOrder } from '../types/bazar';

const makeGroup = (overrides?: Partial<GroupedOrder>): GroupedOrder => ({
  groupKey: 'COMBO_981234',
  orders: [
    {
      orderId: 'ord_demo_1',
      batchGroupId: 'COMBO_981234',
      customerUid: 'cust_1',
      restaurantId: 'store_1',
      deliveryUid: 'rider_1',
      items: [],
      totalAmount: 120,
      status: 'OUT_FOR_DELIVERY',
    },
  ],
  createdAt: 1700000000000,
  deliveryOtp: '4829',
  paymentMode: 'COD',
  phone: '9876543210',
  address: 'Station Road, Ward No. 4, Gossaigaon',
  totalAmount: 120,
  deliveryUid: 'rider_1',
  riderLat: 26.454,
  riderLng: 89.974,
  customerLat: 26.4524,
  customerLng: 89.9723,
  locationLink: '',
  emergencyAlert: false,
  emergencyDetails: '',
  ...overrides,
});

test('isRiderCommunicationEligible enables Call & Message only for active rider-assigned orders', () => {
  assert.equal(isRiderCommunicationEligible(makeGroup()), true);
  assert.equal(isRiderCommunicationEligible(makeGroup({ deliveryUid: null })), false);
  assert.equal(
    isRiderCommunicationEligible(
      makeGroup({ orders: [{ ...makeGroup().orders[0], status: 'DELIVERED' }] })
    ),
    false
  );
  assert.equal(
    isRiderCommunicationEligible(
      makeGroup({ orders: [{ ...makeGroup().orders[0], status: 'CANCELLED' }] })
    ),
    false
  );
});

test('formatTelHref formats valid phone numbers into tel: URIs for normal calling', () => {
  assert.equal(formatTelHref('98640 11223'), 'tel:9864011223');
  assert.equal(formatTelHref('+91-98640-11223'), 'tel:+919864011223');
  assert.equal(formatTelHref(''), null);
  assert.equal(formatTelHref('123'), null);
});

test('buildTripChatMessage validates messages, blocks phishing links, and counts unread rider messages', () => {
  const built = buildTripChatMessage({
    messageId: 'push_123',
    senderUid: 'cust_1',
    receiverUid: 'rider_1',
    rawMessage: 'Please call me when you reach the main gate.',
    now: 1700000300000,
  });
  assert.equal(built.valid, true);
  assert.equal(built.record?.senderRole, 'CUSTOMER');
  assert.equal(built.record?.messageType, 'TEXT');
  assert.equal(built.record?.status, 'SENT');

  const phishing = buildTripChatMessage({
    messageId: 'push_124',
    senderUid: 'cust_1',
    receiverUid: 'rider_1',
    rawMessage: 'Click https://evil.example.com to verify OTP',
  });
  assert.equal(phishing.valid, false);

  const unread = countUnreadRiderMessages(
    {
      m1: {
        messageId: 'm1',
        senderUid: 'rider_1',
        senderRole: 'RIDER',
        receiverUid: 'cust_1',
        messageType: 'TEXT',
        message: 'I have picked up your order',
        timestamp: 1000,
        status: 'SENT',
      },
      m2: {
        messageId: 'm2',
        senderUid: 'rider_1',
        senderRole: 'RIDER',
        receiverUid: 'cust_1',
        messageType: 'TEXT',
        message: 'On the way',
        timestamp: 2000,
        status: 'READ',
      },
    },
    'cust_1'
  );
  assert.equal(unread, 1);
});
