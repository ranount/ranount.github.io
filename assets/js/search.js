/* Поиск «Ясность. Нормы» (макеты 5b, 5c; README «Поиск по шифру», «Поиск по словам»; PLAN §9) — Строитель 2.

   Всё в браузере: индекс (assets/data/search/*), таблицы (docs.json, units.json) и правила разбора ссылок
   (cite-engine.js) — статические файлы сборки; запрос никуда не отправляется. Нормализация, основы слов и адреса —
   search-core.js (одна с Python search_index.py, тест совпадения). Текст запроса выводится только через textContent.

   Порядок: 1) шифр — строгий разбор (те же правила, что у программы), затем нестрогий (codeMatch прототипа:
   «мса320 10», «фсбу4», «402фз 13», «п.А4» кириллицей); 2) сокращения (synonyms.json); 3) слова — все слова запроса,
   совпадение основы внутри слова, вес: заголовок ×5 + вхождения + «Требования» +30 / основные +20, утратившие — в конец;
   4) документы по названию. Enter при однозначном совпадении открывает пункт (документ) сразу. */
(function () {
  'use strict';
  var root = document.querySelector('[data-search]');
  if (!root || !window.Yasn) return;
  var Y = window.Yasn, C = window.YasnSearch;
  var BASE = (Y.base || '/').replace(/\/$/, '');
  var D = BASE + '/assets/data/';
  var LIMIT = 20;

  var $ = function (s) { return root.querySelector(s); };
  var el = {
    form: $('[data-sr-form]'), q: $('[data-sr-q]'), results: $('[data-sr-results]'), empty: $('[data-sr-empty]'),
    loading: $('[data-sr-loading]'), loadingX: $('[data-sr-loading-x]'), iss: $('[data-sr-iss]'), kind: $('[data-sr-kind]'),
    st: $('[data-sr-st]'), main: $('[data-sr-main]'), lead: $('[data-sr-lead]'), items: $('[data-sr-items]'),
    none: $('[data-sr-none]'), more: $('[data-sr-more]'), stage: $('[data-sr-stage]'), stageT: $('[data-sr-stage-t]'),
    stageN: $('[data-sr-stage-n]'), docs: $('[data-sr-docs]'), docsL: $('[data-sr-docs-l]'), missTag: $('[data-sr-miss-tag]'),
    missSub: $('[data-sr-miss-sub]'), missT: $('[data-sr-miss-t]'), missChips: $('[data-sr-miss-chips]'),
    missStage: $('[data-sr-miss-stage]'), missStageT: $('[data-sr-miss-stage-t]')
  };

  /* ── фильтры (5b): одиночный выбор в группе, счётчики по всем результатам ── */
  var ISS_MAIN = [['Минфин России', function (d) { return d.issuer === 'Минфин России' || d.issuer === 'Минфин России и Росфинмониторинг'; }],
    ['СРО ААС', function (d) { return d.issuer === 'СРО ААС'; }],
    ['Казначейство', function (d) { return d.issuer === 'Федеральное казначейство'; }],
    ['Закон', function (d) { return d.issuer === 'Федеральный закон'; }]];
  var ISS_MORE = ['Правительство РФ', 'Банк России', 'Росфинмониторинг', 'ФНС России', 'Росстат'];
  var KINDS = [['МСА', function (d) { return d.kind === 'МСА'; }],
    ['ФСБУ/ПБУ', function (d) { return d.kind === 'ФСБУ' || d.kind === 'ПБУ'; }],
    ['Разъяснение', function (d) { return /^Разъяснение/.test(d.kind); }],
    ['Приказ', function (d) { return d.kind === 'Приказ'; }],
    ['Письмо', function (d) { return d.kind === 'Письмо' || d.kind === 'Информационное сообщение' || d.kind === 'Информационное письмо'; }]];
  var STS = [['Действует', function (d) { return d.st.cls === 'ok' || d.st.cls === 'ending' || d.st.cls === 'info'; }],
    ['Вступает в силу позже', function (d) { return d.st.cls === 'soon'; }],
    ['Утратил силу', function (d) { return d.st.cls === 'old'; }]];
  function issGroups() {
    return ISS_MAIN.concat(ISS_MORE.map(function (n) { return [n, function (d) { return d.issuer === n; }, true]; }));
  }

  /* ── состояние (в строке адреса: q, iss, kind, st, main) ── */
  var P = new URLSearchParams(location.search);
  var S = { q: P.get('q') || '', iss: P.get('iss'), kind: P.get('kind'), st: P.get('st'), main: P.get('main') !== '0',
    limit: LIMIT, go: P.get('go') === '1' };
  el.q.value = S.q;
  el.main.setAttribute('aria-pressed', S.main ? 'true' : 'false');

  function syncUrl() {
    var p = new URLSearchParams();
    if (S.q) p.set('q', S.q);
    if (S.iss) p.set('iss', S.iss);
    if (S.kind) p.set('kind', S.kind);
    if (S.st) p.set('st', S.st);
    if (!S.main) p.set('main', '0');
    var qs = p.toString();
    try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '')); } catch (e) { /* file:// и т.п. */ }
  }

  /* ── данные и запрос: ядро search-core.js (Data.run — распознавание шифра, сокращения, индекс, документы) ── */
  function load() { return C.load(BASE + '/'); }
  function docUrl(L, d) { return L.base + d.slug + '/'; }
  /* строка-страница, на которой стоит единица (у якоря — ближайшая страница выше) */
  function pageRow(L, u) {
    var rows = L.units.rows, d0 = rows[u][0];
    while (u > 0 && !(rows[u][4] & 32) && rows[u - 1][0] === d0) u--;
    return u;
  }
  function unitItem(L, u, exact) {
    var r = L.units.rows[u], doc = L.docs[r[0]];
    return { t: 'unit', u: u, doc: doc, code: (doc.short ? doc.short + ' ' : '') + r[1], key: r[1], url: L.url(u), exact: exact };
  }
  function docItem(L, doc) { return { t: 'doc', doc: doc, code: doc.short || doc.title, url: docUrl(L, doc) }; }

  function compute(L, q) {
    var res = L.run(q, { mainBonus: S.main }), code = res.code;
    var R = { q: q, items: [], docItems: [], lead: '', target: code ? code.url : null, syn: res.syn[0] || null, words: res.words };
    if (code && code.kind === 'missing') { R.miss = code; return R; }
    res.findings.forEach(function (f) { R.items.push({ t: 'find', f: f, code: f.id, url: f.url }); });
    if (code && (code.kind === 'unit' || code.kind === 'units')) {
      R.lead = 'Совпадения по шифру «' + q + '».';
      if (res.units.length) res.units.forEach(function (x) { R.items.push(unitItem(L, x.u, true)); });
      else {  /* текст документа на сайте не показывается — карточка «только ссылка» */
        var di = L.docIndex(code.sid), doc = di >= 0 ? L.docs[di] : null;
        if (doc) (code.all ? [].concat.apply([], code.all.map(function (a) { return a.ids; })) : code.ids).slice(0, 30).forEach(function (id) {
          R.items.push({ t: 'linkunit', doc: doc, code: id, url: docUrl(L, doc) });
        });
      }
    } else {
      res.units.forEach(function (x) { R.items.push(unitItem(L, x.u, false)); });
      if (code && code.kind === 'doc' && code.numberOnly) R.lead = 'Документ с номером «' + q + '» — первым; ниже — пункты, где встречается «' + q + '».';
      else if (code && code.kind === 'doc') R.lead = 'Документ по шифру «' + q + '».' + (res.units.length ? ' Ниже — его пункты со словами запроса.' : '');
      else if (R.syn) R.lead = '«' + q + '» — ' + R.syn.full + '. Пункты, где встречается сокращение или расшифровка.' + (S.main ? ' Сверху — основные нормы.' : '');
      else R.lead = 'Пункты, где встречается «' + q + '».' + (S.main ? ' Сверху — основные нормы.' : '');
    }
    /* документы: найденный по шифру и документы без текста на сайте — карточками сверху; прочие — справа */
    var top = [];
    res.docs.forEach(function (i, k) {
      var d = L.docs[i], it = docItem(L, d);
      if ((code && code.kind === 'doc' && k === 0) || d.mode !== 'text') top.push(it); else R.docItems.push(it);
    });
    R.items = R.items.filter(function (it) { return it.t === 'find'; }).concat(top.slice(0, 12), R.items.filter(function (it) { return it.t !== 'find'; }));
    return R;
  }

  /* ── отрисовка ── */
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function badge(d) {
    if (d.mode === 'link') return ['Только ссылка', 'ring'];
    if (d.mode === 'meta') return ['Только реквизиты', 'ring'];
    if (!d.st.label) return null;
    return [d.st.label, { ok: 'ok', ending: 'warn', soon: 'warn', old: 'old' }[d.st.cls] || 'ring'];
  }
  /* фрагмент с <mark> (snippet() ядра = hl() прототипа): окно 240 знаков вокруг первого совпадения */
  /* строки таблиц « | » в сниппете: пустые ячейки убраны, ячейки — через «—», конец строки — «;»,
     чтобы код показателя не читался как начало следующей строки (S3-5) */
  function tidyRows(text) {
    return String(text || '').split('\n').map(function (ln) {
      if (ln.indexOf('|') < 0) return ln;
      var cells = ln.split('|').map(function (c) { return c.trim(); }).filter(Boolean);
      return cells.length ? cells.join(' — ') + ';' : '';
    }).filter(function (ln) { return ln.trim(); }).join('\n');
  }
  function hl(box, text, ws, limit) {
    C.snippet(tidyRows(text), ws, limit).forEach(function (sg) { box.appendChild(sg.hit ? mk('mark', '', sg.t) : document.createTextNode(sg.t)); });
  }
  function linkNote(d) {
    if (d.mode === 'meta') return 'Текста документа на сайте нет — только реквизиты и официальный источник. Открыть →';
    if (d.issuer === 'СРО ААС') return 'Текст документа СРО ААС на сайте не публикуется. Открыть реквизиты и ссылку на сайт СРО ААС →';
    return 'Текст документа на сайте пока не публикуется. Открыть реквизиты и официальный источник →';
  }
  function card(L, it, ws, txt) {
    var a = mk('a', 'sr-card' + (it.t === 'find' ? ' sr-card--find' : ''));
    a.href = it.url;
    var h = mk('div', 'sr-card__h'), c = mk('div', 'sr-card__c');
    if (it.t === 'find') {
      c.appendChild(mk('b', '', it.f.unit_id || it.f.id));
      h.appendChild(c); h.appendChild(mk('span', 'badge badge--find', it.f.status === 'confirmed' ? 'Находка' : 'Находка-кандидат'));
      a.appendChild(h);
      a.appendChild(mk('div', 'sr-card__n', it.f.title + ' Подробнее →'));
      return a;
    }
    var d = it.doc;
    c.appendChild(mk('b', '', it.code));
    if (d.ed) c.appendChild(mk('span', 'sr-card__ed', d.ed));
    h.appendChild(c);
    var bd = it.t === 'unit' ? (d.st.label ? [d.st.label, { ok: 'ok', ending: 'warn', soon: 'warn', old: 'old' }[d.st.cls] || 'ring'] : null) : badge(d);
    if (it.t === 'unit' && (L.units.rows[it.u][4] & 8) && d.st.cls !== 'old') bd = ['Утратил силу', 'old'];
    if (bd) h.appendChild(mk('span', 'badge badge--' + bd[1], bd[0]));
    a.appendChild(h);
    if (it.t === 'unit') {
      var head = L.heading(pageRow(L, it.u));
      if (head) a.appendChild(mk('div', 'sr-card__hd', head));
      var x = mk('div', 'sr-card__x');
      var tx = txt[it.u] || '';
      if (!tx && L.units.rows[it.u][4] & 64) tx = 'Статья состоит из частей — откройте статью.';
      hl(x, tx, ws, 240);
      a.appendChild(x);
    } else if (it.t === 'linkunit') {
      a.appendChild(mk('div', 'sr-card__n', linkNote(d)));
    } else {
      a.appendChild(mk('div', 'sr-card__hd', d.name && d.name !== d.short ? d.name : d.title));
      a.appendChild(mk('div', 'sr-card__n', d.mode === 'text' ? 'Документ · ' + Y.plural(d.units, 'пункт', 'пункта', 'пунктов') + '. Открыть оглавление →' : linkNote(d)));
    }
    return a;
  }

  function filterBtn(cls, label, n, on, go, disabled) {
    var b = mk('button', cls);
    b.type = 'button';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (cls.indexOf('srch-chip') < 0) b.appendChild(mk('span', 'srch-f__b'));
    b.appendChild(mk('span', '', label));
    b.appendChild(mk('span', 'srch-f__n', n ? String(n) : ''));
    if (disabled && !on) b.disabled = true;
    b.addEventListener('click', go);
    return b;
  }

  function setState(st) {
    root.setAttribute('data-state', st);
    el.results.hidden = st !== 'results';
    el.empty.hidden = st !== 'empty' && st !== 'idle';
    el.loading.hidden = st !== 'loading';
  }

  function miss(L, cm) {
    var E = L.engine, d = E.doc(cm.sid), di = L.docIndex(cm.sid), doc = di >= 0 ? L.docs[di] : null;
    el.missTag.className = 'badge badge--err'; el.missTag.textContent = 'Пункта нет';
    var rest = cm.label.indexOf(d.prefix) === 0 ? cm.label.slice(d.prefix.length).trim() : (cm.rest || '');
    var art = /^ст/.test(rest) || (d.family === 'law' && !/^п/.test(rest));
    var num = rest.replace(/^(?:п|ст)\.?\s*/, '').replace(/^a/, 'A');
    el.missSub.textContent = 'Шифр распознан: ' + d.prefix + ', ' + (art ? 'статья ' : 'пункт ') + num;
    el.missT.textContent = 'В ' + d.prefix + ' ' + (cm.ranges || 'нет такого места');
    el.missChips.textContent = '';
    (cm.nearest || []).forEach(function (x) {
      var a = mk('a', 'srch-mchip', x.id);
      a.href = x.url || (doc ? docUrl(L, doc) : BASE + '/');
      el.missChips.appendChild(a);
    });
    var toc = mk('a', 'srch-mchip srch-mchip--toc', 'Оглавление ' + d.prefix + ' →');
    toc.href = E.docUrl(cm.sid) || (doc ? docUrl(L, doc) : BASE + '/katalog/');
    el.missChips.appendChild(toc);
    /* этап, в котором больше всего пунктов документа */
    var pre = d.prefix + ' ', best = null;
    L.stages.forEach(function (st) {
      var n = st.ids.filter(function (id) { return id.indexOf(pre) === 0; }).length;
      if (n && (!best || n > best.n)) best = { s: st, n: n };
    });
    el.missStage.href = best ? best.s.url : BASE + '/etapy/';
    el.missStageT.textContent = best ? best.s.title + ' · ' + Y.plural(best.s.n, 'пункт', 'пункта', 'пунктов') : 'Все этапы аудита';
    setState('empty');
  }
  function nothing(q) {
    el.missTag.className = 'badge badge--old'; el.missTag.textContent = q ? 'Ничего не нашли' : '';
    el.missSub.textContent = q ? 'Запрос: «' + q + '»' : '';
    el.missT.textContent = q ? 'По запросу «' + q + '» ничего не нашли' : 'Введите шифр пункта, документ, код строки или слово';
    el.missChips.textContent = '';
    ['МСА 320 п.10', 'существенность', '402-ФЗ ст.13', 'выборка'].forEach(function (t) {
      var a = mk('a', 'srch-mchip', t); a.href = BASE + '/poisk/?q=' + encodeURIComponent(t); el.missChips.appendChild(a);
    });
    el.missStage.href = BASE + '/etapy/'; el.missStageT.textContent = 'Все этапы аудита';
    setState(q ? 'empty' : 'idle');
  }

  var seq = 0;
  function show(L, R) {
    var my = ++seq;
    if (R.miss) { miss(L, R.miss); return; }
    var all = R.items.length ? R.items : (R.docItems || []);
    if (!all.length) { nothing(R.q); return; }
    /* фильтры */
    var groups = { iss: issGroups(), kind: KINDS, st: STS };
    var docOf = function (it) { return it.doc || (it.f && L.docs[L.docIndex(it.f.doc_id)]) || null; };
    var pass = function (it, skip) {
      var d = docOf(it);
      if (!d) return !S.iss && !S.kind && !S.st;
      if (skip !== 'iss' && S.iss) { var g = groups.iss.filter(function (x) { return x[0] === S.iss; })[0]; if (g && !g[1](d)) return false; }
      if (skip !== 'kind' && S.kind) { var k = groups.kind.filter(function (x) { return x[0] === S.kind; })[0]; if (k && !k[1](d)) return false; }
      if (skip !== 'st' && S.st) { var s = groups.st.filter(function (x) { return x[0] === S.st; })[0]; if (s && !s[1](d)) return false; }
      return true;
    };
    var flt = all.filter(function (it) { return pass(it); });
    var count = function (name, g) { return all.filter(function (it) { var d = docOf(it); return d && g[1](d); }).length; };
    el.iss.textContent = '';
    groups.iss.forEach(function (g) {
      var n = count('iss', g);
      if (g[2] && !n && S.iss !== g[0]) return;
      el.iss.appendChild(filterBtn('srch-f', g[0], n, S.iss === g[0], function () { S.iss = S.iss === g[0] ? null : g[0]; S.limit = LIMIT; rerender(); }, !n));
    });
    el.kind.textContent = '';
    groups.kind.forEach(function (g) {
      var n = count('kind', g);
      el.kind.appendChild(filterBtn('srch-chip', g[0], n, S.kind === g[0], function () { S.kind = S.kind === g[0] ? null : g[0]; S.limit = LIMIT; rerender(); }, !n));
    });
    el.st.textContent = '';
    groups.st.forEach(function (g) {
      var n = count('st', g);
      el.st.appendChild(filterBtn('srch-f srch-f--radio', g[0], n, S.st === g[0], function () { S.st = S.st === g[0] ? null : g[0]; S.limit = LIMIT; rerender(); }, !n));
    });
    var anyF = !!(S.iss || S.kind || S.st);
    root.querySelectorAll('[data-sr-reset]').forEach(function (b) { b.hidden = b.closest('[data-sr-none]') ? false : !anyF; });
    el.lead.textContent = R.lead;
    el.none.hidden = flt.length > 0;
    var shown = flt.slice(0, S.limit);
    var ws = R.words.concat(R.syn ? R.syn.words : []);
    Promise.all(shown.map(function (it) { return it.t === 'unit' ? L.pageText(pageRow(L, it.u)) : Promise.resolve(''); })).then(function (tx) {
      if (my !== seq) return;
      var txt = {};
      shown.forEach(function (it, k) { if (it.t === 'unit') txt[it.u] = tx[k]; });
      el.items.textContent = '';
      shown.forEach(function (it) { el.items.appendChild(card(L, it, ws, txt)); });
    });
    var rest = flt.length - S.limit;
    el.more.hidden = rest <= 0;
    if (rest > 0) el.more.textContent = 'Показать ещё ' + Math.min(LIMIT, rest) + ' из ' + rest;
    /* этап: пересечение с выдачей, взвешенное по месту в выдаче (верхние результаты важнее) */
    var w = {};
    all.forEach(function (it, rank) {
      if (it.t !== 'unit' || rank >= 60) return;
      var d = L.engine.doc(it.doc.id), i = d ? d.idx.get(d.prefix ? d.prefix + ' ' + it.key : it.key) : undefined;
      if (i === undefined && d) i = d.keys.indexOf(it.key);
      if (i !== undefined && i >= 0) w[d.ids[i]] = 1 / (rank + 1);
    });
    var best = null;
    L.stages.forEach(function (s) {
      var n = 0;
      s.ids.forEach(function (id) { n += w[id] || 0; });
      if (n && (!best || n > best.n)) best = { s: s, n: n };
    });
    /* у сокращения этап задан в synonyms.json («ВКД» — «Контроль качества», S3-6) */
    if (R.syn && R.syn.stage) {
      L.stages.forEach(function (s) { if (s.id === R.syn.stage) best = { s: s, n: s.n }; });
    }
    el.stage.hidden = !best;
    if (best) {
      el.stage.href = best.s.url; el.stageT.textContent = best.s.title;
      el.stageN.textContent = Y.plural(best.s.n, 'пункт', 'пункта', 'пунктов') + ' норм этого этапа →';
    }
    /* документы справа */
    var dl = [], seenD = {};
    all.forEach(function (it) { var d = it.doc; if (d && !seenD[d.id] && dl.length < 6) { seenD[d.id] = 1; dl.push(d); } });
    (R.docItems || []).forEach(function (it) { if (!seenD[it.doc.id] && dl.length < 8) { seenD[it.doc.id] = 1; dl.push(it.doc); } });
    el.docsL.textContent = '';
    dl.forEach(function (d) {
      var qm = /«[^»]+»/.exec(d.title || '');
      var a = mk('a', '', d.short + (qm && !el.docsL.childNodes.length ? ' ' + qm[0] : ''));
      a.href = docUrl(L, d); el.docsL.appendChild(a);
    });
    el.docs.hidden = !dl.length;
    setState('results');
  }

  var last = null, loaded = false;
  function rerender() {
    syncUrl();
    if (!last) return;
    load().then(function (L) { show(L, compute(L, S.q)); });
  }

  function run(q, go) {
    S.q = (q || '').trim();
    syncUrl();
    if (!S.q) { last = null; nothing(''); return Promise.resolve(); }
    if (!loaded) setState('loading');
    return load().then(function (L) {
      loaded = true;
      var R = compute(L, S.q);
      last = R;
      if (go && R.target) { location[go === 'replace' ? 'replace' : 'assign'](R.target); return; }
      show(L, R);
    }).catch(function () {
      setState('idle');
      el.missT.textContent = 'Поиск не загрузился. Обновите страницу.';
    });
  }
  window.YasnSearchPage = { run: run, compute: function (q) { return load().then(function (L) { return compute(L, q); }); } };

  /* ── события ── */
  el.form.addEventListener('submit', function (e) { e.preventDefault(); S.limit = LIMIT; run(el.q.value, 'assign'); });
  var timer = null;
  el.q.addEventListener('input', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { S.limit = LIMIT; run(el.q.value, false); }, 220);
  });
  el.main.addEventListener('click', function () {
    S.main = !S.main; el.main.setAttribute('aria-pressed', S.main ? 'true' : 'false'); S.limit = LIMIT; rerender();
  });
  root.querySelectorAll('[data-sr-reset]').forEach(function (b) {
    b.addEventListener('click', function () { S.iss = S.kind = S.st = null; S.limit = LIMIT; rerender(); });
  });
  el.more.addEventListener('click', function () { S.limit += LIMIT; rerender(); });

  /* старт: из шапки и с главной приходят с go=1 — однозначный шифр открывается сразу (location.replace) */
  if (S.q) run(S.q, S.go ? 'replace' : false); else nothing('');
  if (!S.q) el.q.focus();
})();
