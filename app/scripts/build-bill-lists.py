#!/usr/bin/env python3
"""Write public/bills/<member_id>.json: every bill the member lead-proposed.

Input is the 의원 발의법률안 API (nzmimeepazxkubdpn) dumped as one JSON array.
The cut-off date is the same as the scored legislation data, so the list on
the member page always adds up to the counts in the score card.

usage: build-bill-lists.py <bills_all.json> <members.json> <out_dir> [cutoff=2026-09-30]
"""
import collections, json, os, sys

PASSED = {'원안가결', '수정가결'}
ALT = {'대안반영폐기', '수정안반영폐기'}


def status(r, cutoff):
    pr, dt = r.get('PROC_RESULT'), r.get('PROC_DT')
    if not pr or not dt or dt > cutoff:
        return 'pending', None
    if pr in PASSED:
        return 'passed', pr
    if pr in ALT:
        return 'alt', pr
    if pr == '철회':
        return 'withdrawn', pr
    return 'rejected', pr


def main():
    bills_file, members_file, out_dir = sys.argv[1:4]
    cutoff = sys.argv[4] if len(sys.argv) > 4 else '2026-09-30'
    bills = json.load(open(bills_file, encoding='utf-8'))
    members = {m['id']: m for m in json.load(open(members_file, encoding='utf-8'))['members']}
    by = collections.defaultdict(list)
    for r in bills:
        if r['PROPOSE_DT'] > cutoff:
            continue
        st, label = status(r, cutoff)
        item = {
            'no': r['BILL_NO'], 'name': r['BILL_NAME'], 'proposed': r['PROPOSE_DT'],
            'status': st, 'result': label, 'decided': r['PROC_DT'] if label else None,
            'committee': r.get('COMMITTEE'), 'co': len([x for x in (r.get('RST_MONA_CD') or '').split(',') if x.strip()]) > 1,
            'url': f"https://likms.assembly.go.kr/bill/billDetail.do?billId={r['BILL_ID']}",
        }
        for mid in (r.get('RST_MONA_CD') or '').split(','):
            mid = mid.strip()
            if mid in members:
                by[mid].append(item)
    os.makedirs(out_dir, exist_ok=True)
    bad = []
    for mid, m in members.items():
        items = sorted(by.get(mid, []), key=lambda x: (x['decided'] or x['proposed']), reverse=True)
        c = collections.Counter(i['status'] for i in items)
        got = (len(items), c['passed'], c['alt'], c['withdrawn'], c['rejected'], c['pending'])
        exp = (m['lead_count'], m['lead_passed'], m['lead_alternative'], m['lead_withdrawn'], m['lead_rejected'], m['lead_pending'])
        if got != exp:
            bad.append((m['name'], got, exp))
        json.dump({'cutoff': cutoff, 'bills': items}, open(os.path.join(out_dir, f'{mid}.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, separators=(',', ':'))
    if bad:
        print('count mismatch vs scored data:', bad[:5], file=sys.stderr)
        sys.exit(1)
    print(f'{len(members)} members, {sum(len(v) for v in by.values())} lead-bill entries, all counts match')


if __name__ == '__main__':
    main()
