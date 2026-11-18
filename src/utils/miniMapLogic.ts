import { calculateDistanceKm } from './bazarLogic';

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
}

export interface MiniMapBounds {
  center: GeoPoint;
  zoom: number;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function isValidCoord(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
}

export function appendTrailPoint(
  trail: GeoPoint[],
  nextPoint: GeoPoint | null,
  minDeltaKm = 0.002,
  maxPoints = 30
): GeoPoint[] {
  if (!nextPoint || !isValidCoord(nextPoint.lat, nextPoint.lng)) {
    return trail;
  }
  const last = trail[trail.length - 1];
  if (last) {
    const movedKm = calculateDistanceKm(
      last.lat,
      last.lng,
      nextPoint.lat,
      nextPoint.lng
    );
    if (movedKm !== null && movedKm < minDeltaKm) {
      return trail;
    }
  }
  const updated = [...trail, { lat: nextPoint.lat, lng: nextPoint.lng }];
  if (updated.length > maxPoints) {
    return updated.slice(updated.length - maxPoints);
  }
  return updated;
}

export function computeBearingDeg(from: GeoPoint, to: GeoPoint): number {
  if (
    !isValidCoord(from.lat, from.lng) ||
    !isValidCoord(to.lat, to.lng) ||
    (from.lat === to.lat && from.lng === to.lng)
  ) {
    return 0;
  }
  const rad = Math.PI / 180;
  const lat1 = from.lat * rad;
  const lat2 = to.lat * rad;
  const dLng = (to.lng - from.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

export function estimateEtaMinutes(
  distanceKm: number | null,
  avgSpeedKmh = 20
): number | null {
  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm < 0) {
    return null;
  }
  return Math.max(1, Math.round((distanceKm / avgSpeedKmh) * 60));
}

export function computeMiniMapBounds(points: GeoPoint[]): MiniMapBounds {
  const valid = points.filter((p) => isValidCoord(p.lat, p.lng));
  const fallback: GeoPoint = { lat: 26.4524, lng: 89.9723 };
  if (valid.length === 0) {
    return {
      center: fallback,
      zoom: 15,
      minLat: fallback.lat - 0.002,
      maxLat: fallback.lat + 0.002,
      minLng: fallback.lng - 0.002,
      maxLng: fallback.lng + 0.002,
    };
  }

  let minLat = valid[0].lat;
  let maxLat = valid[0].lat;
  let minLng = valid[0].lng;
  let maxLng = valid[0].lng;

  for (const p of valid) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const latSpan = Math.max(maxLat - minLat, 0.0014);
  const lngSpan = Math.max(maxLng - minLng, 0.0018);
  const padLat = latSpan * 0.32;
  const padLng = lngSpan * 0.32;

  const center: GeoPoint = {
    lat: Number(((minLat + maxLat) / 2).toFixed(6)),
    lng: Number(((minLng + maxLng) / 2).toFixed(6)),
  };

  const maxSpan = Math.max(latSpan, lngSpan);
  let zoom = 16;
  if (maxSpan > 0.08) zoom = 12;
  else if (maxSpan > 0.03) zoom = 13;
  else if (maxSpan > 0.012) zoom = 14;
  else if (maxSpan > 0.004) zoom = 15;

  return {
    center,
    zoom,
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
    minLng: minLng - padLng,
    maxLng: maxLng + padLng,
  };
}

export function projectToViewport(
  point: GeoPoint,
  bounds: MiniMapBounds,
  width: number,
  height: number,
  padding = 24
): ProjectedPoint {
  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  const lngRange = Math.max(1e-6, bounds.maxLng - bounds.minLng);
  const latRange = Math.max(1e-6, bounds.maxLat - bounds.minLat);

  const normX = (point.lng - bounds.minLng) / lngRange;
  const normY = 1 - (point.lat - bounds.minLat) / latRange;

  return {
    x: Number((padding + Math.min(1, Math.max(0, normX)) * innerW).toFixed(2)),
    y: Number((padding + Math.min(1, Math.max(0, normY)) * innerH).toFixed(2)),
  };
}

export function stepDemoRiderCoord(
  store: GeoPoint,
  customer: GeoPoint,
  stepIndex: number,
  totalSteps = 20
): GeoPoint {
  const safeTotal = Math.max(4, totalSteps);
  // Oscillate smoothly along a realistic curved route between store pickup and customer doorstep
  const cycle = stepIndex % (safeTotal * 2);
  const rawProgress =
    cycle <= safeTotal ? cycle / safeTotal : (safeTotal * 2 - cycle) / safeTotal;
  const t = Math.min(0.94, Math.max(0.08, rawProgress));
  const curveOffset = Math.sin(t * Math.PI) * 0.00045;

  return {
    lat: Number((store.lat + (customer.lat - store.lat) * t + curveOffset).toFixed(6)),
    lng: Number((store.lng + (customer.lng - store.lng) * t - curveOffset * 0.7).toFixed(6)),
  };
}
