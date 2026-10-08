(function () {
  const { esc, num, pct, topText, gradeBadge, median, mean, loadMembers, METRICS, meter, memberCombo } = window.NA;
  const $ = (id) => document.getElementById(id);
  const PAGE = window.matchMedia('(max-width: 760px)').matches ? 20 : 50;

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
      tile('평가 대상 의원', `${num(eligible.length)}<small>명</small>`, `전체 ${num(all.length)}명 · 관찰 기간 부족 ${num(all.length - eligible.length)}명`),
      tile('법에 반영된 대표발의', `${num(reflected)}<small>건</small>`, `대표발의 ${num(leadTotal)}건 중 ${pct(reflected / leadTotal)} · 가결+대안반영`),
      tile('표결 참여율 중앙값', pct(median(vote)), range(vote)),
      tile('본회의 출석률 중앙값', pct(median(att)), `${range(att)} · 100% 출석 ${num(fullAtt)}명`),
    ].join('');
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
          <span class="col-bar" style="height:${((counts[g] / max) * 100).toFixed(1)}%;background:var(--g-${g})"></span>
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

  function barRow(fillPct, labelHtml, valueHtml) {
    return `<div class="barlist-row">
      <div class="barlist-bar"><div class="barlist-fill" style="width:${Math.max(0.5, fillPct).toFixed(1)}%"></div><div class="barlist-text">${labelHtml}</div></div>
      <div class="barlist-value num">${valueHtml}</div>
    </div>`;
  }

  // ---------- top 10 (attendance excluded: dozens tie at 100%) ----------
  const TOP = [
    { key: 'composite', label: '종합', value: (m) => m.composite_percentile, show: (m) => topText(m.composite_percentile), sub: '종합 백분위 기준 · 등급 산출 대상', scale: 'pct' },
    { key: 'legislation', label: '입법 반영', value: (m) => m.lead_reflected, show: (m) => `${num(m.lead_reflected)}건<small>대표발의 ${num(m.lead_count)}건</small>`, sub: '대표발의 법안 중 가결·대안반영 건수 (재임일수 보정 전)', scale: 'max' },
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
          `<span class="muted num">${i + 1}</span>${gradeBadge(m.grade)}<a href="/member.html?id=${encodeURIComponent(m.id)}">${esc(m.name)}</a><span class="muted">${esc(m.party || '')}</span>`,
          t.show(m)
        );
      })
      .join('');
  }

  // ---------- party averages ----------
  const PARTY = [
    { key: 'composite', label: '종합 백분위', value: (m) => m.composite_percentile, fmt: (v) => v.toFixed(1), fill: (v) => v },
    { key: 'legislation', label: '입법 반영', value: (m) => m.lead_reflected, fmt: (v) => `${v.toFixed(1)}건`, fill: null },
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
    $('party-list').innerHTML = rows
      .map((r) =>
        barRow(
          t.fill ? t.fill(r.v) : (r.v / max) * 100,
          `<b>${esc(r.party)}</b><span class="muted">${r.n}명</span>`,
          t.fmt(r.v)
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
      return `<td class="metric" data-label="${metric.label}"><span class="na">${m.eligible ? esc(metric.short(m)) : '평가 제외'}</span></td>`;
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
          <td class="rank num">${m.eligible ? m.rank ?? '-' : '<span class="na">–</span>'}</td>
          <td class="who">${gradeBadge(m.grade)}<div><a href="/member.html?id=${encodeURIComponent(m.id)}">${esc(m.name)}</a><small>${esc(m.party || '-')} · ${esc(m.district || '-')}</small></div></td>
          <td class="grade-cell">${gradeBadge(m.grade)}</td>
          ${METRICS.map((mt) => metricCell(m, mt)).join('')}
        </tr>`
      )
      .join('');
    body.querySelectorAll('tr[data-id]').forEach((tr) =>
      tr.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        window.location.href = `/member.html?id=${encodeURIComponent(tr.dataset.id)}`;
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

  function renderWeights() {
    $('weights').innerHTML = METRICS.map((mt) => {
      const w = run[mt.weightKey] || 0;
      return barRow(w * 100 / 0.4 * 0.95, `<b>${mt.label}</b>`, `${Math.round(w * 100)}%`);
    }).join('');
  }

  async function init() {
    try {
      const data = await loadMembers();
      all = data.members;
      run = data.run;
      $('run-info').textContent = `기준일 ${run.created_at.slice(0, 10)} · 산식 ${run.formula_version} · 재임 ${run.min_tenure_days}일 이상 평가`;
      memberCombo({
        input: $('finder-input'),
        list: $('finder-list'),
        members: all,
        onPick: (m) => (window.location.href = `/member.html?id=${encodeURIComponent(m.id)}`),
      });
      renderKpis();
      renderGrades();
      tabs($('top-tabs'), TOP, renderTop);
      tabs($('party-tabs'), PARTY, renderParty);
      setupBoard();
      renderWeights();
    } catch (err) {
      $('run-info').innerHTML = `<span class="error">데이터를 불러오지 못했습니다: ${esc(err.message)}</span>`;
      $('board-body').innerHTML = '<tr><td class="skeleton" colspan="7">오류</td></tr>';
    }
  }

  init();
})();
