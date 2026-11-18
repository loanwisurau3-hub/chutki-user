import React, { useState } from 'react';
import { buildOrderReceiptPdfBytes, type OrderReceiptData } from '../utils/orderReceipt';
import { triggerHaptic } from '../utils/haptics';

interface OrderReceiptCardProps {
  receipt: OrderReceiptData;
  brandName?: string;
  onClose?: () => void;
}

export const OrderReceiptCard: React.FC<OrderReceiptCardProps> = ({
  receipt,
  brandName,
  onClose,
}) => {
  const [isPrinting, setIsPrinting] = useState(false);

  const handleDownloadPdf = () => {
    triggerHaptic('success');
    const pdfBytes = buildOrderReceiptPdfBytes(receipt);
    const pdfBuffer = pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = `Chutki-Receipt-${receipt.receiptNumber}.pdf`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    window.setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
    }, 1500);
  };

  const handlePrint = () => {
    triggerHaptic('tap');
    setIsPrinting(true);
    const cleanup = () => {
      setIsPrinting(false);
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.requestAnimationFrame(() => {
      window.print();
      window.setTimeout(() => setIsPrinting(false), 1200);
    });
  };

  return (
    <div
      className={`order-receipt-card ${isPrinting ? 'is-printing' : ''}`}
      data-testid="order-receipt-view"
      role="region"
      aria-label={`Order Receipt ${receipt.receiptNumber}`}
    >
      <div className="order-receipt-banner">
        <div>
          <div className="order-receipt-brand">{(brandName || 'Chutki').toUpperCase()}</div>
          <div className="order-receipt-subtitle">Official Order Receipt &amp; Bill</div>
        </div>
        <div className="order-receipt-banner-right">
          <span className="order-receipt-no">{receipt.receiptNumber}</span>
          {onClose && (
            <button
              type="button"
              className="order-receipt-close"
              aria-label={`Close receipt ${receipt.receiptNumber}`}
              onClick={onClose}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="order-receipt-meta-grid">
        <div className="order-receipt-meta-cell">
          <span className="order-receipt-meta-label">Order Date</span>
          <strong className="order-receipt-meta-val">{receipt.placedAtText}</strong>
        </div>
        <div className="order-receipt-meta-cell">
          <span className="order-receipt-meta-label">Payment</span>
          <strong className="order-receipt-meta-val">
            {receipt.paymentMode} • {receipt.paymentStatus}
          </strong>
        </div>
        <div className="order-receipt-meta-cell order-receipt-meta-full">
          <span className="order-receipt-meta-label">Store(s)</span>
          <strong className="order-receipt-meta-val">
            {receipt.storeNames.join(', ')}
          </strong>
        </div>
        <div className="order-receipt-meta-cell order-receipt-meta-full">
          <span className="order-receipt-meta-label">Delivery Address</span>
          <strong className="order-receipt-meta-val">
            {receipt.customerAddress}
            {receipt.customerPhone && receipt.customerPhone !== '-'
              ? ` • ${receipt.customerPhone}`
              : ''}
          </strong>
        </div>
        {(receipt.deliverySlot || receipt.refundStatus) && (
          <div className="order-receipt-meta-cell order-receipt-meta-full">
            <span className="order-receipt-meta-label">Delivery &amp; Status</span>
            <strong className="order-receipt-meta-val">
              {receipt.deliverySlot || '⚡ Express (15 Mins)'}
              {receipt.refundStatus ? ` • Refund: ${receipt.refundStatus}` : ''}
            </strong>
          </div>
        )}
      </div>

      <table className="order-receipt-table" aria-label="Ordered items">
        <thead>
          <tr>
            <th>Item</th>
            <th className="num">Qty</th>
            <th className="num">Rate</th>
            <th className="num">Amt</th>
          </tr>
        </thead>
        <tbody>
          {receipt.items.map((item, idx) => (
            <tr key={`${item.name}_${idx}`}>
              <td>
                <div className="order-receipt-item-name">{item.name}</div>
                {receipt.storeNames.length > 1 && (
                  <div className="order-receipt-item-store">{item.storeName}</div>
                )}
              </td>
              <td className="num">{item.qty}</td>
              <td className="num">₹{item.unitPrice.toFixed(0)}</td>
              <td className="num strong">₹{item.lineTotal.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="order-receipt-bill">
        <div className="order-receipt-bill-row">
          <span>Item Subtotal</span>
          <span>₹{receipt.subtotal.toFixed(0)}</span>
        </div>
        <div className="order-receipt-bill-row">
          <span>Delivery Charge</span>
          <span className={receipt.deliveryCharge === 0 ? 'free' : ''}>
            {receipt.deliveryCharge > 0 ? `₹${receipt.deliveryCharge.toFixed(0)}` : 'FREE'}
          </span>
        </div>
        {receipt.handlingFee > 0 && (
          <div className="order-receipt-bill-row">
            <span>Handling Fee</span>
            <span>₹{receipt.handlingFee.toFixed(0)}</span>
          </div>
        )}
        {receipt.riderTip > 0 && (
          <div className="order-receipt-bill-row">
            <span>Rider Tip</span>
            <span>₹{receipt.riderTip.toFixed(0)}</span>
          </div>
        )}
        {receipt.storeDiscount > 0 && (
          <div className="order-receipt-bill-row discount">
            <span>Store Offer Discount</span>
            <span>-₹{receipt.storeDiscount.toFixed(0)}</span>
          </div>
        )}
        {receipt.couponDiscount > 0 && (
          <div className="order-receipt-bill-row discount">
            <span>
              Coupon Discount{receipt.couponCode ? ` (${receipt.couponCode})` : ''}
            </span>
            <span>-₹{receipt.couponDiscount.toFixed(0)}</span>
          </div>
        )}
        {receipt.cashbackEarned > 0 && (
          <div className="order-receipt-bill-row discount">
            <span>Wallet Cashback Earned</span>
            <span>+₹{receipt.cashbackEarned.toFixed(0)}</span>
          </div>
        )}
        <div className="order-receipt-bill-total">
          <span>Final Bill Total</span>
          <span>₹{receipt.grandTotal.toFixed(0)}</span>
        </div>
      </div>

      <div className="order-receipt-actions no-print">
        <button
          type="button"
          className="btn btn-primary btn-sm order-receipt-download-btn"
          data-testid="download-receipt-pdf-btn"
          onClick={handleDownloadPdf}
        >
          <i className="fa-solid fa-file-pdf" aria-hidden="true" /> Download PDF
        </button>
        <button
          type="button"
          className="btn btn-outline btn-sm order-receipt-print-btn"
          data-testid="print-receipt-btn"
          onClick={handlePrint}
        >
          <i className="fa-solid fa-print" aria-hidden="true" /> Print
        </button>
      </div>
    </div>
  );
};
