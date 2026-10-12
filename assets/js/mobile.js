/* «Ясность. Нормы» — телефон (макеты 7a, 7c): Строитель 2. Подключается base.html на всех страницах; работает только
   на узком экране (≤ 760 px, как responsive.css). Ничего не загружает и никуда не отправляет. */
(function () {
  'use strict';
  var mq = window.matchMedia ? window.matchMedia('(max-width: 760px)') : null;
  if (!mq) return;

  /* 7a: короткая подсказка в поле поиска (длинная на 390 обрезается). */
  function placeholders() {
    document.querySelectorAll('.home-hero .search-big input[name="q"]').forEach(function (inp) {
      if (!inp.hasAttribute('data-ph-long')) inp.setAttribute('data-ph-long', inp.getAttribute('placeholder') || '');
      inp.setAttribute('placeholder', mq.matches ? 'Шифр, документ или слово' : inp.getAttribute('data-ph-long'));
    });
  }

  /* 7c: длинная таблица пункта — фрагмент 6 строк (вокруг строки с находкой, если она есть) + «Показать всю таблицу»;
     над таблицей — подпись и «листайте →», если таблица шире экрана; справа — градиент-подсказка. */
  var FRAG = 6, MIN_ROWS = 10;
  function tables() {
    document.querySelectorAll('.pt-text .tbl-scroll[data-first-sticky]').forEach(function (box) {
      if (box.hasAttribute('data-m-done')) { hint(box); return; }
      box.setAttribute('data-m-done', '');
      var table = box.querySelector('table');
      if (!table) return;
      var rows = Array.prototype.slice.call(table.rows);
      var head = rows.length && rows[0].querySelector('th') ? rows[0] : null;
      var body = head ? rows.slice(1) : rows;
      var top = document.createElement('div');
      top.className = 'tbl-mtop m-only';
      var cap = document.createElement('span');
      cap.className = 'tbl-mtop__t';
      var go = document.createElement('span');
      go.className = 'tbl-mtop__go';
      go.textContent = 'листайте →';
      go.setAttribute('aria-hidden', 'true');
      top.appendChild(cap); top.appendChild(go);
      box.parentNode.insertBefore(top, box);
      var wrap = document.createElement('div');
      wrap.className = 'tbl-mwrap';
      box.parentNode.insertBefore(wrap, box);
      wrap.appendChild(box);
      box._mtop = top; box._wrap = wrap;
      box.addEventListener('scroll', function () { wrap.classList.toggle('is-end', box.scrollLeft + box.clientWidth >= box.scrollWidth - 2); }, { passive: true });
      if (body.length >= MIN_ROWS) {
        var at = 0;
        for (var i = 0; i < body.length; i++) if (body[i].classList.contains('find-row')) { at = Math.max(0, i - 2); break; }
        if (at + FRAG > body.length) at = Math.max(0, body.length - FRAG);
        body.forEach(function (r, k) { if (k < at || k >= at + FRAG) r.setAttribute('data-m-hide', ''); });
        box.classList.add('is-frag');
        var foot = document.createElement('div');
        foot.className = 'tbl-mfoot m-only';
        var note = document.createElement('div');
        note.className = 'tbl-mfoot__x';
        var sticky = !/tbl-norm--c[12]\b/.test(table.className);
        var first = sticky && head && head.cells[0] ? head.cells[0].textContent.trim() : '';
        note.textContent = (first ? 'Колонка «' + first.charAt(0) + first.slice(1).toLowerCase() + '» закреплена. ' : '') +
          'Показано ' + FRAG + ' строк фрагмента из ' + body.length + '.';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn--block tbl-mfoot__b';
        btn.textContent = 'Показать всю таблицу';
        btn.addEventListener('click', function () {
          var open = box.classList.toggle('is-frag');
          btn.textContent = open ? 'Показать всю таблицу' : 'Свернуть таблицу';
          note.hidden = !open;
          if (open) top.scrollIntoView({ block: 'start' });
        });
        foot.appendChild(note); foot.appendChild(btn);
        wrap.parentNode.insertBefore(foot, wrap.nextSibling);
      }
      hint(box);
    });
  }
  function hint(box) {
    var wide = box.scrollWidth > box.clientWidth + 2;
    box.classList.toggle('is-wide', wide);
    if (box._mtop) box._mtop.classList.toggle('is-wide', wide);
    if (box._wrap) box._wrap.classList.toggle('is-wide', wide);
  }

  /* полоса этапов на телефоне: текущий этап виден сразу, без прокрутки полосы (S3-12) */
  function stageStrip() {
    var cur = document.querySelector('.stg-tabs .stg-tab[aria-current]');
    if (!cur) return;
    var strip = cur.parentNode;
    if (strip.scrollWidth <= strip.clientWidth + 2) return;
    strip.scrollLeft = Math.max(0, cur.offsetLeft - strip.offsetLeft - 16);
  }

  function apply() {
    placeholders();
    if (mq.matches) { tables(); stageStrip(); }
    else document.querySelectorAll('.tbl-scroll[data-m-done]').forEach(hint);
  }
  if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
  window.addEventListener('resize', function () { document.querySelectorAll('.tbl-scroll[data-m-done]').forEach(hint); });
})();
