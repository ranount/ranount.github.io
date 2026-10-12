/* «Ясность. Нормы» — разбор ссылок на нормы в браузере (PLAN §6.3). Порт check_citations.py (разбор ссылок программы «Ясность»).
   Без интерфейса: страницы «Проверь ссылки» и поиска вызывают YasnCite.create(rules, lib) / YasnCite.load(base).

   Регулярки не написаны здесь руками: они приходят из assets/data/cite/rules.json, который сборка
   (norms_site/build/cite_export.py) переводит из скомпилированных шаблонов check_citations. Здесь — только алгоритм;
   у каждой функции пометка «= check_citations.py:<функция>». Совпадение с Python проверяет
   tests/norms_site/test_cite_parity.py (корпус ~20 тыс. строк, 100 %).

   ALGO_SHA — sha256 исходников перенесённых функций Python (cite_export.algo_sha()). Если check_citations.py
   поменяли, а этот файл нет — тест test_cite_parity::test_algo_sha краснеет: перенесите изменения и обновите константу.

   Позиции (start/end) — индексы JS-строки (UTF-16), как у String.prototype.slice. Текст никуда не отправляется. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YasnCite = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ALGO_SHA = '2efb21e3e261bb7d494bb8b4f46f23542958249bd5017ee345692677c77a6243';

  var FOUND = 'found', MISSING_PARAGRAPH = 'missing_paragraph', MISSING_DOCUMENT = 'missing_document',
    UNPARSED = 'unparsed';

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  /* ── утилиты Python-семантики ── */
  function cpLen(s) { var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); if (c < 0xD800 || c > 0xDBFF) n++; } return n; }
  function cpSlice(s, start, n) { // s[start:start+n] по кодовым точкам; start — индекс UTF-16
    var i = start, k = 0;
    while (i < s.length && k < n) { var c = s.charCodeAt(i); i += (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) ? 2 : 1; k++; }
    return s.slice(start, i);
  }
  function lastCp(s) { if (!s) return ''; var a = Array.from(s); return a[a.length - 1]; }
  function firstCp(s) { if (!s) return ''; return String.fromCodePoint(s.codePointAt(0)); }
  var RX_ALPHA = /^\p{L}+$/u, RX_DIGIT = /^\p{Nd}+$/u;
  function isAlpha(s) { return RX_ALPHA.test(s); }
  function isDigit(s) { return RX_DIGIT.test(s); }
  function toInt(s) { return parseInt(s, 10); }
  function translate(s, table) { var out = ''; for (var ch of s) out += hasOwn(table, ch) ? table[ch] : ch; return out; }
  function arrEq(a, b) { if (a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
  function escRe(s) { return s.replace(/[\^$\\.*+?()[\]{}|\/]/g, '\\$&'); }
  function stableSort(arr, key) { // sorted(arr, key=…) — устойчиво; key возвращает число или массив чисел
    return arr.map(function (x, i) { return [key(x), i, x]; }).sort(function (a, b) {
      var ka = a[0], kb = b[0];
      if (Array.isArray(ka)) { for (var j = 0; j < ka.length; j++) { if (ka[j] < kb[j]) return -1; if (ka[j] > kb[j]) return 1; } }
      else { if (ka < kb) return -1; if (ka > kb) return 1; }
      return a[1] - b[1];
    }).map(function (t) { return t[2]; });
  }

  /* ── правила из rules.json ── */
  function Rules(r) {
    if (!r || r.v !== 1) throw new Error('cite/rules.json: неизвестная версия');
    this.sha = r.sha;
    this.T = r.tables;
    var mk = function (d, extra) { return new RegExp(d.src, d.flags + (extra || '')); };
    this.mk = mk;
    this.act = r.act_rx.map(function (d) {
      return { kind: d.kind, g: mk(d, 'g'), pre: r.prefilter[d.kind] ? mk(r.prefilter[d.kind]) : null };
    });
    var rx = {}, k;
    for (k in r.rx) rx[k] = { y: mk(r.rx[k], 'y'), g: mk(r.rx[k], 'g'), s: mk(r.rx[k]) };
    rx.IMPLICIT_ISA.gd = mk(r.rx.IMPLICIT_ISA, 'gd');
    this.rx = rx;
    var inl = {};
    for (k in r.inline) inl[k] = { y: mk(r.inline[k], 'y'), g: mk(r.inline[k], 'g'), s: mk(r.inline[k]), src: r.inline[k].src };
    this.inl = inl;
    this.named = r.named_laws.map(function (d) { return { target: d.target, y: mk(d, 'y') }; });
    this.extra = r.site_extra && r.site_extra.is_msg ? mk(r.site_extra.is_msg, 'g') : null;
    this.space = new RegExp('^' + r.tables.PY_SPACE + '+|' + r.tables.PY_SPACE + '+$', 'gu');
  }
  Rules.prototype.at = function (re, s, pos) { re.lastIndex = pos || 0; return re.exec(s); }; // re.match(s, pos)
  Rules.prototype.findall1 = function (re, s) { // re.findall с одной группой
    var out = [], m; re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) { out.push(m[1]); if (m[0] === '') re.lastIndex += 1; }
    return out;
  };
  Rules.prototype.iter = function (re, s) { // re.finditer
    var out = [], m; re.lastIndex = 0;
    while ((m = re.exec(s)) !== null) {
      out.push(m);
      if (m[0] === '') re.lastIndex = m.index + (s.codePointAt(m.index) > 0xFFFF ? 2 : 1);
    }
    return out;
  };
  Rules.prototype.strip = function (s) { return s.replace(this.space, ''); }; // str.strip()
  Rules.prototype.sub = function (name, s, rep) { return s.replace(this.inl[name].g, rep); };

  /* ── библиотека = check_citations.py:Library ── */
  function Lib(data, R) {
    if (!data || data.v !== 1) throw new Error('cite/lib.json: неизвестная версия');
    this.R = R;
    this.docs = {};
    this.order = [];
    this.byLabel = new Map();
    this.alias = new Map(Object.entries(data.alias || {}));
    this.orderDocs = data.order_docs || {};
    this.base = data.base || '/';
    var self = this;
    data.docs.forEach(function (d) {
      var pre = d.prefix ? d.prefix + ' ' : '';
      var abs = new Set(d.abs || []);
      var ids = d.u.map(function (r, i) { return pre && !abs.has(i) ? pre + r : r; });
      var idx = new Map();
      ids.forEach(function (id, i) { idx.set(id, i); });
      var doc = {
        sid: d.sid, title: d.title || '', kind: d.kind, family: d.family, prefix: d.prefix, status: d.status,
        aliases: d.aliases || [], edition_date: d.ed || '', edDate: d.edDate || '', partial: !!d.partial,
        title_date: d.td || '', number: d.num || '', slug: d.slug, vis: !!d.vis, built: !!d.b,
        st: { cls: d.st[0], label: d.st[1], date: d.st[2] },
        ids: ids, idx: idx, dch: d.d, keys: d.u,
        repealed: new Set((d.rep || []).map(function (i) { return ids[i]; })),
        implicit_articles: new Set(d.impl || []),
        forms: d.forms || [], formSet: new Set(d.forms || []),
        subs: d.subs || {}
      };
      self.docs[doc.sid] = doc;
      self.order.push(doc);
      [doc.prefix].concat(doc.aliases).forEach(function (label) {
        if (label && !self.byLabel.has(label)) self.byLabel.set(label, doc.sid);
      });
    });
  }
  Lib.prototype.has = function (doc, uid) { // = check_citations.py:Library.has
    if (doc.idx.has(uid)) return uid;
    var real = this.alias.get(uid);
    if (real && doc.idx.has(real)) return real;
    return null;
  };
  Lib.prototype.depth = function (doc, uid) { // doc.depth.get(uid, 0)
    var i = doc.idx.get(uid);
    if (i === undefined) return 0;
    var c = doc.dch.charCodeAt(i);
    return c >= 65 ? c - 65 : c - 48;
  };
  Lib.prototype.isPage = function (doc, i) { return doc.dch.charCodeAt(i) >= 65; };
  Lib.prototype.subTokens = function (doc, uid) { // токены «(x)» текста единицы (для _sub_check)
    var i = doc.idx.get(uid);
    var s = i === undefined ? '' : doc.subs[String(i)];
    return new Set(s ? s.split(' ') : []);
  };

  /* ── акты = check_citations.py:Act, ActFinder ── */
  function Act(start, end, kind, sid, label, family, raw) {
    this.start = start; this.end = end; this.kind = kind; this.sid = sid || ''; this.label = label || '';
    this.family = family || ''; this.raw = raw || '';
  }
  function mEnd(m) { return m.index + m[0].length; }

  function normDate(R, s) { // = check_citations.py:_norm_date
    if (!s) return '';
    s = R.sub('norm_date_tail', R.strip(s), '');
    var m = R.at(R.inl.norm_date_dots.y, s, 0), d, mo, y;
    if (m) { d = m[1]; mo = m[2]; y = m[3]; }
    else {
      m = R.at(R.inl.norm_date_words.y, s, 0);
      if (!m || !hasOwn(R.T.MONTH_NUM, m[2])) return '';
      d = m[1]; y = m[3]; mo = String(R.T.MONTH_NUM[m[2]]);
    }
    if (cpLen(y) === 2) y = (toInt(y) < 50 ? '20' : '19') + y;
    return String(toInt(d)).padStart(2, '0') + '.' + String(toInt(mo)).padStart(2, '0') + '.' + y;
  }

  function Finder(lib) { this.lib = lib; this.R = lib.R; }
  Finder.prototype._lib = function (sid, m, rawLabel) { // = ActFinder._lib
    var doc = this.lib.docs[sid];
    if (!doc) throw new Error('cite: нет документа ' + sid);
    return new Act(m.index, mEnd(m), 'lib', sid, doc.prefix || rawLabel, doc.family, m[0]);
  };
  Finder.prototype._label = function (label, m, family) { // = ActFinder._label
    var fix = hasOwn(this.R.T.LABEL_FIX, label) ? this.R.T.LABEL_FIX[label] : label;
    var sid = this.lib.byLabel.get(fix);
    if (sid) return this._lib(sid, m, label);
    return new Act(m.index, mEnd(m), 'external', '', label, family, m[0]);
  };
  Finder.prototype._law = function (n, m, date, title) { // = ActFinder._law
    date = date || ''; title = title || '';
    var R = this.R, lib = this.lib;
    var label = n.indexOf('-') < 0 ? n + '-ФЗ' : n;
    var nd = normDate(R, date);
    if (title) {
      for (var i = 0; i < R.named.length; i++) {
        var nl = R.named[i];
        if (R.at(nl.y, title, 0)) {
          if (nl.target.charAt(0) === '!') return new Act(m.index, mEnd(m), 'external', '', nl.target.slice(1), 'law', m[0]);
          var tdoc = lib.docs[nl.target];
          if (tdoc && tdoc.number === label && (!nd || !tdoc.title_date || tdoc.title_date === nd)) return this._lib(nl.target, m, label);
          if (nl.target !== lib.byLabel.get(label)) return new Act(m.index, mEnd(m), 'external', '', label + ' «' + title + '»', 'law', m[0]);
          break;
        }
      }
    }
    var sid = lib.byLabel.get(label);
    if (nd) {
      var same = lib.order.filter(function (d) { return d.number === label && d.title_date === nd; });
      if (same.length === 1) return this._lib(same[0].sid, m, label);
    }
    if (sid && date) {
      var td = lib.docs[sid].title_date;
      if (td && normDate(R, date) && normDate(R, date) !== td) {
        return new Act(m.index, mEnd(m), 'external', '', label + ' от ' + normDate(R, date), 'law', m[0]);
      }
    }
    if (sid) return this._lib(sid, m, label);
    return new Act(m.index, mEnd(m), 'external', '', label, 'law', m[0]);
  };
  Finder.prototype._make = function (kind, m) { // = ActFinder._make
    var R = this.R, lib = this.lib, g = m.groups || {}, i, s;
    if (kind === 'isa') return this._label(R.T.ISA_KIND[g.k] + ' ' + toInt(g.n), m, 'isa');
    if (kind === 'ifrs') {
      var k = g.k || g.k2 || 'МСФО';
      var lab = (k === 'IAS' || k === 'IFRS') ? 'МСФО (' + k + ') ' + g.n : 'МСФО ' + g.n;
      return new Act(m.index, mEnd(m), 'external', '', lab, 'isa', m[0]);
    }
    if (kind === 'psad') return new Act(m.index, mEnd(m), 'external', '', R.sub('spaces', m[0], ' '), 'isa', m[0]);
    if (kind === 'fsbu') return this._label(g.k + ' ' + toInt(g.n) + '/' + g.y, m, 'std');
    if (kind === 'law_num') return this._law(g.n, m, g.d1 || g.d2 || '', R.strip(g.t || ''));
    if (kind === 'law_num2' || kind === 'law_ru') return this._law(g.n, m);
    if (kind === 'law_named' || kind === 'law_quoted') {
      var title = R.strip(g.t);
      for (i = 0; i < R.named.length; i++) {
        var nl = R.named[i];
        if (R.at(nl.y, title, 0)) {
          if (nl.target.charAt(0) === '!' || !hasOwn(lib.docs, nl.target)) {
            return new Act(m.index, mEnd(m), 'external', '', nl.target.charAt(0) === '!' ? nl.target.replace(/^!+/, '')
              : 'закон «' + title + '»', 'law', m[0]);
          }
          return this._lib(nl.target, m, title);
        }
      }
      return new Act(m.index, mEnd(m), 'external', '', 'закон «' + title + '»', 'law', m[0]);
    }
    if (kind === 'code') {
      var codes = [['nk', 'tax_nk'], ['gk', 'law_gk'], ['tk', 'law_tk'], ['koap', 'law_koap']];
      for (i = 0; i < codes.length; i++) if (g[codes[i][0]]) return this._lib(codes[i][1], m, codes[i][0]);
      return new Act(m.index, mEnd(m), 'external', '', R.sub('spaces', g.ext, ' '), 'law', m[0]);
    }
    if (kind === 'order' || kind === 'order_bare') {
      var n = g.n;
      var osid = hasOwn(R.T.ORDER_DOCS, n) ? R.T.ORDER_DOCS[n] : null;
      if (osid) return this._lib(osid, m, n + 'н');
      if (hasOwn(lib.orderDocs, n) && lib.orderDocs[n].length) {
        var act = this._lib(lib.orderDocs[n][0], m, n + 'н');
        act.family = 'order'; act.label = 'Приказ Минфина ' + n + 'н';
        return act;
      }
      return new Act(m.index, mEnd(m), 'external', '', 'Приказ Минфина ' + n + 'н', 'order', m[0]);
    }
    if (kind === 'ethics') return this._lib('ethics_code_2025', m, 'Кодекс этики');
    if (kind === 'independence') {
      if (hasOwn(lib.docs, 'independence_rules_2025')) return this._lib('independence_rules_2025', m, 'Правила независимости');
      return new Act(m.index, mEnd(m), 'external', '', 'Правила независимости', 'ethics', m[0]);
    }
    if (kind === 'forms') return this._lib('forms_sroaas_10_2026', m, 'Сборник форм АЗ');
    if (kind === 'other_ext') {
      s = R.sub('num_sign', R.strip(R.sub('spaces', m[0], ' ')), '№ ');
      var heads = { 'Постановлени': 'Постановление', 'Пленум': 'Пленум', 'Классификатор': 'Классификатор',
        'Письм': 'Письмо', 'Указани': 'Указание', 'Положени': 'Положение', 'Инструкци': 'Инструкция' };
      s = s.replace(R.inl.other_head.g, function (_x, g1) { return heads[g1]; });
      return new Act(m.index, mEnd(m), 'external', '', cpSlice(s, 0, 90), 'std', m[0]);
    }
    if (kind === 'pz') {
      var pl = 'ПЗ-' + toInt(g.n) + '/' + g.y;
      return lib.byLabel.has(pl) ? this._label(pl, m, 'std') : null;
    }
    if (kind === 'generic') return new Act(m.index, mEnd(m), 'generic', '', R.sub('spaces', m[0], ' '), 'law', m[0]);
    return null;
  };
  Finder.prototype.find = function (line) { // = ActFinder.find
    var R = this.R, lib = this.lib, cands = [], self = this;
    R.act.forEach(function (a, prio) {
      if (a.pre && !a.pre.test(line)) return;
      R.iter(a.g, line).forEach(function (m) {
        if (m[0].length > 0) cands.push([m.index, -m[0].length, prio, a.kind, m]);
      });
    });
    cands = stableSort(cands, function (c) { return [c[0], c[1], c[2]]; });
    var acts = [], lastEnd = -1;
    cands.forEach(function (c) {
      if (c[0] < lastEnd) return;
      var m = c[4], act = self._make(c[3], m);
      if (act && act.kind === 'external' && lib.byLabel.has(act.label)) act = self._lib(lib.byLabel.get(act.label), m, act.label);
      if (act) { acts.push(act); lastEnd = mEnd(m); }
    });
    return this._implicitIsa(line, acts);
  };
  Finder.prototype._implicitIsa = function (line, acts) { // = ActFinder._implicit_isa
    if (!acts.some(function (a) { return a.family === 'isa'; })) return acts;
    var lib = this.lib, extra = [];
    this.R.iter(this.R.rx.IMPLICIT_ISA.gd, line).forEach(function (m) {
      var n = m.groups.n, ns = m.indices.groups.n[0], ne = m.indices.groups.n[1];
      var sid = lib.byLabel.get('МСА ' + n);
      if (!sid || acts.some(function (a) { return a.start <= ns && ns < a.end; })) return;
      var left = acts.concat(extra).filter(function (a) { return a.end <= ns; });
      if (!left.length) return;
      var best = left[0];
      for (var i = 1; i < left.length; i++) if (left[i].end > best.end) best = left[i];
      if (best.family !== 'isa') return;
      extra.push(new Act(ns, ne, 'lib', sid, 'МСА ' + n, 'isa', n));
    });
    return extra.length ? stableSort(acts.concat(extra), function (a) { return a.start; }) : acts;
  };
  Finder.prototype.siteExtra = function (line, acts) { // = cite_export.py:site_extra_acts (расширение сайта)
    var R = this.R, lib = this.lib, extra = [];
    if (!R.extra) return acts;
    R.iter(R.extra, line).forEach(function (m) {
      var s = m.index, e = mEnd(m);
      if (acts.some(function (a) { return a.start < e && s < a.end; })) return;
      var k = m.groups.k === 'аудит' ? 'аудит' : 'учет';
      var label = 'ИС-' + k + '-' + toInt(m.groups.n);
      var sid = lib.byLabel.get(label);
      if (sid) { var doc = lib.docs[sid]; extra.push(new Act(s, e, 'lib', sid, doc.prefix || label, doc.family, m[0])); }
    });
    return extra.length ? stableSort(acts.concat(extra), function (a) { return a.start; }) : acts;
  };

  /* ── места = check_citations.py:Item, Seg, Frag, _parse_* ── */
  function Item(num, subs, to, subTo) { this.num = num; this.subs = subs || []; this.to = to || null; this.sub_to = subTo || []; }
  function Seg(level, items) { this.level = level; this.items = items; }
  function Frag(start, end, segs, bad) { this.start = start; this.end = end; this.segs = segs; this.bad = !!bad; }

  function kwLevel(R, kw) { // = check_citations.py:_kw_level
    var k = R.strip(kw).toLowerCase().replace(/\.+$/, '');
    if (R.at(R.inl.kw_pp.y, k, 0)) return 'пп';
    var stems = ['подпункт', 'приложени', 'стать', 'част', 'пункт', 'абзац', 'счет', 'счёт', 'форм'];
    for (var i = 0; i < stems.length; i++) if (k.indexOf(stems[i]) === 0) return R.T.KW_LEVEL[stems[i]];
    return hasOwn(R.T.KW_LEVEL, k) ? R.T.KW_LEVEL[k] : k;
  }
  function cleanNum(R, n) { // = check_citations.py:_clean_num
    n = R.sub('spaces', n, '');
    var m = R.at(R.inl.clean_letter.y, n, 0);
    if (m) n = translate(m[1], { 'А': 'A', 'В': 'B' }) + n.slice(m[0].length);
    return n;
  }
  function splitSubs(subs) { // = check_citations.py:_split_subs
    if (subs.length < 2 || !subs.every(function (s) { return cpLen(s) === 1 && isAlpha(s); })) return [subs];
    if (subs.slice(1).every(function (s) { return 'ivx'.indexOf(s) >= 0; }) && 'ivx'.indexOf(subs[0]) < 0) return [subs];
    return subs.map(function (s) { return [s]; });
  }
  function parseNum(R, line, pos) { // = check_citations.py:_parse_num
    var m = R.at(R.rx.NUM_RX.y, line, pos);
    if (!m) return [null, pos];
    var item = new Item(cleanNum(R, m.groups.n), R.findall1(R.rx.SUBS_RX.g, m.groups.subs || ''));
    var end = mEnd(m);
    var sr = R.at(R.rx.SUBRANGE_RX.y, line, end);
    if (sr && item.subs.length) { item.sub_to = R.findall1(R.rx.SUBS_RX.g, sr.groups.subs); end = mEnd(sr); }
    return [item, end];
  }
  function numValue(R, n) { // = check_citations.py:_num_value
    var m = R.at(R.inl.num_value.y, n, 0);
    if (!m) return null;
    return parseFloat(m[1] + '.' + (m[2] || '0'));
  }
  function parseItems(R, line, pos, stops) { // = check_citations.py:_parse_items
    if (stops.has(pos)) return [[], pos];
    var r = parseNum(R, line, pos), first = r[0], end = r[1];
    if (first === null || R.at(R.rx.BAD_AFTER_NUM.y, line, end)) return [[], pos];
    var items = [first];
    for (;;) {
      var sm = R.at(R.rx.LIST_SEP_RX.y, line, end);
      if (!sm || stops.has(mEnd(sm))) break;
      var r2 = parseNum(R, line, mEnd(sm)), nxt = r2[0], nend = r2[1];
      if (nxt === null || R.at(R.rx.BAD_AFTER_NUM.y, line, nend) || cpLen(R.sub('non_digit', nxt.num, '')) > 4) break;
      if (R.at(R.inl.act_after_num.y, cpSlice(line, nend, 6), 0)) break;
      var sep = sm.groups.sep;
      if (sep === '–' || sep === '—' || sep === '-') {
        var prev = items[items.length - 1];
        if (prev.to !== null || prev.sub_to.length || nxt.subs.length) break;
        if (firstCp(prev.num) === 'A' && firstCp(nxt.num) !== 'A' && sm[0] === sep) nxt = new Item('A' + nxt.num);
        var a = numValue(R, prev.num), b = numValue(R, nxt.num);
        if ((firstCp(prev.num) === 'A') !== (firstCp(nxt.num) === 'A') || a === null || b === null || !(a < b && b <= a + 200)) break;
        prev.to = nxt;
      } else {
        items.push(nxt);
      }
      end = nend;
    }
    return [items, end];
  }
  function urank(R, lv) { return hasOwn(R.T.URANK, lv) ? R.T.URANK[lv] : 9; }
  function splitFrag(R, frag) { // = check_citations.py:_split_frag
    for (var i = 0; i < frag.segs.length; i++) {
      var seg = frag.segs[i];
      var deeper = frag.segs.slice(i + 1).some(function (s) { return urank(R, s.level) > urank(R, seg.level); });
      if (seg.items.length > 1 && deeper) {
        var headSegs = frag.segs.slice(0, i);
        var head = seg.items.slice(0, -1).map(function (it) { return new Frag(frag.start, frag.end, headSegs.concat([new Seg(seg.level, [it])])); });
        var tail = new Frag(frag.start, frag.end, headSegs.concat([new Seg(seg.level, [seg.items[seg.items.length - 1]])], frag.segs.slice(i + 1)));
        return head.concat(splitFrag(R, tail));
      }
    }
    return [frag];
  }
  function parseFrags(R, line, acts) { // = check_citations.py:_parse_frags
    var spans = acts.map(function (a) { return [a.start, a.end]; });
    var stops = new Set(acts.map(function (a) { return a.start; }));
    var inAct = function (p) { return spans.some(function (s) { return s[0] <= p && p < s[1]; }); };
    var frags = [], cursor = 0;
    R.iter(R.rx.KW_RX.g, line).forEach(function (km) {
      if (km.index < cursor || inAct(km.index)) return;
      var segs = [], m = km, pos = km.index, bad = false;
      while (m !== null) {
        var level = kwLevel(R, m.groups.kw);
        if (segs.some(function (s) { return s.level === level; })) break;
        var r = parseItems(R, line, mEnd(m), stops), items = r[0], end = r[1];
        if (!items.length) { bad = !segs.length && !!R.at(R.rx.STRONG_KW.y, R.strip(m.groups.kw), 0); break; }
        segs.push(new Seg(level, items));
        pos = end;
        var ws = R.at(R.inl.ws_run.y, line, pos);
        var nxt = R.at(R.rx.KW_RX.y, line, pos + (ws ? ws[0].length : 0));
        m = nxt && !inAct(nxt.index) ? nxt : null;
      }
      if (segs.length) {
        if (segs.length === 1 && segs[0].level === 'прил' && R.at(R.inl.app_to_order.y, line, pos)) { cursor = pos; return; }
        Array.prototype.push.apply(frags, splitFrag(R, new Frag(km.index, pos, segs)));
        cursor = pos;
      } else if (bad) {
        frags.push(new Frag(km.index, mEnd(km), [], true));
      }
    });
    acts.forEach(function (a) {
      if (a.family !== 'isa') return;
      var bm = R.at(R.inl.isa_bare_a.y, line, a.end);
      if (bm) {
        var r = parseItems(R, line, mEnd(bm), stops);
        if (r[0].length && r[0].every(function (i) { return i.num.indexOf('A') === 0; })) frags.push(new Frag(mEnd(bm), r[1], [new Seg('п', r[0])]));
      }
    });
    return stableSort(frags, function (f) { return f.start; });
  }

  /* ── ссылки = check_citations.py:Citation, Scanner ── */
  function Citation(label, category, reason, sid, docLabel) {
    this.label = label; this.category = category; this.reason = reason || ''; this.ids = []; this.sid = sid || '';
    this.doc_label = docLabel || ''; this.note = ''; this.repealed = false;
  }
  function ethNum(R, n) { return !!R.at(R.rx.ETHICS_NUM.y, n.replace(/T/g, 'Т').replace(/P/g, 'П'), 0); }
  function compatible(R, act, frag, dottedOk) { // = check_citations.py:_compatible
    if (frag.bad || !frag.segs.length) return false;
    var fam = act.family || 'law';
    var allowed = hasOwn(R.T.ALLOWED, fam) ? R.T.ALLOWED[fam] : [];
    if (!frag.segs.every(function (s) { return allowed.indexOf(s.level) >= 0; })) return false;
    var nums = [];
    frag.segs.forEach(function (s) { s.items.forEach(function (i) { nums.push(i.num); }); });
    var hasA = nums.some(function (n) { var c = firstCp(n); return c === 'A' || c === 'А' || c === 'B'; });
    var hasEth = nums.some(function (n) { return ethNum(R, n); });
    if ((fam === 'law' || fam === 'std' || fam === 'order' || fam === 'forms') && (hasA || hasEth)) return false;
    if (fam === 'isa' && (hasEth || (!dottedOk && !nums.every(function (n) { return !!R.at(R.inl.isa_num.y, n, 0); })))) return false;
    if (fam === 'ethics') return hasEth;
    if (fam === 'forms') return nums.every(function (n) { return !!R.at(R.inl.forms_num.y, n, 0); });
    return true;
  }
  function levelsOf(act, frag) { // = check_citations.py:_levels_of
    var fam = act.family || 'law';
    var hasP = frag.segs.some(function (s) { return s.level === 'п'; });
    var hasSt = frag.segs.some(function (s) { return s.level === 'ст'; });
    return frag.segs.map(function (s) {
      var lvl = s.level;
      if (lvl === '§') lvl = (fam === 'law' && !hasSt) ? 'ст' : 'п';
      if (lvl === 'пп' && (fam === 'isa' || fam === 'std' || fam === 'ethics' || ((fam === 'law' || fam === 'order') && !hasP))) lvl = 'п';
      return new Seg(lvl, s.items);
    });
  }
  function rankOf(R, fam) { return hasOwn(R.T.RANK, fam) ? R.T.RANK[fam] : {}; }
  function rk(rank, lv) { return hasOwn(rank, lv) ? rank[lv] : 9; }
  function product(lists) {
    var out = [[]];
    lists.forEach(function (l) { var nx = []; out.forEach(function (p) { l.forEach(function (x) { nx.push(p.concat([x])); }); }); out = nx; });
    return out;
  }
  function withLevel(chain, lv, it) { var c = new Map(chain); c.set(lv, it); return c; }

  function Scanner(lib, opts) {
    this.lib = lib; this.R = lib.R; this.finder = new Finder(lib);
    this.siteExtra = !(opts && opts.siteExtra === false);
  }
  Scanner.prototype.findActs = function (line) {
    var acts = this.finder.find(line);
    return this.siteExtra ? this.finder.siteExtra(line, acts) : acts;
  };
  Scanner.prototype.scanLine = function (line) { // = check_citations.py:Scanner.scan_line
    var R = this.R, self = this;
    var acts = this.findActs(line);
    var res = { cits: [], mentions: [], acts: acts };
    if (!acts.length) return res;
    res.mentions = acts.filter(function (a) { return a.kind !== 'generic'; }).map(function (a) {
      return { sid: a.sid, label: a.label, kind: a.kind, start: a.start, end: a.end, act: a };
    });
    var frags = parseFrags(R, line, acts);
    if (!frags.length) return res;
    var items = acts.map(function (a) { return [a.start, a.end, a]; }).concat(frags.map(function (f) { return [f.start, f.end, f]; }));
    items = stableSort(items, function (t) { return [t[0], t[1]]; });
    var groups = [];
    items.forEach(function (it, idx) {
      if (!(it[2] instanceof Frag)) return;
      var prev = idx ? items[idx - 1] : null;
      var lastG = groups.length ? groups[groups.length - 1] : null;
      if (lastG && prev && prev[2] instanceof Frag && lastG[lastG.length - 1] === idx - 1 &&
          (prev[0] === it[0] || R.at(R.rx.GROUP_SEP.y, line.slice(prev[1], it[0]), 0))) lastG.push(idx);
      else groups.push([idx]);
    });
    var memo = new Map();
    groups.forEach(function (g) {
      var first = g[0], last = g[g.length - 1];
      var fwd = null, rev = null, fwdTight = false, revTight = false, fwdWs = false, gap;
      var prevObj = first > 0 ? items[first - 1][2] : null;
      if (prevObj instanceof Act) {
        gap = line.slice(items[first - 1][1], items[first][0]);
        if (R.at(R.rx.FWD_GAP.y, gap, 0) && !R.rx.AMENDING_BEFORE.s.test(line.slice(0, prevObj.start))) {
          fwd = prevObj; var gs = R.strip(gap); fwdTight = gs === '' || gs === '('; fwdWs = !gs;
        }
      }
      var nextObj = last + 1 < items.length ? items[last + 1][2] : null;
      if (nextObj instanceof Act) {
        gap = line.slice(items[last][1], items[last + 1][0]);
        if (R.at(R.rx.REV_GAP.y, gap, 0)) { rev = nextObj; var gr = R.strip(gap); revTight = gr === '' || gr === 'к'; }
      }
      var order = ((revTight && !fwdTight) ? [rev, fwd] : [fwd, rev]).filter(function (a) { return a !== null; });
      var lastOrder;
      if (fwd !== null && rev !== null && g.length > 1) {
        if (fwdTight) { order = [fwd, rev]; lastOrder = revTight ? [rev, fwd] : order; }
        else { order = lastOrder = revTight ? [rev, fwd] : [fwd, rev]; }
      } else {
        lastOrder = order;
      }
      var bound = [];
      g.forEach(function (i) {
        var frag = items[i][2];
        var cands = i === last ? lastOrder : order;
        var act = null;
        for (var c = 0; c < cands.length; c++) {
          var a = cands[c];
          if (a instanceof Act && compatible(R, a, frag, a === fwd && fwdWs && i === first)) { act = a; break; }
        }
        if (act === null && !frag.bad && frag.segs.length) act = self._ethicsFallback(acts, frag);
        if (act === null) {
          if (frag.bad && fwd !== null && i === first && fwd.kind === 'lib') {
            var cb = new Citation(fwd.label + ' ' + R.strip(line.slice(frag.start, frag.end)), UNPARSED, 'bad_locator', fwd.sid, fwd.label);
            cb.start = frag.start; cb.end = frag.end; cb.act = fwd;
            res.cits.push(cb);
          }
          return;
        }
        var gapBefore = (i !== first && items[i - 1][0] !== frag.start) ? line.slice(items[i - 1][1], frag.start) : ',';
        bound.push([frag, act, gapBefore]);
      });
      Array.prototype.push.apply(res.cits, self._resolveGroup(bound, memo));
    });
    return res;
  };
  Scanner.prototype._ethicsFallback = function (acts, frag) { // = Scanner._ethics_fallback
    var R = this.R, nums = [];
    frag.segs.forEach(function (s) { s.items.forEach(function (i) { nums.push(i.num); }); });
    if (!nums.length || !nums.every(function (n) { return ethNum(R, n); })) return null;
    var eth = acts.filter(function (a) { return a.family === 'ethics'; });
    for (var i = 0; i < eth.length; i++) if (eth[i].sid.indexOf('independence_rules') === 0 || eth[i].label.indexOf('Правила') === 0) return eth[i];
    return eth.length ? eth[0] : null;
  };
  Scanner.prototype._resolveGroup = function (bound, memo) { // = Scanner._resolve_group
    var R = this.R, self = this, out = [], chains = [], gaps = [];
    bound.forEach(function (b) {
      var frag = b[0], act = b[1], ch = new Map();
      levelsOf(act, frag).forEach(function (seg) {
        var its = [];
        seg.items.forEach(function (it) {
          var parts = (it.to === null && !it.sub_to.length) ? splitSubs(it.subs) : [it.subs];
          parts.forEach(function (sp) { its.push(new Item(it.num, sp, it.to, it.sub_to)); });
        });
        if (!ch.has(seg.level)) ch.set(seg.level, its);
      });
      chains.push([act, ch, frag]);
      gaps.push(R.strip(b[2]));
    });
    var inherit = function (rank, ch, pch) {
      var top = 9;
      ch.forEach(function (_v, lv) { top = Math.min(top, rk(rank, lv)); });
      pch.forEach(function (its, lv) { if (rk(rank, lv) < top && !ch.has(lv) && its.length === 1) ch.set(lv, its); });
    };
    var i;
    for (i = 0; i < chains.length; i++) {
      var act = chains[i][0], ch = chains[i][1], pch;
      if (i === 0) {
        if ((act.family || 'law') !== 'law' || !memo.has(act)) continue;
        pch = memo.get(act);
      } else {
        if (act !== chains[i - 1][0]) continue;
        pch = chains[i - 1][1];
      }
      inherit(rankOf(R, act.family || 'law'), ch, pch);
    }
    for (i = chains.length - 2; i >= 0; i--) {
      var a2 = chains[i][0], c2 = chains[i][1];
      if (a2 !== chains[i + 1][0] || (a2.family || 'law') !== 'law' || c2.has('ст') || (gaps[i + 1] !== ',' && gaps[i + 1] !== 'и')) continue;
      inherit(R.T.RANK.law, c2, chains[i + 1][1]);
    }
    chains.forEach(function (t) {
      var act = t[0], ch = t[1], frag = t[2];
      memo.set(act, ch);
      var rank = rankOf(R, act.family || 'law');
      var levels = stableSort(Array.from(ch.keys()), function (lv) { return rk(rank, lv); });
      product(levels.map(function (lv) { return ch.get(lv); })).forEach(function (combo) {
        var chain = new Map();
        levels.forEach(function (lv, k) { chain.set(lv, combo[k]); });
        var c = self._resolve(act, chain);
        c.start = frag.start; c.end = frag.end; c.act = act;
        out.push(c);
      });
    });
    return out;
  };
  Scanner.prototype._resolve = function (act, chain) { // = Scanner._resolve
    var R = this.R, lib = this.lib;
    var label = R.strip(act.label + ' ' + render(R, act, chain));
    var base = new Citation(label, FOUND, '', act.sid, act.label);
    if (act.kind === 'generic') { base.category = UNPARSED; base.reason = 'generic_act'; return base; }
    if (act.kind === 'external') { base.category = MISSING_DOCUMENT; base.reason = 'no_document'; return base; }
    var doc = lib.docs[act.sid];
    if (doc.status !== 'fetched' || !doc.ids.length) { base.category = MISSING_DOCUMENT; base.reason = 'not_fetched'; return base; }
    var ends = [chain];
    for (var e of chain) {
      var lv = e[0], it = e[1];
      if (it.to !== null) { ends = [withLevel(chain, lv, new Item(it.num, it.subs)), withLevel(chain, lv, it.to)]; break; }
      if (it.sub_to.length) { ends = [withLevel(chain, lv, new Item(it.num, it.subs)), withLevel(chain, lv, new Item(it.num, it.sub_to))]; break; }
    }
    var self = this;
    var results = ends.map(function (c) { return self._find(act, doc, c); });
    var bad = results.find(function (r) { return r[0] !== FOUND; });
    if (bad) { base.category = bad[0]; base.reason = bad[1]; base.note = bad[2]; return base; }
    var ids = [];
    results.forEach(function (r) { Array.prototype.push.apply(ids, r[3]); });
    if (ends.length === 2 && ids.length === 2) ids = this._expandRange(doc, ids[0], ids[1]);
    base.ids = Array.from(new Set(ids));
    base.note = results.map(function (r) { return r[2]; }).filter(Boolean).join('; ');
    base.repealed = base.ids.some(function (i) { return doc.repealed.has(i); });
    return base;
  };
  Scanner.prototype._expandRange = function (doc, a, b) { // = Scanner._expand_range
    var ia = doc.idx.get(a), ib = doc.idx.get(b), lib = this.lib;
    if (ia === undefined || ib === undefined) return [a, b];
    if (ib < ia) return [a, b];
    var da = lib.depth(doc, a);
    var span = doc.ids.slice(ia, ib + 1).filter(function (i) { return lib.depth(doc, i) === da; });
    return span.length <= 120 ? span : [a, b];
  };
  Scanner.prototype._find = function (act, doc, chain) { // = Scanner._find
    var fam = act.family;
    if (fam === 'isa') return this._findIsa(doc, chain);
    if (fam === 'std') return this._findStd(doc, doc.prefix, chain);
    if (fam === 'law') return this._findLaw(doc, chain);
    if (fam === 'order') return this._findOrder(act, doc, chain);
    if (fam === 'ethics') return this._findEthics(doc, chain);
    if (fam === 'forms') {
      var n = chain.get('форм').num;
      if (doc.formSet.has(n)) return [FOUND, '', '', [doc.prefix + ' ф.' + n]];
      return [MISSING_PARAGRAPH, 'no_such_form', 'форм в Сборнике: ' + doc.forms.length, []];
    }
    return [UNPARSED, 'bad_locator', '', []];
  };
  Scanner.prototype._subCheck = function (doc, parent, subs, latin) { // = Scanner._sub_check
    var R = this.R, lib = this.lib, T = R.T;
    var conv = latin ? function (s) { return translate(s, T.CYR2LAT); } : function (s) { return translate(s, T.LAT2CYR); };
    var subsN = subs.map(conv);
    var wrap = function (arr) { return arr.map(function (s) { return '(' + s + ')'; }).join(''); };
    var hit = lib.has(doc, parent + wrap(subsN));
    if (hit) return [FOUND, '', '', [hit]];
    if (subsN.length === 1 && isDigit(subsN[0])) {
      hit = lib.has(doc, parent + ' пп.' + subsN[0]);
      if (hit) return [FOUND, '', '', [hit]];
    }
    var toks = lib.subTokens(doc, parent);
    if (subsN.every(function (s) { return toks.has(s); })) return [FOUND, '', 'подпункт — в тексте пункта', [parent]];
    if (latin) {
      var pos = subs.map(function (s) {
        if (cpLen(s) === 1 && T.RU_ORDER.indexOf(s) >= 0) {
          var k = T.RU_ORDER.indexOf(s);
          if (k >= T.LAT_ORDER.length) throw new Error('cite: IndexError (_sub_check, как в Python)');
          return T.LAT_ORDER.charAt(k);
        }
        return s;
      });
      if (!arrEq(pos, subsN)) {
        var uid2 = parent + wrap(pos);
        if (lib.has(doc, uid2) || pos.every(function (s) { return toks.has(s); })) return [MISSING_PARAGRAPH, 'sub_letter_cyrillic', 'в библиотеке: ' + uid2, []];
      }
    }
    return [MISSING_PARAGRAPH, 'no_such_sub', 'пункт ' + parent + ' есть', []];
  };
  Scanner.prototype._findIsa = function (doc, chain) { // = Scanner._find_isa
    var R = this.R, lib = this.lib, base = doc.prefix, note = '';
    if (chain.has('прил') && chain.get('прил').num.indexOf('A') === 0 && !chain.has('п')) {
      chain = new Map([['п', chain.get('прил')]]);
      note = '«приложение A…» = пункт руководства';
    }
    if (chain.has('прил')) {
      var app = chain.get('прил').num;
      base += ' Прил.' + app;
      if (lib.has(doc, base) === null && app === '1' && lib.has(doc, doc.prefix + ' Прил.')) {
        base = doc.prefix + ' Прил.'; note = 'у стандарта одно приложение без номера';
      }
    }
    var it = chain.get('п');
    if (!it) {
      var h = lib.has(doc, base);
      return h ? [FOUND, '', note, [h]] : [MISSING_PARAGRAPH, 'no_such_paragraph', '', []];
    }
    var num = it.num.replace(/А/g, 'A');
    if (doc.sid !== 'isa_3000') {
      var lc = lastCp(num);
      if (isAlpha(lc)) num = num.slice(0, num.length - lc.length) + translate(lc, R.T.CYR2LAT);
    }
    var parent = lib.has(doc, base + ' п.' + num);
    if (parent === null) {
      var m = R.at(R.inl.isa_letter_sub.y, num, 0);
      if (m && lib.has(doc, base + ' п.' + m[1])) return this._subCheck(doc, base + ' п.' + m[1], [m[2]].concat(it.subs), true);
      return [MISSING_PARAGRAPH, 'no_such_paragraph', isaRangeNote(R, doc, num), []];
    }
    if (it.subs.length) return this._subCheck(doc, parent, it.subs, true);
    return [FOUND, '', note, [parent]];
  };
  Scanner.prototype._findStd = function (doc, prefix, chain) { // = Scanner._find_std
    var lib = this.lib;
    if (chain.has('прил') && !chain.has('п')) {
      var hit = lib.has(doc, prefix + ' прил.' + chain.get('прил').num);
      return hit ? [FOUND, '', '', [hit]] : [MISSING_PARAGRAPH, 'no_such_paragraph', '', []];
    }
    var it = chain.get('п');
    if (!it) return [UNPARSED, 'bad_locator', '', []];
    var subs = it.subs.concat(chain.has('подп') ? [chain.get('подп').num] : []);
    var parent = lib.has(doc, prefix + ' п.' + it.num);
    if (parent === null) return [MISSING_PARAGRAPH, 'no_such_paragraph', '', []];
    if (subs.length) return this._subCheck(doc, parent, subs, false);
    return [FOUND, '', '', [parent]];
  };
  Scanner.prototype._findLaw = function (doc, chain) { // = Scanner._find_law
    var R = this.R, lib = this.lib, T = R.T;
    if (!chain.has('ст')) return [UNPARSED, 'no_article', '', []];
    var art = doc.prefix + ' ст.' + chain.get('ст').num;
    if (lib.has(doc, art) === null) {
      if (doc.partial) return [MISSING_PARAGRAPH, 'article_not_loaded', '', []];
      return [MISSING_PARAGRAPH, 'no_such_paragraph', 'статьи нет', []];
    }
    var LV = ['ч', 'п', 'пп', 'подп'];
    var vals = LV.filter(function (lv) { return chain.has(lv); }).map(function (lv) { return [lv, chain.get(lv).num]; });
    var letters = [];
    LV.forEach(function (lv) { if (chain.has(lv)) chain.get(lv).subs.forEach(function (s) { letters.push(s); }); });
    var note = '';
    if (chain.has('абз')) {
      if (doc.implicit_articles.has(art) && !vals.length) vals = [['ч', chain.get('абз').num]];
      else note = 'абзац — в тексте единицы';
    }
    if (!vals.length) return [FOUND, '', note, [art]];
    var terms = vals.map(function (v) { return v[0] === 'подп' ? 'пп' : v[0]; });
    var nums = vals.map(function (v) { return v[1]; });
    var path = function (ts, k) { var s = ''; for (var j = 0; j < (k === undefined ? ts.length : k); j++) s += ' ' + ts[j] + '.' + nums[j]; return s; };
    var lettersCyr = letters.map(function (x) { return '(' + translate(x, T.LAT2CYR) + ')'; }).join('');
    var render = function (ts) { return art + path(ts) + lettersCyr; };
    var hit = lib.has(doc, render(terms));
    if (hit) return [FOUND, '', note, [hit]];
    if (letters.length) {
      var parent = art + path(terms);
      if (lib.has(doc, parent)) {
        var res = this._subCheck(doc, parent, letters, false);
        return res[0] === FOUND ? res : [res[0], res[1], res[2], []];
      }
    }
    var singlePart = false;
    if (terms.indexOf('ч') < 0) {
      var partRx = new RegExp('^' + escRe(art) + R.inl.part_tail.src, 'u');
      var parts = new Set();
      doc.ids.forEach(function (i) { var m = partRx.exec(i); if (m) parts.add(m[1]); });
      singlePart = parts.size === 1 && parts.has('ч.1');
      if (singlePart) {
        var cand = art + ' ч.1' + path(terms) + lettersCyr;
        hit = lib.has(doc, cand);
        if (hit) return [FOUND, '', 'у статьи одна часть', [hit]];
      }
    }
    if ((doc.implicit_articles.has(art) || singlePart) && nums.length === 1 && !letters.length) {
      var rx = new RegExp('^' + escRe(art) + R.inl.implicit_tail.src + escRe(nums[0]) + '(?=\\n?$)', 'u');
      var hits = doc.ids.filter(function (i) { return rx.test(i); });
      if (hits.length === 1) return [FOUND, '', 'в библиотеке: ' + hits[0] + ' (статья без нумерации частей)', hits];
    }
    var alts = { 1: [['ч'], ['п']], 2: [['ч', 'п'], ['п', 'пп'], ['ч', 'пп']], 3: [['ч', 'п', 'пп']] }[terms.length] || [];
    for (var a = 0; a < alts.length; a++) {
      if (arrEq(alts[a], terms)) continue;
      var c2 = render(alts[a]);
      if (lib.has(doc, c2)) return [MISSING_PARAGRAPH, 'term_mismatch', 'в библиотеке: ' + c2, []];
    }
    var deepest = art;
    for (var k = 1; k < terms.length; k++) {
      var c3 = art + path(terms, k);
      if (lib.has(doc, c3)) deepest = c3;
    }
    return [MISSING_PARAGRAPH, 'no_such_paragraph', 'есть ' + deepest, []];
  };
  Scanner.prototype._findOrder = function (act, doc, chain) { // = Scanner._find_order
    var R = this.R, lib = this.lib, self = this;
    var n = R.inl.order_num.s.exec(act.label || doc.prefix);
    var num = n ? n[1] : '';
    if (chain.has('сч')) {
      var acc = chain.get('сч').num, cands = [acc, acc.padStart(2, '0')], kinds = ['Инструкция', 'План'];
      for (var i = 0; i < cands.length; i++) for (var j = 0; j < kinds.length; j++) {
        var hit = lib.has(doc, '94н ' + kinds[j] + ' сч.' + cands[i]);
        if (hit) return [FOUND, '', '', [hit]];
      }
      return [MISSING_PARAGRAPH, 'no_such_paragraph', '', []];
    }
    var prefixes = { '34': ['Приказ Минфина 34н Положение', 'Приказ Минфина 34н'],
      '84': ['Приказ Минфина 84н Порядок', 'Приказ Минфина 84н'] }[num] || ['Приказ Минфина ' + num + 'н'];
    var last = [MISSING_PARAGRAPH, 'no_such_paragraph', '', []];
    var inOrderDocs = hasOwn(R.T.ORDER_DOCS, num);
    var docs = inOrderDocs ? [doc] : (hasOwn(lib.orderDocs, num) ? lib.orderDocs[num] : []).map(function (s) { return lib.docs[s]; });
    for (var p = 0; p < prefixes.length; p++) {
      for (var d = 0; d < docs.length; d++) {
        var res = self._findStd(docs[d], prefixes[p], chain);
        if (res[0] === FOUND) return res;
        if (res[1] !== 'no_such_paragraph') last = res;
      }
    }
    for (var e = 0; e < docs.length; e++) {
      if (docs[e].family === 'std' && !inOrderDocs) {
        var r2 = self._findStd(docs[e], docs[e].prefix, chain);
        if (r2[0] === FOUND) return [FOUND, '', 'пункт ' + docs[e].prefix + ', утверждённого приказом ' + num + 'н', r2[3]];
      }
    }
    return last;
  };
  Scanner.prototype._findEthics = function (doc, chain) { // = Scanner._find_ethics
    var lib = this.lib, it = chain.get('п');
    if (!it) return [UNPARSED, 'bad_locator', '', []];
    var num = it.num.replace(/T/g, 'Т').replace(/P/g, 'П');
    var last = [MISSING_PARAGRAPH, 'no_such_paragraph', 'нет ни в ред. №2, ни в ред. №3', []];
    var sids = doc.sid.indexOf('independence_rules') === 0 ? ['independence_rules_2025', 'independence_rules_2026']
      : ['ethics_code_2025', 'ethics_code_2026'];
    for (var i = 0; i < sids.length; i++) {
      var ed = lib.docs[sids[i]];
      if (!ed) continue;
      var parent = lib.has(ed, ed.prefix + ' п.' + num);
      if (parent === null) continue;
      if (it.subs.length) {
        var res = this._subCheck(ed, parent, it.subs, false);
        if (res[0] === FOUND) return res;
        last = res;
        continue;
      }
      return [FOUND, '', '', [parent]];
    }
    return last;
  };

  function render(R, act, chain) { // = check_citations.py:_render
    var fam = act.family || 'law', rank = rankOf(R, fam), parts = [];
    var wrap = function (arr) { return arr.map(function (s) { return '(' + s + ')'; }).join(''); };
    stableSort(Array.from(chain.keys()), function (x) { return rk(rank, x); }).forEach(function (lv) {
      var it = chain.get(lv);
      var subs = wrap(it.subs);
      if (it.sub_to.length) subs += '–' + wrap(it.sub_to);
      var txt = it.num.replace(/А/g, 'A') + subs;
      if (it.to !== null) txt += '–' + it.to.num.replace(/А/g, 'A') + wrap(it.to.subs);
      var name = { 'прил': fam === 'isa' ? 'Прил.' : 'прил.', 'форм': 'ф.', 'сч': 'сч.' }[lv] || lv + '.';
      if (it.to !== null && lv === 'п') name = 'пп.';
      parts.push(name + txt);
    });
    return parts.join(' ');
  }
  function isaRangeNote(R, doc, num) { // = check_citations.py:_isa_range_note
    var f = firstCp(num), letter = isAlpha(f) ? f : '';
    var rx = new RegExp('^' + escRe(doc.prefix) + ' п\\.' + escRe(letter) + R.inl.range_num.src + R.inl.range_tail.src, 'u');
    var nums = [];
    doc.ids.forEach(function (i) { var m = rx.exec(i); if (m) nums.push(toInt(m[1])); });
    if (!nums.length) return letter ? 'пунктов «' + letter + '…» в документе нет' : '';
    return 'в документе ' + letter + '1–' + letter + Math.max.apply(null, nums);
  }

  /* ── сайт: адреса, оценка ссылки для «Проверь ссылки» ── */
  var slugs = { unitSlug: null }; // в браузере — window.YasnSearch.unitSlug; в node — setSlugs(require('search-core'))
  function dnum(d) { var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d || ''); return m ? +(m[3] + m[2] + m[1]) : 0; }

  function Engine(rules, libData, opts) {
    this.R = new Rules(rules);
    this.lib = new Lib(libData, this.R);
    this.scanner = new Scanner(this.lib, opts);
    this.stale = !!(rules.sha && rules.sha !== ALGO_SHA && ALGO_SHA.indexOf('__') !== 0);
    if (this.stale && typeof console !== 'undefined') console.warn('cite-engine: правила новее алгоритма (ALGO_SHA)');
  }
  Engine.prototype.findActs = function (line) { return this.scanner.findActs(line); };
  Engine.prototype.scanLine = function (line) { return this.scanner.scanLine(line); };
  /* Текст целиком: строки по «\n»; позиции — от начала текста. docRefs — упоминания документа без места
     (акт, к которому не привязана ни одна ссылка: «ПБУ 18/02»). */
  Engine.prototype.scanText = function (text) {
    var out = { cits: [], docRefs: [] }, off = 0, self = this;
    String(text || '').split('\n').forEach(function (line) {
      var r = self.scanner.scanLine(line);
      var used = new Set(r.cits.map(function (c) { return c.act; }));
      r.cits.forEach(function (c) { c.start += off; c.end += off; out.cits.push(c); });
      r.mentions.forEach(function (m) {
        if (!used.has(m.act)) out.docRefs.push({ sid: m.sid, label: m.label, kind: m.kind, start: m.start + off, end: m.end + off });
      });
      off += line.length + 1;
    });
    return out;
  };
  Engine.prototype.doc = function (sid) { return hasOwn(this.lib.docs, sid) ? this.lib.docs[sid] : null; };
  Engine.prototype.docUrl = function (sid) {
    var d = this.doc(sid);
    return d && d.built ? this.lib.base + d.slug + '/' : null;
  };
  /* Адрес пункта: страница или страница#якорь; null — текст документа в этой сборке не показывается. */
  Engine.prototype.unitUrl = function (sid, uid) {
    var d = this.doc(sid);
    if (!d || !d.vis || !d.built) return null;
    var i = d.idx.get(uid);
    if (i === undefined) { var real = this.lib.alias.get(uid); i = real ? d.idx.get(real) : undefined; if (i === undefined) return null; uid = d.ids[i]; }
    var p = i;
    while (p > 0 && !this.lib.isPage(d, p)) p--;
    var slugFn = slugs.unitSlug || (typeof window !== 'undefined' && window.YasnSearch && window.YasnSearch.unitSlug);
    if (!slugFn) throw new Error('cite-engine: нужен search-core.js (unitSlug) для адресов пунктов');
    var pageUrl = this.lib.base + d.slug + '/' + slugFn(d.ids[p], d.prefix || d.sid) + '/';
    return p === i ? pageUrl : pageUrl + '#' + slugFn(uid, d.prefix || d.sid);
  };
  /* Оценка ссылки на дату документа (README «Проверь ссылки», PLAN §10). docDate — «ДД.ММ.ГГГГ».
     Возвращает {level: ok|warn|err, code, sid, ids, note}; порядок проверок — как в README. */
  Engine.prototype.assess = function (cit, docDate) {
    var d = cit.sid ? this.doc(cit.sid) : null, dd = dnum(docDate);
    var r = { level: 'ok', code: 'ok', sid: cit.sid || '', ids: cit.ids || [], note: cit.note || '', reason: cit.reason || '' };
    if (cit.category === MISSING_DOCUMENT && cit.reason !== 'not_fetched') { r.level = 'err'; r.code = 'no_document'; return r; }
    var st = d ? d.st : null, sd = st ? dnum(st.date) : 0;
    if (st && (st.cls === 'old' || st.cls === 'ending') && (!sd || !dd || dd >= sd)) { r.level = 'err'; r.code = 'doc_repealed'; return r; }
    if (cit.repealed) { r.level = 'err'; r.code = 'unit_repealed'; return r; }
    if (st && st.cls === 'soon' && (!sd || !dd || dd < sd)) { r.level = 'warn'; r.code = 'not_in_force'; return r; }
    if (cit.category === MISSING_DOCUMENT) { r.level = 'warn'; r.code = 'not_fetched'; return r; }
    if (d && d.edDate && dd && dnum(d.edDate) > dd) { r.level = 'warn'; r.code = 'edition_newer'; r.edDate = d.edDate; if (cit.category === FOUND) return r; }
    if (cit.category === MISSING_PARAGRAPH) { r.level = 'err'; r.code = 'missing_paragraph'; return r; }
    if (cit.category === UNPARSED) { r.level = 'warn'; r.code = 'unparsed'; return r; }
    return r;
  };
  Engine.prototype.assessDoc = function (sid, docDate) {
    var d = this.doc(sid);
    if (!d) return { level: 'err', code: 'no_document', sid: sid, ids: [] };
    return this.assess({ sid: sid, category: d.status === 'fetched' && d.ids.length ? FOUND : MISSING_DOCUMENT,
      reason: d.status === 'fetched' && d.ids.length ? '' : 'not_fetched', ids: [], repealed: false }, docDate);
  };

  function getJSON(url) {
    if (typeof window !== 'undefined' && window.Yasn && window.Yasn.getJSON) return window.Yasn.getJSON(url);
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ': ' + r.status); return r.json(); });
  }
  var loading = null;
  /* Загрузка правил и библиотеки (один раз за страницу). base — корень сайта («/»). */
  function load(base, opts) {
    if (!loading) {
      base = base || '/';
      loading = Promise.all([getJSON(base + 'assets/data/cite/rules.json'), getJSON(base + 'assets/data/cite/lib.json')])
        .then(function (r) { return new Engine(r[0], r[1], opts); });
    }
    return loading;
  }

  return {
    ALGO_SHA: ALGO_SHA,
    create: function (rules, libData, opts) { return new Engine(rules, libData, opts); },
    load: load,
    setSlugs: function (search) { slugs.unitSlug = search && search.unitSlug; },
    CATEGORIES: [FOUND, MISSING_PARAGRAPH, MISSING_DOCUMENT, UNPARSED],
    _internal: { cpLen: cpLen, cpSlice: cpSlice }
  };
});
