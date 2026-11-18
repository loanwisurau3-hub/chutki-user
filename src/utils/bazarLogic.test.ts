import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CATEGORIES,
  DELIVERY_PROMISE_MS,
  buildDeliveryQrPayload,
  buildOrderStatusTimeline,
  buildShareCartUrl,
  calculateCheckoutSummary,
  calculateDistanceKm,
  calculateOrderCashback,
  computeDeliveryCountdown,
  decodeCartFromShareParam,
  deriveGroupOrderStatus,
  doesItemMatchCategory,
  encodeCartToShareParam,
  evaluateSpamRisk,
  extractStoreFilterOptions,
  filterPastOrdersByQuery,
  filterStoresByCategoryOrCuisine,
  filterStoresByQuery,
  findNearestAvailableRider,
  formatDistanceKmLabel,
  generateDeliveryQrToken,
  getActiveOrderGroups,
  getAvailableDeliverySlots,
  getPastOrdersFromCache,
  getProductStockInfo,
  getStoreDistanceKm,
  getStoreMostPopularItem,
  groupCustomerOrders,
  isChutkiPlusActive,
  isStoreWithinRadius,
  isValidIndianMobile,
  isValidUpiId,
  matchesKeywordSearch,
  mergePastOrderIntoCart,
  mergeSharedCartItems,
  parseDeliveryQrPayload,
  sortProductsByProximity,
  sortStoresByProximity,
} from './bazarLogic';
import type { DeliveryPartner, MenuItem, Store } from '../types/bazar';

test('validates Indian mobile numbers and UPI IDs accurately', () => {
  assert.equal(isValidIndianMobile('9876543210'), true);
  assert.equal(isValidIndianMobile('1234567890'), false);
  assert.equal(isValidIndianMobile('98765'), false);

  assert.equal(isValidUpiId('gossaigaon@apl'), true);
  assert.equal(isValidUpiId('invalidupi'), false);
});

test('calculates haversine distance cleanly', () => {
  const samePoint = calculateDistanceKm(26.4524, 89.9723, 26.4524, 89.9723);
  assert.equal(samePoint, 0);

  const nearby = calculateDistanceKm(26.4524, 89.9723, 26.4624, 89.9723);
  assert.ok(nearby !== null && nearby > 1.0 && nearby < 1.3);

  assert.equal(calculateDistanceKm(undefined, 89.9, 26.4, 89.9), null);
});

test('keyword search and category matching work across Hindi/English grocery terms', () => {
  const item: MenuItem = {
    itemId: 'i1',
    storeId: 's1',
    name: 'Fresh Red Tamatar',
    description: '1 kg Farm Fresh',
    searchKeywords: 'tomato sabzi veg',
    price: 40,
    mrp: 55,
  };

  assert.equal(matchesKeywordSearch(item, 'Raju Mart', 'tomato raju'), true);
  assert.equal(matchesKeywordSearch(item, 'Raju Mart', 'atta'), false);
  assert.equal(
    doesItemMatchCategory(item, 'VEG', DEFAULT_CATEGORIES, undefined),
    true
  );
  assert.equal(
    doesItemMatchCategory(item, 'ON_SALE', DEFAULT_CATEGORIES, undefined),
    true
  );
  assert.equal(
    doesItemMatchCategory(item, 'FAVORITES', DEFAULT_CATEGORIES, { s1___i1: true }),
    true
  );
});

test('calculates multi-store checkout discounts and free delivery threshold', () => {
  const stores: Record<string, Store> = {
    s1: { name: 'Store A', approved: true, isOpen: true, storeDiscountPercent: 10, storeDiscountMinOrder: 100 },
    s2: { name: 'Store B', approved: true, isOpen: true, storeDiscountPercent: 5, storeDiscountMinOrder: 500 },
  };
  const summary = calculateCheckoutSummary({
    items: [
      { itemId: '1', name: 'Rice', price: 150, qty: 1, imageUrl: '', storeId: 's1', storeName: 'Store A' },
      { itemId: '2', name: 'Milk', price: 60, qty: 1, imageUrl: '', storeId: 's2', storeName: 'Store B' },
    ],
    stores,
    baseDeliveryCharge: 25,
    freeDeliveryMinOrder: 299,
    handlingFee: 5,
    appliedDiscount: 20,
  });

  assert.equal(summary.subtotal, 210);
  assert.equal(summary.deliveryCharge, 25);
  assert.equal(summary.handlingFee, 5);
  assert.equal(summary.storeDiscount, 15);
  assert.equal(summary.couponDiscount, 20);
  assert.equal(summary.netPayable, 205);
  assert.equal(summary.freeDeliveryRemaining, 89);
});

