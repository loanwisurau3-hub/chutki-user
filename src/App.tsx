import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { App as CapacitorApp } from '@capacitor/app';
import {
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signOut,
  type User,
} from 'firebase/auth';
import { get, onValue, push, ref, runTransaction, set, update } from 'firebase/database';
import { auth, db } from './firebase';
import type {
  AdminSettings,
  CartItem,
  CategoryDef,
  CustomerProfile,
  DeliveryPartner,
  FeedbackItem,
  GroupedOrder,
  InAppCallRecord,
  InAppCallStatus,
  MenuItem,
  OrderRecord,
  ProductReview,
  Store,
  TabKey,
  TripChatMessage,
  WalletTransaction,
} from './types/bazar';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_NEARBY_RADIUS_KM,
  calculateOrderCashback,
  darkenHexColor,
  decodeCartFromShareParam,
  deriveGroupOrderStatus,
  doesItemMatchCategory,
  evaluateSpamRisk,
  findNearestAvailableRider,
  generateDeliveryQrToken,
  getProductStockInfo,
  groupCustomerOrders,
  isChutkiPlusActive,
  isValidIndianMobile,
  matchesKeywordSearch,
  mergePastOrderIntoCart,
  mergeSharedCartItems,
  normalizeOrderStatus,
  sanitizeText,
  sortProductsByProximity,
  sortStoresByProximity,
} from './utils/bazarLogic';
import {
  collectKnownUtrs,
  detectSpamContent,
  evaluateActionRateLimit,
  evaluateOrderFraudShield,
  evaluateWalletWithdrawalSafety,
  mapAuthErrorSafe,
  reconcileCartWithCatalog,
  recordRateLimitedAction,
  requiresStrictEmailVerification,
  sanitizeInputBounded,
  sanitizeStoredCartItems,
  stripForbiddenKeysDeep,
  validatePaymentCard,
  validateScreenshotPayload,
  validateUpiUtr,
} from './utils/security';
import {
  buildOrderSnapshotMap,
  detectOrderNotificationEvents,
  detectWalletNotificationEvents,
  type OrderSnapshotState,
} from './utils/notifications';
import { stepDemoRiderCoord } from './utils/miniMapLogic';
import { triggerHaptic } from './utils/haptics';
import {
  DEMO_ADMIN_SETTINGS,
  DEMO_CUSTOMER_UID,
  DEMO_FEEDBACKS,
  DEMO_MENUS,
  DEMO_ORDERS,
  DEMO_PROFILE,
  DEMO_REVIEWS,
  DEMO_RIDERS,
  DEMO_STORES,
  DEMO_WALLET_TX,
} from './utils/demoSeed';
import { usePushNotifications } from './hooks/usePushNotifications';
import { AuthScreen, EmailVerificationScreen } from './components/AuthScreen';
import { HomeTab } from './components/HomeTab';
import { OrdersTab } from './components/OrdersTab';
import { WalletTab } from './components/WalletTab';
import { ProfileTab } from './components/ProfileTab';
import { ProductDetailModal, StoreMenuModal } from './components/CatalogModals';
import {
  CancelOrderModal,
  CheckoutModal,
  FeedbackModal,
  RatingModal,
  RefundRequestModal,
  TipRiderModal,
  WalletDepositModal,
  WalletWithdrawModal,
} from './components/CheckoutAndActionModals';
import {
  LivePushBanner,
  NotificationInboxModal,
  OfflineIndicator,
} from './components/PWAControls';
import { RiderVoiceCallModal } from './components/RiderVoiceCallModal';
import { RiderChatModal } from './components/RiderChatModal';
import {
  buildCallStatusMultiPathUpdate,
  buildCustomerCallMultiPathUpdate,
  buildCustomerOutgoingCallRecord,
  buildTripChatMessage,
  countUnreadRiderMessages,
  evaluateIncomingRiderCall,
  getCanonicalOrderIdForGroup,
  getCanonicalTripIdForGroup,
  isCallRingingExpired,
  isRiderCommunicationEligible,
  normalizeTripChatMessages,
} from './utils/riderComm';
import {
  startCallRingtone,
  startWebRtcVoiceSession,
  type RingtoneController,
  type WebRtcCallSession,
} from './utils/webrtcCallEngine';
const ChutkiBgBridge = registerPlugin<{
  startAlertService: (opts: { uid: string }) => Promise<void>;
  stopAlertService: () => Promise<void>;
}>('ChutkiBgBridge');

interface ToastItem {
  id: number;
  msg: string;
  type: 'success' | 'danger' | 'info';
}

const CART_STORAGE_KEY = 'gb_ultra_cart';
const USED_UTRS_STORAGE_KEY = 'gb_used_utrs';
const TIMELINE_TS_STORAGE_KEY = 'gb_order_timeline_ts_v1';

function loadSavedTimelineTimestamps(): Record<string, Record<string, number>> {
  try {
    const raw = localStorage.getItem(TIMELINE_TS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, Record<string, number>>;
  } catch {
    return {};
  }
}

function loadSavedCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { items?: unknown };
    return sanitizeStoredCartItems(parsed.items);
  } catch {
    return [];
  }
}

function loadSavedUsedUtrs(): string[] {
  try {
    const raw = localStorage.getItem(USED_UTRS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => String(v || '').trim())
      .filter((v) => /^\d{12}$/.test(v))
      .slice(-50);
  } catch {
    return [];
  }
}

