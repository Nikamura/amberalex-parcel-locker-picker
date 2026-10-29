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

export function defaultSettings(): Settings {
  return {
    enabled: false,
    countries: ["LT"],
    networks: {},
    chooseLaterText: "Choose your parcel locker after payment",
    freeShippingOver: null,
    overwriteShippingAddress: true,
    testMarker: null,
  };
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
