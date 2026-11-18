import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCallStatusMultiPathUpdate,
  buildCustomerCallMultiPathUpdate,
  buildCustomerOutgoingCallRecord,
  buildRtcConfiguration,
  buildTripChatMessage,
  countUnreadRiderMessages,
  evaluateIncomingRiderCall,
  formatCallDuration,
  getCanonicalOrderIdForGroup,
  getCanonicalTripIdForGroup,
  isCallRingingExpired,
  isRiderCommunicationEligible,
  isValidIceServerUrl,
  maskPhoneNumbersInText,
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

test('isRiderCommunicationEligible enables Call & Message only when rider is assigned and status is active', () => {
  const activeOutGroup = makeGroup();
  assert.equal(isRiderCommunicationEligible(activeOutGroup), true);

  const acceptedByRiderGroup = makeGroup({
    orders: [
      {
        ...activeOutGroup.orders[0],
        status: 'accepted_by_rider',
      },
    ],
  });
  assert.equal(isRiderCommunicationEligible(acceptedByRiderGroup), true);

  const pickedUpGroup = makeGroup({
    orders: [
      {
        ...activeOutGroup.orders[0],
        status: 'picked_up',
      },
    ],
  });
  assert.equal(isRiderCommunicationEligible(pickedUpGroup), true);

  const unassignedGroup = makeGroup({ deliveryUid: null });
  assert.equal(isRiderCommunicationEligible(unassignedGroup), false);

  const deliveredGroup = makeGroup({
    orders: [{ ...activeOutGroup.orders[0], status: 'DELIVERED' }],
  });
  assert.equal(isRiderCommunicationEligible(deliveredGroup), false);

  const cancelledGroup = makeGroup({
    orders: [{ ...activeOutGroup.orders[0], status: 'CANCELLED' }],
  });
  assert.equal(isRiderCommunicationEligible(cancelledGroup), false);
});

test('buildCustomerOutgoingCallRecord and buildCustomerCallMultiPathUpdate produce exact Firebase RTDB JSON', () => {
  const group = makeGroup();
  const now = 1700000050000;
  const orderId = getCanonicalOrderIdForGroup(group);
  const tripId = getCanonicalTripIdForGroup(group);

  const record = buildCustomerOutgoingCallRecord({
    orderId,
    tripId,
    riderUid: 'rider_1',
    riderName: 'Bikash Das',
    customerUid: 'cust_1',
    customerName: 'Rahul Roy',
    dropAddress: 'Station Road, Call 9876543210',
    now,
  });

  assert.equal(record.callId, `call_${now}`);
  assert.equal(record.tripId, 'COMBO_981234');
  assert.equal(record.orderId, 'ord_demo_1');
  assert.equal(record.callerRole, 'CUSTOMER');
  assert.equal(record.riderUid, 'rider_1');
  assert.equal(record.riderName, 'Bikash Das');
  assert.equal(record.customerUid, 'cust_1');
  assert.equal(record.customerLabel, 'Rahul Roy • #demo_1');
  assert.equal(record.dropAddress, 'Station Road, Call [Phone Hidden]');
  assert.equal(record.status, 'RINGING');
  assert.equal(record.customerAnswered, false);
  assert.equal(record.isMuted, false);
  assert.equal(record.isOnHold, false);
  assert.equal(record.startedAt, now);
  assert.equal(record.updatedAt, now);

  const multiUpdate = buildCustomerCallMultiPathUpdate(record);
  assert.ok(multiUpdate['inAppCalls/ord_demo_1']);
  assert.ok(multiUpdate['inAppCalls/COMBO_981234']);
  assert.ok(multiUpdate['riderCallInbox/rider_1']);
});

