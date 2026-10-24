// Server-side text for crawlers and link previews. The pages are rendered in
// the browser, so without this a crawler would see an empty shell. The
// client script replaces these blocks once it loads.
import { run, allMembers } from './scoring.js';

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (r) => (r === null || r === undefined ? '-' : `${(r * 100).toFixed(1)}%`);
const STATUS = { short_tenure: '관찰 기간 부족', role_hold: '겸직으로 평가 유보' };

export function loadAll() {
  return allMembers();
}

export function memberSummary(m, evaluated) {
  const reflected = (m.lead_passed || 0) + (m.lead_alternative || 0);
  const standing = m.eligible ? `종합 ${m.rank}위 / ${evaluated}명 · ${m.grade}등급` : STATUS[m.status] || '평가 제외';
  const description =
    `${m.party || ''} ${m.district || ''} · ${standing} · 표결 참여율 ${pct(m.participation_rate)} · ` +
    `본회의 출석률 ${pct(m.attendance_rate)} · 대표발의 ${m.lead_count ?? 0}건 중 ${reflected}건 법안 반영`;
  const html = `<section class="card"><h1>${esc(m.name)} <small>${esc(m.hanja_name || '')}</small></h1>
    <p>${esc(m.party || '')} · ${esc(m.district || '')} · 소속 위원회: ${esc(m.committee || '-')}</p>
    <p><b>${esc(standing)}</b></p>
    <ul>
      <li>입법 성과: 대표발의 ${m.lead_count ?? 0}건 중 가결 ${m.lead_passed ?? 0}건, 대안반영 ${m.lead_alternative ?? 0}건, 계류 ${m.lead_pending ?? 0}건</li>
      <li>표결 참여: ${m.vote_participated ?? 0} / ${m.vote_eligible ?? 0}회 (${pct(m.participation_rate)})</li>
      <li>본회의 출석: ${m.attendance_present ?? 0} / ${m.attendance_meetings ?? 0}일 (${pct(m.attendance_rate)})</li>
      <li>위원회 출석: ${m.committee_present ?? 0} / ${m.committee_meetings_total ?? 0}회 (${pct(m.committee_attendance_rate)})</li>
    </ul>
    <p>${esc(memberNarrative(m, allMembers()))}</p>
    <p>기준일 ${esc(run.data_as_of || '')} · 출처: 열린국회정보, 국회회의록</p></section>`;
  return { title: `${m.name} 의원 출석률·표결 참여·법안 실적 (${m.party || ''} ${(m.district || '').trim()}) — 일하는 국회`, description, html };
}

const median = (xs) => {
  const v = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b);
  if (!v.length) return null;
  const k = Math.floor(v.length / 2);
  return v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2;
};
const compare = (x, med) => (x === null || x === undefined || med === null ? '' : x > med ? '보다 높습니다' : x < med ? '보다 낮습니다' : '과 같습니다');

// plain sentences comparing one member with the median of all evaluated members
export function memberNarrative(m, members) {
  const ev = members.filter((x) => x.eligible);
  const mv = median(ev.map((x) => x.participation_rate));
  const ma = median(ev.map((x) => x.attendance_rate));
  const mc = median(ev.map((x) => x.committee_attendance_rate));
  const reflected = (m.lead_passed || 0) + (m.lead_alternative || 0);
  const s = [];
  s.push(`${m.name} 의원은 ${m.party || ''} 소속으로 ${m.district || ''}에서 활동하고 있으며, 제22대 국회에서 ${m.tenure_days ?? '-'}일 재임했습니다.`);
  s.push(`대표발의한 법안 ${m.lead_count ?? 0}건 가운데 ${m.lead_passed ?? 0}건이 그대로 가결됐고 ${m.lead_alternative ?? 0}건이 위원회 대안에 반영돼, 모두 ${reflected}건이 법에 반영됐습니다.`);
  if (m.participation_rate !== null && m.participation_rate !== undefined)
    s.push(`본회의 표결 참여율은 ${pct(m.participation_rate)}로 평가 대상 의원 중간값(${pct(mv)})${compare(m.participation_rate, mv)}.`);
  if (m.attendance_rate !== null && m.attendance_rate !== undefined)
    s.push(`본회의 출석률은 ${pct(m.attendance_rate)}(중간값 ${pct(ma)}), 위원회 출석률은 ${pct(m.committee_attendance_rate)}(중간값 ${pct(mc)})입니다.`);
  s.push(m.eligible ? `네 가지 지표를 합친 종합 순위는 ${ev.length}명 중 ${m.rank}위로 ${m.grade}등급입니다.` : `재임 기간이나 겸직 때문에 종합 등급은 매기지 않았습니다.`);
  return s.join(' ');
}

// the four headline tiles of the home page, as the client script draws them
export function homeKpis(members) {
  const ev = members.filter((x) => x.eligible);
  const lead = members.reduce((a, m) => a + (m.lead_count || 0), 0);
  const refl = members.reduce((a, m) => a + (m.lead_passed || 0) + (m.lead_alternative || 0), 0);
  const tile = (label, value, meta) => `<div class="card"><div class="kpi-label">${label}</div><div class="kpi-value num">${value}</div><div class="kpi-meta">${meta}</div></div>`;
  return [
    tile('평가 대상 의원', `${ev.length}<small>명</small>`, `전체 ${members.length}명`),
    tile('법에 반영된 대표발의', `${refl.toLocaleString('ko-KR')}<small>건</small>`, `대표발의 ${lead.toLocaleString('ko-KR')}건 중 ${pct(refl / lead)}`),
    tile('표결 참여율 중앙값', pct(median(ev.map((m) => m.participation_rate))), '본회의 기록표결 기준'),
    tile('본회의 출석률 중앙값', pct(median(ev.map((m) => m.attendance_rate))), '본회의가 열린 날 기준'),
  ].join('');
}

export function boardRows(members) {
  return members
    .map(
      (m) => `<tr><td>${m.rank ?? '–'}</td><td><a href="/member?id=${encodeURIComponent(m.id)}">${esc(m.name)}</a> ${esc(m.party || '')} · ${esc(m.district || '')}</td><td>${esc(m.grade || '–')}</td><td colspan="4">표결 ${pct(m.participation_rate)} · 본회의 출석 ${pct(m.attendance_rate)} · 대표발의 ${m.lead_count ?? 0}건</td></tr>`
    )
    .join('');
}

// HTMLRewriter handlers shared by the page functions
export const setText = (text) => ({ element: (el) => el.setInnerContent(text) });
export const setAttr = (name, value) => ({ element: (el) => el.setAttribute(name, value) });
export const setHtml = (html) => ({ element: (el) => el.setInnerContent(html, { html: true }) });
export const appendHtml = (html) => ({ element: (el) => el.append(html, { html: true }) });
