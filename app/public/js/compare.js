(function () {
  const { esc, num, kdate, topText, rankText, statusText, gradeBadge, loadMembers, loadVoteIndex, CHOICE, METRICS, stripPlot, memberCombo, shareBar } = window.NA;
  const $ = (id) => document.getElementById(id);
  const result = $('result');

  let all = [];
  let eligible = [];
  let run = null;
  const sel = { a: null, b: null };

  function headCard(m, side) {
    return `<div class="card vs-card side-${side}">
      ${gradeBadge(m.grade, 'grade-lg')}
      <div class="who">
        <span class="vs-key ${side}"></span><b><a href="/member?id=${encodeURIComponent(m.id)}" style="color:inherit">${esc(m.name)}</a></b>
        <small>${esc(m.party || '-')} · ${esc(m.district || '-')}${m.roles.filter((r) => !r.end).map((r) => ` · 현 ${esc(r.role)}`).join('')}</small>
        <small>${m.eligible ? `종합 ${rankText(m, all)} · ${topText(m.composite_percentile)}${m.coop_bonus > 0 ? ` · 협치 +${m.coop_bonus.toFixed(1)}점` : ''}` : `${statusText(m)} (등급 없음)`} · 재임 ${num(m.tenure_days)}일</small>
      </div>
    </div>`;
  }

  // Higher percentile wins; no verdict when either side lacks one.
  function winner(pa, pb) {
    if (pa === null || pa === undefined || pb === null || pb === undefined || pa === pb) return '';
    return pa > pb ? 'a' : 'b';
  }

  function valueCell(m, mt, side, win) {
    const v = mt.rate(m);
    const p = m[mt.pctKey];
    const big = mt.headline ? mt.headline(m) : v === null || v === undefined ? '–' : mt.fmt(v);
    const detail = mt.headline && v !== null && v !== undefined ? `채점 ${mt.fmt(v)} · ${mt.raw(m)}` : mt.raw(m);
    return `<div class="cmp-val num side-${side}">
      <span class="who-tag ${side}">${esc(m.name)}</span>
      <span class="cmp-big">${esc(big)}${win === side ? '<span class="win">▲ 우세</span>' : ''}</span>
      ${p === null || p === undefined ? '' : `<small>${topText(p)}</small>`}
      <small>${esc(detail)}</small>
    </div>`;
  }

  // four percentiles on one chart: the bigger the shape, the higher the member ranks
  function radar(a, b) {
    const S = 300, C = S / 2, R = 104;
    const n = METRICS.length;
    const pt = (i, v) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [C + Math.cos(ang) * R * v, C + Math.sin(ang) * R * v];
    };
    const val = (m, mt) => { const p = m[mt.pctKey]; return p === null || p === undefined ? 0 : Math.max(0, Math.min(100, p)) / 100; };
    const poly = (m) => METRICS.map((mt, i) => pt(i, val(m, mt)).map((x) => x.toFixed(1)).join(',')).join(' ');
    const rings = [0.25, 0.5, 0.75, 1].map((r) => `<polygon points="${METRICS.map((_, i) => pt(i, r).join(',')).join(' ')}" class="rd-ring${r === 0.5 ? ' mid' : ''}"/>`).join('');
    const axes = METRICS.map((_, i) => { const [x, y] = pt(i, 1); return `<line x1="${C}" y1="${C}" x2="${x}" y2="${y}" class="rd-axis"/>`; }).join('');
    const labels = METRICS.map((mt, i) => {
      const [x, y] = pt(i, 1.2);
      const anchor = Math.abs(x - C) < 4 ? 'middle' : x > C ? 'start' : 'end';
      return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="${anchor}" class="rd-label">${esc(mt.label)}</text>`;
    }).join('');
    const dots = (m, cls) => METRICS.map((mt, i) => { const [x, y] = pt(i, val(m, mt)); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" class="rd-dot ${cls}"/>`; }).join('');
    const desc = (m) => `${m.name}: ${METRICS.map((mt) => `${mt.label} ${m[mt.pctKey] === null || m[mt.pctKey] === undefined ? '없음' : topText(m[mt.pctKey])}`).join(', ')}`;
    return `<svg viewBox="-40 -10 ${S + 80} ${S + 20}" class="radar" role="img" aria-label="${esc(`${desc(a)}. ${desc(b)}`)}">
      ${rings}${axes}
      ${a.eligible ? `<polygon points="${poly(a)}" class="rd-shape a"/>` : ''}${b.eligible ? `<polygon points="${poly(b)}" class="rd-shape b"/>` : ''}
      ${a.eligible ? dots(a, 'a') : ''}${b.eligible ? dots(b, 'b') : ''}${labels}</svg>`;
  }

  // how often the two cast the same vote, over the plenary votes both took part in
  let agreeToken = 0;
  function loadAgreement(a, b) {
    const el = $('agree');
    const token = ++agreeToken;
    const votesOf = (m) => fetch(`/bills/${encodeURIComponent(m.id)}.json`).then((r) => (r.ok ? r.json() : Promise.reject(r))).then((d) => d.votes || '');
    Promise.all([loadVoteIndex(), votesOf(a), votesOf(b)]).then(([{ votes }, va, vb]) => {
      if (token !== agreeToken) return;
      const both = [];
      votes.forEach((v, i) => {
        const x = (va[i] || '.').toUpperCase(); const y = (vb[i] || '.').toUpperCase();
        if ('YNA'.includes(x) && 'YNA'.includes(y) && x !== '.' && y !== '.') both.push({ v, x, y });
      });
      if (!both.length) {
        el.innerHTML = '<h2 class="card-title">표결 일치율</h2><p class="muted">두 의원이 함께 참여한 본회의 표결이 없습니다.</p>';
        return;
      }
      const same = both.filter((r) => r.x === r.y).length;
      const clash = both.filter((r) => r.v.clash);
      const clashSame = clash.filter((r) => r.x === r.y).length;
      const diff = both.filter((r) => r.x !== r.y).sort((p, q) => q.v.date.localeCompare(p.v.date));
      const rate = (k, t) => `${((k / t) * 100).toFixed(1)}%`;
      const tag = (m, c, side) => `<span class="ag-choice"><span class="who-tag ${side}">${esc(m.name)}</span><b class="ag-c ag-${c}">${CHOICE[c].label}</b></span>`;
      el.innerHTML = `<div class="card-head"><div><h2 class="card-title">표결 일치율</h2>
          <p class="card-sub">두 의원이 함께 참여한 본회의 표결에서 같은 선택(찬성·반대·기권)을 한 비율 · 불참한 표결은 빼고 계산</p></div></div>
        <div class="ag-top">
          <div class="ag-big"><b class="num">${rate(same, both.length)}</b><span>함께 참여한 ${num(both.length)}건 중 ${num(same)}건 같은 선택</span></div>
          <div class="ag-bar" role="img" aria-label="같은 선택 ${rate(same, both.length)}"><span style="width:${((same / both.length) * 100).toFixed(1)}%"></span></div>
          ${clash.length ? `<p class="plain">여야가 크게 갈린 표결만 보면 <b>${rate(clashSame, clash.length)}</b> (${num(clash.length)}건 중 ${num(clashSame)}건)</p>` : ''}
        </div>
        ${diff.length ? `<h3 class="ag-h">다르게 투표한 표결 <span class="muted num">${num(diff.length)}건</span></h3>
          <div class="ag-list">${diff.slice(0, 8).map((r) => `<a class="ag-row" href="/vote?id=${encodeURIComponent(r.v.id)}">
            <span class="vrow-date num">${kdate(r.v.date)}</span><span class="ag-name">${esc(r.v.name)}</span>
            <span class="ag-pair">${tag(a, r.x, 'a')}${tag(b, r.y, 'b')}</span></a>`).join('')}</div>
          ${diff.length > 8 ? `<p class="card-sub">최근 8건만 보여 드립니다. 각 의원 페이지의 표결 기록에서 전체를 볼 수 있습니다.</p>` : ''}`
        : '<p class="plain">함께 참여한 표결에서 모두 같은 선택을 했습니다.</p>'}`;
    }).catch(() => { if (token === agreeToken) el.innerHTML = '<h2 class="card-title">표결 일치율</h2><p class="muted">표결 기록을 불러오지 못했습니다.</p>'; });
  }

  function render() {
    const { a, b } = sel;
    if (!a || !b) {
      result.innerHTML = '<div class="card skeleton">비교할 두 의원을 선택하세요.</div>';
      return;
    }
    if (a.id === b.id) {
      result.innerHTML = '<div class="card skeleton">서로 다른 두 의원을 선택하세요.</div>';
      return;
    }
    const wins = { a: 0, b: 0 };
    const rows = METRICS.map((mt) => {
      const w = winner(a[mt.pctKey], b[mt.pctKey]);
      if (w) wins[w] += 1;
      return `<div class="cmp-row">
        <div class="cmp-label">${mt.label} <small>비중 ${Math.round((run[mt.weightKey] || 0) * 100)}%</small></div>
        <div class="cmp-pair">
          ${valueCell(a, mt, 'a', w)}
          ${valueCell(b, mt, 'b', w)}
        </div>
        <div class="strip-host" data-key="${mt.key}"></div>
      </div>`;
    }).join('');

    result.innerHTML = `
      <div class="grid grid-2">${headCard(a, 'a')}${headCard(b, 'b')}</div>
      <div id="cmp-share" class="section"></div>
      <div class="grid grid-2 section cmp-top">
        <section class="card">
          <div class="card-head"><div><h2 class="card-title">한눈에 비교</h2>
            <p class="card-sub">네 항목의 백분위(평가 대상 중 위치) · 바깥쪽일수록 상위 · 점선은 중간(50)</p></div></div>
          ${radar(a, b)}
          ${[a, b].filter((m) => !m.eligible).map((m) => `<p class="card-sub">${esc(m.name)} 의원은 ${esc(statusText(m))}(으)로 백분위가 없어 그래프에 표시하지 않습니다.</p>`).join('')}
          <div class="vs-legend"><span class="who-tag a">${esc(a.name)}</span><span class="who-tag b">${esc(b.name)}</span></div>
        </section>
        <section class="card" id="agree"><h2 class="card-title">표결 일치율</h2><div class="skeleton">불러오는 중…</div></section>
      </div>
      <section class="card section">
        <div class="card-head">
          <div>
            <h2 class="card-title">항목별 비교</h2>
            <p class="card-sub">회색 점은 평가 대상 ${num(eligible.length)}명 · 백분위가 높은 쪽에 ▲</p>
          </div>
        </div>
        <div class="vs-legend">
          <span class="who-tag a">${esc(a.name)}</span>
          <b class="num">${wins.a} : ${wins.b}</b>
          <span class="who-tag b">${esc(b.name)}</span>
        </div>
        ${rows}
      </section>`;

    result.querySelectorAll('.strip-host').forEach((el) => {
      const mt = METRICS.find((x) => x.key === el.dataset.key);
      stripPlot(el, {
        members: eligible,
        value: mt.rate,
        fmt: mt.fmt,
        label: `${mt.label}: ${a.name}, ${b.name}`,
        highlights: [{ member: a }, { member: b, cls: 'b' }],
      });
    });

    const url = new URL(window.location.href);
    url.searchParams.set('a', a.id);
    url.searchParams.set('b', b.id);
    window.history.replaceState({}, '', url);
    shareBar($('cmp-share'), { title: `${a.name} vs ${b.name} 의원 비교 — 일하는 국회`, text: `${a.name} vs ${b.name}: 출석·표결·법안 실적과 표결 일치율 비교` });
    loadAgreement(a, b);
  }

  function pick(side, m) {
    sel[side] = m;
    $(`pick-${side}`).value = m ? m.name : '';
    render();
  }

  async function init() {
    try {
      const data = await loadMembers();
      all = data.members;
      run = data.run;
      eligible = all.filter((m) => m.eligible);
      ['a', 'b'].forEach((side) =>
        memberCombo({ input: $(`pick-${side}`), list: $(`list-${side}`), members: all, onPick: (m) => pick(side, m) })
      );
      $('swap').addEventListener('click', () => {
        const { a, b } = sel;
        sel.a = b; sel.b = a;
        $('pick-a').value = sel.a ? sel.a.name : '';
        $('pick-b').value = sel.b ? sel.b.name : '';
        render();
      });
      const params = new URLSearchParams(window.location.search);
      const find = (id) => all.find((m) => m.id === id) || null;
      if (params.get('a')) pick('a', find(params.get('a')));
      if (params.get('b')) pick('b', find(params.get('b')));
      render();
      if (sel.a && !sel.b) $('pick-b').focus();
    } catch (err) {
      result.innerHTML = `<div class="card error">의원 목록을 불러오지 못했습니다: ${esc(err.message)}</div>`;
    }
  }

  init();
})();
