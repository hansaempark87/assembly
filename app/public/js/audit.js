(function () {
  const { esc, num, kdate, pager, view, gradeBadge } = window.NA;
  const $ = (id) => document.getElementById(id);
  const PAGE = 20;
  const ST = {
    done: ['회의록 공개', 'au-done'],
    pending: ['회의록 대기', 'au-pending'],
    upcoming: ['예정', 'au-up'],
  };
  view.manual();

  let D = null;
  const st = { year: '', cmt: '', p: 1 };
  const short = (c) => c.replace(/위원회$/, '');
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

  function writeUrl() {
    const u = new URLSearchParams();
    if (st.year !== latest()) u.set('y', st.year);
    if (st.cmt) u.set('c', st.cmt);
    if (st.p > 1) u.set('p', st.p);
    const qs = u.toString();
    history.replaceState(history.state, '', qs ? `?${qs}` : location.pathname);
  }
  const latest = () => Object.keys(D.years).sort().pop();

  function renderStatus(y, year) {
    const ms = y.meetings;
    const n = (s) => ms.filter((m) => m.status === s).length;
    const today = D.as_of;
    const cmts = new Set(ms.map((m) => m.committee)).size;
    let head;
    if (today < y.start) head = `<b>${days(today, y.start)}일 뒤 시작</b>`;
    else if (today <= y.end) head = `<b>진행 중</b> · ${days(y.start, today) + 1}일째`;
    else head = '<b>종료</b>';
    const span = Math.max(1, days(y.start, y.end) + 1);
    const pos = Math.min(100, Math.max(0, ((days(y.start, today) + 1) / span) * 100));
    const live = today >= y.start && today <= y.end;
    $('status').innerHTML = `
      <div class="au-head">
        <div><span class="kpi-label">${esc(year)}년 국정감사 (${esc(y.sess)} 정기회)</span>
          <div class="au-state">${head}</div>
          <p class="card-sub">${kdate(y.start)} ~ ${kdate(y.end)} · 위원회 ${num(cmts)}곳 · 감사 회의 ${num(ms.length)}건${live || today < y.start ? ' (지금까지 공개된 일정 기준)' : ''}</p>
        </div>
      </div>
      ${live ? `<div class="term-bar au-bar"><span style="width:${pos.toFixed(1)}%"></span></div>` : ''}
      <div class="grid grid-3 section au-kpis">
        <div class="au-kpi"><span>회의록 공개</span><b class="num">${num(n('done'))}</b></div>
        <div class="au-kpi"><span>회의록 대기</span><b class="num">${num(n('pending'))}</b></div>
        <div class="au-kpi"><span>예정</span><b class="num">${num(n('upcoming'))}</b></div>
      </div>
      ${n('pending') ? '<p class="card-sub">회의록은 감사가 끝나고 국회가 정리해 공개하기까지 시간이 걸립니다. 공개되는 대로 아래 질의량에 자동으로 반영됩니다.</p>' : ''}`;
  }

  function renderSched(y) {
    $('sched-legend').innerHTML = Object.values(ST).map(([l, c]) => `<span><i class="au-dot ${c}"></i>${l}</span>`).join('');
    const by = {};
    y.meetings.forEach((m) => (by[m.committee] = by[m.committee] || []).push(m));
    const names = Object.keys(by).sort((a, b) => a.localeCompare(b, 'ko'));
    $('sched').innerHTML = names.map((c) => `<div class="au-row">
        <div class="au-cmt"><b>${esc(short(c))}</b><small class="num">${num(by[c].length)}건</small></div>
        <div class="au-dates">${by[c].sort((a, b) => a.date.localeCompare(b.date)).map((m) => {
          const [label, cls] = ST[m.status];
          const title = `${kdate(m.date)} · ${label}${m.agencies ? ` · ${m.agencies}` : ''}`;
          const body = `<span class="au-d num">${m.date.slice(5).replace('-', '.')}</span>`;
          return m.status === 'upcoming'
            ? `<span class="au-chip ${cls}" title="${esc(title)}">${body}</span>`
            : `<a class="au-chip ${cls}" href="/audit-meeting?id=${encodeURIComponent(m.id)}" title="${esc(title)}">${body}</a>`;
        }).join('')}</div>
      </div>`).join('');
  }

  function renderSpeak(y) {
    const done = y.meetings.some((m) => m.status === 'done');
    $('speak-card').hidden = !done;
    if (!done) return;
    const cmts = Object.keys(y.committees).sort((a, b) => a.localeCompare(b, 'ko'));
    if (st.cmt && !cmts.includes(st.cmt)) st.cmt = '';
    $('cmt').innerHTML = `<option value="">전체 위원회</option>${cmts.map((c) => `<option value="${esc(c)}"${c === st.cmt ? ' selected' : ''}>${esc(short(c))}</option>`).join('')}`;
    const src = st.cmt ? y.committees[st.cmt] : y.members;
    const rows = Object.entries(src).map(([id, [turns, chars, meetings]]) => ({ id, turns, chars, meetings }))
      .sort((a, b) => b.chars - a.chars || b.turns - a.turns);
    const met = y.meetings.filter((m) => m.status === 'done' && (!st.cmt || m.committee === st.cmt)).length;
    $('speak-sub').textContent = `회의록이 공개된 감사 ${num(met)}건 기준 · 발언한 의원 ${num(rows.length)}명 · 질의 글자 수가 많은 순`;
    const max = rows.length ? rows[0].chars : 1;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    if (st.p > pages) st.p = pages;
    $('speak').innerHTML = rows.slice((st.p - 1) * PAGE, st.p * PAGE).map((r, i) => {
      const [name, party, grade] = D.people[r.id] || [r.id, '', null];
      const rank = (st.p - 1) * PAGE + i + 1;
      const who = party ? `<a href="/member?id=${encodeURIComponent(r.id)}">${esc(name)}</a>` : esc(name);
      return `<div class="barlist-row">
        <div class="barlist-bar"><div class="barlist-fill" style="width:${Math.max(0.5, (r.chars / max) * 100).toFixed(1)}%;--i:${i}"></div>
          <div class="barlist-text"><span class="bl-rank">${rank}</span>${gradeBadge(grade)}${who}<span class="muted">${esc(party || '전직 의원')}</span></div></div>
        <div class="barlist-value num">${num(r.chars)}자<small>${num(r.turns)}회 · ${num(r.meetings)}일</small></div>
      </div>`;
    }).join('');
    pager($('speak-more'), { total: rows.length, page: st.p, size: PAGE, anchor: $('speak-card'), onGo: (p) => { st.p = p; renderSpeak(y); writeUrl(); } });
  }

  function render() {
    const y = D.years[st.year];
    $('years').innerHTML = Object.keys(D.years).sort().reverse()
      .map((k) => `<button type="button" class="tab" role="tab" data-y="${k}" aria-selected="${k === st.year}">${k}년</button>`).join('');
    renderStatus(y, st.year);
    renderSpeak(y);
    renderSched(y);
    writeUrl();
  }

  fetch('/audit.json').then((r) => r.json()).then((d) => {
    D = d;
    const u = new URLSearchParams(location.search);
    st.year = D.years[u.get('y')] ? u.get('y') : latest();
    st.cmt = u.get('c') || '';
    st.p = Math.max(1, +u.get('p') || 1);
    $('years').addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (!b) return;
      st.year = b.dataset.y;
      st.cmt = '';
      st.p = 1;
      render();
    });
    $('cmt').addEventListener('change', (e) => { st.cmt = e.target.value; st.p = 1; renderSpeak(D.years[st.year]); writeUrl(); });
    render();
    view.restoreScroll();
  }).catch((e) => { $('status').innerHTML = `<p class="error">불러오지 못했습니다: ${esc(e.message)}</p>`; });
})();
