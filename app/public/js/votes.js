(function () {
  const { esc, num, kdate, CHOICE, loadVoteIndex } = window.NA;
  const $ = (id) => document.getElementById(id);
  const PAGE = 50;
  let all = [];
  let shown = PAGE;
  let filter = 'all';

  const FILTERS = {
    all: () => true,
    split: (v) => v.counts[1] + v.counts[2] >= 20,
    rejected: (v) => /부결/.test(v.result || ''),
  };

  function bar(c) {
    const segs = 'YNAX'.split('').map((k, i) => (c[i] ? `<span style="flex:${c[i]};background:${CHOICE[k].color}"></span>` : '')).join('');
    return `<div class="stack" aria-hidden="true">${segs}</div>`;
  }

  function row(v) {
    const [y, n, a, x] = v.counts;
    return `<a class="vrow" href="/vote?id=${encodeURIComponent(v.id)}">
      <span class="vrow-date num">${kdate(v.date)}</span>
      <span class="vrow-name">${esc(v.name)}</span>
      <span class="vrow-result chip${/부결/.test(v.result || '') ? ' chip-bad' : ''}">${esc(v.result || '-')}</span>
      <span class="vrow-bar">${bar(v.counts)}<small class="num">찬성 ${num(y)} · 반대 ${num(n)} · 기권 ${num(a)} · 불참 ${num(x)}</small></span>
    </a>`;
  }

  function render() {
    const q = $('q').value.replace(/\s+/g, '');
    const list = all.filter(FILTERS[filter]).filter((v) => !q || v.name.replace(/\s+/g, '').includes(q));
    $('count').textContent = `${num(list.length)}건`;
    $('list').innerHTML = list.length ? list.slice(0, shown).map(row).join('') : '<p class="muted">조건에 맞는 표결이 없습니다.</p>';
    $('more').hidden = list.length <= shown;
  }

  loadVoteIndex().then((d) => {
    all = d.votes;
    const first = all[all.length - 1];
    $('meta').textContent = `${kdate(first.date)}부터 ${kdate(all[0].date)}까지 제22대 국회 본회의 표결 ${num(all.length)}건`;
    $('q').addEventListener('input', () => { shown = PAGE; render(); });
    $('more').addEventListener('click', () => { shown += PAGE; render(); });
    $('filter').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (!b) return;
      filter = b.dataset.f;
      shown = PAGE;
      $('filter').querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t === b)));
      render();
    });
    render();
  }).catch((e) => { $('list').innerHTML = `<div class="error">${esc(e.message)}</div>`; });
})();
