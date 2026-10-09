(function () {
  const { shareBar, esc, num, kdate, CHOICE, partyOrder, hemicycle, reveal } = window.NA;
  const $ = (id) => document.getElementById(id);
  const content = $('content');
  const id = new URLSearchParams(window.location.search).get('id');
  const pctOf = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '-');

  function kpis(v, total) {
    return `<div class="grid grid-4">${'YNAX'.split('').map((k, i) => `
      <div class="card kpi">
        <div class="kpi-label"><i class="dot-key" style="background:${CHOICE[k].color}"></i>${CHOICE[k].label}</div>
        <div class="kpi-value num">${num(v.counts[i])}<small>명</small></div>
        <div class="kpi-meta">재적 의원 ${num(total)}명 중 ${pctOf(v.counts[i], total)}</div>
      </div>`).join('')}</div>`;
  }

  function partyRows(byParty, order) {
    return order.map((p) => {
      const c = byParty[p];
      const n = c.Y + c.N + c.A + c.X;
      const segs = 'YNAX'.split('').map((k) => (c[k] ? `<span style="flex:${c[k]};background:${CHOICE[k].color}"></span>` : '')).join('');
      const parts = 'YNAX'.split('').filter((k) => c[k]).map((k) => `${CHOICE[k].label} <b class="num">${num(c[k])}</b>`).join(' · ');
      return `<div class="prow">
        <div class="prow-name">${esc(p || '정당 정보 없음')} <small class="num">${num(n)}명</small></div>
        <div class="stack" role="img" aria-label="${esc(p)} ${esc(parts.replace(/<[^>]+>/g, ''))}">${segs}</div>
        <div class="prow-parts">${parts}</div>
      </div>`;
    }).join('');
  }

  // Names for one choice, grouped by party in seating order. A party block
  // larger than BIG folds away so the cross-votes stay visible.
  const BIG = 30;
  function nameList(seats, k, order) {
    const list = seats.filter((s) => s[3] === k);
    if (!list.length) return '';
    const groups = order.map((p) => [p, list.filter((s) => s[2] === p)]).filter(([, g]) => g.length);
    const body = groups.map(([p, g]) => {
      const links = g.map((s) => `<a href="/member?id=${encodeURIComponent(s[0])}">${esc(s[1])}</a>`).join('');
      const head = `${esc(p || '정당 정보 없음')} <span class="num">${num(g.length)}명</span>`;
      return g.length > BIG
        ? `<details class="pgroup"><summary>${head}</summary><div class="name-grid">${links}</div></details>`
        : `<div class="pgroup"><div class="pgroup-head">${head}</div><div class="name-grid">${links}</div></div>`;
    }).join('');
    return `<div class="names"><h3><i class="dot-key" style="background:${CHOICE[k].color}"></i>${CHOICE[k].label} ${num(list.length)}명</h3>${body}</div>`;
  }

  function render(v) {
    document.title = `${v.name} 표결 결과 · 누가 찬성·반대했나 — 일하는 국회`;
    $('title').textContent = v.name;
    $('meta').innerHTML = `${kdate(v.date)} 본회의 · 의안번호 ${esc(v.no)} · <b>${esc(v.result || '결과 미상')}</b> · <a href="${esc(v.url)}" target="_blank" rel="noopener">의안 원문 ↗</a>`;

    shareBar(document.getElementById('share'), { title: `${v.name} 표결 결과`, text: `${v.name} — 찬성 ${v.counts[0]} · 반대 ${v.counts[1]} · 기권 ${v.counts[2]}. 누가 어떻게 투표했는지 보기` });
    const total = v.seats.length;
    const byParty = {};
    for (const s of v.seats) {
      const c = (byParty[s[2]] = byParty[s[2]] || { Y: 0, N: 0, A: 0, X: 0 });
      c[s[3]] += 1;
    }
    const counts = Object.fromEntries(Object.entries(byParty).map(([p, c]) => [p, c.Y + c.N + c.A + c.X]));
    const order = partyOrder(counts);
    const rank = Object.fromEntries(order.map((p, i) => [p, i]));
    const seats = [...v.seats]
      .sort((a, b) => rank[a[2]] - rank[b[2]] || 'YNAX'.indexOf(a[3]) - 'YNAX'.indexOf(b[3]) || a[1].localeCompare(b[1], 'ko'))
      .map((s) => ({ id: s[0], name: s[1], party: s[2], color: CHOICE[s[3]].color,
        title: `<b>${esc(s[1])}</b> · ${esc(s[2])}<br>${CHOICE[s[3]].label}` }));

    const official = v.totals;
    const notes = [];
    if (v.held) notes.push('의석이 바뀐 날의 표결이라 의원 평가의 표결 참여 계산에서는 모든 의원에게서 제외했습니다.');
    if (official.yes !== v.counts[0] || official.no !== v.counts[1] || official.abstain !== v.counts[2]) {
      notes.push(`회의 중 발표된 집계는 찬성 ${num(official.yes)} · 반대 ${num(official.no)} · 기권 ${num(official.abstain)}이며, 회의록에서 정정된 개인별 명단을 따릅니다.`);
    }

    content.innerHTML = `
      ${notes.map((t) => `<div class="notice">${esc(t)}</div>`).join('')}
      ${kpis(v, total)}
      <section class="card section">
        <div class="card-head">
          <div>
            <h2 class="card-title">의석별 표결</h2>
            <p class="card-sub">점 하나가 의원 한 명 · 왼쪽부터 정당별, 표결 당일 소속 기준</p>
          </div>
          <div class="combo hemi-find">
            <span class="combo-icon" aria-hidden="true">⌕</span>
            <input class="input" id="find" type="search" placeholder="의원 찾기" autocomplete="off" aria-label="의석에서 의원 찾기">
          </div>
        </div>
        <div id="hemi" class="hemi-wrap"></div>
        <div class="legend hemi-legend">${'YNAX'.split('').map((k, i) => `<span><i style="background:${CHOICE[k].color}"></i>${CHOICE[k].label}<b class="num">${num(v.counts[i])}</b></span>`).join('')}</div>
        <div class="hemi-parties">${order.map((p) => `<span>${esc(p || '정당 정보 없음')} <b class="num">${num(counts[p])}</b></span>`).join('')}</div>
      </section>
      <div class="grid grid-2 section">
        <section class="card">
          <div class="card-head"><div><h2 class="card-title">정당별 표결</h2></div></div>
          <div class="prows">${partyRows(byParty, order)}</div>
        </section>
        <section class="card">
          <div class="card-head"><div><h2 class="card-title">반대·기권한 의원</h2><p class="card-sub">정당별 · 이름을 누르면 의원 실적으로 이동</p></div></div>
          ${nameList(v.seats, 'N', order)}${nameList(v.seats, 'A', order)}
          ${v.counts[1] + v.counts[2] === 0 ? '<p class="muted">반대·기권한 의원이 없습니다.</p>' : ''}
          ${v.counts[3] ? `<details class="absent"><summary>불참 ${num(v.counts[3])}명 보기</summary>${nameList(v.seats, 'X', order)}</details>` : ''}
        </section>
      </div>`;

    const svg = hemicycle($('hemi'), {
      seats,
      label: `찬성 ${v.counts[0]}, 반대 ${v.counts[1]}, 기권 ${v.counts[2]}, 불참 ${v.counts[3]}`,
      onPick: (s) => { window.location.href = `/member?id=${encodeURIComponent(s.id)}`; },
    });
    $('find').addEventListener('input', (e) => {
      const q = e.target.value.replace(/\s+/g, '');
      svg.classList.toggle('finding', !!q);
      svg.querySelectorAll('.seat').forEach((c) => {
        const s = seats[+c.dataset.i];
        c.classList.toggle('hit', !!q && s.name.includes(q));
      });
    });
    reveal(content.querySelectorAll('.card'));
  }

  if (!id) {
    content.innerHTML = '<div class="card error">표결을 찾을 수 없습니다. <a href="/votes">표결 목록</a>에서 골라 주세요.</div>';
    return;
  }
  fetch(`/vote-data/${encodeURIComponent(id)}.json`)
    .then((r) => { if (!r.ok) throw new Error('해당 표결이 없습니다'); return r.json(); })
    .then(render)
    .catch((e) => {
      $('meta').textContent = '';
      content.innerHTML = `<div class="card error">${esc(e.message)} · <a href="/votes">표결 목록</a></div>`;
    });
})();