test('evaluateIncomingRiderCall validates active order, freshness, duplicate callId, and busy state', () => {
  const now = 1700000100000;
  const group = makeGroup();
  const handled = new Set<string>();

  const validIncoming = {
    callId: 'call_rider_101',
    tripId: 'COMBO_981234',
    orderId: 'ord_demo_1',
    callerRole: 'RIDER' as const,
    riderUid: 'rider_1',
    riderName: 'Bikash Das',
    customerUid: 'cust_1',
    customerLabel: 'Rahul Roy • #demo_1',
    dropAddress: 'Station Road',
    status: 'RINGING' as const,
    customerAnswered: false,
    isMuted: false,
    isOnHold: false,
    startedAt: now - 5000,
    updatedAt: now - 5000,
  };

  const decision1 = evaluateIncomingRiderCall({
    candidate: validIncoming,
    loggedInCustomerUid: 'cust_1',
    activeGroups: [group],
    handledCallIds: handled,
    currentActiveCallId: null,
    now,
  });
  assert.equal(decision1.action, 'RING');

  // If customer is already on another active call, returns BUSY
  const decisionBusy = evaluateIncomingRiderCall({
    candidate: validIncoming,
    loggedInCustomerUid: 'cust_1',
    activeGroups: [group],
    handledCallIds: handled,
    currentActiveCallId: 'call_other_active',
    now,
  });
  assert.equal(decisionBusy.action, 'BUSY');

  // If callId was already handled, returns IGNORE
  handled.add('call_rider_101');
  const decisionDuplicate = evaluateIncomingRiderCall({
    candidate: validIncoming,
    loggedInCustomerUid: 'cust_1',
    activeGroups: [group],
    handledCallIds: handled,
    currentActiveCallId: null,
    now,
  });
  assert.equal(decisionDuplicate.action, 'IGNORE');

  // Stale call (>60s old) is ignored
  const staleCall = {
    ...validIncoming,
    callId: 'call_rider_stale',
    updatedAt: now - 65_000,
  };
  const decisionStale = evaluateIncomingRiderCall({
    candidate: staleCall,
    loggedInCustomerUid: 'cust_1',
    activeGroups: [group],
    handledCallIds: new Set(),
    currentActiveCallId: null,
    now,
  });
  assert.equal(decisionStale.action, 'IGNORE');
  assert.equal(isCallRingingExpired(staleCall, now), true);

  // Unrelated order ID is rejected
  const wrongOrderCall = {
    ...validIncoming,
    callId: 'call_wrong_order',
    orderId: 'ord_unrelated_999',
    tripId: 'COMBO_999',
  };
  const decisionWrongOrder = evaluateIncomingRiderCall({
    candidate: wrongOrderCall,
    loggedInCustomerUid: 'cust_1',
    activeGroups: [group],
    handledCallIds: new Set(),
    currentActiveCallId: null,
    now,
  });
  assert.equal(decisionWrongOrder.action, 'IGNORE');
});

test('buildCallStatusMultiPathUpdate updates all signaling paths andformatCallDuration computes real connected duration', () => {
  const now = 1700000200000;
  const updates = buildCallStatusMultiPathUpdate({
    orderId: 'ord_demo_1',
    tripId: 'COMBO_981234',
    customerUid: 'cust_1',
    riderUid: 'rider_1',
    status: 'ENDED',
    customerAnswered: false,
    clearWebrtc: true,
    now,
  });

  assert.equal(updates['inAppCalls/ord_demo_1/status'], 'ENDED');
  assert.equal(updates['inAppCalls/COMBO_981234/status'], 'ENDED');
  assert.equal(updates['customerCallInbox/cust_1/status'], 'ENDED');
  assert.equal(updates['riderCallInbox/rider_1/status'], 'ENDED');
  assert.equal(updates['inAppCalls/ord_demo_1/webrtc'], null);

  assert.equal(formatCallDuration(null, now), '00:00');
  assert.equal(formatCallDuration(now - 75_000, now), '01:15');
});

test('buildTripChatMessage masks phone numbers, blocks phishing links, and counts unread rider messages', () => {
  assert.equal(
    maskPhoneNumbersInText('Call me on 9876543210 or +91 9123456789'),
    'Call me on [Phone Hidden] or [Phone Hidden]'
  );

  const built = buildTripChatMessage({
    messageId: 'push_123',
    senderUid: 'cust_1',
    receiverUid: 'rider_1',
    rawMessage: 'Please call me when you arrive at gate 9876543210.',
    now: 1700000300000,
  });
  assert.equal(built.valid, true);
  assert.equal(built.record?.senderRole, 'CUSTOMER');
  assert.equal(built.record?.messageType, 'TEXT');
  assert.equal(built.record?.status, 'SENT');
  assert.equal(
    built.record?.message,
    'Please call me when you arrive at gate [Phone Hidden].'
  );

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
      m3: {
        messageId: 'm3',
        senderUid: 'cust_1',
        senderRole: 'CUSTOMER',
        receiverUid: 'rider_1',
        messageType: 'TEXT',
        message: 'Okay thank you',
        timestamp: 3000,
        status: 'SENT',
      },
    },
    'cust_1'
  );
  assert.equal(unread, 1);
});

test('isValidIceServerUrl and buildRtcConfiguration reject malformed URLs like 78336012r and keep valid STUN/TURN URLs', () => {
  assert.equal(isValidIceServerUrl('78336012r'), false);
  assert.equal(isValidIceServerUrl('http://example.com'), false);
  assert.equal(isValidIceServerUrl('stun:invalidhostwithoutdot:19302'), false);
  assert.equal(isValidIceServerUrl('stun:stun.cloudflare.com:3478'), true);
  assert.equal(isValidIceServerUrl('turn:turn.example.com:3478?transport=udp'), true);

  const badTurnCfg = buildRtcConfiguration({
    urls: '78336012r',
    username: 'u',
    credential: 'p',
  });
  assert.equal(badTurnCfg.iceServers?.length, 1);
  const stunEntry = badTurnCfg.iceServers?.[0];
  const stunList = Array.isArray(stunEntry?.urls) ? stunEntry.urls : [stunEntry?.urls];
  assert.equal(stunList.every((u) => isValidIceServerUrl(u)), true);
});

