#!/usr/bin/env python3
"""Count the records that fall inside each member's state-office period.

Members who concurrently serve as 국회의장 / 국무총리 / 국무위원 (kind=exclude in
data/member-roles.json) have every record dated inside that period removed
from BOTH numerator and denominator: votes, plenary days, committee meetings
and tenure days. Removal is symmetric, so it can neither raise nor lower a
member's rate by itself; it only stops the office period from being scored
as ordinary legislative work.

Inputs (all public, downloaded by the fetch steps documented in
docs/role-adjustment.md):
  --roles     app/data/member-roles.json
  --members   /api/members JSON (current D1 raw counts)
  --audit     docs/vote-audit-results-2026-10-01.csv (vote universe + dates)
  --votes     directory of nojepdqqaweusdfbi responses, one <BILL_ID>.json each
  --att       directory of plenary-*.xlsx / standing-*.pdf / special-*.pdf
  --out       app/data/role-adjustments.json

Every excluded count is reconciled against the D1 totals before it is
written; the script stops if a source does not add up.
"""
import argparse, collections, csv, datetime as dt, glob, json, os, re, sys

import openpyxl
import pdfplumber

VOTED = {'찬성', '반대', '기권'}
SCORED_VOTE_STATUS = {'api_only_pass', 'web_repair_pass', 'hold_count_mismatch'}
EVAL_END = '2026-09-30'  # last day counted in tenure_days


def days(a, b):
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days + 1


def periods_for(roles, member_id):
    out = []
    for r in roles:
        if r['member_id'] == member_id and r['kind'] == 'exclude':
            out.append((r['start'], r['end'] or EVAL_END))
    return out


def inside(d, periods):
    return any(s <= d <= e for s, e in periods)


def parse_plenary(att_dir):
    daily = collections.defaultdict(dict)
    for f in sorted(glob.glob(os.path.join(att_dir, 'plenary-*.xlsx'))):
        rows = list(openpyxl.load_workbook(f, read_only=True).worksheets[0].iter_rows(values_only=True))
        cols = [(i, re.sub(r'\D', '', h)) for i, h in enumerate(rows[3]) if h and re.match(r'\(\d{4}년', str(h))]
        for r in rows[4:]:
            if not r[0] or r[0] == '의원명':
                continue
            for i, d in cols:
                daily[str(r[0]).strip()][f'{d[:4]}-{d[4:6]}-{d[6:8]}'] = (r[i] or '').strip()
    return daily


def parse_committee(att_dir, published):
    recs = []
    for f in sorted(glob.glob(os.path.join(att_dir, 'standing-*.pdf')) + glob.glob(os.path.join(att_dir, 'special-*.pdf'))):
        seq = re.search(r'-(\d+)\.pdf$', f).group(1)
        py, pm = map(int, published[seq].split('-')[:2])
        with pdfplumber.open(f) as pdf:
            for page in pdf.pages:
                for tb in page.extract_tables():
                    dates = None
                    for row in tb:
                        cells = [(c or '').strip() for c in row]
                        if any(re.match(r'\d{2}월\s*\d{2}일', c) for c in cells):
                            dates = []
                            for c in cells[1:]:
                                m = re.match(r'(\d{2})월\s*(\d{2})일', c)
                                if m:
                                    mo, d = int(m.group(1)), int(m.group(2))
                                    dates.append(f'{py if mo <= pm else py - 1}-{mo:02d}-{d:02d}')
                                else:
                                    dates.append(None)
                            continue
                        m = re.match(r'^(.+?)\((.+)\)$', cells[0])
                        if not m or dates is None or not all(re.fullmatch(r'\d+', x) for x in cells[-6:]):
                            continue
                        for i, s in enumerate(cells[1:len(cells) - 6]):
                            if s:
                                recs.append((m.group(1), m.group(2), dates[i], s))
    return recs


