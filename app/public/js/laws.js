(function () {
  const { esc, num, kdate, pager, view, CHOICE } = window.NA;
  const $ = (id) => document.getElementById(id);
  const PAGE = 20;
  view.manual();

  const STATUS = {
    P: ['가결', 'st-passed'], A: ['대안반영', 'st-alt'], N: ['계류', 'st-pending'], W: ['철회', 'st-withdrawn'], R: ['폐기·부결', 'st-rejected'],
  };
  const TABS = [['all', '전체', () => true], ['done', '법에 반영', (b) => b.st === 'P' || b.st === 'A'],
    ['P', '가결', (b) => b.st === 'P'], ['N', '계류 중', (b) => b.st === 'N']];
  const likms = (id) => `https://likms.assembly.go.kr/bill/billDetail.do?billId=${encodeURIComponent(id)}`;

  let home = null;
  let index = null; // lazily loaded search index
  let loading = null;
  const st = { q: '', topic: '', tab: 'all', p: 1 };

  // Bills with the same name decided the same way on the same day were merged
  // into one alternative bill: show them as one row with every lead sponsor.
  function group(list) {
    const out = [];
    const at = new Map();
    for (const b of list) {
      if (!b.decided) { out.push(b); continue; }
      const key = `${b.name}|${b.st}|${b.decided}`;
      const g = at.get(key);
      if (g) {
        g.count += 1;
        g.co += b.co;
        for (const l of b.leads) if (!g.leads.some((x) => x[0] === l[0])) g.leads.push(l);
        g.vote = g.vote || b.vote;
      } else {
        const c = { ...b, leads: [...b.leads], count: 1 };
        at.set(key, c);
        out.push(c);
      }
    }
    return out;
  }

  // one bill: { id, name, proposed, st, decided, leads: [[id, name]], co, vote }
  function billRow(b) {
    const [label, cls] = STATUS[b.st] || ['', ''];
    const named = b.leads.filter((l) => l[1]);
    const leads = named.slice(0, 4).map(([id, name]) => `<a href="/member?id=${encodeURIComponent(id)}">${esc(name)}</a>`).join(', ')
      + (named.length > 4 ? ` 등 ${num(named.length)}명` : '');
    const when = b.decided ? `${label} ${kdate(b.decided)}` : `발의 ${kdate(b.proposed)}`;
    return `<div class="law-row">
      <span class="bill-st ${cls}">${label}</span>
      <div class="law-main">
        <a class="law-name" href="${likms(b.id)}" target="_blank" rel="noopener">${esc(b.name)}</a>
        <small>${when} · 대표발의 ${leads || '-'}${b.count > 1 ? ` · 같은 법 개정안 ${num(b.count)}건을 합쳐 처리` : b.co ? ` 외 공동발의 ${num(b.co)}명` : ''}${b.area ? ` · ${esc(b.area)}` : ''}</small>
      </div>
      ${b.vote ? `<a class="btn btn-sm" href="/vote?id=${encodeURIComponent(b.id)}">표결 보기</a>` : ''}
    </div>`;
  }

  function voteRow(v) {
    const [y, n, a] = v.counts;
    const bar = 'YNAX'.split('').map((k, i) => (v.counts[i] ? `<span style="flex:${v.counts[i]};background:${CHOICE[k].color}"></span>` : '')).join('');
    return `<a class="law-row law-vote" href="/vote?id=${encodeURIComponent(v.id)}">
      <span class="bill-st ${/부결/.test(v.result || '') ? 'st-rejected' : 'st-passed'}">${esc(v.result || '')}</span>
      <div class="law-main"><span class="law-name">${esc(v.name)}</span>
        <div class="stack" aria-hidden="true">${bar}</div>
        <small>${kdate(v.date)} · 찬성 ${num(y)} · 반대 ${num(n)} · 기권 ${num(a)}</small></div>
    </a>`;
  }

  function renderHome() {
    const c = home.counts;
    const tile = (label, n, meta) => `<div class="card kpi"><div class="kpi-label">${label}</div><div class="kpi-value num">${num(n)}<small>건</small></div><div class="kpi-meta">${meta}</div></div>`;
    $('meta').textContent = `제22대 국회의원이 발의한 법안 ${num(home.total)}건 · ${kdate(home.cutoff)} 기준`;
    $('kpis').innerHTML = tile('의원 발의 법안', home.total, '대표발의 기준')
      + tile('그대로 가결', c.passed, `전체의 ${((c.passed / home.total) * 100).toFixed(1)}%`)
      + tile('대안에 반영', c.alt, '비슷한 법안과 합쳐 처리')
      + tile('계류 중', c.pending, '아직 처리되지 않음');
    $('topics').innerHTML = home.topics.map((t) => `<button type="button" class="topic" data-k="${t.key}" aria-pressed="false">
      <b>${esc(t.label)}</b><small class="num">${num(t.total)}건 · 반영 ${num(t.passed + t.alt)}</small></button>`).join('');
    $('clash').innerHTML = home.clash.map(voteRow).join('');
    $('recent').innerHTML = group(home.recent).map(billRow).join('');
    $('popular').innerHTML = home.popular.map(billRow).join('');
  }

  function loadIndex() {
    if (index) return Promise.resolve(index);
    if (!loading) {
      loading = fetch('/law-data/all.json').then((r) => r.json()).then((d) => {
        index = d.bills.map((b) => ({
          id: b[0], name: b[1], proposed: b[2], st: b[3], decided: b[4] || null, area: d.areas[b[5]],
          leads: b[6].map((k) => d.people[k]), co: b[7], vote: !!b[8],
        }));
        index.forEach((b) => { b.key = (b.name + ' ' + b.leads.map((l) => l[1]).join(' ')).replace(/\s+/g, ''); });
        return index;
      });
    }
    return loading;
  }

  // everyday words people type -> words that appear in law names
  const SYN = {
    반려견: ['동물보호', '반려'], 강아지: ['동물보호', '반려'], 고양이: ['동물보호', '반려'], 반려동물: ['동물보호', '반려'],
    전세: ['주택임대차', '전세'], 월세: ['주택임대차'], 집값: ['부동산', '주택'], 의대: ['의과대학', '의료', '의사'],
    병원: ['의료법', '응급의료'], 의사: ['의료', '의사'], 월급: ['근로기준', '최저임금', '임금'], 알바: ['근로기준', '최저임금'],
    출산: ['출산', '저출', '모자보건'], 육아: ['육아', '영유아', '아이돌봄'], 어린이집: ['영유아보육'], 학교: ['교육', '학교'],
    인공지능: ['인공지능'], ai: ['인공지능'], AI: ['인공지능'], 개인정보: ['개인정보'], 보이스피싱: ['전기통신금융사기'],
    연금: ['연금'], 담배: ['담배', '국민건강증진'], 술: ['주세', '국민건강증진'], 게임: ['게임'], 택시: ['여객자동차'],
    전기차: ['자동차', '전기'], 음주운전: ['도로교통'], 스토킹: ['스토킹'], 마약: ['마약'], 교통사고: ['교통사고', '도로교통'],
  };
  const expand = (w) => [w, ...(SYN[w] || [])];

  function matcher() {
    if (st.topic) {
      const t = home.topics.find((x) => x.key === st.topic);
      return (b) => t.words.some((w) => b.name.includes(w));
    }
    const terms = st.q.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/\s+/g, ''));
    return (b) => terms.every((w) => expand(w).some((x) => b.key.includes(x)));
  }

  function writeUrl() {
    const u = new URLSearchParams();
    if (st.q) u.set('q', st.q);
    if (st.topic) u.set('topic', st.topic);
    if (st.tab !== (st.topic ? 'done' : 'all')) u.set('tab', st.tab);
    if (st.p > 1) u.set('p', st.p);
    const qs = u.toString();
    history.replaceState(history.state, '', qs ? `?${qs}` : location.pathname);
  }

  async function search() {
    const active = !!(st.q.trim() || st.topic);
    $('results').hidden = !active;
    $('home').hidden = active;
    $('kpis').hidden = active;
    $('topics').querySelectorAll('.topic').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === st.topic)));
    writeUrl();
    if (!active) return;
    $('list').innerHTML = '<p class="muted">법안 목록을 불러오는 중…</p>';
    const all = await loadIndex();
    const base = all.filter(matcher());
    const tab = TABS.find((t) => t[0] === st.tab) || TABS[0];
    const raw = base.filter(tab[2]).sort((a, b) => (b.decided || b.proposed).localeCompare(a.decided || a.proposed));
    const list = group(raw);
    $('st-tabs').innerHTML = TABS.map(([k, label, f]) => `<button type="button" class="tab" role="tab" data-k="${k}" aria-selected="${k === st.tab}">${label} ${num(base.filter(f).length)}</button>`).join('');
    const label = st.topic ? home.topics.find((x) => x.key === st.topic).label : `"${st.q.trim()}"`;
    $('count').textContent = `${label} · ${num(raw.length)}건`;
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    if (st.p > pages) st.p = pages;
    $('list').innerHTML = list.length ? list.slice((st.p - 1) * PAGE, st.p * PAGE).map(billRow).join('')
      : '<p class="muted">찾는 법안이 없습니다. 더 짧은 단어로 검색해 보세요 (예: "전세사기" 대신 "전세").</p>';
    pager($('pager'), { total: list.length, page: st.p, size: PAGE, anchor: $('search-card'), onGo: (p) => { st.p = p; search(); } });
  }

  fetch('/law-data/home.json').then((r) => r.json()).then((d) => {
    home = d;
    renderHome();
    const u = new URLSearchParams(location.search);
    st.q = u.get('q') || '';
    st.topic = home.topics.some((t) => t.key === u.get('topic')) ? u.get('topic') : '';
    st.tab = TABS.some((t) => t[0] === u.get('tab')) ? u.get('tab') : st.topic ? 'done' : 'all';
    st.p = Math.max(1, +u.get('p') || 1);
    $('q').value = st.q;
    let timer = null;
    $('q').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { st.q = $('q').value; st.topic = ''; st.tab = 'all'; st.p = 1; search(); }, 200);
    });
    $('topics').addEventListener('click', (e) => {
      const b = e.target.closest('.topic');
      if (!b) return;
      st.topic = st.topic === b.dataset.k ? '' : b.dataset.k;
      st.q = '';
      $('q').value = '';
      st.p = 1;
      st.tab = st.topic ? 'done' : 'all';
      search().then(() => $('search-card').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    });
    $('st-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (!b) return;
      st.tab = b.dataset.k;
      st.p = 1;
      search();
    });
    search().then(() => view.restoreScroll());
  }).catch((e) => { $('meta').textContent = `불러오지 못했습니다: ${e.message}`; });
})();
