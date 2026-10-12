/* «Проверь ссылки» (макеты 6e, 7d; README «Проверь ссылки»; PLAN §10) — Строитель 2.
   Текст никуда не отправляется: страница загружает только статические данные библиотеки (assets/data/*) — те же для
   любого текста — и разбирает текст в браузере правилами cite-engine.js — те же правила разбора, что у программы «Ясность».
   Текст пользователя выводится только через textContent.

   Порядок проверок (README): документа нет в библиотеке → утратил силу (документ или пункт) → не вступил →
   редакция новее даты документа → пункта нет (подсказки по словам предложения) → действует. */
(function () {
  'use strict';
  var root = document.querySelector('[data-check]');
  if (!root || !window.Yasn) return;
  var Y = window.Yasn;
  var BASE = (Y.base || '/').replace(/\/$/, '');
  var D = BASE + '/assets/data/';

  var $ = function (s) { return root.querySelector(s); };
  var el = {
    text: $('[data-ck-text]'), marked: $('[data-ck-marked]'), date: $('[data-ck-date]'), sum: $('[data-ck-sum]'),
    run: $('[data-ck-run]'), sample: $('[data-ck-sample]'), rerun: $('[data-ck-rerun]'), report: $('[data-ck-report]'),
    edit: $('[data-ck-edit]'), clear: $('[data-ck-clear]'), what: $('[data-ck-what]'), issues: $('[data-ck-issues]'),
    issuesCap: $('[data-ck-issues-cap]'), ok: $('[data-ck-ok]'), okCap: $('[data-ck-ok-cap]'), tiles: $('[data-ck-tiles]'),
    loading: $('[data-ck-loading]')
  };

  /* ── вспомогательное ── */
  function N(s) { return (window.YasnCore && YasnCore.norm) ? YasnCore.norm(s) : (s || '').toLowerCase().replace(/ё/g, 'е'); }
  function mk(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function plural(n, a, b, c) { return Y.plural(n, a, b, c); }
  function pw(n, a, b, c) { var m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : (m >= 2 && m <= 4 && (h < 10 || h >= 20) ? b : c); }
  function dnum(d) { var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d || ''); return m ? +(m[3] + m[2] + m[1]) : 0; }
  function validDate(d) {
    var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d || ''); if (!m) return false;
    var dt = new Date(+m[3], +m[2] - 1, +m[1]);
    return dt.getFullYear() === +m[3] && dt.getMonth() === +m[2] - 1 && dt.getDate() === +m[1];
  }
  function todayStr() { var d = new Date(); return ('0' + d.getDate()).slice(-2) + '.' + ('0' + (d.getMonth() + 1)).slice(-2) + '.' + d.getFullYear(); }
  function lc1(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function cap1(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* ── данные (статические файлы сборки; запросы не зависят от текста) ── */
  var data = null;
  function load() {
    if (data) return data;
    el.loading.hidden = false;
    data = Promise.all([window.YasnCite.load(BASE + '/'), Y.getJSON(D + 'check/meta.json'), Y.getJSON(D + 'docs.json'),
      Y.getJSON(D + 'units.json')]).then(function (r) {
      var docsIdx = {};
      r[2].forEach(function (d, i) { docsIdx[d.id] = i; });
      el.loading.hidden = true;
      return { engine: r[0], meta: r[1], docs: r[2], docsIdx: docsIdx, units: r[3] };
    });
    data.catch(function () { el.loading.hidden = true; data = null; Y.toast('Не удалось загрузить данные библиотеки'); });
    return data;
  }

  /* ── адреса (cite-engine: те же правила адресов, что у сборки) ── */
  function docUrl(L, sid) { return L.engine.docUrl(sid) || (L.meta.docs[sid] || {}).url || searchUrl(sid); }
  function unitUrl(L, sid, uid) { return L.engine.unitUrl(sid, uid) || docUrl(L, sid); }
  function searchUrl(q) { return BASE + '/poisk/?q=' + encodeURIComponent(q); }

  /* «В МСА 320 пункты 1–14 и A1–A14» — по id документа (как rangesText прототипа, плюс статьи законов). */
  function rangesText(c) {
    var num = [], A = 0, art = [];
    (c.keys || []).forEach(function (k) {
      var m = /^п\.(\d+)$/.exec(k); if (m) num.push(+m[1]);
      var a = /^п\.A(\d+)$/.exec(k); if (a) A = Math.max(A, +a[1]);
      var s = /^ст\.(\d+)$/.exec(k); if (s) art.push(+s[1]);
    });
    if (num.length) return 'пункты ' + Math.min.apply(null, num) + '–' + Math.max.apply(null, num) + (A ? ' и A1–A' + A : '');
    if (art.length) return 'статьи ' + Math.min.apply(null, art) + '–' + Math.max.apply(null, art);
    return '';
  }

  /* Подсказки «по смыслу»: слова предложения ≥ 6 букв (по первым 7), заголовок ×3, текст ×1, +2 пунктам не из «A»,
     2 лучших (README; check() прототипа). Тексты — куски text/cNNN.json этого документа (только видимый текст). */
  function suggest(L, c, text, at) {
    var i = L.docsIdx[c.sid], d = i == null ? null : L.docs[i];
    if (!d || d.mode !== 'text') return Promise.resolve([]);
    var a = Math.max(text.lastIndexOf('.', at - 1), text.lastIndexOf('\n', at - 1)) + 1;
    var ws = [];
    N(text.slice(a, at)).split(/[^a-zа-я]+/).forEach(function (w) { if (w.length >= 6 && ws.indexOf(w.slice(0, 7)) < 0) ws.push(w.slice(0, 7)); });
    if (!ws.length) return Promise.resolve([]);
    return Y.getJSON(D + 'docunits/' + d.slug + '.json').then(function (du) {
      return Promise.all(du.chunks.map(function (n) { return Y.getJSON(D + 'text/c' + ('00' + n).slice(-3) + '.json'); })).then(function (chs) {
        var texts = {}; chs.forEach(function (ch) { for (var k in ch) texts[k] = ch[k]; });
        var pageRows = {};
        for (var r = d.u[0]; r < d.u[1]; r++) if (L.units.rows[r][4] & 32) pageRows[r] = 1;
        return du.units.filter(function (u) { return pageRows[u[0]]; }).map(function (u, ix) {
          var s = 0, h = N(u[3] || ''), t = N(texts[u[0]] || '');
          ws.forEach(function (w) { if (h.indexOf(w) >= 0) s += 3; if (t.indexOf(w) >= 0) s += 1; });
          var key = L.units.rows[u[0]][1];
          if (s > 0 && !/^п\.A/.test(key)) s += 2;
          return { key: key, url: du.base + u[2], s: s, i: ix };
        }).filter(function (x) { return x.s > 0; }).sort(function (x, y) { return y.s - x.s || x.i - y.i; })
          .slice(0, 2).sort(function (x, y) { return x.i - y.i; });
      });
    }).catch(function () { return []; });
  }

  /* ── проверка одной ссылки: уровень и код — engine.assess (порядок README), текст — шаблоном из данных ── */
  function judge(L, ref, docDate, text) {
    var E = L.engine, r = { raw: ref.shared ? ref.label : text.slice(ref.start, ref.end), mark: text.slice(ref.start, ref.end),
      start: ref.start, end: ref.end, label: ref.label, shared: !!ref.shared, withAct: !!ref.withAct };
    var a = ref.doc ? E.assessDoc(ref.sid, docDate) : E.assess(ref.cit, docDate);
    var c = ref.sid ? E.doc(ref.sid) : null;
    r.s = a.level;
    if (a.code === 'no_document' || !c) {
      r.s = 'err'; r.tag = 'Нет в библиотеке'; r.href = searchUrl(r.raw);
      r.msg = 'Документа «' + (ref.docLabel || r.raw) + '» нет среди ' + plural(E.lib.order.length, 'документа', 'документов', 'документов') +
        ' библиотеки. Проверьте шифр.';
      return Promise.resolve(r);
    }
    var m = L.meta.docs[ref.sid] || {}, st = c.st, short = c.prefix || ref.docLabel, uids = a.ids || [];
    var dUrl = docUrl(L, ref.sid), uUrl = uids.length ? unitUrl(L, ref.sid, uids[0]) : dUrl;
    r.sid = ref.sid; r.short = short; r.href = uUrl;
    var rel = (m.rel || []).map(function (x) { return ['См. ' + x[0] + ' →', x[1]]; });
    switch (a.code) {
      case 'doc_repealed':
        r.tag = st.cls === 'ending' ? 'Утратил силу с ' + st.date : (st.label || 'Утратил силу');
        r.msg = short + (st.cls === 'ending' ? ' утратил силу с ' + st.date + ' — раньше даты документа' : ' ' + lc1(st.label || 'утратил силу')) + '.' +
          (m.basis ? ' Основание — ' + m.basis + '.' : '');
        r.links = rel; r.link = ['Открыть документ →', dUrl]; r.href = dUrl;
        break;
      case 'unit_repealed':
        r.tag = 'Пункт утратил силу';
        r.msg = 'В действующей редакции ' + short + ' ' + (uids.length > 1 ? 'эти пункты утратили' : 'этот пункт утратил') + ' силу.';
        r.link = ['Открыть пункт →', uUrl];
        break;
      case 'not_in_force':
        r.tag = 'Ещё не вступил'; r.msg = short + ' ' + lc1(st.label || 'ещё не вступил в силу') + '.';
        r.link = ['Открыть документ →', dUrl];
        break;
      case 'not_fetched':
        r.tag = 'Только реквизиты'; r.href = dUrl;
        r.msg = short + ' есть в библиотеке реквизитами, текста нет — пункт проверить нельзя.';
        r.link = ['Открыть реквизиты →', dUrl];
        break;
      case 'edition_newer':
        r.tag = 'Редакция изменилась';
        r.msg = m.am ? 'После даты документа ' + m.am + '.' : 'Редакция от ' + a.edDate + ' опубликована после даты документа (' + docDate + ').';
        r.link = m.diff ? ['Что изменилось →', m.diff] : ['Открыть документ →', dUrl];
        break;
      case 'missing_paragraph':
        r.tag = 'Пункта нет'; r.href = searchUrl(r.raw);
        var rt = rangesText(c), titles = (E.R.T && E.R.T.REASON_TITLES) || {};
        var why = a.reason && a.reason !== 'no_such_paragraph' ? titles[a.reason] || '' : '';
        return suggest(L, c, text, ref.start).then(function (sg) {
          r.msg = (why ? cap1(why) + '. ' : '') + 'В ' + short + (rt ? ' ' + rt : ' такого места нет') + '.' +
            (sg.length ? ' По смыслу подходят ' + sg.map(function (x) { return x.key; }).join(', ') + '.' : '');
          r.sug = sg.map(function (x) { return { code: short + ' ' + x.key, key: x.key, url: x.url }; });
          r.link = ['Оглавление ' + short + ' →', dUrl];
          return r;
        });
      case 'unparsed':
        var t2 = (E.R.T && E.R.T.REASON_TITLES) || {};
        r.tag = 'Уточните ссылку'; r.href = searchUrl(r.raw);
        r.msg = cap1(t2[a.reason] || 'место в документе не разобрано') + ' — проверить нельзя.';
        break;
      default:
        if (st.cls === 'ending') {
          r.s = 'warn'; r.tag = st.label; r.msg = short + ' действует до ' + (m.until || st.date) + '.' + (m.basis ? ' Основание — ' + m.basis + '.' : '');
          r.links = rel; r.link = [uids.length ? 'Открыть пункт →' : 'Открыть документ →', uUrl];
        } else {
          r.s = 'ok'; r.tag = 'Действует'; r.note = st.cls === 'info' ? 'есть в библиотеке' : 'действует';
        }
    }
    return Promise.resolve(r);
  }

  /* ── разбор текста (cite-engine.js: те же правила, что у программы) ──
     Ссылка = место + акт. Подсвечиваем «МСА 320 п.10» целиком, если акт относится к одной ссылке и стоит рядом;
     у перечня («пункты 10 и 11 МСА 320») место одно на несколько ссылок — одна подсветка, в списках — каждая ссылка.
     Упоминание документа без места («ПБУ 18/02») — отдельная ссылка на документ. Не разобранные правилами места
     (акт без номера: «статьи 5 Закона») не показываем: проверить их нельзя (умолчание, PO может переиграть). */
  function scan(L, text) {
    var res = L.engine.scanText(text), refs = [], per = new Map(), spanN = new Map();
    res.cits.forEach(function (c) {
      if (c.act) per.set(c.act, (per.get(c.act) || 0) + 1);
      spanN.set(c.start + ':' + c.end, (spanN.get(c.start + ':' + c.end) || 0) + 1);
    });
    res.cits.forEach(function (c) {
      if (c.category === 'unparsed') return;
      var s = c.start, e = c.end, act = c.act, shared = spanN.get(s + ':' + e) > 1;
      if (act && per.get(act) === spanN.get(s + ':' + e) && (act.end <= s ? s - act.end : act.start - e) <= 24) { s = Math.min(s, act.start); e = Math.max(e, act.end); }
      refs.push({ start: s, end: e, sid: c.sid, label: c.label, docLabel: c.doc_label, cit: c, shared: shared, withAct: !!act && s <= act.start && e >= act.end });
    });
    res.docRefs.forEach(function (d) {
      if (d.kind === 'generic') return;
      refs.push({ start: d.start, end: d.end, sid: d.kind === 'external' ? '' : d.sid, label: d.label, docLabel: d.label, doc: true });
    });
    refs.sort(function (a, b) { return a.start - b.start || b.end - a.end; });
    var out = [], last = -1, lastSpan = '';
    refs.forEach(function (x) {
      var sp = x.start + ':' + x.end;
      if (x.start >= last || sp === lastSpan) { out.push(x); last = x.end; lastSpan = sp; }
    });
    return out;
  }

  /* ── состояние и отрисовка ── */
  var S = { results: null, text: '', flash: -1, seq: 0 };

  function check(text, date) {
    var seq = ++S.seq;
    return load().then(function (L) {
      var refs = scan(L, text);
      return Promise.all(refs.map(function (ref) { return judge(L, ref, date, text); })).then(function (res) {
        if (seq !== S.seq) return null;
        return res;
      });
    });
  }

  function setState(st) {
    root.setAttribute('data-state', st);
    var res = st === 'result';
    el.text.hidden = res; el.marked.hidden = !res;
    el.run.hidden = res; el.sample.hidden = res;
    el.rerun.hidden = !res; el.report.hidden = !res; el.edit.hidden = !res;
    el.what.hidden = res;
    if (!res) { el.issues.textContent = ''; el.issuesCap.hidden = true; el.ok.hidden = true; el.okCap.hidden = true; el.tiles.hidden = true;
      el.sum.textContent = ''; el.sum.appendChild(mk('b', '', 'Текст для проверки')); }
  }

  function groupLabel(list, def) {
    var l = list.map(function (x) { return lc1(x.tag); });
    return l.every(function (y) { return y === l[0]; }) ? l[0] : def;
  }

  function render(res) {
    S.results = res;
    var text = S.text;
    /* текст с подсветкой */
    el.marked.textContent = '';
    var p = 0, RANK = { ok: 0, warn: 1, err: 2 };
    res.forEach(function (x, i) {
      if (x.start < p) return;  /* тот же фрагмент текста у перечня — уже подсвечен */
      var w = x;
      for (var j = i + 1; j < res.length && res[j].start === x.start && res[j].end === x.end; j++) if (RANK[res[j].s] > RANK[w.s]) w = res[j];
      if (x.start > p) el.marked.appendChild(document.createTextNode(text.slice(p, x.start)));
      var a = mk('a', 'ck-m ck-m--' + w.s + (S.flash === x.start ? ' is-flash' : ''), x.mark);
      a.href = w.href; a.title = w.tag;
      el.marked.appendChild(a);
      p = x.end;
    });
    if (p < text.length) el.marked.appendChild(document.createTextNode(text.slice(p)));
    /* итоги */
    var ok = res.filter(function (x) { return x.s === 'ok'; }), wr = res.filter(function (x) { return x.s === 'warn'; }),
      er = res.filter(function (x) { return x.s === 'err'; });
    el.sum.textContent = '';
    if (!res.length) {
      el.sum.appendChild(mk('b', '', 'Ссылок на нормы не нашли'));
    } else {
      el.sum.appendChild(mk('b', '', 'Найдено ' + res.length + ' ' + pw(res.length, 'ссылка:', 'ссылки:', 'ссылок:')));
      if (ok.length) el.sum.appendChild(mk('span', 's-ok', ok.length + ' ' + (ok.length === 1 ? 'действует' : 'действуют')));
      if (wr.length) el.sum.appendChild(mk('span', 's-warn', wr.length + ' — ' + groupLabel(wr, 'требуют проверки')));
      if (er.length) el.sum.appendChild(mk('span', 's-err', er.length + ' — ' + groupLabel(er, 'ошибки')));
    }
    /* плитки телефона (7d) */
    el.tiles.textContent = '';
    [[ok, 'ok', ok.length === 1 ? 'действует' : 'действуют'], [wr, 'warn', wr.length ? groupLabel(wr, 'требуют проверки') : 'предупреждений'],
      [er, 'err', er.length ? groupLabel(er, 'ошибки') : 'ошибок']].forEach(function (t) {
      var d = mk('div', 'ck-tile ck-tile--' + t[1]);
      d.appendChild(mk('b', '', String(t[0].length))); d.appendChild(mk('span', '', t[2]));
      el.tiles.appendChild(d);
    });
    el.tiles.hidden = !res.length;
    /* требуют внимания */
    el.issues.textContent = '';
    er.concat(wr).forEach(function (x) {
      var c = mk('div', 'ck-c');
      var h = mk('div', 'ck-c__h');
      h.appendChild(mk('b', '', x.raw));
      h.appendChild(mk('span', 'badge badge--' + x.s, x.tag));
      c.appendChild(h);
      c.appendChild(mk('div', 'ck-c__x', x.msg));
      if (x.sug && x.sug.length) {
        var sg = mk('div', 'ck-sug');
        x.sug.forEach(function (u) {
          var row = mk('div', 'ck-sug__r');
          var a = mk('a', '', u.code); a.href = u.url;
          row.appendChild(a);
          if (!x.shared) {  /* у перечня место общее на несколько ссылок — заменять целиком нельзя */
            var b = mk('button', '', 'Заменить в тексте'); b.type = 'button';
            b.setAttribute('aria-label', 'Заменить в тексте «' + x.raw + '» на «' + u.code + '»');
            b.addEventListener('click', function () { replace(x, x.withAct ? u.code : u.key); });
            row.appendChild(b);
          }
          sg.appendChild(row);
        });
        c.appendChild(sg);
      }
      (x.links || []).forEach(function (l) { var a = mk('a', 'ck-link', l[0]); a.href = l[1]; c.appendChild(a); });
      if (x.link) { var a2 = mk('a', 'ck-link', x.link[0]); a2.href = x.link[1]; c.appendChild(a2); }
      el.issues.appendChild(c);
    });
    el.issuesCap.hidden = !(er.length + wr.length);
    /* действуют */
    el.ok.textContent = '';
    ok.forEach(function (x) {
      var a = mk('a', 'ck-ok'); a.href = x.href;
      a.appendChild(mk('span', '', x.raw)); a.appendChild(mk('span', '', x.note));
      el.ok.appendChild(a);
    });
    el.ok.hidden = el.okCap.hidden = !ok.length;
    setState('result');
  }

  function run(text, date) {
    S.text = text;
    if (!text.trim()) { Y.toast('Вставьте текст с шифрами норм: «МСА 320 п.10», «402-ФЗ ст.13».'); return; }
    if (!validDate(date)) { el.date.setAttribute('aria-invalid', 'true'); Y.toast('Дата документа — в виде ДД.ММ.ГГГГ'); el.date.focus(); return; }
    el.date.removeAttribute('aria-invalid');
    check(text, date).then(function (res) {
      if (!res) return;
      render(res);
      if (!res.length) Y.toast('В тексте не нашли ссылок на нормы. Пример: «МСА 320 п.10», «402-ФЗ ст.13».');
    });
  }

  function replace(x, code) {
    var t = S.text, nt = t.slice(0, x.start) + code + t.slice(x.end);
    el.text.value = nt;
    S.flash = x.start;
    run(nt, el.date.value.trim());
    Y.toast('Заменено в тексте: ' + x.raw + ' → ' + code);
    setTimeout(function () { S.flash = -1; var f = el.marked.querySelector('.is-flash'); if (f) f.classList.remove('is-flash'); }, 2000);
  }

  function report() {
    var lines = ['Проверка ссылок · дата документа ' + el.date.value.trim()];
    (S.results || []).forEach(function (x) { lines.push(x.raw + ' — ' + x.tag + (x.msg ? '. ' + x.msg : '')); });
    return lines.join('\n');
  }

  /* ── события ── */
  el.date.value = todayStr();
  el.run.addEventListener('click', function () { run(el.text.value, el.date.value.trim()); });
  el.rerun.addEventListener('click', function () { run(el.text.value, el.date.value.trim()); });
  el.sample.addEventListener('click', function () {
    el.text.value = el.sample.getAttribute('data-sample');
    el.date.value = root.getAttribute('data-sample-date');
    el.date.removeAttribute('aria-invalid');
    el.text.focus();
  });
  el.edit.addEventListener('click', function () { setState('edit'); el.text.focus(); });
  el.clear.addEventListener('click', function () { el.text.value = ''; S.text = ''; S.results = null; setState('edit'); el.text.focus(); });
  el.report.addEventListener('click', function () { Y.copy(report(), el.report); });
  function onDate() {
    var v = el.date.value.trim();
    if (!validDate(v)) { if (v.length >= 10) el.date.setAttribute('aria-invalid', 'true'); return; }
    el.date.removeAttribute('aria-invalid');
    if (root.getAttribute('data-state') === 'result') run(S.text, v);  /* смена даты перепроверяет */
  }
  el.date.addEventListener('input', onDate);
  el.date.addEventListener('change', onDate);
  el.text.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(el.text.value, el.date.value.trim()); } });
  el.text.addEventListener('focus', load, { once: true });
  setState('edit');

  window.YasnCheck = { run: run, results: function () { return S.results; } };  /* для тестов поведения */
})();
