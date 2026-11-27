(function () {
  const { esc, num, kdate, pager, partyColor } = window.NA;
  const $ = (id) => document.getElementById(id);
  const PAGE = 20;
  const st = { cat: '', q: '', p: 1 };
  let D = null;

  // weekly line chart; series: [{name, color, vals}] aligned to dates
  function lineChart(el, { dates, series, fmt, lo = 0, hi = 100 }) {
    const W = Math.max(300, Math.min(1000, el.clientWidth || 700)), H = W < 500 ? 210 : 260, L = 36, R = 10, T = 12, B = 28;
    const x = (i) => L + (i * (W - L - R)) / Math.max(1, dates.length - 1);
    const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const path = (vals) => vals.reduce((a, v, i) => (v === null || v === undefined ? a : `${a}${i === 0 || vals[i - 1] === null || vals[i - 1] === undefined ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`), '');
    const ticks = [lo, (lo + hi) / 2, hi].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="tr-grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="tr-tick">${v}%</text>`).join('');
    let lastM = '';
    const xl = dates.map((d, i) => { const m = d.slice(0, 7); if (m === lastM || !(d.slice(5, 7) === '01' || i === 0)) { lastM = m; return ''; } lastM = m; return `<text x="${x(i)}" y="${H - 8}" text-anchor="middle" class="tr-tick">${d.slice(2, 4)}.${Number(d.slice(5, 7))}월</text>`; }).join('');
    const ends = series.map((s) => { let k = s.vals.length - 1; while (k >= 0 && (s.vals[k] === null || s.vals[k] === undefined)) k -= 1; return k < 0 ? '' : `<circle cx="${x(k).toFixed(1)}" cy="${y(s.vals[k]).toFixed(1)}" r="3.5" fill="${s.color}"/>`; }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="${esc(series.map((s) => `${s.name} 최근 ${fmt(s.vals[s.vals.length - 1])}`).join(', '))}">${ticks}${xl}
      ${series.map((s) => `<path d="${path(s.vals)}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round"/>`).join('')}${ends}</svg>
      <div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)} <b class="num">${fmt(s.vals[s.vals.length - 1])}</b></span>`).join('')}</div>`;
  }
  const pct = (v) => (v === null || v === undefined ? '–' : `${v}%`);
  const diff = (a, b) => (a === null || b === null || a === undefined || b === undefined ? '' : a === b ? '<small class="muted">전주와 같음</small>' : `<small class="muted">전주 대비 ${a > b ? '+' : ''}${a - b}%p</small>`);

  function kpis() {
    const P = D.president, last = P[P.length - 1], prev = P[P.length - 2] || [];
    const party = D.parties.length ? D.parties[D.parties.length - 1][1] : {};
    const pprev = D.parties.length > 1 ? D.parties[D.parties.length - 2][1] : {};
    const top = D.party_names.filter((n) => n !== '무당층').slice(0, 2);
    $('po-kpis').innerHTML = `
      <div class="card"><div class="kpi-label">대통령 직무 긍정 평가${last ? ` · ${esc(last[3])}` : ''}</div><div class="kpi-value num">${pct(last && last[1])}</div><div class="kpi-meta">부정 ${pct(last && last[2])} ${diff(last && last[1], prev[1])}</div></div>
      ${D.blackout ? '<div class="card"><div class="kpi-label">정당 지지도</div><div class="kpi-meta">선거일 전 6일간은 공표할 수 없어 표시하지 않습니다.</div></div>'
        : top.map((n) => `<div class="card"><div class="kpi-label"><i class="dot-key" style="background:${partyColor(n)}"></i>${esc(n)} 지지도</div><div class="kpi-value num">${pct(party[n])}</div><div class="kpi-meta">${diff(party[n], pprev[n])}</div></div>`).join('')}`;
  }

  function charts() {
    const P = D.president;
    $('po-pres').innerHTML = `<div class="card-head"><div><h2 class="card-title">대통령 직무 평가</h2><p class="card-sub">매주 · "잘하고 있다" / "잘못하고 있다" · 한국갤럽</p></div></div>
      ${lineChart($('po-pres'), { dates: P.map((r) => r[0]), series: [{ name: '잘하고 있다', color: 'var(--pl-done)', vals: P.map((r) => r[1]) }, { name: '잘못하고 있다', color: 'var(--pl-late)', vals: P.map((r) => r[2]) }], fmt: pct })}`;
    if (D.blackout || !D.parties.length) {
      $('po-party').innerHTML = '<h2 class="card-title">정당 지지도</h2><p class="muted">선거일 전 6일간은 정당 지지도를 공표할 수 없어 표시하지 않습니다.</p>';
      return;
    }
    const dates = D.parties.map((r) => r[0]);
    const hi = Math.min(100, Math.ceil(Math.max(...D.parties.flatMap((r) => Object.values(r[1]))) / 10) * 10 + 10);
    $('po-party').innerHTML = `<div class="card-head"><div><h2 class="card-title">정당 지지도</h2><p class="card-sub">매주 · 최근 반년 평균 상위 정당과 무당층 · 한국갤럽</p></div></div>
      ${lineChart($('po-party'), { dates, hi, series: D.party_names.map((n) => ({ name: n, color: n === '무당층' ? 'var(--text-3)' : partyColor(n), vals: D.parties.map((r) => (r[1][n] === undefined ? null : r[1][n])) })), fmt: pct })}`;
  }

  function topics() {
    const q = st.q.replace(/\s+/g, '');
    const cats = [...new Set(D.topics.map((t) => t.category))];
    $('po-cats').innerHTML = ['', ...cats].map((c) => `<button type="button" class="chip po-cat${st.cat === c ? ' on' : ''}" data-c="${esc(c)}">${c ? esc(c) : '전체'}</button>`).join('');
    const rows = D.topics.filter((t) => (!st.cat || t.category === st.cat) && (!q || (t.title + t.question).replace(/\s+/g, '').includes(q)));
    $('po-sub').textContent = `주간 조사 ${num(D.weeks)}회 · 현안 질문 ${num(D.topics.length)}개 · 최신 순 · 전체 응답자 기준`;
    const shades = ['var(--text)', 'var(--text-2)', 'var(--text-3)', 'var(--border-strong, #9aa1a8)', 'var(--surface-2)'];
    $('po-topics').innerHTML = rows.length ? rows.slice((st.p - 1) * PAGE, st.p * PAGE).map((t) => `<article class="po-item">
        <div class="po-head"><span class="chip">${esc(t.category)}</span><span class="muted num">${kdate(t.date)}</span></div>
        <h3>${esc(t.title)}</h3>
        <p class="po-q">${esc(t.question)}</p>
        <div class="po-bars">${t.results.map((r, i) => `<div class="po-bar"><span class="po-lbl">${esc(r.label)}</span><span class="po-trk"><i style="width:${Math.min(100, r.pct)}%;background:${shades[Math.min(i, 4)]}"></i></span><b class="num">${r.pct}%</b></div>`).join('')}</div>
        <p class="po-foot">${esc(t.summary)} · <a href="${esc(/^https?:/.test(t.url) ? t.url : '#')}" target="_blank" rel="noopener">한국갤럽 원문${t.no ? ` 제${t.no}호` : ''}</a></p>
      </article>`).join('') : '<p class="muted">해당하는 조사가 없습니다.</p>';
    $('po-cats').querySelectorAll('.po-cat').forEach((b) => b.addEventListener('click', () => { st.cat = b.dataset.c; st.p = 1; topics(); }));
    pager($('po-more'), { total: rows.length, page: st.p, size: PAGE, anchor: $('po-topics-card'), onGo: (p) => { st.p = p; topics(); } });
  }

  fetch('/poll-data.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error('여론조사 데이터를 불러오지 못했습니다')))).then((d) => {
    D = d;
    if (!D.weeks) { $('meta').textContent = '여론조사 자료를 모으는 중입니다. 잠시 후 다시 확인해 주세요.'; ['po-pres', 'po-party', 'po-topics-card'].forEach((id) => { $(id).hidden = true; }); return; }
    const L = D.latest;
    $('meta').textContent = `한국갤럽 데일리 오피니언 주간 조사 · 최근 조사 ${kdate(L.period_start)}~${kdate(L.period_end)}`;
    $('po-info').textContent = `조사기관 ${L.source} · 의뢰 ${L.sponsor} · 조사방법 ${L.method} · 표본 전국 만 18세 이상 ${num(L.sample)}명 · 표본오차 ${L.margin}(95% 신뢰수준) · 응답률 ${L.response_rate} (최근 조사 기준, 주마다 조금씩 다름)`;
    kpis();
    charts();
    topics();
    $('po-q').addEventListener('input', (e) => { st.q = e.target.value; st.p = 1; topics(); });
  }).catch((e) => { $('po-kpis').innerHTML = `<div class="card error">${esc(e.message)}</div>`; });
})();
