// Server-side text for /party, /laws and /audit. Those pages are drawn in the
// browser from JSON, so without this a crawler sees only "불러오는 중…". The
// client scripts replace these blocks with the interactive versions.
import { esc } from './seo.js';

const pct = (r) => (r === null || r === undefined || Number.isNaN(r) ? '-' : `${(r * 100).toFixed(1)}%`);
const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const mean = (xs) => {
  const v = xs.filter((x) => x !== null && x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

// ---------- /party ----------
export function partyCards(members) {
  const groups = {};
  members.forEach((m) => (groups[m.party || '무소속'] = groups[m.party || '무소속'] || []).push(m));
  return Object.entries(groups)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([party, ms]) => {
      const ev = ms.filter((m) => m.eligible);
      const avg = (k) => mean(ev.map((m) => m[k]));
      const best = [...ev].sort((a, b) => a.rank - b.rank)[0];
      const grades = ['S', 'A', 'B', 'C', 'D'].map((g) => `${g} ${ms.filter((m) => m.grade === g).length}명`).join(', ');
      const refl = mean(ev.map((m) => (m.lead_passed || 0) + (m.lead_alternative || 0)));
      return `<section class="card party-card"><h2 class="card-title">${esc(party)} <span class="muted">${num(ms.length)}명</span></h2>
        <p class="card-sub">평가 대상 ${num(ev.length)}명${best ? ` · 최고 순위 <a href="/member?id=${encodeURIComponent(best.id)}">${esc(best.name)}</a> ${best.rank}위` : ''}</p>
        ${ev.length ? `<ul>
          <li>등급 구성: ${grades}</li>
          <li>표결 참여율 평균 ${pct(avg('participation_rate'))}</li>
          <li>본회의 출석률 평균 ${pct(avg('attendance_rate'))}</li>
          <li>위원회 출석률 평균 ${pct(avg('committee_attendance_rate'))}</li>
          <li>법안 반영 1인 평균 ${refl === null ? '-' : refl.toFixed(1)}건</li>
        </ul>` : '<p class="muted">평가 대상 의원이 없습니다.</p>'}</section>`;
    })
    .join('');
}

// ---------- /laws ----------
const RESULT = { passed: '가결', alt: '대안반영', withdrawn: '철회', rejected: '부결', pending: '계류' };

function lawItem(b) {
  const who = (b.leads || []).map(([id, name]) => `<a href="/member?id=${encodeURIComponent(id)}">${esc(name)}</a>`).join(', ');
  const tail = b.decided ? `${esc(b.result || '')} ${esc(b.decided)}` : `발의 ${esc(b.proposed || '')}`;
  return `<li><b>${esc(b.name)}</b> <span class="muted">${who ? `대표발의 ${who} · ` : ''}${tail}${b.co ? ` · 공동발의 ${num(b.co)}명` : ''}</span>${b.sum ? `<br><small>${b.sum.map(esc).join(' ')}</small>` : ''}</li>`;
}

export function lawsHome(d) {
  const c = d.counts || {};
  const meta = `${esc(d.as_of)} 기준 · 22대 국회 법안 ${num(d.total)}건 · ${Object.entries(RESULT).map(([k, l]) => `${l} ${num(c[k])}건`).join(' · ')}`;
  const clash = (d.clash || []).slice(0, 10).map((v) => {
    const [y, n, a, x] = v.counts || [];
    return `<li><a href="/vote?id=${encodeURIComponent(v.id)}">${esc(v.name)}</a> <span class="muted">${esc(v.date)} ${esc(v.result)} · 찬성 ${num(y)} 반대 ${num(n)} 기권 ${num(a)}${x !== undefined ? ` 불참 ${num(x)}` : ''}</span></li>`;
  }).join('');
  return {
    meta,
    clash: `<ul>${clash}</ul>`,
    recent: `<ul>${(d.recent || []).slice(0, 10).map(lawItem).join('')}</ul>`,
    popular: `<ul>${(d.popular || []).slice(0, 10).map(lawItem).join('')}</ul>`,
  };
}

// ---------- /audit ----------
export function auditStatus(d) {
  const year = Object.keys(d.years).sort().pop();
  const y = d.years[year];
  const ms = y.meetings;
  const n = (s) => ms.filter((m) => m.status === s).length;
  const cmts = [...new Set(ms.map((m) => m.committee))];
  const top = Object.entries(y.members || {}).sort((a, b) => b[1][1] - a[1][1]).slice(0, 20);
  const speak = top.map(([id, [turns, chars, days]], i) => {
    const [name, party] = d.people[id] || [id, ''];
    return `<li>${i + 1}. ${party ? `<a href="/member?id=${encodeURIComponent(id)}">${esc(name)}</a>` : esc(name)} <span class="muted">${esc(party || '전직 의원')} · ${num(chars)}자, ${num(turns)}회, ${num(days)}일</span></li>`;
  }).join('');
  const by = {};
  ms.forEach((m) => (by[m.committee] = by[m.committee] || []).push(m));
  const sched = Object.keys(by).sort((a, b) => a.localeCompare(b, 'ko')).map((c) => {
    const days = by[c].sort((a, b) => a.date.localeCompare(b.date)).map((m) => (m.status === 'upcoming'
      ? esc(m.date.slice(5))
      : `<a href="/audit-${m.sum ? 'summary' : 'meeting'}?id=${encodeURIComponent(m.id)}">${esc(m.date.slice(5))}</a>`)).join(', ');
    return `<p><b>${esc(c.replace(/위원회$/, ''))}</b> ${by[c].length}건: ${days}</p>`;
  }).join('');
  const summed = ms.filter((m) => m.sum).length;
  return {
    status: `<h2>${esc(year)}년 국정감사 (${esc(y.sess)} 정기회)</h2>
      <p>${esc(y.start)} ~ ${esc(y.end)} · 위원회 ${num(cmts.length)}곳 · 감사 회의 ${num(ms.length)}건 · 회의록 공개 ${num(n('done'))}건, 회의록 대기 ${num(n('pending'))}건, 예정 ${num(n('upcoming'))}건${summed ? ` · 회의 요약 ${num(summed)}건` : ''}</p>`,
    speak: `<p>회의록에서 의원 이름으로 시작하는 발언을 모두 세어, 질의 글자 수가 많은 순으로 보여 드립니다.</p><ol>${speak}</ol>`,
    sched,
  };
}
