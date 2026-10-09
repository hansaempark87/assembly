#!/usr/bin/env python3
"""Bring app/data/source/ up to date from the public Assembly sources.

Anything the published rules cannot settle on their own stops the update
("hard" problems) so a person looks first; things the rules already cover
are applied and listed ("warn"). The report goes to data/build/report.json.

Hard stops:
  * a member joins or leaves (term dates and fairness rules need a person)
  * a vote whose per-member records disagree with its official totals, whose
    roll does not match the members in office, or that falls on a day a seat
    changed hands
  * a name in an attendance file that cannot be matched to exactly one member
  * a re-published attendance file for a session/month already counted
  * a source returning fewer records than already stored

Requires ASSEMBLY_API_KEY in the environment.
usage: fetch.py [--today YYYY-MM-DD]
"""
import argparse, collections, datetime as dt, json, os, sys, tempfile

from common import (APP, COMMITTEE_INF, PLENARY_INF, VOTED, People, api_all, bill_record, committee_kind, file_get,
                    file_list, month_of, parse_committee, parse_plenary, read_json, read_jsonl, session_of, sha256,
                    vote_record, write_json, write_jsonl)

FIRST_SESSION = 415      # 제22대 국회 첫 회기
FIRST_MONTH = '2024-06'  # 제22대 첫 위원회 출결 월
KST = dt.timezone(dt.timedelta(hours=9))


def log(msg):
    print(f'{dt.datetime.now().strftime("%H:%M:%S")} {msg}', flush=True)


class Report:
    def __init__(self):
        self.hard, self.warn, self.info = [], [], []

    def save(self):
        os.makedirs(APP / 'data' / 'build', exist_ok=True)
        write_json(APP / 'data' / 'build' / 'report.json', {'hard': self.hard, 'warn': self.warn, 'info': self.info})
        for k in ('hard', 'warn', 'info'):
            for x in getattr(self, k):
                print(f'[{k}] {x}')


def update_members(rep):
    mj = read_json('members.json')
    cur = {r['MONA_CD']: r for r in api_all('nwvrqwxyaytdsfvhu')}
    have = {m['id']: m for m in mj['members']}
    for code in cur.keys() - have.keys():
        r = cur[code]
        rep.hard.append(f'새 의원: {r["HG_NM"]}({code}) {r.get("POLY_NM")} — 임기 시작일 확인 후 members.json에 추가 필요')
    for code in have.keys() - cur.keys():
        rep.hard.append(f'명단에서 빠진 의원: {have[code]["name"]}({code}) — 퇴직일 확인 필요')
    for code, m in have.items():
        r = cur.get(code)
        if not r:
            continue
        new = {'name': r['HG_NM'], 'hanja_name': r['HJ_NM'], 'party': r['POLY_NM'], 'district': r['ORIG_NM'], 'committee': r['CMIT_NM']}
        if new['party'] != m['party']:
            rep.info.append(f'소속 정당 변경: {m["name"]} {m["party"]} → {new["party"]}')
        m.update(new)
    return mj


def update_bills(rep, today):
    old = read_jsonl('bills.jsonl')
    rows = sorted((bill_record(r) for r in api_all('nzmimeepazxkubdpn', AGE=22)), key=lambda b: b['BILL_NO'])
    if len(rows) < len(old):
        rep.hard.append(f'발의법률안 API가 기존보다 적게 응답: {len(rows)} < {len(old)}')
        return None
    ids = {b['BILL_ID'] for b in rows}
    gone = [b['BILL_NO'] for b in old if b['BILL_ID'] not in ids]
    if gone:
        rep.hard.append(f'기존 법안이 API에서 사라짐: {gone[:5]}')
        return None
    rep.info.append(f'법안: {len(rows) - len(old)}건 추가 (전체 {len(rows):,}건)')
    return rows


