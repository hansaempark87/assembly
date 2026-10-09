#!/usr/bin/env python3
"""Rebuild everything the site serves from app/data/source/ (no network).

  app/lib/member-records.js     raw counts per member (served by the API)
  app/data/role-adjustments.json records inside state-office periods
  app/data/coop.json            collaboration index and bonus
  app/public/bills/<id>.json    lead bills, policy areas, partners
  app/lib/score-run.js          percentiles, grades (scripts/compute-scores-stage3.cjs)

Counting rules (published on /notes and /method):
  * Votes: every recorded plenary vote dated within the member's term. Votes
    on a day a seat changed hands are left out for everyone.
    Participation = 찬성, 반대 or 기권.
  * Plenary and committee attendance: the totals printed in the official
    files. Where a file's per-date marks disagree with its printed totals,
    the printed totals are used.
  * Bills: lead-proposed bills proposed up to the bill cut-off; status as of
    the cut-off (passed, reflected in an alternative, withdrawn, rejected,
    pending).
  * Tenure days count up to the bill cut-off.

usage: build.py
"""
import collections, json, os, subprocess, sys

from common import APP, SRC, SCORED_VOTE, STATUSES, days, read_json, read_jsonl, write_json

PASSED = {'원안가결', '수정가결'}
ALT = {'대안반영폐기', '수정안반영폐기'}
INDEPENDENT = '무소속'
MAX_BONUS, MIN_BILLS, MIN_PARTY = 3.0, 5, 3

AREA = {
    '행정안전위원회': '행정·안전', '법제사법위원회': '법무·사법', '보건복지위원회': '보건·복지',
    '국토교통위원회': '국토·교통', '정무위원회': '금융·공정거래', '교육위원회': '교육',
    '기후에너지환경노동위원회': '기후·환경·노동', '환경노동위원회': '기후·환경·노동',
    '재정경제기획위원회': '경제·재정', '기획재정위원회': '경제·재정',
    '농림축산식품해양수산위원회': '농림·해양', '산업통상자원중소벤처기업위원회': '산업·중소기업',
    '과학기술정보방송통신위원회': '과학·방송통신', '문화체육관광위원회': '문화·체육·관광',
    '국방위원회': '국방', '국회운영위원회': '국회 운영', '외교통일위원회': '외교·통일',
    '성평등가족위원회': '성평등·가족', '여성가족위원회': '성평등·가족', '정보위원회': '정보',
}


def area_of(committee):
    if not committee:
        return '미배정'
    return AREA.get(committee, '특별위원회' if '특별위원회' in committee else committee)


def ratio(n, d):
    return n / d if d else None


def ids(s):
    return [x.strip() for x in (s or '').split(',') if x.strip()]


def bill_status(b, cutoff):
    pr, d = b.get('PROC_RESULT'), b.get('PROC_DT')
    if not pr or not d or d > cutoff:
        return 'pending', None
    if pr in PASSED:
        return 'passed', pr
    if pr in ALT:
        return 'alt', pr
    if pr == '철회':
        return 'withdrawn', pr
    return 'rejected', pr


def in_term(m, d):
    return m['term_start'] <= d and (not m['term_end'] or d <= m['term_end'])


class Sources:
    def __init__(self):
        self.meta = read_json('meta.json')
        mj = read_json('members.json')
        self.members = mj['members']
        self.former = mj['former']
        self.by_id = {m['id']: m for m in self.members}
        self.cutoff = self.meta['bills_until']
        self.bills = [b for b in read_jsonl('bills.jsonl') if b['PROPOSE_DT'] <= self.cutoff]
        self.votes = read_jsonl('votes.jsonl')
        self.plenary = read_json('plenary.json')['files']
        self.committee = [r for r in read_jsonl('committee.jsonl') if r['id']]
        self.roles = json.load(open(APP / 'data' / 'member-roles.json', encoding='utf-8'))['roles']

    def coverage(self):
        return {
            'bills_until': self.cutoff,
            'votes_until': max(v['date'] for v in self.votes),
            'plenary_until': max(d for f in self.plenary for d in f['dates']),
            'committee_until': max(r['month'] for r in self.committee),
        }


# ---------- raw records ----------

