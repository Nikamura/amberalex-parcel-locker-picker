// Shop chains that host lockers, detected from the locker name. Each has a logo at
// /logos/brand-<key>.png (the chain's own site icon, normalised to 64x64).
const BRANDS: Array<{ key: string; pattern: RegExp }> = [
  { key: "maxima", pattern: /\bmaxima\b/i },
  { key: "norfa", pattern: /\bnorfa\b/i },
  { key: "iki", pattern: /\biki\b/i },
  { key: "rimi", pattern: /\brimi\b/i },
  { key: "lidl", pattern: /\blidl\b/i },
  { key: "udrop", pattern: /\budrop\b/i },
  { key: "aibe", pattern: /\baib[eė]\b/i },
  { key: "silas", pattern: /(^|[^\p{L}])[šs]ilas($|[^\p{L}])/iu },
  { key: "express-market", pattern: /express\s*market/i },
  { key: "viada", pattern: /\bviada\b/i },
  { key: "circle-k", pattern: /circle\s*k\b/i },
];

export function detectBrand(name: string): string | undefined {
  return BRANDS.find((b) => b.pattern.test(name))?.key;
}

/** Networks with a carrier logo at /logos/carrier-<network>.png. */
const CARRIER_LOGOS = new Set(["omniva", "dpd", "lp_post", "venipak", "gls"]);

export function carrierLogoKey(network: string): string | undefined {
  if (network === "LpPost") return "lp_post";
  return CARRIER_LOGOS.has(network) ? network : undefined;
}
