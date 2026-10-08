(function () {
  const { esc } = window.NA;
  const host = document.getElementById('notes');
  const kdate = (iso) => iso.replace(/-/g, '.');
  let data = null;
  let names = {};
  let cur = 'all';

  function card(n) {
    const cat = data.categories[n.category] || n.category;
    const members = (n.members || []).map((id) => `<a href="/member?id=${encodeURIComponent(id)}">${esc(names[id] || '의원')} 의원 보기 →</a>`).join(' · ');
    return `<article class="card note" id="${esc(n.id)}">
      <div class="note-meta"><span class="chip">${esc(cat)}</span><span class="muted num">${kdate(n.date)}</span></div>
      <h2>${esc(n.title)}</h2>
      <dl>
        <div><dt>문제</dt><dd>${esc(n.issue)}</dd></div>
        <div class="rule"><dt>기준</dt><dd>${esc(n.rule)}</dd></div>
        <div><dt>영향</dt><dd>${esc(n.impact)}</dd></div>
      </dl>
      ${n.cases ? `<details><summary>해당 사례 ${n.cases.length}건</summary><ul>${n.cases.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
      ${members ? `<p class="note-links">${members}</p>` : ''}
    </article>`;
  }

  function render() {
    const list = data.notes
      .filter((n) => cur === 'all' || n.category === cur)
      .sort((a, b) => b.date.localeCompare(a.date));
    document.getElementById('note-count').textContent = `${list.length}건`;
    host.innerHTML = list.map(card).join('');
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }

  function tabs() {
    const el = document.getElementById('note-tabs');
    const items = [['all', '전체'], ...Object.entries(data.categories)];
    el.innerHTML = items
      .map(([k, v]) => `<button type="button" class="tab" role="tab" data-k="${k}" aria-selected="${k === cur}">${esc(v)}</button>`)
      .join('');
    el.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { cur = b.dataset.k; tabs(); render(); }));
  }

  Promise.all([fetch('/data-notes.json').then((r) => r.json()), window.NA.loadMembers().catch(() => ({ members: [] }))])
    .then(([d, ms]) => {
      ms.members.forEach((m) => (names[m.id] = m.name));
      data = d;
      document.getElementById('notes-updated').textContent = `최종 갱신 ${kdate(d.updated)} · 기준 ${d.notes.length}건`;
      tabs();
      render();
    })
    .catch(() => { host.innerHTML = '<div class="card error">불러오지 못했습니다.</div>'; });
})();