test('assigns nearest online approved rider', () => {
  const riders: Record<string, DeliveryPartner> = {
    r1: { approved: true, online: true, suspended: false, lat: 26.49, lng: 89.99 },
    r2: { approved: true, online: true, suspended: false, lat: 26.453, lng: 89.973 },
    r3: { approved: true, online: false, suspended: false, lat: 26.4524, lng: 89.9723 },
  };
  assert.equal(findNearestAvailableRider(riders, 26.4524, 89.9723), 'r2');
});

test('detects duplicate and burst spam orders', () => {
  const now = 1_700_000_000_000;
  const recentOrders = {
    o1: {
      customerUid: 'u1',
      restaurantId: 's1',
      items: [],
      totalAmount: 150,
      status: 'PLACED',
      createdAt: now - 30_000,
    },
  };
  const dup = evaluateSpamRisk(recentOrders, 150, 'COD', now);
  assert.equal(dup.block, true);

  const ok = evaluateSpamRisk(recentOrders, 250, 'COD', now);
  assert.equal(ok.block, false);
  assert.equal(ok.isSpamSuspect, false);
});

test('groups multi-store orders and derives stepper status', () => {
  const grouped = groupCustomerOrders({
    o1: {
      batchGroupId: 'COMBO_1',
      customerUid: 'u1',
      restaurantId: 's1',
      items: [],
      totalAmount: 100,
      status: 'PACKING',
      createdAt: 1000,
      deliveryOtp: '1234',
    },
    o2: {
      batchGroupId: 'COMBO_1',
      customerUid: 'u1',
      restaurantId: 's2',
      items: [],
      totalAmount: 50,
      status: 'OUT_FOR_DELIVERY',
      createdAt: 1000,
      deliveryOtp: '1234',
    },
  });

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].totalAmount, 150);
  const derived = deriveGroupOrderStatus(grouped[0]);
  assert.equal(derived.status, 'OUT_FOR_DELIVERY');
  assert.equal(derived.stepProgressWidth, '70%');
  assert.equal(derived.s3, true);
  assert.equal(derived.s4, false);
});

test('getPastOrdersFromCache filters DELIVERED and CANCELLED orders newest-first', () => {
  const past = getPastOrdersFromCache({
    o_active: {
      customerUid: 'u1',
      restaurantId: 's1',
      items: [],
      totalAmount: 120,
      status: 'OUT_FOR_DELIVERY',
      createdAt: 5000,
    },
    o_deliv: {
      customerUid: 'u1',
      restaurantId: 's1',
      items: [],
      totalAmount: 240,
      status: 'DELIVERED',
      createdAt: 2000,
    },
    o_cancel: {
      customerUid: 'u1',
      restaurantId: 's2',
      items: [],
      totalAmount: 90,
      status: 'CANCELLED',
      createdAt: 4000,
    },
  });

  assert.equal(past.length, 2);
  assert.equal(past[0].orderId, 'o_cancel');
  assert.equal(past[1].orderId, 'o_deliv');

  const onlyDelivered = getPastOrdersFromCache(
    {
      o1: { customerUid: 'u1', restaurantId: 's1', items: [], totalAmount: 100, status: 'delivered', createdAt: 1000 },
      o2: { customerUid: 'u1', restaurantId: 's1', items: [], totalAmount: 90, status: 'CANCELLED', createdAt: 2000 },
    },
    'DELIVERED'
  );
  assert.equal(onlyDelivered.length, 1);
  assert.equal(onlyDelivered[0].orderId, 'o1');

  const onlyCancelled = getPastOrdersFromCache(
    {
      o1: { customerUid: 'u1', restaurantId: 's1', items: [], totalAmount: 100, status: 'DELIVERED', createdAt: 1000 },
      o2: { customerUid: 'u1', restaurantId: 's1', items: [], totalAmount: 90, status: 'cancelled ', createdAt: 2000 },
    },
    'CANCELLED'
  );
  assert.equal(onlyCancelled.length, 1);
  assert.equal(onlyCancelled[0].orderId, 'o2');

  const grouped = groupCustomerOrders({
    o_live: { customerUid: 'u1', restaurantId: 's1', items: [], totalAmount: 75, status: 'Preparing', createdAt: 3000 },
    o_done: { customerUid: 'u1', restaurantId: 's1', items: [], totalAmount: 95, status: 'DELIVERED', riderRating: 5, productsReviewed: true, createdAt: 2000 },
    o_void: { customerUid: 'u1', restaurantId: 's1', items: [], totalAmount: 55, status: 'CANCELLED', createdAt: 1000 },
  });
  const activeGroups = getActiveOrderGroups(grouped);
  assert.equal(activeGroups.length, 1);
  assert.equal(activeGroups[0].orders[0].orderId, 'o_live');
});

