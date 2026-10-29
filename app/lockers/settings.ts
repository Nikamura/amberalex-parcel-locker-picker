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
  /** Nearest lockers offered per enabled network. */
  perNetwork: number;
  /** Order subtotal (shop currency, major units) from which lockers are free. */
  freeShippingOver: number | null;
  /** Replace the order's shipping address with the locker address. */
  overwriteShippingAddress: boolean;
}

export const NETWORK_LABELS: Record<string, string> = {
  omniva: "Omniva",
  lp_post: "LP Express",
  LpPost: "LP Express",
  dpd: "DPD",
  venipak: "Venipak",
  gls: "SmartPosti",
};

export function defaultSettings(): Settings {
  return {
    enabled: false,
    countries: ["LT"],
    networks: {},
    perNetwork: 2,
    freeShippingOver: null,
    overwriteShippingAddress: true,
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
