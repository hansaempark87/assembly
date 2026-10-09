(function () {
  const { esc, num, gradeBadge, statusText, loadMembers, partyColor, partyOrder, pct, mean, stackedBar, view } = window.NA;
  const $ = (id) => document.getElementById(id);
  view.manual();

  // Rough geographic placement of the 17 regions plus proportional seats.
  const TILES = [
    ['인천', 0, 0], ['서울', 1, 0], ['경기', 2, 0], ['강원', 3, 0],
    ['충남', 0, 1], ['세종', 1, 1], ['충북', 2, 1], ['경북', 3, 1],
    ['전북', 0, 2], ['대전', 1, 2], ['대구', 2, 2], ['울산', 3, 2],
    ['전남·광주', 0, 3], ['경남', 1, 3], ['부산', 2, 3],
    ['제주', 0, 4], ['비례대표', 2, 4, 2],
  ];
  const GRADES = ['S', 'A', 'B', 'C', 'D'];
  let all = [];
  let cur = '';

  // "경기 남양주시갑" -> "남양주시갑"
  const districtOf = (m) => { const parts = (m.district || '').trim().split(/\s+/); return parts.length > 1 ? parts.slice(1).join(' ') : parts[0]; };

  function gradeBar(list) {
    const segs = [...GRADES.map((g) => [list.filter((m) => m.grade === g).length, `var(--g-${g})`]), [list.filter((m) => !m.grade).length, 'var(--g-none)']]
      .filter(([n]) => n).map(([n, c]) => `<span style="flex:${n};background:${c}"></span>`).join('');
    return `<div class="stack tile-bar">${segs}</div>`;
  }

  function renderTiles() {
    $('tiles').innerHTML = TILES.map(([r, x, y, w = 1]) => {
      const list = all.filter((m) => m.region === r);
      return `<button type="button" class="tile${cur === r ? ' active' : ''}" role="listitem" data-r="${esc(r)}"
          style="grid-column:${x + 1} / span ${w};grid-row:${y + 1}" aria-pressed="${cur === r}">
        <span class="tile-name">${esc(r)}</span><span class="tile-n num">${num(list.length)}명</span>${gradeBar(list)}
      </button>`;
    }).join('');
    $('tile-legend').innerHTML = [...GRADES.map((g) => [`${g}등급`, `var(--g-${g})`]), ['등급 없음', 'var(--g-none)']]
      .map(([l, c]) => `<span><i style="background:${c}"></i>${l}</span>`).join('');
  }

  // summary of the selected region next to the map, against the whole Assembly
  function renderPanel(name, list) {
    const parties = {};
    list.forEach((m) => { parties[m.party] = (parties[m.party] || 0) + 1; });
    const graded = list.filter((m) => m.eligible);
    const allGraded = all.filter((m) => m.eligible);
    const avg = (arr, k) => mean(arr.map((m) => m[k]));
    const cmp = (label, k) => {
      const a = avg(graded, k), b = avg(allGraded, k);
      return `<div class="fact"><span>${label}</span><b class="num">${pct(a)}</b><small>전체 ${pct(b)}</small></div>`;
    };
    $('panel').innerHTML = `<h3 class="panel-title">${esc(name)} <small class="num">${num(list.length)}명</small></h3>
      <div class="panel-sec"><div class="kpi-label">정당</div>
        ${stackedBar(partyOrder(parties).map((p) => ({ label: p, value: parties[p], color: partyColor(p) })), '명')}</div>
      <div class="panel-sec"><div class="kpi-label">등급</div>
        ${stackedBar([...GRADES.map((g) => ({ label: g, value: list.filter((m) => m.grade === g).length, color: `var(--g-${g})` })), { label: '등급 없음', value: list.filter((m) => !m.grade).length, color: 'var(--g-none)' }], '명')}</div>
      <div class="facts panel-sec">${cmp('표결 참여율 평균', 'participation_rate')}${cmp('본회의 출석률 평균', 'attendance_rate')}</div>`;
  }

  function memberRow(m) {
    return `<a class="rrow" href="/member?id=${encodeURIComponent(m.id)}">
      ${gradeBadge(m.grade)}
      <span class="rrow-who"><b>${esc(m.name)}</b><small><i class="dot-key" style="background:${partyColor(m.party)}"></i>${esc(m.party || '')} · ${esc(districtOf(m))}</small></span>
      <span class="rrow-stat num">${m.eligible ? `종합 ${num(m.rank)}위` : esc(statusText(m))}<small>표결 ${pct(m.participation_rate)} · 출석 ${pct(m.attendance_rate)}</small></span>
    </a>`;
  }

  function showList(title, list, sub) {
    $('result-title').textContent = title;
    $('result-sub').textContent = sub;
    $('result').innerHTML = list.length ? `<div class="rlist">${list.map(memberRow).join('')}</div>` : '<p class="muted">해당하는 의원이 없습니다.</p>';
  }

  function summary(list) {
    const graded = list.filter((m) => m.grade);
    const parties = {};
    list.forEach((m) => { parties[m.party] = (parties[m.party] || 0) + 1; });
    const ps = Object.entries(parties).sort((a, b) => b[1] - a[1]).map(([p, n]) => `${p} ${n}`).join(' · ');
    return `${num(list.length)}명 · ${ps}${graded.length ? ` · 등급 S ${graded.filter((m) => m.grade === 'S').length}명, D ${graded.filter((m) => m.grade === 'D').length}명` : ''}`;
  }

  function pick(r, scroll) {
    cur = r;
    view.set('region', { r, q: '' });
    $('q').value = '';
    renderTiles();
    const list = all.filter((m) => m.region === r).sort((a, b) => districtOf(a).localeCompare(districtOf(b), 'ko'));
    showList(r === '비례대표' ? '비례대표 의원' : `${r} 지역구 의원`, list, summary(list));
    renderPanel(r, list);
    if (scroll) $('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function search(q) {
    const key = q.replace(/\s+/g, '');
    view.set('region', { r: '', q });
    if (!key) { if (cur) pick(cur); else showList('지역을 고르세요', [], ''); return; }
    cur = '';
    renderTiles();
    const list = all.filter((m) => m.region !== '비례대표' && (m.district || '').replace(/\s+/g, '').includes(key))
      .sort((a, b) => (a.district || '').localeCompare(b.district || '', 'ko'));
    showList(`"${q}" 검색 결과`, list, list.length ? summary(list) : '시·군·구 이름으로 찾습니다. 동 이름은 아직 지원하지 않습니다.');
    if (list.length) renderPanel(`"${q}"`, list);
  }

  loadMembers().then((d) => {
    all = d.members;
    renderTiles();
    renderPanel('전체', all);
    $('tiles').addEventListener('click', (e) => { const t = e.target.closest('.tile'); if (t) pick(t.dataset.r, true); });
    $('q').addEventListener('input', () => search($('q').value));
    const st = view.get('region', null);
    const qp = new URLSearchParams(window.location.search).get('r');
    if (st && st.q) { $('q').value = st.q; search(st.q); }
    else if (st && st.r) pick(st.r);
    else if (qp && TILES.some((t) => t[0] === qp)) pick(qp);
    view.restoreScroll();
  }).catch((e) => { $('result').innerHTML = `<div class="error">${esc(e.message)}</div>`; });
})();