test('mergePastOrderIntoCart restores items, merges quantities, and skips closed stores', () => {
  const stores: Record<string, Store> = {
    s1: { name: 'Fresh Mart', approved: true, suspended: false, isOpen: true },
    s_closed: { name: 'Closed Shop', approved: true, suspended: false, isOpen: false },
  };
  const menus = {
    s1: {
      i1: { name: 'Milk', price: 30, available: true, adminApproved: true },
      i2: { name: 'Noodles', price: 54, available: true, adminApproved: true },
    },
  };

  const result = mergePastOrderIntoCart(
    [
      {
        itemId: 'i1',
        name: 'Milk',
        price: 28,
        qty: 1,
        imageUrl: '',
        storeId: 's1',
        storeName: 'Fresh Mart',
      },
    ],
    {
      restaurantId: 's1',
      items: [
        { itemId: 'i1', name: 'Milk', price: 28, qty: 2, imageUrl: '', storeId: 's1', storeName: 'Fresh Mart' },
        { itemId: 'i2', name: 'Noodles', price: 54, qty: 1, imageUrl: '', storeId: 's1', storeName: 'Fresh Mart' },
        { itemId: 'i3', name: 'Closed Item', price: 40, qty: 1, imageUrl: '', storeId: 's_closed', storeName: 'Closed Shop' },
      ],
    },
    stores,
    menus
  );

  assert.equal(result.addedUnits, 3);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.nextCart.length, 2);
  assert.equal(result.nextCart[0].qty, 3);
  assert.equal(result.nextCart[0].price, 30);
  assert.equal(result.nextCart[1].qty, 1);
});

test('Share Cart encodes, builds clean URLs, decodes safely, and resolves live catalog items', () => {
  const sampleCart = [
    { itemId: 'item_1', name: 'Milk', price: 28, qty: 2, imageUrl: '', storeId: 'store_2', storeName: 'Dairy' },
    { itemId: 'item_3', name: 'Noodles', price: 54, qty: 1, imageUrl: '', storeId: 'store_2', storeName: 'Dairy' },
  ];

  const shareUrl = buildShareCartUrl('https://bazar.example.com/?tab=orders', sampleCart);
  assert.ok(shareUrl.startsWith('https://bazar.example.com/?cart='));
  assert.equal(shareUrl.includes('autostart='), false);

  const demoUrl = buildShareCartUrl('http://localhost:3000/?autostart=1&tab=orders', sampleCart);
  assert.ok(demoUrl.includes('autostart=1'));

  const token = new URL(shareUrl).searchParams.get('cart');
  const decoded = decodeCartFromShareParam(token);
  assert.deepEqual(decoded, [
    { storeId: 'store_2', itemId: 'item_1', qty: 2 },
    { storeId: 'store_2', itemId: 'item_3', qty: 1 },
  ]);

  assert.equal(encodeCartToShareParam([]), '');
  assert.deepEqual(decodeCartFromShareParam('%%%invalid-token%%%'), []);

  const stores: Record<string, Store> = {
    store_2: { name: 'Brahmaputra Dairy', approved: true, suspended: false, isOpen: true },
  };
  const menus = {
    store_2: {
      item_1: { name: 'Amul Taaza Milk', price: 29, available: true, adminApproved: true },
      item_3: { name: 'Maggi Noodles', price: 54, available: false, adminApproved: true },
    },
  };

  const merged = mergeSharedCartItems([], decoded, stores, menus);
  assert.equal(merged.addedUnits, 2);
  assert.equal(merged.skippedCount, 1);
  assert.equal(merged.nextCart[0].price, 29);
  assert.equal(merged.nextCart[0].name, 'Amul Taaza Milk');
});

