(function () {
  const kdate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return d ? `${y}년 ${m}월 ${d}일` : `${y}년 ${m}월`; };
  window.NA.loadMembers()
    .then(({ run }) => {
      const c = run.coverage;
      if (c) document.getElementById('coverage').textContent =
        `${c.bills_until ? `법안 처리 ${kdate(c.bills_until)} · ` : ''}표결 ${kdate(c.votes_until)} · 본회의 출결 ${kdate(c.plenary_until)} · 위원회 출결 ${kdate(c.committee_until)}까지`;
      document.getElementById('formula').textContent = run.formula_version;
    })
    .catch(() => { document.getElementById('coverage').textContent = '불러오지 못했습니다'; });
})();
