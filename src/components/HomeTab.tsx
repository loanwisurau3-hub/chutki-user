import React, { useMemo, useState } from 'react';
import type { AdminSettings, CategoryDef, MenuItem, Store } from '../types/bazar';
import {
  DEFAULT_NEARBY_RADIUS_KM,
  extractStoreFilterOptions,
  filterStoresByCategoryOrCuisine,
  filterStoresByQuery,
  formatDistanceKmLabel,
  getStoreDistanceKm,
  getStoreMostPopularItem,
  isStoreWithinRadius,
} from '../utils/bazarLogic';
import { DEFAULT_STORE_IMG } from '../utils/imageUtils';
import { calculateDistanceDeliveryFee } from '../utils/distanceDelivery';
import { ProductCard } from './ProductCard';
import { PushPermissionBanner } from './PWAControls';
import type { PushPermissionState } from '../hooks/usePushNotifications';
import { triggerHaptic } from '../utils/haptics';

interface HomeTabProps {
  settings: AdminSettings;
  freeDeliveryMinOrder: number;
  currentCategoryFilter: string;
  categories: CategoryDef[];
  filteredProducts: MenuItem[];
  approvedStores: Array<[string, Store]>;
  allMenus: Record<string, Record<string, Omit<MenuItem, 'itemId' | 'storeId'>>>;
  favorites: Record<string, boolean> | undefined;
  favoriteStores?: Record<string, boolean>;
  allowFavoriteStores?: boolean;
  allowStoreQuickAdd?: boolean;
  allowStoreRatings?: boolean;
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
  nearbyRadiusKm?: number;
  prioritizeNearbyStores?: boolean;
  searchQuery?: string;
  isDetectingGps?: boolean;
  isLiveGpsTracking?: boolean;
  onDetectLiveGps?: () => void;
  getItemQuantityInCart: (itemId: string, storeId: string) => number;
  onFilterCategory: (catId: string) => void;
  onToggleFavorite: (storeId: string, itemId: string, e: React.MouseEvent) => void;
  onToggleFavoriteStore?: (storeId: string, e: React.MouseEvent) => void;
  onOpenProductDetail: (storeId: string, itemId: string) => void;
  onUpdateCart: (itemId: string, storeId: string, change: number, e: React.MouseEvent) => void;
  onQuickAddStorePopular?: (storeId: string, item: MenuItem, e: React.MouseEvent) => void;
  onOpenStoreModal: (storeId: string) => void;
  pushPermission: PushPermissionState;
  pushPromptDismissed: boolean;
  onEnablePush: () => void;
  onDismissPushPrompt: () => void;
}

