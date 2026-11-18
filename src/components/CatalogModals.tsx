import React from 'react';
import type { MenuItem, ProductReview, Store } from '../types/bazar';
import {
  formatDistanceKmLabel,
  getProductStockInfo,
  getStoreDistanceKm,
} from '../utils/bazarLogic';
import { calculateDistanceDeliveryFee } from '../utils/distanceDelivery';
import { DEFAULT_PRODUCT_DETAIL_IMG } from '../utils/imageUtils';
import { ProductCard } from './ProductCard';

interface StoreMenuModalProps {
  storeId: string | null;
  stores: Record<string, Store>;
  allMenus: Record<string, Record<string, Omit<MenuItem, 'itemId' | 'storeId'>>>;
  favorites: Record<string, boolean> | undefined;
  favoriteStores?: Record<string, boolean>;
  showStockBadges?: boolean;
  enforceStockLimits?: boolean;
  allowFavoriteStores?: boolean;
  allowStoreRatings?: boolean;
  customerLat?: number | null;
  customerLng?: number | null;
  baseDeliveryCharge?: number;
  baseDeliveryDistanceKm?: number;
  perKmDeliveryCharge?: number;
  maxDeliveryCharge?: number;
  allowDistanceDeliveryCharge?: boolean;
  isPlusActive?: boolean;
  getItemQuantityInCart: (itemId: string, storeId: string) => number;
  onClose: () => void;
  onToggleFavorite: (storeId: string, itemId: string, e: React.MouseEvent) => void;
  onToggleFavoriteStore?: (storeId: string, e: React.MouseEvent) => void;
  onOpenProductDetail: (storeId: string, itemId: string) => void;
  onUpdateCart: (itemId: string, storeId: string, change: number, e: React.MouseEvent) => void;
}

