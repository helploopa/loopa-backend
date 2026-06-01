export interface GeocodeResult {
  lat: number;
  lng: number;
  formattedAddress: string;
}

interface AddressInput {
  street?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  country?: string;
}

function buildQuery(addr: AddressInput): string {
  return [addr.street, addr.city, addr.state, addr.zipcode, addr.country ?? 'US']
    .filter(Boolean)
    .join(', ');
}

// ── Google Maps Geocoding API ────────────────────────────────────────────────

async function geocodeWithGoogle(query: string): Promise<GeocodeResult> {
  const key = process.env.GOOGLE_MAPS_API_KEY!;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${key}`;
  const res = await fetch(url);
  const data = (await res.json()) as any;

  if (data.status !== 'OK' || !data.results?.length) {
    throw new Error(`Google geocoding failed: ${data.status}`);
  }

  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng, formattedAddress: data.results[0].formatted_address };
}

// ── OpenStreetMap Nominatim (free fallback, no API key needed) ───────────────

async function geocodeWithNominatim(query: string): Promise<GeocodeResult> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1`;
  const res = await fetch(url, { headers: { 'User-Agent': 'loopa-backend/1.0' } });
  const data = (await res.json()) as any[];

  if (!data?.length) throw new Error('Address not found');

  return {
    lat: parseFloat(data[0].lat),
    lng: parseFloat(data[0].lon),
    formattedAddress: data[0].display_name,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function geocodeAddress(addr: AddressInput): Promise<GeocodeResult> {
  const query = buildQuery(addr);
  if (!query.trim()) throw new Error('No address fields provided to geocode');

  if (process.env.GOOGLE_MAPS_API_KEY) {
    return geocodeWithGoogle(query);
  }
  return geocodeWithNominatim(query);
}
