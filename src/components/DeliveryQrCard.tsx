import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import type { GroupedOrder } from '../types/bazar';
import { buildDeliveryQrPayload } from '../utils/bazarLogic';
import { triggerHaptic } from '../utils/haptics';

interface DeliveryQrCardProps {
  group: GroupedOrder;
  allowDeliveryQr?: boolean;
}

export const DeliveryQrCard: React.FC<DeliveryQrCardProps> = ({
  group,
  allowDeliveryQr = true,
}) => {
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [isZoomOpen, setIsZoomOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrError, setQrError] = useState('');

  const qrPayload = useMemo(
    () =>
      buildDeliveryQrPayload({
        groupKey: group.groupKey,
        deliveryOtp: group.deliveryOtp,
        deliveryQrToken: group.deliveryQrToken,
        orders: group.orders,
      }),
    [group.groupKey, group.deliveryOtp, group.deliveryQrToken, group.orders]
  );

  useEffect(() => {
    if (!allowDeliveryQr) {
      setIsQrOpen(false);
      setIsZoomOpen(false);
    }
  }, [allowDeliveryQr]);

  useEffect(() => {
    if (!allowDeliveryQr || (!isQrOpen && !isZoomOpen)) return;
    let active = true;
    setQrError('');
    void QRCode.toDataURL(qrPayload, {
      width: 240,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrError('Unable to generate QR code. Use 4-digit PIN instead.');
      });
    return () => {
      active = false;
    };
  }, [allowDeliveryQr, isQrOpen, isZoomOpen, qrPayload]);

  if (!group.deliveryOtp) return null;

  return (
    <div className="delivery-verify-wrap">
      <div className="otp-security-badge delivery-verify-badge">
        <div className="delivery-verify-info">
          <div className="delivery-verify-label">🔐 Delivery PIN</div>
          <div className="delivery-verify-sub">
            {allowDeliveryQr
              ? 'Share PIN or QR with Rider on delivery'
              : 'Share with Rider on delivery'}
          </div>
        </div>
        <div className="delivery-verify-actions">
          <div className="otp-digits" data-testid="delivery-pin-digits">
            {group.deliveryOtp}
          </div>
          {allowDeliveryQr && (
            <button
              type="button"
              className={`delivery-qr-toggle-btn ${isQrOpen ? 'active' : ''}`}
              aria-expanded={isQrOpen}
              data-testid="toggle-delivery-qr-btn"
              onClick={() => {
                triggerHaptic('tap');
                setIsQrOpen((prev) => !prev);
              }}
            >
              <i
                className={isQrOpen ? 'fa-solid fa-chevron-up' : 'fa-solid fa-qrcode'}
                aria-hidden="true"
              />
              <span>{isQrOpen ? 'Hide QR' : 'Show QR'}</span>
            </button>
          )}
        </div>
      </div>

      {allowDeliveryQr && isQrOpen && (
        <div className="delivery-qr-panel" data-testid="delivery-qr-panel">
          <div className="delivery-qr-frame">
            {qrError ? (
              <div className="delivery-qr-error" role="alert">
                {qrError}
              </div>
            ) : qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`Delivery verification QR for order ${group.groupKey.slice(-6)}`}
                className="delivery-qr-img"
                data-testid="delivery-qr-img"
              />
            ) : (
              <div className="delivery-qr-loading">Generating QR...</div>
            )}
          </div>
          <div className="delivery-qr-caption">
            <strong>Scan QR to Complete Delivery</strong>
            <span>
              Rider scans this QR code (or enters PIN{' '}
              <strong>{group.deliveryOtp}</strong>) at your doorstep.
            </span>
          </div>
          <div className="delivery-qr-footer">
            <span className="delivery-qr-pin-pill">
              PIN: <strong>{group.deliveryOtp}</strong> • #{group.groupKey.slice(-6)}
            </span>
            {qrDataUrl && (
              <button
                type="button"
                className="btn btn-outline btn-sm delivery-qr-zoom-btn"
                data-testid="zoom-delivery-qr-btn"
                onClick={() => {
                  triggerHaptic('tap');
                  setIsZoomOpen(true);
                }}
              >
                <i className="fa-solid fa-expand" aria-hidden="true" /> Fullscreen QR
              </button>
            )}
          </div>
        </div>
      )}

      {allowDeliveryQr && isZoomOpen && qrDataUrl && (
        <div
          className="sheet-backdrop delivery-qr-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Fullscreen Delivery Verification QR"
          onClick={() => setIsZoomOpen(false)}
        >
          <div
            className="checkout-sheet delivery-qr-modal-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="delivery-qr-modal-head">
              <div>
                <h3>🛵 Delivery Verification QR</h3>
                <p>Order #{group.groupKey.slice(-6)}</p>
              </div>
              <button
                type="button"
                aria-label="Close delivery QR"
                onClick={() => setIsZoomOpen(false)}
                className="delivery-qr-modal-close"
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            <div className="delivery-qr-modal-frame">
              <img
                src={qrDataUrl}
                alt={`Fullscreen delivery verification QR for order ${group.groupKey.slice(-6)}`}
                className="delivery-qr-modal-img"
              />
            </div>
            <div className="delivery-qr-modal-pin-row">
              <span>Backup Delivery PIN</span>
              <strong className="otp-digits">{group.deliveryOtp}</strong>
            </div>
            <p className="delivery-qr-modal-note">
              Rider can scan this QR code directly to verify and mark your order Delivered.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
