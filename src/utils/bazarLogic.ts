import type {
  CartItem,
  CategoryDef,
  CustomerProfile,
  DeliveryPartner,
  GroupedOrder,
  MenuItem,
  OrderRecord,
  Store,
} from '../types/bazar';

export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { id: 'ALL', name: 'All Items', icon: '🛒', keywords: [], active: true },
  { id: 'ALL_STORES', name: 'All Store', icon: '🏪', keywords: [], active: true },
  { id: 'ON_SALE', name: 'Sale & Offers', icon: '🔥', keywords: [], active: true },
  { id: 'FAVORITES', name: 'Favorites', icon: '❤️', keywords: [], active: true },
  {
    id: 'VEG',
    name: 'Vegetables & Fruits',
    icon: '🥬',
    keywords: [
      'potato', 'aloo', 'onion', 'pyaz', 'tomato', 'tamatar', 'chilli', 'mirchi',
      'ginger', 'adrak', 'garlic', 'lahsun', 'lemon', 'fruit', 'apple', 'banana',
      'mango', 'veg', 'sabzi', 'gobi', 'carrot', 'cucumber', 'kheera', 'palak',
      'methi', 'coriander', 'dhaniya',
    ],
    active: true,
  },
  {
    id: 'DAIRY',
    name: 'Milk & Dairy',
    icon: '🥛',
    keywords: [
      'milk', 'doodh', 'amul', 'dahi', 'curd', 'paneer', 'butter', 'cheese',
      'ghee', 'chaas', 'lassi', 'cream', 'egg', 'bread', 'toast',
    ],
    active: true,
  },
  {
    id: 'STAPLES',
    name: 'Atta, Rice & Dal',
    icon: '🌾',
    keywords: [
      'atta', 'aashirvaad', 'chakki', 'wheat', 'rice', 'chawal', 'basmati',
      'dal', 'moong', 'masoor', 'toor', 'chana', 'rajma', 'besan', 'maida',
      'sooji', 'poha', 'sugar', 'cheeni', 'salt', 'namak',
    ],
    active: true,
  },
  {
    id: 'OIL_MASALA',
    name: 'Oil & Spices',
    icon: '🌻',
    keywords: [
      'oil', 'mustard', 'fortune', 'refined', 'kachi ghani', 'tel', 'masala',
      'haldi', 'turmeric', 'mirch', 'jeera', 'dhaniya', 'garam masala', 'hing', 'methi',
    ],
    active: true,
  },
  {
    id: 'SNACKS',
    name: 'Snacks & Drinks',
    icon: '🍪',
    keywords: [
      'biscuit', 'cookie', 'chips', 'kurkure', 'lays', 'namkeen', 'bhujia',
      'maggi', 'noodle', 'pasta', 'tea', 'chai', 'coffee', 'juice', 'coke',
      'pepsi', 'cold drink', 'frooti', 'chocolate', 'snack',
    ],
    active: true,
  },
  {
    id: 'CLEANING',
    name: 'Cleaning & Care',
    icon: '🧼',
    keywords: [
      'soap', 'surf', 'detergent', 'shampoo', 'paste', 'colgate', 'brush',
      'harpic', 'vim', 'rin', 'ariel', 'tide', 'cleaner', 'wash', 'handwash',
      'agarbatti', 'dettol',
    ],
    active: true,
  },
];

export function sanitizeText(str: string | undefined | null): string {
  return String(str || '').replace(/[<>"'`]/g, '');
}

export function isValidIndianMobile(phone: string | undefined | null): boolean {
  return /^[6-9]\d{9}$/.test(String(phone || '').replace(/\D/g, '').slice(-10));
}

export function isValidUpiId(upi: string | undefined | null): boolean {
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(String(upi || '').trim());
}

export function darkenHexColor(hex: string, amount = 0.28): string {
  const clean = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '#075e14';
  const num = parseInt(clean, 16);
  const r = Math.max(0, Math.round(((num >> 16) & 255) * (1 - amount)));
  const g = Math.max(0, Math.round(((num >> 8) & 255) * (1 - amount)));
  const b = Math.max(0, Math.round((num & 255) * (1 - amount)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export function calculateDistanceKm(
  lat1: unknown,
  lon1: unknown,
  lat2: unknown,
  lon2: unknown
): number | null {
  const aLat = Number(lat1);
  const aLon = Number(lon1);
  const bLat = Number(lat2);
  const bLon = Number(lon2);
  if (
    !Number.isFinite(aLat) ||
    !Number.isFinite(aLon) ||
    !Number.isFinite(bLat) ||
    !Number.isFinite(bLon)
  ) {
    return null;
  }
  const R = 6371;
  const dLat = (bLat - aLat) * (Math.PI / 180);
  const dLon = (bLon - aLon) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * (Math.PI / 180)) *
      Math.cos(bLat * (Math.PI / 180)) *
      Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

export const DEFAULT_NEARBY_RADIUS_KM = 5;

export function getStoreDistanceKm(
  store: Pick<Store, 'lat' | 'lng'> | undefined | null,
  customerLat: unknown,
  customerLng: unknown
): number | null {
  if (!store) return null;
  return calculateDistanceKm(customerLat, customerLng, store.lat, store.lng);
}

export function isStoreWithinRadius(
  distanceKm: number | null | undefined,
  radiusKm = DEFAULT_NEARBY_RADIUS_KM
): boolean {
  const safeRadius =
    Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : DEFAULT_NEARBY_RADIUS_KM;
  return (
    typeof distanceKm === 'number' &&
    Number.isFinite(distanceKm) &&
    distanceKm <= safeRadius
  );
}

export function formatDistanceKmLabel(distanceKm: number | null | undefined): string {
  if (typeof distanceKm !== 'number' || !Number.isFinite(distanceKm) || distanceKm < 0) {
    return '';
  }
  if (distanceKm < 1) {
    const meters = Math.max(50, Math.round((distanceKm * 1000) / 50) * 50);
    return `${meters} m`;
  }
  return `${distanceKm.toFixed(1)} km`;
}

export function sortStoresByProximity(
  storesList: Array<[string, Store]>,
  customerLat: unknown,
  customerLng: unknown,
  options?: {
    radiusKm?: number;
    prioritizeNearby?: boolean;
  }
): Array<[string, Store]> {
  const safeRadius =
    Number.isFinite(options?.radiusKm) && Number(options?.radiusKm) > 0
      ? Number(options?.radiusKm)
      : DEFAULT_NEARBY_RADIUS_KM;
  if (options?.prioritizeNearby === false) {
    return [...storesList];
  }
  const hasCustomerCoords =
    customerLat !== null &&
    customerLat !== undefined &&
    customerLng !== null &&
    customerLng !== undefined &&
    Number.isFinite(Number(customerLat)) &&
    Number.isFinite(Number(customerLng));

  if (!hasCustomerCoords) {
    return [...storesList].sort(([, a], [, b]) => {
      const aOpen = a.isOpen !== false ? 0 : 1;
      const bOpen = b.isOpen !== false ? 0 : 1;
      return aOpen - bOpen;
    });
  }

  return storesList
    .map((entry, idx) => {
      const dist = getStoreDistanceKm(entry[1], customerLat, customerLng);
      const isOpen = entry[1].isOpen !== false;
      const within = isStoreWithinRadius(dist, safeRadius);
      // Tier order ensures all stores within nearbyRadiusKm (5km) appear strictly first
      let tier = 5;
      if (within && isOpen) tier = 0;
      else if (within && !isOpen) tier = 1;
      else if (dist !== null && isOpen) tier = 2;
      else if (dist === null && isOpen) tier = 3;
      else if (dist !== null && !isOpen) tier = 4;
      return { entry, idx, dist, tier };
    })
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.dist !== null && b.dist !== null && a.dist !== b.dist) {
        return a.dist - b.dist;
      }
      return a.idx - b.idx;
    })
    .map((x) => x.entry);
}

export function sortProductsByProximity(
  products: MenuItem[],
  stores: Record<string, Store>,
  customerLat: unknown,
  customerLng: unknown,
  options?: {
    radiusKm?: number;
    prioritizeNearby?: boolean;
    searchQuery?: string;
  }
): MenuItem[] {
  const safeRadius =
    Number.isFinite(options?.radiusKm) && Number(options?.radiusKm) > 0
      ? Number(options?.radiusKm)
      : DEFAULT_NEARBY_RADIUS_KM;
  const cleanQuery = String(options?.searchQuery || '').trim().toLowerCase();
  const hasCustomerCoords =
    customerLat !== null &&
    customerLat !== undefined &&
    customerLng !== null &&
    customerLng !== undefined &&
    Number.isFinite(Number(customerLat)) &&
    Number.isFinite(Number(customerLng));

  const enriched = products.map((item, idx) => {
    const store = stores[item.storeId];
    const dist = hasCustomerCoords
      ? getStoreDistanceKm(store, customerLat, customerLng)
      : null;
    const within = isStoreWithinRadius(dist, safeRadius);
    const annotated: MenuItem = {
      ...item,
      distanceKm: dist,
      isWithinNearbyRadius: within,
    };

    const lowerName = (item.name || '').toLowerCase();
    let queryMatchRank = 2;
    if (cleanQuery) {
      if (lowerName.startsWith(cleanQuery)) queryMatchRank = 0;
      else if (lowerName.includes(cleanQuery)) queryMatchRank = 1;
    }

    const tier = within ? 0 : dist !== null ? 1 : 2;
    return { annotated, idx, dist, tier, queryMatchRank };
  });

  if (options?.prioritizeNearby === false || !hasCustomerCoords) {
    return enriched.map((e) => e.annotated);
  }

  return enriched
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier;
      if (a.dist !== null && b.dist !== null && Math.abs(a.dist - b.dist) > 0.001) {
        return a.dist - b.dist;
      }
      if (cleanQuery && a.queryMatchRank !== b.queryMatchRank) {
        return a.queryMatchRank - b.queryMatchRank;
      }
      const rateDiff = Number(b.annotated.ratingAvg || 0) - Number(a.annotated.ratingAvg || 0);
      if (rateDiff !== 0) return rateDiff;
      return a.idx - b.idx;
    })
    .map((x) => x.annotated);
}

