// Pages Function: coordinates -> Cebu barangay + city, for "Use my location" on /power.
//
//   GET /api/where?lat=10.3776&lon=123.9127 -> { barangay, city, label }
//
// Proxied instead of called from the browser so the request carries an identifying user
// agent (Nominatim's usage policy) and so the lookup is cached at the edge.

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
const UA = 'accoworks.dev outage tracker (ac@accoworks.dev)';
const EDGE_TTL = 86400; // A coordinate's barangay does not move.

// Nominatim's Philippine hierarchy puts the barangay in suburb/quarter/village.
const BARANGAY_KEYS = ['suburb', 'quarter', 'village', 'neighbourhood', 'hamlet'];
const CITY_KEYS = ['city', 'town', 'municipality', 'county'];

function json(data, status = 200, ttl = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': ttl ? `public, max-age=600, s-maxage=${ttl}` : 'no-store',
    },
  });
}

const pick = (address, keys) => {
  for (const key of keys) if (address[key]) return String(address[key]);
  return '';
};

export async function onRequestGet({ request }) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json({ error: 'lat and lon are required' }, 400);
  }

  const query = new URL(ENDPOINT);
  query.searchParams.set('format', 'jsonv2');
  query.searchParams.set('lat', lat.toFixed(5));
  query.searchParams.set('lon', lon.toFixed(5));
  query.searchParams.set('zoom', '16');
  query.searchParams.set('addressdetails', '1');

  try {
    const response = await fetch(query, {
      headers: { 'user-agent': UA, accept: 'application/json' },
      cf: { cacheTtl: EDGE_TTL, cacheEverything: true },
    });
    if (!response.ok) throw new Error(`geocoder responded ${response.status}`);
    const address = (await response.json()).address || {};
    const barangay = pick(address, BARANGAY_KEYS);
    const city = pick(address, CITY_KEYS);
    if (!barangay && !city) return json({ error: 'no address found for those coordinates' }, 404);
    return json({ barangay, city, label: [barangay, city].filter(Boolean).join(', ') }, 200, EDGE_TTL);
  } catch (error) {
    return json({ error: error.message }, 502);
  }
}