export const HomeTab: React.FC<HomeTabProps> = ({
  settings,
  freeDeliveryMinOrder,
  currentCategoryFilter,
  categories,
  filteredProducts,
  approvedStores,
  allMenus,
  favorites,
  favoriteStores,
  allowFavoriteStores = true,
  allowStoreQuickAdd = true,
  allowStoreRatings = true,
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
  nearbyRadiusKm = DEFAULT_NEARBY_RADIUS_KM,
  prioritizeNearbyStores = true,
  searchQuery = '',
  isDetectingGps = false,
  isLiveGpsTracking = false,
  onDetectLiveGps,
  getItemQuantityInCart,
  onFilterCategory,
  onToggleFavorite,
  onToggleFavoriteStore,
  onOpenProductDetail,
  onUpdateCart,
  onQuickAddStorePopular,
  onOpenStoreModal,
  pushPermission,
  pushPromptDismissed,
  onEnablePush,
  onDismissPushPrompt,
}) => {
  const activeCat = categories.find((c) => c.id === currentCategoryFilter);
  const showHero = settings.showHeroBanner !== false;

  const [selectedStoreFilter, setSelectedStoreFilter] = useState<string>('ALL');
  const [storeSearchQuery, setStoreSearchQuery] = useState<string>('');

  const storeFilterOptions = useMemo(
    () =>
      extractStoreFilterOptions(
        approvedStores,
        allMenus,
        categories,
        allowFavoriteStores ? favoriteStores : undefined
      ),
    [approvedStores, allMenus, categories, allowFavoriteStores, favoriteStores]
  );

  const effectiveStoreFilter =
    selectedStoreFilter === 'ALL' ||
    storeFilterOptions.some((opt) => opt.id === selectedStoreFilter)
      ? selectedStoreFilter
      : 'ALL';

  const categoryFilteredStores = useMemo(
    () =>
      filterStoresByCategoryOrCuisine(
        approvedStores,
        effectiveStoreFilter,
        allMenus,
        categories,
        favoriteStores
      ),
    [approvedStores, effectiveStoreFilter, allMenus, categories, favoriteStores]
  );

  const visibleStores = useMemo(
    () => filterStoresByQuery(categoryFilteredStores, storeSearchQuery),
    [categoryFilteredStores, storeSearchQuery]
  );

  const hasActiveStoreFilters =
    Boolean(storeSearchQuery.trim()) || effectiveStoreFilter !== 'ALL';
  const hasCustomerCoords =
    customerLat !== null &&
    customerLng !== null &&
    Number.isFinite(customerLat) &&
    Number.isFinite(customerLng);
  const showNearbyBannerTag = prioritizeNearbyStores && hasCustomerCoords;
  const cleanSearch = searchQuery.trim();

  return (
    <div id="tab-home" className="tab-content active">
      <PushPermissionBanner
        permission={pushPermission}
        promptDismissed={pushPromptDismissed}
        onEnable={onEnablePush}
        onDismiss={onDismissPushPrompt}
      />

      {showHero && (
        <div className="promo-hero-card" id="promo-hero-card">
          <div>
            <span className="promo-tag-pill" id="hero-tag-text">
              {settings.heroTag || 'Chutki'}
            </span>
            <h3
              style={{ fontWeight: 900, fontSize: '1.15rem', marginTop: '2px' }}
              id="hero-title-text"
            >
              {settings.heroTitle || 'Fresh Groceries Delivered'}
            </h3>
            <p style={{ fontSize: '0.78rem', opacity: 0.95 }} id="hero-sub-text">
              {settings.heroSubtitle ? (
                <>
                  {settings.heroSubtitle} (Free &gt; ₹
                  <span id="hero-free-del-limit">{freeDeliveryMinOrder}</span>)
                </>
              ) : (
                <>
                  Shop from any store together! Free Delivery &gt; ₹
                  <span id="hero-free-del-limit">{freeDeliveryMinOrder}</span>
                </>
              )}
            </p>
          </div>
          <div style={{ fontSize: '2.4rem' }} id="hero-emoji-el">
            {settings.heroEmoji || '🛍️'}
          </div>
        </div>
      )}

      {settings.customBannerImageUrl && (
        <div id="custom-banner-img-wrap">
          <img
            id="custom-banner-img"
            src={settings.customBannerImageUrl}
            style={{
              width: '100%',
              maxHeight: '135px',
              objectFit: 'cover',
              display: 'block',
            }}
            alt="Promo"
          />
        </div>
      )}

      {settings.extraBannerText && (
        <div id="extra-offer-strip">{settings.extraBannerText}</div>
      )}

      {currentCategoryFilter === 'ALL_STORES' && (
        <div id="stores-directory-wrapper">
          <div className="section-title-row" id="stores-section-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span>
                🏪 All Verified Stores
                {approvedStores.length > 0 && (
                  <span className="stores-section-count">
                    {' '}
                    · {hasActiveStoreFilters ? `${visibleStores.length} of ${approvedStores.length}` : visibleStores.length}
                  </span>
                )}
              </span>
              {showNearbyBannerTag ? (
                <button
                  type="button"
                  className="nearby-priority-pill nearby-priority-btn"
                  onClick={onDetectLiveGps}
                  disabled={isDetectingGps}
                >
                  {isDetectingGps
                    ? '📍 Updating GPS...'
                    : isLiveGpsTracking
                      ? `🟢 Live GPS • ≤ ${nearbyRadiusKm} km first`
                      : `📍 ≤ ${nearbyRadiusKm} km first`}
                </button>
              ) : (
                prioritizeNearbyStores &&
                onDetectLiveGps && (
                  <button
                    type="button"
                    className="nearby-priority-pill nearby-priority-btn idle"
                    onClick={onDetectLiveGps}
                    disabled={isDetectingGps}
                  >
                    {isDetectingGps
                      ? '📍 Detecting GPS...'
                      : `📍 Use Live GPS (≤ ${nearbyRadiusKm} km)`}
                  </button>
                )
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                triggerHaptic('tap');
                onFilterCategory('ALL');
              }}
              style={{
                background: 'none',
                border: 'none',
                fontSize: '0.72rem',
                color: 'var(--brand-green)',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Back to Products
            </button>
          </div>
        </div>
      )}

      {currentCategoryFilter !== 'ALL_STORES' && (
        <div id="products-feed-section">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.65rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0 }}>
              <span
                style={{ fontSize: '0.95rem', fontWeight: 900, color: '#111' }}
                id="active-category-title"
              >
                {cleanSearch
                  ? `Results for "${cleanSearch}"`
                  : currentCategoryFilter === 'ALL'
                    ? 'Trending Daily Essentials'
                    : activeCat?.name || 'Category Items'}
              </span>
              {showNearbyBannerTag ? (
                onDetectLiveGps ? (
                  <button
                    type="button"
                    className="nearby-priority-pill nearby-priority-btn"
                    data-testid="nearby-products-pill"
                    onClick={onDetectLiveGps}
                    disabled={isDetectingGps}
                    title="Refresh live GPS location"
                  >
                    {isDetectingGps
                      ? '📍 Updating GPS...'
                      : isLiveGpsTracking
                        ? `🟢 Live GPS • Within ${nearbyRadiusKm} km first`
                        : `📍 Within ${nearbyRadiusKm} km first`}
                  </button>
                ) : (
                  <span className="nearby-priority-pill" data-testid="nearby-products-pill">
                    📍 Within {nearbyRadiusKm} km first
                  </span>
                )
              ) : (
                prioritizeNearbyStores &&
                onDetectLiveGps && (
                  <button
                    type="button"
                    className="nearby-priority-pill nearby-priority-btn idle"
                    data-testid="home-detect-gps-btn"
                    onClick={onDetectLiveGps}
                    disabled={isDetectingGps}
                  >
                    {isDetectingGps
                      ? '📍 Detecting GPS...'
                      : `📍 Detect GPS for ${nearbyRadiusKm} km priority`}
                  </button>
                )
              )}
            </div>
            <span
              style={{
                fontSize: '0.75rem',
                color: 'var(--brand-green)',
                fontWeight: 800,
                flexShrink: 0,
              }}
              id="home-eta-tag"
            >
              {settings.expressEtaText || '⚡ 15 Mins'}
            </span>
          </div>

          <div className="product-grid-2col" id="instant-products-grid">
            {filteredProducts.length === 0 ? (
              <div
                style={{
                  gridColumn: '1/-1',
                  textAlign: 'center',
                  padding: '2.2rem 1rem',
                  background: '#fff',
                  borderRadius: '18px',
                  border: '1px dashed var(--border)',
                }}
              >
                <div style={{ fontSize: '2.2rem', marginBottom: '0.5rem' }}>
                  {activeCat?.icon || '🔍'}
                </div>
                <strong
                  style={{ color: '#111', fontSize: '0.95rem', display: 'block' }}
                >
                  No verified items found in {activeCat?.name || 'this search'}
                </strong>
                <p
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '0.78rem',
                    margin: '4px 0 12px',
                  }}
                >
                  Try another keyword or browse all approved groceries.
                </p>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => onFilterCategory('ALL')}
                  style={{
                    margin: '0 auto',
                    color: 'var(--brand-green)',
                    borderColor: 'var(--brand-green)',
                    fontWeight: 800,
                  }}
                >
                  View All Groceries
                </button>
              </div>
            ) : (
              filteredProducts.slice(0, 50).map((item) => (
                <ProductCard
                  key={`${item.storeId}___${item.itemId}`}
                  item={item}
                  qtyInCart={getItemQuantityInCart(item.itemId, item.storeId)}
                  isFavorite={Boolean(favorites?.[`${item.storeId}___${item.itemId}`])}
                  isStoreOpen
                  showStockBadge={showStockBadges}
                  enforceStockLimits={enforceStockLimits}
                  deliveryFeeEstimate={calculateDistanceDeliveryFee({
                    distanceKm: item.distanceKm,
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
      )}

      {currentCategoryFilter !== 'ALL_STORES' && (
        <div className="section-title-row" id="bottom-stores-title">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span>
              Local Partner Stores
              {approvedStores.length > 0 && (
                <span className="stores-section-count">
                  {' '}
                  · {hasActiveStoreFilters ? `${visibleStores.length} of ${approvedStores.length}` : visibleStores.length}
                </span>
              )}
            </span>
            {showNearbyBannerTag && (
              <span className="nearby-priority-pill" data-testid="nearby-stores-pill">
                📍 ≤ {nearbyRadiusKm} km first
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              triggerHaptic('tap');
              onFilterCategory('ALL_STORES');
            }}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '0.72rem',
              color: 'var(--brand-green)',
              cursor: 'pointer',
              fontWeight: 800,
            }}
          >
            View All
          </button>
        </div>
      )}

      {approvedStores.length > 0 && (
        <div className="home-store-search-wrap" data-testid="home-store-search-wrap">
          <label htmlFor="home-store-search-input" className="sr-only">
            Search stores by name or cuisine
          </label>
          <i
            className="fa-solid fa-magnifying-glass home-store-search-icon"
            aria-hidden="true"
          />
          <input
            id="home-store-search-input"
            type="text"
            inputMode="search"
            className="home-store-search-input"
            placeholder="Search stores by name or cuisine..."
            aria-label="Search stores by name or cuisine"
            data-testid="home-store-search-input"
            value={storeSearchQuery}
            onChange={(e) => setStoreSearchQuery(e.target.value)}
          />
          {storeSearchQuery && (
            <button
              type="button"
              id="home-store-search-clear"
              className="home-store-search-clear"
              aria-label="Clear store search"
              data-testid="home-store-search-clear"
              onClick={() => {
                triggerHaptic('tap');
                setStoreSearchQuery('');
              }}
            >
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {approvedStores.length > 0 && storeFilterOptions.length > 1 && (
        <div
          id="stores-filter-strip"
          className="stores-filter-strip"
          role="group"
          aria-label="Filter stores by category or cuisine"
          data-testid="stores-filter-strip"
        >
          {storeFilterOptions.map((option) => {
            const isActive = effectiveStoreFilter === option.id;
            return (
              <button
                type="button"
                key={option.id}
                aria-pressed={isActive}
                className={`store-filter-chip ${isActive ? 'active' : ''}`}
                onClick={() => {
                  if (!isActive) triggerHaptic('tap');
                  setSelectedStoreFilter(option.id);
                }}
              >
                <span>{option.label}</span>
                <span className="store-filter-count">({option.count})</span>
              </button>
            );
          })}
        </div>
      )}

      <div id="stores-container" data-testid="stores-container">
        {visibleStores.length === 0 ? (
          <div className="stores-empty-card" data-testid="stores-empty-card">
            <p className="stores-empty-text">
              {approvedStores.length === 0
                ? 'No stores available right now.'
                : storeSearchQuery.trim() && effectiveStoreFilter !== 'ALL'
                  ? `No stores matching "${storeSearchQuery.trim()}" in this category.`
                  : storeSearchQuery.trim()
                    ? `No stores matching "${storeSearchQuery.trim()}".`
                    : 'No stores match this filter.'}
            </p>
            {approvedStores.length > 0 && hasActiveStoreFilters && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{
                  borderColor: 'var(--brand-green)',
                  color: 'var(--brand-green)',
                  marginTop: '0.55rem',
                }}
                onClick={() => {
                  triggerHaptic('tap');
                  setStoreSearchQuery('');
                  setSelectedStoreFilter('ALL');
                }}
              >
                {storeSearchQuery.trim() && effectiveStoreFilter !== 'ALL'
                  ? 'Reset Search & Filter'
                  : storeSearchQuery.trim()
                    ? 'Clear Store Search'
                    : 'Show All Stores'}
              </button>
            )}
          </div>
        ) : (
          visibleStores.map(([sId, s]) => {
            const isOpen = s.isOpen !== false;
            const approvedCount = Object.values(allMenus[sId] || {}).filter(
              (i) => i.available !== false && i.adminApproved === true
            ).length;
            const hasDiscount = Number(s.storeDiscountPercent || 0) > 0;
            const isStoreFav = Boolean(favoriteStores?.[sId]);
            const storeDistanceKm = hasCustomerCoords
              ? getStoreDistanceKm(s, customerLat, customerLng)
              : null;
            const storeWithinNearby = isStoreWithinRadius(
              storeDistanceKm,
              nearbyRadiusKm
            );
            const popularItem = getStoreMostPopularItem(sId, allMenus, s);
            const popularQtyInCart = popularItem
              ? getItemQuantityInCart(popularItem.itemId, sId)
              : 0;

            return (
              <div
                key={sId}
                className="store-mini-card"
                data-testid={`store-card-${sId}`}
                style={{ opacity: isOpen ? 1 : 0.65 }}
              >
                <button
                  type="button"
                  className="store-mini-open-btn"
                  aria-label={`Open ${s.name || 'Store'} menu`}
                  onClick={() => onOpenStoreModal(sId)}
                >
                  <div className="store-mini-thumb-wrap">
                    <img
                      src={s.imageUrl || DEFAULT_STORE_IMG}
                      className="store-mini-thumb"
                      loading="lazy"
                      onError={(e) => {
                        if (e.currentTarget.src !== DEFAULT_STORE_IMG) {
                          e.currentTarget.src = DEFAULT_STORE_IMG;
                        }
                      }}
                      alt={s.name || 'Store'}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingRight: allowFavoriteStores && onToggleFavoriteStore ? '34px' : undefined }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <strong style={{ fontSize: '0.92rem', color: '#111' }}>
                        {s.name || 'Store'}
                      </strong>
                      {allowStoreRatings && (s.ratingCount || s.ratingAvg) && (
                        <span className="store-rating-pill" data-testid={`store-rating-${sId}`}>
                          ⭐ {Number(s.ratingAvg || 4.8).toFixed(1)}
                          {s.ratingCount ? ` (${s.ratingCount})` : ''}
                        </span>
                      )}
                      {!isOpen ? (
                        <span
                          style={{
                            fontSize: '0.62rem',
                            background: '#fee2e2',
                            color: '#dc2626',
                            padding: '1px 6px',
                            borderRadius: '6px',
                            fontWeight: 800,
                          }}
                        >
                          CLOSED
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: '0.62rem',
                            background: '#e8f5e9',
                            color: '#0c831f',
                            padding: '1px 6px',
                            borderRadius: '6px',
                            fontWeight: 800,
                          }}
                        >
                          OPEN
                        </span>
                      )}
                      {hasDiscount && (
                        <span
                          style={{
                            fontSize: '0.65rem',
                            background: '#fef3c7',
                            color: '#92400e',
                            padding: '1px 6px',
                            borderRadius: '6px',
                            fontWeight: 800,
                          }}
                        >
                          🏷️ {s.storeDiscountPercent}% OFF
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {s.cuisine || 'Daily Essentials'} • {approvedCount} Items
                    </div>
                    <div
                      style={{
                        fontSize: '0.72rem',
                        color: 'var(--brand-green)',
                        fontWeight: 800,
                        marginTop: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span>⚡ 15 Mins Express</span>
                      {storeDistanceKm !== null && (
                        <span
                          className={`store-distance-pill ${storeWithinNearby ? 'nearby' : ''}`}
                          data-testid={`store-distance-${sId}`}
                        >
                          📍 {formatDistanceKmLabel(storeDistanceKm)}
                          {storeWithinNearby ? ` • Within ${nearbyRadiusKm} km` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <i
                    className="fa-solid fa-chevron-right"
                    style={{ color: '#cbd5e1', fontSize: '0.85rem' }}
                  />
                </button>

                {allowFavoriteStores && onToggleFavoriteStore && (
                  <button
                    type="button"
                    className={`store-fav-btn ${isStoreFav ? 'active' : ''}`}
                    data-testid={`store-fav-btn-${sId}`}
                    aria-label={
                      isStoreFav
                        ? `Remove ${s.name || 'Store'} from favourite stores`
                        : `Save ${s.name || 'Store'} as favourite store`
                    }
                    aria-pressed={isStoreFav}
                    title={isStoreFav ? 'Remove Favourite Store' : 'Save Favourite Store'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavoriteStore(sId, e);
                    }}
                  >
                    {isStoreFav ? '❤️' : '🤍'}
                  </button>
                )}

                {allowStoreQuickAdd && isOpen && popularItem && (
                  <button
                    type="button"
                    className={`store-quick-add-btn ${popularQtyInCart > 0 ? 'has-qty' : ''}`}
                    data-testid={`store-quick-add-${sId}`}
                    aria-label={`Quick add ${popularItem.name} from ${s.name || 'Store'} (₹${Number(popularItem.price || 0).toFixed(0)})`}
                    title={`Quick add popular: ${popularItem.name} (₹${Number(popularItem.price || 0).toFixed(0)})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (onQuickAddStorePopular) {
                        onQuickAddStorePopular(sId, popularItem, e);
                      } else {
                        onUpdateCart(popularItem.itemId, sId, 1, e);
                      }
                    }}
                  >
                    <i className="fa-solid fa-plus" aria-hidden="true" />
                    {popularQtyInCart > 0 && (
                      <span className="store-quick-add-badge" aria-hidden="true">
                        {popularQtyInCart}
                      </span>
                    )}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
