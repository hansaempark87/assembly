// Server-side text for crawlers and link previews. The pages are rendered in
// the browser, so without this a crawler would see an empty shell. The
// client script replaces these blocks once it loads.
import { MEMBER_SQL, run, withScores, byRank } from './scoring.js';

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (r) => (r === null || r === undefined ? '-' : `${(r * 100).toFixed(1)}%`);
const STATUS = { short_tenure: '관찰 기간 부족', role_hold: '겸직으로 평가 유보' };

export async function loadAll(db) {
  const { results } = await db.prepare(MEMBER_SQL).all();
  return results.map(withScores).sort(byRank);
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
    <p>기준일 ${esc(run.data_as_of || '')} · 출처: 열린국회정보, 국회회의록</p></section>`;
  return { title: `${m.name} 의원 의정활동 실적 — 일하는 국회`, description, html };
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
