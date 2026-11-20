import React, { useEffect, useState } from 'react';
import type { DeliveryPartner, GroupedOrder, OrderRecord, Store } from '../types/bazar';
import {
  buildOrderStatusTimeline,
  calculateDistanceKm,
  computeDeliveryCountdown,
  deriveGroupOrderStatus,
  filterPastOrdersByQuery,
  getActiveOrderGroups,
  getPastOrdersFromCache,
  normalizeOrderStatus,
  type OrderFilterSegment,
} from '../utils/bazarLogic';
import {
  buildOrderReceiptFromGroup,
  buildOrderReceiptFromOrder,
} from '../utils/orderReceipt';
import { OrderReceiptCard } from './OrderReceiptCard';
import { DeliveryQrCard } from './DeliveryQrCard';
import { RiderMiniMap, type StoreMarkerInfo } from './RiderMiniMap';
import { triggerHaptic } from '../utils/haptics';
import {
  getCanonicalOrderIdForGroup,
  isRiderCommunicationEligible,
} from '../utils/riderComm';
import { sanitizeSafeUrl } from '../utils/security';

interface OrdersTabProps {
  groupedOrders: GroupedOrder[];
  cachedOrders: Record<string, Omit<OrderRecord, 'orderId'>>;
  stores: Record<string, Store>;
  deliveryPartners: Record<string, DeliveryPartner>;
  timelineTimestamps?: Record<string, Record<string, number>>;
  gmpQuotaExceeded: boolean;
  brandName?: string;
  allowRiderTip?: boolean;
  allowStoreRatings?: boolean;
  allowRefundRequests?: boolean;
  allowDeliveryQr?: boolean;
  allowRiderVoiceCall?: boolean;
  allowRiderChat?: boolean;
  unreadChatCounts?: Record<string, number>;
  onOpenRateRider: (groupKey: string) => void;
  onOpenRateStore: (groupKey: string) => void;
  onOpenRateProducts: (groupKey: string) => void;
  onOpenTipRider: (groupKey: string) => void;
  onOpenRefundOrder: (order: OrderRecord) => void;
  onOpenCancelOrder: (groupKey: string) => void;
  onReorderOrder: (order: OrderRecord) => void;
  onCallRider?: (group: GroupedOrder) => void;
  onMessageRider?: (group: GroupedOrder) => void;
}

