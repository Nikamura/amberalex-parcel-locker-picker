/* Parcel locker picker for the cart page / cart drawer.
 * The chosen locker is written to every cart line as the hidden `_plp_locker`
 * property; the carrier-calculated rate then offers that locker first at checkout. */
(function () {
  var cfg = window.ParcelLockerPicker;
  if (!cfg || window.__plpLoaded) return;
  window.__plpLoaded = true;

  var APP = (cfg.appUrl || '').replace(/\/$/, '');
  var LT = String(cfg.locale || document.documentElement.lang || '').toLowerCase().indexOf('lt') === 0;
  var T = LT
    ? {
        rowTitle: 'Pristatymas į paštomatą',
        rowSub: 'Pasirinkite paštomatą dabar arba po apmokėjimo',
        choose: 'Pasirinkti',
        change: 'Keisti',
        title: 'Pasirinkite paštomatą',
        search: 'Miestas, gatvė ar paštomatas',
        near: 'Netoliese',
        loading: 'Ieškoma paštomatų…',
        none: 'Paštomatų nerasta.',
        select: 'Pasirinkti šį paštomatą',
        saving: 'Išsaugoma…',
        error: 'Nepavyko išsaugoti. Bandykite dar kartą.',
        geoError: 'Nepavyko nustatyti vietos.',
      }
    : {
        rowTitle: 'Parcel locker delivery',
        rowSub: 'Choose your parcel locker now or after payment',
        choose: 'Choose',
        change: 'Change',
        title: 'Choose a parcel locker',
        search: 'City, street or locker name',
        near: 'Near me',
        loading: 'Finding lockers…',
        none: 'No lockers found.',
        select: 'Choose this locker',
        saving: 'Saving…',
        error: 'Could not save. Please try again.',
        geoError: 'Could not get your location.',
      };

  var params = new URLSearchParams(location.search);
  if (params.get('plptest') === '1') localStorage.setItem('plptest', '1');
  if (params.get('plptest') === '0') localStorage.removeItem('plptest');

  var config = null;
  var chosen = null; // locker summary saved in the cart attribute

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function logo(kind, key, small) {
    if (!key) return null;
    return el('img', {
      class: 'plp-logo' + (small ? ' plp-logo--sm' : ''),
      src: APP + '/logos/' + kind + '-' + key + '.png',
      alt: '',
      loading: 'lazy',
    });
  }

  function logos(l) {
    return el('span', { class: 'plp-logos' }, [logo('carrier', l.carrierLogo), logo('brand', l.brand)]);
  }

  function line(l) {
    return [l.address, l.city].filter(Boolean).join(', ');
  }

  function km(d) {
    if (d == null) return '';
    return d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1).replace('.', ',') + ' km';
  }

  /* ---------- cart row ---------- */

  function renderRow(row) {
    row.innerHTML = '';
    if (chosen) {
      row.appendChild(logos(chosen));
      row.appendChild(
        el('span', { class: 'plp-row__body' }, [
          el('div', { class: 'plp-row__title', text: chosen.name }),
          el('div', { class: 'plp-row__sub', text: line(chosen) }),
        ])
      );
      row.appendChild(el('button', { type: 'button', class: 'plp-row__btn', text: T.change, onclick: openModal }));
    } else {
      row.appendChild(
        el('span', { class: 'plp-logos' }, (config.networks || []).slice(0, 3).map(function (n) { return logo('carrier', n.carrierLogo, true); }))
      );
      row.appendChild(
        el('span', { class: 'plp-row__body' }, [
          el('div', { class: 'plp-row__title', text: T.rowTitle }),
          el('div', { class: 'plp-row__sub', text: T.rowSub }),
        ])
      );
      row.appendChild(el('button', { type: 'button', class: 'plp-row__btn plp-row__btn--primary', text: T.choose, onclick: openModal }));
    }
  }

  // Insert the row just above the block that holds the checkout button, so it
  // gets its own full-width line instead of joining the theme's button row.
  function mount() {
    var buttons = document.querySelectorAll('[name="checkout"], #checkout, #cart-sidebar-checkout, #cart-checkout');
    buttons.forEach(function (btn) {
      var block = btn.parentElement;
      var host = block && block.parentElement;
      if (!host || host.querySelector(':scope > .plp-row')) return;
      var row = el('div', { class: 'plp-row', 'data-plp': '1' });
      host.insertBefore(row, block);
      renderRow(row);
    });
  }

  function refreshRows() {
    document.querySelectorAll('.plp-row').forEach(renderRow);
  }

  /* ---------- modal ---------- */

  // MapLibre vector map with OpenFreeMap tiles: free, no API key, no usage limits.
  var MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl';
  var STYLE = 'https://tiles.openfreemap.org/styles/positron';
  var COLORS = { dpd: '#dc0032', lp_post: '#e6a800', omniva: '#ff6600', venipak: '#5b2d8e', smartposti: '#f26b21', itella: '#f26b21', gls: '#0a1d9e', dhl: '#d40511' };
  var EMPTY = { type: 'FeatureCollection', features: [] };

  var modal = null;
  var state = { networks: [], q: '', near: null, results: [], selected: null, points: null };
  var map = null;
  var popup = null;
  var quietMoves = 0; // camera moves started by code, which must not refresh the list

  function logoKey(network) {
    var n = (config.networks || []).find(function (x) { return x.network === network; });
    return (n && n.carrierLogo) || network;
  }

  function colorOf(network) {
    return COLORS[logoKey(network)] || '#111';
  }

  // Round map badge: white disc, carrier-coloured ring, carrier logo inside.
  var BADGE = 30; // CSS px
  function badge(key, img) {
    var r = 2, size = BADGE * r, c = document.createElement('canvas');
    c.width = c.height = size;
    var g = c.getContext('2d');
    g.beginPath();
    g.arc(size / 2, size / 2, size / 2 - 3 * r, 0, Math.PI * 2);
    g.fillStyle = '#fff';
    g.shadowColor = 'rgba(0,0,0,.3)';
    g.shadowBlur = 3 * r;
    g.fill();
    g.shadowColor = 'transparent';
    g.lineWidth = 2 * r;
    g.strokeStyle = COLORS[key] || '#111';
    g.stroke();
    if (img) {
      var s = 16 * r;
      g.drawImage(img, (size - s) / 2, (size - s) / 2, s, s);
    } else {
      g.beginPath();
      g.arc(size / 2, size / 2, 5 * r, 0, Math.PI * 2);
      g.fillStyle = COLORS[key] || '#111';
      g.fill();
    }
    return g.getImageData(0, 0, size, size);
  }

  // Badges are added on demand: a plain one at once, the logo version once it loads.
  function addBadge(id) {
    var key = id.slice(4);
    map.addImage(id, badge(key, null), { pixelRatio: 2 });
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function () { if (map && map.hasImage(id)) map.updateImage(id, badge(key, img)); };
    img.src = APP + '/logos/carrier-' + key + '.png';
  }

  function loadMapLibre() {
    if (window.maplibregl) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      document.head.appendChild(el('link', { rel: 'stylesheet', href: MAPLIBRE + '.css' }));
      var s = el('script', { src: MAPLIBRE + '.js' });
      s.onload = function () { resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function openModal() {
    if (modal) return;
    state.networks = (config.networks || []).map(function (n) { return n.network; });
    state.selected = chosen ? chosen.id : null;
    state.q = '';
    state.near = chosen && chosen.lat != null ? { lat: chosen.lat, lng: chosen.lng } : null;
    state.you = null;

    var list = el('ul', { class: 'plp-list', role: 'listbox' });
    var input = el('input', { type: 'search', placeholder: T.search, 'aria-label': T.search });
    var chips = el(
      'div',
      { class: 'plp-chips' },
      (config.networks || []).map(function (n) {
        var chip = el('button', { type: 'button', class: 'plp-chip', 'aria-pressed': 'true' }, [logo('carrier', n.carrierLogo, true), document.createTextNode(n.short)]);
        chip.addEventListener('click', function () {
          var i = state.networks.indexOf(n.network);
          if (i >= 0 && state.networks.length > 1) state.networks.splice(i, 1);
          else if (i < 0) state.networks.push(n.network);
          chip.setAttribute('aria-pressed', String(state.networks.indexOf(n.network) >= 0));
          drawPoints();
          search({ keepMap: true });
        });
        return chip;
      })
    );
    var nearBtn = el('button', { type: 'button', class: 'plp-near', text: '📍 ' + T.near });
    var mapEl = el('div', { class: 'plp-map' });

    modal = el('div', { class: 'plp-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': T.title }, [
      el('div', { class: 'plp-modal' }, [
        el('div', { class: 'plp-modal__head' }, [
          el('h2', { class: 'plp-modal__title', text: T.title }),
          el('button', { type: 'button', class: 'plp-close', 'aria-label': 'Close', text: '×', onclick: closeModal }),
        ]),
        el('div', { class: 'plp-modal__main' }, [
          el('div', { class: 'plp-side' }, [
            el('div', { class: 'plp-tools' }, [chips, el('div', { class: 'plp-search' }, [input, nearBtn])]),
            list,
          ]),
          mapEl,
        ]),
      ]),
    ]);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(modal);
    document.documentElement.style.overflow = 'hidden';

    var timer = null;
    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = input.value.trim(); state.near = null; state.you = null; search(); }, 250);
    });
    nearBtn.addEventListener('click', function () {
      if (!navigator.geolocation) return alert(T.geoError);
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          state.near = state.you = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          state.q = '';
          input.value = '';
          search();
        },
        function () { alert(T.geoError); },
        { timeout: 10000 }
      );
    });

    state.list = list;
    list.appendChild(el('li', { class: 'plp-empty', text: T.loading }));
    search();
    loadMapLibre().then(function () { if (modal) initMap(mapEl); });
  }

  function initMap(mapEl) {
    map = new maplibregl.Map({ container: mapEl, style: STYLE, center: [23.9, 55.2], zoom: 6.2, attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', function () {
      map.addSource('plp', { type: 'geojson', data: EMPTY, cluster: true, clusterRadius: 42, clusterMaxZoom: 11 });
      map.addLayer({
        id: 'plp-clusters', type: 'circle', source: 'plp', filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#111', 'circle-opacity': 0.88,
          'circle-radius': ['step', ['get', 'point_count'], 14, 25, 18, 150, 23],
          'circle-stroke-width': 3, 'circle-stroke-color': 'rgba(255,255,255,0.9)',
        },
      });
      map.addLayer({
        id: 'plp-count', type: 'symbol', source: 'plp', filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
        paint: { 'text-color': '#fff' },
      });
      map.on('styleimagemissing', function (e) { if (e.id.indexOf('plp-') === 0) addBadge(e.id); });
      map.addSource('plp-sel', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'plp-sel', type: 'circle', source: 'plp-sel', paint: { 'circle-radius': 20, 'circle-color': ['get', 'c'], 'circle-opacity': 0.35, 'circle-stroke-width': 2, 'circle-stroke-color': ['get', 'c'] } });
      map.addLayer({
        id: 'plp-points', type: 'symbol', source: 'plp', filter: ['!', ['has', 'point_count']],
        layout: {
          'icon-image': ['concat', 'plp-', ['get', 'k']],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.75, 15, 1],
          'icon-allow-overlap': true,
        },
      });
      map.addSource('plp-you', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'plp-you', type: 'circle', source: 'plp-you', paint: { 'circle-radius': 7, 'circle-color': '#1a73e8', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } });

      map.on('click', 'plp-clusters', function (e) {
        var f = e.features[0];
        map.getSource('plp').getClusterExpansionZoom(f.properties.cluster_id).then(function (z) {
          map.easeTo({ center: f.geometry.coordinates, zoom: z + 0.5 });
        });
      });
      map.on('click', 'plp-points', function (e) { openLocker(e.features[0].properties.id, e.features[0].geometry.coordinates); });
      ['plp-clusters', 'plp-points'].forEach(function (layer) {
        map.on('mouseenter', layer, function () { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, function () { map.getCanvas().style.cursor = ''; });
      });
      // After the buyer pans or zooms, list the lockers around the new map centre.
      map.on('moveend', function () {
        if (quietMoves > 0) { quietMoves--; return; }
        if (state.q || map.getZoom() < 9) return;
        var c = map.getCenter();
        state.near = { lat: c.lat, lng: c.lng };
        search({ keepMap: true });
      });

      loadPoints();
      drawResults(false);
    });
  }

  function moveQuietly(fn) {
    if (!map) return;
    quietMoves++;
    fn();
  }

  function loadPoints() {
    var all = (config.networks || []).map(function (n) { return n.network; });
    var p = new URLSearchParams({ country: (config.countries || ['LT'])[0], network: all.join(',') });
    fetch(APP + '/api/locker-points?' + p)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        state.points = (data.points || []).map(function (pt) { return { id: pt[0], lat: pt[1], lng: pt[2], network: data.networks[pt[3]] }; });
        drawPoints();
      })
      .catch(function () {});
  }

  function drawPoints() {
    if (!map || !map.getSource('plp') || !state.points) return;
    map.getSource('plp').setData({
      type: 'FeatureCollection',
      features: state.points
        .filter(function (pt) { return state.networks.indexOf(pt.network) >= 0; })
        .map(function (pt) {
          return { type: 'Feature', properties: { id: pt.id, k: logoKey(pt.network) }, geometry: { type: 'Point', coordinates: [pt.lng, pt.lat] } };
        }),
    });
  }

  function onKey(e) { if (e.key === 'Escape') closeModal(); }

  function closeModal() {
    if (!modal) return;
    document.removeEventListener('keydown', onKey);
    if (map) map.remove();
    modal.remove();
    modal = null;
    map = null;
    popup = null;
    quietMoves = 0;
    document.documentElement.style.overflow = '';
  }

  function search(opts) {
    opts = opts || {};
    var p = new URLSearchParams({ country: (config.countries || ['LT'])[0], network: state.networks.join(','), limit: '30' });
    if (state.q) p.set('q', state.q);
    else if (state.near) p.set('near', state.near.lat.toFixed(5) + ',' + state.near.lng.toFixed(5));
    var token = (state.token = Math.random());
    return fetch(APP + '/api/lockers?' + p)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (token !== state.token || !modal) return;
        state.results = data.lockers || [];
        if (data.origin) {
          state.near = { lat: data.origin.lat, lng: data.origin.lng };
          if (data.origin.kind === 'ip') state.you = state.near;
        }
        renderList();
        drawResults(Boolean(opts.keepMap));
      })
      .catch(function () {});
  }

  function renderList() {
    var list = state.list;
    list.innerHTML = '';
    if (!state.results.length) {
      list.appendChild(el('li', { class: 'plp-empty', text: T.none }));
      return;
    }
    state.results.forEach(function (l) {
      var item = el('li', { class: 'plp-item', role: 'option', 'aria-selected': String(l.id === state.selected), tabindex: '0', 'data-id': l.id }, [
        el('span', { class: 'plp-dot', style: 'background:' + colorOf(l.network) }),
        logos(l),
        el('div', { class: 'plp-item__body' }, [
          el('div', { class: 'plp-item__name', text: l.name }),
          el('div', { class: 'plp-item__addr', text: line(l) }),
        ]),
        l.distanceKm != null ? el('span', { class: 'plp-item__dist', text: km(l.distanceKm) }) : null,
      ]);
      item.addEventListener('click', function () { choose(l); });
      item.addEventListener('mouseenter', function () { highlight(l); });
      item.addEventListener('keydown', function (e) { if (e.key === 'Enter') choose(l); });
      list.appendChild(item);
    });
  }

  function highlight(l) {
    if (!map || !map.getSource('plp-sel')) return;
    map.getSource('plp-sel').setData(
      l ? { type: 'Feature', properties: { c: colorOf(l.network) }, geometry: { type: 'Point', coordinates: [l.lng, l.lat] } } : EMPTY
    );
  }

  // Frame the closest results (and the buyer's position) unless the buyer moved the map.
  function drawResults(keepMap) {
    if (!map || !map.getSource('plp-you')) return;
    map.getSource('plp-you').setData(
      state.you ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [state.you.lng, state.you.lat] } } : EMPTY
    );
    var current = state.results.find(function (l) { return l.id === state.selected; });
    highlight(current || null);
    if (keepMap || !state.results.length) return;
    var bounds = new maplibregl.LngLatBounds();
    state.results.slice(0, state.q ? 30 : 6).forEach(function (l) { bounds.extend([l.lng, l.lat]); });
    if (state.you) bounds.extend([state.you.lng, state.you.lat]);
    moveQuietly(function () { map.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 600 }); });
  }

  function openLocker(id, coords) {
    var show = function (l) {
      if (!l || !map) return;
      highlight(l);
      var item = state.list.querySelector('[data-id="' + CSS.escape(id) + '"]');
      if (item) item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      var btn = el('button', { type: 'button', text: T.select });
      btn.addEventListener('click', function () { choose(l); });
      var pop = el('div', { class: 'plp-pop' }, [logos(l), el('b', { text: l.name }), el('span', { text: line(l) }), btn]);
      if (popup) popup.remove();
      popup = new maplibregl.Popup({ closeButton: false, offset: 14, maxWidth: '260px' }).setLngLat(coords).setDOMContent(pop).addTo(map);
    };
    var found = state.results.find(function (l) { return l.id === id; });
    if (found) return show(found);
    // Not in the list yet: list the lockers around it, then open it.
    state.q = '';
    state.near = { lat: coords[1], lng: coords[0] };
    search({ keepMap: true }).then(function () { show(state.results.find(function (l) { return l.id === id; })); });
  }

  /* ---------- saving ---------- */

  function choose(l) {
    if (state.saving) return;
    state.saving = true;
    state.list.querySelectorAll('.plp-item').forEach(function (n) { n.style.opacity = '.5'; });
    saveToCart(l)
      .then(function () {
        chosen = { id: l.id, name: l.name, address: l.address, city: l.city, network: l.network, brand: l.brand, carrierLogo: l.carrierLogo, lat: l.lat, lng: l.lng };
        closeModal();
        refreshRows();
      })
      .catch(function () { alert(T.error); })
      .then(function () {
        state.saving = false;
        if (state.list) state.list.querySelectorAll('.plp-item').forEach(function (n) { n.style.opacity = ''; });
      });
  }

  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }).then(
      function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }
    );
  }

  function saveToCart(l) {
    return fetch('/cart.js')
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var chain = Promise.resolve();
        cart.items.forEach(function (item) {
          chain = chain.then(function () {
            var props = Object.assign({}, item.properties || {}, { _plp_locker: l.id });
            return post('/cart/change.js', { id: item.key, quantity: item.quantity, properties: props });
          });
        });
        return chain.then(function () {
          var summary = { id: l.id, name: l.name, address: l.address, city: l.city, network: l.network, brand: l.brand || null, carrierLogo: l.carrierLogo || null, lat: l.lat, lng: l.lng };
          return post('/cart/update.js', { attributes: { _plp_locker: JSON.stringify(summary) } });
        });
      });
  }

  /* ---------- boot ---------- */

  function readChosen(cart) {
    try {
      var saved = cart && cart.attributes && cart.attributes._plp_locker;
      var onLines = cart && cart.items && cart.items.some(function (i) { return i.properties && i.properties._plp_locker; });
      chosen = saved && onLines ? JSON.parse(saved) : null;
    } catch (e) { chosen = null; }
  }

  function boot() {
    Promise.all([
      fetch(APP + '/api/networks?shop=' + encodeURIComponent(cfg.shop)).then(function (r) { return r.json(); }),
      fetch('/cart.js').then(function (r) { return r.json(); }),
    ])
      .then(function (res) {
        config = res[0];
        if (!config || !config.enabled) return;
        if (config.testMode && !localStorage.getItem('plptest')) return;
        if (cfg.country && config.countries && config.countries.indexOf(cfg.country) < 0) return;
        readChosen(res[1]);
        mount();
        var pending = null;
        new MutationObserver(function () {
          clearTimeout(pending);
          pending = setTimeout(mount, 150);
        }).observe(document.body, { childList: true, subtree: true });
      })
      .catch(function () {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