test('extractStoreFilterOptions and filterStoresByCategoryOrCuisine filter stores accurately', () => {
  const storeEntries: Array<[string, Store]> = [
    [
      's1',
      {
        name: 'Fresh Mart',
        cuisine: 'Vegetables, Fruits & Daily Staples',
        approved: true,
        isOpen: true,
      },
    ],
    [
      's2',
      {
        name: 'Brahmaputra Dairy',
        category: 'Dairy',
        cuisine: 'Milk, Paneer & Snacks',
        approved: true,
        isOpen: true,
      },
    ],
  ];
  const menus = {
    s1: {
      i1: { name: 'Tomato', price: 38, category: 'VEG', available: true, adminApproved: true },
    },
    s2: {
      i2: { name: 'Amul Milk', price: 28, category: 'DAIRY', available: true, adminApproved: true },
    },
  };

  const options = extractStoreFilterOptions(storeEntries, menus);
  assert.equal(options[0].id, 'ALL');
  assert.equal(options[0].count, 2);
  assert.ok(options.some((o) => o.label === 'Dairy' && o.count === 1));
  assert.ok(options.some((o) => o.label === 'Vegetables' && o.count === 1));
  assert.ok(options.some((o) => o.label === 'Milk' && o.count === 1));

  assert.equal(filterStoresByCategoryOrCuisine(storeEntries, 'ALL', menus).length, 2);
  const vegStores = filterStoresByCategoryOrCuisine(storeEntries, 'vegetables', menus);
  assert.deepEqual(vegStores.map(([id]) => id), ['s1']);
  const dairyStores = filterStoresByCategoryOrCuisine(storeEntries, 'dairy', menus);
  assert.deepEqual(dairyStores.map(([id]) => id), ['s2']);

  // Fallback when stores lack explicit cuisine/category strings
  const minimalStores: Array<[string, Store]> = [
    ['s1', { name: 'Mart One', approved: true }],
    ['s2', { name: 'Mart Two', approved: true }],
  ];
  const fallbackOptions = extractStoreFilterOptions(minimalStores, menus);
  assert.ok(fallbackOptions.some((o) => o.label === 'Vegetables & Fruits' && o.count === 1));
  assert.ok(fallbackOptions.some((o) => o.label === 'Milk & Dairy' && o.count === 1));
});

test('computeDeliveryCountdown calculates remaining time, progress, and overdue state', () => {
  const placedAt = 1_700_000_000_000;

  const fresh = computeDeliveryCountdown(placedAt, placedAt);
  assert.equal(fresh.formattedRemaining, '15:00');
  assert.equal(fresh.progressPercent, 0);
  assert.equal(fresh.isOverdue, false);

  const mid = computeDeliveryCountdown(placedAt, placedAt + 7 * 60 * 1000);
  assert.equal(mid.formattedRemaining, '08:00');
  assert.equal(mid.progressPercent, 47);
  assert.equal(mid.isFinalStretch, false);

  const finalStretch = computeDeliveryCountdown(
    placedAt,
    placedAt + DELIVERY_PROMISE_MS - 45_000
  );
  assert.equal(finalStretch.formattedRemaining, '00:45');
  assert.equal(finalStretch.isFinalStretch, true);
  assert.equal(finalStretch.isOverdue, false);
  assert.equal(finalStretch.label, 'Arriving shortly');

  const overdue = computeDeliveryCountdown(placedAt, placedAt + DELIVERY_PROMISE_MS + 90_000);
  assert.equal(overdue.formattedRemaining, '00:00');
  assert.equal(overdue.progressPercent, 100);
  assert.equal(overdue.isOverdue, true);
  assert.equal(overdue.label, 'Arriving any moment');

  const grouped = groupCustomerOrders({
    o1: {
      customerUid: 'u1',
      restaurantId: 's1',
      items: [],
      totalAmount: 100,
      status: 'PLACED',
      placedAt: placedAt - 120_000,
      createdAt: placedAt,
    },
  });
  assert.equal(grouped[0].placedAt, placedAt - 120_000);
});

test('buildOrderStatusTimeline tracks precise timestamps from Preparing to Packing and Out for Delivery', () => {
  const tPlaced = 1_700_000_000_000;
  const tPreparing = tPlaced + 45_000;
  const tPacking = tPlaced + 120_000;
  const tOut = tPlaced + 210_000;

  const grouped = groupCustomerOrders({
    o1: {
      customerUid: 'u1',
      restaurantId: 's1',
      items: [],
      totalAmount: 150,
      status: 'OUT_FOR_DELIVERY',
      placedAt: tPlaced,
      statusTimestamps: {
        PLACED: tPlaced,
        PREPARING: tPreparing,
        PACKING: tPacking,
      },
      outForDeliveryAt: tOut,
      createdAt: tPlaced,
    },
  });

  const timeline = buildOrderStatusTimeline(grouped[0]);
  assert.equal(timeline.length, 5);
  assert.equal(timeline[0].key, 'PLACED');
  assert.equal(timeline[0].state, 'completed');
  assert.equal(timeline[0].timestamp, tPlaced);

  assert.equal(timeline[1].key, 'PREPARING');
  assert.equal(timeline[1].state, 'completed');
  assert.equal(timeline[1].timestamp, tPreparing);

  assert.equal(timeline[2].key, 'PACKING');
  assert.equal(timeline[2].state, 'completed');
  assert.equal(timeline[2].timestamp, tPacking);

  assert.equal(timeline[3].key, 'OUT_FOR_DELIVERY');
  assert.equal(timeline[3].state, 'current');
  assert.equal(timeline[3].timestamp, tOut);

  assert.equal(timeline[4].key, 'DELIVERED');
  assert.equal(timeline[4].state, 'pending');
  assert.equal(timeline[4].formattedTime, 'Pending');
});

