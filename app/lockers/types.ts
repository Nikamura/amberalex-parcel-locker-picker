export interface Locker {
  source: string;
  externalId: string;
  network: string;
  countryCode: string;
  name: string;
  address: string;
  city: string;
  zip: string;
  lat: number;
  lng: number;
  comment: string | null;
}

export interface LockerSource {
  id: string;
  fetchLockers(): Promise<Locker[]>;
}