def records(S):
    vote = collections.defaultdict(lambda: [0, 0, 0])  # eligible, participated, excluded
    for v in S.votes:
        voted = set(v['Y']) | set(v['N']) | set(v['A'])
        for m in S.members:
            if not in_term(m, v['date']):
                continue
            c = vote[m['id']]
            if v['status'] not in SCORED_VOTE:
                c[2] += 1
                continue
            c[0] += 1
            c[1] += m['id'] in voted

    plen = collections.defaultdict(lambda: [0] * 6)
    for f in S.plenary:
        for i, r in f['rows'].items():
            for k in range(6):
                plen[i][k] += r['total'][k]

    cmt = {}
    months = collections.defaultdict(set)
    for r in S.committee:
        t = cmt.setdefault(r['id'], [0] * 6)
        for k in range(6):
            t[k] += r['total'][k]
        months[r['id']].update(d[:7] for d, _ in r['daily'] if d)

    leg = collections.defaultdict(collections.Counter)
    for b in S.bills:
        st, _ = bill_status(b, S.cutoff)
        for i in set(ids(b['RST_MONA_CD'])):
            leg[i]['lead'] += 1
            leg[i][st] += 1
        for i in set(ids(b['PUBL_MONA_CD'])):
            leg[i]['co'] += 1

    out = []
    for m in S.members:
        i = m['id']
        tenure = days(m['term_start'], min(m['term_end'] or S.cutoff, S.cutoff))
        l, v, p = leg[i], vote[i], plen[i]
        c = cmt.get(i)
        row = {
            'id': i, 'name': m['name'], 'hanja_name': m['hanja_name'], 'party': m['party'], 'district': m['district'],
            'committee': m['committee'], 'term_start': m['term_start'], 'term_end': m['term_end'], 'tenure_days': tenure,
            'lead_count': l['lead'], 'lead_passed': l['passed'], 'lead_alternative': l['alt'], 'lead_withdrawn': l['withdrawn'],
            'lead_rejected': l['rejected'], 'lead_pending': l['pending'], 'co_lead_count': l['co'],
            'weighted_score': (l['passed'] + 0.5 * l['alt']) / tenure if tenure > 0 else 0,
            'vote_eligible': v[0], 'vote_participated': v[1], 'vote_excluded': v[2], 'participation_rate': ratio(v[1], v[0]),
            'attendance_meetings': p[0], 'attendance_present': p[1], 'absent_count': p[2], 'leave_count': p[3],
            'travel_count': p[4], 'attendance_rate': ratio(p[1], p[0]),
        }
        if c:
            row.update({'committee_months_covered': len(months[i]), 'committee_meetings_total': c[0], 'committee_present': c[1],
                        'committee_absent': c[2], 'committee_leave': c[3], 'committee_travel': c[4],
                        'committee_attendance_rate': ratio(c[1], c[0])})
        else:
            row.update({k: None for k in ('committee_months_covered', 'committee_meetings_total', 'committee_present',
                                          'committee_absent', 'committee_leave', 'committee_travel', 'committee_attendance_rate')})
        out.append(row)
    return out


# ---------- state-office periods ----------

def role_adjustments(S, recs):
    """Records dated inside a 국회의장·국무총리·국무위원 period, removed from
    numerator and denominator alike (see docs/role-adjustment.md)."""
    rec = {r['id']: r for r in recs}
    plen_daily = collections.defaultdict(dict)
    for f in S.plenary:
        for i, r in f['rows'].items():
            for d, s in zip(f['dates'], r['status']):
                plen_daily[i][d] = s
    cmt_daily = collections.defaultdict(list)
    for r in S.committee:
        cmt_daily[r['id']] += [(d, s) for d, s in r['daily']]

    result = {}
    for mid in sorted({r['member_id'] for r in S.roles if r['kind'] == 'exclude'}):
        m = S.by_id.get(mid)
        if not m:
            continue
        per = [(r['start'], r['end'] or S.cutoff) for r in S.roles if r['member_id'] == mid and r['kind'] == 'exclude']
        inside = lambda d: any(s <= d <= e for s, e in per)
        v_ex = v_part = 0
        for v in S.votes:
            if v['status'] not in SCORED_VOTE or not in_term(m, v['date']) or not inside(v['date']):
                continue
            v_ex += 1
            v_part += mid in v['Y'] or mid in v['N'] or mid in v['A']
        pl = collections.Counter(s for d, s in plen_daily[mid].items() if inside(d) and s in STATUSES)
        cm = collections.Counter(s for d, s in cmt_daily[mid] if d and inside(d))
        role_days = sum(days(max(s, m['term_start']), min(e, m['term_end'] or S.cutoff)) for s, e in per if s <= S.cutoff)
        result[mid] = {
            'name': m['name'],
            'periods': [{'start': s, 'end': e} for s, e in per],
            'role_days': role_days,
            'votes': {'eligible': v_ex, 'participated': v_part, 'api_gap_rows_total': 0},
            'plenary': {'meetings': sum(pl.values()), 'present': pl['출석'], 'absent': pl['결석'],
                        'leave': pl['청가'], 'travel': pl['출장'], 'reported_absence': pl['결석신고서']},
            'committee': {'meetings': sum(cm.values()), 'present': cm['출석'], 'absent': cm['결석'],
                          'leave': cm['청가'], 'travel': cm['출장'], 'reported_absence': cm['결석신고서']},
        }
    return {'generated_from': {'roles': 'member-roles.json', 'source': 'data/source', 'eval_end': S.cutoff}, 'members': result}


