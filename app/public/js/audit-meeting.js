(function () {
  const { esc, num, kdate, gradeBadge } = window.NA;
  const root = document.getElementById('am');
  const id = new URLSearchParams(location.search).get('id');
  const kday = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${y}년 ${m}월 ${d}일`; };

  function who(D, mid) {
    const [name, party, grade] = D.people[mid] || [mid, '', null];
    const link = party ? `<a href="/member?id=${encodeURIComponent(mid)}">${esc(name)}</a>` : esc(name);
    return `${gradeBadge(grade)}<b>${link}</b><span class="muted">${esc(party || '전직 의원')}</span>`;
  }

  function render(D) {
    document.title = `${kday(D.date)} ${D.committee} 국정감사 요약 — 일하는 국회`;
    document.getElementById('back').href = `/audit?y=${D.date.slice(0, 4)}`;
    const S = D.summary;
    const ov = S && S.overview;
    let summary;
    if (ov) {
      summary = `<p class="am-headline">${esc(ov.headline)}</p>
        <p class="am-text">${esc(ov.summary)}</p>
        ${ov.issues && ov.issues.length ? `<div class="am-issues">${ov.issues.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}`;
    } else if (D.status === 'upcoming') {
      summary = '<p class="muted">아직 열리지 않은 감사입니다. 감사가 끝나고 회의록이 공개되면 요약이 올라옵니다.</p>';
    } else if (D.status === 'pending') {
      summary = '<p class="muted">국회가 아직 회의록을 공개하지 않았습니다. 공개되면 매주 업데이트 때 요약이 자동으로 올라옵니다.</p>';
    } else {
      summary = '<p class="muted">요약을 준비하고 있습니다. 그동안 아래 의원별 발언량과 회의록 원문을 확인할 수 있습니다.</p>';
    }
    const rows = D.speakers.map(([mid, turns, chars]) => {
      const qa = S && S.members[mid] ? S.members[mid] : [];
      return `<div class="am-row">
        <div class="am-who">${who(D, mid)}<span class="am-amt num">${num(chars)}자 · ${num(turns)}회</span></div>
        ${qa.length ? `<ol class="am-qa">${qa.map((t) => `<li><p><span class="am-tag">질의</span>${esc(t.q)}</p><p><span class="am-tag am-tag-a">답변</span>${esc(t.a)}</p></li>`).join('')}</ol>` : ''}
      </div>`;
    }).join('');
    root.innerHTML = `
      <div class="page-head"><div>
        <h1>${esc(D.committee)} 국정감사</h1>
        <p>${kday(D.date)} · ${esc(D.sess)} 정기회</p>
      </div></div>
      ${D.agencies ? `<section class="card"><h2 class="card-title">감사 대상 기관</h2><p class="am-text">${esc(D.agencies)}</p></section>` : ''}
      <section class="card section">
        <div class="card-head"><h2 class="card-title">핵심 요약</h2>${ov ? '<span class="chip">AI 요약</span>' : ''}</div>
        ${summary}
      </section>
      ${rows ? `<section class="card section">
        <div class="card-head"><div><h2 class="card-title">의원별 질의 요지</h2>
          <p class="card-sub">질의한 위원 ${num(D.speakers.length)}명 · 발언 글자 수가 많은 순${S ? ' · 질의와 답변은 회의록을 AI가 요약한 것입니다' : ''}</p></div></div>
        ${rows}
      </section>` : ''}
      ${D.status === 'done' ? `<section class="card section am-src">
        <div><h2 class="card-title">회의록 원문</h2>
          <p class="card-sub">위 요약은 회의록을 바탕으로 정리한 것입니다. 정확한 발언과 맥락은 국회 공식 회의록에서 확인하세요.</p></div>
        <a class="btn btn-primary" href="${esc(D.pdf)}" target="_blank" rel="noopener">원문 내려받기 (PDF)</a>
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