export const StoreMenuModal: React.FC<StoreMenuModalProps> = ({
  storeId,
  stores,
  allMenus,
  favorites,
  favoriteStores,
  showStockBadges = true,
  enforceStockLimits = true,
  allowFavoriteStores = true,
  allowStoreRatings = true,
  customerLat = null,
  customerLng = null,
  baseDeliveryCharge = 25,
  baseDeliveryDistanceKm = 2,
  perKmDeliveryCharge = 8,
  maxDeliveryCharge = 0,
  allowDistanceDeliveryCharge = true,
  isPlusActive = false,
  getItemQuantityInCart,
  onClose,
  onToggleFavorite,
  onToggleFavoriteStore,
  onOpenProductDetail,
  onUpdateCart,
}) => {
  if (!storeId) return null;
  const store = stores[storeId] || {};
  const storeName = store.name || 'Store';
  const isStoreFav = Boolean(favoriteStores?.[storeId]);
  const isStoreOpen =
    store.isOpen !== false && store.approved === true && store.suspended !== true;
  const items = allMenus[storeId] || {};
  const entries = Object.entries(items).filter(
    ([_, item]) => item.available !== false && item.adminApproved === true
  );
  const storeDistanceKm = getStoreDistanceKm(store, customerLat, customerLng);
  const storeDeliveryFee = calculateDistanceDeliveryFee({
    distanceKm: storeDistanceKm,
    baseDeliveryCharge,
    baseDistanceKm: baseDeliveryDistanceKm,
    perKmCharge: perKmDeliveryCharge,
    maxDeliveryCharge,
    allowDistancePricing: allowDistanceDeliveryCharge,
  });

  return (
    <div id="menu-modal" className="sheet-backdrop" onClick={onClose}>
      <div
        className="checkout-sheet"
        style={{ maxHeight: '94vh', paddingBottom: '100px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.75rem',
            borderBottom: '1px solid var(--border)',
            paddingBottom: '0.75rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h4
                id="menu-store-name"
                style={{ fontWeight: 900, fontSize: '1.1rem', color: '#111' }}
              >
                {storeName}
              </h4>
              {allowStoreRatings && (store.ratingCount || store.ratingAvg) && (
                <span className="store-rating-pill">
                  ⭐ {Number(store.ratingAvg || 4.8).toFixed(1)}
                  {store.ratingCount ? ` (${store.ratingCount})` : ''}
                </span>
              )}
            </div>
            <span
              id="menu-store-category"
              style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}
            >
              {store.cuisine || 'Groceries'}
              {storeDistanceKm !== null
                ? ` • 📍 ${formatDistanceKmLabel(storeDistanceKm)}`
                : ''}
              {isPlusActive
                ? ' • 👑 FREE Delivery'
                : ` • 🚚 Delivery ₹${storeDeliveryFee}`}
            </span>
            {Number(store.storeDiscountPercent || 0) > 0 && (
              <div
                id="menu-store-offer-pill"
                style={{
                  marginTop: '4px',
                  background: '#fef3c7',
                  color: '#92400e',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  padding: '2px 8px',
                  borderRadius: '6px',
                  display: 'inline-block',
                }}
              >
                🏷️ {store.storeDiscountPercent}% Store Discount
                {Number(store.storeDiscountMinOrder || 0) > 0
                  ? ` above ₹${store.storeDiscountMinOrder}`
                  : ''}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {allowFavoriteStores && onToggleFavoriteStore && (
              <button
                type="button"
                aria-label={isStoreFav ? `Remove ${storeName} from favourite stores` : `Save ${storeName} as favourite store`}
                aria-pressed={isStoreFav}
                data-testid="modal-store-fav-btn"
                className={`store-modal-fav-btn ${isStoreFav ? 'active' : ''}`}
                onClick={(e) => onToggleFavoriteStore(storeId, e)}
              >
                {isStoreFav ? '❤️ Saved' : '🤍 Save'}
              </button>
            )}
            <button
              type="button"
              aria-label="Close store catalog"
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '1.4rem',
                cursor: 'pointer',
                color: '#64748b',
              }}
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        </div>

        {!isStoreOpen && (
          <div
            id="store-closed-ban-notice"
            style={{
              background: '#fee2e2',
              color: '#991b1b',
              padding: '10px',
              borderRadius: '12px',
              fontSize: '0.8rem',
              fontWeight: 800,
              marginBottom: '10px',
              textAlign: 'center',
            }}
          >
            🔴 Store is Currently Offline / Closed — Ordering Disabled
          </div>
        )}

        <div className="product-grid-2col" id="store-products-container">
          {entries.length === 0 ? (
            <p
              style={{
                gridColumn: '1/-1',
                textAlign: 'center',
                color: 'var(--text-muted)',
                padding: '2rem',
              }}
            >
              No verified products available in this store.
            </p>
          ) : (
            entries.map(([itemId, item]) => (
              <ProductCard
                key={itemId}
                item={{ ...item, itemId, storeId, storeName, distanceKm: storeDistanceKm }}
                qtyInCart={getItemQuantityInCart(itemId, storeId)}
                isFavorite={Boolean(favorites?.[`${storeId}___${itemId}`])}
                isStoreOpen={isStoreOpen}
                showStockBadge={showStockBadges}
                enforceStockLimits={enforceStockLimits}
                deliveryFeeEstimate={storeDeliveryFee}
                isFreeDeliveryPass={isPlusActive}
                onToggleFavorite={onToggleFavorite}
                onOpenDetail={onOpenProductDetail}
                onUpdateCart={onUpdateCart}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

interface ProductDetailModalProps {
  detailRef: { storeId: string; itemId: string } | null;
  stores: Record<string, Store>;
  allMenus: Record<string, Record<string, Omit<MenuItem, 'itemId' | 'storeId'>>>;
  productReviews: Record<string, Record<string, Record<string, ProductReview>>>;
  favorites: Record<string, boolean> | undefined;
  showStockBadges?: boolean;
  enforceStockLimits?: boolean;
  customerLat?: number | null;
  customerLng?: number | null;
  baseDeliveryCharge?: number;
  baseDeliveryDistanceKm?: number;
  perKmDeliveryCharge?: number;
  maxDeliveryCharge?: number;
  allowDistanceDeliveryCharge?: boolean;
  isPlusActive?: boolean;
  getItemQuantityInCart: (itemId: string, storeId: string) => number;
  onClose: () => void;
  onToggleFavorite: (storeId: string, itemId: string, e?: React.MouseEvent) => void;
  onOpenProductDetail: (storeId: string, itemId: string) => void;
  onUpdateCart: (itemId: string, storeId: string, change: number, e?: React.MouseEvent) => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  detailRef,
  stores,
  allMenus,
  productReviews,
  favorites,
  showStockBadges = true,
  enforceStockLimits = true,
  customerLat = null,
  customerLng = null,
  baseDeliveryCharge = 25,
  baseDeliveryDistanceKm = 2,
  perKmDeliveryCharge = 8,
  maxDeliveryCharge = 0,
  allowDistanceDeliveryCharge = true,
  isPlusActive = false,
  getItemQuantityInCart,
  onClose,
  onToggleFavorite,
  onOpenProductDetail,
  onUpdateCart,
}) => {
  if (!detailRef) return null;
  const { storeId, itemId } = detailRef;
  const rawItem = allMenus[storeId]?.[itemId];
  if (!rawItem) return null;
  const store = stores[storeId] || {};
  const isStoreOpen =
    store.isOpen !== false && store.approved === true && store.suspended !== true;
  const isFav = Boolean(favorites?.[`${storeId}___${itemId}`]);
  const qty = getItemQuantityInCart(itemId, storeId);
  const stockInfo = getProductStockInfo(rawItem);
  const blockOutOfStock =
    rawItem.available === false || (enforceStockLimits && stockInfo.isOutOfStock);
  const atMaxStock =
    enforceStockLimits && stockInfo.count !== null && qty >= stockInfo.count;

  const itemDistKm = getStoreDistanceKm(store, customerLat, customerLng);
  const itemDeliveryFee = calculateDistanceDeliveryFee({
    distanceKm: itemDistKm,
    baseDeliveryCharge,
    baseDistanceKm: baseDeliveryDistanceKm,
    perKmCharge: perKmDeliveryCharge,
    maxDeliveryCharge,
    allowDistancePricing: allowDistanceDeliveryCharge,
  });

  const mrp = Number(rawItem.mrp || 0);
  const price = Number(rawItem.price || 0);
  const discPct =
    mrp > price
      ? Math.round(((mrp - price) / mrp) * 100)
      : Number(rawItem.discountPercent || 0);

  const revs = Object.entries(productReviews[storeId]?.[itemId] || {}).sort(
    (a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0)
  );

  const myWords = `${rawItem.name || ''} ${rawItem.searchKeywords || ''}`
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);

  const similarList: MenuItem[] = [];
  Object.entries(allMenus).forEach(([sId, sItems]) => {
    const st = stores[sId];
    if (!st || st.approved !== true || st.suspended === true || st.isOpen === false) {
      return;
    }
    const simDistKm = getStoreDistanceKm(st, customerLat, customerLng);
    Object.entries(sItems || {}).forEach(([iId, it]) => {
      if (sId === storeId && iId === itemId) return;
      if (it.available === false || it.adminApproved !== true) return;
      const sameCat =
        rawItem.category && it.category && rawItem.category === it.category;
      const kwMatch = myWords.some((w) =>
        `${it.name || ''} ${it.searchKeywords || ''}`.toLowerCase().includes(w)
      );
      if (sameCat || kwMatch) {
        similarList.push({
          ...it,
          itemId: iId,
          storeId: sId,
          storeName: st.name,
          distanceKm: simDistKm,
        });
      }
    });
  });

  return (
    <div id="product-detail-modal" className="sheet-backdrop" onClick={onClose}>
      <div className="checkout-sheet" onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.75rem',
          }}
        >
          <span id="pd-store-badge" className="qc-store-tag" style={{ margin: 0 }}>
            🏪 {store.name || 'Store'}
          </span>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button
              type="button"
              id="pd-fav-btn"
              aria-label="Toggle favorite"
              className="qc-fav-btn"
              style={{ position: 'static' }}
              onClick={() => onToggleFavorite(storeId, itemId)}
            >
              {isFav ? '❤️' : '🤍'}
            </button>
            <button
              type="button"
              aria-label="Close product detail"
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '1.35rem',
                cursor: 'pointer',
                color: '#64748b',
              }}
            >
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        </div>

        <div
          style={{
            textAlign: 'center',
            background: '#f8fafc',
            borderRadius: '16px',
            padding: '1rem',
            marginBottom: '0.85rem',
            position: 'relative',
          }}
        >
          {(rawItem.isOnSale || discPct > 0) && (
            <span id="pd-sale-tag" className="qc-sale-badge">
              {rawItem.saleBadgeText || (discPct > 0 ? `${discPct}% OFF` : '🔥 SALE')}
            </span>
          )}
          <img
            id="pd-img"
            src={rawItem.imageUrl || DEFAULT_PRODUCT_DETAIL_IMG}
            style={{ maxHeight: '170px', maxWidth: '100%', objectFit: 'contain', margin: '0 auto' }}
            onError={(e) => {
              if (e.currentTarget.src !== DEFAULT_PRODUCT_DETAIL_IMG) {
                e.currentTarget.src = DEFAULT_PRODUCT_DETAIL_IMG;
              }
            }}
            alt={rawItem.name}
          />
        </div>

        <h3
          id="pd-name"
          style={{ fontWeight: 900, fontSize: '1.1rem', marginBottom: '4px' }}
        >
          {rawItem.name || 'Product'}
        </h3>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            flexWrap: 'wrap',
            marginBottom: '8px',
          }}
        >
          <span
            id="pd-price"
            style={{
              fontSize: '1.25rem',
              fontWeight: 900,
              color: 'var(--brand-green)',
            }}
          >
            ₹{price.toFixed(0)}
          </span>
          {mrp > price && (
            <span id="pd-mrp" className="qc-mrp">
              ₹{mrp.toFixed(0)}
            </span>
          )}
          {rawItem.ratingCount ? (
            <span id="pd-rating-badge" className="qc-rating-pill">
              ⭐ {Number(rawItem.ratingAvg || 5).toFixed(1)} ({rawItem.ratingCount}{' '}
              reviews)
            </span>
          ) : null}
          {showStockBadges && (
            <span
              id="pd-stock-badge"
              className={`qc-stock-pill ${
                stockInfo.isOutOfStock ? 'out' : stockInfo.isLowStock ? 'low' : 'ok'
              }`}
            >
              {stockInfo.label}
            </span>
          )}
          <span className={`qc-delivery-pill ${isPlusActive ? 'free' : ''}`}>
            {isPlusActive
              ? '👑 FREE Delivery (Chutki Plus)'
              : itemDistKm !== null
                ? `🚚 Delivery ₹${itemDeliveryFee} (${formatDistanceKmLabel(itemDistKm)})`
                : `🚚 Delivery ₹${itemDeliveryFee}`}
          </span>
        </div>

        <p
          id="pd-desc"
          style={{
            fontSize: '0.84rem',
            color: '#475569',
            lineHeight: 1.45,
            marginBottom: '1rem',
          }}
        >
          {rawItem.description ||
            'Fresh quality daily grocery item delivered in 15 minutes.'}
        </p>

        <div id="pd-action-wrap" style={{ marginBottom: '1.15rem' }}>
          {!isStoreOpen ? (
            <button
              type="button"
              className="btn btn-outline"
              disabled
              style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
            >
              Store Currently Closed
            </button>
          ) : blockOutOfStock ? (
            <button
              type="button"
              className="btn btn-outline"
              disabled
              style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
            >
              Currently Out of Stock
            </button>
          ) : qty > 0 ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'var(--brand-green)',
                color: '#fff',
                borderRadius: '12px',
                padding: '0.45rem 1rem',
                fontWeight: 900,
              }}
            >
              <button
                type="button"
                className="qc-counter-btn"
                onClick={() => onUpdateCart(itemId, storeId, -1)}
              >
                -
              </button>
              <span>{qty} in Basket</span>
              <button
                type="button"
                className="qc-counter-btn"
                disabled={atMaxStock}
                onClick={() => onUpdateCart(itemId, storeId, 1)}
              >
                +
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onUpdateCart(itemId, storeId, 1)}
            >
              <i className="fa-solid fa-cart-plus" /> Add to Basket
            </button>
          )}
        </div>

        <div
          style={{
            borderTop: '1px dashed var(--border)',
            paddingTop: '0.85rem',
            marginBottom: '1rem',
          }}
        >
          <strong
            style={{ fontSize: '0.88rem', display: 'block', marginBottom: '6px' }}
          >
            ⭐ Customer Reviews & Ratings
          </strong>
          <div id="pd-reviews-list" style={{ maxHeight: '140px', overflowY: 'auto' }}>
            {revs.length === 0 ? (
              <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                No reviews yet. Order & share your review!
              </p>
            ) : (
              revs.map(([revId, r]) => (
                <div
                  key={revId}
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
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.74rem',
                    }}
                  >
                    <strong>{r.customerName || 'Verified Buyer'}</strong>
                    <span style={{ color: '#f59e0b', fontWeight: 900 }}>
                      {'★'.repeat(Number(r.rating || 5))}
                    </span>
                  </div>
                  {r.review && (
                    <div
                      style={{
                        fontSize: '0.76rem',
                        color: '#334155',
                        marginTop: '2px',
                      }}
                    >
                      {r.review}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div
          style={{ borderTop: '1px dashed var(--border)', paddingTop: '0.85rem' }}
        >
          <strong
            style={{ fontSize: '0.88rem', display: 'block', marginBottom: '8px' }}
          >
            ✨ Similar Products You May Like
          </strong>
          <div
            className="product-grid-2col"
            id="pd-similar-grid"
            style={{ marginBottom: 0 }}
          >
            {similarList.length === 0 ? (
              <p
                style={{
                  gridColumn: '1/-1',
                  fontSize: '0.76rem',
                  color: 'var(--text-muted)',
                }}
              >
                No similar items found right now.
              </p>
            ) : (
              similarList.slice(0, 4).map((sim) => (
                <ProductCard
                  key={`${sim.storeId}___${sim.itemId}`}
                  item={sim}
                  qtyInCart={getItemQuantityInCart(sim.itemId, sim.storeId)}
                  isFavorite={Boolean(favorites?.[`${sim.storeId}___${sim.itemId}`])}
                  isStoreOpen
                  showStockBadge={showStockBadges}
                  enforceStockLimits={enforceStockLimits}
                  deliveryFeeEstimate={calculateDistanceDeliveryFee({
                    distanceKm: sim.distanceKm,
                    baseDeliveryCharge,
                    baseDistanceKm: baseDeliveryDistanceKm,
                    perKmCharge: perKmDeliveryCharge,
                    maxDeliveryCharge,
                    allowDistancePricing: allowDistanceDeliveryCharge,
                  })}
                  isFreeDeliveryPass={isPlusActive}
                  onToggleFavorite={onToggleFavorite}
                  onOpenDetail={onOpenProductDetail}
                  onUpdateCart={onUpdateCart}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
