(function () {
  const { esc, num, gradeBadge } = window.NA;
  const root = document.getElementById('am');
  const id = new URLSearchParams(location.search).get('id');
  const kday = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${y}년 ${m}월 ${d}일`; };

  function who(D, mid) {
    const [name, party, grade] = D.people[mid] || [mid, '', null];
    const link = party ? `<a href="/member?id=${encodeURIComponent(mid)}">${esc(name)}</a>` : esc(name);
    return `${gradeBadge(grade)}<b>${link}</b><span class="muted">${esc(party || '전직 의원')}</span>`;
  }

  function render(D) {
    document.title = `${kday(D.date)} ${D.committee} 국정감사 — 일하는 국회`;
    document.getElementById('back').href = `/audit?y=${D.date.slice(0, 4)}`;
    const ov = D.summary && D.summary.overview;
    let brief;
    if (ov) {
      brief = `<p class="am-brief">${esc(ov.brief || ov.headline)}</p>
        <a class="btn btn-primary" href="/audit-summary?id=${encodeURIComponent(D.id)}">AI 요약본 자세히 보기 →</a>`;
    } else if (D.status === 'upcoming') {
      brief = '<p class="muted">아직 열리지 않은 감사입니다. 감사가 끝나고 회의록이 공개되면 요약이 올라옵니다.</p>';
    } else if (D.status === 'pending') {
      brief = '<p class="muted">국회가 아직 회의록을 공개하지 않았습니다. 공개되면 다음 날 아침 업데이트 때 요약이 자동으로 올라옵니다.</p>';
    } else {
      brief = '<p class="muted">요약을 준비하고 있습니다. 그동안 아래 의원별 발언량과 회의록 원문을 확인할 수 있습니다.</p>';
    }
    const max = D.speakers.length ? D.speakers[0][2] : 1;
    const rows = D.speakers.map(([mid, turns, chars]) => `<div class="barlist-row">
        <div class="barlist-bar"><div class="barlist-fill" style="width:${Math.max(0.5, (chars / max) * 100).toFixed(1)}%"></div>
          <div class="barlist-text">${who(D, mid)}</div></div>
        <div class="barlist-value num">${num(chars)}자<small>${num(turns)}회 발언</small></div>
      </div>`).join('');
    root.innerHTML = `
      <div class="page-head"><div>
        <h1>${esc(D.committee)} 국정감사</h1>
        <p>${kday(D.date)} · ${esc(D.sess)} 정기회</p>
      </div></div>
      ${D.agencies ? `<section class="card"><h2 class="card-title">감사 대상 기관</h2><p class="am-text">${esc(D.agencies)}</p></section>` : ''}
      <section class="card section">
        <div class="card-head"><h2 class="card-title">핵심 요약</h2>${ov ? '<span class="chip">AI 요약</span>' : ''}</div>
        ${brief}
      </section>
      ${rows ? `<section class="card section">
        <h2 class="card-title">질의한 위원</h2>
        <p class="card-sub">${num(D.speakers.length)}명 · 발언 글자 수가 많은 순</p>
        <div class="barlist">${rows}</div>
      </section>` : ''}
      ${D.status === 'done' ? `<section class="card section am-src">
        <div><h2 class="card-title">회의록 원문</h2>
          <p class="card-sub">정확한 발언과 맥락은 국회 공식 회의록에서 확인하세요.</p></div>
        <a class="btn" href="${esc(D.pdf)}" target="_blank" rel="noopener">원문 내려받기 (PDF)</a>
      </section>` : ''}`;
  }

  if (!id || !/^[A-Z0-9]+$/.test(id)) {
    root.innerHTML = '<div class="card">잘못된 주소입니다. <a href="/audit">국정감사 특집으로</a></div>';
    return;
  }
  fetch(`/audit-data/${encodeURIComponent(id)}.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? '해당 회의를 찾을 수 없습니다' : r.status))))
    .then(render)
    .catch((e) => { root.innerHTML = `<div class="card">${esc(e.message)}. <a href="/audit">국정감사 특집으로</a></div>`; });
})();