def update_votes(rep, members, former):
    stored = read_jsonl('votes.jsonl')
    have = {v['bill_id'] for v in stored}
    listed = api_all('ncocpgfiaoituanbr', AGE=22)
    listed_ids = {x['BILL_ID'] for x in listed}
    missing = [v['bill_no'] for v in stored if v['bill_id'] not in listed_ids]
    if missing:
        rep.hard.append(f'기존 표결이 목록 API에서 사라짐: {missing[:5]}')
        return None
    starts = {m['term_start'] for m in members}
    known = {m['id'] for m in members} | set(former)
    new = sorted((x for x in listed if x['BILL_ID'] not in have), key=lambda x: (x['PROC_DT'], x['BILL_NO']))
    added, deferred_from = [], None
    for item in new:
        d = item['PROC_DT']
        if deferred_from and d >= deferred_from:
            break
        log(f'  vote {d} {item["BILL_NO"]}')
        rows = api_all('nojepdqqaweusdfbi', size=400, AGE=22, BILL_ID=item['BILL_ID'])
        if not rows:  # per-member records are published a few days after the list
            deferred_from = d
            continue
        v = vote_record(item, rows, 'api_only_pass')
        t = v['totals']
        label = f'{d} 의안 {item["BILL_NO"]}'
        if (len(v['Y']), len(v['N']), len(v['A'])) != (t['yes'], t['no'], t['abstain']):
            rep.hard.append(f'{label}: 개인별 찬성·반대·기권 {len(v["Y"])}/{len(v["N"])}/{len(v["A"])} ≠ 공식 집계 {t["yes"]}/{t["no"]}/{t["abstain"]}')
        in_office = sum(1 for m in members if m['term_start'] <= d and (not m['term_end'] or d <= m['term_end']))
        if in_office != t['members']:
            rep.hard.append(f'{label}: 재임 의원 {in_office}명 ≠ 공식 재적 {t["members"]}명')
        if d in starts:
            rep.hard.append(f'{label}: 의원 임기 시작일과 같은 날 표결 — 분모 포함 여부 판단 필요')
        unknown = {r['MONA_CD'] for r in rows} - known
        if unknown:
            rep.hard.append(f'{label}: 알 수 없는 의원코드 {sorted(unknown)}')
        added.append(v)
    if deferred_from:
        rep.info.append(f'표결: {deferred_from} 이후분은 개인별 기록이 아직 없어 다음 갱신 때 반영')
    rep.info.append(f'표결: {len(added)}건 추가 (전체 {len(stored) + len(added):,}건)')
    return sorted(stored + added, key=lambda v: (v['date'], v['bill_no']))


