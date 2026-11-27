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
import collections, datetime as dt, json, os, re, subprocess, sys

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


_SUMS = None


def bill_sums():
    """bill number -> three plain lines (data/source/bill-summary.jsonl, written by billsum.py)"""
    global _SUMS
    if _SUMS is None:
        path = APP / 'data' / 'source' / 'bill-summary.jsonl'
        _SUMS = {}
        if path.exists():
            for line in open(path, encoding='utf-8'):
                r = json.loads(line)
                if r.get('s'):
                    _SUMS[r['no']] = r['s']
    return _SUMS


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


# ---------- monthly trend ----------

_TREND = None


def monthly_trend(S):
    """Per member and month: plenary attendance, recorded-vote participation and
    lead bills, plus the month's average over members in office. Shown as a
    plain line chart on the member page; no interpretation is attached."""
    end = S.cutoff[:7]
    months, y, mo = [], 2024, 6
    while f'{y}-{mo:02d}' <= end:
        months.append(f'{y}-{mo:02d}')
        y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
    att = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
    for f in S.plenary:
        for i, r in f['rows'].items():
            for d, st in zip(f['dates'], r['status']):
                if st in STATUSES and d <= S.cutoff:
                    a = att[i][d[:7]]
                    a[0] += st == '출석'
                    a[1] += 1
    vote = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
    for v in S.votes:
        if v['status'] not in SCORED_VOTE or v['date'] > S.cutoff:
            continue
        cast = set(v['Y']) | set(v['N']) | set(v['A'])
        for m in S.members:
            if in_term(m, v['date']):
                a = vote[m['id']][v['date'][:7]]
                a[0] += m['id'] in cast
                a[1] += 1
    bills = collections.defaultdict(collections.Counter)
    for b in S.bills:
        if b['PROPOSE_DT'] <= S.cutoff:
            for lead in ids(b['RST_MONA_CD']):
                bills[lead][b['PROPOSE_DT'][:7]] += 1
    rate = lambda a: round(a[0] / a[1], 4) if a and a[1] else None
    out = {}
    for m in S.members:
        i = m['id']
        on = [m['term_start'][:7] <= mo <= (m['term_end'] or '9999')[:7] for mo in months]
        out[i] = {
            'att': [rate(att[i].get(mo)) if ok else None for mo, ok in zip(months, on)],
            'vote': [rate(vote[i].get(mo)) if ok else None for mo, ok in zip(months, on)],
            'bills': [bills[i].get(mo, 0) if ok else None for mo, ok in zip(months, on)],
        }
    def avg(key):
        res = []
        for k in range(len(months)):
            xs = [out[i][key][k] for i in out if out[i][key][k] is not None]
            res.append(round(sum(xs) / len(xs), 4) if xs else None)
        return res
    global _TREND
    _TREND = {'months': months, 'members': out, 'avg': {k: avg(k) for k in ('att', 'vote', 'bills')}}
    return _TREND


# ---------- bill lists, policy areas, collaboration ----------

def bill_lists_and_coop(S, recs, vote_strings):
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
        if b['BILL_NO'] in bill_sums():
            item['sum'] = bill_sums()[b['BILL_NO']]
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
    trend = monthly_trend(S)
    tp = APP / 'data' / 'source' / 'audit-topics.json'
    audit_topics = json.load(open(tp, encoding='utf-8')) if tp.exists() else {}
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
            'votes': vote_strings.get(mid, ''),
            'trend': {'months': trend['months'], **trend['members'].get(mid, {}), 'avg': trend['avg']},
        }
        if mid in audit_topics:
            data['audit_topics'] = audit_topics[mid]['topics']
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


# ---------- plenary vote pages ----------

def vote_area(committee):
    if committee == '예산결산특별위원회':
        return '예산·결산'
    if committee == '본회의':
        return '본회의 직접 상정'
    return area_of(committee)


