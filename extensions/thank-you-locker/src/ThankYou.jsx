import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useRef, useState} from 'preact/hooks';
import LT from '../locales/lt.json';

const APP_URL = 'https://amberalex-parcel-locker-picker.karolis.workers.dev';
const MODAL_ID = 'parcel-locker-modal';

export default async () => {
  render(<Extension />, document.body);
};

// Lockers are only offered for Lithuanian addresses, so speak Lithuanian to
// those buyers even when the store or checkout runs in another language.
let orderCountry = '';

function lithuanian() {
  if (shopify.extension.editor) return true;
  if ((shopify.localization.language.value?.isoCode ?? '').toLowerCase().startsWith('lt')) return true;
  return (orderCountry || shopify.shippingAddress?.value?.countryCode) === 'LT';
}

function t(key, values) {
  return lithuanian() && LT[key] ? LT[key] : shopify.i18n.translate(key, values);
}

async function api(path, init = {}) {
  const token = await shopify.sessionToken.get();
  const res = await fetch(`${APP_URL}${path}`, {
    ...init,
    headers: {...(init.headers ?? {}), Authorization: `Bearer ${token}`},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function lockerLine(locker) {
  return [locker.address, locker.city].filter(Boolean).join(', ');
}

function Logo({kind, name, size = '28px'}) {
  if (!name) return null;
  return (
    <s-box inlineSize={/** @type {any} */ (size)} blockSize={/** @type {any} */ (size)}>
      <s-image src={`${APP_URL}/logos/${kind}-${name}.png`} alt="" inlineSize="fill" aspectRatio="1/1" borderRadius="small" />
    </s-box>
  );
}

function LockerLogos({locker}) {
  return (
    <s-stack direction="inline" gap="small-300" alignItems="center">
      <Logo kind="carrier" name={locker.carrierLogo} />
      <Logo kind="brand" name={locker.brand} />
    </s-stack>
  );
}

function distance(km) {
  if (km == null) return '';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace('.', ',')} km`;
}

// Shown in the checkout editor, where there is no real order to load.
const PREVIEW = {
  applicable: true,
  editable: true,
  country: 'LT',
  zip: '44146',
  current: null,
  networks: [
    {network: 'lp_post', short: 'LP Express', carrierLogo: 'lp_post'},
    {network: 'omniva', short: 'Omniva', carrierLogo: 'omniva'},
    {network: 'dpd', short: 'DPD', carrierLogo: 'dpd'},
  ],
  paidNetwork: 'any',
  suggestions: [],
};

function Extension() {
  const inEditor = Boolean(shopify.extension.editor);
  const confirmation = shopify.orderConfirmation.value;
  const orderId = confirmation?.order?.id;
  const number = confirmation?.number ?? '';

  const [info, setInfo] = useState(inEditor ? PREVIEW : null);
  const [loadState, setLoadState] = useState(inEditor ? 'done' : 'loading');
  const [network, setNetwork] = useState(inEditor ? PREVIEW.networks[0].network : '');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [savingId, setSavingId] = useState('');
  const [status, setStatus] = useState('idle');
  const searchTimer = useRef(null);
  const modal = useRef(null);

  useEffect(() => {
    if (inEditor || !orderId) return;
    const params = new URLSearchParams({orderId, number});
    api(`/api/order-locker?${params}`)
      .then((data) => {
        setLoadState('done');
        if (!data.applicable) return;
        orderCountry = data.country ?? '';
        setInfo(data);
        const paid = data.networks.some((n) => n.network === data.paidNetwork) ? data.paidNetwork : null;
        setNetwork(data.current?.network ?? paid ?? data.networks[0]?.network ?? '');
        setResults(data.suggestions ?? []);
      })
      .catch((error) => {
        console.error('[parcel-locker] load failed', error);
        setLoadState('error');
      });
  }, [orderId, number]);

  useEffect(() => {
    if (!info || !network) return;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const params = new URLSearchParams({country: info.country, network, limit: '25'});
      if (query.trim()) params.set('q', query.trim());
      if (info.zip) params.set('zip', info.zip);
      fetch(`${APP_URL}/api/lockers?${params}`)
        .then((r) => r.json())
        .then((data) => setResults(data.lockers ?? []))
        .catch(() => setResults([]));
    }, 250);
  }, [info, network, query]);

  if (!info) {
    if (loadState === 'error') return <s-banner tone="warning">{t('loadError')}</s-banner>;
    return null;
  }

  async function choose(locker) {
    if (inEditor) {
      setInfo({...info, current: locker, editable: false});
      modal.current?.hideOverlay();
      return;
    }
    setSavingId(locker.id);
    try {
      const data = await api('/api/order-locker', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({orderId, number, lockerId: locker.id}),
      });
      setInfo({...info, current: data.current, editable: false});
      setStatus('saved');
      modal.current?.hideOverlay();
    } catch {
      setStatus('error');
    } finally {
      setSavingId('');
    }
  }

  const summary = info.current ? (
    <s-stack gap="small-200">
      <s-stack direction="inline" gap="small-200" alignItems="center">
        <LockerLogos locker={info.current} />
        <s-text type="strong">{info.current.name}</s-text>
      </s-stack>
      <s-text color="subdued">{lockerLine(info.current)}</s-text>
    </s-stack>
  ) : (
    <s-text>{t('chooseIntro')}</s-text>
  );

  // Locker delivery paid but no locker yet (e.g. draft-order checkout links):
  // make the call to action hard to miss.
  const needsChoice = !info.current && info.editable;

  return (
    <s-stack gap="base">
      {needsChoice ? (
        <s-banner tone="warning" heading={`📍 ${t('chooseHeading')}`}>
          <s-stack gap="base">
            <s-text>{t('chooseIntro')}</s-text>
            <s-stack direction="inline">
              <s-button variant="primary" commandFor={MODAL_ID} command="--show">
                {t('choose')}
              </s-button>
            </s-stack>
          </s-stack>
        </s-banner>
      ) : (
        <s-box padding="base" border="base" borderRadius="base">
          <s-stack gap="base">
            <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="base">
              <s-heading>{info.current ? t('heading') : t('chooseHeading')}</s-heading>
            </s-stack>
            {status === 'saved' && <s-banner tone="success">{t('saved')}</s-banner>}
            {summary}
            {info.current && <s-text color="subdued">{t('contactToChange')}</s-text>}
            {!info.editable && !info.current && <s-text color="subdued">{t('locked')}</s-text>}
          </s-stack>
        </s-box>
      )}

      <s-modal id={MODAL_ID} ref={modal} heading={t('chooseHeading')} size="large">
        <s-stack gap="base">
          {info.networks.length > 1 && (
            <s-stack direction="inline" gap="small-200">
              {info.networks.map((n) => (
                <s-press-button
                  key={n.network}
                  pressed={n.network === network}
                  onClick={() => setNetwork(n.network)}
                >
                  <s-stack direction="inline" gap="small-300" alignItems="center">
                    <Logo kind="carrier" name={n.carrierLogo} size="20px" />
                    {n.short}
                  </s-stack>
                </s-press-button>
              ))}
            </s-stack>
          )}
          <s-text-field
            label={t('search')}
            icon="search"
            value={query}
            onInput={(e) => setQuery(/** @type {any} */ (e.currentTarget).value)}
          />
          {status === 'error' && <s-banner tone="critical">{t('error')}</s-banner>}
          {results.length === 0 ? (
            <s-text color="subdued">{t('noResults')}</s-text>
          ) : (
            <s-scroll-box maxBlockSize="420px">
              <s-stack gap="small-200">
                {results.map((l) => (
                  <s-clickable
                    key={l.id}
                    padding="base"
                    border="base"
                    borderRadius="base"
                    disabled={Boolean(savingId)}
                    onClick={() => choose(l)}
                  >
                    <s-stack direction="inline" justifyContent="space-between" alignItems="center" gap="base">
                      <s-stack direction="inline" alignItems="center" gap="base">
                        <LockerLogos locker={l} />
                        <s-stack gap="small-300">
                          <s-text type="strong">{l.name}</s-text>
                          <s-text color="subdued">{lockerLine(l)}</s-text>
                        </s-stack>
                      </s-stack>
                      {savingId === l.id ? (
                        <s-spinner size="small" />
                      ) : (
                        l.distanceKm != null && <s-text color="subdued">{distance(l.distanceKm)}</s-text>
                      )}
                    </s-stack>
                  </s-clickable>
                ))}
              </s-stack>
            </s-scroll-box>
          )}
        </s-stack>
      </s-modal>
    </s-stack>
  );
}