test('filterPastOrdersByQuery filters past orders by store name, ordered items, and multi-word query', () => {
  const stores: Record<string, Store> = {
    s1: { name: 'Gossaigaon Fresh Mart', approved: true },
    s2: { name: 'Brahmaputra Dairy & Bakery', approved: true },
  };
  const pastOrders = getPastOrdersFromCache({
    ord_1: {
      customerUid: 'u1',
      restaurantId: 's1',
      items: [
        { itemId: 'i1', name: 'Farm Fresh Red Tomato', price: 38, qty: 2, imageUrl: '', storeId: 's1', storeName: 'Gossaigaon Fresh Mart' },
        { itemId: 'i2', name: 'Aashirvaad Shudh Chakki Atta', price: 225, qty: 1, imageUrl: '', storeId: 's1', storeName: 'Gossaigaon Fresh Mart' },
      ],
      totalAmount: 301,
      status: 'DELIVERED',
      createdAt: 2000,
    },
    ord_2: {
      customerUid: 'u1',
      restaurantId: 's2',
      items: [
        { itemId: 'i4', name: 'Amul Taaza Toned Milk', price: 28, qty: 2, imageUrl: '', storeId: 's2', storeName: 'Brahmaputra Dairy & Bakery' },
        { itemId: 'i5', name: 'Maggi 2-Minute Masala Noodles', price: 54, qty: 1, imageUrl: '', storeId: 's2', storeName: 'Brahmaputra Dairy & Bakery' },
      ],
      totalAmount: 110,
      status: 'DELIVERED',
      createdAt: 3000,
    },
  });

  assert.equal(filterPastOrdersByQuery(pastOrders, '   ', stores).length, 2);
  assert.deepEqual(
    filterPastOrdersByQuery(pastOrders, 'brahmaputra', stores).map((o) => o.orderId),
    ['ord_2']
  );
  assert.deepEqual(
    filterPastOrdersByQuery(pastOrders, 'maggi', stores).map((o) => o.orderId),
    ['ord_2']
  );
  assert.deepEqual(
    filterPastOrdersByQuery(pastOrders, 'fresh atta', stores).map((o) => o.orderId),
    ['ord_1']
  );
  assert.equal(filterPastOrdersByQuery(pastOrders, 'nonexistent-item', stores).length, 0);
});

test('filterStoresByQuery filters stores by name, cuisine, category, and multi-word query', () => {
  const storeEntries: Array<[string, Store]> = [
    [
      's1',
      {
        name: 'Gossaigaon Fresh Mart',
        cuisine: 'Vegetables, Fruits & Daily Staples',
        category: 'Grocery',
        approved: true,
        isOpen: true,
      },
    ],
    [
      's2',
      {
        name: 'Brahmaputra Dairy & Bakery',
        cuisine: 'Milk, Sweets & Snacks',
        category: 'Dairy',
        approved: true,
        isOpen: true,
      },
    ],
    [
      's3',
      {
        name: 'Assam Kitchen Express',
        cuisine: 'Assamese Thali, Biryani & Fast Food',
        approved: true,
        isOpen: true,
      },
    ],
  ];

  assert.equal(filterStoresByQuery(storeEntries, '   ').length, 3);
  assert.deepEqual(
    filterStoresByQuery(storeEntries, 'brahmaputra').map(([id]) => id),
    ['s2']
  );
  assert.deepEqual(
    filterStoresByQuery(storeEntries, 'biryani').map(([id]) => id),
    ['s3']
  );
  assert.deepEqual(
    filterStoresByQuery(storeEntries, 'fresh vegetables').map(([id]) => id),
    ['s1']
  );
  assert.equal(filterStoresByQuery(storeEntries, 'nonexistent-cuisine').length, 0);
});

