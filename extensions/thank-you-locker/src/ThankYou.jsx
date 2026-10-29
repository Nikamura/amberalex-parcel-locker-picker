import '@shopify/ui-extensions/preact';
import {render} from 'preact';
import {useEffect, useRef, useState} from 'preact/hooks';

const APP_URL = 'https://lockers.cn.lt';

export default async () => {
  render(<Extension />, document.body);
};

function t(key) {
  return shopify.i18n.translate(key);
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

function Extension() {
  const confirmation = shopify.orderConfirmation.value;
  const orderId = confirmation?.order?.id;
  const number = confirmation?.number ?? '';

  const [info, setInfo] = useState(null);
  const [editing, setEditing] = useState(false);
  const [network, setNetwork] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState('idle');
  const searchTimer = useRef(null);

  useEffect(() => {
    if (!orderId) return;
    const params = new URLSearchParams({orderId, number});
    api(`/api/order-locker?${params}`)
      .then((data) => {
        if (!data.applicable) return;
        setInfo(data);
        setNetwork(data.current?.network ?? data.paidNetwork ?? data.networks[0]?.network ?? '');
        setResults(data.suggestions ?? []);
        setEditing(!data.current);
      })
      .catch(() => {});
  }, [orderId, number]);

  useEffect(() => {
    if (!info || !editing || !network) return;
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const params = new URLSearchParams({country: info.country, network, limit: '20'});
      if (query.trim()) params.set('q', query.trim());
      else if (info.zip) params.set('zip', info.zip);
      fetch(`${APP_URL}/api/lockers?${params}`)
        .then((r) => r.json())
        .then((data) => setResults(data.lockers ?? []))
        .catch(() => setResults([]));
    }, 300);
  }, [info, editing, network, query]);

  if (!info) return null;

  if (!editing && info.current) {
    return (
      <s-section heading={t('heading')}>
        <s-stack gap="base">
          {status === 'saved' && <s-banner tone="success">{t('saved')}</s-banner>}
          <s-text>{t('yourLocker')}</s-text>
          <s-text type="strong">{info.current.name}</s-text>
          <s-text>{lockerLine(info.current)}</s-text>
          {info.editable && (
            <s-button variant="secondary" onClick={() => setEditing(true)}>
              {t('change')}
            </s-button>
          )}
        </s-stack>
      </s-section>
    );
  }

  if (!info.editable) {
    return <s-banner tone="warning" heading={t('chooseHeading')}>{t('locked')}</s-banner>;
  }

  async function save() {
    if (!selected) return;
    setStatus('saving');
    try {
      const data = await api('/api/order-locker', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({orderId, number, lockerId: selected}),
      });
      setInfo({...info, current: data.current});
      setEditing(false);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  return (
    <s-section heading={t('chooseHeading')}>
      <s-stack gap="base">
        <s-text>{t('chooseIntro')}</s-text>
        {info.networks.length > 1 && (
          <s-select
            label={t('type')}
            value={network}
            onChange={(e) => {
              setNetwork(/** @type {any} */ (e.currentTarget).value);
              setSelected('');
            }}
          >
            {info.networks.map((n) => (
              <s-option key={n.network} value={n.network}>
                {n.label}
              </s-option>
            ))}
          </s-select>
        )}
        <s-text-field
          label={t('search')}
          value={query}
          onInput={(e) => setQuery(/** @type {any} */ (e.currentTarget).value)}
        />
        {results.length === 0 ? (
          <s-text>{t('noResults')}</s-text>
        ) : (
          <s-scroll-box maxBlockSize="320px">
            <s-choice-list
              label={t('heading')}
              labelAccessibilityVisibility="exclusive"
              name="locker"
              values={selected ? [selected] : []}
              onChange={(e) => setSelected(/** @type {any} */ (e.currentTarget).values[0] ?? '')}
            >
              {results.map((l) => (
                <s-choice key={l.id} value={l.id}>
                  {l.name}
                  <s-text slot="details">{lockerLine(l)}</s-text>
                </s-choice>
              ))}
            </s-choice-list>
          </s-scroll-box>
        )}
        {status === 'error' && <s-banner tone="critical">{t('error')}</s-banner>}
        <s-button
          variant="primary"
          disabled={!selected}
          loading={status === 'saving'}
          onClick={save}
        >
          {t('save')}
        </s-button>
      </s-stack>
    </s-section>
  );
}
