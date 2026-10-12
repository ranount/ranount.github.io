/* «Ясность. Нормы» — общий JS сайта (без сборки). Контракт со Строителем 2: window.Yasn = { copy, toast, getJSON,
   plural, store, citeFormat }. Текст пользователя выводится только через textContent. */
(function () {
  'use strict';
  var body = document.body;
  var BASE = (body && body.getAttribute('data-base')) || '/';

  var store = {
    get: function (k, d) { try { var v = window.localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* хранилище недоступно */ } }
  };

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  /* copy(text, btn, opts): копирует и на 2,5 с перекрашивает кнопку («✓ Скопировано», фон #0E9384). */
  function copy(text, btn, opts) {
    opts = opts || {};
    var done = function () {
      if (!btn) return;
      var label = btn.getAttribute('data-label') || btn.textContent;
      btn.setAttribute('data-label', label);
      btn.textContent = opts.done || btn.getAttribute('data-done') || '✓ Скопировано';
      btn.classList.add('is-copied');
      clearTimeout(btn._yt);
      btn._yt = setTimeout(function () { btn.textContent = label; btn.classList.remove('is-copied'); }, 2500);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, function () { if (fallbackCopy(text)) done(); else toast('Не удалось скопировать'); });
    } else if (fallbackCopy(text)) { done(); } else { toast('Не удалось скопировать'); }
  }

  var cache = {};
  function getJSON(url) {
    if (!cache[url]) {
      cache[url] = fetch(url, { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
    }
    return cache[url];
  }

  function plural(n, a, b, c) {
    var m = n % 10, h = n % 100;
    return n + ' ' + (m === 1 && h !== 11 ? a : (m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c));
  }

  var FORMATS = ['short', 'full', 'url'];
  function citeFormat(v) {
    if (v && FORMATS.indexOf(v) >= 0) { store.set('yasn.citeFormat', v); return v; }
    var s = store.get('yasn.citeFormat', 'short');
    return FORMATS.indexOf(s) >= 0 ? s : 'short';
  }

  window.Yasn = { copy: copy, toast: toast, getJSON: getJSON, plural: plural, store: store, citeFormat: citeFormat, base: BASE };

  /* ── формат ссылки (7h): короткая / полная / с адресом страницы ── */
  function applyCite(fmt) {
    document.querySelectorAll('[data-cite-text][data-cite-short]').forEach(function (el) {
      var v = el.getAttribute('data-cite-' + fmt) || el.getAttribute('data-cite-short');
      el.textContent = v;
    });
    document.querySelectorAll('[data-cite-format]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-cite-format') === fmt ? 'true' : 'false');
    });
  }
  if (document.querySelector('[data-cite-format]')) applyCite(citeFormat());

  /* ── длинное название (PLAN §16): свёрнуто до 3 строк, кнопка — только если текст не уместился ── */
  function clampCheck() {
    document.querySelectorAll('[data-clamp-toggle]').forEach(function (b) {
      var t = document.getElementById(b.getAttribute('data-clamp-toggle'));
      if (t && !t.classList.contains('is-open')) b.hidden = !(t.scrollHeight > t.clientHeight + 2);
    });
  }
  clampCheck();
  window.addEventListener('load', clampCheck);

  /* ── клики ── */
  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('a,button') : null;
    if (!t) return;
    if (t.hasAttribute('data-stub')) { e.preventDefault(); toast(t.getAttribute('data-stub')); return; }
    if (t.hasAttribute('data-cite-format')) { applyCite(citeFormat(t.getAttribute('data-cite-format'))); return; }
    if (t.hasAttribute('data-copy-text')) { copy(t.getAttribute('data-copy-text'), t); return; }
    if (t.hasAttribute('data-copy-unit')) {
      /* «Текст»: шифр + текст пункта (абзацы и строки таблиц — как на странице) */
      var box = document.getElementById('tekst'), lines = [];
      if (box) box.querySelectorAll('p,tr,.norm-head').forEach(function (el) {
        if (el.tagName === 'TR') { lines.push(Array.prototype.map.call(el.children, function (c) { return c.textContent.trim(); }).join(' | ')); }
        else if (!el.closest('tr')) lines.push(el.textContent.replace(/\s*ч\.[\d.]+\s*→\s*$/, '').trim());
      });
      copy(t.getAttribute('data-copy-unit') + '\n' + lines.join('\n'), t);
      return;
    }
    if (t.hasAttribute('data-copy-from')) {
      var src = t.previousElementSibling;
      if (src) copy(src.textContent.trim(), t);
      return;
    }
    if (t.hasAttribute('data-print')) { window.print(); return; }
    if (t.hasAttribute('data-clamp-toggle')) {
      var ft = document.getElementById(t.getAttribute('data-clamp-toggle'));
      if (ft) {
        var op = ft.classList.toggle('is-open');
        t.textContent = op ? 'Свернуть' : 'Показать полностью';
        t.setAttribute('aria-expanded', op ? 'true' : 'false');
      }
      return;
    }
    if (t.classList.contains('hdr-icon--menu')) {
      var dr = document.getElementById('nav-drawer');
      if (dr) { dr.hidden = !dr.hidden; t.setAttribute('aria-expanded', dr.hidden ? 'false' : 'true'); }
      return;
    }
    if (t.hasAttribute('data-expand')) {
      var box = document.getElementById(t.getAttribute('data-expand'));
      if (box) { box.hidden = false; t.hidden = true; t.setAttribute('aria-expanded', 'true'); }
      return;
    }
    if (t.hasAttribute('data-collapse')) {
      var open = t.closest('.stg-open');
      if (open) { open.hidden = true; var b2 = open.previousElementSibling; if (b2) { b2.hidden = false; b2.setAttribute('aria-expanded', 'false'); b2.focus(); } }
      return;
    }
    if (t.hasAttribute('data-more')) {
      var g = t.closest('[data-stage-group]');
      var opened = t.getAttribute('aria-expanded') === 'true';
      var items = g ? g.querySelectorAll('[data-more-item]') : [];
      for (var i = 6; i < items.length; i++) items[i].hidden = opened;
      t.setAttribute('aria-expanded', opened ? 'false' : 'true');
      t.textContent = opened ? t.getAttribute('data-label-closed') : 'Свернуть';
      return;
    }
    if (t.hasAttribute('data-tab')) {
      var tab = t.getAttribute('data-tab');
      document.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-pressed', b === t ? 'true' : 'false'); });
      document.querySelectorAll('[data-tab-pane]').forEach(function (p) { p.hidden = !!tab && p.getAttribute('data-tab-pane') !== tab; });
      return;
    }
  });

  /* ── печать: дата печати (без JS остаётся дата сборки) ── */
  window.addEventListener('beforeprint', function () {
    var d = new Date();
    var s = ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear();
    document.querySelectorAll('[data-print-stamp]').forEach(function (el) {
      el.textContent = 'Распечатано ' + s + ' · текст сверен ' + (body.getAttribute('data-verified') || '');
    });
    /* колонтитул каждого листа (@page в <style data-print-page>) — та же дата печати */
    var pst = document.querySelector('style[data-print-page]');
    if (pst) pst.textContent = pst.textContent.replace(/Распечатано \d{2}\.\d{2}\.\d{4}/g, 'Распечатано ' + s);
  });
  if (document.querySelector('[data-print-doc]')) {
    document.querySelector('[data-print-doc]').addEventListener('click', function () { store.set('yasn.autoprint', '1'); });
  }
  if (body.classList.contains('pg-doc_print') && store.get('yasn.autoprint', '') === '1') {
    store.set('yasn.autoprint', '');
    window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });
  }

  /* ── каталог: найти в разделе, только действующие, сортировка, «ещё» ── */
  var cat = document.querySelector('[data-catalog]');
  if (cat) {
    var rowsBox = cat.querySelector('[data-cat-rows]');
    var rows = Array.prototype.slice.call(rowsBox.querySelectorAll('.cat-row'));
    var findIn = cat.querySelector('[data-cat-find]');
    var act = cat.querySelector('[data-cat-active]');
    var sortBtn = cat.querySelector('[data-cat-sort]');
    var moreBtn = cat.querySelector('[data-cat-more]');
    var none = cat.querySelector('[data-cat-none]');
    var countEl = cat.querySelector('[data-cat-count]');
    var total = rows.length, limit = 15, sort = 0;
    var SORTS = ['по номеру', 'по дате редакции', 'по названию'];
    var N = function (s) { return (s || '').toLowerCase().replace(/ё/g, 'е'); };
    var collator = new Intl.Collator('ru', { numeric: true });
    function render() {
      var q = N(findIn.value.trim()), onlyAct = act.getAttribute('aria-pressed') === 'true';
      var words = q.split(/[^a-zа-я0-9/.-]+/).filter(Boolean);
      var list = rows.filter(function (r) {
        if (onlyAct && r.getAttribute('data-st') !== 'ok') return false;
        var h = r.getAttribute('data-find');
        return words.every(function (w) { return h.indexOf(w) >= 0; });
      });
      list.sort(function (a, b) {
        if (sort === 1) return (+b.getAttribute('data-ed')) - (+a.getAttribute('data-ed'));
        if (sort === 2) return collator.compare(a.getAttribute('data-name').replace(/^[«"]/, ''), b.getAttribute('data-name').replace(/^[«"]/, ''));
        return (+a.getAttribute('data-i')) - (+b.getAttribute('data-i'));
      });
      rows.forEach(function (r) { r.hidden = true; });
      list.forEach(function (r, i) { rowsBox.appendChild(r); r.hidden = i >= limit; });
      countEl.textContent = list.length === total ? String(total) : list.length + ' из ' + total;
      none.hidden = list.length > 0;
      if (moreBtn) {
        var rest = list.length - limit;
        moreBtn.hidden = rest <= 0;
        if (rest > 0) moreBtn.textContent = 'Ещё ' + plural(rest, 'документ', 'документа', 'документов');
      }
    }
    findIn.addEventListener('input', function () { limit = 15; render(); });
    act.addEventListener('click', function () { act.setAttribute('aria-pressed', act.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); limit = 15; render(); });
    sortBtn.addEventListener('click', function () { sort = (sort + 1) % 3; sortBtn.textContent = 'Сортировка: ' + SORTS[sort] + ' ▾'; render(); });
    if (moreBtn) moreBtn.addEventListener('click', function () { limit += 25; render(); });
    /* на бумаге — весь отобранный список, без «Ещё N» (PLAN §15.1) */
    var keepLimit = limit;
    window.addEventListener('beforeprint', function () { keepLimit = limit; limit = 1e9; render(); });
    window.addEventListener('afterprint', function () { limit = keepLimit; render(); });
  }

  /* ── лента «Что изменилось»: тип, ведомство, период ── */
  var feed = document.querySelector('[data-feed]');
  if (feed) {
    var sels = document.querySelectorAll('[data-feed-filters] select');
    var today = feed.getAttribute('data-today');
    function sinceNum(months) {
      var y = +today.slice(0, 4), m = +today.slice(4, 6) - months, d = +today.slice(6, 8);
      while (m <= 0) { m += 12; y -= 1; }
      return y * 10000 + m * 100 + Math.min(d, 28);
    }
    function applyFeed() {
      var f = {};
      sels.forEach(function (s) { f[s.getAttribute('data-f')] = s.value; });
      var since = sinceNum(+f.months || 3), any = false, lastMonth = null, monthHas = false;
      Array.prototype.forEach.call(feed.children, function (el) {
        if (el.hasAttribute('data-month')) {
          if (lastMonth) lastMonth.hidden = !monthHas;
          lastMonth = el; monthHas = false; return;
        }
        if (!el.classList.contains('chg-item')) return;
        var ok = (+el.getAttribute('data-d') >= since) && (!f.type || el.getAttribute('data-type') === f.type) && (!f.sec || el.getAttribute('data-sec') === f.sec);
        el.hidden = !ok; if (ok) { monthHas = true; any = true; }
      });
      if (lastMonth) lastMonth.hidden = !monthHas;
      var empty = feed.querySelector('[data-feed-empty]');
      if (empty) empty.hidden = any;
    }
    sels.forEach(function (s) { s.addEventListener('change', applyFeed); });
    applyFeed();
  }

  /* ── «Найти в документе» (клиентский поиск по тексту документа) ── */
  var df = document.querySelector('[data-doc-find]');
  if (df) {
    var input = df.querySelector('input');
    var sec = document.querySelector('[data-doc-sec]');
    var res = document.querySelector('[data-doc-find-res]');
    var dataUrl = df.getAttribute('data-doc-find');
    var timer = null;
    var stem = function (w) { return w.length > 6 ? w.slice(0, w.length - 2) : w; };
    var esc = function (s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    function run() {
      var q = (input.value || '').trim();
      if (!q) { res.hidden = true; sec.hidden = false; return; }
      var ws = N2(q).split(/[^a-zа-я0-9]+/).filter(function (w) { return w.length >= 2; }).map(stem);
      if (!ws.length) return;
      getJSON(dataUrl).then(function (meta) {
        return Promise.all(meta.chunks.map(function (c) { return getJSON(BASE.replace(/\/$/, '') + '/assets/data/text/c' + ('00' + c).slice(-3) + '.json'); })).then(function (chs) {
          var texts = {}; chs.forEach(function (ch) { for (var k in ch) texts[k] = ch[k]; });
          var hits = meta.units.filter(function (u) {
            var h = N2(u[1] + ' ' + (u[3] || '') + ' ' + (texts[u[0]] || ''));
            return ws.every(function (w) { return h.indexOf(w) >= 0; });
          });
          res.innerHTML = '';
          var head = document.createElement('div'); head.className = 'doc-sec__h';
          var h2 = document.createElement('h2'); h2.textContent = 'Найдено в документе';
          var cnt = document.createElement('span'); cnt.textContent = plural(hits.length, 'пункт', 'пункта', 'пунктов');
          head.appendChild(h2); head.appendChild(cnt); res.appendChild(head);
          if (!hits.length) { var e0 = document.createElement('div'); e0.className = 'du'; e0.textContent = 'В документе нет «' + q + '».'; res.appendChild(e0); }
          hits.slice(0, 80).forEach(function (u) {
            var row = document.createElement('div'); row.className = 'du';
            var a = document.createElement('a'); a.className = 'du__k'; a.href = meta.base + u[2]; a.textContent = u[1];
            var b = document.createElement('div'); b.className = 'du__b';
            if (u[3]) { var hh = document.createElement('div'); hh.className = 'du__h'; hh.textContent = u[3]; b.appendChild(hh); }
            var p = document.createElement('p'); p.className = 'norm norm--17';
            p.innerHTML = highlight(texts[u[0]] || '', ws, esc);
            b.appendChild(p); row.appendChild(a); row.appendChild(b); res.appendChild(row);
          });
          res.hidden = false; sec.hidden = true;
        });
      }).catch(function () { toast('Поиск по документу недоступен'); });
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 180); });
  }
  function N2(s) { return (s || '').toLowerCase().replace(/ё/g, 'е'); }
  function highlight(text, ws, esc) {
    var t = text.replace(/\s*\n\s*/g, ' '), n = N2(t), idx = -1;
    ws.forEach(function (w) { var i = n.indexOf(w); if (i >= 0 && (idx < 0 || i < idx)) idx = i; });
    var st = Math.max(0, idx - 90), en = Math.min(t.length, st + 320);
    var piece = t.slice(st, en), pn = n.slice(st, en), hits = [];
    ws.forEach(function (w) { var i = 0; while ((i = pn.indexOf(w, i)) >= 0) { var j = i + w.length; while (j < pn.length && /[a-zа-я0-9]/.test(pn[j])) j++; hits.push([i, j]); i = j; } });
    hits.sort(function (a, b) { return a[0] - b[0]; });
    var out = st > 0 ? '…' : '', p = 0;
    hits.forEach(function (h) { if (h[0] < p) return; out += esc(piece.slice(p, h[0])) + '<mark>' + esc(piece.slice(h[0], h[1])) + '</mark>'; p = h[1]; });
    out += esc(piece.slice(p)) + (en < t.length ? '…' : '');
    return out;
  }
})();
