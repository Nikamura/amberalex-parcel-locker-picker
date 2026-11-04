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
  /**
   * When set, lockers are offered only if the shipping name or address contains
   * this text. Lets a live store test checkout without buyers seeing lockers.
   */
  testMarker: string | null;
  alsendo: AlsendoSettings;
}

export interface AlsendoSender {
  companyName: string;
  contactName: string;
  street: string;
  city: string;
  zip: string;
  phone: string;
  email: string;
}

export interface AlsendoSettings {
  /** Create the Alsendo shipment as soon as an order has a locker. */
  autoCreate: boolean;
  /** Courier pickup address (Lithuania). */
  sender: AlsendoSender;
  /** Default parcel, cm and kg; the order's own weight wins when it has one. */
  parcel: { x: number; y: number; z: number; weight: number };
  /** Alsendo service code per locker network; networks without one get no shipment. */
  services: Record<string, string>;
}

/**
 * Courier pickup to parcel locker services on the Amber Alex Alsendo account.
 * Alsendo has no LP Express locker service for this account. Omniva is S218
 * (Alsendo's email said S224, which the API rejects for this account).
 */
export const DEFAULT_ALSENDO_SERVICES: Record<string, string> = {
  dpd: "S240",
  omniva: "S218",
  venipak: "S217",
};

export function defaultAlsendoSettings(): AlsendoSettings {
  return {
    autoCreate: false,
    sender: { companyName: "", contactName: "", street: "", city: "", zip: "", phone: "", email: "" },
    parcel: { x: 30, y: 20, z: 15, weight: 1 },
    services: { ...DEFAULT_ALSENDO_SERVICES },
  };
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
    testMarker: null,
    alsendo: defaultAlsendoSettings(),
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

/** Stored settings over the defaults; nested Alsendo fields are filled in one by one. */
export function withDefaults(stored: Partial<Settings> | null | undefined): Settings {
  const base = defaultSettings();
  const alsendo = stored?.alsendo;
  return {
    ...base,
    ...(stored ?? {}),
    alsendo: {
      ...base.alsendo,
      ...(alsendo ?? {}),
      sender: { ...base.alsendo.sender, ...(alsendo?.sender ?? {}) },
      parcel: { ...base.alsendo.parcel, ...(alsendo?.parcel ?? {}) },
      services: alsendo?.services ?? base.alsendo.services,
    },
  };
}