test('getStoreMostPopularItem picks the top-rated available approved item and respects closed stores', () => {
  const menus = {
    s1: {
      i1: { name: 'Tomato', price: 38, ratingAvg: 4.8, ratingCount: 14, available: true, adminApproved: true },
      i2: { name: 'Aashirvaad Atta', price: 225, ratingAvg: 4.9, ratingCount: 22, available: true, adminApproved: true },
      i3: { name: 'Out of stock Hero', price: 99, ratingAvg: 5.0, ratingCount: 100, available: false, adminApproved: true },
      i4: { name: 'Unapproved Hero', price: 89, ratingAvg: 5.0, ratingCount: 99, available: true, adminApproved: false },
    },
    s_unrated: {
      a: { name: 'Regular Rice', price: 60, available: true, adminApproved: true },
      b: { name: 'Promo Biscuit', price: 20, isOnSale: true, available: true, adminApproved: true },
    },
  };

  const popular = getStoreMostPopularItem('s1', menus, {
    name: 'Fresh Mart',
    approved: true,
    isOpen: true,
  });
  assert.equal(popular?.itemId, 'i2');
  assert.equal(popular?.storeName, 'Fresh Mart');

  assert.equal(
    getStoreMostPopularItem('s1', menus, { name: 'Fresh Mart', approved: true, isOpen: false }),
    null
  );
  assert.equal(
    getStoreMostPopularItem('s_unrated', menus)?.itemId,
    'b'
  );
  assert.equal(getStoreMostPopularItem('missing_store', menus), null);
});

test('handles Chutki Plus free delivery, rider tip, cashback, stock badges, slots, and favourite stores', () => {
  const nowMs = 1_700_000_000_000;
  assert.equal(isChutkiPlusActive({ plusActiveUntil: nowMs + 86_400_000 }, nowMs), true);
  assert.equal(isChutkiPlusActive({ plusActiveUntil: nowMs - 1000 }, nowMs), false);
  assert.equal(isChutkiPlusActive(null, nowMs), false);

  assert.deepEqual(getProductStockInfo({ stockCount: 0, available: true }), {
    count: 0,
    isOutOfStock: true,
    isLowStock: false,
    label: 'Out of Stock',
  });
  assert.deepEqual(getProductStockInfo({ stockCount: 4, available: true }), {
    count: 4,
    isOutOfStock: false,
    isLowStock: true,
    label: 'Only 4 left',
  });
  assert.deepEqual(getProductStockInfo({ stockCount: 18, available: true }), {
    count: 18,
    isOutOfStock: false,
    isLowStock: false,
    label: '18 in stock',
  });

  const morningSlots = getAvailableDeliverySlots(new Date('2025-05-01T09:00:00'));
  assert.equal(morningSlots[0].id, 'EXPRESS_15');
  assert.ok(morningSlots.some((s) => s.id === 'Today 11 AM - 12 PM'));

  assert.equal(calculateOrderCashback(200, 'COD', 5), 0);
  assert.equal(calculateOrderCashback(200, 'CARD', 5), 10);
  assert.equal(calculateOrderCashback(200, 'UPI', 5), 10);
  assert.equal(calculateOrderCashback(200, 'WALLET', 5), 10);

  const summary = calculateCheckoutSummary({
    items: [
      { itemId: '1', name: 'Atta', price: 150, qty: 1, imageUrl: '', storeId: 's1', storeName: 'Store A' },
    ],
    stores: { s1: { name: 'Store A', approved: true, isOpen: true } },
    baseDeliveryCharge: 25,
    freeDeliveryMinOrder: 299,
    handlingFee: 5,
    appliedDiscount: 0,
    riderTip: 20,
    isPlusActive: true,
    paymentMode: 'CARD',
    cashbackPercent: 5,
  });
  assert.equal(summary.deliveryCharge, 0);
  assert.equal(summary.isPlusFreeDelivery, true);
  assert.equal(summary.riderTip, 20);
  assert.equal(summary.netPayable, 175);
  assert.equal(summary.cashbackEarned, 8);

  const favOpts = extractStoreFilterOptions(
    [
      ['s1', { name: 'Store A', cuisine: 'Vegetables', approved: true, isOpen: true }],
      ['s2', { name: 'Store B', cuisine: 'Dairy', approved: true, isOpen: true }],
    ],
    {},
    DEFAULT_CATEGORIES,
    { s2: true }
  );
  assert.ok(favOpts.some((o) => o.id === 'FAV_STORES' && o.count === 1));
  const onlyFav = filterStoresByCategoryOrCuisine(
    [
      ['s1', { name: 'Store A', approved: true }],
      ['s2', { name: 'Store B', approved: true }],
    ],
    'FAV_STORES',
    {},
    DEFAULT_CATEGORIES,
    { s2: true }
  );
  assert.deepEqual(onlyFav.map(([id]) => id), ['s2']);
});

