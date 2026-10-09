(function () {
  const { esc, num, pct, mean, gradeBadge, loadMembers, partyColor, partyOrder, stackedBar } = window.NA;
  const $ = (id) => document.getElementById(id);
  const GRADES = ['S', 'A', 'B', 'C', 'D'];

  function metric(label, value, fill, note) {
    return `<div class="pm-row"><span class="pm-label">${label}</span>
      <div class="meter"><div class="meter-fill" style="width:${Math.max(0, Math.min(100, fill)).toFixed(1)}%"></div></div>
      <span class="pm-val num">${value}${note ? `<small>${note}</small>` : ''}</span></div>`;
  }

  function card(party, ms, dissent) {
    const ev = ms.filter((m) => m.eligible);
    const avg = (k) => mean(ev.map((m) => m[k]));
    const d = ms.reduce((acc, m) => { const x = dissent[m.id] || [0, 0]; acc[0] += x[0]; acc[1] += x[1]; return acc; }, [0, 0]);
    const best = [...ev].sort((a, b) => a.rank - b.rank)[0];
    const grades = stackedBar([...GRADES.map((g) => ({ label: g, value: ms.filter((m) => m.grade === g).length, color: `var(--g-${g})` })),
      { label: '등급 없음', value: ms.filter((m) => !m.grade).length, color: 'var(--g-none)' }], '명');
    return `<section class="card party-card">
      <div class="card-head"><div>
        <h2 class="card-title"><i class="dot-key" style="background:${partyColor(party)}"></i>${esc(party)} <span class="muted num">${num(ms.length)}명</span></h2>
        <p class="card-sub">평가 대상 ${num(ev.length)}명${best ? ` · 최고 순위 <a href="/member?id=${encodeURIComponent(best.id)}">${esc(best.name)}</a> ${best.rank}위` : ''}</p>
      </div></div>
      <div class="pm-sec"><div class="kpi-label">등급 구성</div>${grades}</div>
      ${ev.length ? `<div class="pm-sec">
        ${metric('종합 백분위 평균', avg('composite_percentile').toFixed(1), avg('composite_percentile'), '50 = 전체 중간')}
        ${metric('표결 참여율', pct(avg('participation_rate')), avg('participation_rate') * 100)}
        ${metric('본회의 출석률', pct(avg('attendance_rate')), avg('attendance_rate') * 100)}
        ${metric('위원회 출석률', pct(avg('committee_attendance_rate')), avg('committee_attendance_rate') * 100)}
        ${metric('법안 반영 (1인 평균)', `${avg('lead_reflected').toFixed(1)}건`, 0)}
        ${party === '무소속' || ms.length < 3
          ? metric('당과 다르게 투표', '해당 없음', 0, party === '무소속' ? '무소속은 비교 대상 없음' : '소속 3명 미만')
          : metric('당과 다르게 투표', `${((d[1] / d[0]) * 100).toFixed(1)}%`, (d[1] / d[0]) * 100 * 5, `${num(d[1])} / ${num(d[0])}표`)}
      </div>` : '<p class="muted">평가 대상 의원이 없습니다.</p>'}
    </section>`;
  }

  Promise.all([loadMembers(), fetch('/vote-data/dissent.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}))])
    .then(([data, dissent]) => {
      const groups = {};
      data.members.forEach((m) => (groups[m.party || '무소속'] ||= []).push(m));
      const counts = Object.fromEntries(Object.entries(groups).map(([p, ms]) => [p, ms.length]));
      const order = partyOrder(counts).sort((a, b) => counts[b] - counts[a]);
      $('meta').textContent = `제22대 국회 ${order.length}개 정당·무소속 · 의원 ${num(data.members.length)}명 · ${data.run.data_as_of} 기준`;
      $('parties').innerHTML = order.map((p) => card(p, groups[p], dissent)).join('');
    })
    .catch((e) => { $('parties').innerHTML = `<div class="card error">${esc(e.message)}</div>`; });
})();