def vote_pages(S):
    """public/vote-data/index.json (every vote, newest first), public/vote-data/<BILL_ID>.json
    (every seat: member, party on the day, choice) and, per member, one character
    per vote in index order: Y yes, N no, A abstain, X absent, . not in office.
    y/n/a (lower case) mark a vote that differs from the choice most members of
    the member's own party made that day (parties of 3 or more voters; not
    independents). `clash` marks votes where the two largest parties' majority
    choices differ."""
    names = {m['id']: m['name'] for m in S.members}
    names.update({k: v for k, v in S.former.items() if k not in names})
    votes = sorted(S.votes, key=lambda v: (v['date'], v['bill_no']), reverse=True)
    out_dir = APP / 'public' / 'vote-data'
    os.makedirs(out_dir, exist_ok=True)
    index, strings = [], {m['id']: [] for m in S.members}
    for v in votes:
        choice = {i: k for k in 'YNAX' for i in v[k]}
        party = {i: p for p, members in v['party'].items() for i in members}
        counts = [len(v[k]) for k in 'YNAX']
        majority = {}
        for p, ids_ in v['party'].items():
            c = collections.Counter(choice[i] for i in ids_ if choice[i] != 'X')
            top = c.most_common(2)
            if p and p != INDEPENDENT and sum(c.values()) >= 3 and (len(top) == 1 or top[0][1] > top[1][1]):
                majority[p] = top[0][0]
        big = sorted(v['party'], key=lambda p: -len(v['party'][p]))[:2]
        clash = len(big) == 2 and all(p in majority for p in big) and majority[big[0]] != majority[big[1]]
        # notable votes get their own link-preview image (pipeline/og.py)
        notable = clash or counts[1] + counts[2] >= 20 or '부결' in (v['result'] or '')
        index.append({'id': v['bill_id'], 'no': v['bill_no'], 'name': v['bill_name'], 'date': v['date'],
                      'result': v['result'], 'kind': v.get('kind'), 'area': vote_area(v.get('committee')),
                      'counts': counts, 'clash': clash, 'og': notable, 'held': v['status'] not in SCORED_VOTE})
        seats = [[i, names.get(i, i), party.get(i, ''), c] for i, c in choice.items()]
        seats.sort(key=lambda x: (x[2], 'YNAX'.index(x[3]), x[1]))
        page = {'id': v['bill_id'], 'no': v['bill_no'], 'name': v['bill_name'], 'date': v['date'], 'result': v['result'],
                'kind': v.get('kind'), 'committee': v.get('committee'), 'og': notable,
                'held': v['status'] not in SCORED_VOTE, 'totals': v['totals'], 'counts': counts,
                'url': f"https://likms.assembly.go.kr/bill/billDetail.do?billId={v['bill_id']}", 'seats': seats}
        with open(out_dir / f"{v['bill_id']}.json", 'w', encoding='utf-8') as f:
            json.dump(page, f, ensure_ascii=False, separators=(',', ':'))
        for mid, acc in strings.items():
            c = choice.get(mid, '.')
            m = majority.get(party.get(mid))
            acc.append(c.lower() if c in 'YNA' and m and c != m else c)
    with open(out_dir / 'index.json', 'w', encoding='utf-8') as f:
        json.dump({'votes': index}, f, ensure_ascii=False, separators=(',', ':'))
    keep = {v['bill_id'] for v in votes} | {'index', 'dissent'}
    for p in out_dir.glob('*.json'):
        if p.stem not in keep:
            os.remove(p)
    # per member: [votes cast (yes/no/abstain), of which differing from own party]
    dissent = {mid: [sum(c in 'YNAyna' for c in acc), sum(c in 'yna' for c in acc)] for mid, acc in strings.items()}
    with open(out_dir / 'dissent.json', 'w', encoding='utf-8') as f:
        json.dump(dissent, f, separators=(',', ':'))
    return {mid: ''.join(acc) for mid, acc in strings.items()}, index


# ---------- parties ----------

