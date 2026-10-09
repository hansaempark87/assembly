(function () {
  const { CHOICE, kdate, loadVoteIndex, esc, num, pct, topText, GRADE_BAND, rankText, statusText, roleText, gradeBadge, loadMembers, METRICS, stripPlot, stackedBar } = window.NA;
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
        <div class="facts">${fact('공동발의 (참고)', `${num(m.co_lead_count)}건`)}</div>
        <a class="btn" style="margin-top:12px" href="#bills">대표발의 법안 목록 보기 ↓</a>`;
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
      <div class="card-sub" style="margin:14px 0 8px">위원회 ${num(m.committee_meetings_total)}회 출결</div>
      ${stackedBar([
        { label: '출석', value: m.committee_present, color: 'var(--s-blue)' },
        { label: '출장', value: m.committee_travel, color: 'var(--s-aqua)' },
        { label: '청가', value: m.committee_leave, color: 'var(--s-violet)' },
        { label: '결석', value: m.committee_absent, color: 'var(--s-orange)' },
      ], '회')}`;
  }

  // Lead-proposed bills with outcome filters and links to the official record.
  const BILL_TABS = [
    ['reflected', '법에 반영', (b) => b.status === 'passed' || b.status === 'alt'],
    ['passed', '가결', (b) => b.status === 'passed'],
    ['alt', '대안반영', (b) => b.status === 'alt'],
    ['pending', '계류', (b) => b.status === 'pending'],
    ['closed', '철회·폐기', (b) => b.status === 'withdrawn' || b.status === 'rejected'],
    ['all', '전체', () => true],
  ];
  const BILL_LABEL = { passed: '가결', alt: '대안반영', pending: '계류', withdrawn: '철회', rejected: '폐기' };
  function renderAreas(areas, onPick) {
    const el = document.getElementById('areas-card');
    if (!areas.length) { el.innerHTML = '<h2 class="card-title">관심 분야</h2><p class="muted">대표발의 법안이 없습니다.</p>'; return; }
    const top = areas.slice(0, 6);
    const rest = areas.slice(6).reduce((s, a) => s + a.bills, 0);
    const total = areas.reduce((s, a) => s + a.bills, 0);
    const max = top[0].bills;
    const lead = areas[0];
    el.innerHTML = `<div class="card-head" style="margin-bottom:6px"><div><h2 class="card-title">관심 분야</h2>
        <p class="card-sub">대표발의 법안의 소관 위원회 기준 · 막대를 누르면 아래 목록이 걸러집니다</p></div></div>
      <p class="plain">최다 발의 분야: <b>${esc(lead.area)}</b> ${num(lead.bills)}건 · 이 분야 발의 의원 중 ${num(lead.rank)}위</p>
      <div class="barlist">${top.map((a, i) => `<button type="button" class="barlist-row area-row" data-area="${esc(a.area)}">
          <div class="barlist-bar"><div class="barlist-fill" style="width:${((a.bills / max) * 100).toFixed(1)}%;--i:${i}"></div>
          <div class="barlist-text"><b>${esc(a.area)}</b><span class="muted">${Math.round((a.bills / total) * 100)}%</span></div></div>
          <div class="barlist-value num">${num(a.bills)}건<small>반영 ${num(a.reflected)}</small></div>
        </button>`).join('')}</div>
      ${rest ? `<p class="card-sub" style="margin-top:8px">그 외 ${num(areas.length - 6)}개 분야 ${num(rest)}건</p>` : ''}`;
    el.querySelectorAll('.area-row').forEach((b) => b.addEventListener('click', () => onPick(b.dataset.area)));
  }

  function renderCoop(m, all, coop, partners) {
    const el = document.getElementById('coop-card');
    const pct1 = (v) => `${(v * 100).toFixed(1)}%`;
    const plist = (arr) => arr.length
      ? arr.map((p) => `<li><a href="/member?id=${encodeURIComponent(p.id)}">${esc(p.name)}</a> <span class="muted">${esc(p.party)}</span><b class="num">${num(p.bills)}건</b></li>`).join('')
      : '<li class="muted">없음</li>';
    const headline = coop.eligible
      ? `<div class="headline"><span class="v num">${pct1(coop.index)}</span>${m.coop_bonus > 0 ? `<span class="pct">가산 +${m.coop_bonus.toFixed(1)}점</span>` : ''}</div>
         <p class="plain">공동발의 참여 ${num(coop.base)}건 중 ${num(coop.cross)}건이 다른 정당 의원${coop.party_median !== null && coop.party_median !== undefined ? ` · 같은 당 중앙값 ${pct1(coop.party_median)}` : ''}</p>`
      : `<p class="plain">${coop.bills < 5 ? '대표발의 법안이 5건 미만이라 협력 지수를 계산하지 않습니다.' : '비교할 정당 기준이 없어 가산점 대상이 아닙니다.'}</p>`;
    el.innerHTML = `<div class="card-head" style="margin-bottom:6px"><div><h2 class="card-title">초당적 협력</h2>
        <p class="card-sub">다른 당 공동발의자 비율 · 같은 당 평균보다 높은 만큼 최대 +3점 가산</p></div></div>
      ${headline}
      <div class="strip-host" id="coop-strip"></div>
      <div class="partners">
        <div><h3>다른 당과 함께한 의원</h3><ol>${plist(partners.other)}</ol></div>
        <div><h3>같은 당에서 함께한 의원</h3><ol>${plist(partners.same)}</ol></div>
      </div>`;
    if (coop.eligible) {
      stripPlot(document.getElementById('coop-strip'), {
        members: all.filter((x) => x.coop_index !== null && x.coop_index !== undefined),
        value: (x) => x.coop_index,
        fmt: pct1,
        label: '초당적 협력 지수 분포',
        highlights: [{ member: m }],
        selfId: m.id,
      });
    }
  }

  function loadBills(m, all) {
    const listEl = document.getElementById('bill-list');
    fetch(`/bills/${encodeURIComponent(m.id)}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
      .then(({ bills, cutoff, areas, partners, coop, votes }) => {
        if (votes) renderVotes(votes);
        let areaFilter = null;
        let cur = bills.some(BILL_TABS[0][2]) ? 'reflected' : 'all';
        let shown = 15;
        if (areas) renderAreas(areas, (a) => { areaFilter = a; cur = 'all'; shown = 15; paint(); document.getElementById('bills').scrollIntoView({ behavior: 'smooth' }); });
        if (coop) renderCoop(m, all, coop, partners);
        document.getElementById('bill-total').textContent = `${num(bills.length)}건 · ${cutoff.replace(/-/g, '.')} 기준`;
        const paint = () => {
          const tab = BILL_TABS.find((t) => t[0] === cur);
          document.getElementById('bill-tabs').innerHTML = BILL_TABS.map(([k, label, f]) =>
            `<button type="button" class="tab" role="tab" data-k="${k}" aria-selected="${k === cur}">${label} ${num(bills.filter((b) => f(b) && (!areaFilter || b.area === areaFilter)).length)}</button>`).join('');
          document.querySelectorAll('#bill-tabs .tab').forEach((b) => b.addEventListener('click', () => { cur = b.dataset.k; shown = 15; paint(); }));
          const list = bills.filter(tab[2]).filter((b) => !areaFilter || b.area === areaFilter);
          const af = document.getElementById('bill-area');
          af.innerHTML = areaFilter ? `분야: <b>${esc(areaFilter)}</b> <button type="button" class="link-btn">해제 ✕</button>` : '';
          af.querySelector('button')?.addEventListener('click', () => { areaFilter = null; paint(); });
          listEl.innerHTML = list.length
            ? list.slice(0, shown).map((b) => `<li>
                <span class="bill-st st-${b.status}">${BILL_LABEL[b.status]}</span>
                <div><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(b.name)}</a>
                <small>발의 ${esc(b.proposed)}${b.decided ? ` · ${esc(b.result)} ${esc(b.decided)}` : ''}${b.committee ? ` · ${esc(b.committee)}` : ''}${b.co ? ' · 공동 대표발의' : ''}</small></div>
              </li>`).join('')
            : '<li class="skeleton">해당하는 법안이 없습니다.</li>';
          const more = document.getElementById('bill-more');
          more.innerHTML = list.length > shown ? `<button class="btn" type="button">더 보기 (${num(list.length - shown)}건 남음)</button>` : '';
          more.querySelector('button')?.addEventListener('click', () => { shown += 30; paint(); });
        };
        paint();
      })
      .catch(() => { listEl.innerHTML = '<li class="skeleton">법안 목록을 불러오지 못했습니다.</li>'; });
  }

  // Every recorded plenary vote while in office, newest first. `votes` has one
  // character per entry of /votes/index.json: Y N A X, or . when not in office.
  function renderVotes(str) {
    const el = document.getElementById('votes-card');
    loadVoteIndex().then(({ votes }) => {
      const mine = votes.map((v, i) => ({ v, c: str[i] })).filter((x) => x.c && x.c !== '.');
      const cnt = { Y: 0, N: 0, A: 0, X: 0 };
      mine.forEach((x) => { cnt[x.c] += 1; });
      let cur = 'all';
      let shown = 15;
      const TABS = [['all', '전체'], ['N', '반대'], ['A', '기권'], ['X', '불참']];
      el.innerHTML = `<div class="card-head">
          <div>
            <h2 class="card-title">본회의 표결 기록 <span class="muted num">${num(mine.length)}건</span></h2>
            <p class="card-sub">재임 중 열린 모든 본회의 표결 · 표결을 누르면 전체 의석 결과를 봅니다</p>
          </div>
          <div class="tabs" role="tablist" id="vote-tabs"></div>
        </div>
        ${stackedBar('YNAX'.split('').map((k) => ({ label: CHOICE[k].label, value: cnt[k], color: CHOICE[k].color })), '건')}
        <div class="section" id="vote-list"></div>
        <div class="more" id="vote-more"></div>
        <div class="card-foot">평가의 표결 참여율은 겸직 기간과 의석이 바뀐 날의 표결을 뺀 값이라 이 건수와 다를 수 있습니다.</div>`;
      const paint = () => {
        document.getElementById('vote-tabs').innerHTML = TABS.map(([k, label]) =>
          `<button type="button" class="tab" role="tab" data-k="${k}" aria-selected="${k === cur}">${label} ${num(k === 'all' ? mine.length : cnt[k])}</button>`).join('');
        document.querySelectorAll('#vote-tabs .tab').forEach((b) => b.addEventListener('click', () => { cur = b.dataset.k; shown = 15; paint(); }));
        const list = mine.filter((x) => cur === 'all' || x.c === cur);
        document.getElementById('vote-list').innerHTML = list.length
          ? list.slice(0, shown).map(({ v, c }) => `<a class="vrec-row" href="/vote?id=${encodeURIComponent(v.id)}">
              <span class="vrow-date num">${kdate(v.date)}</span>
              <span class="vrow-name">${esc(v.name)}</span>
              <span class="choice"><i class="dot-key" style="background:${CHOICE[c].color}"></i>${CHOICE[c].label}</span>
            </a>`).join('')
          : '<p class="muted">해당하는 표결이 없습니다.</p>';
        const more = document.getElementById('vote-more');
        more.innerHTML = list.length > shown ? `<button class="btn" type="button">더 보기 (${num(list.length - shown)}건 남음)</button>` : '';
        more.querySelector('button')?.addEventListener('click', () => { shown += 30; paint(); });
      };
      paint();
    }).catch(() => { el.innerHTML = '<p class="muted">표결 기록을 불러오지 못했습니다.</p>'; });
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
            <div class="sub">${esc(m.grade)}등급(${GRADE_BAND[m.grade]}) · 종합 ${topText(m.composite_percentile)}${partyRank ? ` · ${esc(m.party)} ${num(party.length)}명 중 ${partyRank}위` : ''}${m.coop_bonus > 0 ? ` · 협치 가산 +${m.coop_bonus.toFixed(1)}점` : ''}</div>
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
      <div class="grid grid-2 section">
        <section class="card metric-card" id="areas-card"><h2 class="card-title">관심 분야</h2><div class="skeleton">불러오는 중…</div></section>
        <section class="card metric-card" id="coop-card"><h2 class="card-title">초당적 협력</h2><div class="skeleton">불러오는 중…</div></section>
      </div>
      <section class="card section" id="bills">
        <div class="card-head">
          <div>
            <h2 class="card-title">대표발의 법안 <span class="muted num" id="bill-total"></span></h2>
            <p class="card-sub">대안반영 = 비슷한 법안들과 합쳐 위원회 대안으로 처리된 경우 · 법안 이름을 누르면 국회 의안정보시스템 원문이 열립니다</p>
          </div>
          <div class="tabs" role="tablist" id="bill-tabs"></div>
        </div>
        <p class="card-sub" id="bill-area"></p>
        <ul class="bill-list" id="bill-list"><li class="skeleton">불러오는 중…</li></ul>
        <div class="more" id="bill-more"></div>
      </section>
      <section class="card section" id="votes-card"><h2 class="card-title">본회의 표결 기록</h2><div class="skeleton">불러오는 중…</div></section>
      <p class="muted" style="font-size:0.8rem;margin-top:16px">
        기준일 ${esc(run.data_as_of || run.created_at.slice(0, 10))} · 등급은 정해진 비중에 따른 상대 지표입니다.
        입법 성과는 반영 건수가 아니라 채점 점수(가결 1 + 대안반영 0.5, 재임 1년 환산)로 순위를 매깁니다.
        <a href="/method">평가 방법</a> · <a href="/notes">데이터 처리 기준</a>
      </p>`;

    loadBills(m, all);

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
