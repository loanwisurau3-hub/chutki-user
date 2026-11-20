export interface CategoryDef {
  id: string;
  name: string;
  icon: string;
  keywords: string[];
  active?: boolean;
}

export interface Store {
  name?: string;
  cuisine?: string;
  category?: string;
  imageUrl?: string;
  approved?: boolean;
  suspended?: boolean;
  isOpen?: boolean;
  lat?: number;
  lng?: number;
  storeDiscountPercent?: number;
  storeDiscountMinOrder?: number;
  ratingAvg?: number;
  ratingCount?: number;
}

export interface MenuItem {
  itemId: string;
  storeId: string;
  storeName?: string;
  name: string;
  description?: string;
  searchKeywords?: string;
  category?: string;
  price: number;
  mrp?: number;
  discountPercent?: number;
  isOnSale?: boolean;
  saleBadgeText?: string;
  imageUrl?: string;
  available?: boolean;
  adminApproved?: boolean;
  stockCount?: number;
  ratingAvg?: number;
  ratingCount?: number;
  distanceKm?: number | null;
  isWithinNearbyRadius?: boolean;
  deliveryFeeEstimate?: number | null;
}

export interface CartItem {
  itemId: string;
  name: string;
  price: number;
  qty: number;
  imageUrl: string;
  storeId: string;
  storeName: string;
}

export interface CustomerProfile {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
  locationLink?: string;
  referralCode?: string;
  referredBy?: string;
  walletBalance?: number;
  favorites?: Record<string, boolean>;
  favoriteStores?: Record<string, boolean>;
  plusActiveUntil?: number;
  totalCashbackEarned?: number;
  blocked?: boolean;
  spamScore?: number;
  codBlockedUntil?: number;
  isAdmin?: boolean;
  createdAt?: number;
  updatedAt?: number;
  fcmToken?: string;
  pushEnabled?: boolean;
}

export interface DeliveryPartner {
  name?: string;
  phone?: string;
  photoUrl?: string;
  imageUrl?: string;
  vehicle?: string;
  approved?: boolean;
  online?: boolean;
  suspended?: boolean;
  lat?: number;
  lng?: number;
  ratingAvg?: number;
  ratingCount?: number;
  lastLocationUpdate?: number;
}

export interface OrderRecord {
  orderId: string;
  batchGroupId?: string;
  customerUid: string;
  restaurantId: string;
  deliveryUid?: string | null;
  riderLat?: number | null;
  riderLng?: number | null;
  assignedAt?: number | null;
  items: CartItem[] | Record<string, CartItem>;
  subtotalAmount?: number;
  deliveryCharge?: number;
  deliveryDistanceKm?: number | null;
  handlingFee?: number;
  riderTip?: number;
  deliverySlot?: string;
  storeDiscountAmount?: number;
  discountAmount?: number;
  couponCode?: string;
  cashbackEarned?: number;
  totalAmount: number;
  address?: string;
  phone?: string;
  customerLat?: number | null;
  customerLng?: number | null;
  locationLink?: string;
  deliveryOtp?: string;
  deliveryQrToken?: string;
  status: string;
  paymentMode?: string;
  paymentStatus?: string;
  transactionId?: string;
  cardLast4?: string;
  paymentScreenshot?: string;
  isSpamSuspect?: boolean;
  spamReason?: string;
  emergencyAlert?: boolean;
  emergencyDetails?: string;
  riderRating?: number;
  riderReview?: string;
  riderRatedAt?: number;
  storeRating?: number;
  storeReview?: string;
  productsReviewed?: boolean;
  refundStatus?: 'NONE' | 'REQUESTED' | 'APPROVED' | 'REJECTED';
  refundReason?: string;
  refundMethod?: 'WALLET' | 'ORIGINAL';
  refundRequestedAt?: number;
  placedAt?: number;
  acceptedAt?: number;
  preparingAt?: number;
  packingAt?: number;
  readyAt?: number;
  outForDeliveryAt?: number;
  deliveredAt?: number;
  cancelledAt?: number;
  cancelledBy?: string;
  cancelReason?: string;
  statusTimestamps?: Record<string, number>;
  createdAt?: number;
  updatedAt?: number;
}

export interface GroupedOrder {
  groupKey: string;
  orders: OrderRecord[];
  placedAt?: number;
  statusTimestamps?: Record<string, number>;
  createdAt: number;
  deliveryOtp: string;
  deliveryQrToken?: string;
  paymentMode: string;
  phone: string;
  address: string;
  totalAmount: number;
  riderTip?: number;
  deliverySlot?: string;
  refundStatus?: string;
  deliveryUid: string | null;
  riderLat: number | null;
  riderLng: number | null;
  customerLat: number | null;
  customerLng: number | null;
  locationLink: string;
  emergencyAlert: boolean;
  emergencyDetails: string;
}

