(function () {
  const tbody = document.getElementById('member-tbody');
  const runInfo = document.getElementById('run-info');
  const searchBox = document.getElementById('search-box');
  const gradeFilter = document.getElementById('grade-filter');
  const sortKey = document.getElementById('sort-key');

  let allMembers = [];
  let runMeta = null;

  function gradeBadge(grade) {
    if (!grade) return '<span class="grade-badge grade-none">-</span>';
    return `<span class="grade-badge grade-${grade}">${grade}</span>`;
  }

  function pctCell(pct, rawText) {
    const pctText = pct === null || pct === undefined ? '-' : `상위 ${(100 - pct).toFixed(1)}%`;
    return `<td class="pct-cell">${pctText}<small>${rawText}</small></td>`;
  }

  function render(list) {
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8">검색 결과가 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = list
      .map((m) => {
        const rank = m.eligible ? (m.rank ?? '-') : '관찰기간 부족';
        const legRaw = `가결+대안 ${m.lead_passed + m.lead_alternative}/${m.lead_count}건`;
        const voteRaw = `${m.vote_participated}/${m.vote_eligible}회`;
        const attRaw = `${m.attendance_present}/${m.attendance_meetings}일`;
        const committeeRaw = m.committee_meetings_total
          ? `${m.committee_present}/${m.committee_meetings_total}회(월별집계)`
          : '자료 없음';
        return `<tr data-id="${m.id}">
          <td>${rank}</td>
          <td>${gradeBadge(m.grade)}</td>
          <td>${m.name}</td>
          <td>${m.party ?? '-'}</td>
          <td>${m.district ?? '-'}</td>
          ${pctCell(m.legislation_percentile, legRaw)}
          ${pctCell(m.vote_percentile, voteRaw)}
          ${pctCell(m.attendance_percentile, attRaw)}
          ${pctCell(m.committee_attendance_percentile, committeeRaw)}
        </tr>`;
      })
      .join('');

    tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.addEventListener('click', () => {
        window.location.href = `/member.html?id=${tr.dataset.id}`;
      });
    });
  }

  function applyFilters() {
    const q = searchBox.value.trim().toLowerCase();
    const g = gradeFilter.value;
    const key = sortKey.value;

    let list = allMembers.filter((m) => {
      if (q) {
        const hay = `${m.name} ${m.party ?? ''} ${m.district ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (g === 'ineligible') return !m.eligible;
      if (g) return m.grade === g;
      return true;
    });

    list.sort((a, b) => {
      if (key === 'name') return a.name.localeCompare(b.name, 'ko');
      if (key === 'rank') {
        if (a.rank === null) return 1;
        if (b.rank === null) return -1;
        return a.rank - b.rank;
      }
      const av = a[key];
      const bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return bv - av;
    });

    render(list);
  }

  async function load() {
    try {
      const res = await fetch('/api/members');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'load failed');
      allMembers = data.members;
      runMeta = data.run;
      const committeePart = runMeta.committee_attendance_weight
        ? ` · 위원회 출석 ${Math.round(runMeta.committee_attendance_weight * 100)}%(월별 집계, 회의일 구조화 전)`
        : '';
      runInfo.innerHTML = `산식 버전 <strong>${runMeta.formula_version}</strong> · 입법 ${Math.round(runMeta.legislation_weight * 100)}% · 표결 ${Math.round(runMeta.vote_weight * 100)}% · 본회의 출석 ${Math.round(runMeta.attendance_weight * 100)}%${committeePart} · 최소 재임 ${runMeta.min_tenure_days}일 · 계산일 ${runMeta.created_at.slice(0, 10)} · <strong>실제 등급 공개 승인 전 단계입니다.</strong>`;
      applyFilters();
    } catch (err) {
      runInfo.textContent = '데이터를 불러오지 못했습니다: ' + err.message;
      tbody.innerHTML = '<tr><td colspan="8">오류</td></tr>';
    }
  }

  searchBox.addEventListener('input', applyFilters);
  gradeFilter.addEventListener('change', applyFilters);
  sortKey.addEventListener('change', applyFilters);

  load();
})();