test('respects Admin overrides for scheduled delivery slots and cashback disabling', () => {
  const onlyExpress = getAvailableDeliverySlots(new Date('2025-05-01T09:00:00'), {
    allowScheduled: false,
  });
  assert.equal(onlyExpress.length, 1);
  assert.equal(onlyExpress[0].id, 'EXPRESS_15');

  const customSlots = getAvailableDeliverySlots(new Date('2025-05-01T09:00:00'), {
    allowScheduled: true,
    customSlots: ['Morning 7-8 AM', 'Evening 6-7 PM'],
  });
  assert.equal(customSlots.length, 3);
  assert.equal(customSlots[1].id, 'Morning 7-8 AM');
  assert.equal(customSlots[2].id, 'Evening 6-7 PM');

  const noCashbackSummary = calculateCheckoutSummary({
    items: [
      { itemId: '1', name: 'Atta', price: 200, qty: 1, imageUrl: '', storeId: 's1', storeName: 'Store A' },
    ],
    stores: { s1: { name: 'Store A', approved: true, isOpen: true } },
    baseDeliveryCharge: 25,
    freeDeliveryMinOrder: 299,
    handlingFee: 0,
    appliedDiscount: 0,
    paymentMode: 'UPI',
    allowCashback: false,
    cashbackPercent: 10,
  });
  assert.equal(noCashbackSummary.cashbackEarned, 0);

  const freeUnlockedSummary = calculateCheckoutSummary({
    items: [
      { itemId: '1', name: 'Rice', price: 320, qty: 1, imageUrl: '', storeId: 's1', storeName: 'Store A' },
    ],
    stores: { s1: { name: 'Store A', approved: true, isOpen: true } },
    baseDeliveryCharge: 25,
    freeDeliveryMinOrder: 299,
    handlingFee: 0,
    appliedDiscount: 0,
  });
  assert.equal(freeUnlockedSummary.deliveryCharge, 0);
  assert.equal(freeUnlockedSummary.freeDeliveryRemaining, 0);

  const cancelledGroups = groupCustomerOrders({
    ord_c1: {
      batchGroupId: 'GRP_CANCEL_1',
      customerUid: 'cust1',
      restaurantId: 's1',
      items: [],
      totalAmount: 120,
      address: 'Gossaigaon',
      phone: '9876543210',
      deliveryOtp: '1234',
      status: 'CANCELLED',
      paymentMode: 'COD',
      placedAt: 1000,
      cancelledAt: 2000,
      createdAt: 1000,
    },
  });
  assert.equal(cancelledGroups.length, 1);
  assert.equal(cancelledGroups[0].statusTimestamps?.CANCELLED, 2000);
});

test('Delivery QR helpers generate valid tokens, preserve them in grouped orders, and parse/reject payloads', () => {
  const token = generateDeliveryQrToken(12);
  assert.ok(token.startsWith('CHK'));
  assert.equal(token.length, 15);
  assert.match(token, /^CHK[A-Z0-9]+$/);

  const grouped = groupCustomerOrders({
    ord_qr_1: {
      batchGroupId: 'COMBO_QR_1',
      customerUid: 'cust1',
      restaurantId: 's1',
      items: [],
      totalAmount: 199,
      deliveryOtp: '7412',
      deliveryQrToken: token,
      status: 'PACKING',
      createdAt: 5000,
    },
    ord_qr_2: {
      batchGroupId: 'COMBO_QR_1',
      customerUid: 'cust1',
      restaurantId: 's2',
      items: [],
      totalAmount: 101,
      deliveryOtp: '7412',
      deliveryQrToken: token,
      status: 'OUT_FOR_DELIVERY',
      createdAt: 5000,
    },
  });

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].deliveryQrToken, token);

  const payloadRaw = buildDeliveryQrPayload({
    groupKey: grouped[0].groupKey,
    deliveryOtp: grouped[0].deliveryOtp,
    deliveryQrToken: grouped[0].deliveryQrToken,
    orders: grouped[0].orders,
  });
  const parsed = parseDeliveryQrPayload(payloadRaw);
  assert.deepEqual(parsed, {
    app: 'CHUTKI',
    type: 'DELIVERY_VERIFY',
    v: 1,
    groupKey: 'COMBO_QR_1',
    orderIds: ['ord_qr_1', 'ord_qr_2'],
    pin: '7412',
    token,
  });

  assert.equal(parseDeliveryQrPayload('not-json'), null);
  assert.equal(
    parseDeliveryQrPayload(JSON.stringify({ app: 'OTHER', type: 'DELIVERY_VERIFY', groupKey: 'g', orderIds: [], pin: '1234', token: 'x' })),
    null
  );
  assert.equal(
    parseDeliveryQrPayload(JSON.stringify({ app: 'CHUTKI', type: 'DELIVERY_VERIFY', groupKey: 'g', orderIds: [], pin: '1234', token: '' })),
    null
  );
});

