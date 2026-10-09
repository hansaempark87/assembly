(function () {
  const { reveal, esc, num, pct, topText, rankText, statusText, gradeBadge, median, mean, loadMembers, METRICS, meter, memberCombo } = window.NA;
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
  let shown = PAGE;
  let sort = { key: 'rank', dir: 'asc' };

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
        shown = PAGE;
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
      return;
    }
    body.innerHTML = list
      .slice(0, shown)
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
    $('more').innerHTML =
      list.length > shown
        ? `<button class="btn" type="button" id="more-btn">더 보기 (${num(list.length - shown)}명 남음)</button>`
        : '';
    $('more-btn')?.addEventListener('click', () => { shown += PAGE; renderBoard(); });
    document.querySelectorAll('#board th[data-sort]').forEach((th) => {
      if (th.dataset.sort === sort.key) th.setAttribute('aria-sort', sort.dir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
      const btn = th.querySelector('button');
      btn.textContent = btn.textContent.replace(/ [▲▼]$/, '') + (th.dataset.sort === sort.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
    });
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

    const reset = () => { shown = PAGE; renderBoard(); };
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
      setupBoard();
      reveal(document.querySelectorAll('main > .card, main > .notice, main > .grid:not(#kpis) > .card'));
    } catch (err) {
      $('run-info').innerHTML = `<span class="error">데이터를 불러오지 못했습니다: ${esc(err.message)}</span>`;
      $('board-body').innerHTML = '<tr><td class="skeleton" colspan="7">오류</td></tr>';
    }
  }

  init();
})();