export function matchesKeywordSearch(
  item: Pick<MenuItem, 'name' | 'description' | 'searchKeywords' | 'category'>,
  storeName: string,
  query: string
): boolean {
  if (!query) return true;
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${item.name || ''} ${item.description || ''} ${item.searchKeywords || ''} ${item.category || ''} ${storeName || ''}`.toLowerCase();
  return tokens.every((tk) => haystack.includes(tk));
}

export function doesItemMatchCategory(
  item: MenuItem,
  categoryId: string,
  categories: CategoryDef[],
  favorites: Record<string, boolean> | undefined
): boolean {
  if (categoryId === 'ALL' || categoryId === 'ALL_STORES') return true;
  if (categoryId === 'ON_SALE') {
    return Boolean(
      item.isOnSale ||
        (item.mrp && Number(item.mrp) > Number(item.price || 0)) ||
        Number(item.discountPercent || 0) > 0
    );
  }
  if (categoryId === 'FAVORITES') {
    return Boolean(favorites && favorites[`${item.storeId}___${item.itemId}`]);
  }
  if (item.category) {
    const itemCat = String(item.category).toUpperCase();
    if (itemCat === categoryId) return true;
    const catObj = categories.find((c) => c.id === categoryId);
    if (
      catObj &&
      (itemCat.includes(catObj.id) || itemCat.includes(catObj.name.toUpperCase()))
    ) {
      return true;
    }
  }
  const catObj = categories.find((c) => c.id === categoryId);
  if (!catObj || !Array.isArray(catObj.keywords) || catObj.keywords.length === 0) {
    return false;
  }
  const searchableText = `${item.name || ''} ${item.description || ''} ${item.searchKeywords || ''}`.toLowerCase();
  return catObj.keywords.some((kw) => searchableText.includes(String(kw).toLowerCase()));
}

export interface StoreFilterOption {
  id: string;
  label: string;
  count: number;
}

function tokenizeStoreTags(store: Store): string[] {
  const tags: string[] = [];
  const rawSources = [store.category, store.cuisine].filter(
    (v): v is string => typeof v === 'string' && v.trim().length > 0
  );

  rawSources.forEach((source) => {
    source
      .split(/[,&/|•]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2 && part.length <= 28)
      .forEach((part) => tags.push(part));
  });

  return tags;
}

function doesStoreMatchTag(
  storeId: string,
  store: Store,
  normalizedTag: string,
  allMenus: Record<string, Record<string, Omit<MenuItem, 'itemId' | 'storeId'>>>,
  categories: CategoryDef[]
): boolean {
  const explicitTags = tokenizeStoreTags(store).map((t) => t.toLowerCase());
  if (explicitTags.includes(normalizedTag)) return true;

  const cuisineAndCatText = `${store.category || ''} ${store.cuisine || ''}`.toLowerCase();
  if (cuisineAndCatText.includes(normalizedTag)) return true;

  const storeMenu = allMenus[storeId] || {};
  return Object.entries(storeMenu).some(([itemId, item]) => {
    if (item.available === false || item.adminApproved !== true) return false;
    const itemCat = String(item.category || '').trim().toLowerCase();
    if (itemCat && itemCat === normalizedTag) return true;
    const matchingCat = categories.find(
      (c) =>
        c.id.toLowerCase() === normalizedTag ||
        c.name.toLowerCase() === normalizedTag
    );
    if (matchingCat) {
      return doesItemMatchCategory(
        { ...item, itemId, storeId },
        matchingCat.id,
        categories,
        undefined
      );
    }
    const itemText = `${item.name || ''} ${item.description || ''} ${item.searchKeywords || ''}`.toLowerCase();
    return itemText.includes(normalizedTag);
  });
}

export function extractStoreFilterOptions(
  approvedStores: Array<[string, Store]>,
  allMenus: Record<string, Record<string, Omit<MenuItem, 'itemId' | 'storeId'>>>,
  categories: CategoryDef[] = DEFAULT_CATEGORIES,
  favoriteStores?: Record<string, boolean>
): StoreFilterOption[] {
  const labelMap = new Map<string, string>();

  approvedStores.forEach(([, store]) => {
    tokenizeStoreTags(store).forEach((tag) => {
      const key = tag.toLowerCase();
      if (!labelMap.has(key)) {
        labelMap.set(key, tag);
      }
    });
  });

  if (labelMap.size === 0 && approvedStores.length > 0) {
    categories
      .filter((c) => !['ALL', 'ALL_STORES', 'ON_SALE', 'FAVORITES'].includes(c.id))
      .forEach((cat) => {
        const hasAnyStore = approvedStores.some(([storeId]) =>
          Object.entries(allMenus[storeId] || {}).some(
            ([itemId, item]) =>
              item.available !== false &&
              item.adminApproved === true &&
              doesItemMatchCategory(
                { ...item, itemId, storeId },
                cat.id,
                categories,
                undefined
              )
          )
        );
        if (hasAnyStore) {
          labelMap.set(cat.name.toLowerCase(), cat.name);
        }
      });
  }

  const options: StoreFilterOption[] = [
    { id: 'ALL', label: 'All Stores', count: approvedStores.length },
  ];

  if (favoriteStores) {
    const favCount = approvedStores.filter(([storeId]) =>
      Boolean(favoriteStores[storeId])
    ).length;
    if (favCount > 0) {
      options.push({ id: 'FAV_STORES', label: '❤️ Favourites', count: favCount });
    }
  }

  labelMap.forEach((label, normalizedKey) => {
    const count = approvedStores.filter(([storeId, store]) =>
      doesStoreMatchTag(storeId, store, normalizedKey, allMenus, categories)
    ).length;
    if (count > 0) {
      options.push({ id: normalizedKey, label, count });
    }
  });

  return options;
}

export function filterStoresByCategoryOrCuisine(
  approvedStores: Array<[string, Store]>,
  selectedFilter: string,
  allMenus: Record<string, Record<string, Omit<MenuItem, 'itemId' | 'storeId'>>>,
  categories: CategoryDef[] = DEFAULT_CATEGORIES,
  favoriteStores?: Record<string, boolean>
): Array<[string, Store]> {
  const clean = String(selectedFilter || '').trim().toLowerCase();
  if (!clean || clean === 'all') return approvedStores;
  if (clean === 'fav_stores') {
    return approvedStores.filter(([storeId]) => Boolean(favoriteStores?.[storeId]));
  }
  return approvedStores.filter(([storeId, store]) =>
    doesStoreMatchTag(storeId, store, clean, allMenus, categories)
  );
}

export function filterStoresByQuery(
  storesList: Array<[string, Store]>,
  query: string
): Array<[string, Store]> {
  const cleanQuery = String(query || '').trim().toLowerCase();
  if (!cleanQuery) return storesList;

  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return storesList;

  return storesList.filter(([, store]) => {
    const haystack = `${store.name || ''} ${store.cuisine || ''} ${store.category || ''}`.toLowerCase();
    return tokens.every((tk) => haystack.includes(tk));
  });
}

export function getStoreMostPopularItem(
  storeId: string,
  allMenus: Record<string, Record<string, Omit<MenuItem, 'itemId' | 'storeId'>>>,
  store?: Pick<Store, 'name' | 'approved' | 'suspended' | 'isOpen'>
): MenuItem | null {
  if (
    store &&
    (store.isOpen === false || store.approved === false || store.suspended === true)
  ) {
    return null;
  }

  const storeMenu = allMenus[storeId];
  if (!storeMenu || typeof storeMenu !== 'object') return null;

  const candidates: MenuItem[] = Object.entries(storeMenu)
    .filter(([, item]) => item && item.available !== false && item.adminApproved === true)
    .map(([itemId, item]) => ({
      ...item,
      itemId,
      storeId,
      storeName: store?.name || item.storeName,
    }));

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const countA = Number(a.ratingCount || 0);
    const countB = Number(b.ratingCount || 0);
    if (countB !== countA) return countB - countA;

    const avgA = Number(a.ratingAvg || 0);
    const avgB = Number(b.ratingAvg || 0);
    if (avgB !== avgA) return avgB - avgA;

    const saleA = a.isOnSale ? 1 : 0;
    const saleB = b.isOnSale ? 1 : 0;
    if (saleB !== saleA) return saleB - saleA;

    return a.itemId.localeCompare(b.itemId);
  });

  return candidates[0];
}

export interface StoreBasketGroup {
  storeId: string;
  storeName: string;
  items: CartItem[];
  subtotal: number;
  isClosed: boolean;
}

export function groupCartByStore(
  items: CartItem[],
  stores: Record<string, Store>
): StoreBasketGroup[] {
  const map: Record<string, StoreBasketGroup> = {};
  items.forEach((item) => {
    const sId = item.storeId || 'general';
    if (!map[sId]) {
      const st = stores[sId];
      const isClosed =
        !st || st.isOpen === false || st.approved !== true || st.suspended === true;
      map[sId] = {
        storeId: sId,
        storeName: item.storeName || st?.name || 'Grocery Store',
        items: [],
        subtotal: 0,
        isClosed,
      };
    }
    map[sId].items.push(item);
    map[sId].subtotal += item.price * item.qty;
  });
  return Object.values(map);
}

export function calculateStoreDiscounts(
  groupedByStore: StoreBasketGroup[],
  stores: Record<string, Store>
): number {
  let totalStoreDiscount = 0;
  groupedByStore.forEach((grp) => {
    const st = stores[grp.storeId];
    if (!st) return;
    const pct = Number(st.storeDiscountPercent || 0);
    const minOrd = Number(st.storeDiscountMinOrder || 0);
    if (pct > 0 && grp.subtotal >= minOrd) {
      totalStoreDiscount += Math.round((grp.subtotal * pct) / 100);
    }
  });
  return totalStoreDiscount;
}

export function isChutkiPlusActive(
  profile?: Pick<CustomerProfile, 'plusActiveUntil'> | null,
  nowMs = Date.now()
): boolean {
  const until = Number(profile?.plusActiveUntil || 0);
  return Number.isFinite(until) && until > nowMs;
}

export interface ProductStockInfo {
  count: number | null;
  isOutOfStock: boolean;
  isLowStock: boolean;
  label: string;
}

export function getProductStockInfo(
  item?: Pick<MenuItem, 'stockCount' | 'available'> | null
): ProductStockInfo {
  if (!item || item.available === false) {
    return {
      count: 0,
      isOutOfStock: true,
      isLowStock: false,
      label: 'Out of Stock',
    };
  }
  const hasExplicit =
    item.stockCount !== undefined &&
    item.stockCount !== null &&
    Number.isFinite(Number(item.stockCount));
  if (!hasExplicit) {
    return {
      count: null,
      isOutOfStock: false,
      isLowStock: false,
      label: 'In Stock',
    };
  }
  const count = Math.max(0, Math.floor(Number(item.stockCount)));
  if (count <= 0) {
    return {
      count: 0,
      isOutOfStock: true,
      isLowStock: false,
      label: 'Out of Stock',
    };
  }
  if (count <= 5) {
    return {
      count,
      isOutOfStock: false,
      isLowStock: true,
      label: `Only ${count} left`,
    };
  }
  return {
    count,
    isOutOfStock: false,
    isLowStock: false,
    label: `${count} in stock`,
  };
}

export interface DeliverySlotOption {
  id: string;
  label: string;
  shortLabel: string;
  isExpress: boolean;
}

export function getAvailableDeliverySlots(
  now = new Date(),
  options?: { allowScheduled?: boolean; customSlots?: string[] }
): DeliverySlotOption[] {
  const slots: DeliverySlotOption[] = [
    {
      id: 'EXPRESS_15',
      label: '⚡ Express (15 Mins)',
      shortLabel: '⚡ Express 15m',
      isExpress: true,
    },
  ];

  if (options?.allowScheduled === false) {
    return slots;
  }

  const customList = Array.isArray(options?.customSlots)
    ? options.customSlots
        .map((s) => sanitizeText(String(s || '')).slice(0, 48).trim())
        .filter(Boolean)
    : [];

  if (customList.length > 0) {
    customList.slice(0, 5).forEach((label) => {
      slots.push({
        id: label,
        label: `📅 ${label}`,
        shortLabel: label.length > 18 ? `${label.slice(0, 17)}…` : label,
        isExpress: false,
      });
    });
    return slots;
  }

  const hour = now.getHours();
  const todayCandidates = [
    { minHour: 11, id: 'Today 11 AM - 12 PM', label: 'Today, 11 AM – 12 PM', short: 'Today 11-12' },
    { minHour: 16, id: 'Today 4 PM - 5 PM', label: 'Today, 4 PM – 5 PM', short: 'Today 4-5 PM' },
    { minHour: 19, id: 'Today 7 PM - 8 PM', label: 'Today, 7 PM – 8 PM', short: 'Today 7-8 PM' },
  ];

  todayCandidates.forEach((slot) => {
    if (hour < slot.minHour) {
      slots.push({
        id: slot.id,
        label: `📅 ${slot.label}`,
        shortLabel: slot.short,
        isExpress: false,
      });
    }
  });

  slots.push(
    {
      id: 'Tomorrow 8 AM - 9 AM',
      label: '📅 Tomorrow, 8 AM – 9 AM',
      shortLabel: 'Tmrw 8-9 AM',
      isExpress: false,
    },
    {
      id: 'Tomorrow 11 AM - 12 PM',
      label: '📅 Tomorrow, 11 AM – 12 PM',
      shortLabel: 'Tmrw 11-12',
      isExpress: false,
    }
  );

  return slots.slice(0, 5);
}

export function calculateOrderCashback(
  eligibleAmount: number,
  paymentMode: string,
  cashbackPercent = 5
): number {
  const mode = String(paymentMode || '').trim().toUpperCase();
  if (mode !== 'UPI' && mode !== 'CARD' && mode !== 'WALLET') {
    return 0;
  }
  const cleanAmount = Math.max(0, Number(eligibleAmount || 0));
  const cleanPct = Math.max(0, Number(cashbackPercent || 0));
  if (cleanAmount <= 0 || cleanPct <= 0) return 0;
  return Math.round((cleanAmount * cleanPct) / 100);
}

export interface CheckoutSummary {
  subtotal: number;
  deliveryCharge: number;
  handlingFee: number;
  riderTip: number;
  storeDiscount: number;
  couponDiscount: number;
  netPayable: number;
  isPlusFreeDelivery: boolean;
  cashbackEarned: number;
  freeDeliveryProgressPercent: number;
  freeDeliveryRemaining: number;
}

export function calculateCheckoutSummary(params: {
  items: CartItem[];
  stores: Record<string, Store>;
  baseDeliveryCharge: number;
  freeDeliveryMinOrder: number;
  handlingFee: number;
  appliedDiscount: number;
  riderTip?: number;
  isPlusActive?: boolean;
  paymentMode?: string;
  allowCashback?: boolean;
  cashbackPercent?: number;
}): CheckoutSummary {
  const grouped = groupCartByStore(params.items, params.stores);
  const subtotal = params.items.reduce((acc, curr) => acc + curr.price * curr.qty, 0);
  const storeDiscount = calculateStoreDiscounts(grouped, params.stores);
  const isPlusFreeDelivery = Boolean(params.isPlusActive);
  const deliveryCharge =
    isPlusFreeDelivery || subtotal >= params.freeDeliveryMinOrder
      ? 0
      : params.baseDeliveryCharge;
  const activeHandling = params.handlingFee > 0 ? params.handlingFee : 0;
  const riderTip = Math.max(0, Math.round(Number(params.riderTip || 0)));
  const netPayable = Math.max(
    1,
    subtotal +
      deliveryCharge +
      activeHandling +
      riderTip -
      storeDiscount -
      params.appliedDiscount
  );
  const cashbackEligible = Math.max(
    0,
    subtotal - storeDiscount - params.appliedDiscount
  );
  const cashbackEarned =
    params.allowCashback === false
      ? 0
      : calculateOrderCashback(
          cashbackEligible,
          params.paymentMode || 'COD',
          params.cashbackPercent ?? 5
        );
  const freeDeliveryProgressPercent = isPlusFreeDelivery
    ? 100
    : Math.min(100, (subtotal / (params.freeDeliveryMinOrder || 1)) * 100);
  const freeDeliveryRemaining = isPlusFreeDelivery
    ? 0
    : Math.max(0, params.freeDeliveryMinOrder - subtotal);

  return {
    subtotal,
    deliveryCharge,
    handlingFee: activeHandling,
    riderTip,
    storeDiscount,
    couponDiscount: params.appliedDiscount,
    netPayable,
    isPlusFreeDelivery,
    cashbackEarned,
    freeDeliveryProgressPercent,
    freeDeliveryRemaining,
  };
}

export function findNearestAvailableRider(
  deliveryPartners: Record<string, DeliveryPartner>,
  storeLat?: number,
  storeLng?: number
): string | null {
  const sLat = Number(storeLat) || 26.4524;
  const sLng = Number(storeLng) || 89.9723;
  const onlineApprovedRiders = Object.entries(deliveryPartners).filter(
    ([_, r]) => r.approved === true && r.online === true && r.suspended !== true
  );
  if (onlineApprovedRiders.length === 0) return null;

  let nearestRiderUid: string | null = null;
  let minDistance = Infinity;
  let fallbackRiderUid: string | null = null;

  onlineApprovedRiders.forEach(([uid, rider]) => {
    const rLat = Number(rider.lat);
    const rLng = Number(rider.lng);
    if (Number.isFinite(rLat) && Number.isFinite(rLng) && rLat !== 0 && rLng !== 0) {
      const dist = calculateDistanceKm(sLat, sLng, rLat, rLng);
      if (dist !== null && dist < minDistance) {
        minDistance = dist;
        nearestRiderUid = uid;
      }
    } else if (!fallbackRiderUid) {
      fallbackRiderUid = uid;
    }
  });

  return nearestRiderUid || fallbackRiderUid;
}

export interface SpamEvaluationResult {
  block: boolean;
  reason?: string;
  isSpamSuspect: boolean;
  spamReason: string;
}

export function evaluateSpamRisk(
  orders: Record<string, Omit<OrderRecord, 'orderId'> | OrderRecord>,
  totalAmount: number,
  paymentMode: string,
  now = Date.now()
): SpamEvaluationResult {
  const myOrdersList = Object.values(orders);
  const ordersLast5Min = myOrdersList.filter(
    (o) => now - (o.createdAt || 0) <= 5 * 60 * 1000
  );
  const cancelsLast24h = myOrdersList.filter(
    (o) => o.status === 'CANCELLED' && now - (o.createdAt || 0) <= 24 * 3600 * 1000
  );
  const deliveredCount = myOrdersList.filter((o) => o.status === 'DELIVERED').length;

  if (ordersLast5Min.length >= 5) {
    return {
      block: true,
      reason: '🚨 Too many orders in 5 minutes. Spam cooldown active—try again shortly.',
      isSpamSuspect: true,
      spamReason: 'Rapid order burst (5+ in 5m)',
    };
  }

  const duplicate90s = ordersLast5Min.find(
    (o) =>
      now - (o.createdAt || 0) <= 90 * 1000 &&
      Math.abs(Number(o.totalAmount || 0) - totalAmount) < 1
  );
  if (duplicate90s) {
    return {
      block: true,
      reason: '⚠️ Duplicate identical order detected within 90 seconds!',
      isSpamSuspect: true,
      spamReason: 'Duplicate identical order within 90s',
    };
  }

  const flags: string[] = [];
  if (ordersLast5Min.length >= 3) flags.push('Rapid order burst (3+ in 5m)');
  if (cancelsLast24h.length >= 3) flags.push('High 24h cancellation rate (3+)');
  if (paymentMode === 'COD' && totalAmount >= 8000 && deliveredCount === 0) {
    flags.push('High-value COD by unverified buyer');
  }

  return {
    block: false,
    isSpamSuspect: flags.length > 0,
    spamReason: flags.join(' | '),
  };
}

function extractOrderStatusTimestamps(
  o: Omit<OrderRecord, 'orderId'> | OrderRecord
): Record<string, number> {
  const result: Record<string, number> = {};
  const setMin = (key: string, ts: unknown) => {
    const num = Number(ts);
    if (!Number.isFinite(num) || num <= 0) return;
    if (!result[key] || num < result[key]) {
      result[key] = num;
    }
  };

  if (o.statusTimestamps && typeof o.statusTimestamps === 'object') {
    Object.entries(o.statusTimestamps).forEach(([k, v]) => {
      setMin(normalizeOrderStatus(k), v);
    });
  }

  setMin('PLACED', o.placedAt || o.createdAt);
  setMin('ACCEPTED', o.acceptedAt);
  setMin('PREPARING', o.preparingAt);
  setMin('PACKING', o.packingAt);
  setMin('READY_FOR_PICKUP', o.readyAt);
  setMin('OUT_FOR_DELIVERY', o.outForDeliveryAt);
  setMin('DELIVERED', o.deliveredAt);
  setMin('CANCELLED', o.cancelledAt);

  const curStatus = normalizeOrderStatus(o.status);
  if (o.updatedAt && !result[curStatus]) {
    setMin(curStatus, o.updatedAt);
  }
  if (curStatus === 'PLACED' && !result.PLACED && o.createdAt) {
    setMin('PLACED', o.createdAt);
  }

  return result;
}

export function groupCustomerOrders(
  cachedOrders: Record<string, Omit<OrderRecord, 'orderId'> | OrderRecord>
): GroupedOrder[] {
  const groups: Record<string, GroupedOrder> = {};
  Object.entries(cachedOrders).forEach(([orderId, o]) => {
    const groupKey =
      o.batchGroupId || (o.deliveryOtp ? `${o.customerUid}_${o.deliveryOtp}` : orderId);
    const orderTs = Number(o.placedAt || o.createdAt || Date.now());
    const extractedTs = extractOrderStatusTimestamps(o);
    if (!groups[groupKey]) {
      groups[groupKey] = {
        groupKey,
        orders: [],
        placedAt: orderTs,
        statusTimestamps: {},
        createdAt: o.createdAt || orderTs,
        deliveryOtp: o.deliveryOtp || '',
        deliveryQrToken: o.deliveryQrToken || '',
        paymentMode: o.paymentMode || 'COD',
        phone: o.phone || '',
        address: o.address || '',
        totalAmount: 0,
        riderTip: 0,
        deliverySlot: o.deliverySlot || '',
        refundStatus: o.refundStatus && o.refundStatus !== 'NONE' ? o.refundStatus : undefined,
        deliveryUid: o.deliveryUid || null,
        riderLat: o.riderLat || null,
        riderLng: o.riderLng || null,
        customerLat: o.customerLat || null,
        customerLng: o.customerLng || null,
        locationLink: o.locationLink || '',
        emergencyAlert: false,
        emergencyDetails: '',
      };
    }
    if (orderTs > 0 && orderTs < (groups[groupKey].placedAt ?? groups[groupKey].createdAt)) {
      groups[groupKey].placedAt = orderTs;
    }
    const groupTsMap = groups[groupKey].statusTimestamps || {};
    Object.entries(extractedTs).forEach(([k, v]) => {
      if (!groupTsMap[k] || v < groupTsMap[k]) {
        groupTsMap[k] = v;
      }
    });
    groups[groupKey].statusTimestamps = groupTsMap;
    groups[groupKey].orders.push({ ...o, orderId, placedAt: orderTs, statusTimestamps: extractedTs });
    groups[groupKey].totalAmount += Number(o.totalAmount || 0);
    groups[groupKey].riderTip = Number(groups[groupKey].riderTip || 0) + Number(o.riderTip || 0);
    if (!groups[groupKey].deliverySlot && o.deliverySlot) {
      groups[groupKey].deliverySlot = o.deliverySlot;
    }
    if (!groups[groupKey].deliveryQrToken && o.deliveryQrToken) {
      groups[groupKey].deliveryQrToken = o.deliveryQrToken;
    }
    if (o.refundStatus && o.refundStatus !== 'NONE' && !groups[groupKey].refundStatus) {
      groups[groupKey].refundStatus = o.refundStatus;
    }
    if (o.deliveryUid) groups[groupKey].deliveryUid = o.deliveryUid;
    if (o.riderLat) groups[groupKey].riderLat = o.riderLat;
    if (o.riderLng) groups[groupKey].riderLng = o.riderLng;
    if (o.emergencyAlert) {
      groups[groupKey].emergencyAlert = true;
      groups[groupKey].emergencyDetails = o.emergencyDetails || '';
    }
  });
  return Object.values(groups).sort((a, b) => b.createdAt - a.createdAt);
}

export interface DerivedGroupStatus {
  status: string;
  stepProgressWidth: string;
  s2: boolean;
  s3: boolean;
  s4: boolean;
  isAllDelivered: boolean;
  isAllCancelled: boolean;
}

export function normalizeOrderStatus(status?: string): string {
  const clean = String(status || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return clean || 'PLACED';
}

export function deriveGroupOrderStatus(group: GroupedOrder): DerivedGroupStatus {
  const normalizedStatuses = group.orders.map((o) => normalizeOrderStatus(o.status));
  const isAllDelivered = normalizedStatuses.every((s) => s === 'DELIVERED');
  const isAllCancelled = normalizedStatuses.every((s) => s === 'CANCELLED');
  const isAnyOut = normalizedStatuses.some((s) => s === 'OUT_FOR_DELIVERY');
  const isAnyReady = normalizedStatuses.some(
    (s) => s === 'READY_FOR_PICKUP' || s === 'PICKED_UP'
  );
  const isAnyPacking = normalizedStatuses.some((s) => s === 'PACKING');
  const isAnyPreparing = normalizedStatuses.some((s) => s === 'PREPARING');
  const isAnyAccepted = normalizedStatuses.some((s) => s === 'ACCEPTED');

  let status = 'PLACED';
  let stepProgressWidth = '12%';
  let s2 = false;
  let s3 = false;
  let s4 = false;

  if (isAllDelivered) {
    status = 'DELIVERED';
    stepProgressWidth = '100%';
    s2 = s3 = s4 = true;
  } else if (isAllCancelled) {
    status = 'CANCELLED';
  } else if (isAnyOut) {
    status = 'OUT_FOR_DELIVERY';
    stepProgressWidth = '70%';
    s2 = s3 = true;
  } else if (isAnyReady) {
    status = 'READY_FOR_PICKUP';
    stepProgressWidth = '70%';
    s2 = s3 = true;
  } else if (isAnyPacking) {
    status = 'PACKING';
    stepProgressWidth = '40%';
    s2 = true;
  } else if (isAnyPreparing) {
    status = 'PREPARING';
    stepProgressWidth = '40%';
    s2 = true;
  } else if (isAnyAccepted) {
    status = 'ACCEPTED';
    stepProgressWidth = '40%';
    s2 = true;
  }

  return {
    status,
    stepProgressWidth,
    s2,
    s3,
    s4,
    isAllDelivered,
    isAllCancelled,
  };
}

export const DELIVERY_PROMISE_MS = 15 * 60 * 1000;

export interface DeliveryCountdownState {
  remainingMs: number;
  formattedRemaining: string;
  progressPercent: number;
  isOverdue: boolean;
  isFinalStretch: boolean;
  label: string;
}

export function computeDeliveryCountdown(
  placedAtMs: number | undefined,
  nowMs = Date.now(),
  promiseMs = DELIVERY_PROMISE_MS
): DeliveryCountdownState {
  const safePromise = Number.isFinite(promiseMs) && promiseMs > 0 ? promiseMs : DELIVERY_PROMISE_MS;
  const validPlacedAt = Number(placedAtMs);
  if (!Number.isFinite(validPlacedAt) || validPlacedAt <= 0) {
    const totalSecs = Math.ceil(safePromise / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return {
      remainingMs: safePromise,
      formattedRemaining: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
      progressPercent: 0,
      isOverdue: false,
      isFinalStretch: false,
      label: '15-min delivery promise',
    };
  }

  const elapsedMs = Math.max(0, nowMs - validPlacedAt);
  const rawRemainingMs = safePromise - elapsedMs;

  if (rawRemainingMs <= 0) {
    return {
      remainingMs: 0,
      formattedRemaining: '00:00',
      progressPercent: 100,
      isOverdue: true,
      isFinalStretch: true,
      label: 'Arriving any moment',
    };
  }

  const totalSecs = Math.ceil(rawRemainingMs / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  const formattedRemaining = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const progressPercent = Math.min(
    100,
    Math.max(0, Math.round((elapsedMs / safePromise) * 100))
  );
  const isFinalStretch = totalSecs <= 180;

  return {
    remainingMs: rawRemainingMs,
    formattedRemaining,
    progressPercent,
    isOverdue: false,
    isFinalStretch,
    label: isFinalStretch ? 'Arriving shortly' : '15-min delivery promise',
  };
}

export type OrderTimelineStageKey =
  | 'PLACED'
  | 'PREPARING'
  | 'PACKING'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED';

export interface OrderTimelineStep {
  key: OrderTimelineStageKey;
  label: string;
  detail: string;
  icon: string;
  state: 'completed' | 'current' | 'pending';
  timestamp: number | null;
  formattedTime: string;
}

export function formatOrderTimelineTime(ts: number | null | undefined): string {
  if (!ts || !Number.isFinite(ts) || ts <= 0) return '';
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function buildOrderStatusTimeline(
  group: GroupedOrder,
  observedTimestamps?: Record<string, number>
): OrderTimelineStep[] {
  const derived = deriveGroupOrderStatus(group);
  const currentStatus = normalizeOrderStatus(derived.status);

  const mergedTs: Record<string, number> = {
    ...(observedTimestamps || {}),
    ...(group.statusTimestamps || {}),
  };

  if (!mergedTs.PLACED && (group.placedAt || group.createdAt)) {
    mergedTs.PLACED = Number(group.placedAt || group.createdAt);
  }

  const defs: Array<{
    key: OrderTimelineStageKey;
    label: string;
    detailActive: string;
    detailDone: string;
    detailPending: string;
    icon: string;
  }> = [
    {
      key: 'PLACED',
      label: 'Order Placed',
      detailActive: 'Waiting for partner store confirmation',
      detailDone: 'Order confirmed & received',
      detailPending: 'Order placement',
      icon: 'fa-receipt',
    },
    {
      key: 'PREPARING',
      label: 'Preparing',
      detailActive: 'Partner store is picking fresh items',
      detailDone: 'Items freshly prepared & verified',
      detailPending: 'Store preparation',
      icon: 'fa-fire-burner',
    },
    {
      key: 'PACKING',
      label: 'Packing',
      detailActive: 'Sealing basket securely for dispatch',
      detailDone: 'Packed & ready for rider handoff',
      detailPending: 'Basket packing',
      icon: 'fa-box-open',
    },
    {
      key: 'OUT_FOR_DELIVERY',
      label: 'Out for Delivery',
      detailActive: 'Delivery rider is heading to your doorstep',
      detailDone: 'Dispatched with delivery partner',
      detailPending: 'Rider dispatch',
      icon: 'fa-motorcycle',
    },
    {
      key: 'DELIVERED',
      label: 'Delivered',
      detailActive: 'Order handed over safely',
      detailDone: 'Delivered safely at doorstep',
      detailPending: 'Doorstep handoff',
      icon: 'fa-house-chimney',
    },
  ];

  const rankByStatus: Record<string, number> = {
    PLACED: 0,
    ACCEPTED: 0,
    PREPARING: 1,
    PACKING: 2,
    READY_FOR_PICKUP: 2,
    PICKED_UP: 3,
    OUT_FOR_DELIVERY: 3,
    DELIVERED: 4,
  };

  const currentIdx = rankByStatus[currentStatus] ?? 0;

  return defs.map((def, idx) => {
    let rawTs: number | null = mergedTs[def.key] || null;
    if (!rawTs && def.key === 'PREPARING' && mergedTs.ACCEPTED) {
      rawTs = mergedTs.ACCEPTED;
    }
    if (!rawTs && def.key === 'PACKING' && mergedTs.READY_FOR_PICKUP) {
      rawTs = mergedTs.READY_FOR_PICKUP;
    }

    let state: 'completed' | 'current' | 'pending' = 'pending';
    if (derived.isAllDelivered || idx < currentIdx) {
      state = 'completed';
    } else if (idx === currentIdx) {
      state = 'current';
    }

    const detail =
      state === 'completed'
        ? def.detailDone
        : state === 'current'
          ? def.detailActive
          : def.detailPending;

    return {
      key: def.key,
      label: def.label,
      detail,
      icon: def.icon,
      state,
      timestamp: rawTs,
      formattedTime: rawTs
        ? formatOrderTimelineTime(rawTs)
        : state === 'pending'
          ? 'Pending'
          : 'Updated',
    };
  });
}

export type OrderFilterSegment = 'ACTIVE' | 'DELIVERED' | 'CANCELLED';

export const PAST_ORDER_STATUSES = ['DELIVERED', 'CANCELLED'] as const;

export function getActiveOrderGroups(groupedOrders: GroupedOrder[]): GroupedOrder[] {
  return groupedOrders.filter((group) => {
    const derived = deriveGroupOrderStatus(group);
    if (derived.isAllCancelled) return false;
    if (derived.isAllDelivered) {
      const alreadyRatedRider = group.orders.some((o) => o.riderRating);
      const alreadyReviewedProds = group.orders.some((o) => o.productsReviewed);
      const needsRiderRating = Boolean(group.deliveryUid && !alreadyRatedRider);
      const needsProductReview = !alreadyReviewedProds;
      return needsRiderRating || needsProductReview;
    }
    return true;
  });
}

export function getPastOrdersFromCache(
  cachedOrders: Record<string, Omit<OrderRecord, 'orderId'> | OrderRecord>,
  statusFilter: 'DELIVERED' | 'CANCELLED' | 'ALL' = 'ALL'
): OrderRecord[] {
  return Object.entries(cachedOrders)
    .map(([orderId, order]) => ({ ...order, orderId }))
    .filter((order) => {
      const normalized = normalizeOrderStatus(order.status);
      if (statusFilter === 'DELIVERED') return normalized === 'DELIVERED';
      if (statusFilter === 'CANCELLED') return normalized === 'CANCELLED';
      return normalized === 'DELIVERED' || normalized === 'CANCELLED';
    })
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

export function filterPastOrdersByQuery(
  orders: OrderRecord[],
  query: string,
  stores: Record<string, Store>
): OrderRecord[] {
  const cleanQuery = String(query || '').trim().toLowerCase();
  if (!cleanQuery) return orders;

  const tokens = cleanQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return orders;

  return orders.filter((order) => {
    const rawItems = Array.isArray(order.items)
      ? order.items
      : Object.values(order.items || {});
    const resolvedStoreName =
      stores[order.restaurantId]?.name ||
      rawItems[0]?.storeName ||
      'Local Store';
    const itemNames = rawItems
      .map((item) => `${item.name || ''} ${item.storeName || ''}`)
      .join(' ');
    const shortId = order.orderId.slice(-6);
    const haystack = `${resolvedStoreName} ${itemNames} ${order.orderId} #${shortId}`.toLowerCase();
    return tokens.every((tk) => haystack.includes(tk));
  });
}

