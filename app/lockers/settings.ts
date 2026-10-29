export interface NetworkSettings {
  enabled: boolean;
  /** Shown to buyers, e.g. "Omniva". */
  label: string;
  /** Price in the shop currency, major units. */
  price: number;
}

export interface Settings {
  enabled: boolean;
  countries: string[];
  networks: Record<string, NetworkSettings>;
  /** Shown under each locker-type rate when the locker is chosen after payment. */
  chooseLaterText: string;
  /**
   * Offer one combined rate for all locker types instead of one per type; the buyer
   * picks the type and locker after payment. Priced at the most expensive enabled type.
   */
  combineNetworks: boolean;
  combinedLabel: string;
  /** Order subtotal (shop currency, major units) from which lockers are free. */
  freeShippingOver: number | null;
  /** Replace the order's shipping address with the locker address. */
  overwriteShippingAddress: boolean;
  /**
   * When set, lockers are offered only if the shipping name or address contains
   * this text. Lets a live store test checkout without buyers seeing lockers.
   */
  testMarker: string | null;
}

export const NETWORK_LABELS: Record<string, string> = {
  omniva: "Omniva parcel locker",
  lp_post: "LP Express parcel locker",
  LpPost: "LP Express parcel locker",
  dpd: "DPD parcel locker",
  venipak: "Venipak parcel locker",
  gls: "SmartPosti parcel locker",
};

/** Short carrier names for badges. */
export const NETWORK_SHORT: Record<string, string> = {
  omniva: "Omniva",
  lp_post: "LP Express",
  LpPost: "LP Express",
  dpd: "DPD",
  venipak: "Venipak",
  gls: "SmartPosti",
};

export function networkShort(network: string) {
  return NETWORK_SHORT[network] ?? network;
}

export function defaultSettings(): Settings {
  return {
    enabled: false,
    countries: ["LT"],
    networks: {},
    chooseLaterText: "Choose your parcel locker after payment",
    combineNetworks: false,
    combinedLabel: "Parcel locker",
    freeShippingOver: null,
    overwriteShippingAddress: true,
    testMarker: null,
  };
}

/** Network key of the combined "any locker type" rate. */
export const ANY_NETWORK = "any";

/** Price of the combined rate: the most expensive enabled type, so every type is allowed afterwards. */
export function combinedPrice(settings: Settings, networks: string[]): number {
  return Math.max(0, ...networks.map((n) => networkSettings(settings, n).price));
}

export function networkSettings(settings: Settings, network: string): NetworkSettings {
  return (
    settings.networks[network] ?? {
      enabled: false,
      label: NETWORK_LABELS[network] ?? network,
      price: 0,
    }
  );
}
