import type { CartItem, GroupedOrder, OrderRecord, Store } from '../types/bazar';
import { normalizeOrderStatus } from './bazarLogic';

export interface ReceiptLineItem {
  name: string;
  storeName: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface OrderReceiptData {
  receiptNumber: string;
  orderId: string;
  placedAtText: string;
  status: string;
  paymentMode: string;
  paymentStatus: string;
  transactionId?: string;
  storeNames: string[];
  customerAddress: string;
  customerPhone: string;
  items: ReceiptLineItem[];
  subtotal: number;
  deliveryCharge: number;
  handlingFee: number;
  storeDiscount: number;
  couponDiscount: number;
  couponCode?: string;
  riderTip: number;
  cashbackEarned: number;
  deliverySlot?: string;
  cardLast4?: string;
  refundStatus?: string;
  grandTotal: number;
}

function normalizeItems(rawItems: CartItem[] | Record<string, CartItem> | undefined): CartItem[] {
  if (!rawItems) return [];
  return Array.isArray(rawItems) ? rawItems : Object.values(rawItems);
}

function roundMoney(n: number): number {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function buildOrderReceiptFromOrders(params: {
  receiptId: string;
  orders: OrderRecord[];
  stores: Record<string, Store>;
  status?: string;
  paymentMode?: string;
  address?: string;
  phone?: string;
  createdAt?: number;
  fallbackTotal?: number;
}): OrderReceiptData {
  const { orders, stores } = params;
  const lineItems: ReceiptLineItem[] = [];
  const storeSet = new Set<string>();

  let explicitSubtotal = 0;
  let explicitDelivery = 0;
  let explicitHandling = 0;
  let explicitStoreDiscount = 0;
  let explicitCouponDiscount = 0;
  let explicitRiderTip = 0;
  let explicitCashback = 0;
  let hasExplicitSubtotal = false;
  let hasExplicitFeeOrDiscount = false;
  let sumTotalAmount = 0;
  let firstCoupon = '';
  let firstTxId = '';
  let resolvedPayStatus = '';
  let firstDeliverySlot = '';
  let firstCardLast4 = '';
  let resolvedRefundStatus = '';

  orders.forEach((o, idx) => {
    const fallbackStore = stores[o.restaurantId]?.name || `Store ${idx + 1}`;
    const rawItems = normalizeItems(o.items);
    rawItems.forEach((item) => {
      const qty = Math.max(1, Number(item.qty || 1));
      const unitPrice = Math.max(0, Number(item.price || 0));
      const stName = item.storeName || fallbackStore;
      storeSet.add(stName);
      lineItems.push({
        name: item.name || 'Grocery Item',
        storeName: stName,
        qty,
        unitPrice: roundMoney(unitPrice),
        lineTotal: roundMoney(unitPrice * qty),
      });
    });

    if (rawItems.length === 0) {
      storeSet.add(fallbackStore);
    }

    if (typeof o.subtotalAmount === 'number') {
      explicitSubtotal += o.subtotalAmount;
      hasExplicitSubtotal = true;
    }
    if (typeof o.deliveryCharge === 'number') {
      explicitDelivery += o.deliveryCharge;
      hasExplicitFeeOrDiscount = true;
    }
    if (typeof o.handlingFee === 'number') {
      explicitHandling += o.handlingFee;
      hasExplicitFeeOrDiscount = true;
    }
    if (typeof o.riderTip === 'number') {
      explicitRiderTip += o.riderTip;
      hasExplicitFeeOrDiscount = true;
    }
    if (typeof o.cashbackEarned === 'number') {
      explicitCashback += o.cashbackEarned;
    }
    if (typeof o.storeDiscountAmount === 'number') {
      explicitStoreDiscount += o.storeDiscountAmount;
      hasExplicitFeeOrDiscount = true;
    }
    if (typeof o.discountAmount === 'number') {
      explicitCouponDiscount += o.discountAmount;
      hasExplicitFeeOrDiscount = true;
    }
    if (o.couponCode && !firstCoupon) firstCoupon = o.couponCode;
    if (o.transactionId && !firstTxId) firstTxId = o.transactionId;
    if (o.paymentStatus && !resolvedPayStatus) resolvedPayStatus = o.paymentStatus;
    if (o.deliverySlot && !firstDeliverySlot) firstDeliverySlot = o.deliverySlot;
    if (o.cardLast4 && !firstCardLast4) firstCardLast4 = o.cardLast4;
    if (o.refundStatus && o.refundStatus !== 'NONE' && !resolvedRefundStatus) {
      resolvedRefundStatus = o.refundStatus;
    }
    sumTotalAmount += Number(o.totalAmount || 0);
  });

  const computedItemSum = roundMoney(
    lineItems.reduce((acc, item) => acc + item.lineTotal, 0)
  );
  const grandTotal = roundMoney(
    sumTotalAmount > 0 ? sumTotalAmount : Number(params.fallbackTotal || computedItemSum)
  );

  const subtotal = roundMoney(hasExplicitSubtotal ? explicitSubtotal : computedItemSum || grandTotal);
  let deliveryCharge = roundMoney(explicitDelivery);
  const handlingFee = roundMoney(explicitHandling);
  const riderTip = roundMoney(explicitRiderTip);
  const cashbackEarned = roundMoney(explicitCashback);
  let storeDiscount = roundMoney(explicitStoreDiscount);
  const couponDiscount = roundMoney(explicitCouponDiscount);

  if (!hasExplicitFeeOrDiscount && subtotal > 0) {
    const diff = roundMoney(grandTotal - subtotal);
    if (diff > 0) {
      deliveryCharge = diff;
    } else if (diff < 0) {
      storeDiscount = Math.abs(diff);
    }
  }

  const primaryOrder = orders[0];
  const createdMs = Number(
    params.createdAt || primaryOrder?.placedAt || primaryOrder?.createdAt || Date.now()
  );
  const placedAtText = new Date(createdMs).toLocaleString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const cleanId = params.receiptId.replace(/[^a-zA-Z0-9_-]/g, '');
  const shortNum = (cleanId.slice(-6) || '000001').toUpperCase();
  const paymentMode = params.paymentMode || primaryOrder?.paymentMode || 'COD';
  const status = normalizeOrderStatus(params.status || primaryOrder?.status || 'PLACED');

  const paymentStatus =
    resolvedPayStatus ||
    (status === 'DELIVERED' || paymentMode === 'WALLET' || paymentMode === 'CARD'
      ? 'PAID'
      : status === 'CANCELLED'
        ? 'VOID'
        : paymentMode === 'COD'
          ? 'PAY ON DELIVERY'
          : 'PENDING');

  return {
    receiptNumber: `GB-${shortNum}`,
    orderId: params.receiptId,
    placedAtText,
    status,
    paymentMode: firstCardLast4 ? `${paymentMode} ••••${firstCardLast4}` : paymentMode,
    paymentStatus,
    transactionId: firstTxId || undefined,
    storeNames: Array.from(storeSet),
    customerAddress:
      params.address || primaryOrder?.address || 'Gossaigaon Local Delivery',
    customerPhone: params.phone || primaryOrder?.phone || '-',
    items: lineItems,
    subtotal,
    deliveryCharge,
    handlingFee,
    storeDiscount,
    couponDiscount,
    couponCode: firstCoupon || undefined,
    riderTip,
    cashbackEarned,
    deliverySlot: firstDeliverySlot || undefined,
    cardLast4: firstCardLast4 || undefined,
    refundStatus: resolvedRefundStatus || undefined,
    grandTotal,
  };
}

export function buildOrderReceiptFromGroup(
  group: GroupedOrder,
  stores: Record<string, Store>,
  derivedStatus?: string
): OrderReceiptData {
  return buildOrderReceiptFromOrders({
    receiptId: group.groupKey,
    orders: group.orders,
    stores,
    status: derivedStatus,
    paymentMode: group.paymentMode,
    address: group.address,
    phone: group.phone,
    createdAt: group.placedAt || group.createdAt,
    fallbackTotal: group.totalAmount,
  });
}

export function buildOrderReceiptFromOrder(
  order: OrderRecord,
  stores: Record<string, Store>
): OrderReceiptData {
  return buildOrderReceiptFromOrders({
    receiptId: order.orderId,
    orders: [order],
    stores,
    status: order.status,
    paymentMode: order.paymentMode,
    address: order.address,
    phone: order.phone,
    createdAt: order.placedAt || order.createdAt,
    fallbackTotal: order.totalAmount,
  });
}

function toAsciiPdfSafe(text: string): string {
  return String(text || '')
    .replace(/₹/g, 'Rs. ')
    .replace(/×/g, 'x')
    .replace(/[•–—]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapePdfLiteral(text: string): string {
  return toAsciiPdfSafe(text)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function truncateText(text: string, maxChars: number): string {
  const clean = toAsciiPdfSafe(text);
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(1, maxChars - 3))}...`;
}

function formatRs(amount: number): string {
  const abs = Math.abs(Number(amount || 0));
  const fixed = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return `Rs. ${fixed}`;
}

/**
 * Generates a valid, spec-compliant single-page PDF 1.4 binary document
 * using built-in Type1 Helvetica fonts with exact xref byte offsets.
 */
export function buildOrderReceiptPdfBytes(receipt: OrderReceiptData): Uint8Array {
  const pageW = 595;
  const leftX = 48;
  const rightX = 547;
  const commands: string[] = [];

  const drawText = (
    x: number,
    y: number,
    text: string,
    options?: { bold?: boolean; size?: number; color?: [number, number, number] }
  ) => {
    const font = options?.bold ? '/F2' : '/F1';
    const size = options?.size || 10;
    const [r, g, b] = options?.color || [0.06, 0.09, 0.16];
    commands.push(
      `BT ${font} ${size} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg 1 0 0 1 ${x} ${y} Tm (${escapePdfLiteral(text)}) Tj ET`
    );
  };

  const drawRightText = (
    rightEdgeX: number,
    y: number,
    text: string,
    options?: { bold?: boolean; size?: number; color?: [number, number, number] }
  ) => {
    const clean = toAsciiPdfSafe(text);
    const size = options?.size || 10;
    const approxCharW = size * (options?.bold ? 0.54 : 0.50);
    const estX = Math.max(leftX, Math.round(rightEdgeX - clean.length * approxCharW));
    drawText(estX, y, clean, options);
  };

  const drawLine = (y: number, color: [number, number, number] = [0.88, 0.91, 0.94], width = 0.75) => {
    const [r, g, b] = color;
    commands.push(
      `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG ${width} w ${leftX} ${y} m ${rightX} ${y} l S`
    );
  };

  // Green brand header banner
  commands.push('0.047 0.514 0.122 rg 0 762 595 80 re f');
  drawText(leftX, 804, 'CHUTKI', { bold: true, size: 18, color: [1, 1, 1] });
  drawText(leftX, 784, '15-Minute Express Local Grocery Delivery - Order Receipt', {
    size: 10,
    color: [0.86, 0.99, 0.90],
  });
  drawRightText(rightX, 804, receipt.receiptNumber, { bold: true, size: 14, color: [1, 1, 1] });
  drawRightText(rightX, 784, receipt.status, { bold: true, size: 10, color: [0.98, 0.87, 0.25] });

  let y = 736;
  drawText(leftX, y, 'Order Date:', { bold: true, size: 10, color: [0.39, 0.45, 0.55] });
  drawText(125, y, receipt.placedAtText, { size: 10 });
  drawRightText(rightX - 105, y, 'Payment:', { bold: true, size: 10, color: [0.39, 0.45, 0.55] });
  drawRightText(rightX, y, `${receipt.paymentMode} (${receipt.paymentStatus})`, { bold: true, size: 10 });

  y -= 18;
  drawText(leftX, y, 'Store(s):', { bold: true, size: 10, color: [0.39, 0.45, 0.55] });
  drawText(125, y, truncateText(receipt.storeNames.join(', ') || 'Local Store', 64), { bold: true, size: 10 });

  y -= 18;
  drawText(leftX, y, 'Deliver To:', { bold: true, size: 10, color: [0.39, 0.45, 0.55] });
  drawText(125, y, truncateText(receipt.customerAddress, 62), { size: 10 });

  y -= 18;
  drawText(leftX, y, 'Phone:', { bold: true, size: 10, color: [0.39, 0.45, 0.55] });
  drawText(125, y, receipt.customerPhone || '-', { size: 10 });
  if (receipt.transactionId) {
    drawRightText(rightX - 125, y, 'Ref:', { bold: true, size: 9, color: [0.39, 0.45, 0.55] });
    drawRightText(rightX, y, truncateText(receipt.transactionId, 24), { size: 9 });
  }

  y -= 16;
  drawLine(y, [0.79, 0.84, 0.89], 1);

  // Item table header
  y -= 18;
  commands.push(`0.965 0.976 0.988 rg ${leftX} ${y - 6} ${rightX - leftX} 22 re f`);
  drawText(leftX + 6, y, 'ITEM DESCRIPTION', { bold: true, size: 9, color: [0.28, 0.33, 0.41] });
  drawRightText(410, y, 'QTY', { bold: true, size: 9, color: [0.28, 0.33, 0.41] });
  drawRightText(478, y, 'RATE', { bold: true, size: 9, color: [0.28, 0.33, 0.41] });
  drawRightText(rightX - 6, y, 'AMOUNT', { bold: true, size: 9, color: [0.28, 0.33, 0.41] });
  y -= 12;

  const maxVisibleItems = Math.min(receipt.items.length, 20);
  for (let i = 0; i < maxVisibleItems; i += 1) {
    const item = receipt.items[i];
    y -= 18;
    drawText(leftX + 6, y, truncateText(item.name, 46), { bold: true, size: 10 });
    drawRightText(410, y, `x${item.qty}`, { size: 10 });
    drawRightText(478, y, formatRs(item.unitPrice), { size: 10 });
    drawRightText(rightX - 6, y, formatRs(item.lineTotal), { bold: true, size: 10 });

    if (receipt.storeNames.length > 1) {
      y -= 12;
      drawText(leftX + 6, y, truncateText(item.storeName, 44), {
        size: 8,
        color: [0.39, 0.45, 0.55],
      });
    }
    y -= 6;
    drawLine(y, [0.92, 0.94, 0.96], 0.5);
  }

  if (receipt.items.length > maxVisibleItems) {
    y -= 16;
    drawText(
      leftX + 6,
      y,
      `+ ${receipt.items.length - maxVisibleItems} more item(s) included in this order`,
      { size: 9, color: [0.39, 0.45, 0.55] }
    );
  }

  // Final Bill Summary section
  y -= 24;
  drawLine(y + 10, [0.79, 0.84, 0.89], 1);
  drawText(leftX, y - 6, 'BILL SUMMARY', { bold: true, size: 10, color: [0.047, 0.514, 0.122] });
  y -= 22;

  const addBillRow = (label: string, value: string, opts?: { bold?: boolean; green?: boolean }) => {
    drawText(leftX, y, label, {
      bold: opts?.bold,
      size: opts?.bold ? 11 : 10,
      color: opts?.green ? [0.047, 0.514, 0.122] : [0.20, 0.25, 0.33],
    });
    drawRightText(rightX, y, value, {
      bold: opts?.bold ?? true,
      size: opts?.bold ? 12 : 10,
      color: opts?.green ? [0.047, 0.514, 0.122] : [0.06, 0.09, 0.16],
    });
    y -= 18;
  };

  addBillRow('Item Subtotal', formatRs(receipt.subtotal));
  addBillRow(
    'Delivery Charge',
    receipt.deliveryCharge > 0 ? formatRs(receipt.deliveryCharge) : 'FREE',
    { green: receipt.deliveryCharge === 0 }
  );
  if (receipt.handlingFee > 0) {
    addBillRow('Handling Fee', formatRs(receipt.handlingFee));
  }
  if (receipt.riderTip > 0) {
    addBillRow('Rider Tip', formatRs(receipt.riderTip));
  }
  if (receipt.storeDiscount > 0) {
    addBillRow('Store Offer Discount', `-${formatRs(receipt.storeDiscount)}`, { green: true });
  }
  if (receipt.couponDiscount > 0) {
    addBillRow(
      receipt.couponCode ? `Coupon Discount (${receipt.couponCode})` : 'Coupon Discount',
      `-${formatRs(receipt.couponDiscount)}`,
      { green: true }
    );
  }
  if (receipt.deliverySlot) {
    addBillRow('Delivery Window', receipt.deliverySlot);
  }

  y -= 2;
  drawLine(y + 10, [0.047, 0.514, 0.122], 1.2);
  y -= 6;
  addBillRow('Grand Total Paid / Payable', formatRs(receipt.grandTotal), {
    bold: true,
    green: true,
  });
  if (receipt.cashbackEarned > 0) {
    addBillRow('Wallet Cashback Credited', `+${formatRs(receipt.cashbackEarned)}`, { green: true });
  }
  if (receipt.refundStatus) {
    addBillRow('Refund Status', receipt.refundStatus);
  }

  // Footer
  const footerY = Math.min(y - 18, 72);
  drawLine(footerY + 14, [0.88, 0.91, 0.94], 0.6);
  drawText(
    leftX,
    footerY,
    'Thank you for shopping local with Chutki!',
    { bold: true, size: 9, color: [0.39, 0.45, 0.55] }
  );
  drawRightText(
    rightX,
    footerY,
    `Order Ref: ${truncateText(receipt.orderId, 28)}`,
    { size: 8, color: [0.58, 0.64, 0.72] }
  );

  // unused variable guard if pageW checked
  void pageW;

  const streamContent = commands.join('\n');
  const encoder = new TextEncoder();
  const streamByteLen = encoder.encode(streamContent).length;

  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    `6 0 obj\n<< /Length ${streamByteLen} >>\nstream\n${streamContent}\nendstream\nendobj\n`,
  ];

  const headerBytes = new Uint8Array([
    ...encoder.encode('%PDF-1.4\n'),
    0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a,
  ]);
  const chunks: Uint8Array[] = [];
  chunks.push(headerBytes);

  let currentOffset = headerBytes.length;
  const offsets: number[] = [0];

  objects.forEach((obj) => {
    offsets.push(currentOffset);
    const bytes = encoder.encode(obj);
    chunks.push(bytes);
    currentOffset += bytes.length;
  });

  const xrefOffset = currentOffset;
  const xrefLines = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`];
  for (let i = 1; i <= objects.length; i += 1) {
    xrefLines.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  const trailer =
    `${xrefLines.join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  const trailerBytes = encoder.encode(trailer);
  chunks.push(trailerBytes);

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let pos = 0;
  chunks.forEach((c) => {
    result.set(c, pos);
    pos += c.length;
  });

  return result;
}
