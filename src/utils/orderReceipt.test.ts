import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrderReceiptFromGroup,
  buildOrderReceiptFromOrder,
  buildOrderReceiptPdfBytes,
} from './orderReceipt';
import type { GroupedOrder, OrderRecord, Store } from '../types/bazar';

test('buildOrderReceiptFromGroup and buildOrderReceiptFromOrder calculate complete itemized bill summary', () => {
  const stores: Record<string, Store> = {
    s1: { name: 'Gossaigaon Fresh Mart', approved: true },
    s2: { name: 'Brahmaputra Dairy & Bakery', approved: true },
  };

  const group: GroupedOrder = {
    groupKey: 'COMBO_981234',
    createdAt: 1_700_000_000_000,
    placedAt: 1_700_000_000_000,
    deliveryOtp: '4829',
    paymentMode: 'UPI',
    phone: '9876543210',
    address: 'Station Road, Ward No. 4',
    totalAmount: 223,
    deliveryUid: 'rider_1',
    riderLat: null,
    riderLng: null,
    customerLat: null,
    customerLng: null,
    locationLink: '',
    emergencyAlert: false,
    emergencyDetails: '',
    orders: [
      {
        orderId: 'ord_1',
        customerUid: 'u1',
        restaurantId: 's1',
        items: [
          { itemId: 'i1', name: 'Farm Fresh Red Tomato', price: 38, qty: 2, imageUrl: '', storeId: 's1', storeName: 'Gossaigaon Fresh Mart' },
          { itemId: 'i2', name: 'Aashirvaad Chakki Atta', price: 225, qty: 1, imageUrl: '', storeId: 's1', storeName: 'Gossaigaon Fresh Mart' },
        ],
        subtotalAmount: 301,
        deliveryCharge: 0,
        handlingFee: 5,
        storeDiscountAmount: 30,
        discountAmount: 53,
        couponCode: 'GBSAVE',
        totalAmount: 223,
        status: 'OUT_FOR_DELIVERY',
        paymentMode: 'UPI',
        paymentStatus: 'VERIFIED',
        transactionId: 'UTR123456789012',
      },
    ],
  };

  const receipt = buildOrderReceiptFromGroup(group, stores, 'OUT_FOR_DELIVERY');
  assert.equal(receipt.receiptNumber, 'GB-981234');
  assert.equal(receipt.items.length, 2);
  assert.equal(receipt.items[0].lineTotal, 76);
  assert.equal(receipt.subtotal, 301);
  assert.equal(receipt.deliveryCharge, 0);
  assert.equal(receipt.handlingFee, 5);
  assert.equal(receipt.storeDiscount, 30);
  assert.equal(receipt.couponDiscount, 53);
  assert.equal(receipt.couponCode, 'GBSAVE');
  assert.equal(receipt.grandTotal, 223);
  assert.equal(receipt.paymentStatus, 'VERIFIED');

  const pastOrder: OrderRecord = {
    orderId: 'ord_demo_2',
    customerUid: 'u1',
    restaurantId: 's2',
    items: [
      { itemId: 'i4', name: 'Amul Taaza Toned Milk', price: 28, qty: 2, imageUrl: '', storeId: 's2', storeName: 'Brahmaputra Dairy & Bakery' },
      { itemId: 'i5', name: 'Maggi Noodles', price: 54, qty: 1, imageUrl: '', storeId: 's2', storeName: 'Brahmaputra Dairy & Bakery' },
    ],
    totalAmount: 110,
    status: 'DELIVERED',
    paymentMode: 'WALLET',
    createdAt: 1_700_000_000_000,
  };
  const pastReceipt = buildOrderReceiptFromOrder(pastOrder, stores);
  assert.equal(pastReceipt.receiptNumber, 'GB-DEMO_2');
  assert.equal(pastReceipt.subtotal, 110);
  assert.equal(pastReceipt.grandTotal, 110);
  assert.equal(pastReceipt.paymentStatus, 'PAID');
});

test('buildOrderReceiptPdfBytes generates valid PDF 1.4 header, content, xref offsets, and EOF', () => {
  const stores: Record<string, Store> = {
    s1: { name: 'Gossaigaon Fresh Mart', approved: true },
  };
  const order: OrderRecord = {
    orderId: 'ord_pdf_981234',
    customerUid: 'u1',
    restaurantId: 's1',
    items: [
      { itemId: 'i1', name: 'Fresh Red Tomato (1 kg)', price: 38, qty: 2, imageUrl: '', storeId: 's1', storeName: 'Gossaigaon Fresh Mart' },
    ],
    subtotalAmount: 76,
    deliveryCharge: 20,
    handlingFee: 4,
    storeDiscountAmount: 10,
    discountAmount: 0,
    totalAmount: 90,
    address: 'Station Road, Ward 4',
    phone: '9876543210',
    status: 'DELIVERED',
    paymentMode: 'COD',
    createdAt: 1_700_000_000_000,
  };

  const receipt = buildOrderReceiptFromOrder(order, stores);
  const pdfBytes = buildOrderReceiptPdfBytes(receipt);
  const pdfText = new TextDecoder().decode(pdfBytes);

  assert.ok(pdfText.startsWith('%PDF-1.4\n'));
  assert.ok(pdfText.includes('CHUTKI'));
  assert.ok(pdfText.includes('GB-981234'));
  assert.ok(pdfText.includes('Fresh Red Tomato'));
  assert.ok(pdfText.includes('Rs. 76'));
  assert.ok(pdfText.includes('Rs. 90'));
  assert.ok(pdfText.includes('xref\n0 7\n'));
  assert.ok(pdfText.trimEnd().endsWith('%%EOF'));

  // Verify xref byte offset table points accurately to "1 0 obj" byte offset
  const obj1Offset = Buffer.from(pdfBytes).indexOf('1 0 obj');
  assert.ok(obj1Offset > 0);
  const paddedOffset = String(obj1Offset).padStart(10, '0');
  assert.ok(pdfText.includes(`${paddedOffset} 00000 n `));
});

test('buildOrderReceiptFromOrder includes rider tip, delivery slot, cashback, and card last4', () => {
  const stores: Record<string, Store> = {
    s1: { name: 'Gossaigaon Fresh Mart', approved: true },
  };
  const order: OrderRecord = {
    orderId: 'ord_card_112233',
    customerUid: 'u1',
    restaurantId: 's1',
    items: [
      { itemId: 'i1', name: 'Aashirvaad Atta', price: 225, qty: 1, imageUrl: '', storeId: 's1', storeName: 'Gossaigaon Fresh Mart' },
    ],
    subtotalAmount: 225,
    deliveryCharge: 0,
    handlingFee: 5,
    riderTip: 20,
    cashbackEarned: 11,
    deliverySlot: 'Today 4 PM - 5 PM',
    cardLast4: '4242',
    totalAmount: 250,
    status: 'DELIVERED',
    paymentMode: 'CARD',
    paymentStatus: 'VERIFIED',
    createdAt: 1_700_000_000_000,
  };

  const receipt = buildOrderReceiptFromOrder(order, stores);
  assert.equal(receipt.riderTip, 20);
  assert.equal(receipt.cashbackEarned, 11);
  assert.equal(receipt.deliverySlot, 'Today 4 PM - 5 PM');
  assert.equal(receipt.paymentMode, 'CARD ••••4242');

  const pdfText = new TextDecoder().decode(buildOrderReceiptPdfBytes(receipt));
  assert.ok(pdfText.includes('Rider Tip'));
  assert.ok(pdfText.includes('Today 4 PM - 5 PM'));
  assert.ok(pdfText.includes('Wallet Cashback Credited'));
});