export const OrdersTab: React.FC<OrdersTabProps> = ({
  groupedOrders,
  cachedOrders,
  stores,
  deliveryPartners,
  timelineTimestamps,
  gmpQuotaExceeded,
  brandName,
  allowRiderTip = true,
  allowStoreRatings = true,
  allowRefundRequests = true,
  allowDeliveryQr = true,
  allowRiderChat = true,
  unreadChatCounts = {},
  onOpenRateRider,
  onOpenRateStore,
  onOpenRateProducts,
  onOpenTipRider,
  onOpenRefundOrder,
  onOpenCancelOrder,
  onReorderOrder,
  onCallRider,
  onMessageRider,
}) => {
  const [orderFilter, setOrderFilter] = useState<OrderFilterSegment>('ACTIVE');
  const [pastSearchQuery, setPastSearchQuery] = useState<string>('');
  const [openReceiptId, setOpenReceiptId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const activeGroups = getActiveOrderGroups(groupedOrders);
  const deliveredOrders = getPastOrdersFromCache(cachedOrders, 'DELIVERED');
  const cancelledOrders = getPastOrdersFromCache(cachedOrders, 'CANCELLED');
  const basePastOrders =
    orderFilter === 'DELIVERED' ? deliveredOrders : cancelledOrders;
  const filteredPastOrders = filterPastOrdersByQuery(
    basePastOrders,
    pastSearchQuery,
    stores
  );
  const totalPastCount = deliveredOrders.length + cancelledOrders.length;

  const hasLiveTimerGroups = activeGroups.some((g) => {
    const d = deriveGroupOrderStatus(g);
    return !d.isAllDelivered && !d.isAllCancelled;
  });

  useEffect(() => {
    if (!hasLiveTimerGroups) return undefined;
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [hasLiveTimerGroups]);

  return (
    <div id="tab-orders" className="tab-content active">
      <div className="orders-header-row">
        <h2 className="orders-main-title">
          {orderFilter === 'ACTIVE'
            ? 'Live Orders & Delivery PIN'
            : orderFilter === 'DELIVERED'
              ? 'Delivered Past Orders'
              : 'Cancelled Past Orders'}
        </h2>
      </div>

      <div
        className="orders-filter-bar"
        role="tablist"
        aria-label="Filter orders by status"
        data-testid="orders-filter-bar"
      >
        <button
          type="button"
          role="tab"
          aria-selected={orderFilter === 'ACTIVE'}
          className={`orders-filter-tab ${orderFilter === 'ACTIVE' ? 'active' : ''}`}
          onClick={() => {
            if (orderFilter !== 'ACTIVE') triggerHaptic('tap');
            setOrderFilter('ACTIVE');
          }}
        >
          Active <span className="orders-filter-count">({activeGroups.length})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={orderFilter === 'DELIVERED'}
          className={`orders-filter-tab ${orderFilter === 'DELIVERED' ? 'active' : ''}`}
          onClick={() => {
            if (orderFilter !== 'DELIVERED') triggerHaptic('tap');
            setOrderFilter('DELIVERED');
          }}
        >
          Delivered <span className="orders-filter-count">({deliveredOrders.length})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={orderFilter === 'CANCELLED'}
          className={`orders-filter-tab ${orderFilter === 'CANCELLED' ? 'active' : ''}`}
          onClick={() => {
            if (orderFilter !== 'CANCELLED') triggerHaptic('tap');
            setOrderFilter('CANCELLED');
          }}
        >
          Cancelled <span className="orders-filter-count">({cancelledOrders.length})</span>
        </button>
      </div>

      {orderFilter === 'ACTIVE' ? (
        <div id="orders-container">
          {activeGroups.length === 0 ? (
            <div className="orders-empty-card" data-testid="orders-empty-active">
              <p className="orders-empty-text">
                {totalPastCount === 0
                  ? 'No orders placed yet.'
                  : 'No active orders right now.'}
              </p>
              {totalPastCount > 0 && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{
                    borderColor: 'var(--brand-green)',
                    color: 'var(--brand-green)',
                    marginTop: '0.6rem',
                  }}
                  onClick={() => {
                    triggerHaptic('tap');
                    setOrderFilter(
                      deliveredOrders.length > 0 ? 'DELIVERED' : 'CANCELLED'
                    );
                  }}
                >
                  View Past Orders ({totalPastCount})
                </button>
              )}
            </div>
          ) : (
            activeGroups.map((group) => {
              const isMultiStore = group.orders.length > 1;
              const rider = group.deliveryUid
                ? deliveryPartners[group.deliveryUid]
                : null;
              const derived = deriveGroupOrderStatus(group);
              const liveRiderLat = group.riderLat || rider?.lat || null;
              const liveRiderLng = group.riderLng || rider?.lng || null;
              const riderDist =
                liveRiderLat && liveRiderLng && group.customerLat
                  ? calculateDistanceKm(
                      liveRiderLat,
                      liveRiderLng,
                      group.customerLat,
                      group.customerLng
                    )
                  : null;
              const alreadyRatedRider = group.orders.some((o) => o.riderRating);
              const alreadyRatedStore = group.orders.some((o) => o.storeRating);
              const alreadyReviewedProds = group.orders.some(
                (o) => o.productsReviewed
              );
              const seenStores: Record<string, boolean> = {};
              const storeMarkers: StoreMarkerInfo[] = [];
              group.orders.forEach((o, idx) => {
                if (!o.restaurantId || seenStores[o.restaurantId]) return;
                seenStores[o.restaurantId] = true;
                const st = stores[o.restaurantId];
                if (
                  st &&
                  typeof st.lat === 'number' &&
                  typeof st.lng === 'number'
                ) {
                  storeMarkers.push({
                    storeId: o.restaurantId,
                    name: st.name || `Store ${idx + 1}`,
                    lat: st.lat,
                    lng: st.lng,
                  });
                }
              });

              return (
                <div key={group.groupKey} className="order-card">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      borderBottom: '1px dashed var(--border)',
                      paddingBottom: '0.5rem',
                      marginBottom: '0.5rem',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <strong style={{ fontSize: '0.95rem' }}>
                          #{group.groupKey.slice(-6)}
                        </strong>
                        {isMultiStore && (
                          <span
                            style={{
                              background: 'rgba(168,85,247,0.15)',
                              color: '#9333ea',
                              fontSize: '0.65rem',
                              fontWeight: 900,
                              padding: '2px 7px',
                              borderRadius: '6px',
                            }}
                          >
                            {group.orders.length} STORES
                          </span>
                        )}
                        {group.deliverySlot && group.deliverySlot !== 'EXPRESS_15' && (
                          <span className="order-slot-pill" data-testid="order-slot-pill">
                            📅 {group.deliverySlot}
                          </span>
                        )}
                        {Number(group.riderTip || 0) > 0 && (
                          <span className="order-tip-pill" data-testid="order-tip-pill">
                            ❤️ Tip ₹{Number(group.riderTip || 0).toFixed(0)}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                        {new Date(group.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 900,
                        background: 'var(--brand-green-light)',
                        color: 'var(--brand-green)',
                        padding: '3px 8px',
                        borderRadius: '10px',
                      }}
                    >
                      {derived.status}
                    </span>
                  </div>

                  {!derived.isAllDelivered && !derived.isAllCancelled && (() => {
                    const countdown = computeDeliveryCountdown(
                      group.placedAt || group.createdAt,
                      nowMs
                    );
                    return (
                      <div
                        className={`order-countdown-card ${
                          countdown.isOverdue || countdown.isFinalStretch ? 'urgent' : ''
                        }`}
                        data-testid="order-countdown-timer"
                      >
                        <div className="order-countdown-row">
                          <div className="order-countdown-info">
                            <div className="order-countdown-icon" aria-hidden="true">
                              <i className="fa-solid fa-stopwatch" />
                            </div>
                            <div>
                              <div className="order-countdown-title">
                                {countdown.isOverdue
                                  ? 'Delivery ETA Reached'
                                  : 'Est. Delivery Time'}
                              </div>
                              <div className="order-countdown-sub">
                                {countdown.label}
                              </div>
                            </div>
                          </div>
                          <div
                            className="order-countdown-clock"
                            aria-label={`Estimated delivery time remaining ${countdown.formattedRemaining}`}
                          >
                            {countdown.formattedRemaining}
                          </div>
                        </div>
                        <div
                          className="order-countdown-track"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={countdown.progressPercent}
                          aria-label="15-minute delivery progress"
                        >
                          <div
                            className="order-countdown-fill"
                            style={{ width: `${countdown.progressPercent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}

                  {!derived.isAllCancelled ? (
                    <>
                      <div className="order-stepper">
                        <div
                          className="stepper-progress-fill"
                          style={{ width: derived.stepProgressWidth }}
                        />
                        <div className="step-node active">
                          <div className="step-circle">
                            <i className="fa-solid fa-receipt" />
                          </div>
                          <span>Placed</span>
                        </div>
                        <div className={`step-node ${derived.s2 ? 'active' : ''}`}>
                          <div className="step-circle">
                            <i className="fa-solid fa-box-open" />
                          </div>
                          <span>Packing</span>
                        </div>
                        <div className={`step-node ${derived.s3 ? 'active' : ''}`}>
                          <div className="step-circle">
                            <i className="fa-solid fa-motorcycle" />
                          </div>
                          <span>On the way</span>
                        </div>
                        <div className={`step-node ${derived.s4 ? 'active' : ''}`}>
                          <div className="step-circle">
                            <i className="fa-solid fa-house-chimney" />
                          </div>
                          <span>Delivered</span>
                        </div>
                      </div>

                      {(() => {
                        const steps = buildOrderStatusTimeline(
                          group,
                          timelineTimestamps?.[group.groupKey]
                        );
                        return (
                          <div
                            className="order-timeline-card"
                            data-testid="order-timeline"
                          >
                            <div className="order-timeline-header">
                              <span>Live Status Timeline</span>
                              <span className="order-timeline-stage-tag">
                                {steps.filter((s) => s.state !== 'pending').length} of {steps.length} milestones
                              </span>
                            </div>
                            <ol className="order-timeline-list">
                              {steps.map((step, idx) => (
                                <li
                                  key={step.key}
                                  className={`order-timeline-step ${step.state}`}
                                  data-testid={`timeline-step-${step.key}`}
                                >
                                  <div className="order-timeline-rail">
                                    <span className="order-timeline-dot" aria-hidden="true">
                                      <i
                                        className={`fa-solid ${
                                          step.state === 'completed' ? 'fa-check' : step.icon
                                        }`}
                                      />
                                    </span>
                                    {idx < steps.length - 1 && (
                                      <span className="order-timeline-line" aria-hidden="true" />
                                    )}
                                  </div>
                                  <div className="order-timeline-body">
                                    <div className="order-timeline-row">
                                      <strong className="order-timeline-label">
                                        {step.label}
                                      </strong>
                                      <span className="order-timeline-time">
                                        {step.formattedTime}
                                      </span>
                                    </div>
                                    <div className="order-timeline-detail">
                                      {step.detail}
                                    </div>
                                  </div>
                                </li>
                              ))}
                            </ol>
                          </div>
                        );
                      })()}
                    </>
                  ) : (
                    <div
                      style={{
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        borderRadius: '12px',
                        padding: '0.7rem',
                        margin: '0.75rem 0',
                        color: 'var(--danger)',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                      }}
                    >
                      <i className="fa-solid fa-ban" /> Order Cancelled
                    </div>
                  )}

                  {group.emergencyAlert && (
                    <div
                      style={{
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        borderRadius: '10px',
                        padding: '0.65rem',
                        marginBottom: '0.5rem',
                        fontSize: '0.75rem',
                        color: '#92400e',
                        fontWeight: 700,
                      }}
                    >
                      ⚠️ {group.emergencyDetails || 'Temporary road delay'}
                    </div>
                  )}

                  {!derived.isAllDelivered &&
                    !derived.isAllCancelled &&
                    group.deliveryOtp && (
                      <DeliveryQrCard
                        group={group}
                        allowDeliveryQr={allowDeliveryQr}
                      />
                    )}

                  <div style={{ margin: '0.65rem 0' }}>
                    {group.orders.map((o, idx) => {
                      const storeName =
                        stores[o.restaurantId]?.name || `Store ${idx + 1}`;
                      const raw = Array.isArray(o.items)
                        ? o.items
                        : Object.values(o.items || {});
                      return (
                        <div
                          key={o.orderId}
                          style={{
                            background: '#f8fafc',
                            border: '1px solid var(--border)',
                            borderRadius: '10px',
                            padding: '0.55rem 0.75rem',
                            marginBottom: '6px',
                          }}
                        >
                          <div
                            style={{
                              fontSize: '0.74rem',
                              fontWeight: 800,
                              color: 'var(--brand-green)',
                            }}
                          >
                            <i className="fa-solid fa-store" /> {storeName}
                          </div>
                          <div style={{ fontSize: '0.78rem', color: '#475569' }}>
                            {raw.map((i) => `${i.name} × ${i.qty}`).join(', ')}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontWeight: 900,
                      fontSize: '0.95rem',
                      margin: '6px 0',
                      borderTop: '1px dashed var(--border)',
                      paddingTop: '6px',
                    }}
                  >
                    <span>Total ({group.paymentMode}):</span>
                    <span style={{ color: 'var(--brand-green)' }}>
                      ₹{group.totalAmount.toFixed(0)}
                    </span>
                  </div>

                  <div className="order-receipt-toggle-row">
                    <button
                      type="button"
                      className={`btn btn-outline btn-sm order-receipt-toggle-btn ${
                        openReceiptId === group.groupKey ? 'active' : ''
                      }`}
                      aria-expanded={openReceiptId === group.groupKey}
                      data-testid="toggle-order-receipt-btn"
                      onClick={() => {
                        triggerHaptic('tap');
                        setOpenReceiptId((prev) =>
                          prev === group.groupKey ? null : group.groupKey
                        );
                      }}
                    >
                      <i className="fa-solid fa-file-invoice" aria-hidden="true" />{' '}
                      {openReceiptId === group.groupKey
                        ? 'Hide Order Receipt'
                        : 'Order Receipt & PDF'}
                    </button>
                  </div>

                  {openReceiptId === group.groupKey && (
                    <OrderReceiptCard
                      receipt={buildOrderReceiptFromGroup(group, stores, derived.status)}
                      brandName={brandName}
                      onClose={() => setOpenReceiptId(null)}
                    />
                  )}

                  {!derived.isAllCancelled && !derived.isAllDelivered && (
                    <>
                      <RiderMiniMap
                        groupKey={group.groupKey}
                        orderStatus={derived.status}
                        rider={rider}
                        riderLat={liveRiderLat}
                        riderLng={liveRiderLng}
                        customerLat={group.customerLat}
                        customerLng={group.customerLng}
                        storeMarkers={storeMarkers}
                        quotaExceeded={gmpQuotaExceeded}
                      />
                      {rider ? (
                        (() => {
                          const canComm = isRiderCommunicationEligible(group);
                          const canonicalOrderId = getCanonicalOrderIdForGroup(group);
                          const unreadCount =
                            Number(unreadChatCounts[canonicalOrderId] || 0) ||
                            Number(unreadChatCounts[group.groupKey] || 0);
                          const safeRiderPhoto = sanitizeSafeUrl(
                            rider.photoUrl || rider.imageUrl || '',
                            true
                          );
                          const riderInitial =
                            (rider.name || 'Rider').trim().charAt(0).toUpperCase() || 'R';
                          const riderPhone = rider.phone || '';

                          return (
                            <div className="delivery-boy-box">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                {safeRiderPhoto ? (
                                  <img
                                    src={safeRiderPhoto}
                                    alt={rider.name || 'Rider'}
                                    style={{
                                      width: '38px',
                                      height: '38px',
                                      borderRadius: '999px',
                                      objectFit: 'cover',
                                      border: '2px solid var(--brand-green)',
                                      flexShrink: 0,
                                    }}
                                  />
                                ) : (
                                  <div
                                    aria-hidden="true"
                                    style={{
                                      width: '38px',
                                      height: '38px',
                                      borderRadius: '999px',
                                      background: 'var(--brand-green)',
                                      color: '#fff',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontWeight: 900,
                                      fontSize: '0.92rem',
                                      flexShrink: 0,
                                    }}
                                  >
                                    {riderInitial}
                                  </div>
                                )}
                                <div>
                                  <strong style={{ fontSize: '0.85rem' }}>
                                    <i
                                      className="fa-solid fa-motorcycle"
                                      style={{ color: 'var(--brand-green)' }}
                                    />{' '}
                                    {rider.name || 'Rider'}{' '}
                                    {rider.ratingCount
                                      ? `⭐ ${Number(rider.ratingAvg || 5).toFixed(1)}`
                                      : ''}
                                  </strong>
                                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                    {rider.vehicle || 'Bike'}{' '}
                                    {riderDist !== null
                                      ? `• ~${riderDist.toFixed(1)} km away`
                                      : ''}{' '}
                                    {rider.lastLocationUpdate
                                      ? `• Live ${new Date(rider.lastLocationUpdate).toLocaleTimeString()}`
                                      : ''}
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {/* NORMAL PHONE CALL BUTTON - DIRECT CELLULAR DIALER */}
                                {canComm && (
                                  riderPhone ? (
                                    <a
                                      href={`tel:${riderPhone}`}
                                      className="btn btn-primary btn-sm"
                                      data-testid="call-rider-btn"
                                      aria-label={`Call Rider ${rider.name || 'Rider'}`}
                                      onClick={() => triggerHaptic('tap')}
                                    >
                                      <i className="fa-solid fa-phone" aria-hidden="true" /> Call Rider
                                    </a>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn btn-primary btn-sm"
                                      data-testid="call-rider-btn"
                                      onClick={() => onCallRider?.(group)}
                                    >
                                      <i className="fa-solid fa-phone" aria-hidden="true" /> Call Rider
                                    </button>
                                  )
                                )}

                                {canComm && allowRiderChat && onMessageRider && (
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    data-testid="message-rider-inapp-btn"
                                    aria-label={`Message Rider ${rider.name || 'Rider'}`}
                                    style={{
                                      borderColor: 'var(--brand-green)',
                                      color: 'var(--brand-green)',
                                      fontWeight: 800,
                                      position: 'relative',
                                    }}
                                    onClick={() => {
                                      triggerHaptic('tap');
                                      onMessageRider(group);
                                    }}
                                  >
                                    <i className="fa-solid fa-comment-dots" aria-hidden="true" />{' '}
                                    Message Rider
                                    {unreadCount > 0 && (
                                      <span
                                        data-testid="rider-chat-unread-badge"
                                        style={{
                                          marginLeft: '5px',
                                          background: '#dc2626',
                                          color: '#fff',
                                          borderRadius: '999px',
                                          padding: '1px 6px',
                                          fontSize: '0.66rem',
                                          fontWeight: 900,
                                        }}
                                      >
                                        {unreadCount}
                                      </span>
                                    )}
                                  </button>
                                )}
                                {allowRiderTip && (
                                  <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    data-testid="active-tip-rider-btn"
                                    style={{ borderColor: '#f59e0b', color: '#b45309', fontWeight: 800 }}
                                    onClick={() => onOpenTipRider(group.groupKey)}
                                  >
                                    ❤️ Tip Rider
                                  </button>
                                )}
                                {liveRiderLat && liveRiderLng && (
                                  <a
                                    href={`https://www.google.com/maps?q=${liveRiderLat},${liveRiderLng}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-outline btn-sm"
                                    style={{ color: 'var(--brand-green)' }}
                                  >
                                    <i className="fa-solid fa-location-arrow" /> Live Map
                                  </a>
                                )}
                              </div>
                            </div>
                          );
                        })()
                      ) : (
                        <div
                          style={{
                            background: '#f0fdf4',
                            border: '1.5px dashed var(--brand-green)',
                            borderRadius: '12px',
                            padding: '0.75rem',
                            margin: '0.65rem 0',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                          }}
                        >
                          <i
                            className="fa-solid fa-satellite-dish fa-spin"
                            style={{ color: 'var(--brand-green)', fontSize: '1.2rem' }}
                          />
                          <div
                            style={{
                              fontSize: '0.76rem',
                              color: '#166534',
                              fontWeight: 800,
                            }}
                          >
                            Connecting to nearest delivery rider...
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {derived.isAllDelivered && (
                    <div
                      style={{
                        display: 'flex',
                        gap: '8px',
                        marginTop: '8px',
                        flexWrap: 'wrap',
                      }}
                    >
                      {group.deliveryUid && !alreadyRatedRider ? (
                        <button
                          type="button"
                          className="btn btn-warning btn-sm"
                          style={{ flex: 1 }}
                          onClick={() => onOpenRateRider(group.groupKey)}
                        >
                          <i className="fa-solid fa-star" /> Rate Rider
                        </button>
                      ) : alreadyRatedRider ? (
                        <span className="qc-rating-pill">✅ Rider Rated</span>
                      ) : null}

                      {allowStoreRatings && (!alreadyRatedStore ? (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          data-testid="active-rate-store-btn"
                          style={{
                            flex: 1,
                            borderColor: '#f59e0b',
                            color: '#b45309',
                          }}
                          onClick={() => onOpenRateStore(group.groupKey)}
                        >
                          <i className="fa-solid fa-store" /> Rate Store
                        </button>
                      ) : (
                        <span className="qc-rating-pill">✅ Store Rated</span>
                      ))}

                      {allowRiderTip && group.deliveryUid && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          data-testid="delivered-tip-rider-btn"
                          style={{
                            borderColor: '#0c831f',
                            color: '#0c831f',
                          }}
                          onClick={() => onOpenTipRider(group.groupKey)}
                        >
                          ❤️ Tip Rider
                        </button>
                      )}

                      {!alreadyReviewedProds ? (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{
                            flex: 1,
                            borderColor: 'var(--brand-green)',
                            color: 'var(--brand-green)',
                          }}
                          onClick={() => onOpenRateProducts(group.groupKey)}
                        >
                          <i className="fa-solid fa-comment-medical" /> Review Products
                        </button>
                      ) : (
                        <span className="qc-rating-pill">✅ Products Reviewed</span>
                      )}
                    </div>
                  )}

                  {(derived.status === 'PLACED' || derived.status === 'ACCEPTED') && (
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      style={{
                        color: 'var(--danger)',
                        borderColor: '#fecaca',
                        marginTop: '6px',
                      }}
                      onClick={() => onOpenCancelOrder(group.groupKey)}
                    >
                      Cancel Order
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      ) : (
        <section
          className="past-orders-section past-orders-filtered"
          aria-label={orderFilter === 'DELIVERED' ? 'Delivered Past Orders' : 'Cancelled Past Orders'}
          data-testid="past-orders-section"
        >
          <div className="past-orders-header">
            <h3 className="past-orders-heading">
              {orderFilter === 'DELIVERED' ? 'Delivered Orders' : 'Cancelled Orders'}
            </h3>
            {basePastOrders.length > 0 && (
              <span className="past-orders-count" data-testid="past-orders-count">
                {pastSearchQuery.trim()
                  ? `${filteredPastOrders.length} of ${basePastOrders.length}`
                  : filteredPastOrders.length}
              </span>
            )}
          </div>

          <div className="past-orders-search-wrap">
            <i
              className="fa-solid fa-magnifying-glass past-orders-search-icon"
              aria-hidden="true"
            />
            <input
              id="past-orders-search"
              type="text"
              className="past-orders-search-input"
              placeholder="Search past orders by store or item..."
              aria-label="Search past orders by store name or items ordered"
              data-testid="past-orders-search-input"
              value={pastSearchQuery}
              onChange={(e) => setPastSearchQuery(e.target.value)}
            />
            {pastSearchQuery && (
              <button
                type="button"
                className="past-orders-search-clear"
                aria-label="Clear past orders search"
                data-testid="past-orders-search-clear"
                onClick={() => setPastSearchQuery('')}
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            )}
          </div>

          {filteredPastOrders.length === 0 ? (
            <div className="orders-empty-card" data-testid="orders-empty-past">
              <p className="orders-empty-text">
                {pastSearchQuery.trim() && basePastOrders.length > 0
                  ? `No ${orderFilter.toLowerCase()} orders matching "${pastSearchQuery.trim()}".`
                  : orderFilter === 'DELIVERED'
                    ? 'No delivered orders yet.'
                    : 'No cancelled orders yet.'}
              </p>
              {pastSearchQuery.trim() && basePastOrders.length > 0 && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{
                    borderColor: 'var(--brand-green)',
                    color: 'var(--brand-green)',
                    marginTop: '0.6rem',
                  }}
                  onClick={() => setPastSearchQuery('')}
                >
                  Clear Search
                </button>
              )}
            </div>
          ) : (
            <ul className="past-orders-list">
              {filteredPastOrders.map((order) => {
                const rawItems = Array.isArray(order.items)
                  ? order.items
                  : Object.values(order.items || {});
                const firstItemStoreName = rawItems[0]?.storeName;
                const storeName =
                  stores[order.restaurantId]?.name ||
                  firstItemStoreName ||
                  'Local Store';
                const normalizedStatus = normalizeOrderStatus(order.status);
                const isDelivered = normalizedStatus === 'DELIVERED';
                const dateLabel = order.createdAt
                  ? new Date(order.createdAt).toLocaleString([], {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '';

                return (
                  <li
                    key={order.orderId}
                    className="past-order-item"
                    data-testid="past-order-row"
                  >
                    <div className="past-order-top">
                      <div className="past-order-store">
                        <i className="fa-solid fa-store" aria-hidden="true" />
                        <span>{storeName}</span>
                      </div>
                      <span
                        className={`past-status-badge ${
                          isDelivered ? 'delivered' : 'cancelled'
                        }`}
                      >
                        {normalizedStatus}
                      </span>
                    </div>
                    <div className="past-order-items">
                      {rawItems.length > 0
                        ? rawItems.map((item) => `${item.name} × ${item.qty}`).join(', ')
                        : `Order #${order.orderId.slice(-6)}`}
                    </div>
                    <div className="past-order-meta">
                      <span className="past-order-meta-text">
                        #{order.orderId.slice(-6)}
                        {dateLabel ? ` • ${dateLabel}` : ''}
                        {order.paymentMode ? ` • ${order.paymentMode}` : ''}
                        {order.deliverySlot && order.deliverySlot !== 'EXPRESS_15'
                          ? ` • ${order.deliverySlot}`
                          : ''}
                      </span>
                      <div className="past-order-actions">
                        <span className="past-order-amount">
                          ₹{Number(order.totalAmount || 0).toFixed(0)}
                        </span>
                        <button
                          type="button"
                          className={`btn btn-outline btn-sm past-receipt-btn ${
                            openReceiptId === order.orderId ? 'active' : ''
                          }`}
                          aria-label={`View receipt for ${storeName} (#${order.orderId.slice(-6)})`}
                          aria-expanded={openReceiptId === order.orderId}
                          data-testid="past-order-receipt-btn"
                          onClick={() => {
                            triggerHaptic('tap');
                            setOpenReceiptId((prev) =>
                              prev === order.orderId ? null : order.orderId
                            );
                          }}
                        >
                          <i className="fa-solid fa-file-invoice" aria-hidden="true" />{' '}
                          Receipt
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm past-reorder-btn"
                          aria-label={`Reorder from ${storeName} (#${order.orderId.slice(-6)})`}
                          onClick={() => onReorderOrder(order)}
                        >
                          <i className="fa-solid fa-rotate-right" aria-hidden="true" />{' '}
                          Reorder
                        </button>
                      </div>
                    </div>
                    <div className="past-order-extra-actions">
                      {order.refundStatus && order.refundStatus !== 'NONE' ? (
                        <span
                          className={`past-refund-badge ${
                            order.refundStatus === 'APPROVED'
                              ? 'approved'
                              : order.refundStatus === 'REJECTED'
                                ? 'rejected'
                                : ''
                          }`}
                          data-testid={`refund-badge-${order.orderId}`}
                        >
                          💸 REFUND {order.refundStatus}
                        </span>
                      ) : allowRefundRequests ? (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm past-refund-btn"
                          data-testid={`past-refund-btn-${order.orderId}`}
                          onClick={() => onOpenRefundOrder(order)}
                        >
                          <i className="fa-solid fa-rotate-left" aria-hidden="true" />{' '}
                          Request Refund
                        </button>
                      ) : null}
                      {allowStoreRatings && isDelivered && !order.storeRating && (
                        <button
                          type="button"
                          className="btn btn-outline btn-sm past-rate-store-btn"
                          data-testid={`past-rate-store-btn-${order.orderId}`}
                          onClick={() =>
                            onOpenRateStore(
                              order.batchGroupId ||
                                (order.deliveryOtp
                                  ? `${order.customerUid}_${order.deliveryOtp}`
                                  : order.orderId)
                            )
                          }
                        >
                          ⭐ Rate Store
                        </button>
                      )}
                      {Number(order.riderTip || 0) > 0 && (
                        <span className="order-tip-pill">
                          ❤️ Tip ₹{Number(order.riderTip || 0).toFixed(0)}
                        </span>
                      )}
                    </div>
                    {openReceiptId === order.orderId && (
                      <OrderReceiptCard
                        receipt={buildOrderReceiptFromOrder(order, stores)}
                        brandName={brandName}
                        onClose={() => setOpenReceiptId(null)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
};
