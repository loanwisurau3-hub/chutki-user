import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  APILoadingStatus,
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import type { DeliveryPartner } from '../types/bazar';
import { calculateDistanceKm } from '../utils/bazarLogic';
import {
  appendTrailPoint,
  computeBearingDeg,
  computeMiniMapBounds,
  estimateEtaMinutes,
  isValidCoord,
  projectToViewport,
  type GeoPoint,
  type MiniMapBounds,
} from '../utils/miniMapLogic';

export interface StoreMarkerInfo {
  storeId: string;
  name: string;
  lat: number;
  lng: number;
}

interface RiderMiniMapProps {
  groupKey: string;
  orderStatus: string;
  rider: DeliveryPartner | null;
  riderLat: number | null;
  riderLng: number | null;
  customerLat: number | null;
  customerLng: number | null;
  storeMarkers: StoreMarkerInfo[];
  quotaExceeded: boolean;
}

const MAPS_API_KEY =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || '';

interface PolylineHandle {
  setPath: (path: GeoPoint[]) => void;
  setMap: (map: unknown) => void;
}

interface MapOverlayProps {
  trail: GeoPoint[];
  riderPoint: GeoPoint | null;
  customerPoint: GeoPoint | null;
  storeMarkers: StoreMarkerInfo[];
  fitSignal: number;
  autoFollow: boolean;
}

const MapViewportAndPolylines: React.FC<MapOverlayProps> = ({
  trail,
  riderPoint,
  customerPoint,
  storeMarkers,
  fitSignal,
  autoFollow,
}) => {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const coreLib = useMapsLibrary('core');
  const trailLineRef = useRef<PolylineHandle | null>(null);
  const targetLineRef = useRef<PolylineHandle | null>(null);

  useEffect(() => {
    if (!map || !mapsLib) return;
    const PolylineCtor = mapsLib.Polyline as unknown as new (
      opts: Record<string, unknown>
    ) => PolylineHandle;

    if (!trailLineRef.current) {
      trailLineRef.current = new PolylineCtor({
        strokeColor: '#0c831f',
        strokeOpacity: 0.9,
        strokeWeight: 4,
        map,
      });
    }
    trailLineRef.current.setPath(trail);

    if (!targetLineRef.current) {
      targetLineRef.current = new PolylineCtor({
        strokeColor: '#0f172a',
        strokeOpacity: 0,
        strokeWeight: 2,
        icons: [
          {
            icon: {
              path: 'M 0,-1 0,1',
              strokeOpacity: 0.55,
              scale: 2.6,
            },
            offset: '0',
            repeat: '12px',
          },
        ],
        map,
      });
    }

    if (riderPoint && customerPoint) {
      targetLineRef.current.setPath([riderPoint, customerPoint]);
    } else {
      targetLineRef.current.setPath([]);
    }
  }, [map, mapsLib, trail, riderPoint, customerPoint]);

  useEffect(() => {
    return () => {
      trailLineRef.current?.setMap(null);
      trailLineRef.current = null;
      targetLineRef.current?.setMap(null);
      targetLineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map || !coreLib) return;
    if (!autoFollow && fitSignal === 0) return;

    const pts: GeoPoint[] = [];
    if (riderPoint) pts.push(riderPoint);
    if (customerPoint) pts.push(customerPoint);
    storeMarkers.forEach((s) => pts.push({ lat: s.lat, lng: s.lng }));

    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.panTo(pts[0]);
      return;
    }

    const bounds = new coreLib.LatLngBounds();
    pts.forEach((pt) => bounds.extend(pt));
    map.fitBounds(bounds, { top: 42, right: 36, bottom: 44, left: 36 });
  }, [map, coreLib, riderPoint, customerPoint, storeMarkers, fitSignal, autoFollow]);

  return null;
};

interface GoogleMapCanvasProps {
  bounds: MiniMapBounds;
  trail: GeoPoint[];
  riderPoint: GeoPoint | null;
  customerPoint: GeoPoint | null;
  storeMarkers: StoreMarkerInfo[];
  rider: DeliveryPartner | null;
  riderDistKm: number | null;
  etaMinutes: number | null;
  bearingDeg: number;
  fitSignal: number;
  autoFollow: boolean;
  onFallbackToRadar: () => void;
}

