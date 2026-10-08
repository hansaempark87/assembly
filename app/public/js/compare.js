(function () {
  const { esc, num, topText, gradeBadge, loadMembers, METRICS, stripPlot, memberCombo } = window.NA;
  const $ = (id) => document.getElementById(id);
  const result = $('result');

  let all = [];
  let eligible = [];
  let run = null;
  const sel = { a: null, b: null };

  function headCard(m, side) {
    return `<div class="card vs-card">
      ${gradeBadge(m.grade, 'grade-lg')}
      <div class="who">
        <span class="vs-key ${side}"></span><b><a href="/member.html?id=${encodeURIComponent(m.id)}" style="color:inherit">${esc(m.name)}</a></b>
        <small>${esc(m.party || '-')} · ${esc(m.district || '-')}</small>
        <small>${m.eligible ? `종합 ${num(m.rank)}위 · ${topText(m.composite_percentile)}` : '관찰 기간 부족 (등급 없음)'} · 재임 ${num(m.tenure_days)}일</small>
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
    return `<div class="cmp-val num ${side === 'b' ? 'right' : ''}">
      ${v === null || v === undefined ? '–' : esc(mt.fmt(v))}${win === side ? '<span class="win">▲ 우세</span>' : ''}
      <small>${p === null || p === undefined ? esc(mt.raw(m)) : `${topText(p)} · ${esc(mt.raw(m))}`}</small>
    </div>`;
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
        <div class="cmp-head">
          ${valueCell(a, mt, 'a', w)}
          <div class="label">${mt.label}<small>비중 ${Math.round((run[mt.weightKey] || 0) * 100)}%</small></div>
          ${valueCell(b, mt, 'b', w)}
        </div>
        <div class="strip-host" data-key="${mt.key}"></div>
      </div>`;
    }).join('');

    result.innerHTML = `
      <div class="grid grid-2">${headCard(a, 'a')}${headCard(b, 'b')}</div>
      <section class="card section">
        <div class="card-head">
          <div>
            <h2 class="card-title">항목별 비교</h2>
            <p class="card-sub">회색 점은 평가 대상 ${num(eligible.length)}명, <span class="vs-key"></span>${esc(a.name)} · <span class="vs-key b"></span>${esc(b.name)} · 백분위가 높은 쪽에 ▲</p>
          </div>
          <div class="chip num">${esc(a.name)} ${wins.a} : ${wins.b} ${esc(b.name)}</div>
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