def party_data(S):
    """public/party-data.json: what the party page shows beyond member averages.

    Per party (current members, current party): lead bills and how many became
    law, policy areas of those bills, monthly averages, vote cohesion (share of
    the party's cast votes that matched its majority that day) and how often each
    pair of parties' majorities chose the same on recorded votes."""
    party_now = {m['id']: m['party'] for m in S.members}
    groups = collections.defaultdict(list)
    for m in S.members:
        groups[m['party'] or INDEPENDENT].append(m['id'])
    # bills
    bills = collections.defaultdict(lambda: {'lead': 0, 'passed': 0, 'alt': 0, 'areas': collections.Counter()})
    for b in S.bills:
        st, _ = bill_status(b, S.cutoff)
        for p in {party_now[i] for i in ids(b['RST_MONA_CD']) if i in party_now}:
            x = bills[p]
            x['lead'] += 1
            x['passed'] += st == 'passed'
            x['alt'] += st == 'alt'
            x['areas'][area_of(b.get('COMMITTEE'))] += 1
    # votes: cohesion and pairwise agreement of majorities (party on the day)
    coh = collections.defaultdict(lambda: [0, 0])
    pair = collections.defaultdict(lambda: [0, 0])
    split = collections.defaultdict(lambda: [0, 0])  # only votes where the majorities did not all agree
    for v in S.votes:
        if v['status'] not in SCORED_VOTE:
            continue
        choice = {i: k for k in 'YNA' for i in v[k]}
        maj = {}
        for p, ids_ in v['party'].items():
            c = collections.Counter(choice[i] for i in ids_ if i in choice)
            if not p or p == INDEPENDENT or sum(c.values()) < 3:
                continue
            top = c.most_common(2)
            coh[p][0] += top[0][1]
            coh[p][1] += sum(c.values())
            if len(top) == 1 or top[0][1] > top[1][1]:
                maj[p] = top[0][0]
        ps = sorted(maj)
        for a_ in range(len(ps)):
            for b_ in range(a_ + 1, len(ps)):
                for acc in ((pair,) if len(set(maj.values())) == 1 else (pair, split)):
                    x = acc[(ps[a_], ps[b_])]
                    x[0] += maj[ps[a_]] == maj[ps[b_]]
                    x[1] += 1
    trend = _TREND or monthly_trend(S)
    def series(ids_, key, total=False):
        out = []
        for k in range(len(trend['months'])):
            xs = [trend['members'][i][key][k] for i in ids_ if i in trend['members'] and trend['members'][i][key][k] is not None]
            out.append(None if not xs else round(sum(xs) if total else sum(xs) / len(xs), 4))
        return out
    order = sorted(groups, key=lambda p: -len(groups[p]))
    parties = []
    for p in order:
        b = bills.get(p, {'lead': 0, 'passed': 0, 'alt': 0, 'areas': collections.Counter()})
        tot = sum(b['areas'].values()) or 1
        parties.append({
            'party': p, 'seats': len(groups[p]),
            'bills': {'lead': b['lead'], 'passed': b['passed'], 'alt': b['alt'],
                      'areas': [[a, n, round(n / tot, 4)] for a, n in b['areas'].most_common(6)]},
            'cohesion': round(coh[p][0] / coh[p][1], 4) if coh[p][1] else None,
            'votes_counted': coh[p][1],
            'trend': {'att': series(groups[p], 'att'), 'vote': series(groups[p], 'vote'), 'bills': series(groups[p], 'bills')},
        })
    named = [x['party'] for x in parties if x['party'] != INDEPENDENT and x['cohesion'] is not None]
    def rows(acc):
        out = []
        for i, a in enumerate(named):
            for b in named[i + 1:]:
                x = acc[tuple(sorted((a, b)))]
                if x[1] >= 20:
                    out.append([a, b, round(x[0] / x[1], 4), x[1]])
        return out
    agree, agree_split = rows(pair), rows(split)
    with open(APP / 'public' / 'party-data.json', 'w', encoding='utf-8') as f:
        json.dump({'as_of': S.meta['data_as_of'], 'months': trend['months'], 'parties': parties, 'agree': agree, 'agree_split': agree_split},
                  f, ensure_ascii=False, separators=(',', ':'))


# ---------- what changed since the previous update ----------

def load_module(path):
    text = open(path, encoding='utf-8').read()
    return json.loads(text[text.index('export default ') + len('export default '):text.rstrip().rindex(';')])