const GoogleMapCanvas: React.FC<GoogleMapCanvasProps> = ({
  bounds,
  trail,
  riderPoint,
  customerPoint,
  storeMarkers,
  rider,
  riderDistKm,
  etaMinutes,
  bearingDeg,
  fitSignal,
  autoFollow,
  onFallbackToRadar,
}) => {
  const status = useApiLoadingStatus();
  const [riderMarkerRef, riderMarker] = useAdvancedMarkerRef();
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    if (
      status === APILoadingStatus.FAILED ||
      status === APILoadingStatus.AUTH_FAILURE
    ) {
      onFallbackToRadar();
    }
  }, [status, onFallbackToRadar]);

  return (
    <Map
      mapId="DEMO_MAP_ID"
      internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
      defaultCenter={bounds.center}
      defaultZoom={bounds.zoom}
      gestureHandling="cooperative"
      disableDefaultUI={true}
      style={{ width: '100%', height: '100%' }}
    >
      <MapViewportAndPolylines
        trail={trail}
        riderPoint={riderPoint}
        customerPoint={customerPoint}
        storeMarkers={storeMarkers}
        fitSignal={fitSignal}
        autoFollow={autoFollow}
      />

      {storeMarkers.map((store) => (
        <AdvancedMarker
          key={store.storeId}
          position={{ lat: store.lat, lng: store.lng }}
          title={store.name}
        >
          <div className="minimap-pin minimap-pin-store">
            <span>🏪</span>
          </div>
        </AdvancedMarker>
      ))}

      {customerPoint && (
        <AdvancedMarker position={customerPoint} title="Delivery Doorstep">
          <div className="minimap-pin minimap-pin-customer">
            <span>🏠</span>
          </div>
        </AdvancedMarker>
      )}

      {riderPoint && (
        <>
          <AdvancedMarker
            ref={riderMarkerRef}
            position={riderPoint}
            title={rider?.name || 'Delivery Partner'}
            onClick={() => setInfoOpen((prev) => !prev)}
          >
            <div className="minimap-rider-marker">
              <span className="minimap-rider-pulse" />
              <div
                className="minimap-rider-badge"
                style={{ transform: `rotate(${Math.round(bearingDeg)}deg)` }}
                aria-hidden="true"
              >
                <i className="fa-solid fa-location-arrow minimap-heading-arrow" />
              </div>
              <div className="minimap-rider-scooter">🛵</div>
            </div>
          </AdvancedMarker>

          {infoOpen && riderMarker && (
            <InfoWindow
              anchor={riderMarker}
              maxWidth={210}
              onCloseClick={() => setInfoOpen(false)}
            >
              <div style={{ fontSize: '0.75rem', lineHeight: 1.35, color: '#0f172a' }}>
                <strong style={{ display: 'block', marginBottom: '2px' }}>
                  {rider?.name || 'Delivery Partner'}
                </strong>
                <div>
                  {rider?.vehicle || 'Bike'}
                  {riderDistKm !== null ? ` • ${riderDistKm.toFixed(2)} km` : ''}
                  {etaMinutes !== null ? ` • ~${etaMinutes} min` : ''}
                </div>
                <div style={{ color: '#64748b', fontSize: '0.68rem', marginTop: '2px' }}>
                  {riderPoint.lat.toFixed(5)}, {riderPoint.lng.toFixed(5)}
                </div>
              </div>
            </InfoWindow>
          )}
        </>
      )}
    </Map>
  );
};

interface RadarVisualizerProps {
  bounds: MiniMapBounds;
  trail: GeoPoint[];
  riderPoint: GeoPoint | null;
  customerPoint: GeoPoint | null;
  storeMarkers: StoreMarkerInfo[];
  bearingDeg: number;
  expanded: boolean;
}

