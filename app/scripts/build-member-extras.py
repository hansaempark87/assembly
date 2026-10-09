#!/usr/bin/env python3
"""Policy areas and cross-party collaboration per member.

Writes
  app/data/coop.json            collaboration index + bonus per member (read by
                                compute-scores-stage3.cjs)
  app/public/bills/<id>.json    adds "areas" and "partners" to each bill list

Rules (published on /notes):
  * Area = the bill's committee of jurisdiction as recorded by the Assembly;
    renamed committees are merged (see AREA).
  * Party at proposal = the party printed for that member in the plenary
    attendance roster of the latest session that started on or before the
    proposal date (first roster if the bill predates it).
  * Collaboration index = co-sponsors from a different party / co-sponsors with
    a party, over the member's lead-proposed bills. Bills proposed while the
    lead was independent and independent co-sponsors are left out.
  * The raw index is strongly shaped by party size (a one-member party needs
    other parties to reach the 10-member threshold), so the bonus rewards how
    far a member exceeds the median of their own party instead:
      excess = index - median(index of same-party eligible members)
      bonus  = MAX_BONUS * min(1, excess / p90 of positive excess)
    Eligible: at least MIN_BILLS lead bills, in a party with at least
    MIN_PARTY eligible members (independents have no party to compare with).
    No one loses points.

usage: build-member-extras.py <bills_all.json> <members.json> <votes_dir> <att_dir> <app_dir> [cutoff]
"""
import collections, glob, json, os, re, sys

import openpyxl

MAX_BONUS = 3.0
MIN_BILLS = 5
MIN_PARTY = 3
INDEPENDENT = '무소속'

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


def rosters(att_dir):
    """[(session_start_date, {roster_name: party})] sorted by date."""
    out = []
    for f in glob.glob(os.path.join(att_dir, 'plenary-*.xlsx')):
        rs = list(openpyxl.load_workbook(f, read_only=True).worksheets[0].iter_rows(values_only=True))
        ds = sorted(re.sub(r'\D', '', h) for h in rs[3] if h and re.match(r'\(\d{4}년', str(h)))
        start = f'{ds[0][:4]}-{ds[0][4:6]}-{ds[0][6:8]}'
        out.append((start, {str(r[0]).strip(): (r[1] or '').strip() for r in rs[4:] if r[0] and r[0] != '의원명'}))
    return sorted(out)


def main():
    bills_file, members_file, votes_dir, att_dir, app_dir = sys.argv[1:6]
    cutoff = sys.argv[6] if len(sys.argv) > 6 else '2026-09-30'
    members = {m['id']: m for m in json.load(open(members_file, encoding='utf-8'))['members']}
    bills = [b for b in json.load(open(bills_file, encoding='utf-8')) if b['PROPOSE_DT'] <= cutoff]

    # member code -> roster name (the roster writes the June-2026 박지원 as 朴芝源)
    roster_name = {}
    for f in glob.glob(os.path.join(votes_dir, '*.json')):
        for r in json.load(open(f, encoding='utf-8'))['nojepdqqaweusdfbi'][1]['row']:
            roster_name[r['MONA_CD']] = r['HG_NM']
    for mid, m in members.items():
        roster_name.setdefault(mid, m['name'])
    homonyms = {n for n, c in collections.Counter(roster_name.values()).items() if c > 1}
    rost = rosters(att_dir)

    def party(mid, date):
        name = roster_name.get(mid)
        if not name:
            return None
        if name in homonyms and members.get(mid, {}).get('hanja_name'):
            # later homonym appears under the hanja name in rosters
            alt = members[mid]['hanja_name']
            if any(alt in r for _, r in rost):
                name = alt
        chosen = None
        for start, r in rost:
            if name in r and (start <= date or chosen is None):
                chosen = r[name]
            if start > date and chosen is not None:
                break
        return chosen

    areas = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0]))
    coop = collections.defaultdict(lambda: {'cross': 0, 'base': 0, 'bills': 0})
    partners = collections.defaultdict(collections.Counter)
    unresolved = collections.Counter()
    for b in bills:
        leads = [x.strip() for x in (b.get('RST_MONA_CD') or '').split(',') if x.strip() in members]
        cos = [x.strip() for x in (b.get('PUBL_MONA_CD') or '').split(',') if x.strip()]
        reflected = b.get('PROC_RESULT') in ('원안가결', '수정가결', '대안반영폐기', '수정안반영폐기') and (b.get('PROC_DT') or '9') <= cutoff
        d = b['PROPOSE_DT']
        for lead in leads:
            a = areas[lead][area_of(b.get('COMMITTEE'))]
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

    # index, own-party median, excess, bonus
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

    # rank of each member within each area (by lead-bill count) for the summary line
    area_counts = collections.defaultdict(list)
    for mid in members:
        for ar, (n, _) in areas[mid].items():
            area_counts[ar].append(n)

    out_dir = os.path.join(app_dir, 'public', 'bills')
    for mid, m in members.items():
        path = os.path.join(out_dir, f'{mid}.json')
        data = json.load(open(path, encoding='utf-8'))
        for item in data['bills']:
            item['area'] = area_of(item.get('committee'))
        ar = sorted(areas[mid].items(), key=lambda kv: -kv[1][0])
        data['areas'] = [
            {'area': k, 'bills': n, 'reflected': r,
             'rank': 1 + sum(1 for x in area_counts[k] if x > n)}
            for k, (n, r) in ar
        ]
        top = []
        for pid, n in partners[mid].most_common():
            if pid not in members:
                continue
            same = party(pid, cutoff) == m['party']
            top.append({'id': pid, 'name': members[pid]['name'], 'party': members[pid]['party'], 'bills': n, 'same_party': same})
        data['partners'] = {
            'same': [p for p in top if p['same_party']][:5],
            'other': [p for p in top if not p['same_party']][:5],
        }
        c = coop[mid]
        data['coop'] = {k: c[k] for k in ('cross', 'base', 'bills', 'index', 'eligible', 'party_median', 'excess', 'bonus')}
        json.dump(data, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

    json.dump({'rules': {'max_bonus': MAX_BONUS, 'min_bills': MIN_BILLS, 'min_party': MIN_PARTY, 'p90_excess': p90, 'party_medians': medians, 'cutoff': cutoff},
               'members': {mid: coop[mid] for mid in members}},
              open(os.path.join(app_dir, 'data', 'coop.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    got = sum(1 for mid in members if coop[mid]['bonus'] > 0)
    print(f'p90 excess {p90:.3f}; bonus > 0: {got}; full bonus: {sum(1 for mid in members if coop[mid]["bonus"] >= MAX_BONUS)}; '
          f'unresolved co-sponsor refs: {sum(unresolved.values())} ({len(unresolved)} ids)')


if __name__ == '__main__':
    main()
