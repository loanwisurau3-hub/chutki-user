import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendTrailPoint,
  computeBearingDeg,
  computeMiniMapBounds,
  estimateEtaMinutes,
  isValidCoord,
  projectToViewport,
  stepDemoRiderCoord,
} from './miniMapLogic.ts';

test('isValidCoord validates geographic bounds and filters zeroed placeholders', () => {
  assert.equal(isValidCoord(26.454, 89.974), true);
  assert.equal(isValidCoord(0, 0), false);
  assert.equal(isValidCoord(null, 89.97), false);
  assert.equal(isValidCoord(95, 89.97), false);
  assert.equal(isValidCoord(26.45, 200), false);
});

test('appendTrailPoint deduplicates tiny jitter and caps trail length', () => {
  let trail = appendTrailPoint([], { lat: 26.454, lng: 89.974 });
  assert.equal(trail.length, 1);

  // Tiny jitter (< 2 meters) should not add duplicate breadcrumb
  trail = appendTrailPoint(trail, { lat: 26.454001, lng: 89.974001 });
  assert.equal(trail.length, 1);

  // Real movement (~50 meters) appends point
  trail = appendTrailPoint(trail, { lat: 26.4535, lng: 89.9735 });
  assert.equal(trail.length, 2);

  // Capped to maxPoints = 3
  trail = appendTrailPoint(trail, { lat: 26.453, lng: 89.973 }, 0.002, 3);
  trail = appendTrailPoint(trail, { lat: 26.4525, lng: 89.9725 }, 0.002, 3);
  assert.equal(trail.length, 3);
  assert.equal(trail[2].lat, 26.4525);
});

test('computeBearingDeg computes expected compass angles', () => {
  const north = computeBearingDeg({ lat: 26.45, lng: 89.97 }, { lat: 26.46, lng: 89.97 });
  assert.ok(north < 2 || north > 358);

  const east = computeBearingDeg({ lat: 26.45, lng: 89.97 }, { lat: 26.45, lng: 89.98 });
  assert.ok(east > 85 && east < 95);

  const south = computeBearingDeg({ lat: 26.46, lng: 89.97 }, { lat: 26.45, lng: 89.97 });
  assert.ok(south > 175 && south < 185);
});

test('estimateEtaMinutes converts distance to realistic local delivery ETA', () => {
  assert.equal(estimateEtaMinutes(null), null);
  assert.equal(estimateEtaMinutes(0.1), 1);
  assert.equal(estimateEtaMinutes(2.0, 20), 6);
});

test('computeMiniMapBounds & projectToViewport keep store, rider, and customer inside canvas', () => {
  const store = { lat: 26.453, lng: 89.973 };
  const rider = { lat: 26.454, lng: 89.974 };
  const customer = { lat: 26.4524, lng: 89.9723 };

  const bounds = computeMiniMapBounds([store, rider, customer]);
  assert.ok(bounds.zoom >= 14 && bounds.zoom <= 16);
  assert.ok(bounds.maxLat > bounds.minLat);
  assert.ok(bounds.maxLng > bounds.minLng);

  const pRider = projectToViewport(rider, bounds, 320, 190, 20);
  const pCust = projectToViewport(customer, bounds, 320, 190, 20);
  assert.ok(pRider.x >= 20 && pRider.x <= 300);
  assert.ok(pRider.y >= 20 && pRider.y <= 170);
  assert.ok(pCust.x >= 20 && pCust.x <= 300);
  assert.ok(pCust.y >= 20 && pCust.y <= 170);
});

test('stepDemoRiderCoord advances smooth route coordinates between store and doorstep', () => {
  const store = { lat: 26.453, lng: 89.973 };
  const customer = { lat: 26.4524, lng: 89.9723 };
  const p1 = stepDemoRiderCoord(store, customer, 2, 10);
  const p2 = stepDemoRiderCoord(store, customer, 6, 10);
  assert.notEqual(p1.lat, p2.lat);
  assert.notEqual(p1.lng, p2.lng);
});