def update_attendance(rep, people, members):
    manifest = read_json('files.json')
    plenary = read_json('plenary.json')
    committee = read_jsonl('committee.jsonl')
    known = {f['seq'] for f in manifest['files']}
    p_keys = {p['session']: p['seq'] for p in plenary['files']}
    c_keys = {(r['month'], r['kind']): r['seq'] for r in committee}
    by_id = {m['id']: m for m in members}
    tmp = tempfile.mkdtemp()
    added = 0
    for inf, kind in ((PLENARY_INF, 'plenary'), (COMMITTEE_INF, 'committee')):
        for f in sorted(file_list(inf), key=lambda x: x['fileSeq']):
            seq, title, published = f['fileSeq'], f['viewFileNm'], f['ftCrDttm']
            if seq in known:
                continue
            if kind == 'plenary':
                key = session_of(title)
                if not key or key < FIRST_SESSION:
                    continue
                if key in p_keys:
                    rep.hard.append(f'본회의 제{key}회 출결 파일 재게시({p_keys[key]} → {seq}): 변경 내용 확인 필요')
                    continue
            else:
                month = month_of(title)
                if not month or month < FIRST_MONTH:
                    continue
                ck = committee_kind(title)
                if (month, ck) in c_keys:
                    rep.hard.append(f'위원회 {month} {ck} 출결 파일 재게시({c_keys[(month, ck)]} → {seq}): 변경 내용 확인 필요')
                    continue
            data = file_get(inf, seq)
            path = os.path.join(tmp, f'{seq}.{f["fileExt"]}')
            with open(path, 'wb') as fh:
                fh.write(data)
            entry = {'kind': kind if kind == 'plenary' else ck, 'seq': seq, 'title': title, 'published': published, 'sha256': sha256(data)}
            if kind == 'plenary':
                dates, rows = parse_plenary(path)
                names = {x['name'] for x in rows}
                out = {}
                for x in rows:
                    i = people.plenary(x['name'], names, max(dates))
                    if not i or i in out:
                        rep.hard.append(f'본회의 제{key}회: 이름 "{x["name"]}"을 의원 한 명에 연결할 수 없음')
                        continue
                    c = collections.Counter(x['status'])
                    daily = [len([s for s in x['status'] if s in ('출석', '결석', '청가', '출장', '결석신고서')]),
                             c['출석'], c['결석'], c['청가'], c['출장'], c['결석신고서']]
                    if daily != x['total']:
                        rep.warn.append(f'본회의 제{key}회 {x["name"]}: 날짜별 표시 {daily} ≠ 공개 합계 {x["total"]} → 공개 합계 적용')
                    out[i] = {'party': x['party'], 'status': x['status'], 'total': x['total']}
                for m in members:
                    if m['term_start'] <= dates[0] and m['id'] not in out:
                        rep.hard.append(f'본회의 제{key}회: 재임 중인 {m["name"]} 행이 없음')
                plenary['files'].append({'seq': seq, 'session': key, 'dates': dates, 'rows': out})
                p_keys[key] = seq
            else:
                for x in parse_committee(path, published):
                    i = people.committee(x['name'], x['hanja'])
                    if not i:
                        rep.hard.append(f'위원회 {month}: 이름 "{x["name"]}({x["hanja"]})"을 의원 한 명에 연결할 수 없음')
                    c = collections.Counter(s for _, s in x['daily'])
                    daily = [len(x['daily']), c['출석'], c['결석'], c['청가'], c['출장'], c['결석신고서']]
                    if i in by_id and daily != x['total']:
                        rep.warn.append(f'위원회 {month} {x["committee"]} {x["name"]}: 날짜별 표시 {daily} ≠ 공개 합계 {x["total"]} → 공개 합계 적용')
                    committee.append({'seq': seq, 'month': month, 'kind': ck, 'committee': x['committee'], 'id': i,
                                      'name': x['name'], 'hanja': x['hanja'], 'total': x['total'], 'daily': x['daily']})
                c_keys[(month, ck)] = seq
            manifest['files'].append(entry)
            known.add(seq)
            added += 1
            rep.info.append(f'출결 파일 추가: {title} ({published})')
    if not added:
        rep.info.append('출결: 새 파일 없음')
    plenary['files'].sort(key=lambda p: p['dates'][0])
    manifest['files'].sort(key=lambda f: (f['kind'], f['seq']))
    committee.sort(key=lambda c: (c['month'], c['seq'], c['committee'], c['name']))
    return manifest, plenary, committee


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--today', default=dt.datetime.now(KST).date().isoformat())
    args = ap.parse_args()
    today = args.today
    rep = Report()
    try:
        log('members')
        mj = update_members(rep)
        members, former = mj['members'], mj['former']
        log('bills')
        bills = update_bills(rep, today)
        log('votes')
        votes = update_votes(rep, members, former)
        log('attendance')
        att = update_attendance(rep, People(members, former), members)
    except Exception as e:  # network or format failure: nothing is written
        rep.hard.append(f'수집 실패: {e}')
        rep.save()
        return 1
    if rep.hard or bills is None or votes is None:
        rep.save()
        return 1
    write_json('members.json', mj)
    write_jsonl('bills.jsonl', bills)
    write_jsonl('votes.jsonl', votes)
    manifest, plenary, committee = att
    write_json('files.json', manifest)
    write_json('plenary.json', plenary, indent=None)
    write_jsonl('committee.jsonl', committee)
    bills_until = (dt.date.fromisoformat(today) - dt.timedelta(days=1)).isoformat()
    write_json('meta.json', {'data_as_of': today, 'bills_until': bills_until,
                             'fetched_at': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')})
    rep.save()
    return 0


if __name__ == '__main__':
    sys.exit(main())
