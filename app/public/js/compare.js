(function () {
  const pickA = document.getElementById('pick-a');
  const pickB = document.getElementById('pick-b');
  const suggestA = document.getElementById('suggest-a');
  const suggestB = document.getElementById('suggest-b');
  const result = document.getElementById('result');

  let allMembers = [];
  let selected = { a: null, b: null };

  const params = new URLSearchParams(window.location.search);

  function gradeBadge(grade) {
    if (!grade) return '<span class="grade-badge grade-none">-</span>';
    return `<span class="grade-badge grade-${grade}">${grade}</span>`;
  }

  function pctText(pct) {
    return pct === null || pct === undefined ? '산출 안 됨' : `상위 ${(100 - pct).toFixed(1)}%`;
  }

  function setupSuggest(input, listEl, key) {
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { listEl.style.display = 'none'; return; }
      const matches = allMembers
        .filter((m) => `${m.name} ${m.party ?? ''} ${m.district ?? ''}`.toLowerCase().includes(q))
        .slice(0, 8);
      if (matches.length === 0) { listEl.style.display = 'none'; return; }
      listEl.innerHTML = matches
        .map((m) => `<div data-id="${m.id}">${m.name} · ${m.party ?? '-'} · ${m.district ?? '-'}</div>`)
        .join('');
      listEl.style.display = 'block';
      listEl.querySelectorAll('div').forEach((div) => {
        div.addEventListener('click', () => {
          const m = allMembers.find((x) => x.id === div.dataset.id);
          selected[key] = m;
          input.value = m.name;
          listEl.style.display = 'none';
          maybeCompare();
        });
      });
    });
    document.addEventListener('click', (e) => {
      if (!listEl.contains(e.target) && e.target !== input) listEl.style.display = 'none';
    });
  }

  function row(label, aText, bText, aBetter, bBetter) {
    return `<tr>
      <th>${label}</th>
      <td class="${aBetter ? 'better' : ''}">${aText}</td>
      <td class="${bBetter ? 'better' : ''}">${bText}</td>
    </tr>`;
  }

  function renderCompare(a, b) {
    const legA = a.legislation_percentile, legB = b.legislation_percentile;
    const voteA = a.vote_percentile, voteB = b.vote_percentile;
    const attA = a.attendance_percentile, attB = b.attendance_percentile;
    const compA = a.composite_percentile, compB = b.composite_percentile;

    result.innerHTML = `
      <table class="compare-table">
        <tr>
          <th>항목</th>
          <td class="name-head">${a.name} ${gradeBadge(a.grade)}</td>
          <td class="name-head">${b.name} ${gradeBadge(b.grade)}</td>
        </tr>
        ${row('정당·지역구', `${a.party ?? '-'} · ${a.district ?? '-'}`, `${b.party ?? '-'} · ${b.district ?? '-'}`, false, false)}
        ${row('재임 기간', `${a.term_start} ~ ${a.term_end ?? '현재'} (${a.tenure_days}일)`, `${b.term_start} ~ ${b.term_end ?? '현재'} (${b.tenure_days}일)`, false, false)}
        ${row('종합 순위', a.eligible ? `${a.rank ?? '-'}위` : '관찰기간 부족', b.eligible ? `${b.rank ?? '-'}위` : '관찰기간 부족', a.eligible && b.eligible && a.rank < b.rank, a.eligible && b.eligible && b.rank < a.rank)}
        ${row('입법 성과 (40%)', `${pctText(legA)} <small>(가결+대안 ${a.lead_passed + a.lead_alternative}/${a.lead_count}건)</small>`, `${pctText(legB)} <small>(가결+대안 ${b.lead_passed + b.lead_alternative}/${b.lead_count}건)</small>`, legA !== null && legB !== null && legA > legB, legA !== null && legB !== null && legB > legA)}
        ${row('표결 참여 (35%)', `${pctText(voteA)} <small>(${a.vote_participated}/${a.vote_eligible}회)</small>`, `${pctText(voteB)} <small>(${b.vote_participated}/${b.vote_eligible}회)</small>`, voteA !== null && voteB !== null && voteA > voteB, voteA !== null && voteB !== null && voteB > voteA)}
        ${row('본회의 출석 (25%)', `${pctText(attA)} <small>(${a.attendance_present}/${a.attendance_meetings}일)</small>`, `${pctText(attB)} <small>(${b.attendance_present}/${b.attendance_meetings}일)</small>`, attA !== null && attB !== null && attA > attB, attA !== null && attB !== null && attB > attA)}
        ${row('종합 백분위', pctText(compA), pctText(compB), compA !== null && compB !== null && compA > compB, compA !== null && compB !== null && compB > compA)}
      </table>
    `;
  }

  async function maybeCompare() {
    if (!selected.a || !selected.b) return;
    if (selected.a.id === selected.b.id) {
      result.innerHTML = '<p>서로 다른 두 의원을 선택해주세요.</p>';
      return;
    }
    result.textContent = '불러오는 중…';
    try {
      const res = await fetch(`/api/compare?a=${encodeURIComponent(selected.a.id)}&b=${encodeURIComponent(selected.b.id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'compare failed');
      renderCompare(data.a, data.b);
      const url = new URL(window.location.href);
      url.searchParams.set('a', selected.a.id);
      url.searchParams.set('b', selected.b.id);
      window.history.replaceState({}, '', url);
    } catch (err) {
      result.innerHTML = `<p>비교를 불러오지 못했습니다: ${err.message}</p>`;
    }
  }

  async function init() {
    try {
      const res = await fetch('/api/members');
      const data = await res.json();
      allMembers = data.members;
      setupSuggest(pickA, suggestA, 'a');
      setupSuggest(pickB, suggestB, 'b');

      const aId = params.get('a');
      const bId = params.get('b');
      if (aId) {
        const m = allMembers.find((x) => x.id === aId);
        if (m) { selected.a = m; pickA.value = m.name; }
      }
      if (bId) {
        const m = allMembers.find((x) => x.id === bId);
        if (m) { selected.b = m; pickB.value = m.name; }
      }
      maybeCompare();
    } catch (err) {
      result.innerHTML = `<p>의원 목록을 불러오지 못했습니다: ${err.message}</p>`;
    }
  }

  init();
})();
