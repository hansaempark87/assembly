(function () {
  const { esc, num, pager, PL, PL_COL, pledgeRing, pledgeRows, pledgeLegend } = window.NA;
  const $ = (id) => document.getElementById(id);
  const PAGE = 30;
  const st = { party: '', region: '', q: '', p: 1 };
  let D = null;
  const regionOf = (d) => (d || '').split(' ')[0].slice(0, 2);

  function summary() {
    const ms = D.members;
    const zero = ms.filter((m) => m.rate === 0).length;
    $('pl-summary').innerHTML = `<div class="pl-hero">${pledgeRing(D.total, '전체 이행률')}
      <div><div class="pl-name">지역구 의원 ${num(ms.length)}명 · 공약 ${num(D.total.reduce((a, b) => a + b, 0))}개</div>
        <div class="pl-meta">${esc((D.checked || '').replace(/-/g, '.'))} 확인 · 국회 의안 기록과 언론 보도로 판정</div>
        ${pledgeRows(D.total)}</div></div>
      <div class="pl-chips"><span class="pl-chip">의원 평균 이행률 <b>${D.avg}%</b></span><span class="pl-chip">완료된 공약이 하나도 없는 의원 <b>${num(zero)}명</b></span></div>`;
  }

  function board() {
    const q = st.q.replace(/\s+/g, '');
    const rows = D.members.filter((m) => (!st.party || m.party === st.party) && (!st.region || regionOf(m.district) === st.region) && (!q || m.name.includes(q)));
    $('pl-sub').textContent = `이행률(완료 ÷ 전체) 높은 순 · 같으면 진행 중 비율 순 · ${num(rows.length)}명`;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (st.p > pages) st.p = pages;
    $('pl-board').innerHTML = rows.length ? rows.slice((st.p - 1) * PAGE, st.p * PAGE).map((m) => {
      const rank = D.members.indexOf(m) + 1;
      return `<a class="pl-brow" href="/member?id=${encodeURIComponent(m.id)}#pledges">
        <span class="rk num">${num(rank)}</span>
        <span><b>${esc(m.name)}</b><small>${esc(m.party)} · ${esc(m.district)}</small></span>
        <span class="pl-bar" role="img" aria-label="${esc(`완료 ${m.c[0]}, 진행 중 ${m.c[1]}, 지연·보류 ${m.c[2]}, 데이터 없음 ${m.c[3]}`)}">${PL.map((k, i) => `<i style="width:${((m.c[i] / m.n) * 100).toFixed(1)}%;background:${PL_COL[k]}"></i>`).join('')}</span>
        <span class="pct num">${m.rate}%</span></a>`;
    }).join('') + pledgeLegend() : '<p class="muted">해당하는 의원이 없습니다.</p>';
    pager($('pl-more'), { total: rows.length, page: st.p, size: PAGE, anchor: $('pl-board-card'), onGo: (p) => { st.p = p; board(); } });
  }

  fetch('/pledge-data.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error('공약 데이터를 불러오지 못했습니다')))).then((d) => {
    D = d;
    const parties = [...new Set(D.members.map((m) => m.party))].sort((a, b) => D.members.filter((m) => m.party === b).length - D.members.filter((m) => m.party === a).length);
    const regions = [...new Set(D.members.map((m) => regionOf(m.district)))].sort((a, b) => a.localeCompare(b, 'ko'));
    $('pl-party').innerHTML = `<option value="">전체 정당</option>${parties.map((p) => `<option>${esc(p)}</option>`).join('')}`;
    $('pl-region').innerHTML = `<option value="">전체 지역</option>${regions.map((r) => `<option>${esc(r)}</option>`).join('')}`;
    $('pl-party').addEventListener('change', (e) => { st.party = e.target.value; st.p = 1; board(); });
    $('pl-region').addEventListener('change', (e) => { st.region = e.target.value; st.p = 1; board(); });
    $('pl-q').addEventListener('input', (e) => { st.q = e.target.value; st.p = 1; board(); });
    summary();
    board();
  }).catch((e) => { $('pl-summary').innerHTML = `<p class="error">${esc(e.message)}</p>`; });
})();
