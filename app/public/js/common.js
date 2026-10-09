// Shared helpers for every page: data loading, formatting, grade badges,
// small HTML/CSS charts, tooltip and member autocomplete.
(function () {
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const nf = new Intl.NumberFormat('ko-KR');
  const num = (n) => (n === null || n === undefined ? '-' : nf.format(n));
  const pct = (r, d = 1) => (r === null || r === undefined ? '-' : `${(r * 100).toFixed(d)}%`);

  // percentile (higher = better) → "상위 N%" for the top half, "하위 N%" below
  // the middle, so a weak result never reads as "상위 90%".
  function topText(p) {
    if (p === null || p === undefined) return '산출 안 됨';
    const top = 100 - p;
    if (top <= 50) return top < 1 ? '상위 1% 이내' : `상위 ${Math.round(top)}%`;
    return p < 1 ? '하위 1% 이내' : `하위 ${Math.round(p)}%`;
  }

  const GRADE_BAND = { S: '상위 10% 이내', A: '상위 10~30%', B: '상위 30~70%', C: '하위 10~30%', D: '하위 10% 이내' };

  // "공동 88위" when another member shares the rank
  function rankText(m, all) {
    if (!m.eligible || m.rank === null || m.rank === undefined) return null;
    const shared = all.some((x) => x !== m && x.eligible && x.rank === m.rank);
    return `${shared ? '공동 ' : ''}${num(m.rank)}위`;
  }

  // Why a member has no grade.
  const STATUS_TEXT = { short_tenure: '관찰 기간 부족', role_hold: '겸직으로 평가 유보', unscored: '평가 전' };
  const statusText = (m) => STATUS_TEXT[m.status] || '평가 제외';

  const kdate = (iso) => (iso ? iso.slice(0, 10).replace(/-/g, '.') : '현재');
  // "국무총리 2025.07.03~2026.07.01"
  const roleText = (r) => `${r.role} ${kdate(r.start)}~${r.end ? kdate(r.end) : '현재'}`;

  function gradeBadge(grade, cls = '') {
    if (!grade) return `<span class="grade ${cls}" title="평가 대상 아님">–</span>`;
    return `<span class="grade grade-${esc(grade)} ${cls}" title="${esc(grade)}등급">${esc(grade)}</span>`;
  }

  function median(values) {
    const a = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v)).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  const mean = (values) => {
    const a = values.filter((v) => v !== null && v !== undefined);
    return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  };

  // Derived per-member raw measures, shared by every page.
  function enrich(m) {
    m.lead_reflected = (m.lead_passed || 0) + (m.lead_alternative || 0);
    m.region = regionOf(m.district);
    m.committees = (m.committee || '').split(',').map((s) => s.trim()).filter(Boolean);
    return m;
  }
  function regionOf(district) {
    if (!district) return '기타';
    const first = district.trim().split(/\s+/)[0];
    if (first.startsWith('세종')) return '세종';
    if (first.startsWith('전남광주')) return '전남·광주';
    return first;
  }

  let membersPromise = null;
  function loadMembers() {
    if (!membersPromise) {
      membersPromise = fetch('/api/members')
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || '불러오기 실패');
          data.members.forEach(enrich);
          return data;
        })
        .catch((err) => {
          membersPromise = null;
          throw err;
        });
    }
    return membersPromise;
  }

  // The four scored pillars, in weight order. `rate` is the raw value plotted
  // on distributions; `pctKey` is the stored percentile used for grades.
  const METRICS = [
    {
      key: 'legislation', label: '입법 성과', weightKey: 'legislation_weight', pctKey: 'legislation_percentile',
      // Same measure the percentile is computed from: (가결 1 + 대안반영 0.5) per tenure day, shown per year.
      rate: (m) => (m.weighted_score === null || m.weighted_score === undefined ? null : m.weighted_score * 365),
      fmt: (v) => `${v.toFixed(1)}점`, unit: '점',
      headline: (m) => `${num(m.lead_reflected)}건`,
      raw: (m) => `대표발의 ${num(m.lead_count)}건 중 ${num(m.lead_reflected)}건 반영`,
      short: (m) => `반영 ${num(m.lead_reflected)}/${num(m.lead_count)}건`,
      plain: (m) =>
        m.lead_count
          ? `대표발의 ${num(m.lead_count)}건 중 ${num(m.lead_reflected)}건 법에 반영`
          : '대표발의한 법안이 없습니다.',
      axisNote: '채점 점수 = (가결 1 + 대안반영 0.5) ÷ 재임 연수',
      rawRate: (raw, m) => `채점 ${((m.lead_passed + 0.5 * m.lead_alternative) / m.tenure_days * 365).toFixed(1)}점 (재임 ${num(m.tenure_days)}일 기준)`,
    },
    {
      key: 'vote', label: '표결 참여', weightKey: 'vote_weight', pctKey: 'vote_percentile',
      rate: (m) => m.participation_rate, fmt: (v) => pct(v), unit: '%',
      raw: (m) => `${num(m.vote_participated)}회 참여 / 대상 ${num(m.vote_eligible)}회`,
      short: (m) => `${pct(m.participation_rate)} · ${num(m.vote_participated)}회`,
      plain: (m) =>
        m.participation_rate !== null && m.participation_rate !== undefined
          ? `표결 ${num(m.vote_eligible)}회 중 ${num(m.vote_participated)}회 참여`
          : '표결 기록이 없습니다.',
      axisNote: '기록표결 참여율',
      rawRate: (raw) => `${pct(raw.participation_rate)} (${num(raw.vote_participated)} / ${num(raw.vote_eligible)}회)`,
    },
    {
      key: 'attendance', label: '본회의 출석', weightKey: 'attendance_weight', pctKey: 'attendance_percentile',
      rate: (m) => m.attendance_rate, fmt: (v) => pct(v), unit: '%',
      raw: (m) => `${num(m.attendance_present)}일 출석 / 개의 ${num(m.attendance_meetings)}일`,
      short: (m) => `${pct(m.attendance_rate)} · ${num(m.attendance_present)}/${num(m.attendance_meetings)}일`,
      plain: (m) =>
        m.attendance_rate !== null && m.attendance_rate !== undefined
          ? `본회의 ${num(m.attendance_meetings)}일 중 ${num(m.attendance_present)}일 출석`
          : '출석 기록이 없습니다.',
      axisNote: '본회의 출석률',
      rawRate: (raw) => `${pct(raw.attendance_rate)} (${num(raw.attendance_present)} / ${num(raw.attendance_meetings)}일)`,
    },
    {
      key: 'committee', label: '위원회 출석', weightKey: 'committee_attendance_weight', pctKey: 'committee_attendance_percentile',
      rate: (m) => m.committee_attendance_rate, fmt: (v) => pct(v), unit: '%',
      raw: (m) => (m.committee_meetings_total ? `${num(m.committee_present)}회 출석 / 회의 ${num(m.committee_meetings_total)}회` : '자료 없음'),
      short: (m) => (m.committee_meetings_total ? `${pct(m.committee_attendance_rate)} · ${num(m.committee_present)}/${num(m.committee_meetings_total)}회` : '자료 없음'),
      plain: (m) =>
        m.committee_meetings_total
          ? `위원회 회의 ${num(m.committee_meetings_total)}회 중 ${num(m.committee_present)}회 출석`
          : '아직 공개된 위원회 출결 자료가 없습니다.',
      axisNote: '위원회 출석률',
      rawRate: (raw) => `${pct(raw.committee_attendance_rate)} (${num(raw.committee_present)} / ${num(raw.committee_meetings_total)}회)`,
    },
  ];

  // ---- tooltip ----
  let tipEl = null;
  function tip(html, x, y) {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'tooltip';
      tipEl.setAttribute('role', 'status');
      document.body.appendChild(tipEl);
    }
    if (html === null) { tipEl.style.display = 'none'; return; }
    tipEl.innerHTML = html;
    tipEl.style.display = 'block';
    const r = tipEl.getBoundingClientRect();
    let left = x + 12;
    let top = y - r.height - 10;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 12;
    if (top < 8) top = y + 16;
    tipEl.style.left = `${left}px`;
    tipEl.style.top = `${top}px`;
  }

  // ---- strip plot: all members as dots, highlighted members as big marks ----
  // opts: { members, value(m), fmt(v), highlights:[{member, cls}], domain:[min,max] }
  function stripPlot(el, opts) {
    const rows = opts.members.filter((m) => {
      const v = opts.value(m);
      return v !== null && v !== undefined && !Number.isNaN(v);
    });
    if (!rows.length) { el.innerHTML = '<div class="muted">자료 없음</div>'; return; }
    const vals = rows.map(opts.value);
    let [lo, hi] = opts.domain || [Math.min(...vals), Math.max(...vals)];
    if (hi === lo) hi = lo + 1;
    const x = (v) => ((v - lo) / (hi - lo)) * 100;
    const med = median(vals);
    // deterministic vertical jitter so dense regions read as density
    const jitter = (id) => {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
      return 22 + (h % 30);
    };
    const dots = rows
      .map((m) => `<span class="strip-dot" style="left:${x(opts.value(m)).toFixed(2)}%;top:${jitter(m.id)}px"></span>`)
      .join('');
    const marks = (opts.highlights || [])
      .filter((h) => h.member && opts.value(h.member) !== null && opts.value(h.member) !== undefined)
      .map((h) => `<span class="strip-mark ${h.cls || ''}" style="left:${x(opts.value(h.member)).toFixed(2)}%;top:37px" aria-hidden="true"></span>`)
      .join('');
    el.innerHTML = `
      <div class="strip" role="img" aria-label="${esc(opts.label || '')}">
        <div class="strip-axis"></div>
        ${dots}
        <div class="strip-median" style="left:${x(med).toFixed(2)}%"><span style="transform:translateX(${x(med) > 85 ? -100 : x(med) < 15 ? 0 : -50}%)">중앙값 ${esc(opts.fmt(med))}</span></div>
        ${marks}
        <div class="strip-hit"></div>
        <div class="strip-ticks"><span style="left:0">${esc(opts.fmt(lo))}</span><span style="left:100%">${esc(opts.fmt(hi))}</span></div>
      </div>`;
    const hit = el.querySelector('.strip-hit');
    const sorted = rows.slice().sort((a, b) => opts.value(a) - opts.value(b));
    const nearest = (clientX) => {
      const r = hit.getBoundingClientRect();
      const v = lo + ((clientX - r.left) / r.width) * (hi - lo);
      let best = sorted[0];
      for (const m of sorted) if (Math.abs(opts.value(m) - v) < Math.abs(opts.value(best) - v)) best = m;
      return best;
    };
    // Many members share a value (e.g. 91/119 days), so a hover shows the whole
    // tied group, highlighted members first, instead of one arbitrary name.
    const marked = (opts.highlights || []).map((h) => h.member).filter(Boolean);
    const groupAt = (clientX) => {
      const r = hit.getBoundingClientRect();
      // snap to a highlighted mark within 8px so a member's own dot shows them
      const snap = marked.find((m) => {
        const v = opts.value(m);
        return v !== null && v !== undefined && Math.abs(r.left + (x(v) / 100) * r.width - clientX) <= 8;
      });
      const v = opts.value(snap || nearest(clientX));
      const group = rows.filter((m) => opts.value(m) === v);
      group.sort((a, b) => marked.includes(b) - marked.includes(a));
      return { v, group };
    };
    const show = (e) => {
      const { v, group } = groupAt(e.clientX);
      const nm = (m) => (marked.includes(m) ? `<b>${esc(m.name)}</b>` : esc(m.name));
      const html =
        group.length === 1
          ? `<b>${esc(group[0].name)}</b> · ${esc(group[0].party || '')}<br>${esc(opts.fmt(v))}`
          : `<b>${esc(opts.fmt(v))}</b> · ${group.length}명 동일<br>${group.slice(0, 3).map(nm).join(', ')}${group.length > 3 ? ` 외 ${group.length - 3}명` : ''}`;
      tip(html, e.clientX, e.clientY);
      return group[0];
    };
    let tapped = null;
    hit.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') show(e); });
    hit.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') tip(null); });
    hit.addEventListener('click', (e) => {
      const m = groupAt(e.clientX).group[0];
      // touch: first tap previews, a second tap on the same member opens it
      if (e.pointerType && e.pointerType !== 'mouse' && tapped !== m) { tapped = show(e); return; }
      if (m.id === opts.selfId) return;
      window.location.href = `/member?id=${encodeURIComponent(m.id)}`;
    });
  }

  // ---- stacked bar with legend ----
  // parts: [{label, value, color}]
  function stackedBar(parts, unit = '') {
    const total = parts.reduce((s, p) => s + (p.value || 0), 0);
    if (!total) return '<div class="muted">자료 없음</div>';
    const segs = parts
      .filter((p) => p.value > 0)
      .map((p) => `<span style="flex:${p.value};background:${p.color}" title="${esc(p.label)} ${num(p.value)}${unit}"></span>`)
      .join('');
    const legend = parts
      .map((p) => `<span><i style="background:${p.color}"></i>${esc(p.label)}<b class="num">${num(p.value)}${unit}</b></span>`)
      .join('');
    return `<div class="stack" role="img" aria-label="${esc(parts.map((p) => `${p.label} ${p.value}${unit}`).join(', '))}">${segs}</div><div class="legend">${legend}</div>`;
  }

  function meter(p) {
    if (p === null || p === undefined) return '<div class="meter"></div>';
    return `<div class="meter"><div class="meter-fill" style="width:${Math.max(1, p).toFixed(1)}%"></div><div class="meter-mid"></div></div>`;
  }

  // ---- member autocomplete (combobox) ----
  // opts: { input, list, members, onPick(m) }
  function memberCombo({ input, list, members, onPick }) {
    let items = [];
    let active = -1;
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
    const render = () => {
      const q = norm(input.value);
      if (!q) { list.classList.remove('open'); input.setAttribute('aria-expanded', 'false'); return; }
      items = members
        .filter((m) => norm(`${m.name}${m.party}${m.district}${m.region}`).includes(q))
        .sort((a, b) => (norm(a.name).startsWith(q) ? 0 : 1) - (norm(b.name).startsWith(q) ? 0 : 1))
        .slice(0, 10);
      active = items.length ? 0 : -1;
      list.innerHTML = items.length
        ? items
            .map(
              (m, i) => `<div class="combo-item" role="option" id="${list.id}-${i}" data-i="${i}" aria-selected="${i === active}">
                ${gradeBadge(m.grade)}<b>${esc(m.name)}</b><span class="meta">${esc(m.party || '')}<br>${esc(m.district || '')}</span></div>`
            )
            .join('')
        : '<div class="combo-empty">일치하는 의원이 없습니다</div>';
      list.classList.add('open');
      input.setAttribute('aria-expanded', 'true');
      if (active >= 0) input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
    };
    const highlight = () => {
      list.querySelectorAll('.combo-item').forEach((el, i) => el.setAttribute('aria-selected', String(i === active)));
      if (active >= 0) {
        input.setAttribute('aria-activedescendant', `${list.id}-${active}`);
        list.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
      }
    };
    const pick = (i) => {
      const m = items[i];
      if (!m) return;
      list.classList.remove('open');
      input.setAttribute('aria-expanded', 'false');
      onPick(m);
    };
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', list.id);
    input.setAttribute('aria-expanded', 'false');
    list.setAttribute('role', 'listbox');
    input.addEventListener('input', render);
    input.addEventListener('focus', () => input.value && render());
    input.addEventListener('keydown', (e) => {
      if (!list.classList.contains('open')) return;
      if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); highlight(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); highlight(); e.preventDefault(); }
      else if (e.key === 'Enter') { pick(active); e.preventDefault(); }
      else if (e.key === 'Escape') { list.classList.remove('open'); }
    });
    list.addEventListener('mousedown', (e) => {
      const el = e.target.closest('.combo-item');
      if (el) { e.preventDefault(); pick(Number(el.dataset.i)); }
    });
    document.addEventListener('click', (e) => {
      if (!list.contains(e.target) && e.target !== input) list.classList.remove('open');
    });
  }

  // ---- scroll reveal ----
  // Marks elements .reveal and adds .in-view once they enter the upper 88%
  // of the viewport (works for very tall cards too), then
  // calls onShow(el). Without IntersectionObserver everything shows at once.
  let io = null;
  const shown = new WeakMap();
  function reveal(els, onShow) {
    const list = Array.from(els);
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      list.forEach((el) => { el.classList.add('reveal', 'in-view'); onShow && onShow(el); });
      return;
    }
    io = io || new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('in-view');
        io.unobserve(e.target);
        const cb = shown.get(e.target);
        if (cb) cb(e.target);
      });
    }, { threshold: 0, rootMargin: '0px 0px -12% 0px' });
    list.forEach((el) => {
      if (el.classList.contains('in-view')) return;
      el.classList.add('reveal');
      if (onShow) shown.set(el, onShow);
      io.observe(el);
    });
  }

  // ---- theme toggle ----
  function initTheme() {
    const btn = document.getElementById('theme-toggle');
    if (!btn) return;
    const root = document.documentElement;
    const isDark = () =>
      root.dataset.theme ? root.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const paint = () => { btn.textContent = isDark() ? '☀' : '☾'; btn.setAttribute('aria-label', isDark() ? '라이트 모드' : '다크 모드'); };
    btn.addEventListener('click', () => {
      root.dataset.theme = isDark() ? 'light' : 'dark';
      try { localStorage.setItem('theme', root.dataset.theme); } catch (_) { /* storage unavailable */ }
      paint();
    });
    paint();
  }
  try {
    const saved = localStorage.getItem('theme');
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  } catch (_) { /* storage unavailable */ }
  document.addEventListener('DOMContentLoaded', initTheme);


  // ---------- plenary votes ----------
  const CHOICE = {
    Y: { label: '찬성', color: 'var(--s-blue)' },
    N: { label: '반대', color: 'var(--s-orange)' },
    A: { label: '기권', color: 'var(--s-violet)' },
    X: { label: '불참', color: 'var(--s-neutral)' },
  };
  // Conventional party colours, used only where the party itself is the subject.
  const PARTY_COLOR = {
    '더불어민주당': '#1f6fd1', '국민의힘': '#e2404b', '조국혁신당': '#0b3a7e', '진보당': '#d6336c',
    '개혁신당': '#f08c00', '기본소득당': '#12a594', '사회민주당': '#9c4dcc', '무소속': '#9aa1ab',
  };
  const partyColor = (p) => PARTY_COLOR[p] || '#b8bec8';
  // Seating order from the chamber's left to right; parties not listed sit
  // between the two blocs, larger first.
  const LEFT = ['더불어민주당', '조국혁신당', '진보당', '기본소득당', '사회민주당'];
  const RIGHT = ['개혁신당', '국민의힘'];
  function partyOrder(counts) {
    const mid = Object.keys(counts).filter((p) => !LEFT.includes(p) && !RIGHT.includes(p))
      .sort((a, b) => (a === '무소속') - (b === '무소속') || counts[b] - counts[a]);
    return [...LEFT, ...mid, ...RIGHT].filter((p) => counts[p]);
  }

  // Semicircle seat chart. seats: [{id, name, party, color, title}] already in
  // left-to-right order. Seats are laid out in concentric rows and filled by
  // angle, so each block reads as a wedge like the real chamber.
  function hemicycle(el, { seats, rows, label, onPick }) {
    const n = seats.length;
    if (!n) { el.innerHTML = '<div class="muted">자료 없음</div>'; return; }
    rows = rows || Math.max(4, Math.round(Math.sqrt(n / 3)));
    const r0 = 0.38;
    const radii = Array.from({ length: rows }, (_, i) => r0 + (i * (1 - r0)) / (rows - 1));
    const sum = radii.reduce((a, b) => a + b, 0);
    const per = radii.map((r) => Math.max(1, Math.round((n * r) / sum)));
    let diff = n - per.reduce((a, b) => a + b, 0);
    for (let i = rows - 1; diff !== 0; i = (i - 1 + rows) % rows) { per[i] += Math.sign(diff); diff -= Math.sign(diff); }
    const pos = [];
    radii.forEach((r, i) => {
      for (let k = 0; k < per[i]; k++) {
        const a = per[i] === 1 ? Math.PI / 2 : Math.PI - (k * Math.PI) / (per[i] - 1);
        pos.push({ a, r, x: 1 + r * Math.cos(a), y: 1 - r * Math.sin(a) });
      }
    });
    pos.sort((p, q) => q.a - p.a || p.r - q.r);
    const dot = ((1 - r0) / (rows - 1)) * 0.42;
    const circles = seats.map((s, i) => {
      const p = pos[i];
      return `<circle class="seat${s.cls ? ' ' + s.cls : ''}" cx="${p.x.toFixed(4)}" cy="${p.y.toFixed(4)}" r="${dot.toFixed(4)}" fill="${s.color}" data-i="${i}"></circle>`;
    }).join('');
    el.innerHTML = `<svg class="hemi" viewBox="${-dot} ${-dot} ${2 + 2 * dot} ${1 + 2 * dot}" role="img" aria-label="${esc(label || '')}">${circles}</svg>`;
    const svg = el.firstChild;
    const at = (e) => { const i = e.target.dataset && e.target.dataset.i; return i === undefined ? null : seats[+i]; };
    svg.addEventListener('mousemove', (e) => { const s = at(e); tip(s ? s.title : null, e.clientX, e.clientY); });
    svg.addEventListener('mouseleave', () => tip(null));
    if (onPick) svg.addEventListener('click', (e) => { const s = at(e); if (s) onPick(s); });
    return svg;
  }

  let voteIndex = null;
  const loadVoteIndex = () => (voteIndex = voteIndex || fetch('/vote-data/index.json').then((r) => {
    if (!r.ok) throw new Error('표결 목록을 불러오지 못했습니다');
    return r.json();
  }).catch((e) => { voteIndex = null; throw e; }));

  // ---------- paging and returning to where you were ----------
  // Page numbers under a list instead of an ever-growing "더 보기". On a page
  // change the list's top is brought back into view, so the reader never has
  // to scroll back up through what they already passed.
  function pager(el, { total, page, size, onGo, anchor }) {
    const pages = Math.max(1, Math.ceil(total / size));
    if (pages <= 1) { el.innerHTML = ''; return; }
    const want = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((p) => p >= 1 && p <= pages));
    const list = [...want].sort((a, b) => a - b);
    let html = '';
    list.forEach((p, i) => {
      if (i && p - list[i - 1] > 1) html += '<span class="pager-gap">…</span>';
      html += `<button type="button" class="pager-btn" data-p="${p}"${p === page ? ' aria-current="page"' : ''}>${p}</button>`;
    });
    const from = (page - 1) * size + 1;
    el.innerHTML = `<nav class="pager" aria-label="페이지 이동">
      <button type="button" class="pager-btn" data-p="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="이전 페이지">‹</button>
      ${html}
      <button type="button" class="pager-btn" data-p="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="다음 페이지">›</button>
      <span class="pager-info num">${num(from)}–${num(Math.min(total, page * size))} / ${num(total)}</span>
    </nav>`;
    el.onclick = (e) => {
      const b = e.target.closest('button[data-p]');
      if (!b || b.disabled) return;
      onGo(+b.dataset.p);
      const a = anchor || el;
      if (a.getBoundingClientRect().top < 64) a.scrollIntoView({ block: 'start' });
    };
  }

  // View state (filters, page) kept in the history entry, so the back button
  // returns to the same list, page and scroll position.
  const view = {
    get: (key, def) => (history.state && history.state[key] !== undefined ? history.state[key] : def),
    set(key, val) {
      try { history.replaceState({ ...(history.state || {}), [key]: val }, ''); } catch (e) { /* ignore */ }
    },
    // call once the async content is on the page
    // pages whose content arrives after load restore the position themselves
    manual() { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; },
    restoreScroll() {
      const y = view.get('scrollY', 0);
      if (y) window.scrollTo(0, y);
    },
  };
  let scrollTimer = null;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => view.set('scrollY', Math.round(window.scrollY)), 150);
    toTop.classList.toggle('show', window.scrollY > 900);
  }, { passive: true });

  const toTop = document.createElement('button');
  toTop.type = 'button';
  toTop.className = 'to-top';
  toTop.setAttribute('aria-label', '맨 위로');
  toTop.textContent = '↑';
  toTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  if (document.body) document.body.appendChild(toTop);

  // "링크 복사" plus the phone's own share sheet (KakaoTalk etc.) where available
  function shareBar(el, { title, text }) {
    const url = window.location.href;
    el.innerHTML = `<div class="share">
      ${navigator.share ? '<button type="button" class="btn btn-primary" data-act="share">공유하기</button>' : ''}
      <button type="button" class="btn" data-act="copy">링크 복사</button>
    </div>`;
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      if (b.dataset.act === 'share') {
        try { await navigator.share({ title, text, url }); } catch (err) { /* cancelled */ }
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        b.textContent = '복사했습니다 ✓';
      } catch (err) {
        window.prompt('아래 주소를 복사하세요', url);
      }
      setTimeout(() => { b.textContent = '링크 복사'; }, 2000);
    });
  }

  window.NA = { shareBar, PARTY_COLOR, partyColor, pager, view, kdate, CHOICE, partyOrder, hemicycle, loadVoteIndex, reveal, esc, num, pct, topText, GRADE_BAND, rankText, statusText, roleText, gradeBadge, median, mean, loadMembers, METRICS, tip, stripPlot, stackedBar, meter, memberCombo };
})();