test('prioritizes stores and products within 5km first on Home and Search lists while respecting Admin overrides', () => {
  const custLat = 26.4524;
  const custLng = 89.9723;
  const stores: Record<string, Store> = {
    far_store: { name: 'Highway Hypermarket', approved: true, isOpen: true, lat: 26.512, lng: 90.005 }, // ~7.4 km
    mid_nearby_store: { name: 'Mid Town Dairy', approved: true, isOpen: true, lat: 26.475, lng: 89.985 }, // ~2.8 km
    nearest_store: { name: 'Fresh Corner', approved: true, isOpen: true, lat: 26.453, lng: 89.973 }, // ~0.1 km
    no_coords_store: { name: 'Legacy Shop', approved: true, isOpen: true },
  };

  const dFar = getStoreDistanceKm(stores.far_store, custLat, custLng);
  const dMid = getStoreDistanceKm(stores.mid_nearby_store, custLat, custLng);
  const dNear = getStoreDistanceKm(stores.nearest_store, custLat, custLng);
  assert.ok(dFar !== null && dFar > 5);
  assert.ok(dMid !== null && dMid <= 5);
  assert.ok(dNear !== null && dNear <= 5 && dNear < dMid);
  assert.equal(isStoreWithinRadius(dNear, 5), true);
  assert.equal(isStoreWithinRadius(dFar, 5), false);
  assert.equal(formatDistanceKmLabel(0.12), '100 m');
  assert.equal(formatDistanceKmLabel(2.84), '2.8 km');

  const rawStoreEntries = Object.entries(stores); // far_store is first in insertion order!
  const sortedStores = sortStoresByProximity(rawStoreEntries, custLat, custLng, {
    radiusKm: 5,
    prioritizeNearby: true,
  });
  assert.deepEqual(
    sortedStores.map(([id]) => id),
    ['nearest_store', 'mid_nearby_store', 'far_store', 'no_coords_store']
  );

  // Store search also keeps 5km stores at the very top
  const searchedStores = filterStoresByQuery(sortedStores, 'corner highway'.split(' ')[0]);
  const searchedMultiStores = filterStoresByQuery(sortedStores, 'er');
  assert.equal(searchedStores[0][0], 'nearest_store');
  assert.deepEqual(searchedMultiStores.map(([id]) => id), ['nearest_store', 'far_store']);

  const products: MenuItem[] = [
    { itemId: 'p_far', storeId: 'far_store', storeName: 'Highway Hypermarket', name: 'Tomato Crate', price: 35, ratingAvg: 5 },
    { itemId: 'p_none', storeId: 'no_coords_store', storeName: 'Legacy Shop', name: 'Organic Tomato', price: 42 },
    { itemId: 'p_mid', storeId: 'mid_nearby_store', storeName: 'Mid Town Dairy', name: 'Cherry Tomato', price: 45 },
    { itemId: 'p_near', storeId: 'nearest_store', storeName: 'Fresh Corner', name: 'Red Tomato', price: 38 },
  ];

  // Home feed & search both rank <= 5km products strictly on top (nearest first)
  const homeRanked = sortProductsByProximity(products, stores, custLat, custLng, {
    radiusKm: 5,
    prioritizeNearby: true,
  });
  assert.deepEqual(
    homeRanked.map((p) => p.itemId),
    ['p_near', 'p_mid', 'p_far', 'p_none']
  );
  assert.equal(homeRanked[0].isWithinNearbyRadius, true);
  assert.equal(homeRanked[2].isWithinNearbyRadius, false);

  const searchRanked = sortProductsByProximity(products, stores, custLat, custLng, {
    radiusKm: 5,
    prioritizeNearby: true,
    searchQuery: 'tomato',
  });
  assert.deepEqual(
    searchRanked.map((p) => p.itemId),
    ['p_near', 'p_mid', 'p_far', 'p_none']
  );

  // Admin override: disabling prioritizeNearby preserves raw list order while still annotating distance
  const disabledSort = sortProductsByProximity(products, stores, custLat, custLng, {
    radiusKm: 5,
    prioritizeNearby: false,
  });
  assert.deepEqual(
    disabledSort.map((p) => p.itemId),
    ['p_far', 'p_none', 'p_mid', 'p_near']
  );
});