export interface ReorderResult {
  nextCart: CartItem[];
  addedUnits: number;
  skippedCount: number;
}

export function mergePastOrderIntoCart(
  currentCart: CartItem[],
  order: Pick<OrderRecord, 'restaurantId' | 'items'>,
  stores: Record<string, Store>,
  allMenus: Record<string, Record<string, Omit<MenuItem, 'itemId' | 'storeId'>>>
): ReorderResult {
  const rawItems = Array.isArray(order.items)
    ? order.items
    : Object.values(order.items || {});

  const nextCart = currentCart.map((c) => ({ ...c }));
  let addedUnits = 0;
  let skippedCount = 0;
  const hasKnownStores = Object.keys(stores).length > 0;

  rawItems.forEach((raw) => {
    const qty = Math.max(0, Number(raw.qty || 0));
    const itemId = String(raw.itemId || '');
    const storeId = String(raw.storeId || order.restaurantId || '');
    if (!itemId || !storeId || qty <= 0) {
      skippedCount += 1;
      return;
    }

    const st = stores[storeId];
    if (
      (hasKnownStores && !st) ||
      (st && (st.approved !== true || st.suspended === true || st.isOpen === false))
    ) {
      skippedCount += 1;
      return;
    }

    const liveItem = allMenus[storeId]?.[itemId];
    if (
      liveItem &&
      (liveItem.available === false || liveItem.adminApproved !== true)
    ) {
      skippedCount += 1;
      return;
    }

    const resolvedPrice = liveItem
      ? Number(liveItem.price || 0)
      : Number(raw.price || 0);
    const resolvedName = liveItem?.name || raw.name || 'Grocery Item';
    const resolvedImage = liveItem?.imageUrl || raw.imageUrl || '';
    const resolvedStoreName = st?.name || raw.storeName || 'Grocery Store';

    const idx = nextCart.findIndex(
      (i) => String(i.itemId) === itemId && String(i.storeId) === storeId
    );
    if (idx > -1) {
      nextCart[idx] = {
        ...nextCart[idx],
        qty: nextCart[idx].qty + qty,
        price: resolvedPrice,
        name: resolvedName,
        imageUrl: resolvedImage || nextCart[idx].imageUrl,
        storeName: resolvedStoreName,
      };
    } else {
      nextCart.push({
        itemId,
        name: resolvedName,
        price: resolvedPrice,
        qty,
        imageUrl: resolvedImage,
        storeId,
        storeName: resolvedStoreName,
      });
    }
    addedUnits += qty;
  });

  return { nextCart, addedUnits, skippedCount };
}

