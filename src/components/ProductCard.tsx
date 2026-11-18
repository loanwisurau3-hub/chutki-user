import React from 'react';
import type { MenuItem } from '../types/bazar';
import { formatDistanceKmLabel, getProductStockInfo } from '../utils/bazarLogic';
import { DEFAULT_PRODUCT_IMG } from '../utils/imageUtils';

interface ProductCardProps {
  item: MenuItem;
  qtyInCart: number;
  isFavorite: boolean;
  isStoreOpen?: boolean;
  showStockBadge?: boolean;
  enforceStockLimits?: boolean;
  onToggleFavorite: (storeId: string, itemId: string, e: React.MouseEvent) => void;
  onOpenDetail: (storeId: string, itemId: string) => void;
  onUpdateCart: (itemId: string, storeId: string, change: number, e: React.MouseEvent) => void;
}

export const ProductCard: React.FC<ProductCardProps> = ({
  item,
  qtyInCart,
  isFavorite,
  isStoreOpen = true,
  showStockBadge = true,
  enforceStockLimits = true,
  onToggleFavorite,
  onOpenDetail,
  onUpdateCart,
}) => {
  const mrp = Number(item.mrp || 0);
  const price = Number(item.price || 0);
  const discPct =
    mrp > price ? Math.round(((mrp - price) / mrp) * 100) : Number(item.discountPercent || 0);
  const showSale = Boolean(item.isOnSale || discPct > 0);
  const stock = getProductStockInfo(item);
  const blockOutOfStock =
    item.available === false || (enforceStockLimits && stock.isOutOfStock);
  const atMaxStock =
    enforceStockLimits && stock.count !== null && qtyInCart >= stock.count;

  return (
    <div className={`qc-product-card ${blockOutOfStock ? 'is-out-of-stock' : ''}`}>
      {showSale ? (
        <div className="qc-sale-badge">
          {item.saleBadgeText
            ? item.saleBadgeText
            : discPct > 0
              ? `${discPct}% OFF`
              : '🔥 SALE'}
        </div>
      ) : (
        <div className="qc-timer-badge">
          <i className="fa-solid fa-bolt" /> 15 MINS
        </div>
      )}

      <button
        type="button"
        className="qc-fav-btn"
        aria-label={isFavorite ? `Remove ${item.name} from favorites` : `Add ${item.name} to favorites`}
        onClick={(e) => onToggleFavorite(item.storeId, item.itemId, e)}
        title="Favorite"
      >
        {isFavorite ? '❤️' : '🤍'}
      </button>

      <div className="qc-img-wrap" onClick={() => onOpenDetail(item.storeId, item.itemId)}>
        <img
          src={item.imageUrl || DEFAULT_PRODUCT_IMG}
          className="qc-img"
          loading="lazy"
          onError={(e) => {
            if (e.currentTarget.src !== DEFAULT_PRODUCT_IMG) {
              e.currentTarget.src = DEFAULT_PRODUCT_IMG;
            }
          }}
          alt={item.name}
        />
      </div>

      <div
        onClick={() => onOpenDetail(item.storeId, item.itemId)}
        style={{ cursor: 'pointer' }}
      >
        <span className="qc-store-tag">🏪 {item.storeName || 'Store'}</span>
        <div className="qc-meta-badges">
          {typeof item.distanceKm === 'number' && Number.isFinite(item.distanceKm) && (
            <span
              className={`qc-dist-pill ${item.isWithinNearbyRadius ? 'nearby' : ''}`}
              data-testid={`product-distance-${item.itemId}`}
            >
              📍 {formatDistanceKmLabel(item.distanceKm)}
            </span>
          )}
          {item.ratingCount ? (
            <span className="qc-rating-pill">
              ⭐ {Number(item.ratingAvg || 5).toFixed(1)} ({item.ratingCount})
            </span>
          ) : null}
          {showStockBadge && stock.count !== null && (
            <span
              className={`qc-stock-pill ${
                stock.isOutOfStock ? 'out' : stock.isLowStock ? 'low' : 'ok'
              }`}
              data-testid={`product-stock-${item.itemId}`}
            >
              {stock.label}
            </span>
          )}
        </div>
        <div className="qc-name">{item.name}</div>
        <div className="qc-unit">{item.description || 'Fresh Stock'}</div>
      </div>

      <div className="qc-footer">
        <div>
          <span className="qc-price">₹{price.toFixed(0)}</span>
          {mrp > price && <span className="qc-mrp">₹{mrp.toFixed(0)}</span>}
        </div>
        <div>
          {!isStoreOpen ? (
            <button type="button" className="qc-add-btn" disabled>
              CLOSED
            </button>
          ) : blockOutOfStock ? (
            <button type="button" className="qc-add-btn" disabled>
              OUT
            </button>
          ) : qtyInCart > 0 ? (
            <div className="qc-counter" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                aria-label={`Decrease quantity of ${item.name}`}
                className="qc-counter-btn"
                onClick={(e) => onUpdateCart(item.itemId, item.storeId, -1, e)}
              >
                -
              </button>
              <span className="qc-counter-val">{qtyInCart}</span>
              <button
                type="button"
                aria-label={`Increase quantity of ${item.name}`}
                className="qc-counter-btn"
                disabled={atMaxStock}
                title={atMaxStock ? `Max ${stock.count} in stock` : 'Add one more'}
                onClick={(e) => onUpdateCart(item.itemId, item.storeId, 1, e)}
              >
                +
              </button>
            </div>
          ) : (
            <button
              type="button"
              aria-label={`Add ${item.name} to basket`}
              className="qc-add-btn"
              onClick={(e) => onUpdateCart(item.itemId, item.storeId, 1, e)}
            >
              ADD
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
