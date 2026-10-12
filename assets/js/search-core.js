/* «Ясность. Нормы» — ядро поиска в браузере (PLAN §9). Без интерфейса: страницы поиска и проверки берут отсюда
   нормализацию, адреса, распознавание шифров, полнотекстовый индекс и подсветку.

   Нормализация и адреса совпадают с Python (norms_site/build/search_index.py, slugs.py) — тест
   tests/norms_site/test_norm_parity.py. Запросы никуда не отправляются: данные — статические файлы assets/data/*.

   window.YasnSearch (в node — module.exports):
     norm, tokens, stem, words, nc                — нормализация (§9.1)
     translit, slugify, unitRest, unitSlug, docSlugCandidate, sha1Hex — адреса (порт slugs.py)
     Index(meta, postBuf, units)                  — полнотекстовый индекс (§9.2): .query(words, opts)
     snippet(text, words, limit)                  — фрагмент с подсветкой (порт hl() прототипа)
     matchCode(q, engine), recognize(q, engine)   — распознавание шифра (§9.3): строгий разбор + нестрогий
     synonymsFor(q, syn), findingsFor(q, findings), docHits(q, docs)
     rangesText(engine, sid), nearest(engine, sid, rest)
     load(base) → Promise<Data>; Data.run(q, opts), Data.text(idx), Data.pageText(idx) */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YasnSearch = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* ── нормализация (= search_index.py) ── */
  var SPLIT = /[^a-zа-я0-9]+/;
  // Python \s для str (str.isspace) — JS \s отличается (\x1c–\x1f, \x85, ﻿)
  var NC_DROP = /[\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000.]/g;
  function norm(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е'); }
  function tokens(s) { return norm(s).split(SPLIT).filter(function (w) { return w.length >= 3; }); }
  function stem(w) { return w.length > 6 ? w.slice(0, w.length - 2) : w; }
  function words(q) { return tokens(q).map(stem); }
  function nc(s) { return norm(s).replace(NC_DROP, '').replace(/а/g, 'a'); }
  /* nc() + для каждой позиции результата: стоял ли перед ней выброшенный пробел/точка («мса320 10» → 320|10). */
  function ncSep(s) {
    var n = norm(s), out = '', sep = [], gap = false;
    for (var ch of n) {
      NC_DROP.lastIndex = 0;
      if (NC_DROP.test(ch)) { gap = true; continue; }
      out += ch === 'а' ? 'a' : ch;
      for (var k = 0; k < ch.length; k++) sep.push(gap && k === 0);
      gap = false;
    }
    sep.push(gap);
    return { s: out, sep: sep };
  }

  /* ── адреса (= slugs.py) ── */
  var TR = { 'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y',
    'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f',
    'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya' };
  var UNIT_SLUG_MAX = 60;
  function translit(s) {
    var t = String(s).toLowerCase().replace(/№/g, ''), out = '';
    for (var ch of t) out += hasOwn(TR, ch) ? TR[ch] : ch;
    return out;
  }
  function slugify(s, keepDots) {
    var t = translit(s);
    if (keepDots) t = t.replace(/(?<=\p{Nd})\.(?=\p{Nd})/gu, '\x00');
    t = t.replace(/\./g, '').replace(/[^a-z0-9\x00]+/gu, '-').replace(/^-+|-+$/g, '');
    return t.replace(/\x00/g, '.');
  }
  function unitRest(uid, prefix) { return prefix && uid.indexOf(prefix + ' ') === 0 ? uid.slice(prefix.length + 1) : uid; }
  function unitSlug(uid, prefix) {
    var s = slugify(unitRest(uid, prefix), true) || 'tekst';
    if (s.length > UNIT_SLUG_MAX) s = s.slice(0, 48).replace(/[-.]+$/, '') + '-' + sha1Hex(uid).slice(0, 6);
    if (s === 'pechat' || s.indexOf('razdel-') === 0) s = 'u-' + s;
    return s;
  }
  function docSlugCandidate(prefix, sid) { return slugify(prefix) || slugify(String(sid).replace(/_/g, '-')); }

  /* sha1 (hex) от UTF-8 строки — для длинных адресов пунктов, как hashlib.sha1 в slugs.py */
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var u = unescape(encodeURIComponent(s)), b = new Uint8Array(u.length);
    for (var i = 0; i < u.length; i++) b[i] = u.charCodeAt(i);
    return b;
  }
  function sha1Hex(str) {
    var b = utf8(str), n = b.length, words = new Uint32Array(((n + 8 >> 6) + 1) * 16), i;
    for (i = 0; i < n; i++) words[i >> 2] |= b[i] << (24 - (i & 3) * 8);
    words[n >> 2] |= 0x80 << (24 - (n & 3) * 8);
    words[words.length - 1] = n * 8;
    var h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0, w = new Uint32Array(80);
    for (var blk = 0; blk < words.length; blk += 16) {
      for (i = 0; i < 16; i++) w[i] = words[blk + i];
      for (i = 16; i < 80; i++) { var x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
      var a = h0, bb = h1, c = h2, d = h3, e = h4;
      for (i = 0; i < 80; i++) {
        var f, k;
        if (i < 20) { f = (bb & c) | (~bb & d); k = 0x5A827999; }
        else if (i < 40) { f = bb ^ c ^ d; k = 0x6ED9EBA1; }
        else if (i < 60) { f = (bb & c) | (bb & d) | (c & d); k = 0x8F1BBCDC; }
        else { f = bb ^ c ^ d; k = 0xCA62C1D6; }
        var t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
        e = d; d = c; c = (bb << 30) | (bb >>> 2); bb = a; a = t;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + bb) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
    }
    return [h0, h1, h2, h3, h4].map(function (v) { return ('00000000' + (v >>> 0).toString(16)).slice(-8); }).join('');
  }

  /* ── полнотекстовый индекс (§9.2; формат — search_index.py) ── */
  /* Насыщение вхождений: одно слово даёт не больше OCC_CAP (умолчание сайта, PO может переиграть). Без него
     огромные единицы (таблица классификатора нарушений ФК — 420 тыс. знаков) обгоняют пункты требований МСА. */
  var OCC_CAP = 10;
  var TITLE_BONUS = 15;
  /* голое число — номер стандарта (МСА 315, МСЗОУ 3000) или закона (402-ФЗ): см. Data.run */
  var NUM_ONLY = /^\d{1,4}$/,
      /* номер — только из шифра в начале краткого названия, не из даты («Разъяснение … 18.09.2025») */
      NUM_DOC = /^(?:(?:МСА|МСК|МСУК|МСЗОУ|МСОП|МССУ|МОПА|ФСБУ|ПБУ)\s+(\d+)|МСФО \((?:IAS|IFRS)\)\s+(\d+)|(\d+)-ФЗ(?![А-Яа-яЁё]))/,
      NUM_ST = { ok: 0, ending: 0, soon: 1, old: 2 };
  var F = { main: 1, req: 2, guidance: 4, old: 8, finding: 16, page: 32, article: 64 };
  function Index(meta, buf, units) {
    if (!meta || meta.v !== 1) throw new Error('search/dict.json: неизвестная версия');
    var bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.terms = meta.terms;
    this.cnt = meta.cnt;
    this.flags = units && units.flags ? units.flags : F;
    this.rows = units ? units.rows : null;
    var start = new Uint32Array(meta.terms.length + 1), p = 0, i;
    for (i = 0; i < meta.terms.length; i++) { start[i] = p; p += meta.cnt[i]; }
    start[meta.terms.length] = p;
    this.start = start;
    var post = new Uint32Array(p), pos = 0, q = 0;
    for (i = 0; i < meta.terms.length; i++) {
      var last = 0;
      for (var k = 0; k < meta.cnt[i]; k++) {
        var v = 0, shift = 0, byte;
        do { byte = bytes[pos++]; v += (byte & 0x7F) * Math.pow(2, shift); shift += 7; } while (byte & 0x80);
        last += v;
        post[q++] = last;
      }
    }
    if (pos !== meta.dsize) throw new Error('search/post.bin: повреждён');
    this.post = post;
    this.vals = bytes.subarray(meta.dsize, meta.dsize + p);
    this.units = meta.units;
    this._cache = new Map();
  }
  /* Слова словаря, содержащие основу (как N(text).indexOf(stem) прототипа). */
  Index.prototype.matchTerms = function (w, exact) {
    var out = [];
    for (var i = 0; i < this.terms.length; i++) if (exact ? this.terms[i] === w : this.terms[i].indexOf(w) >= 0) out.push(i);
    return out;
  };
  /* Map(строка units.json → [вхождений в тексте, в заголовке 0/1]) для одной основы. */
  Index.prototype.hits = function (w, exact) {
    var ck = (exact ? '=' : '~') + w;
    if (this._cache.has(ck)) return this._cache.get(ck);
    var m = new Map(), self = this;
    this.matchTerms(w, exact).forEach(function (t) {
      for (var j = self.start[t]; j < self.start[t + 1]; j++) {
        var u = self.post[j], v = self.vals[j], cur = m.get(u);
        if (!cur) { cur = [0, 0]; m.set(u, cur); }
        cur[0] += v >> 1;
        cur[1] |= v & 1;
      }
    });
    if (this._cache.size > 200) this._cache.clear();
    this._cache.set(ck, m);
    return m;
  };
  /* Все основы — И. Вес (README, vSearch прототипа): Σ по словам (5 · в заголовке + вхождения) + бонус основной
     нормы (раздел «Требования» +30, прочие основные +20; вхождения слова — не больше OCC_CAP; opts.mainBonus === false — без бонуса); утратившие силу —
     в конце. opts.exact — слово целиком (сокращения), а не основа внутри слова. Возвращает [{u, score, old}]. */
  Index.prototype.query = function (ws, opts) {
    opts = opts || {};
    if (!ws || !ws.length) return [];
    var self = this, maps = ws.map(function (w) { return self.hits(w, opts.exact); });
    var order = maps.slice().sort(function (a, b) { return a.size - b.size; });
    var out = [], fl = this.flags, rows = this.rows, bonusOn = opts.mainBonus !== false;
    order[0].forEach(function (_v, u) {
      var score = 0;
      for (var i = 0; i < maps.length; i++) {
        var h = maps[i].get(u);
        if (!h) return;
        score += 5 * h[1] + Math.min(h[0], OCC_CAP);
      }
      var f = rows ? rows[u][4] : 0;
      if (bonusOn && (f & fl.main)) score += (f & fl.req) ? 30 : 20;
      out.push({ u: u, score: score, old: !!(f & fl.old) });
    });
    out.sort(function (a, b) { return (a.old - b.old) || (b.score - a.score) || (a.u - b.u); });
    return out;
  };

  /* ── фрагмент с подсветкой (= hl() прототипа): [{t, hit}] ── */
  function snippet(text, ws, limit) {
    var t = String(text || '').replace(/\s*\n\s*/g, ' '), n = norm(t), idx = -1;
    ws = ws || [];
    ws.forEach(function (w) { var i = n.indexOf(w); if (i >= 0 && (idx < 0 || i < idx)) idx = i; });
    var st = 0, en = t.length;
    if (limit) {
      st = idx < 0 ? 0 : Math.max(0, idx - 90);
      if (st > 0) { var sp = t.indexOf(' ', st); if (sp > 0 && sp < idx) st = sp + 1; }
      en = Math.min(t.length, st + limit);
      if (en < t.length) { var sp2 = t.lastIndexOf(' ', en); if (sp2 > st + 80) en = sp2; }
    }
    var piece = t.slice(st, en), pn = norm(piece), hits = [];
    ws.forEach(function (w) {
      if (!w) return;
      var i = 0;
      while ((i = pn.indexOf(w, i)) >= 0) {
        var j = i + w.length;
        while (j < pn.length && /[a-zа-я0-9]/.test(pn[j])) j++;
        hits.push([i, j]); i = j;
      }
    });
    hits.sort(function (a, b) { return a[0] - b[0]; });
    var segs = [], p = 0;
    if (st > 0) segs.push({ t: '…', hit: false });
    hits.forEach(function (h) {
      if (h[0] < p) return;
      if (h[0] > p) segs.push({ t: piece.slice(p, h[0]), hit: false });
      segs.push({ t: piece.slice(h[0], h[1]), hit: true });
      p = h[1];
    });
    if (p < piece.length) segs.push({ t: piece.slice(p), hit: false });
    if (en < t.length) segs.push({ t: '…', hit: false });
    return segs;
  }

  /* ── распознавание шифра (§9.3) ── */
  var LOCATOR = /^(?:ст|ч|прил|абз|§|пп)?[a-z]?\d/;
  function stripP(s) { return s.replace(/^п(?!реамбул)/, ''); }
  function aliasForms(doc) {
    if (doc._forms) return doc._forms;
    var set = new Set();
    [doc.prefix].concat(doc.aliases || []).forEach(function (a) {
      if (!a) return;
      var x = nc(a);
      [x, x.replace(/\/\d+$/, ''), x.replace(/-/g, ''), x.replace(/\/\d+$/, '').replace(/-/g, '')].forEach(function (f) {
        if (f.length >= 3) set.add(f);
      });
    });
    doc._forms = Array.from(set);
    return doc._forms;
  }
  function unitKeyNC(doc, i) { return stripP(nc(doc.keys[i])); }

  /* Нестрогий разбор (codeMatch прототипа): псевдоним документа без пробелов и точек в начале запроса; остаток —
     место. «фсбу4» = «ФСБУ 4/2023», «402фз» = «402-ФЗ», у закона голое число = статья, «а» → «A» (п.A4).
     Цифра псевдонима, за которой сразу цифра запроса, — только если между ними был пробел или точка
     («мса320 10» → МСА 320 + 10; «пбу19» ≠ ПБУ 1 + 9). Возвращает {sid, rest, ids, exact, locator} или null. */
  function matchCode(q, engine) {
    var qs = ncSep(q), qn = qs.s;
    if (qn.length < 3) return null;
    var best = null;
    engine.lib.order.forEach(function (doc) {
      aliasForms(doc).forEach(function (a) {
        if (qn.indexOf(a) !== 0) return;
        if (/\d$/.test(a) && /\d/.test(qn.charAt(a.length)) && !qs.sep[a.length]) return;
        if (!best || a.length > best.a.length || (a.length === best.a.length && doc.vis && !best.doc.vis)) best = { doc: doc, a: a };
      });
    });
    if (!best) return null;
    var doc = best.doc, rest = qn.slice(best.a.length).replace(/^[,;:]/, '');
    if (doc.family === 'law' && rest && /^\d/.test(rest)) rest = 'ст' + rest;
    var r = stripP(rest);
    var res = { sid: doc.sid, rest: rest, ids: [], exact: false, locator: !!r && LOCATOR.test(r) };
    if (!r) return res;
    var ex = [], sw = [], i;
    for (i = 0; i < doc.ids.length; i++) {
      var k = unitKeyNC(doc, i);
      if (k === r) ex.push(doc.ids[i]);
      else if (k.indexOf(r) === 0 && !/\d/.test(k.charAt(r.length))) sw.push(doc.ids[i]);
    }
    if (doc.family === 'law' && !ex.length) {
      for (i = 0; i < doc.ids.length; i++) if (nc(doc.keys[i]).indexOf(r + 'ч') === 0 && sw.indexOf(doc.ids[i]) < 0) sw.push(doc.ids[i]);
    }
    res.exact = ex.length > 0;
    res.ids = ex.concat(sw);
    return res;
  }

  function rangesText(engine, sid) {
    var doc = engine.doc(sid);
    if (!doc) return '';
    var num = [], A = 0, art = [], lib = engine.lib;
    doc.ids.forEach(function (id, i) {
      if (lib.depth(doc, id) !== 0) return;
      var k = doc.keys[i], m;
      if ((m = /^п\.(\d+)$/.exec(k))) num.push(+m[1]);
      else if ((m = /^п\.A(\d+)$/.exec(k))) A = Math.max(A, +m[1]);
      else if ((m = /^ст\.(\d+)$/.exec(k))) art.push(+m[1]);
    });
    if (num.length) return 'пункты ' + Math.min.apply(null, num) + '–' + Math.max.apply(null, num) + (A ? ' и A1–A' + A : '');
    if (art.length) return 'статьи ' + Math.min.apply(null, art) + '–' + Math.max.apply(null, art);
    return '';
  }
  /* 3 ближайших номера пункта (5c): [{id, url}] */
  function nearest(engine, sid, rest, n) {
    var doc = engine.doc(sid);
    if (!doc) return [];
    var r = stripP(rest || ''), wantA = /^a/.test(r), nr = parseInt(r.replace(/\D/g, ''), 10) || 0, c = [];
    doc.ids.forEach(function (id, i) {
      if (engine.lib.depth(doc, id) !== 0) return;
      var m = /^(?:п|ст)\.(A?)(\d+)$/.exec(doc.keys[i]);
      if (m) c.push({ id: id, d: Math.abs(+m[2] - nr) + ((m[1] === 'A') === wantA ? 0 : 100) });
    });
    c.sort(function (a, b) { return a.d - b.d; });
    return c.slice(0, n || 3).map(function (x) { return { id: x.id, url: engine.unitUrl(sid, x.id) }; });
  }

  function onlyAct(q, a) {
    return !String(q).slice(0, a.start).concat(String(q).slice(a.end)).replace(/[^\p{L}\p{N}]+/gu, '');
  }
  /* Распознавание запроса (§9.3): 1) строгий разбор cite-engine (правила программы); 2) нестрогий matchCode.
     {kind: 'unit'|'units'|'doc'|'missing', sid, ids, label, url, textVisible, strict, rest, ranges, nearest}
     url — куда вести по Enter/go=1 (однозначный пункт или документ); null — показать выдачу. */
  function recognize(q, engine) {
    q = String(q || '').trim();
    if (!q) return null;
    var r = engine.scanLine(q), doc;
    var found = r.cits.filter(function (c) { return c.category === 'found' && c.ids.length; });
    if (found.length) {
      var c = found[0];
      doc = engine.doc(c.sid);
      var one = found.length === 1 && c.ids.length === 1;
      return { kind: one ? 'unit' : 'units', sid: c.sid, ids: c.ids, label: c.label, strict: true,
        all: found.map(function (x) { return { sid: x.sid, ids: x.ids, label: x.label }; }),
        textVisible: !!(doc && doc.vis), url: one ? (engine.unitUrl(c.sid, c.ids[0]) || engine.docUrl(c.sid)) : null };
    }
    var miss = r.cits.find(function (x) { return x.category === 'missing_paragraph' && x.sid; });
    if (miss) {
      return { kind: 'missing', sid: miss.sid, ids: [], label: miss.label, strict: true, reason: miss.reason, note: miss.note,
        ranges: rangesText(engine, miss.sid), nearest: nearest(engine, miss.sid, miss.label.slice(miss.doc_label.length)),
        url: null };
    }
    if (!r.cits.length) {
      var acts = r.acts.filter(function (a) { return a.kind === 'lib'; });
      if (acts.length === 1 && onlyAct(q, acts[0])) {
        doc = engine.doc(acts[0].sid);
        return { kind: 'doc', sid: acts[0].sid, ids: [], label: doc.prefix, strict: true, textVisible: doc.vis,
          url: engine.docUrl(acts[0].sid) };
      }
    }
    var cm = matchCode(q, engine);
    if (!cm) return null;
    doc = engine.doc(cm.sid);
    var base = { sid: cm.sid, strict: false, rest: cm.rest, textVisible: doc.vis };
    if (!cm.rest || !cm.locator) {
      return Object.assign(base, { kind: 'doc', ids: [], label: doc.prefix, url: cm.rest ? null : engine.docUrl(cm.sid),
        restWords: cm.rest ? words(cm.rest) : [] });
    }
    if (!cm.ids.length) {
      return Object.assign(base, { kind: 'missing', ids: [], label: doc.prefix + ' ' + cm.rest, ranges: rangesText(engine, cm.sid),
        nearest: nearest(engine, cm.sid, cm.rest), url: null });
    }
    var first = cm.ids[0];
    var go = cm.ids.length === 1 || cm.exact;
    return Object.assign(base, { kind: go ? 'unit' : 'units', ids: cm.ids, label: first,
      url: go ? (engine.unitUrl(cm.sid, first) || engine.docUrl(cm.sid)) : null });
  }

  /* Сокращения (content/synonyms.json → search/syn.json): запрос целиком = сокращение. */
  function synonymsFor(q, syn) {
    var k = nc(q);
    return (syn || []).filter(function (s) { return s.key.indexOf(k) >= 0; });
  }
  /* Код показателя («3201») → находки с этим кодом (findings.json). */
  function findingsFor(q, findings) {
    var k = String(q || '').trim();
    if (!/^\d{4}$/.test(k)) return [];
    return (findings || []).filter(function (f) { return (f.codes || []).indexOf(k) >= 0; });
  }
  /* Документы по шифру и названию (docs.json): шифр — начало NC; слова — все основы в названии. */
  function docHits(q, docs, ws) {
    var qn = nc(q), out = [];
    ws = ws || words(q);
    (docs || []).forEach(function (d, i) {
      var s = nc(d.short);
      if (qn.length >= 3 && (s.indexOf(qn) === 0 || (s.length >= 4 && qn.indexOf(s) === 0))) { out.push(i); return; }
      if (ws.length) {
        var t = norm((d.short || '') + ' ' + (d.title || '') + ' ' + (d.name || ''));
        for (var j = 0; j < ws.length; j++) if (t.indexOf(ws[j]) < 0) return;
        out.push(i);
      }
    });
    return out;
  }

  /* ── загрузка данных и выполнение запроса ── */
  function getJSON(url) {
    if (typeof window !== 'undefined' && window.Yasn && window.Yasn.getJSON) return window.Yasn.getJSON(url);
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ': ' + r.status); return r.json(); });
  }
  function getBuf(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ': ' + r.status); return r.arrayBuffer(); }); }

  function Data(parts, base) {
    this.base = base;
    this.units = parts.units;      // units.json
    this.docs = parts.docs;        // docs.json
    this.index = new Index(parts.dict, parts.post, parts.units);
    this.heads = parts.heads || {};
    this.syn = parts.syn || [];
    this.findings = parts.findings || [];
    this.stages = parts.stages || [];
    this.engine = parts.engine;
    this._chunks = {};
  }
  Data.prototype.row = function (u) { var r = this.units.rows[u]; return { u: u, doc: r[0], key: r[1], path: r[2], chunk: r[3], flags: r[4] }; };
  Data.prototype.url = function (u) { var r = this.units.rows[u]; return this.base + this.docs[r[0]].slug + '/' + r[2]; };
  Data.prototype.heading = function (u) { return this.heads[String(u)] || ''; };
  Data.prototype.chunk = function (n) {
    var key = 'c' + ('00' + n).slice(-3);
    if (!this._chunks[key]) this._chunks[key] = getJSON(this.base + 'assets/data/text/' + key + '.json');
    return this._chunks[key];
  };
  Data.prototype.text = function (u) { var r = this.units.rows[u]; return this.chunk(r[3]).then(function (c) { return c[String(u)] || ''; }); };
  /* Текст пункта-страницы с якорями, которых нет в тексте пункта (как в индексе). */
  Data.prototype.pageText = function (u) {
    var rows = this.units.rows, pageBit = this.units.flags.page, self = this, idx = [u];
    for (var j = u + 1; j < rows.length && rows[j][0] === rows[u][0] && !(rows[j][4] & pageBit); j++) idx.push(j);
    return Promise.all(idx.map(function (i) { return self.text(i); })).then(function (ts) {
      var base = norm(ts[0]), extra = ts.slice(1).map(function (t) { return t.trim(); }).filter(function (t) { return t && base.indexOf(norm(t)) < 0; });
      return [ts[0]].concat(extra).join('\n');
    });
  };
  /* Запрос целиком (без интерфейса). opts.mainBonus — тумблер «Только основные нормы» (бонус, не фильтр, §16 В-14).
     → {q, words, code, syn, findings, units: [{u, score, old, exact}], docs: [индексы docs.json]} */
  Data.prototype.run = function (q, opts) {
    q = String(q || '').trim();
    var ws = words(q), res = { q: q, words: ws, code: null, syn: [], findings: [], units: [], docs: [] };
    if (!q) return res;
    var code = this.engine ? recognize(q, this.engine) : null, self = this;
    res.code = code;
    res.syn = synonymsFor(q, this.syn);
    res.findings = findingsFor(q, this.findings);
    if (code && code.kind === 'missing') return res;
    var seen = new Set();
    if (code && (code.kind === 'unit' || code.kind === 'units')) {
      var did = this.docIndex(code.sid);
      var lst = code.all ? [].concat.apply([], code.all.map(function (a) { return a.ids; })) : code.ids;
      lst.slice(0, 30).forEach(function (id) {
        var u = self.rowOf(did, id);
        if (u !== null && !seen.has(u)) { seen.add(u); res.units.push({ u: u, score: Infinity, old: false, exact: true }); }
      });
      return res;
    }
    if (code && code.kind === 'doc') {
      var di = this.docIndex(code.sid);
      if (di >= 0) res.docs.push(di);
      if (code.restWords && code.restWords.length) {
        res.units = this.index.query(code.restWords, opts).filter(function (x) { return self.units.rows[x.u][0] === di; });
      }
      return res;
    }
    if (ws.length || res.syn.length) {
      var lists = [];
      if (res.syn.length) {
        res.syn.forEach(function (s) { lists.push(self.index.query(s.words, opts)); });
        var tok = tokens(q);
        /* сокращение целиком одним словом («ВКД», «ЛОКУ») — ещё и как слово текста; «ПОД/ФТ» — нет: «под» — предлог */
        if (tok.length === 1 && tok[0] === nc(q)) lists.push(this.index.query([tok[0]], Object.assign({}, opts, { exact: true })));
      } else {
        lists.push(this.index.query(ws, opts));
      }
      var best = new Map();
      lists.forEach(function (l) { l.forEach(function (x) { var c = best.get(x.u); if (!c || x.score > c.score) best.set(x.u, x); }); });
      res.units = Array.from(best.values());
      /* Строитель 2 (умолчание, PO может переиграть): пункты документа, в названии которого есть все слова запроса
         («существенность» → МСА 320 «Существенность при планировании…»), +TITLE_BONUS — иначе на всей библиотеке
         по формуле README сверху оказываются пункты других стандартов с тем же словом в заголовке раздела. */
      if (ws.length && (!opts || opts.titleBonus !== false)) {
        var titled = {};
        this.docs.forEach(function (d, i) {
          var t = norm(d.title || '');
          if (ws.every(function (w) { return t.indexOf(w) >= 0; })) titled[i] = 1;
        });
        res.units = res.units.map(function (x) {
          return titled[self.units.rows[x.u][0]] ? Object.assign({}, x, { score: x.score + TITLE_BONUS }) : x;
        });
      }
      res.units.sort(function (a, b) { return (a.old - b.old) || (b.score - a.score) || (a.u - b.u); });
    }
    if (res.findings.length) { // код показателя: пункт с находкой — первой карточкой (§9.3 п.5)
      var lead = [];
      res.findings.forEach(function (f) {
        var u = self.rowOf(self.docIndex(f.doc_id), f.unit_id);
        if (u !== null && lead.indexOf(u) < 0) lead.push(u);
      });
      var rest = res.units.filter(function (x) { return lead.indexOf(x.u) < 0; });
      res.units = lead.map(function (u) { return { u: u, score: Infinity, old: false, finding: true }; }).concat(rest);
    }
    /* у сокращения документы ищем по словам расшифровки (слова самого сокращения — «под», «фт» — дают шум) */
    var dws = res.syn.length ? [].concat.apply([], res.syn.map(function (s) { return s.words; })) : ws;
    docHits(res.syn.length ? '' : q, this.docs, dws).forEach(function (i) { if (res.docs.indexOf(i) < 0) res.docs.push(i); });
    /* PO 12.10: голое число («315», «402») — номер стандарта или закона; документ с этим номером — первой карточкой,
       ниже — пункты, где число встречается. Enter не уводит сразу: число может быть и просто словом поиска. */
    if (!res.code && NUM_ONLY.test(q)) {
      var num = [];
      this.docs.forEach(function (d, i) {
        var m = NUM_DOC.exec(d.short || '');
        if (m && (m[1] || m[2] || m[3]) === q) num.push(i);
      });
      /* действующие выше вступающих позже, утратившие — последними; при равенстве — порядок каталога */
      var self = this, rk = function (i) { var st = self.docs[i].st; var r = st && NUM_ST[st.cls]; return r === undefined ? 1 : r; };
      num.sort(function (a, b) { return rk(a) - rk(b) || a - b; });
      if (num.length) {
        var d0 = this.docs[num[0]];
        res.docs = num.concat(res.docs.filter(function (i) { return num.indexOf(i) < 0; }));
        res.code = { kind: 'doc', sid: d0.id, ids: [], label: d0.short, strict: false, url: null, numberOnly: true };
      }
    }
    return res;
  };
  Data.prototype.docIndex = function (sid) {
    if (!this._docIdx) { var m = new Map(); this.docs.forEach(function (d, i) { m.set(d.id, i); }); this._docIdx = m; }
    return this._docIdx.has(sid) ? this._docIdx.get(sid) : -1;
  };
  Data.prototype.rowOf = function (docIdx, uid) {
    if (docIdx < 0) return null;
    var d = this.docs[docIdx];
    if (!d || !d.u) return null;
    var key = unitRest(uid, d.short);
    for (var u = d.u[0]; u < d.u[1]; u++) if (this.units.rows[u][1] === key || this.units.rows[u][1] === uid) return u;
    return null;
  };

  var loading = null;
  /* Загрузка всего для поиска (один раз за страницу); base — корень сайта («/»). Cite — window.YasnCite. */
  function load(base, Cite) {
    if (!loading) {
      base = base || '/';
      Cite = Cite || (typeof window !== 'undefined' ? window.YasnCite : null);
      var D = base + 'assets/data/';
      loading = Promise.all([
        getJSON(D + 'units.json'), getJSON(D + 'docs.json'), getJSON(D + 'search/dict.json'), getBuf(D + 'search/post.bin'),
        getJSON(D + 'search/heads.json'), getJSON(D + 'search/syn.json'), getJSON(D + 'findings.json'), getJSON(D + 'stages.json'),
        Cite ? Cite.load(base) : Promise.resolve(null)
      ]).then(function (r) {
        return new Data({ units: r[0], docs: r[1], dict: r[2], post: r[3], heads: r[4], syn: r[5], findings: r[6], stages: r[7], engine: r[8] }, base);
      });
    }
    return loading;
  }

  return {
    norm: norm, tokens: tokens, stem: stem, words: words, nc: nc,
    translit: translit, slugify: slugify, unitRest: unitRest, unitSlug: unitSlug, docSlugCandidate: docSlugCandidate,
    sha1Hex: sha1Hex, Index: Index, FLAGS: F, OCC_CAP: OCC_CAP, snippet: snippet, matchCode: matchCode, recognize: recognize,
    rangesText: rangesText, nearest: nearest, synonymsFor: synonymsFor, findingsFor: findingsFor, docHits: docHits,
    Data: Data, load: load
  };
});
