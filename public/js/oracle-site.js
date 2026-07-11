/* Oracle site chrome — mobile nav, click-to-copy command chips,
   and the ledger controller (search / sort / roman-numeral pagination).
   Replaces DataTables + the old contenteditable/execCommand copy machinery. */

(function () {
  'use strict';

  // ---- mobile nav sheet ----
  var burger = document.querySelector('.os-nav-burger');
  var sheet = document.querySelector('.os-nav-sheet');
  if (burger && sheet) {
    burger.addEventListener('click', function () {
      sheet.classList.toggle('open');
      burger.textContent = sheet.classList.contains('open') ? '✕' : '≡';
    });
  }

  // ---- click-to-copy command chips ----
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('.os-cmd-code');
    if (!chip) return;
    var text = chip.getAttribute('data-copy') || chip.textContent.replace('⧉', '').trim();
    var done = function () {
      chip.classList.add('copied');
      setTimeout(function () { chip.classList.remove('copied'); }, 900);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, done);
    } else {
      done();
    }
  });

  // ---- roman numerals for pagination ----
  function toRoman(n) {
    var map = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
      [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    var out = '';
    for (var i = 0; i < map.length; i++) {
      while (n >= map[i][0]) { out += map[i][1]; n -= map[i][0]; }
    }
    return out || 'I';
  }

  // ---- ledger controller ----
  // Markup contract:
  //   <div class="os-ledger" data-ledger="myid" data-page-size="25"> …rows with data-search / data-<sortkey>… </div>
  //   <input data-ledger-search="myid">
  //   <button class="os-chip" data-ledger-sort="myid" data-key="date" data-dir="desc" data-type="num">
  //   <div class="os-pages" data-ledger-pages="myid"></div>
  document.querySelectorAll('[data-ledger]').forEach(function (ledger) {
    var id = ledger.getAttribute('data-ledger');
    var pageSize = parseInt(ledger.getAttribute('data-page-size'), 10) || 25;
    var allRows = Array.prototype.slice.call(ledger.querySelectorAll('.os-lrow'));
    var searchInput = document.querySelector('[data-ledger-search="' + id + '"]');
    var chips = document.querySelectorAll('[data-ledger-sort="' + id + '"]');
    var pagesEl = document.querySelector('[data-ledger-pages="' + id + '"]');
    var page = 1;
    var query = '';
    var sort = null; // {key, dir, type}

    var firstChip = chips[0];
    if (firstChip) {
      sort = {
        key: firstChip.getAttribute('data-key'),
        dir: firstChip.getAttribute('data-dir') || 'desc',
        type: firstChip.getAttribute('data-type') || 'str'
      };
      firstChip.classList.add('active');
    }

    function visibleRows() {
      var rows = allRows;
      if (query) {
        rows = rows.filter(function (r) {
          return (r.getAttribute('data-search') || r.textContent).toLowerCase().indexOf(query) !== -1;
        });
      }
      if (sort) {
        rows = rows.slice().sort(function (a, b) {
          var av = a.getAttribute('data-' + sort.key) || '';
          var bv = b.getAttribute('data-' + sort.key) || '';
          var cmp;
          if (sort.type === 'num') {
            cmp = (parseFloat(av) || 0) - (parseFloat(bv) || 0);
          } else {
            cmp = av.localeCompare(bv);
          }
          return sort.dir === 'desc' ? -cmp : cmp;
        });
      }
      return rows;
    }

    function render() {
      var rows = visibleRows();
      var totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
      if (page > totalPages) page = totalPages;
      var start = (page - 1) * pageSize;
      var slice = rows.slice(start, start + pageSize);

      allRows.forEach(function (r) { r.style.display = 'none'; });
      slice.forEach(function (r) {
        r.style.display = '';
        ledger.appendChild(r); // reorder to sorted position
      });

      var empty = ledger.querySelector('.os-empty');
      if (!rows.length) {
        if (!empty) {
          empty = document.createElement('div');
          empty.className = 'os-empty';
          empty.textContent = 'The archive holds no such record…';
          ledger.appendChild(empty);
        }
      } else if (empty) {
        empty.remove();
      }

      if (pagesEl) renderPages(rows.length, totalPages);
    }

    function renderPages(total, totalPages) {
      pagesEl.innerHTML = '';
      var count = document.createElement('span');
      count.className = 'count';
      var from = total === 0 ? 0 : (page - 1) * pageSize + 1;
      var to = Math.min(page * pageSize, total);
      count.textContent = 'Showing ' + from + '–' + to + ' of ' + total;
      pagesEl.appendChild(count);

      if (totalPages <= 1) return;

      function btn(label, target, opts) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (opts && opts.current) b.classList.add('current');
        if (opts && opts.disabled) b.disabled = true;
        b.addEventListener('click', function () { page = target; render(); });
        pagesEl.appendChild(b);
      }

      btn('‹', Math.max(1, page - 1), { disabled: page === 1 });
      var shown = [];
      for (var p = 1; p <= totalPages; p++) {
        if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) shown.push(p);
      }
      var last = 0;
      shown.forEach(function (p) {
        if (last && p - last > 1) {
          var gap = document.createElement('span');
          gap.className = 'gap';
          gap.textContent = '…';
          pagesEl.appendChild(gap);
        }
        btn(toRoman(p), p, { current: p === page });
        last = p;
      });
      btn('›', Math.min(totalPages, page + 1), { disabled: page === totalPages });
    }

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        query = searchInput.value.trim().toLowerCase();
        page = 1;
        render();
      });
    }

    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        chips.forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        sort = {
          key: chip.getAttribute('data-key'),
          dir: chip.getAttribute('data-dir') || 'desc',
          type: chip.getAttribute('data-type') || 'str'
        };
        page = 1;
        render();
      });
    });

    render();
  });
})();
