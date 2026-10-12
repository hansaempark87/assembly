(function () {
  const { esc, gradeBadge } = window.NA;
  const root = document.getElementById('am');
  const id = new URLSearchParams(location.search).get('id');
  const kday = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${y}년 ${m}월 ${d}일`; };
  const issue = (t) => (typeof t === 'string' ? { title: t, detail: '' } : t);

  function render(D) {
    document.title = `${kday(D.date)} ${D.committee} 국정감사 AI 요약 — 일하는 국회`;
    const back = document.getElementById('back');
    back.href = `/audit-meeting?id=${encodeURIComponent(D.id)}`;
    back.textContent = `← ${D.committee} ${kday(D.date)} 감사`;
    const S = D.summary;
    if (!S || !S.overview) {
      root.innerHTML = `<div class="card">이 회의의 요약은 아직 준비되지 않았습니다. <a href="${back.href}">회의 페이지로</a></div>`;
      return;
    }
    const ov = S.overview;
    const members = D.speakers.filter(([mid]) => S.members[mid] && S.members[mid].length).map(([mid]) => {
      const [name, party, grade] = D.people[mid] || [mid, '', null];
      const link = party ? `<a href="/member?id=${encodeURIComponent(mid)}">${esc(name)}</a>` : esc(name);
      return `<div class="am-row">
        <div class="am-who">${gradeBadge(grade)}<b>${link}</b><span class="muted">${esc(party || '전직 의원')}</span></div>
        <ol class="am-qa">${S.members[mid].map((t) => `<li><p><span class="am-tag">질의</span>${esc(t.q)}</p><p><span class="am-tag am-tag-a">답변</span>${esc(t.a)}</p></li>`).join('')}</ol>
      </div>`;
    }).join('');
    root.innerHTML = `
      <div class="page-head"><div>
        <span class="chip">AI 요약</span>
        <h1 class="am-h1">${esc(ov.headline)}</h1>
        <p>${esc(D.committee)} 국정감사 · ${kday(D.date)}${D.agencies ? ` · ${esc(D.agencies)}` : ''}</p>
      </div></div>
      <section class="card">
        <h2 class="card-title">요약</h2>
        <p class="am-text">${esc(ov.summary)}</p>
      </section>
      ${ov.issues && ov.issues.length ? `<section class="card section">
        <h2 class="card-title">쟁점별 정리</h2>
        <ol class="am-issues-full">${ov.issues.map(issue).map((t) => `<li><b>${esc(t.title)}</b>${t.detail ? `<p>${esc(t.detail)}</p>` : ''}</li>`).join('')}</ol>
      </section>` : ''}
      ${members ? `<section class="card section">
        <h2 class="card-title">위원별 질의와 답변</h2>
        <p class="card-sub">발언 글자 수가 많은 위원부터</p>
        ${members}
      </section>` : ''}
      <section class="card section am-src">
        <div><h2 class="card-title">회의록 원문</h2>
          <p class="card-sub">이 요약은 국회 공식 회의록을 AI가 정리한 것으로, 일부 표현이 원문과 다를 수 있습니다. 정확한 발언은 원문에서 확인하세요.</p></div>
        <a class="btn btn-primary" href="${esc(D.pdf)}" target="_blank" rel="noopener">원문 내려받기 (PDF)</a>
      </section>`;
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
