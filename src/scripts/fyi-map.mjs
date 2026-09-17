import L from 'leaflet';
import leafletCss from 'leaflet/dist/leaflet.css?raw';

const TILE_URL = '/api/osm-tiles/{z}/{x}/{y}.png';
const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener" target="_blank">OpenStreetMap contributors</a>';

const CEBU_BOUNDS = Object.freeze({ south: 9, west: 122, north: 12, east: 125 });
const CEBU_MAP_BOUNDS = Object.freeze({ south: 9.2, west: 122.8, north: 11.5, east: 124.3 });
const MAX_CLOUDS = 64;
const MAX_WINDOWS = 256;
const MAX_PAIRS = 24_000;
const MAX_PAIRS_PER_CLOUD = 4_096;
const MAP_ERROR = 'The supplemental map is unavailable.';
const STYLE_ID = 'fyi-map-leaflet-styles';

function ensureLeafletStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = leafletCss;
  document.head.appendChild(style);
}

const decodedEnvelopes = new WeakMap();

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isCebuPoint = (lat, lng) =>
  isFiniteNumber(lat) &&
  isFiniteNumber(lng) &&
  lat >= CEBU_BOUNDS.south &&
  lat <= CEBU_BOUNDS.north &&
  lng >= CEBU_BOUNDS.west &&
  lng <= CEBU_BOUNDS.east;

function unavailable() {
  return new Error(MAP_ERROR);
}

function boundedIndexes(value, cloudCount) {
  if (!Array.isArray(value) || value.length > cloudCount) return null;

  const indexes = new Set();
  for (const index of value) {
    if (!Number.isInteger(index) || index < 0 || index >= cloudCount) return null;
    indexes.add(index);
  }
  return indexes;
}

function decodeCloud(value) {
  if (!isObject(value) || !Array.isArray(value.c) || value.c.length !== 2 || !Array.isArray(value.p)) return null;

  const [centerLat, centerLng] = value.c;
  const deltas = value.p;
  if (
    !isCebuPoint(centerLat, centerLng) ||
    deltas.length % 2 !== 0 ||
    deltas.length / 2 > MAX_PAIRS_PER_CLOUD
  ) return null;

  const points = new Float64Array(deltas.length);
  for (let offset = 0; offset < deltas.length; offset += 2) {
    const latDelta = deltas[offset];
    const lngDelta = deltas[offset + 1];
    if (!Number.isInteger(latDelta) || !Number.isInteger(lngDelta)) return null;

    const lat = centerLat + latDelta / 100_000;
    const lng = centerLng + lngDelta / 100_000;
    if (!isCebuPoint(lat, lng)) return null;

    points[offset] = lat;
    points[offset + 1] = lng;
  }

  return points;
}

function validatedBounds(value) {
  if (!isObject(value)) return null;
  const { south, west, north, east } = value;
  if (
    !isCebuPoint(south, west) ||
    !isCebuPoint(north, east) ||
    south > north ||
    west > east
  ) return null;
  return L.latLngBounds([south, west], [north, east]);
}

