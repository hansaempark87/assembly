(function () {
  const { esc, num, kdate, CHOICE, loadVoteIndex, pager, view } = window.NA;
  const $ = (id) => document.getElementById(id);
  const PAGE = 30;
  const BIG_PARTIES = '더불어민주당·국민의힘';

  const KIND = [
    ['law', '법률안', (k) => k === '법률안'],
    ['budget', '예산·결산', (k) => k === '예산안' || k === '결산'],
    ['consent', '동의·승인안', (k) => k === '동의안' || k === '승인안' || k === '중요동의'],
    ['resolution', '결의안', (k) => k === '결의안'],
    ['rule', '규칙안', (k) => k === '규칙안'],
  ];
  const FILTERS = {
    all: [() => true, ''],
    clash: [(v) => v.clash, `${BIG_PARTIES} 의원 다수의 선택이 서로 달랐던 표결`],
    split: [(v) => v.counts[1] + v.counts[2] >= 20, '반대와 기권이 합쳐 20명 이상인 표결'],
    unanimous: [(v) => v.counts[1] + v.counts[2] === 0, '반대·기권이 한 명도 없던 표결'],
    rejected: [(v) => /부결/.test(v.result || ''), '부결된 표결'],
  };
  const voted = (v) => v.counts[0] + v.counts[1] + v.counts[2];
  const SORTS = {
    new: () => 0,
    split: (a, b) => b.counts[1] + b.counts[2] - (a.counts[1] + a.counts[2]),
    yes: (a, b) => a.counts[0] / (voted(a) || 1) - b.counts[0] / (voted(b) || 1),
    absent: (a, b) => b.counts[3] - a.counts[3],
  };

  let all = [];
  view.manual();
  let periods = [];
  const st = { q: '', period: '', area: '', kind: '', sort: 'new', f: 'all', p: 1 };

  // filters live in the address, so a link or the back button reopens the same list
  function readUrl() {
    const u = new URLSearchParams(window.location.search);
    Object.keys(st).forEach((k) => { if (u.has(k)) st[k] = k === 'p' ? Math.max(1, +u.get(k) || 1) : u.get(k); });
  }
  function writeUrl() {
    const u = new URLSearchParams();
    Object.entries(st).forEach(([k, v]) => {
      const def = { sort: 'new', f: 'all', p: 1 }[k] ?? '';
      if (v !== def && v !== '') u.set(k, v);
    });
    const qs = u.toString();
    history.replaceState(history.state, '', qs ? `?${qs}` : window.location.pathname);
  }

  function bar(c) {
    const segs = 'YNAX'.split('').map((k, i) => (c[i] ? `<span style="flex:${c[i]};background:${CHOICE[k].color}"></span>` : '')).join('');
    return `<div class="stack" aria-hidden="true">${segs}</div>`;
  }

  function row(v) {
    const [y, n, a, x] = v.counts;
    return `<a class="vrow" href="/vote?id=${encodeURIComponent(v.id)}">
      <span class="vrow-date num">${kdate(v.date)}</span>
      <span class="vrow-name">${esc(v.name)}<small>${esc(v.area)}${v.kind !== '법률안' ? ` · ${esc(v.kind)}` : ''}${v.clash ? ' · <b class="tag-clash">여야 대립</b>' : ''}</small></span>
      <span class="vrow-result chip${/부결/.test(v.result || '') ? ' chip-bad' : ''}">${esc(v.result || '-')}</span>
      <span class="vrow-bar">${bar(v.counts)}<small class="num">찬성 ${num(y)} · 반대 ${num(n)} · 기권 ${num(a)} · 불참 ${num(x)}</small></span>
    </a>`;
  }

  function filtered() {
    const q = st.q.replace(/\s+/g, '');
    const per = periods.find((p) => p[0] === st.period);
    const kind = KIND.find((k) => k[0] === st.kind);
    const list = all.filter((v) =>
      FILTERS[st.f][0](v) &&
      (!q || v.name.replace(/\s+/g, '').includes(q)) &&
      (!per || per[2](v.date)) &&
      (!st.area || v.area === st.area) &&
      (!kind || kind[2](v.kind)));
    return st.sort === 'new' ? list : [...list].sort((a, b) => SORTS[st.sort](a, b) || (a.date < b.date ? 1 : -1));
  }

  function render() {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (st.p > pages) st.p = pages;
    $('count').textContent = `${num(list.length)}건`;
    $('filter-help').textContent = FILTERS[st.f][1];
    $('list').innerHTML = list.length
      ? list.slice((st.p - 1) * PAGE, st.p * PAGE).map(row).join('')
      : '<p class="muted">조건에 맞는 표결이 없습니다.</p>';
    pager($('pager'), { total: list.length, page: st.p, size: PAGE, anchor: $('vote-card'), onGo: (p) => { st.p = p; render(); } });
    $('filter').querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.f === st.f)));
    $('reset').hidden = !(st.q || st.period || st.area || st.kind || st.f !== 'all' || st.sort !== 'new');
    writeUrl();
  }

  function fill(id, opts) {
    $(id).insertAdjacentHTML('beforeend', opts.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join(''));
  }

  loadVoteIndex().then((d) => {
    all = d.votes;
    const latest = all[0].date;
    const back = (days) => new Date(new Date(latest).getTime() - days * 864e5).toISOString().slice(0, 10);
    const years = [...new Set(all.map((v) => v.date.slice(0, 4)))];
    periods = [
      ['30d', '최근 30일', (d) => d > back(30)],
      ['90d', '최근 90일', (d) => d > back(90)],
      ...years.map((y) => [y, `${y}년`, (d) => d.startsWith(y)]),
    ];
    const count = (f) => Object.entries(all.reduce((o, v) => ((o[f(v)] = (o[f(v)] || 0) + 1), o), {})).sort((a, b) => b[1] - a[1]);
    fill('f-period', periods.map((p) => [p[0], `${p[1]} (${num(all.filter((v) => p[2](v.date)).length)})`]));
    fill('f-area', count((v) => v.area).map(([a, n]) => [a, `${a} (${num(n)})`]));
    fill('f-kind', KIND.map((k) => [k[0], `${k[1]} (${num(all.filter((v) => k[2](v.kind)).length)})`]));
    $('meta').textContent = `${kdate(all[all.length - 1].date)}부터 ${kdate(latest)}까지 제22대 국회 본회의 표결 ${num(all.length)}건`;

    readUrl();
    $('q').value = st.q;
    [['f-period', 'period'], ['f-area', 'area'], ['f-kind', 'kind'], ['f-sort', 'sort']].forEach(([id, k]) => {
      if ([...$(id).options].some((o) => o.value === st[k])) $(id).value = st[k];
      else st[k] = k === 'sort' ? 'new' : '';
      $(id).addEventListener('change', () => { st[k] = $(id).value; st.p = 1; render(); });
    });
    if (!FILTERS[st.f]) st.f = 'all';
    $('q').addEventListener('input', () => { st.q = $('q').value; st.p = 1; render(); });
    $('filter').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (!b) return;
      st.f = b.dataset.f;
      st.p = 1;
      render();
    });
    $('reset').addEventListener('click', () => {
      Object.assign(st, { q: '', period: '', area: '', kind: '', sort: 'new', f: 'all', p: 1 });
      $('q').value = '';
      ['f-period', 'f-area', 'f-kind'].forEach((id) => { $(id).value = ''; });
      $('f-sort').value = 'new';
      render();
    });
    render();
    view.restoreScroll();
  }).catch((e) => { $('list').innerHTML = `<div class="error">${esc(e.message)}</div>`; });
})();
