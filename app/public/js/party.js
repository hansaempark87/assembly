(function () {
  const { esc, num, pct, mean, loadMembers, partyColor, stackedBar } = window.NA;
  const $ = (id) => document.getElementById(id);
  const GRADES = ['S', 'A', 'B', 'C', 'D'];
  const short = (p) => ({ 더불어민주당: '민주당', 국민의힘: '국민의힘', 조국혁신당: '조국혁신당' }[p] || p);
  const dot = (p) => `<i class="dot-key" style="background:${partyColor(p)}"></i>`;
  const p1 = (v) => (v === null || v === undefined || Number.isNaN(v) ? '–' : `${(v * 100).toFixed(1)}%`);

  // one row per party in seat order; every party is measured the same way
  function stats(party, ms, P, dissent) {
    const ev = ms.filter((m) => m.eligible);
    const avg = (f) => mean(ev.map(f).filter((v) => v !== null && v !== undefined));
    const d = ms.reduce((acc, m) => { const x = dissent[m.id] || [0, 0]; acc[0] += x[0]; acc[1] += x[1]; return acc; }, [0, 0]);
    const b = P ? P.bills : { lead: 0, passed: 0, alt: 0 };
    return {
      party, ms, ev, P,
      vote: avg((m) => m.participation_rate), att: avg((m) => m.attendance_rate), cmt: avg((m) => m.committee_attendance_rate),
      refl: ms.length ? (b.passed + b.alt) / ms.length : null, reflRate: b.lead ? (b.passed + b.alt) / b.lead : null,
      leadPer: ms.length ? b.lead / ms.length : null,
      coh: P ? P.cohesion : null,
      dissent: party === '무소속' || ms.length < 3 || !d[0] ? null : d[1] / d[0],
      coop: avg((m) => m.coop_index),
    };
  }

  function seatCard(rows, total) {
    return `<section class="card">
      <div class="card-head"><div><h2 class="card-title">의석 구성</h2><p class="card-sub">현재 재적 ${num(total)}명 · 현재 소속 기준</p></div></div>
      ${stackedBar(rows.map((r) => ({ label: r.party, value: r.ms.length, color: partyColor(r.party) })), '석')}
    </section>`;
  }

  const COLS = [
    ['vote', '표결 참여율', p1, 1], ['att', '본회의 출석률', p1, 1], ['cmt', '위원회 출석률', p1, 1],
    ['refl', '1인당 법 반영', (v) => (v === null ? '–' : `${v.toFixed(1)}건`), null],
    ['coh', '표결 결속도', p1, 1], ['dissent', '당과 다르게 투표', p1, null], ['coop', '다른 당과 공동발의', p1, 1],
  ];
  function compareTable(rows) {
    const maxOf = (k) => Math.max(...rows.map((r) => r[k] || 0));
    return `<section class="card section">
      <div class="card-head"><div><h2 class="card-title">한눈에 비교</h2>
        <p class="card-sub">의원 평균은 평가 대상 의원 기준 · 막대는 각 열의 최댓값 대비 · 소속 3명 미만이거나 무소속이면 일부 항목 제외</p></div></div>
      <div class="pt-wrap"><table class="pt">
        <thead><tr><th>정당</th><th>의석</th>${COLS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr><th>${dot(r.party)}${esc(short(r.party))}</th><td class="num">${num(r.ms.length)}</td>${COLS.map(([k, , f, cap]) => {
          const v = r[k];
          const w = v === null || v === undefined ? 0 : (v / (cap || maxOf(k) || 1)) * 100;
          return `<td><span class="pt-cell"><span class="pt-bar" style="width:${Math.min(100, w).toFixed(1)}%;background:${partyColor(r.party)}"></span><b class="num">${f(v)}</b></span></td>`;
        }).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <p class="card-foot">표결 결속도 = 그날 같은 정당 의원 다수와 같은 선택을 한 표의 비율 · 다른 당과 공동발의 = 대표발의 법안의 공동발의자 중 다른 정당 의원 비율(초당적 협력 지수)</p>
    </section>`;
  }

  function partyCard(r) {
    const grades = stackedBar([...GRADES.map((g) => ({ label: g, value: r.ms.filter((m) => m.grade === g).length, color: `var(--g-${g})` })),
      { label: '등급 없음', value: r.ms.filter((m) => !m.grade).length, color: 'var(--g-none)' }], '명');
    const top = [...r.ev].sort((a, b) => a.rank - b.rank).slice(0, 5);
    const areas = r.P ? r.P.bills.areas : [];
    const b = r.P ? r.P.bills : null;
    return `<section class="card party-card">
      <div class="card-head"><div><h2 class="card-title">${dot(r.party)}${esc(r.party)} <span class="muted num">${num(r.ms.length)}명</span></h2>
        <p class="card-sub">평가 대상 ${num(r.ev.length)}명</p></div></div>
      <div class="pm-sec"><div class="kpi-label">등급 구성</div>${grades}</div>
      ${b ? `<div class="pm-sec"><div class="kpi-label">대표발의 법안</div>
        <p class="plain">${num(b.lead)}건 발의 · 가결 ${num(b.passed)}건 · 대안반영 ${num(b.alt)}건 · 법 반영률 <b>${p1(r.reflRate)}</b></p></div>` : ''}
      ${areas.length ? `<div class="pm-sec"><div class="kpi-label">많이 발의한 분야</div><div class="chips">${areas.map(([a, , share]) => `<span class="chip">${esc(a)} <b class="num">${Math.round(share * 100)}%</b></span>`).join('')}</div></div>` : ''}
      ${top.length ? `<div class="pm-sec"><div class="kpi-label">종합 순위 상위 의원</div><ol class="pc-top">${top.map((m) => `<li><a href="/member?id=${encodeURIComponent(m.id)}">${esc(m.name)}</a> <span class="muted num">${m.rank}위 · ${esc(m.grade)}</span></li>`).join('')}</ol></div>` : ''}
    </section>`;
  }

  // how often two parties' majorities chose the same, as a grid
  function agreeCard(D, names) {
    const box = (list) => {
      const get = (a, b) => list.find((x) => (x[0] === a && x[1] === b) || (x[0] === b && x[1] === a));
      return `<div class="pt-wrap"><table class="agree-grid"><thead><tr><th></th>${names.map((p) => `<th>${dot(p)}${esc(short(p))}</th>`).join('')}</tr></thead>
        <tbody>${names.map((a) => `<tr><th>${dot(a)}${esc(short(a))}</th>${names.map((b) => {
          if (a === b) return '<td class="ag-self">–</td>';
          const x = get(a, b);
          if (!x) return '<td class="muted">·</td>';
          return `<td style="--a:${(0.08 + x[2] * 0.5).toFixed(2)}" title="${esc(`${a} · ${b}: ${x[3]}건 중 ${Math.round(x[2] * x[3])}건 같은 선택`)}"><b class="num">${Math.round(x[2] * 100)}%</b></td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>`;
    };
    return `<section class="card section" id="agree-card">
      <div class="card-head"><div><h2 class="card-title">정당 간 표결 일치율</h2>
        <p class="card-sub">두 정당의 다수 의견(그날 소속 의원 다수의 선택)이 같았던 표결의 비율 · 소속 3명 이상 정당</p></div>
        <div class="tabs" role="tablist"><button type="button" class="tab" role="tab" data-k="split" aria-selected="true">의견이 갈린 표결</button><button type="button" class="tab" role="tab" data-k="all" aria-selected="false">모든 표결</button></div></div>
      <div id="agree-body">${box(D.agree_split)}</div>
      <p class="card-foot">"의견이 갈린 표결"은 정당들의 다수 의견이 모두 같지는 않았던 표결만 셉니다. 대부분의 법안은 모든 정당이 찬성해 통과하므로, 차이는 이쪽에서 잘 보입니다.</p>
    </section>`;
  }

  // monthly averages per party (3 seats or more)
  const TR = [['vote', '표결 참여율', true], ['att', '본회의 출석률', true], ['bills', '1인당 대표발의', false]];
  function trendCard() {
    return `<section class="card section" id="ptrend"><h2 class="card-title">월별 추이</h2><div class="skeleton">불러오는 중…</div></section>`;
  }
  function drawTrend(D, parties) {
    const el = $('ptrend');
    let cur = 'vote';
    const on = new Set(parties.slice(0, 3)); // the three largest by default; small parties swing month to month
    const draw = () => {
      const [key, label, isRate] = TR.find((t) => t[0] === cur);
      const series = parties.filter((p) => on.has(p)).map((p) => {
        const P = D.parties.find((x) => x.party === p);
        const raw = P.trend[key];
        return { p, vals: key === 'bills' ? raw.map((v) => (v === null ? null : v)) : raw };
      });
      const months = D.months;
      const W = Math.max(300, Math.min(1000, el.clientWidth - 40)), H = W < 500 ? 210 : 260, L = 40, R = 10, T = 14, Bm = 30;
      const vals = series.flatMap((s) => s.vals).filter((v) => v !== null && v !== undefined);
      const max = isRate ? 1 : Math.max(1, ...vals) * 1.15;
      const lo = isRate ? Math.min(0.5, Math.floor(Math.min(...vals, 1) * 10) / 10) : 0;
      const x = (i) => L + (i * (W - L - R)) / Math.max(1, months.length - 1);
      const y = (v) => T + (1 - (v - lo) / (max - lo)) * (H - T - Bm);
      const path = (arr) => arr.reduce((acc, v, i) => (v === null || v === undefined ? acc : `${acc}${i === 0 || arr[i - 1] === null || arr[i - 1] === undefined ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`), '');
      const ticks = (isRate ? [lo, (lo + 1) / 2, 1] : [0, max / 2, max]).map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="tr-grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="tr-tick">${isRate ? `${Math.round(v * 100)}%` : Math.round(v)}</text>`).join('');
      const xl = months.map((mo, i) => (mo.endsWith('-01') || i === 0 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="tr-tick">${mo.slice(2, 4)}.${Number(mo.slice(5))}월</text>` : '')).join('');
      el.innerHTML = `<div class="card-head"><div><h2 class="card-title">월별 추이</h2>
          <p class="card-sub">정당별 소속 의원 평균 · 현재 소속 기준 · 소속 3명 이상 정당 · 이번 달은 진행 중인 값${cur === 'att' ? ' · 본회의 출석은 국회가 공개한 달까지' : ''}</p></div>
          <div class="tabs" role="tablist">${TR.map(([k, l]) => `<button type="button" class="tab" role="tab" data-k="${k}" aria-selected="${k === cur}">${l}</button>`).join('')}</div></div>
        <svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="${esc(`정당별 ${label} 월별 추이`)}">${ticks}${xl}
          ${series.map((s) => `<path d="${path(s.vals)}" fill="none" stroke="${partyColor(s.p)}" stroke-width="2.5" stroke-linejoin="round"/>`).join('')}</svg>
        <div class="chips pt-pick" aria-label="표시할 정당">${parties.map((p) => `<button type="button" class="chip${on.has(p) ? ' on' : ''}" data-p="${esc(p)}" aria-pressed="${on.has(p)}"><i class="dot-key" style="background:${partyColor(p)}"></i>${esc(p)}</button>`).join('')}</div>
        <p class="card-sub">정당을 눌러 켜고 끌 수 있습니다. 소속 의원이 적은 정당은 한두 명의 출결로 값이 크게 움직입니다.</p>`;
      el.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { cur = b.dataset.k; draw(); }));
      el.querySelectorAll('.pt-pick .chip').forEach((b) => b.addEventListener('click', () => {
        if (on.has(b.dataset.p)) { if (on.size > 1) on.delete(b.dataset.p); } else on.add(b.dataset.p);
        draw();
      }));
    };
    draw();
  }

  Promise.all([
    loadMembers(),
    fetch('/party-data.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch('/vote-data/dissent.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]).then(([data, D, dissent]) => {
    const groups = {};
    data.members.forEach((m) => (groups[m.party || '무소속'] ||= []).push(m));
    const order = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length || (a === '무소속') - (b === '무소속'));
    const rows = order.map((p) => stats(p, groups[p], D && D.parties.find((x) => x.party === p), dissent));
    $('meta').textContent = `제22대 국회 ${order.length}개 정당·무소속 · 의원 ${num(data.members.length)}명 · ${data.run.data_as_of} 기준`;
    const big = order.filter((p) => p !== '무소속' && groups[p].length >= 3);
    $('parties').innerHTML = `${seatCard(rows, data.members.length)}${compareTable(rows)}
      ${D ? agreeCard(D, big) : ''}
      ${D ? trendCard() : ''}
      <h2 class="section-title section">정당별 상세</h2>
      <div class="grid grid-2">${rows.map(partyCard).join('')}</div>`;
    if (D) {
      drawTrend(D, big);
      document.querySelectorAll('#agree-card .tab').forEach((b) => b.addEventListener('click', () => {
        document.querySelectorAll('#agree-card .tab').forEach((t) => t.setAttribute('aria-selected', String(t === b)));
        const tmp = document.createElement('div');
        tmp.innerHTML = agreeCard({ ...D, agree_split: b.dataset.k === 'all' ? D.agree : D.agree_split }, big);
        $('agree-body').innerHTML = tmp.querySelector('#agree-body').innerHTML;
      }));
    }
  }).catch((e) => { $('parties').innerHTML = `<div class="card error">${esc(e.message)}</div>`; });
})();