export interface SharedCartEntry {
  storeId: string;
  itemId: string;
  qty: number;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(token: string): string {
  const normalized = token.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function encodeCartToShareParam(cartItems: CartItem[]): string {
  if (!Array.isArray(cartItems) || cartItems.length === 0) return '';
  const merged = new Map<string, [string, string, number]>();

  cartItems.forEach((item) => {
    const storeId = sanitizeText(String(item.storeId || '')).trim();
    const itemId = sanitizeText(String(item.itemId || '')).trim();
    const qty = Math.min(99, Math.max(0, Math.floor(Number(item.qty || 0))));
    if (!storeId || !itemId || qty <= 0) return;

    const key = `${storeId}___${itemId}`;
    const existing = merged.get(key);
    if (existing) {
      existing[2] = Math.min(99, existing[2] + qty);
    } else {
      merged.set(key, [storeId, itemId, qty]);
    }
  });

  if (merged.size === 0) return '';
  return toBase64Url(JSON.stringify(Array.from(merged.values())));
}

export function decodeCartFromShareParam(
  token: string | undefined | null
): SharedCartEntry[] {
  const clean = String(token || '').trim();
  if (!clean || clean.length > 4096) return [];

  const safeIdRe = /^[a-zA-Z0-9_-]{1,64}$/;
  const forbidden = new Set(['__proto__', 'constructor', 'prototype']);

  try {
    const parsed = JSON.parse(fromBase64Url(clean)) as unknown;
    if (!Array.isArray(parsed)) return [];

    const merged = new Map<string, SharedCartEntry>();
    for (const raw of parsed) {
      if (!Array.isArray(raw) || raw.length < 3) continue;
      const storeId = sanitizeText(String(raw[0] || '')).trim();
      const itemId = sanitizeText(String(raw[1] || '')).trim();
      const qty = Math.min(99, Math.max(0, Math.floor(Number(raw[2] || 0))));
      if (
        !storeId ||
        !itemId ||
        forbidden.has(storeId) ||
        forbidden.has(itemId) ||
        !safeIdRe.test(storeId) ||
        !safeIdRe.test(itemId) ||
        !Number.isFinite(qty) ||
        qty <= 0
      ) {
        continue;
      }

      const key = `${storeId}___${itemId}`;
      const existing = merged.get(key);
      if (existing) {
        existing.qty = Math.min(99, existing.qty + qty);
      } else {
        if (merged.size >= 40) break;
        merged.set(key, { storeId, itemId, qty });
      }
    }

    return Array.from(merged.values());
  } catch {
    return [];
  }
}

export function buildShareCartUrl(
  currentHref: string,
  cartItems: CartItem[]
): string {
  const encoded = encodeCartToShareParam(cartItems);
  if (!encoded) return '';

  try {
    const url = new URL(currentHref);
    const preserveAutostart = url.searchParams.get('autostart') === '1';
    const nextParams = new URLSearchParams();
    if (preserveAutostart) {
      nextParams.set('autostart', '1');
    }
    nextParams.set('cart', encoded);
    return `${url.origin}${url.pathname}?${nextParams.toString()}`;
  } catch {
    return `?cart=${encoded}`;
  }
}

export function mergeSharedCartItems(
  currentCart: CartItem[],
  sharedEntries: SharedCartEntry[],
  stores: Record<string, Store>,
  allMenus: Record<string, Record<string, Omit<MenuItem, 'itemId' | 'storeId'>>>
): ReorderResult {
  const nextCart = currentCart.map((c) => ({ ...c }));
  let addedUnits = 0;
  let skippedCount = 0;

  sharedEntries.forEach((entry) => {
    const qty = Math.min(99, Math.max(0, Math.floor(Number(entry.qty || 0))));
    const storeId = String(entry.storeId || '').trim();
    const itemId = String(entry.itemId || '').trim();
    if (!storeId || !itemId || qty <= 0) {
      skippedCount += 1;
      return;
    }

    const st = stores[storeId];
    if (!st || st.approved !== true || st.suspended === true || st.isOpen === false) {
      skippedCount += 1;
      return;
    }

    const liveItem = allMenus[storeId]?.[itemId];
    if (!liveItem || liveItem.available === false || liveItem.adminApproved !== true) {
      skippedCount += 1;
      return;
    }

    const idx = nextCart.findIndex(
      (i) => String(i.itemId) === itemId && String(i.storeId) === storeId
    );
    if (idx > -1) {
      nextCart[idx] = {
        ...nextCart[idx],
        qty: Math.min(99, nextCart[idx].qty + qty),
        price: Number(liveItem.price || 0),
        name: liveItem.name || 'Grocery Item',
        imageUrl: liveItem.imageUrl || nextCart[idx].imageUrl,
        storeName: st.name || 'Grocery Store',
      };
    } else {
      nextCart.push({
        itemId,
        name: liveItem.name || 'Grocery Item',
        price: Number(liveItem.price || 0),
        qty,
        imageUrl: liveItem.imageUrl || '',
        storeId,
        storeName: st.name || 'Grocery Store',
      });
    }
    addedUnits += qty;
  });

  return { nextCart, addedUnits, skippedCount };
}

export interface DeliveryQrPayload {
  app: 'CHUTKI';
  type: 'DELIVERY_VERIFY';
  v: 1;
  groupKey: string;
  orderIds: string[];
  pin: string;
  token: string;
}

export function generateDeliveryQrToken(length = 12): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const targetLen = Math.max(8, Math.min(32, Math.floor(length)));
  let body = '';
  const globalCrypto = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (globalCrypto && typeof globalCrypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(targetLen);
    globalCrypto.getRandomValues(bytes);
    for (let i = 0; i < targetLen; i++) {
      body += alphabet[bytes[i] % alphabet.length];
    }
  } else {
    for (let i = 0; i < targetLen; i++) {
      body += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
  }
  return `CHK${body}`;
}

export function buildDeliveryQrPayload(
  group: Pick<GroupedOrder, 'groupKey' | 'deliveryOtp' | 'deliveryQrToken' | 'orders'>
): string {
  const orderIds = (group.orders || []).map((o) => o.orderId).filter(Boolean);
  const pin = String(group.deliveryOtp || '').trim();
  const fallbackToken = `CHK${group.groupKey.slice(-6).toUpperCase()}${pin}`.replace(
    /[^A-Z0-9]/g,
    ''
  );
  const payload: DeliveryQrPayload = {
    app: 'CHUTKI',
    type: 'DELIVERY_VERIFY',
    v: 1,
    groupKey: String(group.groupKey || ''),
    orderIds,
    pin,
    token: String(group.deliveryQrToken || fallbackToken),
  };
  return JSON.stringify(payload);
}

export function parseDeliveryQrPayload(raw: string): DeliveryQrPayload | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DeliveryQrPayload>;
    if (
      parsed.app !== 'CHUTKI' ||
      parsed.type !== 'DELIVERY_VERIFY' ||
      typeof parsed.groupKey !== 'string' ||
      !parsed.groupKey ||
      !Array.isArray(parsed.orderIds) ||
      typeof parsed.pin !== 'string' ||
      typeof parsed.token !== 'string' ||
      !parsed.token
    ) {
      return null;
    }
    return {
      app: 'CHUTKI',
      type: 'DELIVERY_VERIFY',
      v: 1,
      groupKey: parsed.groupKey,
      orderIds: parsed.orderIds.map((id) => String(id)).filter(Boolean),
      pin: parsed.pin,
      token: parsed.token,
    };
  } catch {
    return null;
  }
}

