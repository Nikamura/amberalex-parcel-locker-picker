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
        hint: 'Įveskite miestą ar adresą arba spauskite „Netoliese“.',
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
        hint: 'Type a city or address, or use “Near me”.',
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

  function mount() {
    var buttons = document.querySelectorAll('[name="checkout"], #checkout, #cart-sidebar-checkout');
    buttons.forEach(function (btn) {
      var parent = btn.parentElement;
      if (!parent || parent.querySelector(':scope > .plp-row')) return;
      var row = el('div', { class: 'plp-row', 'data-plp': '1' });
      parent.insertBefore(row, btn);
      renderRow(row);
    });
  }

  function refreshRows() {
    document.querySelectorAll('.plp-row').forEach(renderRow);
  }

  /* ---------- modal ---------- */

  var modal = null;
  var state = { networks: [], q: '', near: null, results: [], selected: null };
  var map = null;
  var markers = [];

  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      document.head.appendChild(el('link', { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' }));
      var s = el('script', { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' });
      s.onload = function () { resolve(); };
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function openModal() {
    if (modal) return;
    state.networks = (config.networks || []).map(function (n) { return n.network; });
    state.selected = chosen ? chosen.id : null;

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
          search();
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
      timer = setTimeout(function () { state.q = input.value.trim(); state.near = state.q ? null : state.near; search(); }, 250);
    });
    nearBtn.addEventListener('click', function () {
      if (!navigator.geolocation) return alert(T.geoError);
      navigator.geolocation.getCurrentPosition(
        function (pos) { state.near = { lat: pos.coords.latitude, lng: pos.coords.longitude }; state.q = ''; input.value = ''; search(); },
        function () { alert(T.geoError); },
        { timeout: 10000 }
      );
    });

    state.list = list;
    loadLeaflet().then(function () {
      if (!modal) return;
      map = L.map(mapEl, { zoomControl: true }).setView([55.2, 23.9], 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
      }).addTo(map);
      drawMarkers();
    });

    if (chosen) { state.q = chosen.city || ''; input.value = state.q; }
    search();
    setTimeout(function () { input.focus(); }, 50);
  }

  function onKey(e) { if (e.key === 'Escape') closeModal(); }

  function closeModal() {
    if (!modal) return;
    document.removeEventListener('keydown', onKey);
    modal.remove();
    modal = null;
    map = null;
    markers = [];
    document.documentElement.style.overflow = '';
  }

  function search() {
    var list = state.list;
    if (!state.q && !state.near) {
      state.results = [];
      list.innerHTML = '';
      list.appendChild(el('li', { class: 'plp-empty', text: T.hint }));
      drawMarkers();
      return;
    }
    var p = new URLSearchParams({ country: (config.countries || ['LT'])[0], network: state.networks.join(','), limit: '50' });
    if (state.q) p.set('q', state.q);
    if (state.near) p.set('near', state.near.lat + ',' + state.near.lng);
    var token = (state.token = Math.random());
    fetch(APP + '/api/lockers?' + p)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (token !== state.token || !modal) return;
        state.results = data.lockers || [];
        renderList();
        drawMarkers();
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
      var item = el('li', { class: 'plp-item', role: 'option', 'aria-selected': String(l.id === state.selected), tabindex: '0' }, [
        logos(l),
        el('div', { class: 'plp-item__body' }, [
          el('div', { class: 'plp-item__name', text: l.name }),
          el('div', { class: 'plp-item__addr', text: line(l) }),
        ]),
        l.distanceKm != null ? el('span', { class: 'plp-item__dist', text: km(l.distanceKm) }) : null,
      ]);
      item.addEventListener('click', function () { choose(l); });
      item.addEventListener('mouseenter', function () { focusMarker(l.id); });
      item.addEventListener('keydown', function (e) { if (e.key === 'Enter') choose(l); });
      list.appendChild(item);
    });
  }

  function drawMarkers() {
    if (!map || !window.L) return;
    markers.forEach(function (m) { m.remove(); });
    markers = [];
    var bounds = [];
    state.results.forEach(function (l) {
      var icon = L.divIcon({
        className: 'plp-pin',
        html: l.carrierLogo ? '<img src="' + APP + '/logos/carrier-' + l.carrierLogo + '.png" alt="">' : '',
        iconSize: [30, 30],
      });
      var btn = el('button', { type: 'button', text: T.select });
      btn.addEventListener('click', function () { choose(l); });
      var pop = el('div', { class: 'plp-pop' }, [el('b', { text: l.name }), el('span', { text: line(l) }), btn]);
      var m = L.marker([l.lat, l.lng], { icon: icon }).bindPopup(pop).addTo(map);
      m._plpId = l.id;
      markers.push(m);
      bounds.push([l.lat, l.lng]);
    });
    if (state.near) bounds.push([state.near.lat, state.near.lng]);
    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
  }

  function focusMarker(id) {
    var m = markers.find(function (x) { return x._plpId === id; });
    if (m && map) m.openPopup();
  }

  /* ---------- saving ---------- */

  function choose(l) {
    if (state.saving) return;
    state.saving = true;
    state.list.querySelectorAll('.plp-item').forEach(function (n) { n.style.opacity = '.5'; });
    saveToCart(l)
      .then(function () {
        chosen = { id: l.id, name: l.name, address: l.address, city: l.city, network: l.network, brand: l.brand, carrierLogo: l.carrierLogo };
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
          var summary = { id: l.id, name: l.name, address: l.address, city: l.city, network: l.network, brand: l.brand || null, carrierLogo: l.carrierLogo || null };
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