function decodeEnvelope(envelope) {
  if (!isObject(envelope) || envelope.available !== true || !Array.isArray(envelope.clouds) || !Array.isArray(envelope.windows)) {
    throw unavailable();
  }
  if (envelope.clouds.length > MAX_CLOUDS || envelope.windows.length > MAX_WINDOWS) throw unavailable();

  const bounds = validatedBounds(envelope.bounds);
  if (!bounds) throw unavailable();

  let pairCount = 0;
  const clouds = envelope.clouds.map((cloud) => {
    if (isObject(cloud) && Array.isArray(cloud.p)) {
      if (cloud.p.length % 2 !== 0 || cloud.p.length / 2 > MAX_PAIRS_PER_CLOUD) throw unavailable();
      pairCount += cloud.p.length / 2;
      if (pairCount > MAX_PAIRS) throw unavailable();
    }

    const decoded = decodeCloud(cloud);
    if (!decoded) throw unavailable();
    return decoded;
  });

  const windows = envelope.windows.map((window) => {
    if (
      !isObject(window) ||
      typeof window.start !== 'string' ||
      typeof window.end !== 'string' ||
      window.start.length > 40 ||
      window.end.length > 40
    ) return null;
    const start = Date.parse(window.start);
    const end = Date.parse(window.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;

    const cloudIndexes = boundedIndexes(window.cloudIndexes, clouds.length);
    const confirmedCloudIndexes = boundedIndexes(window.confirmedCloudIndexes, clouds.length);
    if (!cloudIndexes || !confirmedCloudIndexes) return null;

    const confirmedUntil = window.confirmedUntil;
    if (confirmedUntil !== null && (typeof confirmedUntil !== 'string' || confirmedUntil.length > 40)) return null;
    const confirmedUntilAt = confirmedUntil === null ? null : Date.parse(confirmedUntil);
    if (confirmedUntil !== null && !Number.isFinite(confirmedUntilAt)) return null;

    const state = window.operatorState;
    if (!['none', 'per-feeder', 'aggregate', 'stale', 'restored'].includes(state)) return null;

    for (const index of confirmedCloudIndexes) {
      if (!cloudIndexes.has(index)) return null;
    }
    return {
      start,
      end,
      cloudIndexes,
      confirmedCloudIndexes,
      confirmedUntil,
      confirmedUntilAt,
      operatorState: state,
    };
  });

  if (!clouds.length) throw unavailable();
  return { bounds, clouds, windows };
}

function normalizedEnvelope(envelope) {
  if (!isObject(envelope)) throw unavailable();
  const cached = decodedEnvelopes.get(envelope);
  if (cached) return cached;

  const decoded = decodeEnvelope(envelope);
  decodedEnvelopes.set(envelope, decoded);
  return decoded;
}

function colorFrom(container, name, fallback) {
  const value = getComputedStyle(container).getPropertyValue(name).trim();
  return value || fallback;
}

function markerPoint(value) {
  if (Array.isArray(value) && value.length === 2 && isCebuPoint(value[0], value[1])) return value;
  if (isObject(value) && isCebuPoint(value.lat, value.lng)) return [value.lat, value.lng];
  return null;
}

class PointCloudLayer extends L.Layer {
  constructor(container, decoded) {
    super();
    this.container = container;
    this.decoded = decoded;
    this.windowIndex = 0;
    this.marker = null;
    this.frame = 0;
    this.minuteTimer = null;
    this.canvas = null;
    this.map = null;
  }

  onAdd(map) {
    this.map = map;
    this.canvas = L.DomUtil.create('canvas', 'fyi-map-canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Supplemental FYI feeder point map');
    this.canvas.tabIndex = -1;
    this.canvas.style.position = 'absolute';
    this.canvas.style.pointerEvents = 'none';
    map.getPane('overlayPane').appendChild(this.canvas);
    map.on('move zoom resize', this.scheduleDraw, this);
    this.scheduleDraw();
    this.minuteTimer = setInterval(() => this.scheduleDraw(), 60_000);
  }

  onRemove(map) {
    this.dispose(map);
  }

  dispose(map = this.map) {
    map?.off('move zoom resize', this.scheduleDraw, this);
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    clearInterval(this.minuteTimer);
    this.minuteTimer = null;
    this.canvas?.remove();
    this.canvas = null;
    this.map = null;
  }

  setWindow(index) {
    this.windowIndex = Number.isInteger(index) && index >= 0 && index < this.decoded.windows.length ? index : -1;
    this.scheduleDraw();
  }

  setMarker(marker) {
    this.marker = markerPoint(marker);
    this.scheduleDraw();
  }

  scheduleDraw() {
    if (!this.map || !this.canvas || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  draw() {
    const map = this.map;
    const canvas = this.canvas;
    if (!map || !canvas) return;

    const size = map.getSize();
    if (size.x <= 0 || size.y <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(size.x * dpr);
    const height = Math.round(size.y * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
    }
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));

    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.x, size.y);

    const colors = {
      neutral: colorFrom(this.container, '--fyi-map-neutral', colorFrom(this.container, '--ink-2', '#4C586C')),
      scheduled: colorFrom(this.container, '--fyi-map-scheduled', colorFrom(this.container, '--wait', '#92400E')),
      planned: colorFrom(this.container, '--fyi-map-planned', colorFrom(this.container, '--accent', '#2563EB')),
      finished: colorFrom(this.container, '--fyi-map-finished', colorFrom(this.container, '--ink-3', '#606B80')),
      confirmed: colorFrom(this.container, '--fyi-map-confirmed', colorFrom(this.container, '--out', '#A61B43')),
      marker: colorFrom(this.container, '--fyi-map-marker', colorFrom(this.container, '--ink', '#0D1526')),
      markerRing: colorFrom(this.container, '--fyi-map-marker-ring', colorFrom(this.container, '--surface', '#FBFCFE')),
    };

    const selected = this.decoded.windows[this.windowIndex] || null;
    const now = Date.now();
    const pointStyle = (index) => {
      if (!selected || !selected.cloudIndexes.has(index)) return { color: colors.neutral, alpha: 0.14, radius: 1.25 };
      if (
        selected.confirmedUntilAt !== null &&
        now <= selected.confirmedUntilAt &&
        selected.confirmedCloudIndexes.has(index)
      ) return { color: colors.confirmed, alpha: 0.9, radius: 2.1 };
      if (selected.start <= now && now <= selected.end) return { color: colors.scheduled, alpha: 0.76, radius: 1.8 };
      if (selected.start > now) return { color: colors.planned, alpha: 0.76, radius: 1.8 };
      return { color: colors.finished, alpha: 0.38, radius: 1.45 };
    };

    for (let cloudIndex = 0; cloudIndex < this.decoded.clouds.length; cloudIndex += 1) {
      const cloud = this.decoded.clouds[cloudIndex];
      if (!cloud) continue;
      const style = pointStyle(cloudIndex);
      context.fillStyle = style.color;
      context.globalAlpha = style.alpha;
      for (let offset = 0; offset < cloud.length; offset += 2) {
        const point = map.latLngToContainerPoint([cloud[offset], cloud[offset + 1]]);
        if (point.x < -3 || point.x > size.x + 3 || point.y < -3 || point.y > size.y + 3) continue;
        context.beginPath();
        context.arc(point.x, point.y, style.radius, 0, Math.PI * 2);
        context.fill();
      }
    }

    if (this.marker) {
      const point = map.latLngToContainerPoint(this.marker);
      if (point.x >= -8 && point.x <= size.x + 8 && point.y >= -8 && point.y <= size.y + 8) {
        context.globalAlpha = 1;
        context.fillStyle = colors.markerRing;
        context.beginPath();
        context.arc(point.x, point.y, 6, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = colors.marker;
        context.beginPath();
        context.arc(point.x, point.y, 4, 0, Math.PI * 2);
        context.fill();
      }
    }
    context.globalAlpha = 1;
  }
}

function prepareControls(container) {
  for (const control of container.querySelectorAll('.leaflet-control-zoom a')) {
    control.style.inlineSize = '44px';
    control.style.blockSize = '44px';
    control.style.lineHeight = '42px';
  }
}

/**
 * Mount the optional, supplemental FYI feeder-cloud map. The API envelope is bounded again
 * here because this client module is intentionally independent from the server parser.
 */
export function mountFyiMap(container, envelope, { selectedWindow = 0, marker = null } = {}) {
  if (typeof HTMLElement === 'undefined' || !(container instanceof HTMLElement)) throw unavailable();

  let decoded;
  try {
    decoded = normalizedEnvelope(envelope);
  } catch {
    throw unavailable();
  }
  let destroyed = false;
  let map;
  let layer;

  try {
    container.replaceChildren();
    container.classList.add('fyi-map-mounted');
    if (!container.hasAttribute('aria-label')) container.setAttribute('aria-label', 'Supplemental FYI feeder point map');
    ensureLeafletStyles();

    map = L.map(container, {
      attributionControl: true,
      fadeAnimation: false,
      inertia: false,
      keyboard: true,
      markerZoomAnimation: false,
      maxBounds: [[CEBU_MAP_BOUNDS.south, CEBU_MAP_BOUNDS.west], [CEBU_MAP_BOUNDS.north, CEBU_MAP_BOUNDS.east]],
      maxBoundsViscosity: 1,
      maxZoom: 12,
      minZoom: 8,
      preferCanvas: true,
      scrollWheelZoom: true,
      zoomAnimation: false,
      zoomControl: true,
    });
    map.attributionControl.setPrefix(false);
    L.tileLayer(TILE_URL, {
      attribution: ATTRIBUTION,
      maxNativeZoom: 12,
      maxZoom: 12,
      minZoom: 8,
      noWrap: true,
      updateWhenIdle: true,
    }).addTo(map);

    layer = new PointCloudLayer(container, decoded).addTo(map);
    layer.setWindow(selectedWindow);
    layer.setMarker(marker);
    prepareControls(container);
    map.fitBounds(decoded.bounds, { animate: false, padding: [24, 24] });
    map.invalidateSize({ animate: false, pan: false });
  } catch {
    try {
      layer?.dispose();
    } catch {
      // The map is supplemental; never expose implementation errors while rolling it back.
    }
    try {
      layer?.remove();
    } catch {
      // The map is supplemental; never expose implementation errors while rolling it back.
    }
    try {
      map?.remove();
    } catch {
      // The map is supplemental; never expose implementation errors while rolling it back.
    }
    container.replaceChildren();
    container.classList.remove('fyi-map-mounted');
    throw unavailable();
  }

  return {
    setWindow(index) {
      if (!destroyed) layer.setWindow(index);
    },
    setMarker(nextMarker) {
      if (!destroyed) layer.setMarker(nextMarker);
    },
    resetView() {
      if (!destroyed) map.fitBounds(decoded.bounds, { animate: false, padding: [24, 24] });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try {
        layer.dispose();
      } catch {
        // The map is supplemental; teardown must not expose implementation errors.
      }
      try {
        map.remove();
      } catch {
        // The map is supplemental; teardown must not expose implementation errors.
      }
      container.replaceChildren();
      container.classList.remove('fyi-map-mounted');
    },
  };
}