const CoordinateRadarVisualizer: React.FC<RadarVisualizerProps> = ({
  bounds,
  trail,
  riderPoint,
  customerPoint,
  storeMarkers,
  bearingDeg,
  expanded,
}) => {
  const svgUid = useId().replace(/:/g, '');
  const roadGridId = `gb-road-grid-${svgUid}`;
  const radarGlowId = `gb-radar-glow-${svgUid}`;
  const width = 360;
  const height = expanded ? 250 : 175;
  const pad = 28;

  const riderPx = riderPoint
    ? projectToViewport(riderPoint, bounds, width, height, pad)
    : null;
  const customerPx = customerPoint
    ? projectToViewport(customerPoint, bounds, width, height, pad)
    : null;
  const storePxList = storeMarkers.map((s) => ({
    ...s,
    pt: projectToViewport({ lat: s.lat, lng: s.lng }, bounds, width, height, pad),
  }));

  const trailPointsAttr = trail
    .map((pt) => {
      const p = projectToViewport(pt, bounds, width, height, pad);
      return `${p.x},${p.y}`;
    })
    .join(' ');

  return (
    <div className="minimap-radar-canvas">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid slice"
        className="minimap-radar-svg"
        role="img"
        aria-label="Live rider coordinate visualizer"
      >
        <defs>
          <pattern
            id={roadGridId}
            width="36"
            height="36"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 36 0 L 0 0 0 36"
              fill="none"
              stroke="#dbe4ee"
              strokeWidth="1"
            />
          </pattern>
          <radialGradient id={radarGlowId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#0c831f" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#0c831f" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width={width} height={height} fill="#eef4f1" />
        <rect width={width} height={height} fill={`url(#${roadGridId})`} />

        {/* Stylized local road arterial lines */}
        <path
          d={`M 0 ${height * 0.72} Q ${width * 0.42} ${height * 0.52}, ${width} ${height * 0.25}`}
          fill="none"
          stroke="#ffffff"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <path
          d={`M ${width * 0.18} 0 Q ${width * 0.5} ${height * 0.48}, ${width * 0.82} ${height}`}
          fill="none"
          stroke="#ffffff"
          strokeWidth="6"
          strokeLinecap="round"
        />

        {/* Route line from rider to customer */}
        {riderPx && customerPx && (
          <line
            x1={riderPx.x}
            y1={riderPx.y}
            x2={customerPx.x}
            y2={customerPx.y}
            stroke="#0f172a"
            strokeOpacity="0.4"
            strokeWidth="2.5"
            strokeDasharray="6 5"
          />
        )}

        {/* Store to rider path */}
        {storePxList[0] && riderPx && (
          <line
            x1={storePxList[0].pt.x}
            y1={storePxList[0].pt.y}
            x2={riderPx.x}
            y2={riderPx.y}
            stroke="#0c831f"
            strokeOpacity="0.35"
            strokeWidth="2.5"
            strokeDasharray="3 4"
          />
        )}

        {/* Traveled GPS breadcrumb trail */}
        {trail.length > 1 && (
          <polyline
            fill="none"
            stroke="#0c831f"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={trailPointsAttr}
          />
        )}

        {/* Breadcrumb dots */}
        {trail.slice(0, -1).map((pt, idx) => {
          const p = projectToViewport(pt, bounds, width, height, pad);
          return (
            <circle
              key={`${pt.lat}_${pt.lng}_${idx}`}
              cx={p.x}
              cy={p.y}
              r="2.4"
              fill="#0c831f"
              opacity={0.45 + (idx / Math.max(1, trail.length)) * 0.45}
            />
          );
        })}

        {/* Customer proximity ring */}
        {customerPx && (
          <circle
            cx={customerPx.x}
            cy={customerPx.y}
            r="22"
            fill={`url(#${radarGlowId})`}
            stroke="#0c831f"
            strokeOpacity="0.22"
            strokeDasharray="3 3"
          />
        )}

        {/* Store pin(s) */}
        {storePxList.map((s) => (
          <g
            key={s.storeId}
            transform={`translate(${s.pt.x}, ${s.pt.y})`}
            className="minimap-svg-transition"
          >
            <circle r="13" fill="#ffffff" stroke="#0c831f" strokeWidth="2" />
            <text
              x="0"
              y="4"
              textAnchor="middle"
              fontSize="12"
            >
              🏪
            </text>
          </g>
        ))}

        {/* Customer doorstep pin */}
        {customerPx && (
          <g
            transform={`translate(${customerPx.x}, ${customerPx.y})`}
            className="minimap-svg-transition"
          >
            <circle r="14" fill="#0f172a" stroke="#ffffff" strokeWidth="2" />
            <text
              x="0"
              y="4.5"
              textAnchor="middle"
              fontSize="12"
            >
              🏠
            </text>
          </g>
        )}

        {/* Live animated rider pin */}
        {riderPx && (
          <g
            transform={`translate(${riderPx.x}, ${riderPx.y})`}
            className="minimap-svg-transition"
            data-testid="minimap-rider-marker"
          >
            <circle r="21" fill="#0c831f" opacity="0.18">
              <animate
                attributeName="r"
                values="14;24;14"
                dur="1.8s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                values="0.32;0.05;0.32"
                dur="1.8s"
                repeatCount="indefinite"
              />
            </circle>
            <g transform={`rotate(${Math.round(bearingDeg)})`}>
              <polygon
                points="0,-20 5,-11 -5,-11"
                fill="#0c831f"
              />
            </g>
            <circle r="14" fill="#0c831f" stroke="#ffffff" strokeWidth="2.5" />
            <text x="0" y="4.5" textAnchor="middle" fontSize="13">
              🛵
            </text>
          </g>
        )}
      </svg>

      {/* Legend pills inside radar */}
      <div className="minimap-legend-overlay">
        <span className="minimap-legend-item">🏪 Store</span>
        <span className="minimap-legend-item">🛵 Rider</span>
        <span className="minimap-legend-item">🏠 You</span>
      </div>
    </div>
  );
};

export const RiderMiniMap: React.FC<RiderMiniMapProps> = ({
  groupKey,
  orderStatus,
  rider,
  riderLat,
  riderLng,
  customerLat,
  customerLng,
  storeMarkers,
  quotaExceeded,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [autoFollow, setAutoFollow] = useState(true);
  const [fitSignal, setFitSignal] = useState(0);
  const [preferRadar, setPreferRadar] = useState(false);
  const [mapsFailed, setMapsFailed] = useState(false);
  const [trail, setTrail] = useState<GeoPoint[]>([]);
  const prevRiderRef = useRef<GeoPoint | null>(null);

  const riderPoint: GeoPoint | null = useMemo(
    () =>
      isValidCoord(riderLat, riderLng)
        ? { lat: Number(riderLat), lng: Number(riderLng) }
        : null,
    [riderLat, riderLng]
  );

  const customerPoint: GeoPoint | null = useMemo(
    () =>
      isValidCoord(customerLat, customerLng)
        ? { lat: Number(customerLat), lng: Number(customerLng) }
        : null,
    [customerLat, customerLng]
  );

  const validStores = useMemo(
    () => storeMarkers.filter((s) => isValidCoord(s.lat, s.lng)),
    [storeMarkers]
  );

  useEffect(() => {
    prevRiderRef.current = null;
    setTrail([]);
  }, [groupKey]);

  // Track movement trail history and heading angle as live rider lat/lng updates
  useEffect(() => {
    if (!riderPoint) return;
    setTrail((prev) => appendTrailPoint(prev, riderPoint));
  }, [riderPoint]);

  const bearingDeg = useMemo(() => {
    if (!riderPoint) return 0;
    const prev = prevRiderRef.current;
    if (prev && (prev.lat !== riderPoint.lat || prev.lng !== riderPoint.lng)) {
      return computeBearingDeg(prev, riderPoint);
    }
    if (customerPoint) {
      return computeBearingDeg(riderPoint, customerPoint);
    }
    return 0;
  }, [riderPoint, customerPoint]);

  useEffect(() => {
    if (riderPoint) {
      prevRiderRef.current = riderPoint;
    }
  }, [riderPoint]);

  const bounds = useMemo(() => {
    const allPts: GeoPoint[] = [];
    if (riderPoint) allPts.push(riderPoint);
    if (customerPoint) allPts.push(customerPoint);
    validStores.forEach((s) => allPts.push({ lat: s.lat, lng: s.lng }));
    trail.forEach((t) => allPts.push(t));
    return computeMiniMapBounds(allPts);
  }, [riderPoint, customerPoint, validStores, trail]);

  const riderDistKm = useMemo(() => {
    if (!riderPoint || !customerPoint) return null;
    return calculateDistanceKm(
      riderPoint.lat,
      riderPoint.lng,
      customerPoint.lat,
      customerPoint.lng
    );
  }, [riderPoint, customerPoint]);

  const etaMinutes = useMemo(
    () => estimateEtaMinutes(riderDistKm),
    [riderDistKm]
  );

  const canUseGoogleMap =
    Boolean(MAPS_API_KEY) && !quotaExceeded && !mapsFailed && !preferRadar;

  const hasAnyCoordinates =
    Boolean(riderPoint) || Boolean(customerPoint) || validStores.length > 0;

  if (!hasAnyCoordinates) return null;

  return (
    <div
      className="rider-minimap-card"
      data-testid={`rider-minimap-${groupKey}`}
    >
      {/* Top live header bar */}
      <div className="rider-minimap-header">
        <div className="rider-minimap-title-group">
          <span className="rider-live-dot" />
          <span className="rider-minimap-title">
            {riderPoint ? 'Live Rider Map' : 'Route Preview'}
          </span>
          <span className="rider-minimap-eta">
            {etaMinutes !== null && riderDistKm !== null
              ? `~${etaMinutes} min • ${riderDistKm.toFixed(2)} km`
              : orderStatus.replace(/_/g, ' ')}
          </span>
        </div>

        <div className="rider-minimap-actions">
          {Boolean(MAPS_API_KEY) && !quotaExceeded && !mapsFailed && (
            <button
              type="button"
              className="minimap-ctrl-btn"
              onClick={() => setPreferRadar((v) => !v)}
              title={preferRadar ? 'Switch to Google Map' : 'Switch to Radar View'}
              aria-label={preferRadar ? 'Switch to Google Map' : 'Switch to Radar View'}
            >
              <i
                className={`fa-solid ${preferRadar ? 'fa-map-location-dot' : 'fa-compass'}`}
              />
            </button>
          )}
          <button
            type="button"
            className="minimap-ctrl-btn"
            onClick={() => {
              setAutoFollow(true);
              setFitSignal((c) => c + 1);
            }}
            title="Recenter Map"
            aria-label="Recenter Map"
          >
            <i className="fa-solid fa-crosshairs" />
          </button>
          <button
            type="button"
            className="minimap-ctrl-btn"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Compact Map' : 'Expand Map'}
            aria-label={expanded ? 'Compact Map' : 'Expand Map'}
          >
            <i
              className={`fa-solid ${expanded ? 'fa-compress' : 'fa-expand'}`}
            />
          </button>
        </div>
      </div>

      {/* Map / Visualizer Canvas with explicit CSS height */}
      <div
        className={`rider-minimap-viewport ${expanded ? 'expanded' : ''}`}
      >
        {canUseGoogleMap ? (
          <APIProvider
            apiKey={MAPS_API_KEY}
            libraries={['marker']}
            language="en"
            region="IN"
          >
            <GoogleMapCanvas
              bounds={bounds}
              trail={trail}
              riderPoint={riderPoint}
              customerPoint={customerPoint}
              storeMarkers={validStores}
              rider={rider}
              riderDistKm={riderDistKm}
              etaMinutes={etaMinutes}
              bearingDeg={bearingDeg}
              fitSignal={fitSignal}
              autoFollow={autoFollow}
              onFallbackToRadar={() => setMapsFailed(true)}
            />
          </APIProvider>
        ) : (
          <CoordinateRadarVisualizer
            bounds={bounds}
            trail={trail}
            riderPoint={riderPoint}
            customerPoint={customerPoint}
            storeMarkers={validStores}
            bearingDeg={bearingDeg}
            expanded={expanded}
          />
        )}
      </div>

      {/* Real-time Coordinate Telemetry Strip */}
      <div className="rider-minimap-footer">
        <span data-testid="rider-coords-readout">
          {riderPoint ? (
            <>
              <i className="fa-solid fa-satellite-dish" />{' '}
              {riderPoint.lat.toFixed(5)}°N, {riderPoint.lng.toFixed(5)}°E
            </>
          ) : (
            <>
              <i className="fa-solid fa-hourglass-half" /> Waiting for rider GPS...
            </>
          )}
        </span>
        <span>
          {trail.length > 1
            ? `${trail.length} GPS pts tracked`
            : rider?.lastLocationUpdate
              ? `Synced ${new Date(rider.lastLocationUpdate).toLocaleTimeString()}`
              : 'Real-time feed'}
        </span>
      </div>
    </div>
  );
};