export default function App() {
  const isAutostartDemo = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('autostart') === '1';
  }, []);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authVerifyTick, setAuthVerifyTick] = useState(0);
  const [isCheckingVerification, setIsCheckingVerification] = useState(false);
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [verifyResendCooldownSec, setVerifyResendCooldownSec] = useState(0);
  const [verifyStatusMsg, setVerifyStatusMsg] = useState('');
  const [verifyStatusErr, setVerifyStatusErr] = useState('');

  const activeUserSnapshot = useMemo(() => {
    void authVerifyTick;
    if (!currentUser) return null;
    if (auth.currentUser && auth.currentUser.uid === currentUser.uid) {
      return auth.currentUser;
    }
    return currentUser;
  }, [authVerifyTick, currentUser]);

  const activeUid = currentUser?.uid || (isAutostartDemo ? DEMO_CUSTOMER_UID : null);
  const isLoggedIn = Boolean(currentUser || isAutostartDemo);
  const isDemoMode = !currentUser && isAutostartDemo;
  const needsEmailVerification = requiresStrictEmailVerification({
    isDemoMode,
    user: activeUserSnapshot,
  });

  // Core Firebase states
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile | null>(
    isAutostartDemo ? DEMO_PROFILE : null
  );
  const [stores, setStores] = useState<Record<string, Store>>(
    isAutostartDemo ? DEMO_STORES : {}
  );
  const [allMenus, setAllMenus] = useState<
    Record<string, Record<string, Omit<MenuItem, 'itemId' | 'storeId'>>>
  >(isAutostartDemo ? DEMO_MENUS : {});
  const [deliveryPartners, setDeliveryPartners] = useState<
    Record<string, DeliveryPartner>
  >(isAutostartDemo ? DEMO_RIDERS : {});
  const [cachedOrders, setCachedOrders] = useState<
    Record<string, Omit<OrderRecord, 'orderId'>>
  >(isAutostartDemo ? DEMO_ORDERS : {});
  const [productReviews, setProductReviews] = useState<
    Record<string, Record<string, Record<string, ProductReview>>>
  >(isAutostartDemo ? DEMO_REVIEWS : {});
  const [walletTransactions, setWalletTransactions] = useState<
    Record<string, WalletTransaction>
  >(isAutostartDemo ? DEMO_WALLET_TX : {});
  const [myFeedbacks, setMyFeedbacks] = useState<Record<string, FeedbackItem>>(
    isAutostartDemo ? DEMO_FEEDBACKS : {}
  );
  const [settings, setSettings] = useState<AdminSettings>(
    isAutostartDemo ? DEMO_ADMIN_SETTINGS : {}
  );

  // Navigation & filter states
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    if (typeof window === 'undefined') return 'home';
    const urlTab = new URLSearchParams(window.location.search).get('tab');
    if (urlTab === 'orders' || urlTab === 'wallet' || urlTab === 'profile') {
      return urlTab;
    }
    return 'home';
  });
  const [currentCategoryFilter, setCurrentCategoryFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isVoiceListening, setIsVoiceListening] = useState(false);

  // Cart & modals
  const [cartItems, setCartItems] = useState<CartItem[]>(loadSavedCart);
  const [localUsedUtrs, setLocalUsedUtrs] = useState<string[]>(loadSavedUsedUtrs);
  const [menuStoreId, setMenuStoreId] = useState<string | null>(null);
  const [detailItemRef, setDetailItemRef] = useState<{
    storeId: string;
    itemId: string;
  } | null>(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [ratingModalState, setRatingModalState] = useState<{
    mode: 'RIDER' | 'PRODUCTS' | 'STORE';
    groupKey: string;
  } | null>(null);
  const [tipRiderGroupKey, setTipRiderGroupKey] = useState<string | null>(null);
  const [refundOrderTarget, setRefundOrderTarget] = useState<OrderRecord | null>(null);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const [cancelGroupKey, setCancelGroupKey] = useState<string | null>(null);
  const [isInboxOpen, setIsInboxOpen] = useState(false);

  // Rider In-App Voice Call & Real-Time Chat states
  const [activeCall, setActiveCall] = useState<InAppCallRecord | null>(null);
  const [isCallMuted, setIsCallMuted] = useState(false);
  const [isCallSpeakerOn, setIsCallSpeakerOn] = useState(false);
  const [callMicError, setCallMicError] = useState<string | null>(null);
  const [activeChatGroupKey, setActiveChatGroupKey] = useState<string | null>(null);
  const [tripChatMessagesByOrder, setTripChatMessagesByOrder] = useState<
    Record<string, TripChatMessage[]>
  >({});
  const [isSendingChatMessage, setIsSendingChatMessage] = useState(false);
  const webrtcSessionRef = useRef<WebRtcCallSession | null>(null);
  const ringtoneRef = useRef<RingtoneController | null>(null);
  const handledCallIdsRef = useRef<Set<string>>(new Set());
  const activeCallRef = useRef<InAppCallRecord | null>(null);
  activeCallRef.current = activeCall;

  // GPS & Async states
  const [detectedLat, setDetectedLat] = useState<number | null>(null);
  const [detectedLng, setDetectedLng] = useState<number | null>(null);
  const [detectedLocationLink, setDetectedLocationLink] = useState('');
  const [isFetchingCheckoutGps, setIsFetchingCheckoutGps] = useState(false);
  const [isDetectingProfileGps, setIsDetectingProfileGps] = useState(false);
  const [isDetectingHomeGps, setIsDetectingHomeGps] = useState(false);
  const [isLiveGpsTracking, setIsLiveGpsTracking] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [isActivatingPlus, setIsActivatingPlus] = useState(false);
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);

  // Toasts & Maps Quota Guard
  const [gmpQuotaExceeded, setGmpQuotaExceeded] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastCounter = useRef(0);
  const lastBackPressRef = useRef(0);
  const lastWithdrawAtRef = useRef(0);
  const actionRateHistoryRef = useRef<Record<string, number[]>>({});
  const demoProgressTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const pendingSharedCartTokenRef = useRef<string | null>(
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('cart')
      : null
  );
  const cartItemsRef = useRef<CartItem[]>(cartItems);
  cartItemsRef.current = cartItems;

  useEffect(() => {
    const onQuotaExceeded = () => setGmpQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuotaExceeded);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', onQuotaExceeded);
      demoProgressTimersRef.current.forEach((t) => clearTimeout(t));
      demoProgressTimersRef.current = [];
    };
  }, []);

  // In ?autostart=1 preview mode, stream live simulated GPS ticks for assigned demo riders
  useEffect(() => {
    if (!isDemoMode) return;
    let tick = 1;
    const interval = setInterval(() => {
      tick += 1;
      const storePt = {
        lat: Number(DEMO_STORES.store_1?.lat || 26.453),
        lng: Number(DEMO_STORES.store_1?.lng || 89.973),
      };
      const customerPt = {
        lat: Number(DEMO_PROFILE.lat || 26.4524),
        lng: Number(DEMO_PROFILE.lng || 89.9723),
      };
      const nextPt = stepDemoRiderCoord(storePt, customerPt, tick, 16);
      setDeliveryPartners((prev) => {
        if (!prev.rider_1) return prev;
        return {
          ...prev,
          rider_1: {
            ...prev.rider_1,
            lat: nextPt.lat,
            lng: nextPt.lng,
            lastLocationUpdate: Date.now(),
          },
        };
      });
      setCachedOrders((prev) => {
        const next: Record<string, Omit<OrderRecord, 'orderId'>> = {};
        Object.entries(prev).forEach(([id, o]) => {
          if (o.deliveryUid === 'rider_1' && o.status !== 'DELIVERED' && o.status !== 'CANCELLED') {
            next[id] = { ...o, riderLat: nextPt.lat, riderLng: nextPt.lng };
          } else {
            next[id] = o;
          }
        });
        return next;
      });
    }, 2200);
    return () => clearInterval(interval);
  }, [isDemoMode]);

  const showToast = useCallback(
    (msg: string, type: 'success' | 'danger' | 'info' = 'success') => {
      const id = ++toastCounter.current;
      setToasts((prev) => [...prev.filter((t) => t.msg !== msg), { id, msg, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3500);
    },
    []
  );

  const switchNav = useCallback(
    (tabName: TabKey, pushHistory = true, withHaptic = false) => {
      if (withHaptic && activeTab !== tabName) {
        triggerHaptic('tap');
      }
      setActiveTab((prev) => {
        if (prev === tabName) return prev;
        if (pushHistory && !Capacitor.isNativePlatform()) {
          window.history.pushState({ screen: tabName }, '');
        }
        return tabName;
      });
    },
    [activeTab]
  );

  // Push Notifications hook
  const {
    permission: pushPermission,
    notifications,
    unreadCount,
    activeBanner,
    promptDismissed,
    enablePushNotifications,
    sendTestPush,
    pushNotification,
    markNotificationRead,
    markAllRead,
    clearInbox,
    dismissBanner,
    dismissPrompt,
  } = usePushNotifications(activeUid, isDemoMode, (tab) => switchNav(tab));

  // Persist cart
  useEffect(() => {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ items: cartItems }));
    } catch {
      // Ignore quota errors
    }
  }, [cartItems]);

  const recordUsedUtr = useCallback((utr: string) => {
    const clean = String(utr || '').trim();
    if (!/^\d{12}$/.test(clean)) return;
    setLocalUsedUtrs((prev) => {
      if (prev.includes(clean)) return prev;
      const next = [...prev, clean].slice(-50);
      try {
        localStorage.setItem(USED_UTRS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  // Reconcile persisted/client cart prices against authoritative live catalog
  useEffect(() => {
    if (
      cartItemsRef.current.length === 0 ||
      Object.keys(stores).length === 0 ||
      Object.keys(allMenus).length === 0
    ) {
      return;
    }
    const { safeCart, tamperedCount, removedCount } = reconcileCartWithCatalog(
      cartItemsRef.current,
      stores,
      allMenus
    );
    if (tamperedCount > 0 || removedCount > 0) {
      setCartItems(safeCart);
      showToast('🛡️ Cart prices synced to live verified store catalog.', 'info');
    }
  }, [allMenus, showToast, stores]);

  // Hydrate shared cart from ?cart=... URL parameter once catalog & session are ready
  useEffect(() => {
    const token = pendingSharedCartTokenRef.current;
    if (!token || !isLoggedIn) return;
    if (Object.keys(stores).length === 0 || Object.keys(allMenus).length === 0) {
      return;
    }

    pendingSharedCartTokenRef.current = null;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('cart')) {
        url.searchParams.delete('cart');
        const nextQuery = url.searchParams.toString();
        const cleanedUrl = `${url.pathname}${nextQuery ? `?${nextQuery}` : ''}${url.hash}`;
        window.history.replaceState(window.history.state, '', cleanedUrl);
      }
    } catch {
      // Ignore URL cleanup errors
    }

    const decoded = decodeCartFromShareParam(token);
    if (decoded.length === 0) {
      showToast('⚠️ Shared cart link is invalid or empty.', 'danger');
      return;
    }

    const { nextCart, addedUnits, skippedCount } = mergeSharedCartItems(
      cartItemsRef.current,
      decoded,
      stores,
      allMenus
    );

    if (addedUnits === 0) {
      showToast('⚠️ Items in this shared basket are currently unavailable.', 'danger');
      return;
    }

    setCartItems(nextCart);
    setIsCheckoutOpen(true);
    if (!Capacitor.isNativePlatform()) {
      window.history.pushState({ modal: 'checkout' }, '');
    }
    if (skippedCount > 0) {
      showToast(
        `🛍️ Loaded ${addedUnits} shared item${addedUnits > 1 ? 's' : ''} (${skippedCount} unavailable skipped)`,
        'info'
      );
    } else {
      showToast(
        `🛍️ Loaded ${addedUnits} shared item${addedUnits > 1 ? 's' : ''} into your basket!`,
        'success'
      );
    }
  }, [allMenus, isLoggedIn, showToast, stores]);

  // Derived CMS configuration
  const adminUpiId = settings.upiId || 'gossaigaonbazar@apl';
  const appBrandName = settings.appBrandName || 'Chutki';
  const baseDeliveryCharge =
    settings.deliveryCharge !== undefined ? Number(settings.deliveryCharge) : 25;
  const freeDeliveryMinOrder =
    settings.freeDeliveryAbove !== undefined
      ? Number(settings.freeDeliveryAbove)
      : 299;
  const handlingFee =
    settings.handlingFee !== undefined ? Number(settings.handlingFee) : 0;
  const allowChutkiPlus = settings.allowChutkiPlus !== false;
  const plusPlanPrice =
    settings.plusPlanPrice !== undefined ? Number(settings.plusPlanPrice) : 99;
  const plusValidityDays =
    settings.plusValidityDays !== undefined
      ? Math.max(1, Number(settings.plusValidityDays))
      : 30;
  const allowCashback = settings.allowCashback !== false;
  const cashbackPercent =
    settings.cashbackPercent !== undefined ? Number(settings.cashbackPercent) : 5;
  const allowRiderTip = settings.allowRiderTip !== false;
  const riderTipOptions = useMemo(
    () =>
      Array.isArray(settings.riderTipOptions) && settings.riderTipOptions.length > 0
        ? settings.riderTipOptions
        : [10, 20, 30, 50],
    [settings.riderTipOptions]
  );
  const allowScheduledDelivery = settings.allowScheduledDelivery !== false;
  const customDeliverySlots = settings.customDeliverySlots;
  const showStockBadges = settings.showStockBadges !== false;
  const enforceStockLimits = settings.enforceStockLimits !== false;
  const allowFavoriteStores = settings.allowFavoriteStores !== false;
  const allowStoreQuickAdd = settings.allowStoreQuickAdd !== false;
  const allowStoreRatings = settings.allowStoreRatings !== false;
  const allowRefundRequests = settings.allowRefundRequests !== false;
  const allowDeliveryQr = settings.allowDeliveryQr !== false;
  const allowRiderVoiceCall = settings.allowRiderVoiceCall !== false;
  const allowRiderChat = settings.allowRiderChat !== false;
  const nearbyRadiusKm =
    settings.nearbyRadiusKm !== undefined && Number(settings.nearbyRadiusKm) > 0
      ? Number(settings.nearbyRadiusKm)
      : DEFAULT_NEARBY_RADIUS_KM;
  const prioritizeNearbyStores = settings.prioritizeNearbyStores !== false;
  const activeCustomerLat =
    detectedLat !== null && Number.isFinite(detectedLat)
      ? detectedLat
      : typeof customerProfile?.lat === 'number' && Number.isFinite(customerProfile.lat)
        ? customerProfile.lat
        : null;
  const activeCustomerLng =
    detectedLng !== null && Number.isFinite(detectedLng)
      ? detectedLng
      : typeof customerProfile?.lng === 'number' && Number.isFinite(customerProfile.lng)
        ? customerProfile.lng
        : null;
  const isPlusActive = isChutkiPlusActive(customerProfile);
  const minOrderAmount =
    settings.minOrderAmount !== undefined ? Number(settings.minOrderAmount) : 0;

  const minCustomerDeposit =
    settings.minCustomerDeposit !== undefined
      ? Number(settings.minCustomerDeposit)
      : 50;
  const maxCustomerDeposit =
    settings.maxCustomerDeposit !== undefined
      ? Number(settings.maxCustomerDeposit)
      : 5000;
  const minCustomerWithdraw =
    settings.minCustomerWithdraw !== undefined
      ? Number(settings.minCustomerWithdraw)
      : 50;
  const maxCustomerWithdraw =
    settings.maxCustomerWithdraw !== undefined
      ? Number(settings.maxCustomerWithdraw)
      : 5000;

  const allowReferrals = settings.allowReferrals !== false;
  const referrerBonus =
    settings.referrerBonus !== undefined ? Number(settings.referrerBonus) : 25;
  const refereeBonus =
    settings.refereeBonus !== undefined ? Number(settings.refereeBonus) : 25;

  const cmsCouponCode = settings.activeCouponCode
    ? settings.activeCouponCode.toUpperCase()
    : 'GOSSAIGAON20';
  const cmsCouponDiscount = Number(settings.activeCouponDiscount || 20);
  const cmsCouponMinOrder = Number(
    settings.couponMinOrder !== undefined ? settings.couponMinOrder : 100
  );

  const allowCod = settings.allowCod !== false;
  const allowUpi = settings.allowUpi !== false;
  const allowCardPayment = settings.allowCardPayment !== false;
  const allowWalletPayment = settings.allowWalletPayment !== false;
  const allowCoupons = settings.allowCoupons !== false;
  const allowVoiceSearch = settings.allowVoiceSearch !== false;
  const strictAntiScamShield = settings.strictAntiScamShield !== false;
  const codMaxOrderAmount =
    settings.codMaxOrderAmount !== undefined && Number(settings.codMaxOrderAmount) > 0
      ? Number(settings.codMaxOrderAmount)
      : 3000;
  const maxActiveOrdersPerUser =
    settings.maxActiveOrdersPerUser !== undefined && Number(settings.maxActiveOrdersPerUser) > 0
      ? Number(settings.maxActiveOrdersPerUser)
      : 5;
  const blockCodForFlaggedUsers = settings.blockCodForFlaggedUsers !== false;
  const spamAutoBlockThreshold =
    settings.spamAutoBlockThreshold !== undefined && Number(settings.spamAutoBlockThreshold) > 0
      ? Number(settings.spamAutoBlockThreshold)
      : 3;
  const actionCooldownMs =
    settings.actionCooldownMs !== undefined && Number(settings.actionCooldownMs) >= 0
      ? Number(settings.actionCooldownMs)
      : 15000;
  const maintenanceMode = settings.maintenanceMode === true;
  const maintenanceMessage =
    settings.maintenanceMessage ||
    'Chutki is currently closed for maintenance. Opening soon!';

  const categories = useMemo<CategoryDef[]>(() => {
    if (Array.isArray(settings.customCategories) && settings.customCategories.length > 0) {
      const list = settings.customCategories.filter((c) => c && c.active !== false);
      if (!list.some((c) => c.id === 'ALL_STORES')) {
        list.splice(1, 0, {
          id: 'ALL_STORES',
          name: 'All Store',
          icon: '🏪',
          keywords: [],
          active: true,
        });
      }
      if (!list.some((c) => c.id === 'FAVORITES')) {
        list.splice(2, 0, {
          id: 'FAVORITES',
          name: 'Favorites',
          icon: '❤️',
          keywords: [],
          active: true,
        });
      }
      return list;
    }
    return DEFAULT_CATEGORIES;
  }, [settings.customCategories]);

  useEffect(() => {
    if (!categories.some((c) => c.id === currentCategoryFilter)) {
      setCurrentCategoryFilter('ALL');
    }
  }, [categories, currentCategoryFilter]);

  // Apply CMS Theme CSS variables
  useEffect(() => {
    const root = document.documentElement;
    if (settings.themePrimaryColor) {
      root.style.setProperty('--brand-green', settings.themePrimaryColor);
      root.style.setProperty('--primary', settings.themePrimaryColor);
      root.style.setProperty('--success', settings.themePrimaryColor);
      root.style.setProperty(
        '--brand-green-dark',
        darkenHexColor(settings.themePrimaryColor)
      );
    } else {
      root.style.setProperty('--brand-green', '#0c831f');
      root.style.setProperty('--primary', '#0c831f');
      root.style.setProperty('--success', '#0c831f');
      root.style.setProperty('--brand-green-dark', '#075e14');
    }
    if (settings.themeAccentColor) {
      root.style.setProperty('--brand-yellow', settings.themeAccentColor);
    } else {
      root.style.setProperty('--brand-yellow', '#f8cb46');
    }
    if (settings.themeBgColor) {
      root.style.setProperty('--bg', settings.themeBgColor);
    } else {
      root.style.setProperty('--bg', '#f4f6fb');
    }
    if (settings.appBrandName) {
      document.title = `${settings.appBrandName} - Express Delivery`;
    } else {
      document.title = 'Chutki - 15-Minute Grocery Delivery';
    }
  }, [settings]);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setVerifyStatusMsg('');
      setVerifyStatusErr('');
      setVerifyResendCooldownSec(0);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);
useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (currentUser && !needsEmailVerification) {
      void ChutkiBgBridge.startAlertService({ uid: currentUser.uid }).catch(() => {});
    }
  }, [currentUser, needsEmailVerification]);
  useEffect(() => {
    if (verifyResendCooldownSec <= 0) return undefined;
    const timer = window.setTimeout(() => {
      setVerifyResendCooldownSec((sec) => Math.max(0, sec - 1));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [verifyResendCooldownSec]);

  // Refs for diffing push notifications cleanly without duplicate triggers
  const orderSnapshotRef = useRef<Record<string, OrderSnapshotState> | null>(null);
  const ordersHydratedRef = useRef<boolean>(isAutostartDemo);
  const prevUidForSnapshotRef = useRef<string | null>(null);
  const walletKeysRef = useRef<Set<string> | null>(null);
  const lastAnnouncementRef = useRef<string | null>(null);

  // Firebase RTDB real-time listeners (with clean unsubscribe!)
  useEffect(() => {
    if (!currentUser || needsEmailVerification) return;
    const uid = currentUser.uid;
    orderSnapshotRef.current = null;
    walletKeysRef.current = null;

    const unsubs: Array<() => void> = [];

    unsubs.push(
      onValue(ref(db, `customers/${uid}`), (snap) => {
        const data = (snap.val() || {}) as CustomerProfile;
        if (!data.referralCode) {
          const code = 'GB' + uid.slice(0, 6).toUpperCase();
          void set(ref(db, `customers/${uid}/referralCode`), code);
          data.referralCode = code;
        }
        setCustomerProfile(data);
        if (data.lat && data.lng) {
          setDetectedLat(data.lat);
          setDetectedLng(data.lng);
          setDetectedLocationLink(data.locationLink || '');
        }
      })
    );

    unsubs.push(
      onValue(ref(db, 'restaurants'), (snap) => {
        setStores((snap.val() || {}) as Record<string, Store>);
      })
    );

    unsubs.push(
      onValue(ref(db, 'menus'), (snap) => {
        setAllMenus(
          (snap.val() || {}) as Record<
            string,
            Record<string, Omit<MenuItem, 'itemId' | 'storeId'>>
          >
        );
      })
    );

    unsubs.push(
      onValue(ref(db, 'productReviews'), (snap) => {
        setProductReviews(
          (snap.val() || {}) as Record<
            string,
            Record<string, Record<string, ProductReview>>
          >
        );
      })
    );

    unsubs.push(
      onValue(ref(db, `walletTransactions/${uid}`), (snap) => {
        const txMap = (snap.val() || {}) as Record<string, WalletTransaction>;
        setWalletTransactions(txMap);

        const keys = new Set(Object.keys(txMap));
        if (walletKeysRef.current !== null) {
          const newAlerts = detectWalletNotificationEvents(
            walletKeysRef.current,
            txMap
          );
          newAlerts.forEach((n) => pushNotification(n, true));
        }
        walletKeysRef.current = keys;
      })
    );

    unsubs.push(
      onValue(ref(db, 'feedbacks'), (snap) => {
        const allFb = (snap.val() || {}) as Record<string, FeedbackItem>;
        const mine: Record<string, FeedbackItem> = {};
        Object.entries(allFb).forEach(([id, f]) => {
          if (f.uid === uid) mine[id] = f;
        });
        setMyFeedbacks(mine);
      })
    );

    unsubs.push(
      onValue(ref(db, 'deliveryPartners'), (snap) => {
        setDeliveryPartners((snap.val() || {}) as Record<string, DeliveryPartner>);
      })
    );

    unsubs.push(
      onValue(ref(db, 'admin/settings'), (snap) => {
        const s = (snap.val() || {}) as AdminSettings;
        setSettings(s);
        const activeAnn =
          s.announcementActive && s.announcementText ? s.announcementText : '';
        if (
          lastAnnouncementRef.current !== null &&
          activeAnn &&
          activeAnn !== lastAnnouncementRef.current
        ) {
          pushNotification(
            {
              id: `promo_${Date.now()}`,
              title: '📢 Chutki Offer Alert',
              body: activeAnn,
              tag: 'gb-announcement',
              type: 'PROMO',
              targetTab: 'home',
              createdAt: Date.now(),
              read: false,
            },
            true
          );
        }
        lastAnnouncementRef.current = activeAnn;
      })
    );

    unsubs.push(
      onValue(ref(db, 'orders'), (snap) => {
        const allOrd = (snap.val() || {}) as Record<
          string,
          Omit<OrderRecord, 'orderId'>
        >;
        const mine: Record<string, Omit<OrderRecord, 'orderId'>> = {};
        Object.entries(allOrd).forEach(([id, o]) => {
          if (o.customerUid === uid) mine[id] = o;
        });
        ordersHydratedRef.current = true;
        setCachedOrders(mine);
      })
    );

    return () => {
      ordersHydratedRef.current = false;
      unsubs.forEach((fn) => fn());
    };
  }, [currentUser, needsEmailVerification, pushNotification]);

  const navStateRef = useRef({
    activeCall,
    activeChatGroupKey,
    isInboxOpen,
    refundOrderTarget,
    tipRiderGroupKey,
    ratingModalState,
    isFeedbackOpen,
    isDepositOpen,
    isWithdrawOpen,
    cancelGroupKey,
    isCheckoutOpen,
    detailItemRef,
    menuStoreId,
    activeTab,
    currentCategoryFilter,
    searchQuery,
  });
  navStateRef.current = {
    activeCall,
    activeChatGroupKey,
    isInboxOpen,
    refundOrderTarget,
    tipRiderGroupKey,
    ratingModalState,
    isFeedbackOpen,
    isDepositOpen,
    isWithdrawOpen,
    cancelGroupKey,
    isCheckoutOpen,
    detailItemRef,
    menuStoreId,
    activeTab,
    currentCategoryFilter,
    searchQuery,
  };

  // Android Native Capacitor + Browser Hardware Back Button Handler
  useEffect(() => {
    const handleBackStep = (isNativeBack: boolean): boolean => {
      const s = navStateRef.current;
      if (s.activeCall) {
        showToast('Tap End Call to close active voice call', 'info');
        return false;
      }
      if (s.activeChatGroupKey) {
        setActiveChatGroupKey(null);
        return false;
      }
      if (s.isInboxOpen) {
        setIsInboxOpen(false);
        return false;
      }
      if (s.refundOrderTarget) {
        setRefundOrderTarget(null);
        return false;
      }
      if (s.tipRiderGroupKey) {
        setTipRiderGroupKey(null);
        return false;
      }
      if (s.ratingModalState) {
        setRatingModalState(null);
        return false;
      }
      if (s.isFeedbackOpen) {
        setIsFeedbackOpen(false);
        return false;
      }
      if (s.isDepositOpen) {
        setIsDepositOpen(false);
        return false;
      }
      if (s.isWithdrawOpen) {
        setIsWithdrawOpen(false);
        return false;
      }
      if (s.cancelGroupKey) {
        setCancelGroupKey(null);
        return false;
      }
      if (s.isCheckoutOpen) {
        setIsCheckoutOpen(false);
        return false;
      }
      if (s.detailItemRef) {
        setDetailItemRef(null);
        return false;
      }
      if (s.menuStoreId) {
        setMenuStoreId(null);
        return false;
      }
      if (s.activeTab !== 'home') {
        switchNav('home', false);
        return false;
      }
      if (s.searchQuery.trim() !== '' || s.currentCategoryFilter !== 'ALL') {
        setSearchQuery('');
        setCurrentCategoryFilter('ALL');
        return false;
      }
      const now = Date.now();
      if (now - lastBackPressRef.current < 2000) {
        return true;
      }
      lastBackPressRef.current = now;
      showToast('Press BACK again to exit', 'info');
      if (!isNativeBack) {
        window.history.pushState({ screen: 'home' }, '');
      }
      return false;
    };

    if (!Capacitor.isNativePlatform() && !window.history.state) {
      window.history.replaceState({ screen: 'home' }, '');
    }

    const handlePopState = () => {
      if (Capacitor.isNativePlatform()) return;
      const shouldExit = handleBackStep(false);
      if (shouldExit) {
        window.history.back();
      }
    };

    window.addEventListener('popstate', handlePopState);

    let removed = false;
    let backHandle: { remove: () => Promise<void> } | null = null;
    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener('backButton', () => {
        const shouldExit = handleBackStep(true);
        if (shouldExit) {
          void CapacitorApp.exitApp();
        }
      }).then((handle) => {
        if (removed) {
          void handle.remove();
        } else {
          backHandle = handle;
        }
      });
    }

    return () => {
      removed = true;
      window.removeEventListener('popstate', handlePopState);
      if (backHandle) {
        void backHandle.remove();
      }
    };
  }, [showToast, switchNav]);

  // Memoized products & stores lists (prioritizing <= nearbyRadiusKm stores & search hits first)
  const filteredProducts = useMemo<MenuItem[]>(() => {
    const query = searchQuery.toLowerCase().trim();
    const list: MenuItem[] = [];
    Object.entries(allMenus).forEach(([storeId, storeItems]) => {
      const store = stores[storeId];
      if (
        store &&
        store.approved === true &&
        store.suspended !== true &&
        store.isOpen !== false
      ) {
        Object.entries(storeItems || {}).forEach(([itemId, item]) => {
          if (item.available !== false && item.adminApproved === true) {
            list.push({ ...item, itemId, storeId, storeName: store.name });
          }
        });
      }
    });

    const filtered = list.filter((item) => {
      if (
        currentCategoryFilter !== 'ALL' &&
        currentCategoryFilter !== 'ALL_STORES' &&
        !doesItemMatchCategory(
          item,
          currentCategoryFilter,
          categories,
          customerProfile?.favorites
        )
      ) {
        return false;
      }
      if (query && !matchesKeywordSearch(item, item.storeName || '', query)) {
        return false;
      }
      return true;
    });

    return sortProductsByProximity(filtered, stores, activeCustomerLat, activeCustomerLng, {
      radiusKm: nearbyRadiusKm,
      prioritizeNearby: prioritizeNearbyStores,
      searchQuery: query,
    });
  }, [
    activeCustomerLat,
    activeCustomerLng,
    allMenus,
    categories,
    currentCategoryFilter,
    customerProfile?.favorites,
    nearbyRadiusKm,
    prioritizeNearbyStores,
    searchQuery,
    stores,
  ]);

  const approvedStores = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const matching = Object.entries(stores).filter(([storeId, s]) => {
      if (s.approved !== true || s.suspended === true) return false;
      if (!query) return true;
      const storeMetaMatches =
        (s.name || '').toLowerCase().includes(query) ||
        (s.cuisine || '').toLowerCase().includes(query) ||
        (s.category || '').toLowerCase().includes(query);
      if (storeMetaMatches) return true;
      return Object.values(allMenus[storeId] || {}).some(
        (item) =>
          item &&
          item.available !== false &&
          item.adminApproved === true &&
          matchesKeywordSearch(item, s.name || '', query)
      );
    });
    return sortStoresByProximity(matching, activeCustomerLat, activeCustomerLng, {
      radiusKm: nearbyRadiusKm,
      prioritizeNearby: prioritizeNearbyStores,
    });
  }, [
    activeCustomerLat,
    activeCustomerLng,
    allMenus,
    nearbyRadiusKm,
    prioritizeNearbyStores,
    searchQuery,
    stores,
  ]);

  const [observedStatusTimestamps, setObservedStatusTimestamps] = useState<
    Record<string, Record<string, number>>
  >(loadSavedTimelineTimestamps);

  const groupedOrders = useMemo(
    () => groupCustomerOrders(cachedOrders),
    [cachedOrders]
  );

  // Unified real-time order-status push watcher & timeline timestamp recorder
  useEffect(() => {
    if (!activeUid) {
      orderSnapshotRef.current = null;
      prevUidForSnapshotRef.current = null;
      return;
    }
    if (!ordersHydratedRef.current) return;

    const now = Date.now();
    setObservedStatusTimestamps((prev) => {
      let changed = false;
      const next = { ...prev };
      groupedOrders.forEach((grp) => {
        const derived = deriveGroupOrderStatus(grp);
        const curStatus = normalizeOrderStatus(derived.status);
        const existingMap = { ...(next[grp.groupKey] || {}) };
        let grpChanged = false;

        if (grp.statusTimestamps) {
          Object.entries(grp.statusTimestamps).forEach(([k, v]) => {
            if (Number.isFinite(v) && v > 0 && !existingMap[k]) {
              existingMap[k] = v;
              grpChanged = true;
            }
          });
        }
        if (!existingMap.PLACED && (grp.placedAt || grp.createdAt)) {
          existingMap.PLACED = Number(grp.placedAt || grp.createdAt);
          grpChanged = true;
        }
        if (!existingMap[curStatus]) {
          existingMap[curStatus] = now;
          grpChanged = true;
        }

        if (grpChanged) {
          next[grp.groupKey] = existingMap;
          changed = true;
        }
      });
      if (changed) {
        try {
          localStorage.setItem(TIMELINE_TS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore storage quota
        }
      }
      return changed ? next : prev;
    });

    if (
      orderSnapshotRef.current === null ||
      prevUidForSnapshotRef.current !== activeUid
    ) {
      orderSnapshotRef.current = buildOrderSnapshotMap(groupedOrders);
      prevUidForSnapshotRef.current = activeUid;
      return;
    }

    const alerts = detectOrderNotificationEvents(
      orderSnapshotRef.current,
      groupedOrders
    );
    if (alerts.length > 0) {
      triggerHaptic('notification');
      alerts.forEach((n) => pushNotification(n, true));
    }
    orderSnapshotRef.current = buildOrderSnapshotMap(groupedOrders);
  }, [activeUid, groupedOrders, pushNotification]);

  // Cart actions
  const getItemQuantityInCart = useCallback(
    (itemId: string, storeId: string) => {
      const found = cartItems.find(
        (i) =>
          String(i.itemId) === String(itemId) &&
          (!storeId || String(i.storeId) === String(storeId))
      );
      return found ? found.qty : 0;
    },
    [cartItems]
  );

  const updateCartQtySafe = useCallback(
    (
      itemId: string,
      storeId: string,
      change: number,
      e?: React.MouseEvent
    ): boolean => {
      if (e) e.stopPropagation();
      const storeData = stores[storeId];
      if (
        change > 0 &&
        (!storeData ||
          storeData.approved !== true ||
          storeData.suspended === true ||
          storeData.isOpen === false)
      ) {
        triggerHaptic('error');
        showToast(
          '🔴 Yeh store abhi offline/closed hai. Order nahi le raha!',
          'danger'
        );
        return false;
      }
      const itemData = allMenus[storeId]?.[itemId];
      if (
        change > 0 &&
        (!itemData || itemData.available === false || itemData.adminApproved !== true)
      ) {
        triggerHaptic('error');
        showToast('Yeh product abhi sale ke liye available nahi hai.', 'danger');
        return false;
      }

      if (change > 0) {
        const stockInfo = getProductStockInfo(itemData);
        if (enforceStockLimits && stockInfo.isOutOfStock) {
          triggerHaptic('error');
          showToast(`⚠️ "${itemData?.name || 'Product'}" abhi Out of Stock hai!`, 'danger');
          return false;
        }
        const curQty =
          cartItemsRef.current.find(
            (i) =>
              String(i.itemId) === String(itemId) &&
              String(i.storeId) === String(storeId)
          )?.qty || 0;
        if (
          enforceStockLimits &&
          stockInfo.count !== null &&
          curQty + change > stockInfo.count
        ) {
          triggerHaptic('error');
          showToast(
            `Only ${stockInfo.count} unit${stockInfo.count > 1 ? 's' : ''} left in stock for ${itemData?.name || 'this item'}!`,
            'danger'
          );
          return false;
        }
        triggerHaptic('cartAdd');
      } else if (change < 0) {
        triggerHaptic('cartRemove');
      }

      setCartItems((prev) => {
        const next = [...prev];
        const idx = next.findIndex(
          (i) =>
            String(i.itemId) === String(itemId) &&
            String(i.storeId) === String(storeId)
        );
        if (idx > -1) {
          const updatedQty = next[idx].qty + change;
          if (updatedQty <= 0) next.splice(idx, 1);
          else next[idx] = { ...next[idx], qty: updatedQty };
        } else if (change > 0 && itemData) {
          next.push({
            itemId: String(itemId),
            name: itemData.name || 'Grocery Item',
            price: Number(itemData.price || 0),
            qty: 1,
            imageUrl: itemData.imageUrl || '',
            storeId: String(storeId || ''),
            storeName: storeData?.name || 'Grocery Store',
          });
        }
        return next;
      });
      return true;
    },
    [allMenus, enforceStockLimits, showToast, stores]
  );

  const handleQuickAddStorePopular = useCallback(
    (storeId: string, item: MenuItem, e: React.MouseEvent) => {
      const added = updateCartQtySafe(item.itemId, storeId, 1, e);
      if (!added) return;
      const storeName = stores[storeId]?.name || item.storeName || 'store';
      showToast(
        `⚡ Added ${item.name} (₹${Number(item.price || 0).toFixed(0)}) from ${storeName}`,
        'success'
      );
    },
    [showToast, stores, updateCartQtySafe]
  );

  const handleReorderPastOrder = useCallback(
    (order: OrderRecord) => {
      const { nextCart, addedUnits, skippedCount } = mergePastOrderIntoCart(
        cartItems,
        order,
        stores,
        allMenus
      );

      if (addedUnits === 0) {
        triggerHaptic('error');
        showToast(
          'Sorry, items from this past order are currently unavailable.',
          'danger'
        );
        return;
      }

      triggerHaptic('cartAdd');
      setCartItems(nextCart);
      setIsCheckoutOpen(true);
      if (!Capacitor.isNativePlatform()) {
        window.history.pushState({ modal: 'checkout' }, '');
      }
      if (skippedCount > 0) {
        showToast(
          `🛒 Added ${addedUnits} item${addedUnits > 1 ? 's' : ''} (${skippedCount} unavailable skipped)`,
          'info'
        );
      } else {
        showToast(
          `🛒 Added ${addedUnits} item${addedUnits > 1 ? 's' : ''} to cart!`,
          'success'
        );
      }
    },
    [allMenus, cartItems, showToast, stores]
  );

  const toggleFavoriteItem = useCallback(
    (storeId: string, itemId: string, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      if (!activeUid) return;
      const key = `${storeId}___${itemId}`;
      const currentlyFav = Boolean(customerProfile?.favorites?.[key]);
      triggerHaptic(currentlyFav ? 'tap' : 'favorite');

      if (isDemoMode) {
        setCustomerProfile((prev) => {
          const favs = { ...(prev?.favorites || {}) };
          if (currentlyFav) delete favs[key];
          else favs[key] = true;
          return { ...(prev || {}), favorites: favs };
        });
        showToast(
          currentlyFav ? 'Removed from Favorites' : '❤️ Added to Favorites!',
          'info'
        );
        return;
      }

      void set(
        ref(db, `customers/${activeUid}/favorites/${key}`),
        currentlyFav ? null : true
      )
        .then(() => {
          showToast(
            currentlyFav ? 'Removed from Favorites' : '❤️ Added to Favorites!',
            'info'
          );
        })
        .catch(() => {
          showToast('Could not update favorites. Try again.', 'danger');
        });
    },
    [activeUid, customerProfile?.favorites, isDemoMode, showToast]
  );

  const toggleFavoriteStore = useCallback(
    (storeId: string, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      if (!activeUid || !storeId) return;
      const currentlyFav = Boolean(customerProfile?.favoriteStores?.[storeId]);
      const storeName = stores[storeId]?.name || 'Store';
      triggerHaptic(currentlyFav ? 'tap' : 'favorite');

      if (isDemoMode) {
        setCustomerProfile((prev) => {
          const favStores = { ...(prev?.favoriteStores || {}) };
          if (currentlyFav) delete favStores[storeId];
          else favStores[storeId] = true;
          return { ...(prev || {}), favoriteStores: favStores };
        });
        showToast(
          currentlyFav
            ? `Removed ${storeName} from Saved Stores`
            : `❤️ ${storeName} saved to Favourite Stores!`,
          'info'
        );
        return;
      }

      void set(
        ref(db, `customers/${activeUid}/favoriteStores/${storeId}`),
        currentlyFav ? null : true
      )
        .then(() => {
          showToast(
            currentlyFav
              ? `Removed ${storeName} from Saved Stores`
              : `❤️ ${storeName} saved to Favourite Stores!`,
            'info'
          );
        })
        .catch(() => {
          showToast('Could not update saved stores. Try again.', 'danger');
        });
    },
    [activeUid, customerProfile?.favoriteStores, isDemoMode, showToast, stores]
  );

  const handleActivateChutkiPlus = useCallback(async () => {
    if (!activeUid || isActivatingPlus) return;
    if (!allowChutkiPlus) {
      showToast('Chutki Plus plan is currently paused by Admin.', 'info');
      return;
    }
    if (isPlusActive) {
      showToast('👑 Your Chutki Plus membership is already active!', 'info');
      return;
    }
    const curBal = Number(customerProfile?.walletBalance || 0);
    if (curBal < plusPlanPrice) {
      triggerHaptic('error');
      showToast(
        `Add ₹${Math.ceil(plusPlanPrice - curBal)} more to Wallet to activate Chutki Plus (₹${plusPlanPrice})!`,
        'danger'
      );
      switchNav('wallet');
      setIsDepositOpen(true);
      return;
    }

    setIsActivatingPlus(true);
    try {
      const activeUntil = Date.now() + plusValidityDays * 24 * 60 * 60 * 1000;
      if (isDemoMode) {
        setCustomerProfile((prev) => ({
          ...(prev || {}),
          walletBalance: Number((Number(prev?.walletBalance || 0) - plusPlanPrice).toFixed(2)),
          plusActiveUntil: activeUntil,
        }));
        setWalletTransactions((prev) => ({
          ...prev,
          [`tx_plus_${Date.now()}`]: {
            type: 'DEBIT',
            amount: plusPlanPrice,
            note: `👑 Chutki Plus ${plusValidityDays}-Day Free Delivery Pass`,
            createdAt: Date.now(),
          },
        }));
        triggerHaptic('success');
        showToast(
          `👑 Chutki Plus Activated for ${plusValidityDays} days! Enjoy FREE delivery.`,
          'success'
        );
        return;
      }

      const txResult = await runTransaction(
        ref(db, `customers/${activeUid}/walletBalance`),
        (bal) => {
          const cur = Number(bal || 0);
          if (cur < plusPlanPrice) return;
          return Number((cur - plusPlanPrice).toFixed(2));
        }
      );
      if (!txResult.committed) {
        triggerHaptic('error');
        showToast('Insufficient Wallet balance for Chutki Plus!', 'danger');
        return;
      }
      await update(ref(db, `customers/${activeUid}`), {
        plusActiveUntil: activeUntil,
        updatedAt: Date.now(),
      });
      await push(ref(db, `walletTransactions/${activeUid}`), {
        type: 'DEBIT',
        amount: plusPlanPrice,
        note: `👑 Chutki Plus ${plusValidityDays}-Day Free Delivery Pass`,
        createdAt: Date.now(),
      });
      triggerHaptic('success');
      showToast(
        `👑 Chutki Plus Activated for ${plusValidityDays} days! Enjoy FREE delivery.`,
        'success'
      );
    } catch (err) {
      triggerHaptic('error');
      showToast(
        err instanceof Error ? err.message : 'Could not activate Chutki Plus. Try again.',
        'danger'
      );
    } finally {
      setIsActivatingPlus(false);
    }
  }, [
    activeUid,
    allowChutkiPlus,
    customerProfile?.walletBalance,
    isActivatingPlus,
    isDemoMode,
    isPlusActive,
    plusPlanPrice,
    plusValidityDays,
    showToast,
    switchNav,
  ]);

  // Voice search
  const startVoiceSearch = () => {
    const win = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        onresult: (ev: { results: Array<Array<{ transcript: string }>> }) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        onresult: (ev: { results: Array<Array<{ transcript: string }>> }) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
      };
    };
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SR) {
      showToast('Voice search supported on Chrome/Android.', 'info');
      return;
    }
    const rec = new SR();
    rec.lang = 'en-IN';
    setIsVoiceListening(true);
    rec.onresult = (ev) => {
      setSearchQuery(sanitizeText(ev.results[0][0].transcript));
      setIsVoiceListening(false);
    };
    rec.onerror = () => setIsVoiceListening(false);
    rec.onend = () => setIsVoiceListening(false);
    rec.start();
  };

  // Real-time GPS listener for continuous 5km store/product sorting on Home & Search
  const applyRealtimeGpsCoords = useCallback(
    (rawLat: number, rawLng: number) => {
      if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return;
      const lat = Number(rawLat.toFixed(6));
      const lng = Number(rawLng.toFixed(6));
      const link = `https://www.google.com/maps?q=${lat},${lng}`;
      setDetectedLat((prev) =>
        prev !== null && Math.abs(prev - lat) < 0.00025 ? prev : lat
      );
      setDetectedLng((prev) =>
        prev !== null && Math.abs(prev - lng) < 0.00025 ? prev : lng
      );
      setDetectedLocationLink(link);
    },
    []
  );

  useEffect(() => {
    if (!isLoggedIn || !prioritizeNearbyStores) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    let watchId: number | null = null;
    let cancelled = false;
    let permStatus: PermissionStatus | null = null;

    const startWatch = () => {
      if (cancelled || watchId !== null) return;
      setIsLiveGpsTracking(true);
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (cancelled) return;
          applyRealtimeGpsCoords(pos.coords.latitude, pos.coords.longitude);
        },
        () => {
          if (!cancelled) setIsLiveGpsTracking(false);
        },
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 12000 }
      );
    };

    if (navigator.permissions && typeof navigator.permissions.query === 'function') {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then((status) => {
          if (cancelled) return;
          permStatus = status;
          if (status.state === 'granted') {
            startWatch();
          }
          status.onchange = () => {
            if (status.state === 'granted') {
              startWatch();
            } else if (watchId !== null) {
              navigator.geolocation.clearWatch(watchId);
              watchId = null;
              setIsLiveGpsTracking(false);
            }
          };
        })
        .catch(() => {
          // Ignore environments without Permissions API support
        });
    }

    return () => {
      cancelled = true;
      if (permStatus) permStatus.onchange = null;
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [applyRealtimeGpsCoords, isLoggedIn, prioritizeNearbyStores]);

  // GPS handlers
  const handleHomeGpsDetect = () => {
    if (!navigator.geolocation) {
      showToast('GPS unavailable on this device.', 'danger');
      return;
    }
    setIsDetectingHomeGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        applyRealtimeGpsCoords(pos.coords.latitude, pos.coords.longitude);
        setIsLiveGpsTracking(true);
        setIsDetectingHomeGps(false);
        triggerHaptic('success');
        showToast(
          `📍 Live GPS updated — stores within ${nearbyRadiusKm} km sorted first!`,
          'success'
        );
      },
      (err) => {
        setIsDetectingHomeGps(false);
        showToast('GPS Error: ' + err.message, 'danger');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
    );
  };

  const handleCheckoutGps = () => {
    if (!navigator.geolocation) {
      showToast('GPS unavailable.', 'danger');
      return;
    }
    setIsFetchingCheckoutGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const link = `https://www.google.com/maps?q=${lat},${lng}`;
        setDetectedLat(lat);
        setDetectedLng(lng);
        setDetectedLocationLink(link);
        try {
          const resp = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1`
          );
          const data = (await resp.json()) as {
            address?: {
              house_number?: string;
              road?: string;
              suburb?: string;
              village?: string;
              town?: string;
              city?: string;
            };
          };
          if (data?.address) {
            const addr = data.address;
            const area = addr.village || addr.town || addr.city || 'Gossaigaon';
            const built =
              [addr.house_number, addr.road || addr.suburb, area]
                .filter(Boolean)
                .join(', ') || 'Gossaigaon';
            setCustomerProfile((prev) => ({
              ...(prev || {}),
              lat,
              lng,
              locationLink: link,
              address: built,
            }));
          } else {
            setCustomerProfile((prev) => ({ ...(prev || {}), lat, lng, locationLink: link }));
          }
        } catch {
          setCustomerProfile((prev) => ({ ...(prev || {}), lat, lng, locationLink: link }));
        } finally {
          setIsFetchingCheckoutGps(false);
        }
        showToast('📍 Doorstep GPS Fixed!', 'success');
      },
      (err) => {
        setIsFetchingCheckoutGps(false);
        showToast('GPS Error: ' + err.message, 'danger');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  const handleProfileGps = () => {
    if (!navigator.geolocation) {
      showToast('GPS unavailable.', 'danger');
      return;
    }
    setIsDetectingProfileGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        const link = `https://www.google.com/maps?q=${lat},${lng}`;
        setDetectedLat(lat);
        setDetectedLng(lng);
        setDetectedLocationLink(link);
        let newAddress = customerProfile?.address || 'Gossaigaon';
        try {
          const resp = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1`
          );
          const data = (await resp.json()) as {
            address?: {
              road?: string;
              town?: string;
              city?: string;
              village?: string;
            };
          };
          if (data?.address) {
            const town =
              data.address.town ||
              data.address.city ||
              data.address.village ||
              'Gossaigaon';
            newAddress = `${data.address.road ? data.address.road + ', ' : ''}${town}`;
          }
          setCustomerProfile((prev) => ({
            ...(prev || {}),
            lat,
            lng,
            locationLink: link,
            address: newAddress,
          }));
          if (currentUser) {
            await update(ref(db, `customers/${currentUser.uid}`), {
              lat,
              lng,
              locationLink: link,
              address: newAddress,
              updatedAt: Date.now(),
            });
          }
          showToast('📍 Exact Profile GPS Saved!', 'success');
        } catch {
          setCustomerProfile((prev) => ({
            ...(prev || {}),
            lat,
            lng,
            locationLink: link,
            address: newAddress,
          }));
          showToast('📍 GPS Coordinates Pinned!', 'success');
        } finally {
          setIsDetectingProfileGps(false);
        }
      },
      (err) => {
        setIsDetectingProfileGps(false);
        showToast('GPS Error: ' + err.message, 'danger');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  };

  // Profile Save
  const handleSaveProfile = (nameRaw: string, phoneRaw: string, addressRaw: string) => {
    const name = sanitizeInputBounded(nameRaw, 80);
    const phone = phoneRaw.replace(/\D/g, '').slice(0, 10);
    const address = sanitizeInputBounded(addressRaw, 220);
    if (name.length < 2) {
      showToast('Enter your full name!', 'danger');
      return;
    }
    if (!isValidIndianMobile(phone)) {
      showToast('Enter valid 10-digit mobile number!', 'danger');
      return;
    }
    if (address.length < 5) {
      showToast('Enter complete delivery address!', 'danger');
      return;
    }
    const updates: Partial<CustomerProfile> = {
      name,
      phone,
      address,
      updatedAt: Date.now(),
    };
    if (detectedLat && detectedLng) {
      updates.lat = detectedLat;
      updates.lng = detectedLng;
      updates.locationLink = detectedLocationLink;
    }

    if (isDemoMode) {
      setCustomerProfile((prev) => ({ ...(prev || {}), ...updates }));
      showToast('Profile saved!', 'success');
      return;
    }

    if (currentUser) {
      void update(ref(db, `customers/${currentUser.uid}`), updates)
        .then(() => showToast('Profile saved!', 'success'))
        .catch(() => showToast('Could not save profile. Please retry.', 'danger'));
    }
  };

  // Place Order
  const handlePlaceOrder = async (payload: {
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
  }) => {
    if (isPlacingOrder || !activeUid) return;
    if (maintenanceMode) {
      triggerHaptic('error');
      showToast(`🚧 ${maintenanceMessage}`, 'danger');
      return;
    }
    if (cartItems.length === 0) {
      triggerHaptic('error');
      setIsCheckoutOpen(false);
      showToast('Cart is empty!', 'danger');
      return;
    }

    // Reconcile client cart against live catalog prices to block price tampering
    const {
      safeCart: verifiedCartItems,
      tamperedCount,
      removedCount,
    } = reconcileCartWithCatalog(cartItems, stores, allMenus);
    if (tamperedCount > 0 || removedCount > 0) {
      triggerHaptic('error');
      setCartItems(verifiedCartItems);
      showToast(
        '🛡️ Item availability or prices changed—your basket has been synced. Please review and place order again.',
        'danger'
      );
      return;
    }

    for (const item of verifiedCartItems) {
      const st = stores[item.storeId];
      if (!st || st.approved !== true || st.suspended === true || st.isOpen === false) {
        triggerHaptic('error');
        showToast(
          `🔴 "${item.storeName}" abhi closed hai! Checkout se closed store ke items hatayein.`,
          'danger'
        );
        return;
      }
      const menuProd = allMenus[item.storeId]?.[item.itemId];
      if (!menuProd || menuProd.available === false || menuProd.adminApproved !== true) {
        triggerHaptic('error');
        showToast(`⚠️ "${item.name}" abhi available nahi hai.`, 'danger');
        return;
      }
      const stockInfo = getProductStockInfo(menuProd);
      if (enforceStockLimits && stockInfo.isOutOfStock) {
        triggerHaptic('error');
        showToast(`⚠️ "${item.name}" is Out of Stock! Remove it to continue.`, 'danger');
        return;
      }
      if (enforceStockLimits && stockInfo.count !== null && item.qty > stockInfo.count) {
        triggerHaptic('error');
        showToast(
          `⚠️ Only ${stockInfo.count} unit${stockInfo.count > 1 ? 's' : ''} of "${item.name}" available in stock.`,
          'danger'
        );
        return;
      }
    }

    const subtotalCheck = verifiedCartItems.reduce(
      (acc, curr) => acc + curr.price * curr.qty,
      0
    );
    if (minOrderAmount > 0 && subtotalCheck < minOrderAmount) {
      triggerHaptic('error');
      showToast(`Minimum order ₹${minOrderAmount} hai!`, 'danger');
      return;
    }

    const paymentDisabled =
      (payload.paymentMode === 'COD' && !allowCod) ||
      (payload.paymentMode === 'UPI' && !allowUpi) ||
      (payload.paymentMode === 'CARD' && !allowCardPayment) ||
      (payload.paymentMode === 'WALLET' && !allowWalletPayment);
    if (paymentDisabled) {
      triggerHaptic('error');
      showToast(
        `${payload.paymentMode} payment is currently disabled by Admin. Please choose another method.`,
        'danger'
      );
      return;
    }

    const address = sanitizeInputBounded(payload.address, 220);
    const phone = payload.phone.replace(/\D/g, '').slice(0, 10);
    const utr = payload.utr.replace(/\D/g, '').slice(0, 12);

    if (address.length < 6) {
      triggerHaptic('error');
      showToast('Poora delivery address enter karein!', 'danger');
      return;
    }
    if (!isValidIndianMobile(phone)) {
      triggerHaptic('error');
      showToast('Valid 10-digit mobile number enter karein!', 'danger');
      return;
    }
    if (payload.paymentMode === 'UPI') {
      const knownUtrs = collectKnownUtrs(cachedOrders, localUsedUtrs);
      const utrCheck = validateUpiUtr(utr, knownUtrs);
      if (!utrCheck.valid) {
        triggerHaptic('error');
        showToast(
          utrCheck.reason || 'Enter a valid 12-digit UPI UTR number!',
          'danger'
        );
        return;
      }
      if (payload.screenshotData) {
        const shotCheck = validateScreenshotPayload(payload.screenshotData);
        if (!shotCheck.valid) {
          triggerHaptic('error');
          showToast(shotCheck.reason || 'Invalid payment screenshot format.', 'danger');
          return;
        }
      }
    }

    let cardLast4 = '';
    if (payload.paymentMode === 'CARD') {
      const cardCheck = validatePaymentCard({
        holderName: payload.cardHolderName || '',
        cardNumber: payload.cardNumber || '',
        expiry: payload.cardExpiry || '',
        cvv: payload.cardCvv || '',
      });
      if (!cardCheck.valid) {
        triggerHaptic('error');
        showToast(cardCheck.reason || 'Enter valid card details!', 'danger');
        return;
      }
      cardLast4 = cardCheck.last4 || '';
    }

    // Group & calculate net payable using catalog-verified prices
    const storeBatches: Record<
      string,
      { storeName: string; items: CartItem[]; subtotal: number }
    > = {};
    let totalItemsSubtotal = 0;
    verifiedCartItems.forEach((item) => {
      const sId = item.storeId || 'general';
      if (!storeBatches[sId]) {
        storeBatches[sId] = {
          storeName: item.storeName || 'Store',
          items: [],
          subtotal: 0,
        };
      }
      storeBatches[sId].items.push(item);
      storeBatches[sId].subtotal += item.price * item.qty;
      totalItemsSubtotal += item.price * item.qty;
    });

    let totalStoreDiscount = 0;
    Object.entries(storeBatches).forEach(([sId, batch]) => {
      const st = stores[sId];
      if (!st) return;
      const pct = Number(st.storeDiscountPercent || 0);
      const minOrd = Number(st.storeDiscountMinOrder || 0);
      if (pct > 0 && batch.subtotal >= minOrd) {
        totalStoreDiscount += Math.round((batch.subtotal * pct) / 100);
      }
    });

    const isFreeDelivery =
      (allowChutkiPlus && isPlusActive) || totalItemsSubtotal >= freeDeliveryMinOrder;
    const delCharge = isFreeDelivery ? 0 : baseDeliveryCharge;
    const activeHandling = handlingFee > 0 ? handlingFee : 0;
    const cleanTip = allowRiderTip
      ? Math.max(0, Math.min(500, Math.round(Number(payload.riderTip || 0))))
      : 0;
    const deliverySlot = allowScheduledDelivery
      ? sanitizeInputBounded(payload.deliverySlot || 'EXPRESS_15', 60)
      : 'EXPRESS_15';
    const targetCouponCode = (cmsCouponCode || 'GOSSAIGAON20').trim().toUpperCase();
    const targetCouponDiscount = cmsCouponDiscount > 0 ? cmsCouponDiscount : 20;
    const targetCouponMinOrder = cmsCouponMinOrder > 0 ? cmsCouponMinOrder : 100;
    const submittedCouponCode = (payload.appliedCouponCode || '').trim().toUpperCase();
    const isCouponValid =
      allowCoupons &&
      Number(payload.appliedDiscount || 0) > 0 &&
      submittedCouponCode === targetCouponCode &&
      totalItemsSubtotal >= targetCouponMinOrder;
    const effectiveCouponDiscount = isCouponValid ? targetCouponDiscount : 0;
    const effectiveCouponCode = isCouponValid ? submittedCouponCode : '';
    const netPayableTotal = Math.max(
      1,
      totalItemsSubtotal +
        delCharge +
        activeHandling +
        cleanTip -
        totalStoreDiscount -
        effectiveCouponDiscount
    );

    const cashbackEligibleAmount = Math.max(
      0,
      totalItemsSubtotal - totalStoreDiscount - effectiveCouponDiscount
    );
    const cashbackEarned = allowCashback
      ? calculateOrderCashback(
          cashbackEligibleAmount,
          payload.paymentMode,
          cashbackPercent
        )
      : 0;

    if (payload.paymentMode === 'WALLET') {
      const curBal = Number(customerProfile?.walletBalance || 0);
      if (curBal < netPayableTotal) {
        triggerHaptic('error');
        showToast(
          `Insufficient Wallet balance (Need ₹${netPayableTotal.toFixed(0)})!`,
          'danger'
        );
        return;
      }
    }

    const fraudCheck = evaluateOrderFraudShield({
      orders: cachedOrders,
      totalAmount: netPayableTotal,
      paymentMode: payload.paymentMode,
      customerBlocked: customerProfile?.blocked === true,
      spamScore: customerProfile?.spamScore,
      strictAntiScamShield,
      codMaxOrderAmount,
      maxActiveOrdersPerUser,
      blockCodForFlaggedUsers,
      spamAutoBlockThreshold,
    });
    if (fraudCheck.block && fraudCheck.reason) {
      triggerHaptic('error');
      showToast(fraudCheck.reason, 'danger');
      return;
    }

    const spamCheck = evaluateSpamRisk(
      cachedOrders,
      netPayableTotal,
      payload.paymentMode
    );
    if (spamCheck.block && spamCheck.reason) {
      triggerHaptic('error');
      showToast(spamCheck.reason, 'danger');
      return;
    }

    setIsPlacingOrder(true);

    try {
      if (!isDemoMode && payload.paymentMode === 'UPI' && strictAntiScamShield) {
        const existingUtrSnap = await get(ref(db, `usedUtrs/${utr}`));
        if (existingUtrSnap.exists()) {
          triggerHaptic('error');
          showToast(
            '🛡️ This UPI UTR has already been submitted. Duplicate UTR replay is blocked.',
            'danger'
          );
          return;
        }
      }
      const storeCount = Object.keys(storeBatches).length;
      const deliveryOtp = Math.floor(1000 + Math.random() * 9000).toString();
      const deliveryQrToken = generateDeliveryQrToken();
      const accurateLocationLink =
        detectedLat && detectedLng
          ? `https://www.google.com/maps?q=${detectedLat},${detectedLng}`
          : '';
      const batchGroupId = 'COMBO_' + Date.now();
      const cardTxRef = payload.paymentMode === 'CARD' ? `CARD_${Date.now().toString().slice(-8)}` : '';

      if (isDemoMode) {
        const newOrders: Record<string, Omit<OrderRecord, 'orderId'>> = {};
        let isFirstStore = true;
        let remainingCoupon = effectiveCouponDiscount;
        Object.entries(storeBatches).forEach(([sId, batch], idx) => {
          const currentStore = stores[sId] || {};
          const assignedRiderUid = findNearestAvailableRider(
            deliveryPartners,
            currentStore.lat,
            currentStore.lng
          );
          const assignedRiderObj = assignedRiderUid
            ? deliveryPartners[assignedRiderUid]
            : null;
          const isFirst = isFirstStore;
          const batchDeliveryCharge = isFreeDelivery
            ? 0
            : isFirst
              ? baseDeliveryCharge
              : 0;
          const batchHandlingFee =
            handlingFee > 0 && isFirst ? handlingFee : 0;
          const batchTip = isFirst ? cleanTip : 0;
          const batchCashback = isFirst ? cashbackEarned : 0;
          const pct = Number(currentStore.storeDiscountPercent || 0);
          const minOrd = Number(currentStore.storeDiscountMinOrder || 0);
          const batchStoreDiscount =
            pct > 0 && batch.subtotal >= minOrd
              ? Math.round((batch.subtotal * pct) / 100)
              : 0;
          const maxCouponForBatch = Math.max(0, batch.subtotal - batchStoreDiscount);
          const batchCouponDiscount = Math.min(remainingCoupon, maxCouponForBatch);
          remainingCoupon = Math.max(0, remainingCoupon - batchCouponDiscount);
          isFirstStore = false;

          const batchTotal = Math.max(
            1,
            batch.subtotal +
              batchDeliveryCharge +
              batchHandlingFee +
              batchTip -
              batchStoreDiscount -
              batchCouponDiscount
          );

          newOrders[`ord_${Date.now()}_${idx}`] = {
            batchGroupId,
            customerUid: activeUid,
            restaurantId: sId,
            deliveryUid: assignedRiderUid || null,
            riderLat: assignedRiderObj?.lat || null,
            riderLng: assignedRiderObj?.lng || null,
            assignedAt: assignedRiderUid ? Date.now() : null,
            items: batch.items,
            subtotalAmount: Number(batch.subtotal.toFixed(2)),
            deliveryCharge: Number(batchDeliveryCharge.toFixed(2)),
            handlingFee: Number(batchHandlingFee.toFixed(2)),
            riderTip: batchTip,
            deliverySlot,
            cashbackEarned: batchCashback,
            storeDiscountAmount: Number(batchStoreDiscount.toFixed(2)),
            discountAmount: Number(batchCouponDiscount.toFixed(2)),
            couponCode: effectiveCouponCode,
            totalAmount: Number(batchTotal.toFixed(2)),
            address,
            phone,
            customerLat: detectedLat || null,
            customerLng: detectedLng || null,
            locationLink: accurateLocationLink,
            deliveryOtp,
            deliveryQrToken,
            status: 'PLACED',
            paymentMode: payload.paymentMode,
            paymentStatus:
              payload.paymentMode === 'UPI'
                ? 'PENDING_VERIFICATION'
                : payload.paymentMode === 'WALLET' || payload.paymentMode === 'CARD'
                  ? 'VERIFIED'
                  : 'COD',
            transactionId:
              payload.paymentMode === 'UPI'
                ? utr
                : payload.paymentMode === 'CARD'
                  ? cardTxRef
                  : '',
            ...(cardLast4 ? { cardLast4 } : {}),
            paymentScreenshot:
              payload.paymentMode === 'UPI' ? payload.screenshotData || '' : '',
            placedAt: Date.now(),
            statusTimestamps: { PLACED: Date.now() },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
        });

        // Update Demo stock counts
        setAllMenus((prev) => {
          const next = { ...prev };
          verifiedCartItems.forEach((item) => {
            const existing = next[item.storeId]?.[item.itemId];
            if (existing && typeof existing.stockCount === 'number') {
              next[item.storeId] = {
                ...next[item.storeId],
                [item.itemId]: {
                  ...existing,
                  stockCount: Math.max(0, existing.stockCount - item.qty),
                },
              };
            }
          });
          return next;
        });

        const walletDelta =
          (payload.paymentMode === 'WALLET' ? -netPayableTotal : 0) + cashbackEarned;
        if (walletDelta !== 0 || cashbackEarned > 0) {
          setCustomerProfile((prev) => ({
            ...(prev || {}),
            walletBalance: Math.max(
              0,
              Number((Number(prev?.walletBalance || 0) + walletDelta).toFixed(2))
            ),
            totalCashbackEarned:
              Number(prev?.totalCashbackEarned || 0) + cashbackEarned,
          }));
          setWalletTransactions((prev) => {
            const added: Record<string, WalletTransaction> = {};
            const nowTs = Date.now();
            if (payload.paymentMode === 'WALLET') {
              added[`tx_deb_${nowTs}`] = {
                type: 'DEBIT',
                amount: Number(netPayableTotal.toFixed(2)),
                note: 'Paid for grocery order',
                createdAt: nowTs,
              };
            }
            if (cashbackEarned > 0) {
              added[`tx_cb_${nowTs + 1}`] = {
                type: 'CREDIT',
                amount: cashbackEarned,
                note: `🎉 ${cashbackPercent}% Cashback (${payload.paymentMode})`,
                createdAt: nowTs + 1,
              };
            }
            return { ...prev, ...added };
          });
        }

        const createdOrderIds = Object.keys(newOrders);
        setCachedOrders((prev) => ({ ...newOrders, ...prev }));
        if (payload.paymentMode === 'UPI') {
          recordUsedUtr(utr);
        }
        setCartItems([]);
        setIsCheckoutOpen(false);
        setMenuStoreId(null);
        switchNav('orders');
        triggerHaptic('success');
        if (cashbackEarned > 0) {
          showToast(
            `🎉 Order placed! ₹${cashbackEarned} cashback credited to Bazar Wallet.`,
            'success'
          );
        }

        const stageTransitions: Array<{ delayMs: number; nextStatus: string }> = [
          { delayMs: 2800, nextStatus: 'PREPARING' },
          { delayMs: 5600, nextStatus: 'PACKING' },
          { delayMs: 8400, nextStatus: 'OUT_FOR_DELIVERY' },
        ];
        stageTransitions.forEach(({ delayMs, nextStatus }) => {
          const timerId = setTimeout(() => {
            const transitionTs = Date.now();
            setCachedOrders((prev) => {
              let changed = false;
              const updated = { ...prev };
              createdOrderIds.forEach((id) => {
                const cur = updated[id];
                if (cur && cur.status !== 'CANCELLED' && cur.status !== 'DELIVERED') {
                  updated[id] = {
                    ...cur,
                    status: nextStatus,
                    statusTimestamps: {
                      ...(cur.statusTimestamps || {}),
                      [nextStatus]: transitionTs,
                    },
                    updatedAt: transitionTs,
                  };
                  changed = true;
                }
              });
              return changed ? updated : prev;
            });
          }, delayMs);
          demoProgressTimersRef.current.push(timerId);
        });

        pushNotification(
          {
            id: `placed_${batchGroupId}`,
            title: `🛍️ Order Placed! PIN: ${deliveryOtp}`,
            body: `Your order from ${storeCount} store${storeCount > 1 ? 's' : ''} is scheduled (${deliverySlot === 'EXPRESS_15' ? '15-min Express' : deliverySlot}).${allowDeliveryQr ? ' Delivery PIN & QR ready.' : ''}`,
            tag: `gb-order-${batchGroupId}`,
            type: 'ORDER',
            targetTab: 'orders',
            createdAt: Date.now(),
            read: false,
          },
          true
        );
        return;
      }

      if (payload.paymentMode === 'WALLET') {
        const txResult = await runTransaction(
          ref(db, `customers/${activeUid}/walletBalance`),
          (bal) => {
            const cur = Number(bal || 0);
            if (cur < netPayableTotal) return;
            return Number((cur - netPayableTotal).toFixed(2));
          }
        );
        if (!txResult.committed) {
          triggerHaptic('error');
          showToast('Insufficient Wallet balance!', 'danger');
          return;
        }
        await push(ref(db, `walletTransactions/${activeUid}`), {
          type: 'DEBIT',
          amount: Number(netPayableTotal.toFixed(2)),
          note: 'Paid for grocery order',
          createdAt: Date.now(),
        });
      }

      const orderPromises: Array<PromiseLike<unknown>> = [];
      let isFirstStore = true;
      let remainingCoupon = effectiveCouponDiscount;

      Object.entries(storeBatches).forEach(([sId, batch]) => {
        const currentStore = stores[sId] || {};
        const assignedRiderUid = findNearestAvailableRider(
          deliveryPartners,
          currentStore.lat,
          currentStore.lng
        );
        const assignedRiderObj = assignedRiderUid
          ? deliveryPartners[assignedRiderUid]
          : null;
        const isFirst = isFirstStore;
        const batchDeliveryCharge = isFreeDelivery
          ? 0
          : isFirst
            ? baseDeliveryCharge
            : 0;
        const batchHandlingFee =
          handlingFee > 0 && isFirst ? handlingFee : 0;
        const batchTip = isFirst ? cleanTip : 0;
        const batchCashback = isFirst ? cashbackEarned : 0;
        const pct = Number(currentStore.storeDiscountPercent || 0);
        const minOrd = Number(currentStore.storeDiscountMinOrder || 0);
        const batchStoreDiscount =
          pct > 0 && batch.subtotal >= minOrd
            ? Math.round((batch.subtotal * pct) / 100)
            : 0;
        const maxCouponForBatch = Math.max(0, batch.subtotal - batchStoreDiscount);
        const batchCouponDiscount = Math.min(remainingCoupon, maxCouponForBatch);
        remainingCoupon = Math.max(0, remainingCoupon - batchCouponDiscount);
        isFirstStore = false;

        const batchTotal = Math.max(
          1,
          batch.subtotal +
            batchDeliveryCharge +
            batchHandlingFee +
            batchTip -
            batchStoreDiscount -
            batchCouponDiscount
        );

        const orderData = {
          batchGroupId,
          customerUid: activeUid,
          restaurantId: sId,
          deliveryUid: assignedRiderUid || null,
          riderLat: assignedRiderObj?.lat || null,
          riderLng: assignedRiderObj?.lng || null,
          assignedAt: assignedRiderUid ? Date.now() : null,
          items: batch.items,
          subtotalAmount: Number(batch.subtotal.toFixed(2)),
          deliveryCharge: Number(batchDeliveryCharge.toFixed(2)),
          handlingFee: Number(batchHandlingFee.toFixed(2)),
          riderTip: batchTip,
          deliverySlot,
          cashbackEarned: batchCashback,
          storeDiscountAmount: Number(batchStoreDiscount.toFixed(2)),
          discountAmount: Number(batchCouponDiscount.toFixed(2)),
          couponCode: effectiveCouponCode,
          totalAmount: Number(batchTotal.toFixed(2)),
          address,
          phone,
          customerLat: detectedLat || null,
          customerLng: detectedLng || null,
          locationLink: accurateLocationLink,
          deliveryOtp,
          deliveryQrToken,
          status: 'PLACED',
          paymentMode: payload.paymentMode,
          paymentStatus:
            payload.paymentMode === 'UPI'
              ? 'PENDING_VERIFICATION'
              : payload.paymentMode === 'WALLET' || payload.paymentMode === 'CARD'
                ? 'VERIFIED'
                : 'COD',
          transactionId:
            payload.paymentMode === 'UPI'
              ? utr
              : payload.paymentMode === 'CARD'
                ? cardTxRef
                : '',
          ...(cardLast4 ? { cardLast4 } : {}),
          paymentScreenshot:
            payload.paymentMode === 'UPI' ? payload.screenshotData || '' : '',
          isSpamSuspect: spamCheck.isSpamSuspect || false,
          spamReason: spamCheck.spamReason || '',
          placedAt: Date.now(),
          statusTimestamps: { PLACED: Date.now() },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        orderPromises.push(push(ref(db, 'orders'), stripForbiddenKeysDeep(orderData)));
      });

      await Promise.all(orderPromises);

      if (payload.paymentMode === 'UPI' && strictAntiScamShield && activeUid) {
        await set(ref(db, `usedUtrs/${utr}`), {
          uid: activeUid,
          createdAt: Date.now(),
        }).catch(() => undefined);
      }

      // Decrement product stockCount in RTDB if configured
      verifiedCartItems.forEach((item) => {
        const menuProd = allMenus[item.storeId]?.[item.itemId];
        if (menuProd && typeof menuProd.stockCount === 'number') {
          void runTransaction(
            ref(db, `menus/${item.storeId}/${item.itemId}/stockCount`),
            (curStock) => {
              if (curStock === null || curStock === undefined) return curStock;
              return Math.max(0, Number(curStock) - item.qty);
            }
          );
        }
      });

      // Credit prepaid wallet cashback if earned
      if (cashbackEarned > 0) {
        await runTransaction(
          ref(db, `customers/${activeUid}/walletBalance`),
          (bal) => Number((Number(bal || 0) + cashbackEarned).toFixed(2))
        );
        await runTransaction(
          ref(db, `customers/${activeUid}/totalCashbackEarned`),
          (tot) => Number((Number(tot || 0) + cashbackEarned).toFixed(2))
        );
        await push(ref(db, `walletTransactions/${activeUid}`), {
          type: 'CREDIT',
          amount: cashbackEarned,
          note: `🎉 ${cashbackPercent}% Cashback (${payload.paymentMode})`,
          createdAt: Date.now(),
        });
      }

      if (payload.paymentMode === 'UPI') {
        recordUsedUtr(utr);
      }
      if (spamCheck.isSpamSuspect || fraudCheck.isSpamSuspect) {
        void runTransaction(
          ref(db, `customers/${activeUid}/spamScore`),
          (s) => Number(s || 0) + 1
        );
      }

      setCartItems([]);
      setIsCheckoutOpen(false);
      setMenuStoreId(null);
      switchNav('orders');
      triggerHaptic('success');
      if (cashbackEarned > 0) {
        showToast(
          `🎉 Order placed! ₹${cashbackEarned} cashback credited to Bazar Wallet.`,
          'success'
        );
      }
      pushNotification(
        {
          id: `placed_${batchGroupId}`,
          title: `🛍️ Order Placed! PIN: ${deliveryOtp}`,
          body: `Your order from ${storeCount} store${storeCount > 1 ? 's' : ''} is scheduled (${deliverySlot === 'EXPRESS_15' ? '15-min Express' : deliverySlot}).${allowDeliveryQr ? ' Delivery PIN & QR ready.' : ''}`,
          tag: `gb-order-${batchGroupId}`,
          type: 'ORDER',
          targetTab: 'orders',
          createdAt: Date.now(),
          read: false,
        },
        true
      );
    } catch (err) {
      triggerHaptic('error');
      showToast(
        'Error: ' + (err instanceof Error ? err.message : 'Order failed'),
        'danger'
      );
    } finally {
      setIsPlacingOrder(false);
    }
  };

  // Wallet Deposit / Withdraw
  const handleWalletDepositSubmit = async (
    amt: number,
    utrRaw: string,
    screenshotData: string
  ) => {
    if (isSubmittingAction) return;
    if (strictAntiScamShield) {
      const rateCheck = evaluateActionRateLimit(
        actionRateHistoryRef.current,
        'DEPOSIT',
        actionCooldownMs,
        5
      );
      if (!rateCheck.allowed) {
        showToast(rateCheck.reason || 'Please wait before another deposit.', 'danger');
        return;
      }
    }
    const cleanAmt = Number(amt);
    if (!Number.isFinite(cleanAmt) || cleanAmt < minCustomerDeposit || cleanAmt > maxCustomerDeposit) {
      showToast(
        `Deposit limit: ₹${minCustomerDeposit} to ₹${maxCustomerDeposit}!`,
        'danger'
      );
      return;
    }
    const cleanUtr = utrRaw.replace(/\D/g, '').slice(0, 12);
    const knownUtrs = collectKnownUtrs(cachedOrders, localUsedUtrs);
    const utrCheck = validateUpiUtr(cleanUtr, knownUtrs);
    if (!utrCheck.valid) {
      showToast(utrCheck.reason || 'Enter valid 12-digit UTR number!', 'danger');
      return;
    }
    if (screenshotData) {
      const shotCheck = validateScreenshotPayload(screenshotData);
      if (!shotCheck.valid) {
        showToast(shotCheck.reason || 'Invalid payment screenshot.', 'danger');
        return;
      }
    }
    if (!isDemoMode && !activeUid) return;

    setIsSubmittingAction(true);
    try {
      if (isDemoMode) {
        recordRateLimitedAction(actionRateHistoryRef.current, 'DEPOSIT');
        recordUsedUtr(cleanUtr);
        setIsDepositOpen(false);
        showToast('✅ Deposit request sent to Admin for verification!', 'success');
        return;
      }
      if (strictAntiScamShield) {
        const existingUtrSnap = await get(ref(db, `usedUtrs/${cleanUtr}`));
        if (existingUtrSnap.exists()) {
          showToast(
            '🛡️ This UTR has already been submitted. Duplicate UTR replay is blocked.',
            'danger'
          );
          return;
        }
      }
      await push(ref(db, 'walletRequests'), {
        type: 'DEPOSIT',
        customerUid: activeUid,
        customerName: customerProfile?.name || 'Customer',
        customerPhone: customerProfile?.phone || '',
        amount: cleanAmt,
        utr: cleanUtr,
        screenshot: screenshotData || '',
        status: 'PENDING',
        createdAt: Date.now(),
      });
      if (strictAntiScamShield && activeUid) {
        await set(ref(db, `usedUtrs/${cleanUtr}`), {
          uid: activeUid,
          createdAt: Date.now(),
        }).catch(() => undefined);
      }
      recordRateLimitedAction(actionRateHistoryRef.current, 'DEPOSIT');
      recordUsedUtr(cleanUtr);
      setIsDepositOpen(false);
      showToast('✅ Deposit request sent to Admin for verification!', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to submit deposit request.',
        'danger'
      );
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleWalletWithdrawSubmit = async (amt: number, upiIdRaw: string) => {
    if (isSubmittingAction) return;
    const bal = Number(customerProfile?.walletBalance || 0);
    const upiId = sanitizeInputBounded(upiIdRaw, 80);
    const safety = evaluateWalletWithdrawalSafety({
      amount: Number(amt),
      balance: bal,
      minWithdraw: minCustomerWithdraw,
      maxWithdraw: maxCustomerWithdraw,
      upiId,
      lastWithdrawAt: lastWithdrawAtRef.current,
    });
    if (!safety.allowed) {
      showToast(safety.reason || 'Invalid withdrawal request!', 'danger');
      return;
    }
    if (!isDemoMode && !activeUid) return;

    setIsSubmittingAction(true);
    try {
      if (isDemoMode) {
        lastWithdrawAtRef.current = Date.now();
        setCustomerProfile((prev) => ({
          ...(prev || {}),
          walletBalance: Math.max(0, bal - amt),
        }));
        setWalletTransactions((prev) => ({
          ...prev,
          [`tx_wd_${Date.now()}`]: {
            type: 'DEBIT',
            amount: amt,
            note: `Withdrawal requested to ${upiId}`,
            createdAt: Date.now(),
          },
        }));
        setIsWithdrawOpen(false);
        showToast('✅ Withdrawal request submitted to Admin!', 'success');
        return;
      }
      const txRes = await runTransaction(
        ref(db, `customers/${activeUid}/walletBalance`),
        (b) => {
          const cur = Number(b || 0);
          if (cur < amt) return;
          return Math.max(0, cur - amt);
        }
      );
      if (!txRes.committed) {
        showToast('Insufficient wallet balance!', 'danger');
        return;
      }
      lastWithdrawAtRef.current = Date.now();
      await push(ref(db, `walletTransactions/${activeUid}`), {
        type: 'DEBIT',
        amount: amt,
        note: `Withdrawal requested to ${upiId}`,
        createdAt: Date.now(),
      });
      await push(ref(db, 'walletRequests'), {
        type: 'WITHDRAW',
        customerUid: activeUid,
        customerName: customerProfile?.name || 'Customer',
        customerPhone: customerProfile?.phone || '',
        amount: amt,
        upiId,
        status: 'PENDING',
        createdAt: Date.now(),
      });
      setIsWithdrawOpen(false);
      showToast('✅ Withdrawal request submitted to Admin!', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Failed to submit withdrawal request.',
        'danger'
      );
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Ratings & Reviews
  const handleSubmitRiderRating = async (
    group: ReturnType<typeof groupCustomerOrders>[number],
    stars: number,
    comment: string
  ) => {
    if (!group.deliveryUid || !activeUid || isSubmittingAction) return;
    if (group.orders.every((o) => Number(o.riderRating || 0) > 0)) {
      setRatingModalState(null);
      showToast('You have already rated this rider!', 'info');
      return;
    }
    const cleanStars = Math.min(5, Math.max(1, Number(stars || 5)));
    const cleanComment = sanitizeInputBounded(comment, 240);
    if (strictAntiScamShield) {
      const commentCheck = detectSpamContent(cleanComment);
      if (!commentCheck.safe) {
        showToast(commentCheck.reason || 'Suspicious text blocked.', 'danger');
        return;
      }
    }
    const ratedAt = Date.now();

    setIsSubmittingAction(true);
    try {
      if (isDemoMode) {
        const riderUid = group.deliveryUid;
        setDeliveryPartners((prev) => {
          const r = prev[riderUid];
          if (!r) return prev;
          const prevCount = Number(r.ratingCount || 0);
          const prevAvg = Number(r.ratingAvg || 5);
          const newCount = prevCount + 1;
          const newAvg = Number((((prevAvg * prevCount) + cleanStars) / newCount).toFixed(2));
          return { ...prev, [riderUid]: { ...r, ratingAvg: newAvg, ratingCount: newCount } };
        });
        setCachedOrders((prev) => {
          const next = { ...prev };
          group.orders.forEach((o) => {
            if (next[o.orderId]) {
              next[o.orderId] = {
                ...next[o.orderId],
                riderRating: cleanStars,
                riderReview: cleanComment,
                riderRatedAt: ratedAt,
              };
            }
          });
          return next;
        });
        setRatingModalState(null);
        triggerHaptic('success');
        showToast('⭐ Thank you for rating the rider!', 'success');
        return;
      }

      const riderUid = group.deliveryUid;
      const riderSnap = await get(ref(db, `deliveryPartners/${riderUid}`));
      const rData = (riderSnap.val() || {}) as DeliveryPartner;
      const prevCount = Number(rData.ratingCount || 0);
      const prevAvg = Number(rData.ratingAvg || 5);
      const newCount = prevCount + 1;
      const newAvg = Number(
        (((prevAvg * prevCount) + cleanStars) / newCount).toFixed(2)
      );

      await update(ref(db, `deliveryPartners/${riderUid}`), {
        ratingAvg: newAvg,
        ratingCount: newCount,
      });
      await push(ref(db, `riderRatings/${riderUid}`), {
        orderGroup: group.groupKey,
        customerUid: activeUid,
        customerName: customerProfile?.name || 'Customer',
        rating: cleanStars,
        comment: cleanComment,
        createdAt: ratedAt,
      });
      await Promise.all(
        group.orders.map((o) =>
          update(ref(db, `orders/${o.orderId}`), {
            riderRating: cleanStars,
            riderReview: cleanComment,
            riderRatedAt: ratedAt,
          })
        )
      );
      setRatingModalState(null);
      triggerHaptic('success');
      showToast('⭐ Thank you for rating the rider!', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not submit rider rating.',
        'danger'
      );
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleSubmitProductReviews = async (
    group: ReturnType<typeof groupCustomerOrders>[number],
    reviewsInput: Record<string, { rating: number; review: string }>
  ) => {
    if (!activeUid || isSubmittingAction) return;
    if (group.orders.every((o) => o.productsReviewed === true)) {
      setRatingModalState(null);
      showToast('Products already reviewed!', 'info');
      return;
    }

    if (strictAntiScamShield) {
      for (const entry of Object.values(reviewsInput)) {
        const clean = sanitizeInputBounded(entry?.review || '', 240);
        if (clean) {
          const check = detectSpamContent(clean);
          if (!check.safe) {
            showToast(check.reason || 'Suspicious text blocked in product review.', 'danger');
            return;
          }
        }
      }
    }

    setIsSubmittingAction(true);
    try {
      if (isDemoMode) {
        setCachedOrders((prev) => {
          const next = { ...prev };
          group.orders.forEach((o) => {
            if (next[o.orderId]) {
              next[o.orderId] = { ...next[o.orderId], productsReviewed: true };
            }
          });
          return next;
        });
        setAllMenus((prev) => {
          const next = { ...prev };
          group.orders.forEach((o, oIdx) => {
            const raw = Array.isArray(o.items) ? o.items : Object.values(o.items || {});
            raw.forEach((item, iIdx) => {
              const uidKey = `${oIdx}_${iIdx}`;
              const entry = reviewsInput[uidKey] || { rating: 5, review: '' };
              const rating = Math.min(5, Math.max(1, Number(entry.rating || 5)));
              const sId = item.storeId || o.restaurantId;
              const iId = item.itemId;
              const existing = sId && iId ? next[sId]?.[iId] : null;
              if (existing) {
                const prevC = Number(existing.ratingCount || 0);
                const prevA = Number(existing.ratingAvg || 5);
                const nC = prevC + 1;
                const nA = Number((((prevA * prevC) + rating) / nC).toFixed(2));
                next[sId] = {
                  ...next[sId],
                  [iId]: { ...existing, ratingAvg: nA, ratingCount: nC },
                };
              }
            });
          });
          return next;
        });
        setRatingModalState(null);
        triggerHaptic('success');
        showToast('🎉 Product reviews published!', 'success');
        return;
      }

      for (let oIdx = 0; oIdx < group.orders.length; oIdx++) {
        const o = group.orders[oIdx];
        const raw = Array.isArray(o.items) ? o.items : Object.values(o.items || {});
        for (let iIdx = 0; iIdx < raw.length; iIdx++) {
          const item = raw[iIdx];
          const uidKey = `${oIdx}_${iIdx}`;
          const entry = reviewsInput[uidKey] || { rating: 5, review: '' };
          const rating = Math.min(5, Math.max(1, Number(entry.rating || 5)));
          const review = sanitizeInputBounded(entry.review, 240);
          const sId = item.storeId || o.restaurantId;
          const iId = item.itemId;
          if (sId && iId) {
            await set(
              ref(db, `productReviews/${sId}/${iId}/${o.orderId}_${activeUid}`),
              {
                customerName: customerProfile?.name || 'Verified Buyer',
                rating,
                review,
                createdAt: Date.now(),
              }
            );
            const mSnap = await get(ref(db, `menus/${sId}/${iId}`));
            if (mSnap.exists()) {
              const mData = mSnap.val() as MenuItem;
              const prevC = Number(mData.ratingCount || 0);
              const prevA = Number(mData.ratingAvg || 5);
              const nC = prevC + 1;
              const nA = Number((((prevA * prevC) + rating) / nC).toFixed(2));
              await update(ref(db, `menus/${sId}/${iId}`), {
                ratingAvg: nA,
                ratingCount: nC,
              });
            }
          }
        }
        await update(ref(db, `orders/${o.orderId}`), { productsReviewed: true });
      }
      setRatingModalState(null);
      triggerHaptic('success');
      showToast('🎉 Product reviews published!', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not publish product reviews.',
        'danger'
      );
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleSubmitStoreRating = async (
    group: ReturnType<typeof groupCustomerOrders>[number],
    stars: number,
    comment: string
  ) => {
    if (!activeUid || isSubmittingAction) return;
    if (!allowStoreRatings) {
      showToast('Store ratings are currently disabled by Admin.', 'info');
      return;
    }
    if (group.orders.every((o) => Number(o.storeRating || 0) > 0)) {
      setRatingModalState(null);
      showToast('You have already rated this store!', 'info');
      return;
    }
    const cleanStars = Math.min(5, Math.max(1, Number(stars || 5)));
    const cleanComment = sanitizeInputBounded(comment, 240);
    if (strictAntiScamShield) {
      const commentCheck = detectSpamContent(cleanComment);
      if (!commentCheck.safe) {
        showToast(commentCheck.reason || 'Suspicious text blocked.', 'danger');
        return;
      }
    }
    const storeIds = Array.from(
      new Set(group.orders.map((o) => o.restaurantId).filter(Boolean))
    );

    setIsSubmittingAction(true);
    try {
      if (isDemoMode) {
        setStores((prev) => {
          const next = { ...prev };
          storeIds.forEach((sId) => {
            const st = next[sId] || {};
            const prevCount = Number(st.ratingCount || 0);
            const prevAvg = Number(st.ratingAvg || 4.8);
            const newCount = prevCount + 1;
            const newAvg = Number((((prevAvg * prevCount) + cleanStars) / newCount).toFixed(2));
            next[sId] = { ...st, ratingAvg: newAvg, ratingCount: newCount };
          });
          return next;
        });
        setCachedOrders((prev) => {
          const next = { ...prev };
          group.orders.forEach((o) => {
            if (next[o.orderId]) {
              next[o.orderId] = {
                ...next[o.orderId],
                storeRating: cleanStars,
                storeReview: cleanComment,
              };
            }
          });
          return next;
        });
        setRatingModalState(null);
        triggerHaptic('success');
        showToast('🏪 Thank you for rating the store!', 'success');
        return;
      }

      for (const sId of storeIds) {
        const storeSnap = await get(ref(db, `restaurants/${sId}`));
        const sData = (storeSnap.val() || {}) as Store;
        const prevCount = Number(sData.ratingCount || 0);
        const prevAvg = Number(sData.ratingAvg || 4.8);
        const newCount = prevCount + 1;
        const newAvg = Number((((prevAvg * prevCount) + cleanStars) / newCount).toFixed(2));
        await update(ref(db, `restaurants/${sId}`), {
          ratingAvg: newAvg,
          ratingCount: newCount,
        });
        await push(ref(db, `storeRatings/${sId}`), {
          orderGroup: group.groupKey,
          customerUid: activeUid,
          customerName: customerProfile?.name || 'Customer',
          rating: cleanStars,
          comment: cleanComment,
          createdAt: Date.now(),
        });
      }
      await Promise.all(
        group.orders.map((o) =>
          update(ref(db, `orders/${o.orderId}`), {
            storeRating: cleanStars,
            storeReview: cleanComment,
          })
        )
      );
      setRatingModalState(null);
      triggerHaptic('success');
      showToast('🏪 Thank you for rating the store!', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not submit store rating.',
        'danger'
      );
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleTipRiderOnOrder = async (
    group: ReturnType<typeof groupCustomerOrders>[number],
    tipAmount: number,
    payVia: 'WALLET' | 'DOORSTEP'
  ) => {
    if (!activeUid || isSubmittingAction) return;
    if (!allowRiderTip) {
      showToast('Rider tipping is currently disabled by Admin.', 'info');
      return;
    }
    const cleanTip = Math.round(Number(tipAmount || 0));
    if (!Number.isFinite(cleanTip) || cleanTip < 5 || cleanTip > 500) {
      triggerHaptic('error');
      showToast('Enter a valid rider tip between ₹5 and ₹500!', 'danger');
      return;
    }
    const primaryOrder = group.orders[0];
    if (!primaryOrder) return;

    if (payVia === 'WALLET') {
      const curBal = Number(customerProfile?.walletBalance || 0);
      if (curBal < cleanTip) {
        triggerHaptic('error');
        showToast(
          `Insufficient Wallet balance (Need ₹${cleanTip})!`,
          'danger'
        );
        return;
      }
    }

    setIsSubmittingAction(true);
    try {
      if (isDemoMode) {
        if (payVia === 'WALLET') {
          setCustomerProfile((prev) => ({
            ...(prev || {}),
            walletBalance: Math.max(
              0,
              Number((Number(prev?.walletBalance || 0) - cleanTip).toFixed(2))
            ),
          }));
          setWalletTransactions((prev) => ({
            ...prev,
            [`tx_tip_${Date.now()}`]: {
              type: 'DEBIT',
              amount: cleanTip,
              note: `🛵 Rider tip for order #${group.groupKey.slice(-6)}`,
              createdAt: Date.now(),
            },
          }));
        }
        setCachedOrders((prev) => {
          const cur = prev[primaryOrder.orderId];
          if (!cur) return prev;
          return {
            ...prev,
            [primaryOrder.orderId]: {
              ...cur,
              riderTip: Number(cur.riderTip || 0) + cleanTip,
              totalAmount: Number((Number(cur.totalAmount || 0) + cleanTip).toFixed(2)),
            },
          };
        });
        setTipRiderGroupKey(null);
        triggerHaptic('success');
        showToast(`❤️ ₹${cleanTip} tip added for your delivery partner!`, 'success');
        return;
      }

      if (payVia === 'WALLET') {
        const txRes = await runTransaction(
          ref(db, `customers/${activeUid}/walletBalance`),
          (bal) => {
            const cur = Number(bal || 0);
            if (cur < cleanTip) return;
            return Number((cur - cleanTip).toFixed(2));
          }
        );
        if (!txRes.committed) {
          triggerHaptic('error');
          showToast('Insufficient Wallet balance!', 'danger');
          return;
        }
        await push(ref(db, `walletTransactions/${activeUid}`), {
          type: 'DEBIT',
          amount: cleanTip,
          note: `🛵 Rider tip for order #${group.groupKey.slice(-6)}`,
          createdAt: Date.now(),
        });
      }

      await update(ref(db, `orders/${primaryOrder.orderId}`), {
        riderTip: Number(primaryOrder.riderTip || 0) + cleanTip,
        totalAmount: Number((Number(primaryOrder.totalAmount || 0) + cleanTip).toFixed(2)),
        updatedAt: Date.now(),
      });
      setTipRiderGroupKey(null);
      triggerHaptic('success');
      showToast(`❤️ ₹${cleanTip} tip added for your delivery partner!`, 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not add rider tip.',
        'danger'
      );
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleSubmitRefundRequest = async (
    order: OrderRecord,
    reason: string,
    method: 'WALLET' | 'ORIGINAL',
    note: string
  ) => {
    if (!activeUid || isSubmittingAction) return;
    if (!allowRefundRequests) {
      showToast('Refund requests are currently disabled by Admin.', 'info');
      return;
    }
    if (order.customerUid && order.customerUid !== activeUid) {
      showToast('🛡️ Unauthorized refund request blocked.', 'danger');
      return;
    }
    if (normalizeOrderStatus(order.status) !== 'DELIVERED') {
      showToast('🛡️ Refunds are only allowed for delivered orders.', 'danger');
      return;
    }
    if (order.refundStatus && order.refundStatus !== 'NONE') {
      setRefundOrderTarget(null);
      showToast('Refund request already submitted for this order.', 'info');
      return;
    }
    if (strictAntiScamShield) {
      const rateCheck = evaluateActionRateLimit(
        actionRateHistoryRef.current,
        'REFUND',
        actionCooldownMs,
        4
      );
      if (!rateCheck.allowed) {
        showToast(rateCheck.reason || 'Please wait before another refund request.', 'danger');
        return;
      }
    }
    const cleanReason = sanitizeInputBounded(reason, 120);
    const cleanNote = sanitizeInputBounded(note, 300);
    if (strictAntiScamShield) {
      const reasonSpam = detectSpamContent(`${cleanReason} ${cleanNote}`);
      if (!reasonSpam.safe) {
        showToast(reasonSpam.reason || 'Invalid content blocked.', 'danger');
        return;
      }
    }
    const requestedAt = Date.now();

    setIsSubmittingAction(true);
    try {
      if (isDemoMode) {
        recordRateLimitedAction(actionRateHistoryRef.current, 'REFUND');
        setCachedOrders((prev) => {
          const cur = prev[order.orderId];
          if (!cur) return prev;
          return {
            ...prev,
            [order.orderId]: {
              ...cur,
              refundStatus: 'REQUESTED',
              refundReason: cleanReason,
              refundMethod: method,
              refundRequestedAt: requestedAt,
            },
          };
        });
        setRefundOrderTarget(null);
        triggerHaptic('success');
        showToast('💸 Refund request submitted! Team will review shortly.', 'success');
        return;
      }

      await update(ref(db, `orders/${order.orderId}`), {
        refundStatus: 'REQUESTED',
        refundReason: cleanReason,
        refundMethod: method,
        refundRequestedAt: requestedAt,
        updatedAt: requestedAt,
      });
      await push(ref(db, 'refundRequests'), {
        orderId: order.orderId,
        customerUid: activeUid,
        customerName: customerProfile?.name || 'Customer',
        customerPhone: customerProfile?.phone || '',
        restaurantId: order.restaurantId,
        amount: Number(order.totalAmount || 0),
        reason: cleanReason,
        method,
        note: cleanNote,
        status: 'REQUESTED',
        createdAt: requestedAt,
      });
      recordRateLimitedAction(actionRateHistoryRef.current, 'REFUND');
      setRefundOrderTarget(null);
      triggerHaptic('success');
      showToast('💸 Refund request submitted! Team will review shortly.', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not submit refund request.',
        'danger'
      );
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Feedback & Cancel
  const handleFeedbackSubmit = async (
    subject: string,
    rating: number,
    message: string
  ) => {
    if (!activeUid || isSubmittingAction) return;
    if (strictAntiScamShield) {
      const rateCheck = evaluateActionRateLimit(
        actionRateHistoryRef.current,
        'FEEDBACK',
        actionCooldownMs,
        4
      );
      if (!rateCheck.allowed) {
        showToast(rateCheck.reason || 'Please wait before sending more feedback.', 'danger');
        return;
      }
    }
    const cleanSubject = sanitizeInputBounded(subject, 120);
    const cleanMessage = sanitizeInputBounded(message, 600);
    if (cleanSubject.length < 3) {
      showToast('Please enter a brief subject.', 'danger');
      return;
    }
    if (cleanMessage.length < 5) {
      showToast('Please enter a message (at least 5 characters).', 'danger');
      return;
    }
    if (strictAntiScamShield) {
      const contentCheck = detectSpamContent(`${cleanSubject} ${cleanMessage}`);
      if (!contentCheck.safe) {
        showToast(contentCheck.reason || 'Suspicious link or spam blocked.', 'danger');
        return;
      }
    }
    const item: FeedbackItem = {
      role: 'CUSTOMER',
      uid: activeUid,
      name: customerProfile?.name || 'Customer',
      phone: customerProfile?.phone || '',
      subject: cleanSubject,
      rating: Math.min(5, Math.max(1, Number(rating || 5))),
      message: cleanMessage,
      status: 'OPEN',
      createdAt: Date.now(),
    };
    setIsSubmittingAction(true);
    try {
      if (isDemoMode) {
        recordRateLimitedAction(actionRateHistoryRef.current, 'FEEDBACK');
        setMyFeedbacks((prev) => ({ [`fb_${Date.now()}`]: item, ...prev }));
        setIsFeedbackOpen(false);
        showToast('💬 Feedback sent to Admin Helpline!', 'success');
        return;
      }
      await push(ref(db, 'feedbacks'), item);
      recordRateLimitedAction(actionRateHistoryRef.current, 'FEEDBACK');
      setIsFeedbackOpen(false);
      showToast('💬 Feedback sent to Admin Helpline!', 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not send feedback. Try again.',
        'danger'
      );
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleConfirmCancelOrder = async (groupKey: string, reason: string) => {
    if (isSubmittingAction) return;
    const targetGroup = groupedOrders.find((g) => g.groupKey === groupKey);
    if (!targetGroup) return;
    const derived = deriveGroupOrderStatus(targetGroup);
    const curStatus = normalizeOrderStatus(derived.status);
    if (!['PLACED', 'ACCEPTED'].includes(curStatus)) {
      setCancelGroupKey(null);
      showToast('Order is already being prepared or out for delivery and cannot be cancelled.', 'danger');
      return;
    }
    const cleanReason = sanitizeInputBounded(reason, 120) || 'Ordered by mistake';
    const nowTs = Date.now();

    setIsSubmittingAction(true);
    try {
      if (isDemoMode) {
        setCachedOrders((prev) => {
          const next = { ...prev };
          targetGroup.orders.forEach((o) => {
            if (next[o.orderId]) {
              next[o.orderId] = {
                ...next[o.orderId],
                status: 'CANCELLED',
                cancelledBy: 'CUSTOMER',
                cancelReason: cleanReason,
                cancelledAt: nowTs,
                statusTimestamps: {
                  ...(next[o.orderId].statusTimestamps || {}),
                  CANCELLED: nowTs,
                },
                updatedAt: nowTs,
              };
            }
          });
          return next;
        });
        setCancelGroupKey(null);
        triggerHaptic('warning');
        showToast('Order Cancelled', 'info');
        return;
      }
      await Promise.all(
        targetGroup.orders.map((o) =>
          update(ref(db, `orders/${o.orderId}`), {
            status: 'CANCELLED',
            cancelledBy: 'CUSTOMER',
            cancelReason: cleanReason,
            cancelledAt: nowTs,
            'statusTimestamps/CANCELLED': nowTs,
            updatedAt: nowTs,
          })
        )
      );
      setCancelGroupKey(null);
      triggerHaptic('warning');
      showToast('Order Cancelled', 'info');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not cancel order. Try again.',
        'danger'
      );
    } finally {
      setIsSubmittingAction(false);
    }
  };

 const handleLogout = () => {
    setCartItems([]);
    try {
      localStorage.removeItem(CART_STORAGE_KEY);
    } catch {
      // Ignore
    }
    if (Capacitor.isNativePlatform()) {
      void ChutkiBgBridge.stopAlertService().catch(() => {});
      void FirebaseAuthentication.signOut().catch(() => {});
    }
    if (currentUser) {
      void signOut(auth);
    }
  };

  const handleCheckEmailVerified = async () => {
    const targetUser = auth.currentUser || currentUser;
    if (!targetUser) return;
    setVerifyStatusMsg('');
    setVerifyStatusErr('');
    setIsCheckingVerification(true);
    try {
      await targetUser.reload();
      setAuthVerifyTick((t) => t + 1);
      if (auth.currentUser?.emailVerified) {
        triggerHaptic('success');
        showToast('✅ Email verified! Welcome to Chutki.', 'success');
      } else {
        triggerHaptic('error');
        setVerifyStatusErr(
          'Email is not verified yet. Open the link in your inbox or spam folder first.'
        );
      }
    } catch (err) {
      triggerHaptic('error');
      setVerifyStatusErr(mapAuthErrorSafe(err, 'verification'));
    } finally {
      setIsCheckingVerification(false);
    }
  };

  const handleResendVerificationEmail = async () => {
    const targetUser = auth.currentUser || currentUser;
    if (!targetUser || verifyResendCooldownSec > 0) return;
    setVerifyStatusMsg('');
    setVerifyStatusErr('');
    setIsResendingVerification(true);
    try {
      await sendEmailVerification(targetUser);
      triggerHaptic('success');
      setVerifyResendCooldownSec(60);
      setVerifyStatusMsg(
        `Fresh verification link sent to ${targetUser.email || 'your inbox'}.`
      );
      showToast('📧 Verification link sent again!', 'success');
    } catch (err) {
      triggerHaptic('error');
      setVerifyStatusErr(mapAuthErrorSafe(err, 'verification'));
    } finally {
      setIsResendingVerification(false);
    }
  };

  const handleEnablePush = async () => {
    const res = await enablePushNotifications();
    showToast(res.message, res.granted ? 'success' : 'info');
  };

  const handleSendTestPush = async () => {
    const res = await sendTestPush();
    showToast(res.message, res.granted ? 'success' : 'info');
  };

  const handleSendPasswordReset = async () => {
    const targetEmail = currentUser?.email || customerProfile?.email || '';
    if (!targetEmail) {
      showToast('No verified account email found for reset.', 'danger');
      return;
    }
    if (isDemoMode) {
      showToast(`📧 Password reset link prepared for ${targetEmail}`, 'success');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, targetEmail);
      showToast(`📧 Password reset link sent to ${targetEmail}`, 'success');
    } catch {
      showToast('Could not send reset email right now. Try again shortly.', 'danger');
    }
  };

  const favCount = Object.keys(customerProfile?.favorites || {}).length;
  const totalCartCount = cartItems.reduce((acc, curr) => acc + curr.qty, 0);
  const totalCartSubtotal = cartItems.reduce(
    (acc, curr) => acc + curr.price * curr.qty,
    0
  );
  const referralCode =
    customerProfile?.referralCode ||
    (activeUid ? 'GB' + activeUid.slice(0, 6).toUpperCase() : 'GBUSER');

  const activeRatingGroup = ratingModalState
    ? groupedOrders.find((g) => g.groupKey === ratingModalState.groupKey) || null
    : null;
  const activeTipRiderGroup = tipRiderGroupKey
    ? groupedOrders.find((g) => g.groupKey === tipRiderGroupKey) || null
    : null;
  const activeChatGroup = activeChatGroupKey
    ? groupedOrders.find((g) => g.groupKey === activeChatGroupKey) || null
    : null;

  const stopActiveCallMedia = useCallback(() => {
    if (ringtoneRef.current) {
      ringtoneRef.current.stop();
      ringtoneRef.current = null;
    }
    if (webrtcSessionRef.current) {
      webrtcSessionRef.current.cleanup();
      webrtcSessionRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopActiveCallMedia();
    };
  }, [stopActiveCallMedia]);

  const handleIncomingOrUpdatedCallPayload = useCallback(
    (candidate: Partial<InAppCallRecord> | null | undefined) => {
      if (!activeUid || !candidate || typeof candidate !== 'object') return;
      const current = activeCallRef.current;

      // 1. If this update belongs to the currently active call, sync remote status transitions
      if (current && candidate.callId === current.callId) {
        const nextStatus = candidate.status as InAppCallStatus | undefined;
        if (!nextStatus) return;

        if (
          nextStatus === 'DECLINED' ||
          nextStatus === 'BUSY' ||
          nextStatus === 'ENDED' ||
          nextStatus === 'FAILED' ||
          nextStatus === 'TIMEOUT'
        ) {
          stopActiveCallMedia();
          setActiveCall((prev) =>
            prev && prev.callId === current.callId
              ? { ...prev, status: nextStatus, updatedAt: Date.now() }
              : prev
          );
          if (nextStatus === 'DECLINED') {
            showToast('Rider declined the voice call.', 'info');
          } else if (nextStatus === 'BUSY') {
            showToast('Rider is currently busy on another call.', 'info');
          }
          window.setTimeout(() => {
            setActiveCall((prev) =>
              prev && prev.callId === current.callId ? null : prev
            );
          }, 1200);
          return;
        }

        setActiveCall((prev) => {
          if (!prev || prev.callId !== current.callId) return prev;
          // Do not overwrite local CONNECTED state with an older RINGING/CONNECTING snapshot
          if (
            prev.status === 'CONNECTED' &&
            (nextStatus === 'RINGING' || nextStatus === 'CALLING' || nextStatus === 'CONNECTING')
          ) {
            return prev;
          }
          return {
            ...prev,
            status: nextStatus,
            connectedAt:
              prev.connectedAt ||
              (typeof candidate.connectedAt === 'number'
                ? candidate.connectedAt
                : undefined),
            updatedAt: Number(candidate.updatedAt || Date.now()),
          };
        });
        return;
      }

      // 2. Otherwise evaluate whether it is a valid incoming Rider -> Customer call
      if (!allowRiderVoiceCall) return;
      const decision = evaluateIncomingRiderCall({
        candidate,
        loggedInCustomerUid: activeUid,
        activeGroups: groupedOrders,
        handledCallIds: handledCallIdsRef.current,
        currentActiveCallId: current?.callId || null,
      });

      if (decision.action === 'IGNORE') return;

      handledCallIdsRef.current.add(decision.call.callId);

      if (decision.action === 'BUSY') {
        if (!isDemoMode) {
          const busyUpdates = buildCallStatusMultiPathUpdate({
            orderId: decision.call.orderId,
            tripId: decision.call.tripId,
            customerUid: activeUid,
            riderUid: decision.call.riderUid,
            status: 'BUSY',
            customerAnswered: false,
          });
          void update(ref(db), busyUpdates).catch(() => {});
        }
        return;
      }

      // decision.action === 'RING': Show full-screen incoming call UI + ringtone + vibration
      stopActiveCallMedia();
      setIsCallMuted(false);
      setIsCallSpeakerOn(false);
      setCallMicError(null);
      setActiveCall(decision.call);
      ringtoneRef.current = startCallRingtone('INCOMING');
      pushNotification(
        {
          id: `call_${decision.call.callId}`,
          title: `📞 Incoming Voice Call • ${decision.call.riderName}`,
          body: `Rider is calling regarding Order #${decision.call.orderId.slice(-6)}`,
          tag: decision.call.callId,
          type: 'ORDER',
          targetTab: 'orders',
          createdAt: Date.now(),
          read: false,
        },
        true
      );
    },
    [
      activeUid,
      allowRiderVoiceCall,
      groupedOrders,
      isDemoMode,
      pushNotification,
      showToast,
      stopActiveCallMedia,
    ]
  );

  // Centralized App-Wide Incoming Call & Active Order Call Listener
  useEffect(() => {
    if (!activeUid || !isLoggedIn) return undefined;

    const win = window as unknown as {
      __chutkiSimulateIncomingRiderCall?: (
        payload: Partial<InAppCallRecord>
      ) => void;
    };
    win.__chutkiSimulateIncomingRiderCall = (payload) => {
      handleIncomingOrUpdatedCallPayload(payload);
    };

    if (isDemoMode) {
      return () => {
        delete win.__chutkiSimulateIncomingRiderCall;
      };
    }

    const unsubs: Array<() => void> = [];
    unsubs.push(
      onValue(ref(db, `customerCallInbox/${activeUid}`), (snap) => {
        if (snap.exists()) {
          handleIncomingOrUpdatedCallPayload(
            snap.val() as Partial<InAppCallRecord>
          );
        }
      })
    );

    const eligibleGroups = groupedOrders.filter((g) =>
      isRiderCommunicationEligible(g)
    );
    const watchedPaths = new Set<string>();
    eligibleGroups.forEach((grp) => {
      const ordId = getCanonicalOrderIdForGroup(grp);
      const trpId = getCanonicalTripIdForGroup(grp);
      if (ordId && !watchedPaths.has(`inAppCalls/${ordId}`)) {
        watchedPaths.add(`inAppCalls/${ordId}`);
        unsubs.push(
          onValue(ref(db, `inAppCalls/${ordId}`), (snap) => {
            if (snap.exists()) {
              handleIncomingOrUpdatedCallPayload(
                snap.val() as Partial<InAppCallRecord>
              );
            }
          })
        );
      }
      if (trpId && trpId !== ordId && !watchedPaths.has(`inAppCalls/${trpId}`)) {
        watchedPaths.add(`inAppCalls/${trpId}`);
        unsubs.push(
          onValue(ref(db, `inAppCalls/${trpId}`), (snap) => {
            if (snap.exists()) {
              handleIncomingOrUpdatedCallPayload(
                snap.val() as Partial<InAppCallRecord>
              );
            }
          })
        );
      }
    });

    return () => {
      delete win.__chutkiSimulateIncomingRiderCall;
      unsubs.forEach((u) => u());
    };
  }, [
    activeUid,
    groupedOrders,
    handleIncomingOrUpdatedCallPayload,
    isDemoMode,
    isLoggedIn,
  ]);

  // 60-second unanswered call signaling timeout guard
  useEffect(() => {
    if (
      !activeCall ||
      (activeCall.status !== 'RINGING' && activeCall.status !== 'CALLING')
    ) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      const current = activeCallRef.current;
      if (!current) return;
      if (isCallRingingExpired(current, Date.now())) {
        stopActiveCallMedia();
        if (!isDemoMode) {
          const timeoutUpdates = buildCallStatusMultiPathUpdate({
            orderId: current.orderId,
            tripId: current.tripId,
            customerUid: current.customerUid,
            riderUid: current.riderUid,
            status: 'TIMEOUT',
            customerAnswered: false,
            clearWebrtc: true,
          });
          void update(ref(db), timeoutUpdates).catch(() => {});
        }
        setActiveCall((prev) =>
          prev && prev.callId === current.callId
            ? { ...prev, status: 'TIMEOUT', updatedAt: Date.now() }
            : prev
        );
        showToast('Call unanswered (60s timeout).', 'info');
        window.setTimeout(() => {
          setActiveCall((prev) =>
            prev && prev.callId === current.callId ? null : prev
          );
        }, 1200);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeCall, isDemoMode, showToast, stopActiveCallMedia]);

  // Real-Time Trip Chat listener for active rider-assigned orders
  useEffect(() => {
    if (!activeUid || !isLoggedIn || isDemoMode) return undefined;
    const eligibleGroups = groupedOrders.filter((g) =>
      isRiderCommunicationEligible(g)
    );
    const unsubs: Array<() => void> = [];
    const watchedOrderIds = new Set<string>();

    eligibleGroups.forEach((grp) => {
      const ordId = getCanonicalOrderIdForGroup(grp);
      if (!ordId || watchedOrderIds.has(ordId)) return;
      watchedOrderIds.add(ordId);

      unsubs.push(
        onValue(ref(db, `tripChats/${ordId}/messages`), (snap) => {
          const raw = snap.val() as Record<string, Partial<TripChatMessage>> | null;
          const list = normalizeTripChatMessages(raw);
          setTripChatMessagesByOrder((prev) => ({
            ...prev,
            [ordId]: list,
          }));

          // If Customer currently has this chat open, mark unread RIDER messages as READ
          if (activeChatGroupKey === grp.groupKey && raw) {
            const readUpdates: Record<string, unknown> = {};
            list.forEach((m) => {
              if (
                m.senderRole === 'RIDER' &&
                m.senderUid !== activeUid &&
                m.status !== 'READ'
              ) {
                readUpdates[`tripChats/${ordId}/messages/${m.messageId}/status`] =
                  'READ';
              }
            });
            if (Object.keys(readUpdates).length > 0) {
              void update(ref(db), readUpdates).catch(() => {});
            }
          }
        })
      );
    });

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [activeChatGroupKey, activeUid, groupedOrders, isDemoMode, isLoggedIn]);

  const unreadChatCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!activeUid) return counts;
    Object.entries(tripChatMessagesByOrder).forEach(([ordId, list]) => {
      counts[ordId] = countUnreadRiderMessages(list, activeUid);
    });
    return counts;
  }, [activeUid, tripChatMessagesByOrder]);

  const handleStartRiderVoiceCall = useCallback(
    async (group: GroupedOrder) => {
      if (!activeUid) return;
      if (!allowRiderVoiceCall) {
        showToast('In-App voice calling is currently disabled by Admin.', 'info');
        return;
      }
      if (!isRiderCommunicationEligible(group) || !group.deliveryUid) {
        showToast(
          'Rider voice call is available only for active rider-assigned orders.',
          'danger'
        );
        return;
      }
      if (activeCallRef.current) {
        showToast('You already have an active voice call in progress.', 'info');
        return;
      }

      const riderUid = group.deliveryUid;
      const riderObj = deliveryPartners[riderUid];
      const orderId = getCanonicalOrderIdForGroup(group);
      const tripId = getCanonicalTripIdForGroup(group);

      const callRecord = buildCustomerOutgoingCallRecord({
        orderId,
        tripId,
        riderUid,
        riderName: riderObj?.name || 'Delivery Rider',
        riderPhotoUrl: riderObj?.photoUrl || riderObj?.imageUrl,
        customerUid: activeUid,
        customerName: customerProfile?.name || 'Customer',
        dropAddress: group.address || customerProfile?.address || 'Delivery Address',
      });

      handledCallIdsRef.current.add(callRecord.callId);
      stopActiveCallMedia();
      setIsCallMuted(false);
      setIsCallSpeakerOn(false);
      setCallMicError(null);
      setActiveCall(callRecord);
      ringtoneRef.current = startCallRingtone('OUTGOING');

      const signalingWritePromise = !isDemoMode
        ? update(ref(db), buildCustomerCallMultiPathUpdate(callRecord)).catch((err) => {
            stopActiveCallMedia();
            setActiveCall(null);
            showToast('Could not signal voice call. Check your connection.', 'danger');
            throw err;
          })
        : Promise.resolve();

      const session = await startWebRtcVoiceSession({
        db,
        orderId: callRecord.orderId,
        tripId: callRecord.tripId,
        role: 'CALLER',
        beforeSignalingPromise: signalingWritePromise,
        callbacks: {
          onStatusChange: (status) => {
            setActiveCall((prev) =>
              prev && prev.callId === callRecord.callId
                ? { ...prev, status, updatedAt: Date.now() }
                : prev
            );
          },
          onPeerConnected: () => {
            if (ringtoneRef.current) {
              ringtoneRef.current.stop();
              ringtoneRef.current = null;
            }
            const connectedAt = Date.now();
            setActiveCall((prev) =>
              prev && prev.callId === callRecord.callId
                ? {
                    ...prev,
                    status: 'CONNECTED',
                    customerAnswered: true,
                    connectedAt,
                    updatedAt: connectedAt,
                  }
                : prev
            );
            if (!isDemoMode) {
              const connUpdates = buildCallStatusMultiPathUpdate({
                orderId: callRecord.orderId,
                tripId: callRecord.tripId,
                customerUid: activeUid,
                riderUid: callRecord.riderUid,
                status: 'CONNECTED',
                customerAnswered: true,
                connectedAt,
              });
              void update(ref(db), connUpdates).catch(() => {});
            }
          },
          onMicPermissionError: (_permDenied, message) => {
            setCallMicError(message);
          },
          onMicPermissionResolved: () => {
            setCallMicError(null);
          },
        },
      });

      webrtcSessionRef.current = session;
    },
    [
      activeUid,
      allowRiderVoiceCall,
      customerProfile?.address,
      customerProfile?.name,
      deliveryPartners,
      isDemoMode,
      showToast,
      stopActiveCallMedia,
    ]
  );

  const handleAnswerIncomingCall = useCallback(async () => {
    const current = activeCallRef.current;
    if (!current || !activeUid) return;

    // 1. Stop incoming ringtone & vibration immediately
    if (ringtoneRef.current) {
      ringtoneRef.current.stop();
      ringtoneRef.current = null;
    }
    setCallMicError(null);

    // 2. Transition to CONNECTING first — CONNECTED is only written once WebRTC peer connects!
    setActiveCall((prev) =>
      prev && prev.callId === current.callId
        ? {
            ...prev,
            status: 'CONNECTING',
            customerAnswered: true,
            updatedAt: Date.now(),
          }
        : prev
    );

    if (!isDemoMode) {
      const connectingUpdates = buildCallStatusMultiPathUpdate({
        orderId: current.orderId,
        tripId: current.tripId,
        customerUid: activeUid,
        riderUid: current.riderUid,
        status: 'CONNECTING',
        customerAnswered: true,
      });
      void update(ref(db), connectingUpdates).catch(() => {});
    }

    const session = await startWebRtcVoiceSession({
      db,
      orderId: current.orderId,
      tripId: current.tripId,
      role: 'RECEIVER',
      callbacks: {
        onStatusChange: (status) => {
          setActiveCall((prev) =>
            prev && prev.callId === current.callId
              ? { ...prev, status, updatedAt: Date.now() }
              : prev
          );
        },
        onPeerConnected: () => {
          const connectedAt = Date.now();
          setActiveCall((prev) =>
            prev && prev.callId === current.callId
              ? {
                  ...prev,
                  status: 'CONNECTED',
                  customerAnswered: true,
                  connectedAt,
                  updatedAt: connectedAt,
                }
              : prev
          );
          if (!isDemoMode) {
            const connectedUpdates = buildCallStatusMultiPathUpdate({
              orderId: current.orderId,
              tripId: current.tripId,
              customerUid: activeUid,
              riderUid: current.riderUid,
              status: 'CONNECTED',
              customerAnswered: true,
              connectedAt,
            });
            void update(ref(db), connectedUpdates).catch(() => {});
          }
        },
        onMicPermissionError: (_permDenied, message) => {
          setCallMicError(message);
        },
        onMicPermissionResolved: () => {
          setCallMicError(null);
        },
      },
    });

    webrtcSessionRef.current = session;
  }, [activeUid, isDemoMode]);

  const handleDeclineIncomingCall = useCallback(async () => {
    const current = activeCallRef.current;
    stopActiveCallMedia();
    if (!current) return;

    setActiveCall((prev) =>
      prev && prev.callId === current.callId
        ? {
            ...prev,
            status: 'DECLINED',
            customerAnswered: false,
            updatedAt: Date.now(),
          }
        : null
    );

    if (!isDemoMode && activeUid) {
      const declineUpdates = buildCallStatusMultiPathUpdate({
        orderId: current.orderId,
        tripId: current.tripId,
        customerUid: activeUid,
        riderUid: current.riderUid,
        status: 'DECLINED',
        customerAnswered: false,
        clearWebrtc: true,
      });
      await update(ref(db), declineUpdates).catch(() => {});
    }

    setActiveCall(null);
  }, [activeUid, isDemoMode, stopActiveCallMedia]);

  const handleEndVoiceCall = useCallback(async () => {
    const current = activeCallRef.current;
    stopActiveCallMedia();
    if (!current) return;

    setActiveCall((prev) =>
      prev && prev.callId === current.callId
        ? {
            ...prev,
            status: 'ENDED',
            customerAnswered: false,
            updatedAt: Date.now(),
          }
        : null
    );

    if (!isDemoMode && activeUid) {
      const endUpdates = buildCallStatusMultiPathUpdate({
        orderId: current.orderId,
        tripId: current.tripId,
        customerUid: activeUid,
        riderUid: current.riderUid,
        status: 'ENDED',
        customerAnswered: false,
        clearWebrtc: true,
      });
      await update(ref(db), endUpdates).catch(() => {});
    }

    setActiveCall(null);
  }, [activeUid, isDemoMode, stopActiveCallMedia]);

  const handleRetryCallMicrophone = useCallback(async () => {
    if (!webrtcSessionRef.current) return;
    const ok = await webrtcSessionRef.current.retryMicrophone();
    if (ok) {
      setCallMicError(null);
      showToast('🎙️ Microphone connected!', 'success');
    }
  }, [showToast]);

  const handleToggleCallMute = useCallback(() => {
    if (callMicError && webrtcSessionRef.current) {
      void handleRetryCallMicrophone();
    }
    const nextMuted = !isCallMuted;
    setIsCallMuted(nextMuted);
    if (webrtcSessionRef.current) {
      webrtcSessionRef.current.setMuted(nextMuted);
    }
    const current = activeCallRef.current;
    if (current && !isDemoMode && activeUid) {
      const muteUpdates = buildCallStatusMultiPathUpdate({
        orderId: current.orderId,
        tripId: current.tripId,
        customerUid: activeUid,
        riderUid: current.riderUid,
        status: current.status,
        customerAnswered: current.customerAnswered,
        isMuted: nextMuted,
      });
      void update(ref(db), muteUpdates).catch(() => {});
    }
  }, [activeUid, callMicError, handleRetryCallMicrophone, isCallMuted, isDemoMode]);

  const handleToggleCallSpeaker = useCallback(() => {
    const nextSpeaker = !isCallSpeakerOn;
    setIsCallSpeakerOn(nextSpeaker);
    if (webrtcSessionRef.current) {
      void webrtcSessionRef.current.setSpeakerOn(nextSpeaker);
    }
  }, [isCallSpeakerOn]);

  const handleOpenRiderChat = useCallback(
    (group: GroupedOrder) => {
      if (!allowRiderChat) {
        showToast('Rider chat is currently disabled by Admin.', 'info');
        return;
      }
      if (!isRiderCommunicationEligible(group) || !group.deliveryUid) {
        showToast(
          'Rider chat is available only for active rider-assigned orders.',
          'danger'
        );
        return;
      }
      const ordId = getCanonicalOrderIdForGroup(group);
      setActiveChatGroupKey(group.groupKey);
      if (!Capacitor.isNativePlatform()) {
        window.history.pushState({ modal: 'riderChat' }, '');
      }

      // Mark unread Rider messages as READ
      if (isDemoMode) {
        setTripChatMessagesByOrder((prev) => {
          const existing = prev[ordId] || [];
          return {
            ...prev,
            [ordId]: existing.map((m) =>
              m.senderRole === 'RIDER' ? { ...m, status: 'READ' } : m
            ),
          };
        });
      } else if (activeUid) {
        const list = tripChatMessagesByOrder[ordId] || [];
        const readUpdates: Record<string, unknown> = {};
        list.forEach((m) => {
          if (
            m.senderRole === 'RIDER' &&
            m.senderUid !== activeUid &&
            m.status !== 'READ'
          ) {
            readUpdates[`tripChats/${ordId}/messages/${m.messageId}/status`] =
              'READ';
          }
        });
        if (Object.keys(readUpdates).length > 0) {
          void update(ref(db), readUpdates).catch(() => {});
        }
      }
    },
    [activeUid, allowRiderChat, isDemoMode, showToast, tripChatMessagesByOrder]
  );

  const sendOrRetryChatMessage = useCallback(
    async (group: GroupedOrder, rawText: string, existingMsgId?: string) => {
      if (!activeUid || !group.deliveryUid) return;
      if (!isRiderCommunicationEligible(group)) {
        showToast('This order is no longer active for rider chat.', 'danger');
        return;
      }
      const ordId = getCanonicalOrderIdForGroup(group);
      const pushRef = push(ref(db, `tripChats/${ordId}/messages`));
      const messageId =
        existingMsgId || pushRef.key || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const built = buildTripChatMessage({
        messageId,
        senderUid: activeUid,
        receiverUid: group.deliveryUid,
        rawMessage: rawText,
        strictAntiScam: strictAntiScamShield,
      });

      if (!built.valid || !built.record) {
        showToast(built.reason || 'Could not send message.', 'danger');
        return;
      }

      const record = built.record;
      const optimisticSending: TripChatMessage = {
        ...record,
        status: 'SENDING',
      };

      setIsSendingChatMessage(true);
      setTripChatMessagesByOrder((prev) => {
        const currentList = (prev[ordId] || []).filter(
          (m) => m.messageId !== messageId
        );
        return {
          ...prev,
          [ordId]: [...currentList, optimisticSending],
        };
      });

      if (isDemoMode) {
        setTripChatMessagesByOrder((prev) => {
          const currentList = (prev[ordId] || []).map((m) =>
            m.messageId === messageId ? { ...record, status: 'SENT' as const } : m
          );
          return {
            ...prev,
            [ordId]: currentList,
          };
        });
        setIsSendingChatMessage(false);
        return;
      }

      try {
        await set(
          ref(db, `tripChats/${ordId}/messages/${messageId}`),
          record
        );
      } catch {
        setTripChatMessagesByOrder((prev) => {
          const currentList = (prev[ordId] || []).map((m) =>
            m.messageId === messageId ? { ...record, status: 'FAILED' as const } : m
          );
          return {
            ...prev,
            [ordId]: currentList,
          };
        });
        showToast('Message failed to send. Tap Retry.', 'danger');
      } finally {
        setIsSendingChatMessage(false);
      }
    },
    [activeUid, isDemoMode, showToast, strictAntiScamShield]
  );

  return (
    <>
      <LivePushBanner
        notification={activeBanner}
        onDismiss={dismissBanner}
        onOpen={(notif) => {
          dismissBanner();
          markNotificationRead(notif.id);
          if (notif.targetTab) {
            switchNav(notif.targetTab);
          }
        }}
      />

      <div id="toast-container">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>

      {customerProfile?.blocked === true && (
        <div id="banned-screen">
          <i
            className="fa-solid fa-ban"
            style={{
              fontSize: '3.5rem',
              color: 'var(--danger)',
              marginBottom: '1rem',
            }}
          />
          <h2 style={{ fontWeight: 900, marginBottom: '0.5rem' }}>
            Account Suspended
          </h2>
          <p
            style={{
              color: '#94a3b8',
              fontSize: '0.85rem',
              marginBottom: '1.5rem',
            }}
          >
            Your account is suspended due to invalid or spam activities. Contact
            support.
          </p>
          <button
            type="button"
            className="btn btn-outline"
            style={{ color: '#fff', borderColor: '#fff' }}
            onClick={handleLogout}
          >
            Sign Out
          </button>
        </div>
      )}

      <div className="app-viewport">
        {gmpQuotaExceeded && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
            <span>
              Google Maps Platform quota reached. If you are the app owner, visit{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-amber-950 hover:text-amber-800"
              >
                maps developer site
              </a>{' '}
              for instructions to update your account.
            </span>
          </div>
        )}

        <OfflineIndicator />

        {settings.announcementActive && settings.announcementText && (
          <div id="announcement-ticker">{settings.announcementText}</div>
        )}

        {maintenanceMode && (
          <div id="maintenance-banner">🚧 {maintenanceMessage}</div>
        )}

        {authReady && !isLoggedIn && (
          <AuthScreen
            brandName={settings.appBrandName || 'Chutki'}
            allowReferrals={allowReferrals}
            referrerBonus={referrerBonus}
            refereeBonus={refereeBonus}
            showToast={showToast}
            onDetectedGps={(lat, lng, link) => {
              setDetectedLat(lat);
              setDetectedLng(lng);
              setDetectedLocationLink(link);
            }}
            detectedLat={detectedLat}
            detectedLng={detectedLng}
            detectedLocationLink={detectedLocationLink}
          />
        )}

        {authReady && currentUser && needsEmailVerification && (
          <EmailVerificationScreen
            brandName={settings.appBrandName || 'Chutki'}
            userEmail={activeUserSnapshot?.email || ''}
            isChecking={isCheckingVerification}
            isResending={isResendingVerification}
            resendCooldownSec={verifyResendCooldownSec}
            statusMessage={verifyStatusMsg}
            statusError={verifyStatusErr}
            onCheckVerified={() => void handleCheckEmailVerified()}
            onResendVerification={() => void handleResendVerificationEmail()}
            onLogout={handleLogout}
          />
        )}

        {/* HEADER */}
        <header className="app-header">
          <div className="header-top-row">
            <div style={{ minWidth: 0 }}>
              <div className="express-delivery-badge">
                <span id="header-eta-text">
                  {settings.expressEtaText || '⚡ 15 MINS EXPRESS'}
                </span>
                <span className="express-pill" id="header-local-badge">
                  {settings.expressLocalBadge || 'LOCAL'}
                </span>
              </div>
              <button
                type="button"
                className="delivery-location-pill"
                onClick={() => switchNav('profile')}
              >
                <strong id="header-address-text">
                  {customerProfile?.address
                    ? customerProfile.address.split(',')[0].slice(0, 24)
                    : 'Gossaigaon Town'}
                </strong>
                <i
                  className="fa-solid fa-chevron-down"
                  style={{ fontSize: '0.75rem', color: '#64748b' }}
                />
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
              <button
                type="button"
                className="header-icon-btn"
                aria-label="My Favorites"
                onClick={() => {
                  triggerHaptic('tap');
                  setCurrentCategoryFilter('FAVORITES');
                  switchNav('home');
                }}
                title="My Favorites"
              >
                <i
                  className="fa-solid fa-heart"
                  style={{ color: 'var(--danger)' }}
                />
                {favCount > 0 && (
                  <span className="fav-dot-count" id="header-fav-count">
                    {favCount}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="header-icon-btn"
                aria-label="Push Notifications"
                onClick={() => {
                  triggerHaptic('tap');
                  setIsInboxOpen(true);
                  if (!Capacitor.isNativePlatform()) {
                    window.history.pushState({ modal: 'inbox' }, '');
                  }
                }}
                title="Notifications"
              >
                <i
                  className="fa-solid fa-bell"
                  style={{
                    color:
                      pushPermission === 'granted'
                        ? 'var(--brand-green)'
                        : '#475569',
                  }}
                />
                {unreadCount > 0 && (
                  <span className="fav-dot-count">{unreadCount}</span>
                )}
              </button>
              <button
                type="button"
                className="header-icon-btn"
                aria-label="My Wallet"
                onClick={() => switchNav('wallet', true, true)}
                title="My Wallet"
              >
                <i
                  className="fa-solid fa-wallet"
                  style={{ color: 'var(--brand-green)' }}
                />
              </button>
              <button
                type="button"
                className="header-icon-btn"
                aria-label="My Profile"
                onClick={() => switchNav('profile', true, true)}
                title="My Profile"
              >
                <i className="fa-solid fa-user" />
              </button>
            </div>
          </div>

          <div className="quick-search-wrap">
            <i className="fa-solid fa-magnifying-glass" />
            <input
              type="text"
              id="store-search-input"
              className="quick-search-input"
              aria-label="Search groceries and stores"
              placeholder={
                settings.searchPlaceholder ||
                'Search vegetables, atta, milk, oil across stores...'
              }
              value={searchQuery}
              onChange={(e) => {
                const nextQuery = e.target.value;
                setSearchQuery(nextQuery);
                if (nextQuery.trim() && activeTab !== 'home') {
                  switchNav('home');
                }
              }}
            />
            {allowVoiceSearch && (
              <button
                type="button"
                className={`voice-mic-btn ${isVoiceListening ? 'listening' : ''}`}
                id="voice-btn"
                aria-label="Voice Search"
                onClick={startVoiceSearch}
                title="Voice Search"
              >
                <i className="fa-solid fa-microphone" />
              </button>
            )}
          </div>
        </header>

        {/* DYNAMIC CATEGORY STRIP */}
        <div className="categories-circular-strip" id="categories-strip">
          {categories.map((cat) => {
            const isActive = currentCategoryFilter === cat.id;
            return (
              <button
                type="button"
                key={cat.id}
                className={`cat-item ${isActive ? 'active' : ''}`}
                onClick={() => {
                  if (!isActive) triggerHaptic('tap');
                  setCurrentCategoryFilter(cat.id);
                }}
              >
                <div className="cat-icon-circle">{cat.icon || '🛒'}</div>
                <span className="cat-label">{cat.name}</span>
              </button>
            );
          })}
        </div>

        {/* ACTIVE TAB CONTENT */}
        {activeTab === 'home' && (
          <HomeTab
            settings={settings}
            freeDeliveryMinOrder={freeDeliveryMinOrder}
            currentCategoryFilter={currentCategoryFilter}
            categories={categories}
            filteredProducts={filteredProducts}
            approvedStores={approvedStores}
            allMenus={allMenus}
            favorites={customerProfile?.favorites}
            favoriteStores={customerProfile?.favoriteStores}
            allowFavoriteStores={allowFavoriteStores}
            allowStoreQuickAdd={allowStoreQuickAdd}
            allowStoreRatings={allowStoreRatings}
            showStockBadges={showStockBadges}
            enforceStockLimits={enforceStockLimits}
            customerLat={activeCustomerLat}
            customerLng={activeCustomerLng}
            nearbyRadiusKm={nearbyRadiusKm}
            prioritizeNearbyStores={prioritizeNearbyStores}
            searchQuery={searchQuery}
            isDetectingGps={isDetectingHomeGps}
            isLiveGpsTracking={isLiveGpsTracking}
            onDetectLiveGps={handleHomeGpsDetect}
            getItemQuantityInCart={getItemQuantityInCart}
            onFilterCategory={setCurrentCategoryFilter}
            onToggleFavorite={toggleFavoriteItem}
            onToggleFavoriteStore={toggleFavoriteStore}
            onOpenProductDetail={(sId, iId) => {
              setDetailItemRef({ storeId: sId, itemId: iId });
              if (!Capacitor.isNativePlatform()) {
                window.history.pushState({ modal: 'productDetail' }, '');
              }
            }}
            onUpdateCart={updateCartQtySafe}
            onQuickAddStorePopular={handleQuickAddStorePopular}
            onOpenStoreModal={(sId) => {
              setMenuStoreId(sId);
              if (!Capacitor.isNativePlatform()) {
                window.history.pushState({ modal: 'menu' }, '');
              }
            }}
            pushPermission={pushPermission}
            pushPromptDismissed={promptDismissed}
            onEnablePush={() => void handleEnablePush()}
            onDismissPushPrompt={dismissPrompt}
          />
        )}

        {activeTab === 'orders' && (
          <OrdersTab
            groupedOrders={groupedOrders}
            cachedOrders={cachedOrders}
            stores={stores}
            deliveryPartners={deliveryPartners}
            timelineTimestamps={observedStatusTimestamps}
            gmpQuotaExceeded={gmpQuotaExceeded}
            brandName={appBrandName}
            allowRiderTip={allowRiderTip}
            allowStoreRatings={allowStoreRatings}
            allowRefundRequests={allowRefundRequests}
            allowDeliveryQr={allowDeliveryQr}
            allowRiderVoiceCall={allowRiderVoiceCall}
            allowRiderChat={allowRiderChat}
            unreadChatCounts={unreadChatCounts}
            onOpenRateRider={(groupKey) => {
              setRatingModalState({ mode: 'RIDER', groupKey });
              if (!Capacitor.isNativePlatform()) {
                window.history.pushState({ modal: 'rating' }, '');
              }
            }}
            onOpenRateStore={(groupKey) => {
              setRatingModalState({ mode: 'STORE', groupKey });
              if (!Capacitor.isNativePlatform()) {
                window.history.pushState({ modal: 'rating' }, '');
              }
            }}
            onOpenRateProducts={(groupKey) => {
              setRatingModalState({ mode: 'PRODUCTS', groupKey });
              if (!Capacitor.isNativePlatform()) {
                window.history.pushState({ modal: 'rating' }, '');
              }
            }}
            onOpenTipRider={(groupKey) => {
              setTipRiderGroupKey(groupKey);
              if (!Capacitor.isNativePlatform()) {
                window.history.pushState({ modal: 'tipRider' }, '');
              }
            }}
            onOpenRefundOrder={(order) => {
              setRefundOrderTarget(order);
              if (!Capacitor.isNativePlatform()) {
                window.history.pushState({ modal: 'refundOrder' }, '');
              }
            }}
            onOpenCancelOrder={(groupKey) => {
              setCancelGroupKey(groupKey);
              if (!Capacitor.isNativePlatform()) {
                window.history.pushState({ modal: 'cancel' }, '');
              }
            }}
            onReorderOrder={handleReorderPastOrder}
            onCallRider={(group) => void handleStartRiderVoiceCall(group)}
            onMessageRider={(group) => handleOpenRiderChat(group)}
          />
        )}

        {activeTab === 'wallet' && (
          <WalletTab
            walletBalance={Number(customerProfile?.walletBalance || 0)}
            totalCashbackEarned={Number(customerProfile?.totalCashbackEarned || 0)}
            cashbackPercent={cashbackPercent}
            allowCashback={allowCashback}
            minDeposit={minCustomerDeposit}
            maxDeposit={maxCustomerDeposit}
            minWithdraw={minCustomerWithdraw}
            maxWithdraw={maxCustomerWithdraw}
            allowReferrals={allowReferrals}
            referrerBonus={referrerBonus}
            refereeBonus={refereeBonus}
            referralCode={referralCode}
            transactions={walletTransactions}
            onOpenDeposit={() => {
              setIsDepositOpen(true);
              if (!Capacitor.isNativePlatform()) {
                window.history.pushState({ modal: 'walletDep' }, '');
              }
            }}
            onOpenWithdraw={() => {
              setIsWithdrawOpen(true);
              if (!Capacitor.isNativePlatform()) {
                window.history.pushState({ modal: 'walletWd' }, '');
              }
            }}
            onCopyReferral={() => {
              const copyFallback = () => {
                try {
                  const ta = document.createElement('textarea');
                  ta.value = referralCode;
                  ta.style.position = 'fixed';
                  ta.style.opacity = '0';
                  document.body.appendChild(ta);
                  ta.select();
                  document.execCommand('copy');
                  document.body.removeChild(ta);
                  showToast(`Referral code ${referralCode} copied!`, 'success');
                } catch {
                  showToast(`Referral code: ${referralCode}`, 'info');
                }
              };
              if (navigator.clipboard?.writeText) {
                void navigator.clipboard
                  .writeText(referralCode)
                  .then(() =>
                    showToast(`Referral code ${referralCode} copied!`, 'success')
                  )
                  .catch(copyFallback);
              } else {
                copyFallback();
              }
            }}
          />
        )}

        {activeTab === 'profile' && (
          <ProfileTab
            profile={customerProfile || {}}
            userEmail={currentUser?.email || customerProfile?.email || ''}
            referralCode={referralCode}
            hasGpsPinned={Boolean(detectedLat && detectedLng)}
            isDetectingGps={isDetectingProfileGps}
            settings={settings}
            myFeedbacks={myFeedbacks}
            pushPermission={pushPermission}
            unreadNotifications={unreadCount}
            isPlusActive={isPlusActive}
            isActivatingPlus={isActivatingPlus}
            allowChutkiPlus={allowChutkiPlus}
            plusPlanPrice={plusPlanPrice}
            plusValidityDays={plusValidityDays}
            onActivatePlus={() => void handleActivateChutkiPlus()}
            onDetectGps={handleProfileGps}
            onSaveProfile={handleSaveProfile}
            onOpenFeedback={() => {
              setIsFeedbackOpen(true);
              if (!Capacitor.isNativePlatform()) {
                window.history.pushState({ modal: 'feedback' }, '');
              }
            }}
            onEnablePush={() => void handleEnablePush()}
            onSendTestPush={() => void handleSendTestPush()}
            onOpenNotificationInbox={() => {
              setIsInboxOpen(true);
              if (!Capacitor.isNativePlatform()) {
                window.history.pushState({ modal: 'inbox' }, '');
              }
            }}
            onSendPasswordReset={() => void handleSendPasswordReset()}
            onLogout={handleLogout}
          />
        )}

        {/* FLOATING CART BAR */}
        {totalCartCount > 0 && (
          <button
            type="button"
            id="cart-floating-bar"
            onClick={() => {
              triggerHaptic('tap');
              setIsCheckoutOpen(true);
              if (!Capacitor.isNativePlatform()) {
                window.history.pushState({ modal: 'checkout' }, '');
              }
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.3rem' }}>🛍️</span>
              <div>
                <span
                  id="floating-cart-count"
                  style={{ display: 'block', fontSize: '0.84rem', fontWeight: 900 }}
                >
                  {totalCartCount} ITEM{totalCartCount > 1 ? 'S' : ''}
                </span>
                <span
                  id="floating-cart-total"
                  style={{ fontSize: '1rem', fontWeight: 900 }}
                >
                  ₹{totalCartSubtotal.toFixed(0)}
                </span>
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.92rem',
                fontWeight: 900,
              }}
            >
              <span>View Basket</span>
              <i
                className="fa-solid fa-chevron-right"
                style={{ fontSize: '0.8rem' }}
              />
            </div>
          </button>
        )}

        {/* BOTTOM NAVIGATION */}
        <nav className="bottom-nav" aria-label="Main navigation">
          <button
            type="button"
            className={`nav-btn ${activeTab === 'home' ? 'active' : ''}`}
            onClick={() => switchNav('home', true, true)}
          >
            <i className="fa-solid fa-bag-shopping" />
            <span>Bazar</span>
          </button>
          <button
            type="button"
            className={`nav-btn ${activeTab === 'orders' ? 'active' : ''}`}
            onClick={() => switchNav('orders', true, true)}
          >
            <i className="fa-solid fa-receipt" />
            <span>Orders</span>
          </button>
          <button
            type="button"
            className={`nav-btn ${activeTab === 'wallet' ? 'active' : ''}`}
            onClick={() => switchNav('wallet', true, true)}
          >
            <i className="fa-solid fa-wallet" />
            <span>Wallet</span>
          </button>
          <button
            type="button"
            className={`nav-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => switchNav('profile', true, true)}
          >
            <i className="fa-solid fa-user" />
            <span>Profile</span>
          </button>
        </nav>

        {/* MODALS */}
        <StoreMenuModal
          storeId={menuStoreId}
          stores={stores}
          allMenus={allMenus}
          favorites={customerProfile?.favorites}
          favoriteStores={customerProfile?.favoriteStores}
          showStockBadges={showStockBadges}
          enforceStockLimits={enforceStockLimits}
          allowFavoriteStores={allowFavoriteStores}
          allowStoreRatings={allowStoreRatings}
          getItemQuantityInCart={getItemQuantityInCart}
          onClose={() => setMenuStoreId(null)}
          onToggleFavorite={toggleFavoriteItem}
          onToggleFavoriteStore={toggleFavoriteStore}
          onOpenProductDetail={(sId, iId) => {
            setDetailItemRef({ storeId: sId, itemId: iId });
            if (!Capacitor.isNativePlatform()) {
              window.history.pushState({ modal: 'productDetail' }, '');
            }
          }}
          onUpdateCart={updateCartQtySafe}
        />

        <ProductDetailModal
          detailRef={detailItemRef}
          stores={stores}
          allMenus={allMenus}
          productReviews={productReviews}
          favorites={customerProfile?.favorites}
          showStockBadges={showStockBadges}
          enforceStockLimits={enforceStockLimits}
          getItemQuantityInCart={getItemQuantityInCart}
          onClose={() => setDetailItemRef(null)}
          onToggleFavorite={toggleFavoriteItem}
          onOpenProductDetail={(sId, iId) =>
            setDetailItemRef({ storeId: sId, itemId: iId })
          }
          onUpdateCart={updateCartQtySafe}
        />

        <CheckoutModal
          isOpen={isCheckoutOpen}
          cartItems={cartItems}
          stores={stores}
          walletBalance={Number(customerProfile?.walletBalance || 0)}
          adminUpiId={adminUpiId}
          usedUtrs={Array.from(collectKnownUtrs(cachedOrders, localUsedUtrs))}
          baseDeliveryCharge={baseDeliveryCharge}
          freeDeliveryMinOrder={freeDeliveryMinOrder}
          handlingFee={handlingFee}
          isPlusActive={isPlusActive}
          allowChutkiPlus={allowChutkiPlus}
          plusPlanPrice={plusPlanPrice}
          allowCashback={allowCashback}
          cashbackPercent={cashbackPercent}
          allowRiderTip={allowRiderTip}
          riderTipOptions={riderTipOptions}
          allowScheduledDelivery={allowScheduledDelivery}
          customDeliverySlots={customDeliverySlots}
          allowCod={allowCod}
          allowUpi={allowUpi}
          allowCardPayment={allowCardPayment}
          allowWalletPayment={allowWalletPayment}
          allowCoupons={allowCoupons}
          cmsCouponCode={cmsCouponCode}
          cmsCouponDiscount={cmsCouponDiscount}
          cmsCouponMinOrder={cmsCouponMinOrder}
          minOrderAmount={minOrderAmount}
          initialAddress={customerProfile?.address || ''}
          initialPhone={customerProfile?.phone || ''}
          hasGpsAttached={Boolean(detectedLat && detectedLng)}
          isFetchingGps={isFetchingCheckoutGps}
          isPlacingOrder={isPlacingOrder}
          isActivatingPlus={isActivatingPlus}
          onClose={() => setIsCheckoutOpen(false)}
          onUpdateCart={(itemId, storeId, change) =>
            updateCartQtySafe(itemId, storeId, change)
          }
          onFetchGps={handleCheckoutGps}
          onActivatePlus={() => void handleActivateChutkiPlus()}
          onPlaceOrder={(p) => void handlePlaceOrder(p)}
          showToast={showToast}
        />

        <WalletDepositModal
          isOpen={isDepositOpen}
          adminUpiId={adminUpiId}
          usedUtrs={Array.from(collectKnownUtrs(cachedOrders, localUsedUtrs))}
          minDeposit={minCustomerDeposit}
          maxDeposit={maxCustomerDeposit}
          isSubmitting={isSubmittingAction}
          onClose={() => setIsDepositOpen(false)}
          onSubmit={(amt, utr, ss) =>
            void handleWalletDepositSubmit(amt, utr, ss)
          }
          showToast={showToast}
        />

        <WalletWithdrawModal
          isOpen={isWithdrawOpen}
          minWithdraw={minCustomerWithdraw}
          maxWithdraw={maxCustomerWithdraw}
          isSubmitting={isSubmittingAction}
          onClose={() => setIsWithdrawOpen(false)}
          onSubmit={(amt, upi) => void handleWalletWithdrawSubmit(amt, upi)}
        />

        <RatingModal
          mode={ratingModalState?.mode || null}
          group={activeRatingGroup}
          riderName={
            activeRatingGroup?.deliveryUid
              ? deliveryPartners[activeRatingGroup.deliveryUid]?.name ||
                'Delivery Partner'
              : 'Delivery Partner'
          }
          storeName={
            activeRatingGroup?.orders[0]?.restaurantId
              ? stores[activeRatingGroup.orders[0].restaurantId]?.name || 'Partner Store'
              : 'Partner Store'
          }
          isSubmitting={isSubmittingAction}
          onClose={() => setRatingModalState(null)}
          onSubmitRiderRating={(g, stars, comment) =>
            void handleSubmitRiderRating(g, stars, comment)
          }
          onSubmitStoreRating={(g, stars, comment) =>
            void handleSubmitStoreRating(g, stars, comment)
          }
          onSubmitProductReviews={(g, revs) =>
            void handleSubmitProductReviews(g, revs)
          }
        />

        <TipRiderModal
          group={activeTipRiderGroup}
          riderName={
            activeTipRiderGroup?.deliveryUid
              ? deliveryPartners[activeTipRiderGroup.deliveryUid]?.name ||
                'Delivery Partner'
              : 'Delivery Partner'
          }
          walletBalance={Number(customerProfile?.walletBalance || 0)}
          tipOptions={riderTipOptions}
          isSubmitting={isSubmittingAction}
          onClose={() => setTipRiderGroupKey(null)}
          onSubmitTip={(g, amt, via) =>
            void handleTipRiderOnOrder(g, amt, via)
          }
        />

        <RefundRequestModal
          order={refundOrderTarget}
          storeName={
            refundOrderTarget?.restaurantId
              ? stores[refundOrderTarget.restaurantId]?.name || 'Gossaigaon Store'
              : 'Gossaigaon Store'
          }
          isSubmitting={isSubmittingAction}
          onClose={() => setRefundOrderTarget(null)}
          onSubmitRefund={(ord, reason, method, note) =>
            void handleSubmitRefundRequest(ord, reason, method, note)
          }
        />

        <FeedbackModal
          isOpen={isFeedbackOpen}
          isSubmitting={isSubmittingAction}
          onClose={() => setIsFeedbackOpen(false)}
          onSubmit={(sub, rat, msg) => void handleFeedbackSubmit(sub, rat, msg)}
        />

        <CancelOrderModal
          groupKey={cancelGroupKey}
          isSubmitting={isSubmittingAction}
          onClose={() => setCancelGroupKey(null)}
          onConfirmCancel={(gk, reason) =>
            void handleConfirmCancelOrder(gk, reason)
          }
        />

        <NotificationInboxModal
          isOpen={isInboxOpen}
          notifications={notifications}
          permission={pushPermission}
          onClose={() => setIsInboxOpen(false)}
          onEnablePush={() => void handleEnablePush()}
          onSendTestPush={() => void handleSendTestPush()}
          onMarkRead={markNotificationRead}
          onMarkAllRead={markAllRead}
          onClearAll={clearInbox}
          onSelectTargetTab={(tab) => switchNav(tab)}
        />

        <RiderChatModal
          group={activeChatGroup}
          rider={
            activeChatGroup?.deliveryUid
              ? deliveryPartners[activeChatGroup.deliveryUid] || null
              : null
          }
          messages={
            activeChatGroup
              ? tripChatMessagesByOrder[getCanonicalOrderIdForGroup(activeChatGroup)] || []
              : []
          }
          allowVoiceCall={allowRiderVoiceCall}
          isSending={isSendingChatMessage}
          onClose={() => setActiveChatGroupKey(null)}
          onSendMessage={(text) => {
            if (activeChatGroup) {
              void sendOrRetryChatMessage(activeChatGroup, text);
            }
          }}
          onRetryMessage={(msg) => {
            if (activeChatGroup) {
              void sendOrRetryChatMessage(activeChatGroup, msg.message, msg.messageId);
            }
          }}
          onStartVoiceCall={(grp) => void handleStartRiderVoiceCall(grp)}
        />

        <RiderVoiceCallModal
          call={activeCall}
          rider={
            activeCall?.riderUid
              ? deliveryPartners[activeCall.riderUid] || null
              : null
          }
          isMuted={isCallMuted}
          isSpeakerOn={isCallSpeakerOn}
          micPermissionError={callMicError}
          onAnswerIncoming={() => void handleAnswerIncomingCall()}
          onDeclineIncoming={() => void handleDeclineIncomingCall()}
          onEndCall={() => void handleEndVoiceCall()}
          onToggleMute={handleToggleCallMute}
          onToggleSpeaker={handleToggleCallSpeaker}
          onRetryMicrophone={() => void handleRetryCallMicrophone()}
        />
      </div>
    </>
  );
}
