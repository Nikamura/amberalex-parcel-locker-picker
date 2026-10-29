export interface Point {
  lat: number;
  lng: number;
}

export function normalizeZip(zip: string | null | undefined): string {
  return (zip ?? "").toUpperCase().replace(/^[A-Z]{2}-?/, "").replace(/\s+/g, "");
}

export function distanceKm(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