# ---------- bill lists, policy areas, collaboration ----------

def bill_lists_and_coop(S, recs):
    members = S.by_id
    # party at proposal: the party printed in the plenary roster of the latest
    # session that started on or before the proposal date
    rost = sorted((f['dates'][0], {i: r['party'] for i, r in f['rows'].items()}) for f in S.plenary)

    def party(mid, date):
        chosen = None
        for start, r in rost:
            if mid in r and (start <= date or chosen is None):
                chosen = r[mid]
            if start > date and chosen is not None:
                break
        return chosen

    cutoff = S.cutoff
    areas = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
    coop = collections.defaultdict(lambda: {'cross': 0, 'base': 0, 'bills': 0})
    partners = collections.defaultdict(collections.Counter)
    by = collections.defaultdict(list)
    unresolved = collections.Counter()
    for b in S.bills:
        leads_all = ids(b['RST_MONA_CD'])
        leads = [x for x in leads_all if x in members]
        cos = ids(b['PUBL_MONA_CD'])
        st, label = bill_status(b, cutoff)
        reflected = st in ('passed', 'alt')
        d = b['PROPOSE_DT']
        item = {
            'no': b['BILL_NO'], 'name': b['BILL_NAME'], 'proposed': d,
            'status': st, 'result': label, 'decided': b['PROC_DT'] if label else None,
            'committee': b.get('COMMITTEE'), 'co': len(leads_all) > 1,
            'url': f"https://likms.assembly.go.kr/bill/billDetail.do?billId={b['BILL_ID']}",
            'area': area_of(b.get('COMMITTEE')),
        }
        for lead in leads:
            by[lead].append(item)
            a = areas[lead][item['area']]
            a[0] += 1
            a[1] += reflected
            coop[lead]['bills'] += 1
            lp = party(lead, d)
            for c in cos + [x for x in leads if x != lead]:
                partners[lead][c] += 1
                if not lp or lp == INDEPENDENT:
                    continue
                cp = party(c, d)
                if cp is None:
                    unresolved[c] += 1
                    continue
                if cp == INDEPENDENT:
                    continue
                coop[lead]['base'] += 1
                coop[lead]['cross'] += cp != lp

    for mid in members:
        c = coop[mid]
        c['index'] = c['cross'] / c['base'] if c['base'] else 0.0
        c['eligible'] = c['bills'] >= MIN_BILLS and c['base'] > 0
    by_party = collections.defaultdict(list)
    for mid, m in members.items():
        if coop[mid]['eligible'] and m['party'] != INDEPENDENT:
            by_party[m['party']].append(coop[mid]['index'])
    medians = {p: sorted(v)[len(v) // 2] for p, v in by_party.items() if len(v) >= MIN_PARTY}
    for mid, m in members.items():
        c = coop[mid]
        c['party_median'] = medians.get(m['party'])
        c['excess'] = max(0.0, c['index'] - c['party_median']) if c['eligible'] and c['party_median'] is not None else 0.0
    pos = sorted(coop[mid]['excess'] for mid in members if coop[mid]['excess'] > 0)
    p90 = pos[int(0.9 * (len(pos) - 1))] if pos else 0
    for mid in members:
        c = coop[mid]
        c['bonus'] = round(MAX_BONUS * min(1.0, c['excess'] / p90), 3) if p90 and c['excess'] > 0 else 0.0

    area_counts = collections.defaultdict(list)
    for mid in members:
        for ar, (n, _) in areas[mid].items():
            area_counts[ar].append(n)

    rec = {r['id']: r for r in recs}
    out_dir = APP / 'public' / 'bills'
    os.makedirs(out_dir, exist_ok=True)
    bad = []
    for mid, m in members.items():
        items = sorted(by.get(mid, []), key=lambda x: (x['decided'] or x['proposed'], x['no']), reverse=True)
        cnt = collections.Counter(i['status'] for i in items)
        r = rec[mid]
        got = (len(items), cnt['passed'], cnt['alt'], cnt['withdrawn'], cnt['rejected'], cnt['pending'])
        exp = (r['lead_count'], r['lead_passed'], r['lead_alternative'], r['lead_withdrawn'], r['lead_rejected'], r['lead_pending'])
        if got != exp:
            bad.append((m['name'], got, exp))
        top = []
        for pid, n in sorted(partners[mid].items(), key=lambda kv: (-kv[1], kv[0])):
            if pid not in members:
                continue
            same = party(pid, cutoff) == m['party']
            top.append({'id': pid, 'name': members[pid]['name'], 'party': members[pid]['party'], 'bills': n, 'same_party': same})
        c = coop[mid]
        data = {
            'cutoff': cutoff,
            'bills': items,
            'areas': [{'area': k, 'bills': n, 'reflected': rr, 'rank': 1 + sum(1 for x in area_counts[k] if x > n)}
                      for k, (n, rr) in sorted(areas[mid].items(), key=lambda kv: (-kv[1][0], kv[0]))],
            'partners': {'same': [p for p in top if p['same_party']][:5], 'other': [p for p in top if not p['same_party']][:5]},
            'coop': {k: c[k] for k in ('cross', 'base', 'bills', 'index', 'eligible', 'party_median', 'excess', 'bonus')},
        }
        with open(out_dir / f'{mid}.json', 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    if bad:
        raise SystemExit(f'bill list does not add up to the records: {bad[:5]}')
    stale = {p.stem for p in out_dir.glob('*.json')} - set(members)
    for s in stale:
        os.remove(out_dir / f'{s}.json')

    coop_out = {'rules': {'max_bonus': MAX_BONUS, 'min_bills': MIN_BILLS, 'min_party': MIN_PARTY, 'p90_excess': p90,
                          'party_medians': medians, 'cutoff': cutoff},
                'members': {mid: coop[mid] for mid in members}}
    print(f'coop: p90 excess {p90:.3f}; bonus > 0: {sum(1 for mid in members if coop[mid]["bonus"] > 0)}; '
          f'full: {sum(1 for mid in members if coop[mid]["bonus"] >= MAX_BONUS)}; unresolved co-sponsor refs: {sum(unresolved.values())}')
    return coop_out


def main():
    S = Sources()
    recs = records(S)
    cov = S.coverage()
    tmp = APP / 'data' / 'build'
    os.makedirs(tmp, exist_ok=True)

    with open(APP / 'lib' / 'member-records.js', 'w', encoding='utf-8') as f:
        f.write('// Generated by pipeline/build.py from data/source — do not edit by hand.\n')
        f.write('export default ' + json.dumps(recs, ensure_ascii=False, separators=(',', ':')) + ';\n')
    write_json(tmp / 'records.json', {'members': recs})
    write_json(APP / 'data' / 'role-adjustments.json', role_adjustments(S, recs), indent=2)
    write_json(APP / 'data' / 'coop.json', bill_lists_and_coop(S, recs))
    write_json(tmp / 'run-meta.json', {'data_as_of': S.meta['data_as_of'], 'coverage': cov})

    d = APP / 'data'
    subprocess.run(['node', str(APP / 'scripts' / 'compute-scores-stage3.cjs'), str(tmp / 'records.json'),
                    str(d / 'member-roles.json'), str(d / 'role-adjustments.json'), str(d / 'data-corrections.json'),
                    str(d / 'coop.json'), str(tmp / 'run-meta.json'), str(APP / 'lib' / 'score-run.js')], check=True)
    print('coverage', cov, 'members', len(recs))


if __name__ == '__main__':
    sys.exit(main())
