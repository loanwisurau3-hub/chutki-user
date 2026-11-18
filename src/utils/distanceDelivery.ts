import type { CartItem, Store } from '../types/bazar';
import {
  calculateCheckoutSummary,
  getStoreDistanceKm,
  groupCartByStore,
  type CheckoutSummary,
  type StoreBasketGroup,
} from './bazarLogic';

export const DEFAULT_BASE_DELIVERY_DISTANCE_KM = 2;
export const DEFAULT_PER_KM_DELIVERY_CHARGE = 8;

export function calculateDistanceDeliveryFee(params: {
  distanceKm: number | null | undefined;
  baseDeliveryCharge: number;
  baseDistanceKm?: number;
  perKmCharge?: number;
  maxDeliveryCharge?: number;
  allowDistancePricing?: boolean;
}): number {
  const base = Math.max(0, Math.round(Number(params.baseDeliveryCharge || 0)));
  if (params.allowDistancePricing === false) return base;

  const dist = Number(params.distanceKm);
  if (
    params.distanceKm === null ||
    params.distanceKm === undefined ||
    !Number.isFinite(dist) ||
    dist < 0
  ) {
    return base;
  }

  const safeBaseDist = Math.max(
    0,
    params.baseDistanceKm !== undefined && Number.isFinite(Number(params.baseDistanceKm))
      ? Number(params.baseDistanceKm)
      : DEFAULT_BASE_DELIVERY_DISTANCE_KM
  );
  const safePerKm = Math.max(
    0,
    params.perKmCharge !== undefined && Number.isFinite(Number(params.perKmCharge))
      ? Number(params.perKmCharge)
      : DEFAULT_PER_KM_DELIVERY_CHARGE
  );

  let fee = base;
  if (dist > safeBaseDist && safePerKm > 0) {
    fee = Math.round(base + (dist - safeBaseDist) * safePerKm);
  }

  const maxCap = Number(params.maxDeliveryCharge || 0);
  if (Number.isFinite(maxCap) && maxCap > 0) {
    fee = Math.min(fee, Math.round(maxCap));
  }

  return Math.max(0, fee);
}

export function getBasketDistanceDeliveryInfo(params: {
  groupedByStore: StoreBasketGroup[];
  stores: Record<string, Store>;
  customerLat?: number | null;
  customerLng?: number | null;
  baseDeliveryCharge: number;
  baseDistanceKm?: number;
  perKmCharge?: number;
  maxDeliveryCharge?: number;
  allowDistancePricing?: boolean;
}): { maxDistanceKm: number | null; deliveryFee: number } {
  const hasCoords =
    params.customerLat !== null &&
    params.customerLat !== undefined &&
    params.customerLng !== null &&
    params.customerLng !== undefined &&
    Number.isFinite(Number(params.customerLat)) &&
    Number.isFinite(Number(params.customerLng));

  if (!hasCoords || params.allowDistancePricing === false) {
    return {
      maxDistanceKm: null,
      deliveryFee: Math.max(0, Math.round(Number(params.baseDeliveryCharge || 0))),
    };
  }

  let maxDist: number | null = null;
  params.groupedByStore.forEach((grp) => {
    const st = params.stores[grp.storeId];
    const dist = getStoreDistanceKm(st, params.customerLat, params.customerLng);
    if (dist !== null && (maxDist === null || dist > maxDist)) {
      maxDist = dist;
    }
  });

  return {
    maxDistanceKm: maxDist,
    deliveryFee: calculateDistanceDeliveryFee({
      distanceKm: maxDist,
      baseDeliveryCharge: params.baseDeliveryCharge,
      baseDistanceKm: params.baseDistanceKm,
      perKmCharge: params.perKmCharge,
      maxDeliveryCharge: params.maxDeliveryCharge,
      allowDistancePricing: params.allowDistancePricing,
    }),
  };
}

export interface DistanceCheckoutSummary extends CheckoutSummary {
  deliveryDistanceKm: number | null;
  effectiveBaseDeliveryCharge: number;
}

export function calculateDistanceCheckoutSummary(params: {
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
  customerLat?: number | null;
  customerLng?: number | null;
  baseDeliveryDistanceKm?: number;
  perKmDeliveryCharge?: number;
  maxDeliveryCharge?: number;
  allowDistanceDeliveryCharge?: boolean;
}): DistanceCheckoutSummary {
  const grouped = groupCartByStore(params.items, params.stores);
  const distInfo = getBasketDistanceDeliveryInfo({
    groupedByStore: grouped,
    stores: params.stores,
    customerLat: params.customerLat,
    customerLng: params.customerLng,
    baseDeliveryCharge: params.baseDeliveryCharge,
    baseDistanceKm: params.baseDeliveryDistanceKm,
    perKmCharge: params.perKmDeliveryCharge,
    maxDeliveryCharge: params.maxDeliveryCharge,
    allowDistancePricing: params.allowDistanceDeliveryCharge,
  });

  const baseSummary = calculateCheckoutSummary({
    ...params,
    baseDeliveryCharge: distInfo.deliveryFee,
  });

  return {
    ...baseSummary,
    deliveryDistanceKm: distInfo.maxDistanceKm,
    effectiveBaseDeliveryCharge: distInfo.deliveryFee,
  };
}