def weekly(S, cov, vote_index):
    """public/weekly.json: votes, bills and grade changes over the last week.
    The data is checked every morning and rebuilt whenever a new record comes
    out, so data/weekly-state.json keeps one snapshot (ranks and coverage) per
    data date; the comparison base is the latest snapshot at least seven days
    older than this one (the oldest one while there is no week of history)."""
    run = load_module(APP / 'lib' / 'score-run.js')
    as_of = S.meta['data_as_of']
    snap = {i: [s['rank'], s['grade']] for i, s in run['scores'].items()}
    cur = {'as_of': as_of, 'coverage': cov, 'ranks': snap}
    path = APP / 'data' / 'weekly-state.json'
    state = json.load(open(path, encoding='utf-8')) if path.exists() else {}
    snaps = state.get('snaps') or [x for x in (state.get('base'), state.get('current')) if x]
    snaps = [x for x in snaps if x['as_of'] < as_of]
    week_ago = (dt.date.fromisoformat(as_of) - dt.timedelta(days=7)).isoformat()
    older = [x for x in snaps if x['as_of'] <= week_ago]
    base = older[-1] if older else (snaps[0] if snaps else cur)
    snaps = [x for x in snaps if x['as_of'] >= base['as_of']] + [cur]
    write_json(path, {'snaps': snaps}, indent=None)

    # rank/grade history, one entry per data date (kept for trend charts)
    hpath = APP / 'data' / 'rank-history.json'
    hist = json.load(open(hpath, encoding='utf-8')) if hpath.exists() else {'dates': [], 'ranks': {}}
    for snap_ in ([base] if base['as_of'] not in hist['dates'] and base is not cur else []) + [cur]:
        d = snap_['as_of']
        if d in hist['dates']:
            k = hist['dates'].index(d)
        else:
            hist['dates'].append(d)
            k = len(hist['dates']) - 1
        for i, (rank, grade) in snap_['ranks'].items():
            row = hist['ranks'].setdefault(i, [])
            row.extend([None] * (k + 1 - len(row)))
            row[k] = [rank, grade]
    order = sorted(range(len(hist['dates'])), key=lambda k: hist['dates'][k])
    hist = {'dates': [hist['dates'][k] for k in order],
            'ranks': {i: [(row[k] if k < len(row) else None) for k in order] for i, row in hist['ranks'].items()}}
    write_json(hpath, hist, indent=None)

    bc = base['coverage']
    in_votes = lambda d: bc['votes_until'] < d <= cov['votes_until']
    in_bills = lambda d: bool(d) and bc['bills_until'] < d <= cov['bills_until']
    votes = [v for v in vote_index if in_votes(v['date'])]
    contested = lambda v: v['counts'][1] + v['counts'][2]
    highlights = sorted([v for v in votes if v['clash'] or contested(v) >= 20 or '부결' in (v['result'] or '')],
                        key=lambda v: (-v['clash'], -contested(v)))[:6]

    members = S.by_id
    proposed = [b for b in S.bills if in_bills(b['PROPOSE_DT'])]
    decided = []
    for b in S.bills:
        st, label = bill_status(b, S.cutoff)
        if st in ('passed', 'alt') and in_bills(b['PROC_DT']):
            leads = [{'id': i, 'name': members[i]['name'], 'party': members[i]['party']} for i in ids(b['RST_MONA_CD']) if i in members]
            decided.append({'name': b['BILL_NAME'], 'date': b['PROC_DT'], 'status': st, 'result': label, 'leads': leads,
                            'url': f"https://likms.assembly.go.kr/bill/billDetail.do?billId={b['BILL_ID']}"})
    decided.sort(key=lambda x: (x['date'], x['status'] == 'passed'), reverse=True)

    up, down = [], []
    order = 'SABCD'
    for i, (rank, grade) in snap.items():
        if i not in base['ranks'] or i not in members:
            continue
        r0, g0 = base['ranks'][i]
        if g0 == grade or not g0 or not grade:
            continue
        item = {'id': i, 'name': members[i]['name'], 'party': members[i]['party'], 'from': g0, 'to': grade, 'rank_from': r0, 'rank_to': rank}
        (up if order.index(grade) < order.index(g0) else down).append(item)
    up.sort(key=lambda x: x['rank_to'])
    down.sort(key=lambda x: x['rank_to'])

    out = {
        'since': base['as_of'], 'as_of': as_of,
        'windows': {'votes': [bc['votes_until'], cov['votes_until']], 'bills': [bc['bills_until'], cov['bills_until']]},
        'votes': {'total': len(votes), 'clash': sum(v['clash'] for v in votes), 'contested': sum(contested(v) >= 20 for v in votes),
                  'unanimous': sum(contested(v) == 0 for v in votes), 'rejected': sum('부결' in (v['result'] or '') for v in votes),
                  'dates': sorted({v['date'] for v in votes}),
                  'highlights': [{k: v[k] for k in ('id', 'name', 'date', 'result', 'counts', 'clash')} for v in highlights]},
        'bills': {'proposed': len(proposed), 'passed': sum(x['status'] == 'passed' for x in decided),
                  'alt': sum(x['status'] == 'alt' for x in decided), 'highlights': [x for x in decided if x['status'] == 'passed'][:6]},
        'grades': {'up': up, 'down': down},
    }
    with open(APP / 'public' / 'weekly.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))


# ---------- political-leaning quiz ----------

def member_positions(S, vote_index):
    """One left-right score per member from all party-clash votes: the first
    principal component of the member x vote matrix (yes +1, no -1, abstain
    -0.5, absent/not in office left out), oriented so 국민의힘 is positive and
    scaled to -1..1. Pure Python power iteration, no extra dependency."""
    clash = [v['id'] for v in vote_index if v['clash']]
    by_id = {v['bill_id']: v for v in S.votes}
    val = {'Y': 1.0, 'N': -1.0, 'A': -0.5}
    mids = [m['id'] for m in S.members]
    rows = {i: {} for i in mids}
    for j, vid in enumerate(clash):
        v = by_id[vid]
        for k in 'YNA':
            for i in v[k]:
                if i in rows:
                    rows[i][j] = val[k]
    # centre each vote on the members present
    for j in range(len(clash)):
        xs = [r[j] for r in rows.values() if j in r]
        mu = sum(xs) / len(xs) if xs else 0
        for r in rows.values():
            if j in r:
                r[j] -= mu
    keep = [i for i in mids if len(rows[i]) >= 20]
    w = [1.0] * len(clash)
    for _ in range(200):
        sc = {i: sum(x * w[j] for j, x in rows[i].items()) / len(rows[i]) for i in keep}
        w = [sum(sc[i] * rows[i].get(j, 0) for i in keep) for j in range(len(clash))]
        n = sum(x * x for x in w) ** 0.5 or 1
        w = [x / n for x in w]
    sc = {i: sum(x * w[j] for j, x in rows[i].items()) / len(rows[i]) for i in keep}
    party = {m['id']: m['party'] for m in S.members}
    mean = lambda p: (lambda xs: sum(xs) / len(xs) if xs else 0)([sc[i] for i in keep if party[i] == p])
    sign = 1 if mean('국민의힘') >= mean('더불어민주당') else -1
    sc = {i: sign * x for i, x in sc.items()}
    lo, hi = min(sc.values()), max(sc.values())
    return {i: round(2 * (x - lo) / ((hi - lo) or 1) - 1, 3) for i, x in sc.items()}


def quiz_data(S, vote_index, scores):
    qfile = APP / 'data' / 'quiz.json'
    if not qfile.exists():
        return
    questions = json.load(open(qfile, encoding='utf-8'))['questions']
    by_id = {v['bill_id']: v for v in S.votes}
    idx = {v['id']: v for v in vote_index}
    pos = member_positions(S, vote_index)
    out_q, answers = [], {m['id']: [] for m in S.members}
    party_maj = collections.defaultdict(list)
    for q in questions:
        v, x = by_id[q['vote']], idx[q['vote']]
        choice = {i: k for k in 'YNAX' for i in v[k]}
        if q.get('flip'):  # question asks the opposite of the bill: agreeing = voting no
            choice = {i: {'Y': 'N', 'N': 'Y'}.get(k, k) for i, k in choice.items()}
        for mid, acc in answers.items():
            acc.append(choice.get(mid, '.'))
        out_q.append({**{k: q[k] for k in ('topic', 'title', 'law', 'summary', 'pro', 'con')},
                      'flip': bool(q.get('flip')), 'vote': q['vote'], 'date': x['date'], 'result': x['result'], 'counts': x['counts']})
        for p, ids_ in v['party'].items():
            c = collections.Counter(choice[i] for i in ids_ if choice[i] in 'YN')
            party_maj[p].append(('Y' if c['Y'] > c['N'] else 'N' if c['N'] > c['Y'] else '.') if sum(c.values()) >= 3 else '.')
    members = {}
    for m in S.members:
        s = scores.get(m['id'], {})
        members[m['id']] = [m['name'], m['party'], s.get('grade'), pos.get(m['id'])]
    counts = collections.Counter(m['party'] for m in S.members)
    parties = {}
    for p, n in counts.items():
        ps = [pos[m['id']] for m in S.members if m['party'] == p and m['id'] in pos]
        if n >= 3 and ps and p != INDEPENDENT:
            parties[p] = {'pos': round(sum(ps) / len(ps), 3), 'n': n, 'majority': ''.join(party_maj.get(p, [])) or '.' * len(out_q)}
    with open(APP / 'public' / 'quiz-data.json', 'w', encoding='utf-8') as f:
        json.dump({'questions': out_q, 'members': members, 'answers': {k: ''.join(v) for k, v in answers.items()},
                   'parties': parties, 'as_of': S.meta['data_as_of']}, f, ensure_ascii=False, separators=(',', ':'))


# ---------- law finder ----------

TOPICS = [
    ('housing', '전세·주거', ['주택임대차', '전세사기', '주택도시기금', '공공주택', '임대주택', '주거기본', '민간임대', '부동산']),
    ('medical', '의료·건강', ['의료법', '응급의료', '의료인', '지역의사', '공공의료', '국민건강보험', '의과대학', '필수의료', '감염병']),
    ('labor', '일자리·노동', ['근로기준법', '노동조합', '최저임금', '산업안전보건', '고용보험', '중대재해', '파견근로', '임금채권']),
    ('family', '저출생·육아', ['저출산', '저출생', '아동수당', '육아', '모자보건', '영유아보육', '남녀고용평등', '출산', '아이돌봄']),
    ('digital', 'AI·디지털', ['인공지능', '정보통신망', '개인정보', '플랫폼', '전자상거래', '데이터', '전기통신']),
    ('tax', '세금', ['소득세법', '법인세법', '조세특례제한법', '상속세', '부가가치세', '종합부동산세', '지방세']),
    ('pension', '연금·노후', ['국민연금', '기초연금', '노인복지', '퇴직연금', '장기요양']),
    ('youth', '청년', ['청년']),
    ('education', '교육', ['초·중등교육', '고등교육', '학교폭력', '교원', '유아교육', '사립학교', '교육기본법']),
    ('safety', '안전·재난', ['재난', '소방', '안전관리', '산업재해', '시설물']),
    ('traffic', '교통', ['도로교통법', '철도', '자동차관리법', '교통안전', '항공', '여객자동차']),
    ('climate', '환경·에너지', ['기후', '탄소', '대기환경', '자원순환', '재생에너지', '원자력', '전기사업']),
    ('animal', '반려동물', ['동물보호', '반려', '수의사']),
    ('crime', '범죄·처벌', ['형법', '성폭력', '스토킹', '마약', '전기통신금융사기', '아동학대']),
]
ST = {'passed': 'P', 'alt': 'A', 'withdrawn': 'W', 'rejected': 'R', 'pending': 'N'}


def popular(rows, n=10, per_lead=2):
    """Most co-sponsored bills, at most two per lead sponsor so one name does not fill the list."""
    out, seen = [], collections.Counter()
    for r in sorted(rows, key=lambda r: -r['co']):
        lead = r['leads'][0] if r['leads'] else ''
        if seen[lead] >= per_lead:
            continue
        seen[lead] += 1
        out.append(r)
        if len(out) == n:
            break
    return out


def law_data(S, vote_index):
    out = APP / 'public' / 'law-data'
    os.makedirs(out, exist_ok=True)
    names = {m['id']: m['name'] for m in S.members}
    voted = {v['id'] for v in vote_index}
    rows = []
    for b in sorted(S.bills, key=lambda b: (b['PROPOSE_DT'], b['BILL_NO']), reverse=True):
        st, label = bill_status(b, S.cutoff)
        leads = ids(b['RST_MONA_CD'])
        rows.append({'id': b['BILL_ID'], 'no': b['BILL_NO'], 'name': b['BILL_NAME'], 'proposed': b['PROPOSE_DT'],
                     'st': ST[st], 'result': label, 'decided': b['PROC_DT'] if label else None,
                     'area': area_of(b.get('COMMITTEE')), 'leads': leads,
                     'co': len(set(ids(b['PUBL_MONA_CD'])) - set(leads)), 'vote': b['BILL_ID'] in voted})

    def card(r):
        c = {**r, 'leads': [[i, names.get(i) or S.former.get(i) or ''] for i in r['leads']]}
        if r['no'] in bill_sums():
            c['sum'] = bill_sums()[r['no']]
        return c

    topics = []
    for key, label, words in TOPICS:
        hit = [r for r in rows if any(w in r['name'] for w in words)]
        passed = sorted([r for r in hit if r['st'] in 'PA'], key=lambda r: (r['decided'] or '', r['st'] == 'P'), reverse=True)[:12]
        topics.append({'key': key, 'label': label, 'words': words, 'total': len(hit),
                       'passed': sum(r['st'] == 'P' for r in hit), 'alt': sum(r['st'] == 'A' for r in hit),
                       'items': [card(r) for r in passed]})
    clash_laws = sorted([v for v in vote_index if v['clash'] and v['kind'] == '법률안'],
                        key=lambda v: -(v['counts'][1] + v['counts'][2]))[:8]
    home = {
        'as_of': S.meta['data_as_of'], 'cutoff': S.cutoff, 'total': len(rows),
        'counts': {k: sum(r['st'] == c for r in rows) for k, c in ST.items()},
        'topics': topics,
        'clash': [{k: v[k] for k in ('id', 'name', 'date', 'result', 'counts')} for v in clash_laws],
        'popular': [card(r) for r in popular(rows)],
        'recent': [card(r) for r in sorted([r for r in rows if r['st'] == 'P'], key=lambda r: r['decided'], reverse=True)[:10]],
    }
    with open(out / 'home.json', 'w', encoding='utf-8') as f:
        json.dump(home, f, ensure_ascii=False, separators=(',', ':'))
    # compact search index: people and areas are listed once and referred to by position
    # bill row: [BILL_ID, name, proposed, status, decided, area#, [lead#...], co-sponsors, has vote]
    people = sorted({i for r in rows for i in r['leads']})
    pidx = {i: k for k, i in enumerate(people)}
    areas_ = sorted({r['area'] for r in rows})
    aidx = {a: k for k, a in enumerate(areas_)}
    with open(out / 'all.json', 'w', encoding='utf-8') as f:
        json.dump({'people': [[i, names.get(i) or S.former.get(i) or ''] for i in people], 'areas': areas_,
                   'bills': [[r['id'], r['name'], r['proposed'], r['st'], r['decided'] or 0, aidx[r['area']],
                              [pidx[i] for i in r['leads']], r['co'], int(r['vote'])] for r in rows]},
                  f, ensure_ascii=False, separators=(',', ':'))


# ---------- national audit (국정감사) ----------

# committees renamed mid-term: compare under one name
COMMITTEE_ALIAS = {'기획재정위원회': '재정경제기획위원회', '환경노동위원회': '기후에너지환경노동위원회', '여성가족위원회': '성평등가족위원회'}



# ---------- opinion polls ----------

# upcoming national elections (YYYY-MM-DD). Party support is not shown from six days before one
# (election law art. 108). Keep this list current; dates past are ignored.
ELECTIONS = ['2028-04-12']


def poll_data(S):
    """public/poll-data.json from data/source/polls/gallup/*.json (pipeline/polls.py): presidential job
    approval and party support by week, and every policy question with its overall results."""
    d = APP / 'data' / 'source' / 'polls' / 'gallup'
    reports = [json.load(open(f, encoding='utf-8')) for f in sorted(d.glob('*.json'))] if d.exists() else []
    reports = [r for r in reports if r.get('period_end')]
    if not reports:  # still write the file, so the page and the publish step always find it
        with open(APP / 'public' / 'poll-data.json', 'w', encoding='utf-8') as f:
            json.dump({'latest': None, 'weeks': 0, 'blackout': False, 'president': [], 'party_names': [], 'parties': [], 'topics': []}, f)
        return
    reports.sort(key=lambda r: r['period_end'])
    today = dt.date.today()
    blackout = any(0 <= (dt.date.fromisoformat(e) - today).days <= 6 for e in ELECTIONS)
    pres = [[r['period_end'], r['president']['approve'], r['president']['disapprove'], r['president']['name']]
            for r in reports if r.get('president') and r['president'].get('approve') is not None]
    totals = collections.Counter()
    for r in reports[-26:]:
        for p in r.get('parties', []):
            totals[p['party']] += p['pct']
    names = [n for n, _ in totals.most_common() if n != '무당층'][:5] + (['무당층'] if '무당층' in totals else [])
    parties = [] if blackout else [[r['period_end'], {p['party']: p['pct'] for p in r.get('parties', []) if p['party'] in names}]
                                   for r in reports if r.get('parties')]
    topics = []
    for r in reports:
        for t in r.get('topics', []):
            if t.get('results'):
                topics.append({'date': r['period_end'], 'no': r.get('no'), 'url': r['url'], **{k: t[k] for k in ('title', 'question', 'category', 'results', 'summary')}})
    topics.sort(key=lambda t: t['date'], reverse=True)
    last = reports[-1]
    meta = {k: last.get(k) for k in ('source', 'sponsor', 'method', 'sample', 'margin', 'response_rate', 'period_start', 'period_end', 'no', 'url')}
    with open(APP / 'public' / 'poll-data.json', 'w', encoding='utf-8') as f:
        json.dump({'latest': meta, 'weeks': len(reports), 'blackout': blackout, 'president': pres, 'party_names': names,
                   'parties': parties, 'topics': topics}, f, ensure_ascii=False, separators=(',', ':'))

# ---------- pledges ----------

PLEDGE_ORDER = ['done', 'progress', 'delayed', 'notfound']


def pledge_data(S, scores):
    """public/pledge-data.json (every checked member: completion rate and status counts) and a
    'pledges' list in each member's public/bills/<id>.json, from data/source/pledges.json and
    pledge-status.json (pipeline/pledges.py, pledge_check.py). Completion rate = done / all."""
    src, st = APP / 'data' / 'source' / 'pledges.json', APP / 'data' / 'source' / 'pledge-status.json'
    if not (src.exists() and st.exists()):
        return
    pledges, status = json.load(open(src, encoding='utf-8')), json.load(open(st, encoding='utf-8'))
    members = {m['id']: m for m in S.members}
    rows = []
    for mid, v in status.items():
        m = members.get(mid)
        if not m or not v.get('items'):
            continue
        by_ord = {p['ord']: p for p in pledges.get(mid, {}).get('pledges', [])}
        c = {k: sum(i['status'] == k for i in v['items']) for k in PLEDGE_ORDER}
        n = len(v['items'])
        rows.append({'id': mid, 'name': m['name'], 'party': m['party'], 'district': m['district'], 'n': n,
                     'c': [c[k] for k in PLEDGE_ORDER], 'rate': round(c['done'] / n * 100) if n else 0,
                     'grade': (scores.get(mid) or {}).get('grade'), 'checked': v['checked']})
        detail = [{'t': i['title'], 'r': i.get('realm', ''), 's': i['status'], 'why': i['reason'] if i['status'] != 'notfound' else '',
                   'ev': [[e['date'], e['title'], e['link']] for e in i['evidence'][:2]] if i['status'] != 'notfound' else [],
                   'body': by_ord.get(i['ord'], {}).get('body', ''),
                   'src': [[x['date'], x['title'], x['link']] for x in by_ord.get(i['ord'], {}).get('sources', [])[:1]],
                   'ctx': [[x['date'], x['title'], x['answer'], x['link']] for x in i.get('context', [])[:3]]}
                  for i in sorted(v['items'], key=lambda i: (PLEDGE_ORDER.index(i['status']), i['ord']))]
        bf = APP / 'public' / 'bills' / f'{mid}.json'
        if bf.exists():
            d = json.load(open(bf, encoding='utf-8'))
            d['pledges'] = {'checked': v['checked'], 'items': detail}
            with open(bf, 'w', encoding='utf-8') as f:
                json.dump(d, f, ensure_ascii=False, separators=(',', ':'))
    rows.sort(key=lambda r: (-r['rate'], -(r['c'][1] / r['n'] if r['n'] else 0), r['name']))
    total = [sum(r['c'][k] for r in rows) for k in range(4)]
    avg = round(sum(r['rate'] for r in rows) / len(rows)) if rows else 0
    with open(APP / 'public' / 'pledge-data.json', 'w', encoding='utf-8') as f:
        json.dump({'checked': max((r['checked'] for r in rows), default=None), 'avg': avg, 'total': total, 'members': rows},
                  f, ensure_ascii=False, separators=(',', ':'))


def audit_data(S, scores):
    """public/audit.json: audit schedule per year and how much each member spoke.

    Built from data/source/audit_list.json and the per-meeting counts that
    audit.py extracts from the published minutes. A listed meeting is 'done'
    once its minutes are parsed, 'pending' when its date has passed but the
    minutes are not out yet, and 'upcoming' otherwise.
    """
    lst = APP / 'data' / 'source' / 'audit_list.json'
    if not lst.exists():
        return
    listing = json.load(open(lst, encoding='utf-8'))
    today = dt.date.today().isoformat()
    years = {}
    for r in listing:
        y = years.setdefault(r['date'][:4], {'sess': r['sess'], 'meetings': [], 'members': {}, 'committees': {}})
        path = APP / 'data' / 'source' / 'audit' / f"{r['id']}.json"
        m = json.load(open(path, encoding='utf-8')) if path.exists() else None
        y['meetings'].append({'id': r['id'], 'date': r['date'], 'committee': r['committee'], 'pdf': r['pdf'],
                              'status': 'done' if m else 'pending' if r['date'] <= today else 'upcoming',
                              'agencies': m['agencies'] if m else '', 'speakers': len(m['members']) if m else 0,
                              'sum': (APP / 'data' / 'source' / 'audit-summary' / f"{r['id']}.json").exists()})
        if not m:
            continue
        for mid, (turns, chars) in m['members'].items():
            t = y['members'].setdefault(mid, [0, 0, 0])
            t[0] += turns
            t[1] += chars
            t[2] += 1
            c = y['committees'].setdefault(r['committee'], {}).setdefault(mid, [0, 0, 0])
            c[0] += turns
            c[1] += chars
            c[2] += 1
    for y in years.values():
        ds = sorted(x['date'] for x in y['meetings'])
        y['start'], y['end'] = ds[0], ds[-1]
    ids = {mid for y in years.values() for mid in y['members']}
    names = {m['id']: m for m in S.members}
    people = {}
    for mid in ids:
        m = names.get(mid)
        people[mid] = [m['name'], m['party'], scores.get(mid, {}).get('grade')] if m else [S.former.get(mid, mid), None, None]
    with open(APP / 'public' / 'audit.json', 'w', encoding='utf-8') as f:
        json.dump({'as_of': today, 'years': years, 'people': people}, f, ensure_ascii=False, separators=(',', ':'))
    # one file per meeting for its own page: agencies, who spoke, the summary
    out = APP / 'public' / 'audit-data'
    os.makedirs(out, exist_ok=True)
    for y in years.values():
        for mt in y['meetings']:
            src = APP / 'data' / 'source' / 'audit' / f"{mt['id']}.json"
            sm = APP / 'data' / 'source' / 'audit-summary' / f"{mt['id']}.json"
            m = json.load(open(src, encoding='utf-8')) if src.exists() else {'members': {}}
            summary = json.load(open(sm, encoding='utf-8')) if sm.exists() else None
            speakers = sorted(([mid, t, c] for mid, (t, c) in m['members'].items()), key=lambda x: -x[2])
            ppl = {mid: people.get(mid) or [names[mid]['name'], names[mid]['party'], scores.get(mid, {}).get('grade')]
                   if mid in names else [S.former.get(mid, mid), None, None] for mid, *_ in speakers}
            with open(out / f"{mt['id']}.json", 'w', encoding='utf-8') as f:
                json.dump({**mt, 'sess': y['sess'], 'speakers': speakers, 'people': ppl, 
                           'summary': summary and {'overview': summary['overview'], 'members': summary['members']}},
                          f, ensure_ascii=False, separators=(',', ':'))


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
    vote_strings, vote_index = vote_pages(S)
    write_json(APP / 'data' / 'coop.json', bill_lists_and_coop(S, recs, vote_strings))
    write_json(tmp / 'run-meta.json', {'data_as_of': S.meta['data_as_of'], 'coverage': cov})

    d = APP / 'data'
    subprocess.run(['node', str(APP / 'scripts' / 'compute-scores-stage3.cjs'), str(tmp / 'records.json'),
                    str(d / 'member-roles.json'), str(d / 'role-adjustments.json'), str(d / 'data-corrections.json'),
                    str(d / 'coop.json'), str(tmp / 'run-meta.json'), str(APP / 'lib' / 'score-run.js')], check=True)
    weekly(S, cov, vote_index)
    quiz_data(S, vote_index, load_module(APP / 'lib' / 'score-run.js')['scores'])
    law_data(S, vote_index)
    party_data(S)
    audit_data(S, load_module(APP / 'lib' / 'score-run.js')['scores'])
    pledge_data(S, load_module(APP / 'lib' / 'score-run.js')['scores'])
    poll_data(S)
    import og
    og.build_all(recs, load_module(APP / 'lib' / 'score-run.js'), vote_index, APP / 'public' / 'vote-data', S.meta['data_as_of'])
    import stamp
    stamp.main()
    print('coverage', cov, 'members', len(recs))


if __name__ == '__main__':
    sys.exit(main())