def main():
    ap = argparse.ArgumentParser()
    for a in ('roles', 'members', 'audit', 'votes', 'att', 'files', 'out'):
        ap.add_argument('--' + a, required=True)
    args = ap.parse_args()

    roles = json.load(open(args.roles, encoding='utf-8'))['roles']
    members = {m['id']: m for m in json.load(open(args.members, encoding='utf-8'))['members']}
    audit = [r for r in csv.DictReader(open(args.audit, encoding='utf-8')) if r['validation_status'] in SCORED_VOTE_STATUS]
    published = {r['file_seq']: r['published'] for r in csv.DictReader(open(args.files, encoding='utf-8'))}
    plenary = parse_plenary(args.att)
    committee = parse_committee(args.att, published)

    problems = []
    result = {}
    for mid in sorted({r['member_id'] for r in roles if r['kind'] == 'exclude'}):
        m = members[mid]
        per = periods_for(roles, mid)
        name, hanja = m['name'], m['hanja_name']

        # votes: bills in the scored universe, voted inside the period, within tenure
        v_all = v_all_part = v_ex = v_ex_part = 0
        for b in audit:
            d = b['vote_date']
            if d < m['term_start'] or (m['term_end'] and d > m['term_end']):
                continue
            rows = json.load(open(os.path.join(args.votes, b['bill_id'] + '.json'), encoding='utf-8'))
            rows = rows.get('nojepdqqaweusdfbi', [{}, {'row': []}])[1]['row']
            voted = any(r['MONA_CD'] == mid and r['RESULT_VOTE_MOD'] in VOTED for r in rows)
            v_all += 1
            v_all_part += voted
            if inside(d, per):
                v_ex += 1
                v_ex_part += voted
        if v_all != m['vote_eligible']:
            problems.append(f'{name}: vote universe {v_all} != D1 {m["vote_eligible"]}')
        api_gap = m['vote_participated'] - v_all_part  # rows recovered from the web record, not in the API

        # plenary days
        pd = plenary[name]
        pl_total = collections.Counter(pd.values())
        if pl_total['출석'] != m['attendance_present'] or sum(pl_total.values()) != m['attendance_meetings']:
            problems.append(f'{name}: plenary daily does not match D1')
        pl_ex = collections.Counter(s for d, s in pd.items() if inside(d, per))

        # committee meetings
        cm = [(d, s) for n, h, d, s in committee if n == name and h == hanja]
        cm_total = collections.Counter(s for _, s in cm)
        if cm_total['출석'] != m['committee_present'] or len(cm) != m['committee_meetings_total']:
            problems.append(f'{name}: committee daily does not match D1')
        cm_ex = collections.Counter(s for d, s in cm if inside(d, per))

        role_days = sum(days(max(s, m['term_start']), min(e, m['term_end'] or EVAL_END)) for s, e in per)
        result[mid] = {
            'name': name,
            'periods': [{'start': s, 'end': e} for s, e in per],
            'role_days': role_days,
            'votes': {'eligible': v_ex, 'participated': v_ex_part, 'api_gap_rows_total': api_gap},
            'plenary': {'meetings': sum(pl_ex.values()), 'present': pl_ex['출석'], 'absent': pl_ex['결석'],
                        'leave': pl_ex['청가'], 'travel': pl_ex['출장'], 'reported_absence': pl_ex['결석신고서']},
            'committee': {'meetings': sum(cm_ex.values()), 'present': cm_ex['출석'], 'absent': cm_ex['결석'],
                          'leave': cm_ex['청가'], 'travel': cm_ex['출장'], 'reported_absence': cm_ex['결석신고서']},
        }

    if problems:
        print('\n'.join(problems), file=sys.stderr)
        sys.exit(1)
    json.dump({'generated_from': {'roles': os.path.basename(args.roles), 'audit': os.path.basename(args.audit),
                                  'eval_end': EVAL_END},
               'members': result}, open(args.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    for mid, r in result.items():
        print(r['name'], r['role_days'], r['votes'], r['plenary']['meetings'], r['committee']['meetings'])


if __name__ == '__main__':
    main()
