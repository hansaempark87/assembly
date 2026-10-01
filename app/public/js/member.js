(function () {
  const content = document.getElementById('content');
  const id = new URLSearchParams(window.location.search).get('id');

  function gradeBadge(grade) {
    if (!grade) return '<span class="grade-badge grade-none">-</span>';
    return `<span class="grade-badge grade-${grade}">${grade}</span>`;
  }

  function pctText(pct) {
    return pct === null || pct === undefined ? '산출 안 됨' : `상위 ${(100 - pct).toFixed(1)}% (백분위 ${pct.toFixed(1)})`;
  }

  async function load() {
    if (!id) {
      content.innerHTML = '<p>의원 ID가 없습니다.</p>';
      return;
    }
    try {
      const res = await fetch(`/api/members/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'load failed');
      const m = data.member;
      document.title = `${m.name} — 일하는 국회`;

      const rankText = m.eligible
        ? `종합 ${m.rank ?? '-'}위 / ${data.totalEligibleMembers}명 중`
        : `재임 ${m.tenure_days}일 — 관찰 기간(180일) 미달로 종합순위 제외`;

      content.innerHTML = `
        <div class="detail-card">
          <h2>${m.name} ${gradeBadge(m.grade)}</h2>
          <p>${m.hanja_name ?? ''} · ${m.party ?? '-'} · ${m.district ?? '-'}</p>
          <p>소속 위원회: ${m.committee ?? '-'}</p>
          <p>재임: ${m.term_start} ~ ${m.term_end ?? '현재'} (${m.tenure_days}일)</p>
          <p><strong>${rankText}</strong></p>
          <a href="/compare.html?a=${encodeURIComponent(m.id)}" style="font-size:0.85rem;color:#2f81f7;text-decoration:none;">다른 의원과 비교하기 &rarr;</a>
        </div>

        <div class="detail-grid">
          <div class="metric-box">
            <h3>입법 성과 (40%)</h3>
            <div class="big">${pctText(m.legislation_percentile)}</div>
            <div class="raw">대표발의 ${m.lead_count}건 중 가결 ${m.lead_passed}건, 대안반영 ${m.lead_alternative}건, 철회 ${m.lead_withdrawn}건, 폐기 ${m.lead_rejected}건, 계류 ${m.lead_pending}건</div>
            <div class="raw">공동발의 참여(참고): ${m.co_lead_count}건</div>
          </div>
          <div class="metric-box">
            <h3>표결 참여 (35%)</h3>
            <div class="big">${pctText(m.vote_percentile)}</div>
            <div class="raw">${m.vote_participated} / ${m.vote_eligible}회 참여 (${m.participation_rate ? (m.participation_rate * 100).toFixed(1) : '-'}%)</div>
            <div class="raw">재임 경계일 등 예외 제외: ${m.vote_excluded}건</div>
          </div>
          <div class="metric-box">
            <h3>본회의 출석 (25%)</h3>
            <div class="big">${pctText(m.attendance_percentile)}</div>
            <div class="raw">${m.attendance_present} / ${m.attendance_meetings}일 출석 (${m.attendance_rate ? (m.attendance_rate * 100).toFixed(1) : '-'}%)</div>
            <div class="raw">결석 ${m.absent_count}일 · 청가 ${m.leave_count}일 · 출장 ${m.travel_count}일</div>
          </div>
        </div>

        <div class="detail-card">
          <p style="font-size:0.85rem;color:#57606a;">
            위원회 출석은 회의일·재임 연결 검증이 끝나지 않아 이 산식에 포함되지 않았습니다.
            등급과 백분위는 설계자가 정한 비중에 따른 상대적 지표이며, 절대적인 의정활동 평가가 아닙니다.
            산식 상세: <a href="https://github.com/hansaempark87/assembly/blob/main/docs/evaluation-draft.md" target="_blank" rel="noopener">평가 설계 문서</a>
          </p>
        </div>
      `;
    } catch (err) {
      content.innerHTML = `<p>데이터를 불러오지 못했습니다: ${err.message}</p>`;
    }
  }

  load();
})();
