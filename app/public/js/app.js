(function () {
  const { partyColor, partyOrder, hemicycle, CHOICE, pager, view, reveal, esc, num, pct, topText, rankText, statusText, gradeBadge, median, mean, loadMembers, METRICS, meter, memberCombo } = window.NA;
  const $ = (id) => document.getElementById(id);
  const PAGE = window.matchMedia('(max-width: 760px)').matches ? 20 : 50;

  // KPI numbers count up once on first paint (skipped for reduced motion).
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const count = (v, dec = 0, suffix = '') =>
    `<span class="count" data-to="${v}" data-dec="${dec}" data-suffix="${suffix}">${dec ? v.toFixed(dec) : num(Math.round(v))}${suffix}</span>`;
  function runCountUps(root) {
    if (reduceMotion) return;
    root.querySelectorAll('.count').forEach((el) => {
      const to = +el.dataset.to, dec = +el.dataset.dec, suffix = el.dataset.suffix;
      const fmt = (x) => `${dec ? x.toFixed(dec) : num(Math.round(x))}${suffix}`;
      const t0 = performance.now(), dur = 1800;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        el.textContent = fmt(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  let all = [];
  let run = null;
  let page = 1;
  view.manual();
  let sort = { key: 'rank', dir: 'asc' };

  // ---------- term progress (22nd Assembly: 2024-05-30 ~ 2028-05-29) ----------
  function renderTerm() {
    const START = '2024-05-30', END = '2028-05-29';
    const kst = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const day = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;
    const total = day(END) - day(START) + 1;
    const passed = Math.min(total, Math.max(0, day(kst) - day(START) + 1));
    const left = total - passed;
    const share = (passed / total) * 100;
    const fmt = (iso) => iso.replace(/-/g, '.');
    $('term').innerHTML = `
      <div class="term-head">
        <div><span class="kpi-label">제22대 국회 임기</span>
          <div class="term-big"><b class="num">${share.toFixed(1)}%</b> 지났습니다</div></div>
        <div class="term-left"><span class="kpi-label">임기 만료까지</span><b class="num">D-${num(left)}</b></div>
      </div>
      <div class="term-bar" role="img" aria-label="임기 ${total}일 중 ${passed}일 경과">
        <span style="width:${share.toFixed(2)}%"></span>
      </div>
      <div class="term-foot num">
        <span>${fmt(START)} 개원</span>
        <span>${num(passed)}일 경과 · ${num(left)}일 남음 · 전체 ${num(total)}일</span>
        <span>${fmt(END)} 임기 만료</span>
      </div>`;
  }

  // ---------- seat chart ----------
  const GRADES = ['S', 'A', 'B', 'C', 'D'];
  function renderSeats(mode) {
    const counts = {};
    all.forEach((m) => { counts[m.party] = (counts[m.party] || 0) + 1; });
    const order = partyOrder(counts);
    const gi = (g) => (g ? GRADES.indexOf(g) : 9);
    const seats = [...all]
      .sort((a, b) => order.indexOf(a.party) - order.indexOf(b.party) ||
        (mode === 'grade' ? gi(a.grade) - gi(b.grade) || (a.rank ?? 999) - (b.rank ?? 999) : 0) || a.name.localeCompare(b.name, 'ko'))
      .map((m) => ({
        id: m.id, name: m.name,
        color: mode === 'grade' ? (m.grade ? `var(--g-${m.grade})` : 'var(--g-none)') : partyColor(m.party),
        title: `<b>${esc(m.name)}</b> · ${esc(m.party || '')}<br>${m.grade ? `${m.grade}등급 · 종합 ${m.rank}위` : esc(statusText(m))}`,
      }));
    hemicycle($('seat-chart'), {
      seats,
      label: mode === 'grade' ? '의원별 등급을 정당별로 배치한 의석 그림' : '정당별 의석 그림',
      onPick: (s) => { window.location.href = `/member?id=${encodeURIComponent(s.id)}`; },
    });
    const items = mode === 'grade'
      ? [...GRADES.map((g) => [`${g}등급`, `var(--g-${g})`, all.filter((m) => m.grade === g).length]), ['등급 없음', 'var(--g-none)', all.filter((m) => !m.grade).length]]
      : order.map((p) => [p, partyColor(p), counts[p]]);
    $('seat-legend').innerHTML = items.map(([l, c, n]) => `<span><i style="background:${c}"></i>${esc(l)}<b class="num">${num(n)}</b></span>`).join('') +
      (mode === 'grade' ? `<div class="hemi-parties">왼쪽부터 ${order.map((p) => `<span class="nw">${esc(p)} <b class="num">${num(counts[p])}</b></span>`).join(' · ')}</div>` : '');
    $('seat-sub').textContent = `${num(all.length)}명 · 점 하나가 의원 한 명 · 왼쪽부터 정당별${mode === 'grade' ? ', 당 안에서는 높은 등급부터' : ''} · 점을 누르면 의원 실적으로 이동`;
    $('seat-tabs').querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.k === mode)));
  }

  // ---------- what changed since the previous update ----------
  const shortDate = (iso) => { const [, mo, d] = iso.split('-').map(Number); return `${mo}.${d}`; };
  function renderWeekly(w) {
    const v = w.votes, b = w.bills, g = w.grades;
    const md = (iso) => { const [, mo, d] = iso.split('-').map(Number); return `${mo}월 ${d}일`; };
    const next = (iso) => new Date(new Date(iso).getTime() + 864e5).toISOString().slice(0, 10);
    $('weekly-sub').textContent = w.since === w.as_of
      ? `${md(w.as_of)} 기준`
      : `지난 갱신(${md(w.since)}) 이후 새로 들어온 기록 · 본회의 ${v.dates.length ? v.dates.map(md).join(', ') : '없음'} · 법안 ${md(next(w.windows.bills[0]))}~${md(w.windows.bills[1])}`;
    const tile = (label, value, meta) => `<div class="wk-tile"><div class="kpi-label">${label}</div><div class="kpi-value num">${value}</div><div class="kpi-meta">${meta}</div></div>`;
    const bar = (c) => `<div class="stack" aria-hidden="true">${'YNAX'.split('').map((k, i) => (c[i] ? `<span style="flex:${c[i]};background:${CHOICE[k].color}"></span>` : '')).join('')}</div>`;
    const voteItems = v.highlights.map((x) => `<a class="wk-row" href="/vote?id=${encodeURIComponent(x.id)}">
        <span class="wk-name">${esc(x.name)}${x.clash ? '<b class="tag-clash"> 여야 대립</b>' : ''}</span>
        ${bar(x.counts)}<small class="num">찬성 ${num(x.counts[0])} · 반대 ${num(x.counts[1])} · 기권 ${num(x.counts[2])} · ${esc(x.result || '')}</small>
      </a>`).join('');
    const billItems = b.highlights.map((x) => `<div class="wk-row">
        <a class="wk-name" href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.name)}</a>
        <small>${esc(x.result)} ${shortDate(x.date)} · 대표발의 ${x.leads.map((l) => `<a href="/member?id=${encodeURIComponent(l.id)}">${esc(l.name)}</a>`).join(', ') || '-'}</small>
      </div>`).join('');
    const moveRow = (x, dir) => {
      const d = (x.rank_from ?? 0) - (x.rank_to ?? 0);
      return `<a class="gm-row" href="/member?id=${encodeURIComponent(x.id)}">
        <span class="gm-who"><b>${esc(x.name)}</b><small>${esc(x.party || '')}</small></span>
        <span class="gm-grades">${gradeBadge(x.from)}<span class="gm-arrow ${dir}">${dir === 'up' ? '▲' : '▼'}</span>${gradeBadge(x.to)}</span>
        <span class="gm-rank num">${x.rank_from}위 → <b>${x.rank_to}위</b><small class="${dir}">${d > 0 ? `${d}계단 상승` : `${-d}계단 하락`}</small></span>
      </a>`;
    };
    const moveCol = (list, dir, title) => `<div class="gm-col">
      <h3 class="wk-h"><span class="gm-arrow ${dir}">${dir === 'up' ? '▲' : '▼'}</span> ${title} <span class="muted num">${num(list.length)}명</span></h3>
      ${list.length ? list.map((x) => moveRow(x, dir)).join('') : '<p class="muted">없습니다.</p>'}
    </div>`;
    $('weekly').innerHTML = `
      <div class="wk-tiles">
        ${tile('본회의 표결', `${num(v.total)}<small>건</small>`, `여야 대립 ${num(v.clash)} · 만장일치 ${num(v.unanimous)}${v.rejected ? ` · 부결 ${num(v.rejected)}` : ''}`)}
        ${tile('새로 발의된 법안', `${num(b.proposed)}<small>건</small>`, '의원 대표발의 기준')}
        ${tile('법안 반영', `${num(b.passed + b.alt)}<small>건</small>`, `가결 ${num(b.passed)} · 대안반영 ${num(b.alt)}`)}
        ${tile('등급 변동', `${num(g.up.length + g.down.length)}<small>명</small>`, `오름 ${num(g.up.length)} · 내림 ${num(g.down.length)}`)}
      </div>
      <div class="grid grid-2 section">
        <div><h3 class="wk-h">눈여겨볼 표결</h3>${voteItems || '<p class="muted">찬반이 갈린 표결이 없었습니다.</p>'}</div>
        <div><h3 class="wk-h">가결된 의원 발의 법안</h3>${billItems || '<p class="muted">없습니다.</p>'}</div>
      </div>
      ${g.up.length + g.down.length ? `<div class="grid grid-2 section">${moveCol(g.up, 'up', '등급 상승')}${moveCol(g.down, 'down', '등급 하락')}</div>` : ''}`;
  }

  // ---------- KPI tiles ----------
  function renderKpis() {
    const eligible = all.filter((m) => m.eligible);
    const leadTotal = all.reduce((s, m) => s + (m.lead_count || 0), 0);
    const reflected = all.reduce((s, m) => s + m.lead_reflected, 0);
    const vote = eligible.map((m) => m.participation_rate);
    const att = eligible.map((m) => m.attendance_rate);
    const fullAtt = eligible.filter((m) => m.attendance_rate === 1).length;
    const range = (a) => {
      const v = a.filter((x) => x !== null && x !== undefined);
      return `최저 ${pct(Math.min(...v))} · 최고 ${pct(Math.max(...v))}`;
    };
    const tile = (label, value, meta) =>
      `<div class="card"><div class="kpi-label">${label}</div><div class="kpi-value num">${value}</div><div class="kpi-meta">${meta}</div></div>`;
    $('kpis').innerHTML = [
      tile('평가 대상 의원', `${count(eligible.length)}<small>명</small>`, `전체 ${num(all.length)}명 · 재임 6개월 미만 ${num(all.filter((m) => m.status === 'short_tenure').length)}명 · 겸직 유보 ${num(all.filter((m) => m.status === 'role_hold').length)}명`),
      tile('법에 반영된 대표발의', `${count(reflected)}<small>건</small>`, `대표발의 ${num(leadTotal)}건 중 ${pct(reflected / leadTotal)} · 공동 대표발의는 각자 집계`),
      tile('표결 참여율 중앙값', count(median(vote) * 100, 1, '%'), range(vote)),
      tile('본회의 출석률 중앙값', count(median(att) * 100, 1, '%'), `${range(att)} · 100% 출석 ${num(fullAtt)}명`),
    ].join('');
    reveal($('kpis').children, (card) => runCountUps(card));
  }

  // ---------- grade distribution ----------
  let gradeActive = '';
  function renderGrades() {
    const grades = ['S', 'A', 'B', 'C', 'D'];
    const counts = Object.fromEntries(grades.map((g) => [g, all.filter((m) => m.grade === g).length]));
    const max = Math.max(...Object.values(counts));
    const cols = $('grade-cols');
    cols.classList.toggle('has-active', !!gradeActive);
    cols.innerHTML = grades
      .map(
        (g) => `<button type="button" class="col ${gradeActive === g ? 'active' : ''}" data-g="${g}" aria-pressed="${gradeActive === g}" aria-label="${g}등급 ${counts[g]}명">
          <span class="col-val num">${counts[g]}</span>
          <span class="col-bar" style="height:${((counts[g] / max) * 100).toFixed(1)}%;background:var(--g-${g});--i:${grades.indexOf(g)}"></span>
          <span class="col-label">${g}</span>
        </button>`
      )
      .join('');
    const none = all.filter((m) => !m.grade).length;
    $('grade-foot').textContent = `S 10% · A 20% · B 40% · C 20% · D 10% 상대평가 · 등급 없음 ${none}명`;
    cols.querySelectorAll('.col').forEach((b) =>
      b.addEventListener('click', () => {
        gradeActive = gradeActive === b.dataset.g ? '' : b.dataset.g;
        $('grade-filter').value = gradeActive;
        renderGrades();
        page = 1;
        renderBoard();
        if (gradeActive) $('board-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
    );
  }

  // ---------- tabs helper ----------
  function tabs(el, items, onChange) {
    let cur = items[0].key;
    const paint = () => {
      el.innerHTML = items
        .map((t) => `<button type="button" class="tab" role="tab" aria-selected="${t.key === cur}" data-k="${t.key}">${t.label}</button>`)
        .join('');
      el.querySelectorAll('.tab').forEach((b) =>
        b.addEventListener('click', () => { cur = b.dataset.k; paint(); onChange(cur); })
      );
    };
    paint();
    onChange(cur);
  }

  function barRow(fillPct, labelHtml, valueHtml, i = 0) {
    return `<div class="barlist-row">
      <div class="barlist-bar"><div class="barlist-fill" style="width:${Math.max(0.5, fillPct).toFixed(1)}%;--i:${i}"></div><div class="barlist-text">${labelHtml}</div></div>
      <div class="barlist-value num">${valueHtml}</div>
    </div>`;
  }

  // ---------- top 10 (attendance excluded: dozens tie at 100%) ----------
  const TOP = [
    { key: 'composite', label: '종합', value: (m) => m.composite_percentile, show: (m) => m.composite_percentile.toFixed(1), sub: '종합 백분위 (100 = 1위) · 등급 산출 대상', scale: 'pct' },
    { key: 'legislation', label: '입법 성과', value: (m) => m.weighted_score, show: (m) => `${(m.weighted_score * 365).toFixed(1)}점<small>반영 ${num(m.lead_reflected)}/${num(m.lead_count)}건</small>`, sub: '채점 점수 = (가결 1 + 대안반영 0.5) ÷ 재임 연수', scale: 'max' },
    { key: 'coop', label: '초당적 협력', value: (m) => (m.coop_excess > 0 ? m.coop_excess : null), show: (m) => `+${m.coop_bonus.toFixed(1)}점<small>다른 당 ${(m.coop_index * 100).toFixed(1)}%</small>`, sub: '같은 당 중앙값보다 다른 당 공동발의자 비율이 높은 만큼 최대 +3점 가산', scale: 'max' },
    { key: 'vote', label: '표결 참여', value: (m) => m.participation_rate, show: (m) => `${pct(m.participation_rate)}<small>${num(m.vote_participated)}/${num(m.vote_eligible)}회</small>`, sub: '본회의 기록표결 참여율', scale: 'rate' },
  ];
  function renderTop(key) {
    const t = TOP.find((x) => x.key === key);
    const list = all.filter((m) => m.eligible && t.value(m) !== null && t.value(m) !== undefined).sort((a, b) => t.value(b) - t.value(a)).slice(0, 10);
    const max = Math.max(...list.map(t.value));
    $('top-sub').textContent = t.sub;
    $('top-list').innerHTML = list
      .map((m, i) => {
        const v = t.value(m);
        const fill = t.scale === 'max' ? (v / max) * 100 : t.scale === 'rate' ? v * 100 : v;
        return barRow(
          fill,
          `<span class="bl-rank">${i + 1}</span>${gradeBadge(m.grade)}<a href="/member?id=${encodeURIComponent(m.id)}">${esc(m.name)}</a><span class="muted">${esc(m.party || '')}</span>`,
          t.show(m),
          i
        );
      })
      .join('');
  }

  // ---------- party averages ----------
  // ---------- bottom 10: the basic duties (lowest rates among graded members) ----------
  const LOW = [
    { key: 'vote', label: '표결 불참', value: (m) => m.participation_rate,
      show: (m) => `${pct(m.participation_rate)}<small>${num(m.vote_eligible - m.vote_participated)}회 불참</small>`,
      sub: '본회의 표결 참여율이 낮은 순 (불참 횟수)' },
    { key: 'attendance', label: '본회의 결석', value: (m) => m.attendance_rate,
      show: (m) => `${pct(m.attendance_rate)}<small>${num(m.attendance_meetings - m.attendance_present)}일 빠짐</small>`,
      sub: '본회의 출석률이 낮은 순' },
    { key: 'committee', label: '위원회 결석', value: (m) => m.committee_attendance_rate,
      show: (m) => `${pct(m.committee_attendance_rate)}<small>${num(m.committee_meetings_total - m.committee_present)}회 빠짐</small>`,
      sub: '위원회 출석률이 낮은 순' },
  ];
  function renderLow(key) {
    const t = LOW.find((x) => x.key === key);
    const list = all.filter((m) => m.eligible && t.value(m) !== null && t.value(m) !== undefined)
      .sort((a, b) => t.value(a) - t.value(b) || a.name.localeCompare(b.name, 'ko')).slice(0, 10);
    $('low-sub').textContent = `${t.sub} · 평가 대상 ${num(all.filter((m) => m.eligible).length)}명 중`;
    $('low-list').innerHTML = list.map((m, i) => barRow(t.value(m) * 100,
      `<span class="bl-rank">${i + 1}</span>${gradeBadge(m.grade)}<a href="/member?id=${encodeURIComponent(m.id)}">${esc(m.name)}</a><span class="muted">${esc(m.party || '')}</span>`,
      t.show(m), i)).join('');
  }

  const PARTY = [
    { key: 'composite', label: '종합 백분위', value: (m) => m.composite_percentile, fmt: (v) => v.toFixed(1), fill: (v) => v, note: '종합 백분위 평균 · 50이 전체 중간' },
    { key: 'legislation', label: '입법 반영', value: (m) => m.lead_reflected, fmt: (v) => `평균 ${v.toFixed(1)}건`, fill: null },
    { key: 'vote', label: '표결 참여', value: (m) => m.participation_rate, fmt: (v) => pct(v), fill: (v) => v * 100 },
    { key: 'attendance', label: '본회의 출석', value: (m) => m.attendance_rate, fmt: (v) => pct(v), fill: (v) => v * 100 },
  ];
  function renderParty(key) {
    const t = PARTY.find((x) => x.key === key);
    const groups = {};
    all.filter((m) => m.eligible).forEach((m) => (groups[m.party || '무소속'] ||= []).push(m));
    const rows = Object.entries(groups)
      .filter(([, ms]) => ms.length >= 3)
      .map(([party, ms]) => ({ party, n: ms.length, v: mean(ms.map(t.value)) }))
      .sort((a, b) => b.v - a.v);
    const max = Math.max(...rows.map((r) => r.v));
    $('party-sub').textContent = `소속 의원 3명 이상 정당 · 평가 대상 의원 기준${t.note ? ` · ${t.note}` : ''}`;
    $('party-list').innerHTML = rows
      .map((r, i) =>
        barRow(
          t.fill ? t.fill(r.v) : (r.v / max) * 100,
          `<b>${esc(r.party)}</b><span class="muted">${r.n}명</span>`,
          t.fmt(r.v),
          i
        )
      )
      .join('');
  }

  // ---------- leaderboard ----------
  function filtered() {
    const q = $('search-box').value.trim().toLowerCase().replace(/\s+/g, '');
    const party = $('party-filter').value;
    const region = $('region-filter').value;
    const cmt = $('committee-filter').value;
    const g = $('grade-filter').value;
    let list = all.filter((m) => {
      if (q && !`${m.name}${m.party}${m.district}`.toLowerCase().replace(/\s+/g, '').includes(q)) return false;
      if (party && m.party !== party) return false;
      if (region && m.region !== region) return false;
      if (cmt && !m.committees.includes(cmt)) return false;
      if (g === 'ineligible') return !m.eligible;
      if (g && m.grade !== g) return false;
      return true;
    });
    const { key, dir } = sort;
    const sign = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (key === 'name') return sign * a.name.localeCompare(b.name, 'ko');
      const av = a[key], bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return sign * (av - bv);
    });
    return list;
  }

  function metricCell(m, metric) {
    const p = m[metric.pctKey];
    if (p === null || p === undefined) {
      return `<td class="metric" data-label="${metric.label}"><span class="na">${m.eligible ? '' : `${statusText(m)} · `}${esc(metric.short(m))}</span></td>`;
    }
    return `<td class="metric" data-label="${metric.label}">${meter(p)}<b>${topText(p)}</b><small>${esc(metric.short(m))}</small></td>`;
  }

  function renderBoard() {
    const list = filtered();
    $('count').textContent = `${num(list.length)}명`;
    const body = $('board-body');
    if (!list.length) {
      body.innerHTML = '<tr><td class="skeleton" colspan="7">조건에 맞는 의원이 없습니다.</td></tr>';
      $('more').innerHTML = '';
      saveBoard();
      return;
    }
    body.innerHTML = list
      .slice((page - 1) * PAGE, page * PAGE)
      .map(
        (m) => `<tr data-id="${esc(m.id)}">
          <td class="rank num">${rankText(m, all) ?? `<span class="na" title="${statusText(m)}">–</span>`}</td>
          <td class="who">${gradeBadge(m.grade)}<div><a href="/member?id=${encodeURIComponent(m.id)}">${esc(m.name)}</a>${m.roles.filter((r) => !r.end).map((r) => `<span class="role-dot">${esc(r.role)}</span>`).join('')}<small>${esc(m.party || '-')} · ${esc(m.district || '-')}</small></div></td>
          <td class="grade-cell">${gradeBadge(m.grade)}</td>
          ${METRICS.map((mt) => metricCell(m, mt)).join('')}
        </tr>`
      )
      .join('');
    reveal(body.querySelectorAll('tr[data-id]'));
    body.querySelectorAll('tr[data-id]').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        window.location.href = `/member?id=${encodeURIComponent(tr.dataset.id)}`;
      })
    );
    pager($('more'), { total: list.length, page, size: PAGE, anchor: $('board-card'), onGo: (p) => { page = p; renderBoard(); } });
    saveBoard();
    document.querySelectorAll('#board th[data-sort]').forEach((th) => {
      if (th.dataset.sort === sort.key) th.setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
      const btn = th.querySelector('button');
      btn.textContent = btn.textContent.replace(/ [▲▼]$/, '') + (th.dataset.sort === sort.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
    });
  }

  // filters, sort and page survive a trip to a member page and back
  const BOARD_INPUTS = ['search-box', 'party-filter', 'region-filter', 'committee-filter', 'grade-filter'];
  function saveBoard() {
    view.set('board', { page, sort, inputs: BOARD_INPUTS.map((id) => $(id).value) });
  }
  function restoreBoard() {
    const st = view.get('board', null);
    if (!st) return;
    BOARD_INPUTS.forEach((id, i) => { if ([...($(id).options || [{ value: st.inputs[i] }])].some((o) => o.value === st.inputs[i])) $(id).value = st.inputs[i]; });
    gradeActive = ['S', 'A', 'B', 'C', 'D'].includes($('grade-filter').value) ? $('grade-filter').value : '';
    sort = st.sort || sort;
    page = st.page || 1;
    if (gradeActive) renderGrades();
  }

  function fillSelect(id, values) {
    const sel = $(id);
    values.forEach((v) => sel.insertAdjacentHTML('beforeend', `<option value="${esc(v.value)}">${esc(v.label)}</option>`));
  }

  function setupBoard() {
    const count = (f) => {
      const o = {};
      all.forEach((m) => [].concat(f(m)).forEach((k) => k && (o[k] = (o[k] || 0) + 1)));
      return Object.entries(o).sort((a, b) => b[1] - a[1]);
    };
    fillSelect('party-filter', count((m) => m.party).map(([k, n]) => ({ value: k, label: `${k} (${n})` })));
    fillSelect('region-filter', count((m) => m.region).map(([k, n]) => ({ value: k, label: `${k} (${n})` })));
    fillSelect('committee-filter', count((m) => m.committees).map(([k, n]) => ({ value: k, label: `${k.length > 22 ? k.slice(0, 22) + '…' : k} (${n})` })));

    const reset = () => { page = 1; renderBoard(); };
    $('search-box').addEventListener('input', reset);
    ['party-filter', 'region-filter', 'committee-filter'].forEach((id) => $(id).addEventListener('change', reset));
    $('grade-filter').addEventListener('change', () => {
      gradeActive = ['S', 'A', 'B', 'C', 'D'].includes($('grade-filter').value) ? $('grade-filter').value : '';
      renderGrades();
      reset();
    });
    document.querySelectorAll('#board th[data-sort] button').forEach((btn) =>
      btn.addEventListener('click', () => {
        const key = btn.parentElement.dataset.sort;
        if (sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
        else sort = { key, dir: key === 'rank' || key === 'name' ? 'asc' : 'desc' };
        reset();
      })
    );
    restoreBoard();
    renderBoard();
  }


  async function init() {
    try {
      const data = await loadMembers();
      all = data.members;
      run = data.run;
      const kdate = (iso) => { const [y, mo, d] = iso.slice(0, 10).split('-').map(Number); return `${y}년 ${mo}월 ${d}일`; };
      const start = all.map((m) => m.term_start).sort()[0];
      const evaluated = all.filter((m) => m.eligible).length;
      $('run-info').textContent = `${kdate(run.data_as_of || run.created_at)} 기준 · ${kdate(start)} 개원 이후 공식 기록 · ${num(all.length)}명 중 ${num(evaluated)}명 평가`;
      memberCombo({
        input: $('finder-input'),
        list: $('finder-list'),
        members: all,
        onPick: (m) => (window.location.href = `/member?id=${encodeURIComponent(m.id)}`),
      });
      renderKpis();
      renderGrades();
      tabs($('top-tabs'), TOP, renderTop);
      tabs($('party-tabs'), PARTY, renderParty);
      tabs($('low-tabs'), LOW, renderLow);
      setupBoard();
      renderTerm();
      renderSeats('party');
      $('seat-tabs').addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (t) renderSeats(t.dataset.k); });
      fetch('/weekly.json').then((r) => (r.ok ? r.json() : Promise.reject())).then(renderWeekly)
        .catch(() => { $('weekly-card').hidden = true; });
      reveal(document.querySelectorAll('main > .card, main > .notice, main > .grid:not(#kpis) > .card'));
      view.restoreScroll();
    } catch (err) {
      $('run-info').innerHTML = `<span class="error">데이터를 불러오지 못했습니다: ${esc(err.message)}</span>`;
      $('board-body').innerHTML = '<tr><td class="skeleton" colspan="7">오류</td></tr>';
    }
  }

  init();
})();
