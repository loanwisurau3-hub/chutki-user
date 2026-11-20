import React, { useEffect, useRef, useState } from 'react';
import type { CartItem, GroupedOrder, OrderRecord, Store } from '../types/bazar';
import {
  buildShareCartUrl,
  formatDistanceKmLabel,
  getAvailableDeliverySlots,
  groupCartByStore,
} from '../utils/bazarLogic';
import { calculateDistanceCheckoutSummary } from '../utils/distanceDelivery';
import { compressImageToDataUrl, DEFAULT_PRODUCT_IMG } from '../utils/imageUtils';
import {
  buildVerifiedUpiUri,
  validatePaymentCard,
  validateUpiUtr,
} from '../utils/security';
import { triggerHaptic } from '../utils/haptics';

interface CheckoutModalProps {
  isOpen: boolean;
  cartItems: CartItem[];
  stores: Record<string, Store>;
  walletBalance: number;
  adminUpiId: string;
  usedUtrs?: string[];
  baseDeliveryCharge: number;
  customerLat?: number | null;
  customerLng?: number | null;
  baseDeliveryDistanceKm?: number;
  perKmDeliveryCharge?: number;
  maxDeliveryCharge?: number;
  allowDistanceDeliveryCharge?: boolean;
  freeDeliveryMinOrder: number;
  handlingFee: number;
  isPlusActive: boolean;
  allowChutkiPlus?: boolean;
  plusPlanPrice: number;
  allowCashback?: boolean;
  cashbackPercent: number;
  allowRiderTip?: boolean;
  riderTipOptions?: number[];
  allowScheduledDelivery?: boolean;
  customDeliverySlots?: string[];
  allowCod: boolean;
  allowUpi: boolean;
  allowCardPayment?: boolean;
  allowWalletPayment?: boolean;
  allowCoupons: boolean;
  cmsCouponCode: string;
  cmsCouponDiscount: number;
  cmsCouponMinOrder: number;
  minOrderAmount?: number;
  initialAddress: string;
  initialPhone: string;
  hasGpsAttached: boolean;
  isFetchingGps: boolean;
  isPlacingOrder: boolean;
  isActivatingPlus?: boolean;
  onClose: () => void;
  onUpdateCart: (itemId: string, storeId: string, change: number) => void;
  onFetchGps: () => void;
  onActivatePlus: () => void;
  onPlaceOrder: (payload: {
    address: string;
    phone: string;
    paymentMode: 'COD' | 'UPI' | 'CARD' | 'WALLET';
    utr: string;
    screenshotData: string;
    appliedDiscount: number;
    appliedCouponCode: string;
    riderTip: number;
    deliverySlot: string;
    cardHolderName?: string;
    cardNumber?: string;
    cardExpiry?: string;
    cardCvv?: string;
  }) => void;
  showToast: (msg: string, type?: 'success' | 'danger' | 'info') => void;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  isOpen,
  cartItems,
  stores,
  walletBalance,
  adminUpiId,
  usedUtrs,
  baseDeliveryCharge,
  customerLat = null,
  customerLng = null,
  baseDeliveryDistanceKm = 2,
  perKmDeliveryCharge = 8,
  maxDeliveryCharge = 0,
  allowDistanceDeliveryCharge = true,
  freeDeliveryMinOrder,
  handlingFee,
  isPlusActive,
  allowChutkiPlus = true,
  plusPlanPrice,
  allowCashback = true,
  cashbackPercent,
  allowRiderTip = true,
  riderTipOptions,
  allowScheduledDelivery = true,
  customDeliverySlots,
  allowCod,
  allowUpi,
  allowCardPayment = true,
  allowWalletPayment = true,
  allowCoupons,
  cmsCouponCode,
  cmsCouponDiscount,
  cmsCouponMinOrder,
  minOrderAmount = 0,
  initialAddress,
  initialPhone,
  hasGpsAttached,
  isFetchingGps,
  isPlacingOrder,
  isActivatingPlus = false,
  onClose,
  onUpdateCart,
  onFetchGps,
  onActivatePlus,
  onPlaceOrder,
  showToast,
}) => {
  const availablePayModes: Array<'COD' | 'UPI' | 'CARD' | 'WALLET'> = [];
  if (allowCod) availablePayModes.push('COD');
  if (allowUpi) availablePayModes.push('UPI');
  if (allowCardPayment) availablePayModes.push('CARD');
  if (allowWalletPayment) availablePayModes.push('WALLET');
  const defaultPayMode: 'COD' | 'UPI' | 'CARD' | 'WALLET' =
    availablePayModes[0] || 'COD';

  const [address, setAddress] = useState(initialAddress);
  const [phone, setPhone] = useState(initialPhone);
  const [couponInput, setCouponInput] = useState('');
  const [appliedDiscount, setAppliedDiscount] = useState(0);
  const [appliedCouponCode, setAppliedCouponCode] = useState('');
  const [paymentMode, setPaymentMode] = useState<'COD' | 'UPI' | 'CARD' | 'WALLET'>(
    defaultPayMode
  );
  const [utr, setUtr] = useState('');
  const [screenshotData, setScreenshotData] = useState('');
  const [riderTip, setRiderTip] = useState<number>(0);
  const [deliverySlot, setDeliverySlot] = useState<string>('EXPRESS_15');
  const [cardHolderName, setCardHolderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [isSharePanelOpen, setIsSharePanelOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setAddress(initialAddress);
      setPhone(initialPhone);
      setAppliedDiscount(0);
      setAppliedCouponCode('');
      setCouponInput('');
      setUtr('');
      setScreenshotData('');
      setRiderTip(0);
      setDeliverySlot('EXPRESS_15');
      setCardHolderName('');
      setCardNumber('');
      setCardExpiry('');
      setCardCvv('');
      setIsSharePanelOpen(false);
      setShareCopied(false);
      setPaymentMode(defaultPayMode);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, initialAddress, initialPhone, defaultPayMode]);

  useEffect(() => {
    if (isOpen && initialAddress) {
      setAddress(initialAddress);
    }
  }, [isOpen, initialAddress]);

  useEffect(() => {
    if (isOpen && initialPhone && !phone) {
      setPhone(initialPhone);
    }
  }, [isOpen, initialPhone, phone]);

  useEffect(() => {
    if (availablePayModes.length > 0 && !availablePayModes.includes(paymentMode)) {
      setPaymentMode(availablePayModes[0]);
    }
  }, [allowCod, allowUpi, allowCardPayment, allowWalletPayment, paymentMode]);

  useEffect(() => {
    if (!allowRiderTip && riderTip !== 0) {
      setRiderTip(0);
    }
  }, [allowRiderTip, riderTip]);

  useEffect(() => {
    if (!allowScheduledDelivery && deliverySlot !== 'EXPRESS_15') {
      setDeliverySlot('EXPRESS_15');
    }
  }, [allowScheduledDelivery, deliverySlot]);

  const couponMinThreshold = cmsCouponMinOrder > 0 ? cmsCouponMinOrder : 100;
  useEffect(() => {
    if (appliedDiscount <= 0) return;
    const currentSubtotal = cartItems.reduce(
      (acc, item) => acc + item.price * item.qty,
      0
    );
    if (!allowCoupons || currentSubtotal < couponMinThreshold) {
      setAppliedDiscount(0);
      setAppliedCouponCode('');
    }
  }, [allowCoupons, appliedDiscount, cartItems, couponMinThreshold]);

  if (!isOpen || cartItems.length === 0) return null;

  const groupedByStore = groupCartByStore(cartItems, stores);
  const deliverySlots = getAvailableDeliverySlots(new Date(), {
    allowScheduled: allowScheduledDelivery,
    customSlots: customDeliverySlots,
  });
  const activeTipChoices =
    Array.isArray(riderTipOptions) && riderTipOptions.length > 0
      ? riderTipOptions.filter((n) => Number.isFinite(n) && n > 0)
      : [10, 20, 30, 50];
  const effectiveTip = allowRiderTip ? riderTip : 0;
  const summary = calculateDistanceCheckoutSummary({
    items: cartItems,
    stores,
    baseDeliveryCharge,
    freeDeliveryMinOrder,
    handlingFee,
    appliedDiscount,
    riderTip: effectiveTip,
    isPlusActive,
    paymentMode,
    allowCashback,
    cashbackPercent,
    customerLat,
    customerLng,
    baseDeliveryDistanceKm,
    perKmDeliveryCharge,
    maxDeliveryCharge,
    allowDistanceDeliveryCharge,
  });
  const hasClosedStore = groupedByStore.some((g) => g.isClosed);
  const belowMinOrder = minOrderAmount > 0 && summary.subtotal < minOrderAmount;

  const shareUrl = buildShareCartUrl(
    typeof window !== 'undefined' ? window.location.href : 'https://gossaigaonbazar.app/',
    cartItems
  );
  const totalUnitCount = cartItems.reduce((acc, item) => acc + item.qty, 0);
  const shareText = `Check out my Chutki basket (${totalUnitCount} item${totalUnitCount > 1 ? 's' : ''}, ₹${summary.subtotal.toFixed(0)}): ${shareUrl}`;
  const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  const supportsNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copyShareUrl = async (showFallbackToast = true) => {
    if (!shareUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        triggerHaptic('tap');
        setShareCopied(true);
        showToast('🔗 Cart share link copied!', 'success');
        setTimeout(() => setShareCopied(false), 2500);
        return;
      }
    } catch {
      // Fallback toast below when clipboard access is blocked
    }
    if (showFallbackToast) {
      showToast('Share link ready—copy from the box above!', 'info');
    }
  };

  const handleOpenShareCart = () => {
    if (!shareUrl) return;
    triggerHaptic('tap');
    const nextOpen = !isSharePanelOpen;
    setIsSharePanelOpen(nextOpen);
    if (nextOpen) {
      void copyShareUrl(false);
    }
  };

  const handleNativeShare = async () => {
    if (!supportsNativeShare || !shareUrl) return;
    try {
      await navigator.share({
        title: 'Chutki Basket',
        text: `Here is my grocery basket (${totalUnitCount} item${totalUnitCount > 1 ? 's' : ''}, ₹${summary.subtotal.toFixed(0)}):`,
        url: shareUrl,
      });
    } catch {
      // User dismissed share sheet
    }
  };

  const verifiedUpiString = buildVerifiedUpiUri({
    payeeVpa: adminUpiId,
    payeeName: 'Chutki',
    amount: summary.netPayable,
  });
  const checkoutUtrCheck =
    !isPlacingOrder && utr.trim().length > 0
      ? validateUpiUtr(utr, usedUtrs)
      : null;
  const isUpiUtrBlocked =
    paymentMode === 'UPI' &&
    !isPlacingOrder &&
    Boolean(checkoutUtrCheck && !checkoutUtrCheck.valid);
  const hasAnyCardInput =
    cardHolderName.trim().length > 0 ||
    cardNumber.trim().length > 0 ||
    cardExpiry.trim().length > 0 ||
    cardCvv.trim().length > 0;
  const cardCheck = hasAnyCardInput
    ? validatePaymentCard({
        holderName: cardHolderName,
        cardNumber,
        expiry: cardExpiry,
        cvv: cardCvv,
      })
    : null;

  const handleApplyCoupon = () => {
    if (!allowCoupons) {
      triggerHaptic('tap');
      showToast('Coupons are disabled.', 'info');
      return;
    }
    const code = couponInput.trim().toUpperCase();
    const targetCode = cmsCouponCode || 'GOSSAIGAON20';
    const targetDiscount = cmsCouponDiscount > 0 ? cmsCouponDiscount : 20;
    const minOrd = cmsCouponMinOrder > 0 ? cmsCouponMinOrder : 100;
    if (code === targetCode) {
      if (summary.subtotal < minOrd) {
        triggerHaptic('error');
        showToast(`Min ₹${minOrd} required for ${targetCode}!`, 'danger');
        return;
      }
      setAppliedDiscount(targetDiscount);
      setAppliedCouponCode(code);
      triggerHaptic('success');
      showToast(`🎉 ₹${targetDiscount} Coupon Applied!`, 'success');
    } else {
      triggerHaptic('error');
      showToast(`Invalid Coupon! Try ${targetCode}`, 'danger');
    }
  };

  const handleScreenshotFile = async (file?: File) => {
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setScreenshotData(dataUrl);
      triggerHaptic('success');
      showToast('📸 Payment screenshot attached!', 'success');
    } catch (err) {
      triggerHaptic('error');
      showToast(err instanceof Error ? err.message : 'Invalid file', 'danger');
    }
  };

  return (
    <div id="checkout-modal" className="sheet-backdrop" onClick={onClose}>
      <div className="checkout-sheet" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '0.85rem',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontWeight: 900, fontSize: '1.2rem' }}>
              My Unified Basket
            </h3>
            <span
              id="checkout-store-name"
              style={{
                fontSize: '0.76rem',
                color: 'var(--text-muted)',
                fontWeight: 700,
              }}
            >
              {groupedByStore.length > 1
                ? `${groupedByStore.length} Stores in 1 Order`
                : `Store: ${groupedByStore[0]?.storeName}`}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <button
              type="button"
              id="btn-share-cart"
              className={`btn btn-outline btn-sm share-cart-btn ${isSharePanelOpen ? 'active' : ''}`}
              aria-label="Share Cart"
              aria-expanded={isSharePanelOpen}
              onClick={handleOpenShareCart}
            >
              <i className="fa-solid fa-share-nodes" aria-hidden="true" />
              <span>Share Cart</span>
            </button>
            <button
              type="button"
              aria-label="Close checkout"
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '1.3rem',
                cursor: 'pointer',
                color: '#64748b',
              }}
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        </div>

        {isSharePanelOpen && shareUrl && (
          <section className="share-cart-panel" aria-label="Share Cart Link">
            <div className="share-cart-panel-head">
              <div>
                <div className="share-cart-title">Send Basket to Friends or Family</div>
                <div className="share-cart-subtitle">
                  Anyone with this link can load these {totalUnitCount} item
                  {totalUnitCount > 1 ? 's' : ''} right into their cart.
                </div>
              </div>
              <button
                type="button"
                className="share-cart-close-btn"
                aria-label="Close share cart panel"
                onClick={() => setIsSharePanelOpen(false)}
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
            <div className="share-cart-url-row">
              <input
                type="text"
                readOnly
                id="share-cart-url-input"
                aria-label="Shareable cart URL"
                className="form-input share-cart-url-input"
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button
                type="button"
                id="btn-copy-share-cart"
                className="btn btn-primary btn-sm share-cart-copy-btn"
                aria-label="Copy cart link"
                onClick={() => void copyShareUrl()}
              >
                <i
                  className={shareCopied ? 'fa-solid fa-check' : 'fa-regular fa-copy'}
                  aria-hidden="true"
                />
                <span>{shareCopied ? 'Copied!' : 'Copy Link'}</span>
              </button>
            </div>
            <div className="share-cart-actions-row">
              <a
                href={whatsappShareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-outline btn-sm share-cart-wa-link"
                aria-label="Share cart on WhatsApp"
              >
                <i className="fa-brands fa-whatsapp" aria-hidden="true" />
                <span>Send via WhatsApp</span>
              </a>
              {supportsNativeShare && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm share-cart-native-btn"
                  aria-label="Share cart using device sheet"
                  onClick={() => void handleNativeShare()}
                >
                  <i className="fa-solid fa-arrow-up-from-bracket" aria-hidden="true" />
                  <span>More Options</span>
                </button>
              )}
            </div>
          </section>
        )}

        <div
          style={{
            background: summary.isPlusFreeDelivery ? '#fefce8' : 'var(--brand-green-light)',
            border: summary.isPlusFreeDelivery ? '1px solid #fde68a' : undefined,
            borderRadius: '12px',
            padding: '0.65rem 0.85rem',
            marginBottom: '0.85rem',
          }}
        >
          <div
            id="free-delivery-text"
            style={{
              fontSize: '0.76rem',
              fontWeight: 800,
              color: summary.isPlusFreeDelivery ? '#854d0e' : 'var(--brand-green)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            <span>
              {summary.isPlusFreeDelivery ? (
                <>
                  👑 <strong>Chutki Plus Active:</strong> FREE Delivery Unlocked!
                </>
              ) : summary.deliveryCharge === 0 ? (
                <>
                  🎉 <strong>FREE Delivery Unlocked!</strong> (Saved ₹
                  {summary.effectiveBaseDeliveryCharge})
                </>
              ) : (
                <>
                  🚚 Add <strong>₹{summary.freeDeliveryRemaining.toFixed(0)}</strong>{' '}
                  more for <strong>FREE Delivery!</strong>
                </>
              )}
            </span>
            {!isPlusActive && allowChutkiPlus && (
              <button
                type="button"
                className="plus-upsell-chip"
                data-testid="checkout-plus-upsell-btn"
                disabled={isActivatingPlus}
                onClick={onActivatePlus}
              >
                {isActivatingPlus ? '⏳ Activating...' : `👑 Plus ₹${plusPlanPrice}`}
              </button>
            )}
          </div>
          <div
            style={{
              width: '100%',
              height: '6px',
              background: summary.isPlusFreeDelivery ? '#fef08a' : '#c8e6c9',
              borderRadius: '10px',
              marginTop: '5px',
              overflow: 'hidden',
            }}
          >
            <div
              id="free-delivery-bar"
              style={{
                height: '100%',
                width: `${summary.freeDeliveryProgressPercent}%`,
                background: summary.isPlusFreeDelivery ? '#ca8a04' : 'var(--brand-green)',
              }}
            />
          </div>
        </div>

        <div
          id="checkout-items-list"
          style={{ maxHeight: '210px', overflowY: 'auto', marginBottom: '0.85rem' }}
        >
          {groupedByStore.map((storeGroup) => (
            <div
              key={storeGroup.storeId}
              className="store-basket-group"
              style={
                storeGroup.isClosed
                  ? { borderColor: 'var(--danger)', background: '#fef2f2' }
                  : undefined
              }
            >
              <div className="store-basket-header">
                <span>
                  <i className="fa-solid fa-store" /> {storeGroup.storeName}
                </span>
                {storeGroup.isClosed && (
                  <span style={{ color: 'var(--danger)', fontSize: '0.68rem' }}>
                    🔴 STORE CLOSED (Remove items)
                  </span>
                )}
              </div>
              {storeGroup.items.map((item) => (
                <div key={`${storeGroup.storeId}_${item.itemId}`} className="upgraded-cart-row">
                  <img
                    src={item.imageUrl || DEFAULT_PRODUCT_IMG}
                    className="cart-thumb-img"
                    onError={(e) => {
                      if (e.currentTarget.src !== DEFAULT_PRODUCT_IMG) {
                        e.currentTarget.src = DEFAULT_PRODUCT_IMG;
                      }
                    }}
                    alt={item.name}
                  />
                  <div style={{ flex: 1, padding: '0 6px' }}>
                    <div
                      style={{
                        fontSize: '0.86rem',
                        fontWeight: 800,
                        color: '#111',
                        lineHeight: 1.2,
                      }}
                    >
                      {item.name}
                    </div>
                    <div
                      style={{
                        fontSize: '0.74rem',
                        color: '#64748b',
                        marginTop: '2px',
                      }}
                    >
                      ₹{item.price} each
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      gap: '4px',
                    }}
                  >
                    <strong style={{ fontSize: '0.95rem', color: '#111' }}>
                      ₹{(item.price * item.qty).toFixed(0)}
                    </strong>
                    <div className="qc-counter" style={{ borderRadius: '6px' }}>
                      <button
                        type="button"
                        className="qc-counter-btn"
                        style={{ padding: '3px 8px' }}
                        onClick={() =>
                          onUpdateCart(item.itemId, storeGroup.storeId, -1)
                        }
                      >
                        -
                      </button>
                      <span
                        className="qc-counter-val"
                        style={{ fontSize: '0.75rem' }}
                      >
                        {item.qty}
                      </span>
                      <button
                        type="button"
                        className="qc-counter-btn"
                        style={{ padding: '3px 8px' }}
                        onClick={() =>
                          onUpdateCart(item.itemId, storeGroup.storeId, 1)
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {allowCoupons && (
          <div
            id="coupon-row-wrap"
            style={{ display: 'flex', gap: '8px', marginBottom: '0.85rem', alignItems: 'center' }}
          >
            <input
              type="text"
              id="coupon-input"
              className="form-input"
              style={{
                padding: '0.5rem 0.75rem',
                fontSize: '0.82rem',
                textTransform: 'uppercase',
              }}
              placeholder={`Try Coupon: ${cmsCouponCode || 'GOSSAIGAON20'}`}
              value={couponInput}
              onChange={(e) => setCouponInput(e.target.value)}
            />
            {appliedDiscount > 0 ? (
              <button
                type="button"
                id="btn-remove-coupon"
                className="btn btn-outline btn-sm"
                onClick={() => {
                  triggerHaptic('tap');
                  setAppliedDiscount(0);
                  setAppliedCouponCode('');
                  setCouponInput('');
                  showToast('Coupon removed.', 'info');
                }}
                style={{ fontWeight: 900, color: 'var(--danger)', borderColor: 'var(--danger)', flexShrink: 0 }}
              >
                Remove
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={handleApplyCoupon}
                style={{ fontWeight: 900, flexShrink: 0 }}
              >
                Apply
              </button>
            )}
          </div>
        )}

        <div
          style={{
            background: '#f8fafc',
            borderRadius: '14px',
            padding: '0.85rem',
            marginBottom: '0.85rem',
            border: '1px solid var(--border)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '4px',
            }}
          >
            <label
              htmlFor="checkout-address"
              style={{
                fontSize: '0.74rem',
                fontWeight: 900,
                color: '#475569',
                margin: 0,
              }}
            >
              DELIVERY ADDRESS
            </label>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              id="btn-checkout-gps"
              disabled={isFetchingGps}
              onClick={onFetchGps}
              style={{
                color: 'var(--brand-green)',
                borderColor: 'var(--brand-green)',
              }}
            >
              <i
                className={
                  isFetchingGps
                    ? 'fa-solid fa-satellite-dish fa-spin'
                    : hasGpsAttached
                      ? 'fa-solid fa-circle-check'
                      : 'fa-solid fa-location-crosshairs'
                }
              />{' '}
              {isFetchingGps
                ? 'Pinpointing...'
                : hasGpsAttached
                  ? 'GPS Attached'
                  : 'Use Current GPS'}
            </button>
          </div>
          <input
            type="text"
            id="checkout-address"
            className="form-input"
            style={{ padding: '0.6rem', marginBottom: '6px' }}
            placeholder="House/Flat No, Landmark, Road name..."
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
          />
          {hasGpsAttached && (
            <div
              id="checkout-gps-status"
              style={{
                background: '#e8f5e9',
                border: '1px solid #a7f3d0',
                borderRadius: '8px',
                padding: '5px 9px',
                fontSize: '0.72rem',
                color: '#065f46',
                fontWeight: 800,
                marginBottom: '6px',
              }}
            >
              <i className="fa-solid fa-satellite" /> Doorstep GPS Attached
            </div>
          )}
          <label
            htmlFor="checkout-phone"
            style={{
              fontSize: '0.72rem',
              fontWeight: 800,
              color: '#64748b',
              marginBottom: '2px',
              display: 'block',
            }}
          >
            10-DIGIT MOBILE NUMBER
          </label>
          <input
            type="tel"
            id="checkout-phone"
            className="form-input"
            style={{ padding: '0.6rem' }}
            maxLength={10}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>

        {allowScheduledDelivery && (
          <div className="checkout-feature-box" data-testid="checkout-delivery-slot-box">
            <div className="checkout-feature-head">
              <span>🕒 DELIVERY SCHEDULE</span>
              <span className="checkout-feature-sub">Choose express or time slot</span>
            </div>
            <div className="checkout-chip-strip" role="group" aria-label="Delivery schedule">
              {deliverySlots.map((slot) => {
                const active = deliverySlot === slot.id;
                return (
                  <button
                    type="button"
                    key={slot.id}
                    aria-pressed={active}
                    data-testid={`slot-chip-${slot.id}`}
                    className={`checkout-option-chip ${active ? 'active' : ''}`}
                    onClick={() => {
                      triggerHaptic('tap');
                      setDeliverySlot(slot.id);
                    }}
                  >
                    {slot.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {allowRiderTip && (
          <div className="checkout-feature-box" data-testid="checkout-tip-box">
            <div className="checkout-feature-head">
              <span>🛵 TIP YOUR DELIVERY PARTNER</span>
              <span className="checkout-feature-sub">100% goes to rider</span>
            </div>
            <div className="checkout-chip-strip" role="group" aria-label="Rider tip amount">
              {[0, ...activeTipChoices].map((amt) => {
                const active = riderTip === amt;
                return (
                  <button
                    type="button"
                    key={amt}
                    aria-pressed={active}
                    data-testid={`tip-chip-${amt}`}
                    className={`checkout-option-chip ${active ? 'active' : ''}`}
                    onClick={() => {
                      triggerHaptic('tap');
                      setRiderTip(amt);
                    }}
                  >
                    {amt === 0 ? 'No Tip' : `₹${amt}${amt === 20 ? ' ❤️' : ''}`}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ marginBottom: '0.85rem' }}>
          <label
            style={{
              fontSize: '0.74rem',
              fontWeight: 900,
              color: '#475569',
              display: 'block',
              marginBottom: '6px',
            }}
          >
            PAYMENT METHOD
          </label>
          {availablePayModes.length === 0 ? (
            <div className="utr-security-warning" role="alert">
              <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />{' '}
              All payment modes are currently paused by Admin.
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {allowCod && (
                <button
                  type="button"
                  id="pay-card-cod"
                  className="btn btn-outline btn-sm"
                  style={{
                    flex: 1,
                    minWidth: '72px',
                    fontWeight: 900,
                    background:
                      paymentMode === 'COD'
                        ? 'var(--brand-green-light)'
                        : 'transparent',
                    borderColor:
                      paymentMode === 'COD'
                        ? 'var(--brand-green)'
                        : 'var(--border)',
                    color:
                      paymentMode === 'COD' ? 'var(--brand-green)' : '#111',
                  }}
                  onClick={() => {
                    if (paymentMode !== 'COD') triggerHaptic('tap');
                    setPaymentMode('COD');
                  }}
                >
                  💵 COD
                </button>
              )}
              {allowUpi && (
                <button
                  type="button"
                  id="pay-card-upi"
                  className="btn btn-outline btn-sm"
                  style={{
                    flex: 1,
                    minWidth: '72px',
                    fontWeight: 900,
                    background:
                      paymentMode === 'UPI'
                        ? 'var(--brand-green-light)'
                        : 'transparent',
                    borderColor:
                      paymentMode === 'UPI'
                        ? 'var(--brand-green)'
                        : 'var(--border)',
                    color:
                      paymentMode === 'UPI' ? 'var(--brand-green)' : '#111',
                  }}
                  onClick={() => {
                    if (paymentMode !== 'UPI') triggerHaptic('tap');
                    setPaymentMode('UPI');
                  }}
                >
                  📱 UPI
                </button>
              )}
              {allowCardPayment && (
                <button
                  type="button"
                  id="pay-card-card"
                  data-testid="pay-card-btn"
                  className="btn btn-outline btn-sm"
                  style={{
                    flex: 1,
                    minWidth: '72px',
                    fontWeight: 900,
                    background:
                      paymentMode === 'CARD'
                        ? 'var(--brand-green-light)'
                        : 'transparent',
                    borderColor:
                      paymentMode === 'CARD'
                        ? 'var(--brand-green)'
                        : 'var(--border)',
                    color:
                      paymentMode === 'CARD' ? 'var(--brand-green)' : '#111',
                  }}
                  onClick={() => {
                    if (paymentMode !== 'CARD') triggerHaptic('tap');
                    setPaymentMode('CARD');
                  }}
                >
                  💳 Card
                </button>
              )}
              {allowWalletPayment && (
                <button
                  type="button"
                  id="pay-card-wallet"
                  className="btn btn-outline btn-sm"
                  style={{
                    flex: 1,
                    minWidth: '72px',
                    fontWeight: 900,
                    background:
                      paymentMode === 'WALLET'
                        ? 'var(--brand-green-light)'
                        : 'transparent',
                    borderColor:
                      paymentMode === 'WALLET'
                        ? 'var(--brand-green)'
                        : 'var(--border)',
                    color:
                      paymentMode === 'WALLET' ? 'var(--brand-green)' : '#111',
                  }}
                  onClick={() => {
                    if (paymentMode !== 'WALLET') triggerHaptic('tap');
                    setPaymentMode('WALLET');
                  }}
                >
                  👛 Wallet
                </button>
              )}
            </div>
          )}
        </div>

        {allowUpi && paymentMode === 'UPI' && (
          <div
            id="upi-details-container"
            style={{
              background: '#f8fafc',
              border: '1px dashed var(--brand-green)',
              borderRadius: '14px',
              padding: '0.85rem',
              textAlign: 'center',
              marginBottom: '0.85rem',
            }}
          >
            <div style={{ fontSize: '0.78rem', fontWeight: 800 }}>
              Scan QR or Open UPI App Directly
            </div>
            {verifiedUpiString ? (
              <>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(verifiedUpiString)}`}
                  id="upi-qr-image"
                  style={{
                    width: '130px',
                    height: '130px',
                    margin: '6px auto',
                    display: 'block',
                    background: '#fff',
                    padding: '4px',
                    borderRadius: '10px',
                  }}
                  alt="UPI QR"
                />
                <a
                  href={verifiedUpiString}
                  id="upi-open-app-link"
                  className="btn btn-primary btn-sm"
                  style={{ width: '100%', marginBottom: '8px' }}
                >
                  <i className="fa-solid fa-mobile-screen-button" /> Open UPI App
                  (GPay / PhonePe / Paytm)
                </a>
              </>
            ) : (
              <div className="utr-security-warning" role="alert" style={{ margin: '8px 0' }}>
                <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />{' '}
                Merchant UPI verification unavailable for this amount. Use COD or Wallet.
              </div>
            )}
            <input
              type="text"
              inputMode="numeric"
              id="checkout-utr"
              className="form-input"
              placeholder="Enter 12-Digit UPI UTR No."
              maxLength={12}
              value={utr}
              onChange={(e) => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))}
              style={{
                marginBottom: checkoutUtrCheck && !checkoutUtrCheck.valid ? '4px' : '8px',
                fontWeight: 800,
                textAlign: 'center',
              }}
            />
            {checkoutUtrCheck && !checkoutUtrCheck.valid && (
              <div className="utr-security-warning" role="alert" style={{ marginBottom: '8px' }}>
                <i className="fa-solid fa-shield-halved" aria-hidden="true" />{' '}
                {checkoutUtrCheck.reason}
              </div>
            )}
            <div
              style={{
                textAlign: 'left',
                background: '#fff',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '8px',
              }}
            >
              <label
                htmlFor="checkout-upi-screenshot"
                style={{
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  color: '#475569',
                  display: 'block',
                  marginBottom: '4px',
                }}
              >
                📸 Upload Payment Screenshot (Recommended)
              </label>
              <input
                type="file"
                id="checkout-upi-screenshot"
                accept="image/*"
                style={{ fontSize: '0.75rem', width: '100%' }}
                onChange={(e) => void handleScreenshotFile(e.target.files?.[0])}
              />
              {screenshotData && (
                <img
                  id="checkout-ss-preview"
                  src={screenshotData}
                  style={{
                    maxHeight: '90px',
                    marginTop: '6px',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                  alt="Screenshot Preview"
                />
              )}
            </div>
          </div>
        )}

        {allowCardPayment && paymentMode === 'CARD' && (
          <div id="card-details-container" className="card-pay-box" data-testid="card-details-container">
            <div className="card-pay-head">
              <strong>💳 Debit / Credit Card</strong>
              <span className="card-pay-brands">
                {cardCheck?.valid ? cardCheck.brand : 'VISA • RuPay • Mastercard'}
              </span>
            </div>
            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label htmlFor="checkout-card-name">Cardholder Name</label>
              <input
                type="text"
                id="checkout-card-name"
                className="form-input"
                placeholder="Name printed on card"
                value={cardHolderName}
                onChange={(e) => setCardHolderName(e.target.value)}
              />
            </div>
            <div className="form-group" style={{ marginBottom: '8px' }}>
              <label htmlFor="checkout-card-number">Card Number</label>
              <input
                type="text"
                inputMode="numeric"
                id="checkout-card-number"
                className="form-input"
                placeholder="4111 1111 1111 1111"
                maxLength={19}
                value={cardNumber}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, 16);
                  const spaced = digits.replace(/(\d{4})(?=\d)/g, '$1 ');
                  setCardNumber(spaced);
                }}
              />
            </div>
            <div className="card-pay-row">
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor="checkout-card-expiry">Expiry (MM/YY)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  id="checkout-card-expiry"
                  className="form-input"
                  placeholder="12/28"
                  maxLength={5}
                  value={cardExpiry}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setCardExpiry(raw.length > 2 ? `${raw.slice(0, 2)}/${raw.slice(2)}` : raw);
                  }}
                />
              </div>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label htmlFor="checkout-card-cvv">CVV</label>
                <input
                  type="password"
                  inputMode="numeric"
                  id="checkout-card-cvv"
                  className="form-input"
                  placeholder="•••"
                  maxLength={4}
                  value={cardCvv}
                  onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
              </div>
            </div>
            {cardCheck && !cardCheck.valid && (
              <div className="utr-security-warning" role="alert" style={{ marginTop: '8px' }}>
                <i className="fa-solid fa-shield-halved" aria-hidden="true" />{' '}
                {cardCheck.reason}
              </div>
            )}
            <div className="card-pay-note">
              🔒 Encrypted check • We only record the last 4 digits (`••••`), never full PAN or CVV.
            </div>
          </div>
        )}

        {allowWalletPayment && paymentMode === 'WALLET' && (
          <div
            id="wallet-pay-info"
            style={{
              background: '#ecfdf5',
              border: '1px solid var(--brand-green)',
              borderRadius: '12px',
              padding: '0.75rem',
              marginBottom: '0.85rem',
              fontSize: '0.82rem',
              fontWeight: 800,
              color: '#065f46',
            }}
          >
            👛 Wallet Balance Available:{' '}
            <span id="checkout-wallet-bal">₹{walletBalance.toFixed(2)}</span>
          </div>
        )}

        <section
          id="checkout-order-summary"
          className="order-summary-card"
          aria-labelledby="order-summary-heading"
        >
          <div className="order-summary-head">
            <h4 id="order-summary-heading" className="order-summary-title">
              <i className="fa-solid fa-receipt" aria-hidden="true" /> Order Summary
            </h4>
            {summary.storeDiscount + summary.couponDiscount > 0 && (
              <span className="order-summary-savings">
                Saved ₹{(summary.storeDiscount + summary.couponDiscount).toFixed(0)}
              </span>
            )}
          </div>
          <table className="order-summary-table">
            <tbody>
              <tr>
                <th scope="row">Items Subtotal ({totalUnitCount} item{totalUnitCount > 1 ? 's' : ''})</th>
                <td id="checkout-subtotal-amount">₹{summary.subtotal.toFixed(0)}</td>
              </tr>
              <tr>
                <th scope="row">
                  Delivery Charge
                  {summary.deliveryDistanceKm !== null && (
                    <span className="delivery-dist-tag">
                      {' '}({formatDistanceKmLabel(summary.deliveryDistanceKm)})
                    </span>
                  )}
                </th>
                <td id="checkout-delivery-charge">
                  {summary.deliveryCharge === 0 ? (
                    <span className="summary-free-tag">
                      {summary.isPlusFreeDelivery ? 'FREE (Chutki Plus)' : 'FREE'}
                    </span>
                  ) : (
                    `₹${summary.deliveryCharge.toFixed(0)}`
                  )}
                </td>
              </tr>
              <tr id="handling-fee-row">
                <th scope="row">Handling Fee</th>
                <td id="checkout-handling-fee">
                  {summary.handlingFee === 0 ? (
                    <span className="summary-free-tag">FREE</span>
                  ) : (
                    `₹${summary.handlingFee.toFixed(0)}`
                  )}
                </td>
              </tr>
              <tr>
                <th scope="row">Delivery Window</th>
                <td id="checkout-delivery-slot">
                  {deliverySlot === 'EXPRESS_15' ? '⚡ Express 15m' : deliverySlot}
                </td>
              </tr>
              {summary.riderTip > 0 && (
                <tr id="rider-tip-row">
                  <th scope="row">Rider Tip (100% to rider)</th>
                  <td id="checkout-rider-tip">₹{summary.riderTip.toFixed(0)}</td>
                </tr>
              )}
              {summary.storeDiscount > 0 && (
                <tr id="store-discount-row" className="order-summary-discount-row">
                  <th scope="row">Store Offer Discount</th>
                  <td id="checkout-store-discount">
                    -₹{summary.storeDiscount.toFixed(0)}
                  </td>
                </tr>
              )}
              {summary.couponDiscount > 0 && (
                <tr id="coupon-discount-row" className="order-summary-discount-row">
                  <th scope="row">
                    Coupon Discount{appliedCouponCode ? ` (${appliedCouponCode})` : ''}
                  </th>
                  <td id="checkout-discount-amount">
                    -₹{summary.couponDiscount.toFixed(0)}
                  </td>
                </tr>
              )}
              {allowCashback && (summary.cashbackEarned > 0 ? (
                <tr className="order-summary-discount-row">
                  <th scope="row">🪙 {cashbackPercent}% Wallet Cashback</th>
                  <td id="checkout-cashback-amount">
                    +₹{summary.cashbackEarned.toFixed(0)}
                  </td>
                </tr>
              ) : (
                <tr>
                  <th scope="row" style={{ fontSize: '0.72rem', color: '#64748b' }}>
                    🪙 Pay via UPI/Card/Wallet for {cashbackPercent}% cashback
                  </th>
                  <td style={{ fontSize: '0.72rem', color: '#64748b' }}>₹0</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total Payable</th>
                <td id="checkout-total-amount">₹{summary.netPayable.toFixed(0)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <div className="checkout-security-note">
          <i className="fa-solid fa-shield-halved" aria-hidden="true" />
          <span>
            Price-locked &amp; PIN-protected • Never share your Delivery PIN or UPI PIN with anyone.
          </span>
        </div>

        {hasClosedStore && (
          <div className="utr-security-warning" role="alert" style={{ marginBottom: '0.65rem' }}>
            <i className="fa-solid fa-store-slash" aria-hidden="true" /> Some items are from a
            currently closed store. Remove them to place your order.
          </div>
        )}

        {belowMinOrder && (
          <div className="utr-security-warning" role="alert" style={{ marginBottom: '0.65rem' }}>
            <i className="fa-solid fa-circle-info" aria-hidden="true" /> Minimum order amount is ₹
            {minOrderAmount}. Add ₹{(minOrderAmount - summary.subtotal).toFixed(0)} more to
            continue.
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary"
          disabled={
            isPlacingOrder ||
            availablePayModes.length === 0 ||
            hasClosedStore ||
            belowMinOrder ||
            isUpiUtrBlocked
          }
          onClick={() =>
            onPlaceOrder({
              address,
              phone,
              paymentMode,
              utr,
              screenshotData,
              appliedDiscount,
              appliedCouponCode,
              riderTip: effectiveTip,
              deliverySlot: allowScheduledDelivery ? deliverySlot : 'EXPRESS_15',
              cardHolderName,
              cardNumber,
              cardExpiry,
              cardCvv,
            })
          }
          id="btn-place-order"
          style={{ padding: '0.95rem', fontSize: '1rem', fontWeight: 900 }}
        >
          {isPlacingOrder ? (
            <>
              <i className="fa-solid fa-spinner fa-spin" /> Placing Order...
            </>
          ) : hasClosedStore ? (
            'Remove Closed Store Items'
          ) : belowMinOrder ? (
            `Min Order ₹${minOrderAmount} Required`
          ) : deliverySlot === 'EXPRESS_15' ? (
            `Place 15-Min Order • ₹${summary.netPayable.toFixed(0)}`
          ) : (
            `Schedule Order (${deliverySlot}) • ₹${summary.netPayable.toFixed(0)}`
          )}
        </button>
      </div>
    </div>
  );
};

interface WalletDepositModalProps {
  isOpen: boolean;
  adminUpiId: string;
  usedUtrs?: string[];
  minDeposit: number;
  maxDeposit: number;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (amt: number, utr: string, screenshotData: string) => void;
  showToast: (msg: string, type?: 'success' | 'danger' | 'info') => void;
}

export const WalletDepositModal: React.FC<WalletDepositModalProps> = ({
  isOpen,
  adminUpiId,
  usedUtrs,
  minDeposit,
  maxDeposit,
  isSubmitting = false,
  onClose,
  onSubmit,
  showToast,
}) => {
  const [amt, setAmt] = useState(String(minDeposit));
  const [utr, setUtr] = useState('');
  const [screenshotData, setScreenshotData] = useState('');

  useEffect(() => {
    if (isOpen) {
      setAmt(String(minDeposit));
      setUtr('');
      setScreenshotData('');
    }
  }, [isOpen, minDeposit]);

  if (!isOpen) return null;
  const numericAmt = Math.max(1, Number(amt || minDeposit));
  const verifiedWalletUpi = buildVerifiedUpiUri({
    payeeVpa: adminUpiId,
    payeeName: 'ChutkiWallet',
    amount: numericAmt,
    maxAmount: Math.max(maxDeposit, 50000),
  });
  const walletUtrCheck =
    !isSubmitting && utr.trim().length > 0
      ? validateUpiUtr(utr, usedUtrs)
      : null;

  return (
    <div id="wallet-deposit-modal" className="sheet-backdrop" onClick={onClose}>
      <div className="checkout-sheet" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.85rem',
          }}
        >
          <h3 style={{ fontWeight: 900 }}>Add Money to Wallet</h3>
          <button
            type="button"
            aria-label="Close deposit modal"
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer' }}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="form-group">
          <label id="wallet-dep-limit-label" htmlFor="wallet-dep-amt">
            Enter Deposit Amount (Min ₹{minDeposit} - Max ₹{maxDeposit})
          </label>
          <input
            type="number"
            id="wallet-dep-amt"
            className="form-input"
            placeholder="e.g. 200"
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
          />
        </div>
        <div
          style={{
            textAlign: 'center',
            background: '#f8fafc',
            border: '1px dashed var(--brand-green)',
            borderRadius: '14px',
            padding: '0.85rem',
            marginBottom: '0.85rem',
          }}
        >
          {verifiedWalletUpi ? (
            <>
              <img
                id="wallet-dep-qr"
                src={`https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=${encodeURIComponent(verifiedWalletUpi)}`}
                style={{
                  width: '130px',
                  height: '130px',
                  margin: '0 auto 8px',
                  display: 'block',
                }}
                alt="UPI QR"
              />
              <a
                id="wallet-dep-upi-link"
                href={verifiedWalletUpi}
                className="btn btn-primary btn-sm"
                style={{ width: '100%', marginBottom: '8px' }}
              >
                📲 Open UPI App & Pay
              </a>
            </>
          ) : (
            <div className="utr-security-warning" role="alert" style={{ marginBottom: '8px' }}>
              <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />{' '}
              Enter a valid amount within limits to unlock verified merchant UPI payment.
            </div>
          )}
          <input
            type="text"
            inputMode="numeric"
            id="wallet-dep-utr"
            className="form-input"
            placeholder="Enter 12-Digit UTR Number"
            maxLength={12}
            value={utr}
            onChange={(e) => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))}
            style={{
              marginBottom: walletUtrCheck && !walletUtrCheck.valid ? '4px' : '8px',
              textAlign: 'center',
              fontWeight: 800,
            }}
          />
          {walletUtrCheck && !walletUtrCheck.valid && (
            <div className="utr-security-warning" role="alert" style={{ marginBottom: '8px' }}>
              <i className="fa-solid fa-shield-halved" aria-hidden="true" />{' '}
              {walletUtrCheck.reason}
            </div>
          )}
          <input
            type="file"
            id="wallet-dep-ss"
            accept="image/*"
            style={{ fontSize: '0.75rem', width: '100%' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void compressImageToDataUrl(file)
                .then((d) => {
                  setScreenshotData(d);
                  showToast('📸 Deposit screenshot attached!', 'success');
                })
                .catch((err) =>
                  showToast(err instanceof Error ? err.message : 'Invalid image', 'danger')
                );
            }}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={isSubmitting || Boolean(walletUtrCheck && !walletUtrCheck.valid)}
          onClick={() => onSubmit(Number(amt || 0), utr.trim(), screenshotData)}
        >
          {isSubmitting ? 'Submitting...' : 'Submit Deposit Request'}
        </button>
      </div>
    </div>
  );
};

interface WalletWithdrawModalProps {
  isOpen: boolean;
  minWithdraw: number;
  maxWithdraw: number;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (amt: number, upiId: string) => void;
}

export const WalletWithdrawModal: React.FC<WalletWithdrawModalProps> = ({
  isOpen,
  minWithdraw,
  maxWithdraw,
  isSubmitting = false,
  onClose,
  onSubmit,
}) => {
  const [amt, setAmt] = useState('');
  const [upiId, setUpiId] = useState('');

  useEffect(() => {
    if (isOpen) {
      setAmt('');
      setUpiId('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div id="wallet-withdraw-modal" className="sheet-backdrop" onClick={onClose}>
      <div className="checkout-sheet" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.85rem',
          }}
        >
          <h3 style={{ fontWeight: 900 }}>Withdraw Wallet Money</h3>
          <button
            type="button"
            aria-label="Close withdraw modal"
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer' }}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <div className="form-group">
          <label id="wallet-wd-limit-label" htmlFor="wallet-wd-amt">
            Withdraw Amount (Min ₹{minWithdraw} - Max ₹{maxWithdraw})
          </label>
          <input
            type="number"
            id="wallet-wd-amt"
            className="form-input"
            placeholder="e.g. 100"
            value={amt}
            onChange={(e) => setAmt(e.target.value)}
          />
        </div>
        <div className="form-group">
          <label htmlFor="wallet-wd-upi">Your Receiving UPI ID</label>
          <input
            type="text"
            id="wallet-wd-upi"
            className="form-input"
            placeholder="e.g. 9876543210@paytm"
            value={upiId}
            onChange={(e) => setUpiId(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={isSubmitting}
          onClick={() => onSubmit(Number(amt || 0), upiId.trim())}
        >
          {isSubmitting ? 'Submitting...' : 'Submit Withdrawal Request'}
        </button>
      </div>
    </div>
  );
};

interface RatingModalProps {
  mode: 'RIDER' | 'PRODUCTS' | 'STORE' | null;
  group: GroupedOrder | null;
  riderName: string;
  storeName?: string;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmitRiderRating: (group: GroupedOrder, stars: number, comment: string) => void;
  onSubmitStoreRating?: (group: GroupedOrder, stars: number, comment: string) => void;
  onSubmitProductReviews: (
    group: GroupedOrder,
    reviews: Record<string, { rating: number; review: string }>
  ) => void;
}

export const RatingModal: React.FC<RatingModalProps> = ({
  mode,
  group,
  riderName,
  storeName,
  isSubmitting = false,
  onClose,
  onSubmitRiderRating,
  onSubmitStoreRating,
  onSubmitProductReviews,
}) => {
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [prodInputs, setProdInputs] = useState<
    Record<string, { rating: number; review: string }>
  >({});

  useEffect(() => {
    setStars(5);
    setComment('');
    setProdInputs({});
  }, [mode, group?.groupKey]);

  if (!mode || !group) return null;

  return (
    <div id="rating-modal" className="sheet-backdrop" onClick={onClose}>
      <div className="checkout-sheet" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.85rem',
          }}
        >
          <h3 id="rating-modal-title" style={{ fontWeight: 900 }}>
            {mode === 'RIDER'
              ? `Rate Rider: ${riderName}`
              : mode === 'STORE'
                ? `Rate Store: ${storeName || 'Partner Store'}`
                : 'Review Ordered Products'}
          </h3>
          <button
            type="button"
            aria-label="Close rating modal"
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer' }}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div id="rating-modal-body">
          {mode === 'RIDER' || mode === 'STORE' ? (
            <>
              <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                <div
                  id="rider-star-picker"
                  className="star-row"
                  style={{ justifyContent: 'center' }}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <i
                      key={n}
                      className={`fa-solid fa-star ${n <= stars ? 'lit' : ''}`}
                      onClick={() => setStars(n)}
                    />
                  ))}
                </div>
                <small style={{ color: 'var(--text-muted)' }}>
                  {mode === 'STORE'
                    ? 'Tap stars to rate product freshness & packing quality'
                    : 'Tap stars to rate delivery speed & behaviour'}
                </small>
              </div>
              <div className="form-group">
                <label htmlFor="rider-rate-comment">Comment (Optional)</label>
                <textarea
                  id="rider-rate-comment"
                  className="form-input"
                  rows={2}
                  placeholder={
                    mode === 'STORE'
                      ? 'Fresh items and neat packing!'
                      : 'Polite and fast delivery!'
                  }
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={isSubmitting}
                onClick={() =>
                  mode === 'STORE'
                    ? onSubmitStoreRating?.(group, stars, comment)
                    : onSubmitRiderRating(group, stars, comment)
                }
              >
                {isSubmitting
                  ? 'Submitting...'
                  : mode === 'STORE'
                    ? 'Submit Store Rating'
                    : 'Submit Rider Rating'}
              </button>
            </>
          ) : (
            <>
              {group.orders.map((o, oIdx) => {
                const raw = Array.isArray(o.items)
                  ? o.items
                  : Object.values(o.items || {});
                return raw.map((item, iIdx) => {
                  const uidKey = `${oIdx}_${iIdx}`;
                  const cur = prodInputs[uidKey] || { rating: 5, review: '' };
                  return (
                    <div
                      key={uidKey}
                      style={{
                        background: '#f8fafc',
                        border: '1px solid var(--border)',
                        borderRadius: '12px',
                        padding: '0.75rem',
                        marginBottom: '0.75rem',
                      }}
                    >
                      <strong
                        style={{
                          fontSize: '0.86rem',
                          display: 'block',
                          marginBottom: '4px',
                        }}
                      >
                        {item.name}
                      </strong>
                      <select
                        className="form-input"
                        style={{
                          padding: '0.45rem',
                          marginBottom: '6px',
                          fontSize: '0.82rem',
                        }}
                        value={cur.rating}
                        onChange={(e) =>
                          setProdInputs((prev) => ({
                            ...prev,
                            [uidKey]: { ...cur, rating: Number(e.target.value) },
                          }))
                        }
                      >
                        <option value={5}>⭐⭐⭐⭐⭐ 5 - Excellent</option>
                        <option value={4}>⭐⭐⭐⭐ 4 - Good</option>
                        <option value={3}>⭐⭐⭐ 3 - Okay</option>
                        <option value={2}>⭐⭐ 2 - Poor</option>
                        <option value={1}>⭐ 1 - Bad</option>
                      </select>
                      <input
                        type="text"
                        className="form-input"
                        style={{ padding: '0.5rem', fontSize: '0.8rem' }}
                        placeholder="Write a short review..."
                        value={cur.review}
                        onChange={(e) =>
                          setProdInputs((prev) => ({
                            ...prev,
                            [uidKey]: { ...cur, review: e.target.value },
                          }))
                        }
                      />
                    </div>
                  );
                });
              })}
              <button
                type="button"
                className="btn btn-primary"
                disabled={isSubmitting}
                onClick={() => onSubmitProductReviews(group, prodInputs)}
              >
                {isSubmitting ? 'Publishing...' : 'Submit All Reviews'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

interface FeedbackModalProps {
  isOpen: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (subject: string, rating: number, message: string) => void;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({
  isOpen,
  isSubmitting = false,
  onClose,
  onSubmit,
}) => {
  const [subject, setSubject] = useState('');
  const [rating, setRating] = useState(5);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSubject('');
      setRating(5);
      setMessage('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div id="feedback-modal" className="sheet-backdrop" onClick={onClose}>
      <div className="checkout-sheet" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.85rem',
          }}
        >
          <h3 style={{ fontWeight: 900 }}>Helpline & Feedback</h3>
          <button
            type="button"
            aria-label="Close feedback modal"
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer' }}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <form
          id="customer-feedback-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(subject, rating, message);
          }}
        >
          <div className="form-group">
            <label htmlFor="fb-subject">Subject</label>
            <input
              type="text"
              id="fb-subject"
              className="form-input"
              placeholder="Order issue / App suggestion"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="fb-rating">App Experience Rating</label>
            <select
              id="fb-rating"
              className="form-input"
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
            >
              <option value={5}>⭐⭐⭐⭐⭐ Excellent (5)</option>
              <option value={4}>⭐⭐⭐⭐ Good (4)</option>
              <option value={3}>⭐⭐⭐ Average (3)</option>
              <option value={2}>⭐⭐ Poor (2)</option>
              <option value={1}>⭐ Very Bad (1)</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="fb-message">Message</label>
            <textarea
              id="fb-message"
              className="form-input"
              rows={3}
              placeholder="Describe your feedback or issue..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Sending...' : 'Send to Admin Helpline'}
          </button>
        </form>
      </div>
    </div>
  );
};

interface CancelOrderModalProps {
  groupKey: string | null;
  isSubmitting?: boolean;
  onClose: () => void;
  onConfirmCancel: (groupKey: string, reason: string) => void;
}

export const CancelOrderModal: React.FC<CancelOrderModalProps> = ({
  groupKey,
  isSubmitting = false,
  onClose,
  onConfirmCancel,
}) => {
  const [reason, setReason] = useState('Ordered by mistake');

  useEffect(() => {
    setReason('Ordered by mistake');
  }, [groupKey]);

  if (!groupKey) return null;

  return (
    <div id="cancel-order-modal" className="sheet-backdrop" onClick={onClose}>
      <div className="checkout-sheet" onClick={(e) => e.stopPropagation()}>
        <h4
          style={{ fontWeight: 900, color: 'var(--danger)', marginBottom: '0.5rem' }}
        >
          Cancel Order?
        </h4>
        <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '1rem' }}>
          Please select a reason:
        </p>
        <div className="form-group">
          <select
            id="cancel-reason-select"
            className="form-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="Ordered by mistake">Ordered by mistake</option>
            <option value="Want to change items">Want to change items</option>
            <option value="Address entered wrongly">Address entered wrongly</option>
            <option value="Payment problem">Payment problem</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={isSubmitting}>
            Don&apos;t Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={isSubmitting}
            onClick={() => onConfirmCancel(groupKey, reason)}
          >
            {isSubmitting ? 'Cancelling...' : 'Cancel Order'}
          </button>
        </div>
      </div>
    </div>
  );
};

interface TipRiderModalProps {
  group: GroupedOrder | null;
  riderName: string;
  walletBalance: number;
  tipOptions?: number[];
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmitTip: (
    group: GroupedOrder,
    tipAmount: number,
    payVia: 'WALLET' | 'DOORSTEP'
  ) => void;
}

export const TipRiderModal: React.FC<TipRiderModalProps> = ({
  group,
  riderName,
  walletBalance,
  tipOptions,
  isSubmitting = false,
  onClose,
  onSubmitTip,
}) => {
  const choices =
    Array.isArray(tipOptions) && tipOptions.length > 0
      ? tipOptions.filter((n) => Number.isFinite(n) && n > 0)
      : [10, 20, 30, 50];
  const defaultTip = choices[1] ?? choices[0] ?? 20;
  const [amount, setAmount] = useState<number>(defaultTip);
  const [payVia, setPayVia] = useState<'WALLET' | 'DOORSTEP'>('WALLET');

  useEffect(() => {
    setAmount(defaultTip);
    setPayVia(walletBalance >= defaultTip ? 'WALLET' : 'DOORSTEP');
  }, [group?.groupKey, walletBalance, defaultTip]);

  if (!group) return null;

  return (
    <div id="tip-rider-modal" className="sheet-backdrop" onClick={onClose}>
      <div className="checkout-sheet" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.75rem',
          }}
        >
          <h3 style={{ fontWeight: 900 }}>🛵 Tip Delivery Partner</h3>
          <button
            type="button"
            aria-label="Close tip modal"
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer' }}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
        <p style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '0.85rem' }}>
          Say thank you to <strong>{riderName}</strong> for order{' '}
          <strong>#{group.groupKey.slice(-6)}</strong>. 100% of your tip goes directly to the rider.
        </p>

        <div className="checkout-chip-strip" style={{ marginBottom: '0.9rem' }}>
          {choices.map((amt) => (
            <button
              type="button"
              key={amt}
              data-testid={`modal-tip-amt-${amt}`}
              className={`checkout-option-chip ${amount === amt ? 'active' : ''}`}
              onClick={() => {
                triggerHaptic('tap');
                setAmount(amt);
              }}
            >
              ₹{amt}
            </button>
          ))}
        </div>

        <div className="form-group">
          <label htmlFor="custom-tip-input">Or Custom Amount (₹)</label>
          <input
            id="custom-tip-input"
            type="number"
            min={5}
            max={500}
            className="form-input"
            value={amount}
            onChange={(e) => setAmount(Math.max(0, Number(e.target.value || 0)))}
          />
        </div>

        <div className="form-group">
          <label>Pay Tip Using</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className={`btn btn-outline btn-sm ${payVia === 'WALLET' ? 'active-chip-btn' : ''}`}
              style={{
                flex: 1,
                borderColor: payVia === 'WALLET' ? 'var(--brand-green)' : 'var(--border)',
                background: payVia === 'WALLET' ? 'var(--brand-green-light)' : 'transparent',
                color: payVia === 'WALLET' ? 'var(--brand-green)' : '#111',
                fontWeight: 800,
              }}
              onClick={() => setPayVia('WALLET')}
            >
              👛 Wallet (₹{walletBalance.toFixed(0)})
            </button>
            <button
              type="button"
              className={`btn btn-outline btn-sm ${payVia === 'DOORSTEP' ? 'active-chip-btn' : ''}`}
              style={{
                flex: 1,
                borderColor: payVia === 'DOORSTEP' ? 'var(--brand-green)' : 'var(--border)',
                background: payVia === 'DOORSTEP' ? 'var(--brand-green-light)' : 'transparent',
                color: payVia === 'DOORSTEP' ? 'var(--brand-green)' : '#111',
                fontWeight: 800,
              }}
              onClick={() => setPayVia('DOORSTEP')}
            >
              💵 Cash / Doorstep
            </button>
          </div>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          data-testid="confirm-tip-rider-btn"
          disabled={isSubmitting}
          onClick={() => onSubmitTip(group, amount, payVia)}
        >
          {isSubmitting ? 'Sending Tip...' : `Send ₹${amount} Tip to ${riderName}`}
        </button>
      </div>
    </div>
  );
};

interface RefundRequestModalProps {
  order: OrderRecord | null;
  storeName: string;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmitRefund: (
    order: OrderRecord,
    reason: string,
    method: 'WALLET' | 'ORIGINAL',
    note: string
  ) => void;
}

export const RefundRequestModal: React.FC<RefundRequestModalProps> = ({
  order,
  storeName,
  isSubmitting = false,
  onClose,
  onSubmitRefund,
}) => {
  const [reason, setReason] = useState('Damaged or spoiled item');
  const [method, setMethod] = useState<'WALLET' | 'ORIGINAL'>('WALLET');
  const [note, setNote] = useState('');

  useEffect(() => {
    setReason('Damaged or spoiled item');
    setMethod('WALLET');
    setNote('');
  }, [order?.orderId]);

  if (!order) return null;

  return (
    <div id="refund-request-modal" className="sheet-backdrop" onClick={onClose}>
      <div className="checkout-sheet" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.75rem',
          }}
        >
          <h3 style={{ fontWeight: 900 }}>💸 Request Order Refund</h3>
          <button
            type="button"
            aria-label="Close refund modal"
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer' }}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <p style={{ fontSize: '0.78rem', color: '#475569', marginBottom: '0.85rem' }}>
          Order <strong>#{order.orderId.slice(-6)}</strong> • {storeName} •{' '}
          <strong>₹{Number(order.totalAmount || 0).toFixed(0)}</strong>
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmitRefund(order, reason, method, note);
          }}
        >
          <div className="form-group">
            <label htmlFor="refund-reason-select">Select Issue</label>
            <select
              id="refund-reason-select"
              className="form-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              <option value="Damaged or spoiled item">Damaged or spoiled item</option>
              <option value="Missing item in order">Missing item in order</option>
              <option value="Wrong item delivered">Wrong item delivered</option>
              <option value="Order cancelled after prepayment">Order cancelled after prepayment</option>
              <option value="Quality issue">Quality not fresh</option>
            </select>
          </div>

          <div className="form-group">
            <label>Preferred Refund Method</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{
                  flex: 1,
                  borderColor: method === 'WALLET' ? 'var(--brand-green)' : 'var(--border)',
                  background: method === 'WALLET' ? 'var(--brand-green-light)' : 'transparent',
                  color: method === 'WALLET' ? 'var(--brand-green)' : '#111',
                  fontWeight: 800,
                }}
                onClick={() => setMethod('WALLET')}
              >
                ⚡ Bazar Wallet (Instant)
              </button>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{
                  flex: 1,
                  borderColor: method === 'ORIGINAL' ? 'var(--brand-green)' : 'var(--border)',
                  background: method === 'ORIGINAL' ? 'var(--brand-green-light)' : 'transparent',
                  color: method === 'ORIGINAL' ? 'var(--brand-green)' : '#111',
                  fontWeight: 800,
                }}
                onClick={() => setMethod('ORIGINAL')}
              >
                🏦 Original Mode
              </button>
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="refund-note-input">Additional Details (Optional)</label>
            <textarea
              id="refund-note-input"
              className="form-input"
              rows={2}
              placeholder="Briefly explain which item had an issue..."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            data-testid="submit-refund-request-btn"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Submitting...' : 'Submit Refund Request'}
          </button>
        </form>
      </div>
    </div>
  );
};