export interface ProductReview {
  customerName?: string;
  rating: number;
  review?: string;
  createdAt?: number;
}

export interface WalletTransaction {
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  note?: string;
  createdAt?: number;
}

export interface FeedbackItem {
  id?: string;
  role?: string;
  uid?: string;
  name?: string;
  phone?: string;
  subject: string;
  rating: number;
  message: string;
  status: string;
  adminReply?: string;
  createdAt?: number;
}

export interface AdminSettings {
  themePrimaryColor?: string;
  themeAccentColor?: string;
  themeBgColor?: string;
  appBrandName?: string;
  expressEtaText?: string;
  expressLocalBadge?: string;
  searchPlaceholder?: string;
  upiId?: string;
  deliveryCharge?: number;
  allowDistanceDeliveryCharge?: boolean;
  baseDeliveryDistanceKm?: number;
  perKmDeliveryCharge?: number;
  maxDeliveryCharge?: number;
  freeDeliveryAbove?: number;
  handlingFee?: number;
  allowChutkiPlus?: boolean;
  plusPlanPrice?: number;
  plusValidityDays?: number;
  allowCashback?: boolean;
  cashbackPercent?: number;
  allowRiderTip?: boolean;
  riderTipOptions?: number[];
  allowScheduledDelivery?: boolean;
  customDeliverySlots?: string[];
  showStockBadges?: boolean;
  enforceStockLimits?: boolean;
  allowFavoriteStores?: boolean;
  allowStoreQuickAdd?: boolean;
  allowStoreRatings?: boolean;
  allowRefundRequests?: boolean;
  minOrderAmount?: number;
  minCustomerDeposit?: number;
  maxCustomerDeposit?: number;
  minCustomerWithdraw?: number;
  maxCustomerWithdraw?: number;
  allowReferrals?: boolean;
  referrerBonus?: number;
  refereeBonus?: number;
  showHeroBanner?: boolean;
  heroTitle?: string;
  heroSubtitle?: string;
  heroTag?: string;
  heroEmoji?: string;
  extraBannerText?: string;
  customBannerImageUrl?: string;
  activeCouponCode?: string;
  activeCouponDiscount?: number;
  couponMinOrder?: number;
  allowCod?: boolean;
  allowUpi?: boolean;
  allowCardPayment?: boolean;
  allowWalletPayment?: boolean;
  allowCoupons?: boolean;
  allowDeliveryQr?: boolean;
  allowRiderVoiceCall?: boolean;
  allowRiderChat?: boolean;
  nearbyRadiusKm?: number;
  prioritizeNearbyStores?: boolean;
  strictAntiScamShield?: boolean;
  codMaxOrderAmount?: number;
  maxActiveOrdersPerUser?: number;
  blockCodForFlaggedUsers?: boolean;
  spamAutoBlockThreshold?: number;
  actionCooldownMs?: number;
  allowVoiceSearch?: boolean;
  maintenanceMode?: boolean;
  maintenanceMessage?: string;
  announcementActive?: boolean;
  announcementText?: string;
  customCategories?: CategoryDef[];
  supportPhone?: string;
  supportWhatsapp?: string;
  supportHours?: string;
}

export interface RefundRequestRecord {
  id: string;
  orderId: string;
  customerUid: string;
  customerName?: string;
  customerPhone?: string;
  restaurantId?: string;
  amount: number;
  reason: string;
  method: 'WALLET' | 'ORIGINAL';
  note?: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  createdAt: number;
  resolvedAt?: number;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  tag: string;
  type: 'ORDER' | 'WALLET' | 'PROMO' | 'SYSTEM';
  targetTab?: 'home' | 'orders' | 'wallet' | 'profile';
  createdAt: number;
  read: boolean;
}

export type TabKey = 'home' | 'orders' | 'wallet' | 'profile';

export type TripChatMessageStatus =
  | 'SENDING'
  | 'SENT'
  | 'DELIVERED'
  | 'READ'
  | 'FAILED';

export interface TripChatMessage {
  messageId: string;
  senderUid: string;
  senderRole: 'CUSTOMER' | 'RIDER';
  receiverUid: string;
  messageType: 'TEXT';
  message: string;
  timestamp: number;
  status: TripChatMessageStatus;
}
