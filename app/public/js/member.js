(function () {
  const { esc, num, pct, topText, GRADE_BAND, rankText, statusText, roleText, gradeBadge, loadMembers, METRICS, stripPlot, stackedBar } = window.NA;
  const content = document.getElementById('content');
  const id = new URLSearchParams(window.location.search).get('id');

  const fact = (label, value) => `<div class="fact"><span>${label}</span><b class="num">${value}</b></div>`;

  // Extra per-pillar detail below the distribution strip.
  function detail(key, m) {
    if (key === 'legislation') {
      return `
        <div class="card-sub" style="margin:14px 0 8px">대표발의 ${num(m.lead_count)}건 처리 상태</div>
        ${stackedBar([
          { label: '가결', value: m.lead_passed, color: 'var(--s-blue)' },
          { label: '대안반영', value: m.lead_alternative, color: 'var(--s-aqua)' },
          { label: '계류', value: m.lead_pending, color: 'var(--s-neutral)' },
          { label: '폐기', value: m.lead_rejected, color: 'var(--s-orange)' },
          { label: '철회', value: m.lead_withdrawn, color: 'var(--s-violet)' },
        ], '건')}
        <div class="facts">${fact('공동발의 (참고)', `${num(m.co_lead_count)}건`)}</div>`;
    }
    if (key === 'vote') {
      return `<div class="facts">
        ${fact('참여', `${num(m.vote_participated)}회`)}
        ${fact('표결 대상', `${num(m.vote_eligible)}회`)}
        ${fact('불참', `${num(m.vote_eligible - m.vote_participated)}회`)}
        ${fact('예외 제외', `${num(m.vote_excluded)}건`)}
      </div>`;
    }
    if (key === 'attendance') {
      return `
        <div class="card-sub" style="margin:14px 0 8px">본회의 ${num(m.attendance_meetings)}일 출결</div>
        ${stackedBar([
          { label: '출석', value: m.attendance_present, color: 'var(--s-blue)' },
          { label: '출장', value: m.travel_count, color: 'var(--s-aqua)' },
          { label: '청가', value: m.leave_count, color: 'var(--s-violet)' },
          { label: '결석', value: m.absent_count, color: 'var(--s-orange)' },
        ], '일')}`;
    }
    if (!m.committee_meetings_total) return '';
    return `
      <div class="card-sub" style="margin:14px 0 8px">위원회 ${num(m.committee_meetings_total)}회 출결 · 월별 집계 ${num(m.committee_months_covered)}개월</div>
      ${stackedBar([
        { label: '출석', value: m.committee_present, color: 'var(--s-blue)' },
        { label: '출장', value: m.committee_travel, color: 'var(--s-aqua)' },
        { label: '청가', value: m.committee_leave, color: 'var(--s-violet)' },
        { label: '결석', value: m.committee_absent, color: 'var(--s-orange)' },
      ], '회')}`;
  }

  function render(m, all, run) {
    document.title = `${m.name} 성적표 — 일하는 국회`;
    const eligible = all.filter((x) => x.eligible);
    const party = eligible.filter((x) => x.party === m.party).sort((a, b) => a.rank - b.rank);
    const partyRank = party.findIndex((x) => x.id === m.id) + 1;

    const scored = METRICS.filter((mt) => m[mt.pctKey] !== null && m[mt.pctKey] !== undefined);
    const best = scored.slice().sort((a, b) => m[b.pctKey] - m[a.pctKey])[0];
    const worst = scored.slice().sort((a, b) => m[a.pctKey] - m[b.pctKey])[0];

    const score = m.eligible
      ? `<div class="profile-score">
          ${gradeBadge(m.grade, 'grade-lg')}
          <div>
            <div class="big num">${rankText(m, all)} <span class="muted" style="font-size:1rem;font-weight:500">/ ${num(eligible.length)}명</span></div>
            <div class="sub">${esc(m.grade)}등급(${GRADE_BAND[m.grade]}) · 종합 ${topText(m.composite_percentile)}${partyRank ? ` · ${esc(m.party)} ${num(party.length)}명 중 ${partyRank}위` : ''}</div>
          </div>
        </div>`
      : `<div class="profile-score">${gradeBadge(null, 'grade-lg')}<div><div class="big">${statusText(m)}</div><div class="sub">${
          m.status === 'role_hold'
            ? `겸직 기간을 뺀 관찰 기간 ${num(m.observed_days)}일`
            : `재임 ${num(m.tenure_days)}일`
        } · ${num(run.min_tenure_days)}일 이상부터 등급 산출</div></div></div>`;

    // State offices: current ones as profile chips, past ones as a career line,
    // and a note on what the scoring removed for 국회의장·총리·장관 periods.
    const kdot = (iso) => iso.slice(0, 10).replace(/-/g, '.');
    const srcLinks = (r) => r.sources.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">출처${r.sources.length > 1 ? i + 1 : ''}</a>`).join(' ');
    const current = m.roles.filter((r) => !r.end);
    const currentChips = current.map((r) => `<span class="chip chip-role">현 ${esc(r.role)}</span>`).join('');
    const career = m.roles.length
      ? `<p class="career">${m.roles
          .map((r) => `${r.end ? '전' : '현'} ${esc(r.role)} (${kdot(r.start)}~${r.end ? kdot(r.end) : '현재'}) ${srcLinks(r)}`)
          .join('<br>')}</p>`
      : '';
    const excluded = m.roles.some((r) => r.kind === 'exclude') && m.raw;
    const roleNote = excluded
      ? `<div class="card-foot">겸직 기간의 표결 ${num(m.raw.vote_eligible - m.vote_eligible)}회 · 본회의 ${num(m.raw.attendance_meetings - m.attendance_meetings)}일 · 위원회 ${num(m.raw.committee_meetings_total - m.committee_meetings_total)}회와 재임 ${num(m.tenure_days - m.observed_days)}일은 평가의 분자·분모에서 함께 뺐습니다. 국가 공직 수행 기간을 의정활동 부진으로 계산하지 않기 위해서입니다.</div>`
      : '';

    const summary =
      m.eligible && best && worst && best !== worst
        ? `<div class="card-foot">가장 높은 항목은 <b>${best.label}</b>(${topText(m[best.pctKey])}), 가장 낮은 항목은 <b>${worst.label}</b>(${topText(m[worst.pctKey])})입니다.</div>`
        : '';

    const cards = METRICS.map((mt) => {
      const v = mt.rate(m);
      const p = m[mt.pctKey];
      return `<section class="card metric-card">
        <div class="card-head" style="margin-bottom:8px">
          <h2 class="card-title">${mt.label} <span class="weight">비중 ${Math.round((run[mt.weightKey] || 0) * 100)}%</span></h2>
        </div>
        <div class="headline">
          <span class="v num">${mt.headline ? mt.headline(m) : v === null || v === undefined ? '–' : mt.fmt(v)}</span>
          ${mt.headline && v !== null && v !== undefined ? `<span class="muted">채점 ${mt.fmt(v)}</span>` : ''}
          ${p === null || p === undefined ? '' : `<span class="pct ${p < 50 ? 'low' : ''}">${topText(p)}</span>`}
        </div>
        <p class="plain">${esc(mt.plain(m))}</p>
        ${m.raw && mt.rawRate ? `<p class="card-sub" style="margin:-6px 0 10px">겸직 기간 포함 시: ${esc(mt.rawRate(m.raw, m))}</p>` : ''}
        <div class="card-sub">${mt.axisNote} · 평가 대상 ${num(eligible.length)}명 분포</div>
        <div class="strip-host" data-key="${mt.key}"></div>
        ${detail(mt.key, m)}
      </section>`;
    }).join('');

    content.innerHTML = `
      <section class="card">
        <div class="profile">
          <div class="profile-main">
            <h1>${esc(m.name)} <small>${esc(m.hanja_name || '')}</small></h1>
            <div class="chips">
              ${currentChips}
              <span class="chip">${esc(m.party || '-')}</span>
              <span class="chip">${esc(m.district || '-')}</span>
              <span class="chip">재임 ${num(m.tenure_days)}일 · ${esc(m.term_start)} ~ ${esc(m.term_end || '현재')}</span>
            </div>
            ${career}
            <div class="chips">${m.committees.map((c) => `<span class="chip" style="background:var(--accent-soft);color:var(--accent-ink)">${esc(c)}</span>`).join('')}</div>
          </div>
          ${score}
          <a class="btn" href="/compare?a=${encodeURIComponent(m.id)}">다른 의원과 비교 →</a>
        </div>
        ${summary}
        ${roleNote}
      </section>
      <div class="grid grid-2 section">${cards}</div>
      <p class="muted" style="font-size:0.8rem;margin-top:16px">
        기준일 ${esc(run.created_at.slice(0, 10))} · 등급은 설계자가 정한 비중에 따른 상대 지표이며 정식 공개 승인 전입니다.
        입법 성과는 반영 건수가 아니라 채점 점수(가결 1 + 대안반영 0.5, 재임 1년 환산)로 순위를 매깁니다.
        <a href="/method">평가 방법</a>
      </p>`;

    content.querySelectorAll('.strip-host').forEach((el) => {
      const mt = METRICS.find((x) => x.key === el.dataset.key);
      stripPlot(el, {
        members: eligible,
        value: mt.rate,
        fmt: mt.fmt,
        label: `${mt.label} 분포`,
        highlights: [{ member: m }],
        selfId: m.id,
      });
    });
  }

  async function init() {
    if (!id) {
      content.innerHTML = '<div class="card">의원 ID가 없습니다. <a href="/">대시보드로</a></div>';
      return;
    }
    try {
      const { members, run } = await loadMembers();
      const m = members.find((x) => x.id === id);
      if (!m) {
        content.innerHTML = '<div class="card">해당 의원을 찾을 수 없습니다. <a href="/">대시보드로</a></div>';
        return;
      }
      render(m, members, run);
    } catch (err) {
      content.innerHTML = `<div class="card error">데이터를 불러오지 못했습니다: ${esc(err.message)}</div>`;
    }
  }

  init();
})();
