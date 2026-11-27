"""22nd general election (2024-04-10) pledges of the district winners, from the
National Election Commission open API (data.go.kr).

  WinnerInfoInqireService2/getWinnerInfoInqire     winners: candidate id, name, district
  ElecPrmsInfoInqireService/getCnddtElecPrmsInfoInqire  one candidate's pledges

Winners are matched to member codes by name and district, and the pledges kept
in data/source/pledges.json. Proportional members have no personal pledges in
this service. The key is read from DATA_GO_KR_KEY and sent only to data.go.kr.

    python3 pledges.py
"""
import json
import os
import urllib.parse

from common import SRC, _get

BASE = 'https://apis.data.go.kr/9760000'
SG_ID, SG_TYPE = '20240410', '2'  # 22nd general election, district seats


def call(path, **params):
    key = os.environ['DATA_GO_KR_KEY']
    q = urllib.parse.urlencode({'serviceKey': key, 'resultType': 'json', 'pageNo': 1, 'numOfRows': 100, **params})
    raw = _get(f'{BASE}/{path}?{q}', tries=4).decode('utf-8', 'ignore')
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        raise SystemExit(f'{path}: not JSON: {raw[:300]}')
    body = data.get('response', data).get('body') or {}
    head = data.get('response', data).get('header') or {}
    if head and str(head.get('resultCode')) not in ('00', 'INFO-00', 'None'):
        print(f"{path}: {head.get('resultCode')} {head.get('resultMsg')}")
    items = (body.get('items') or {}).get('item') or []
    return [items] if isinstance(items, dict) else items, int(body.get('totalCount') or 0)


def winners():
    out, page = [], 1
    while True:
        items, total = call('WinnerInfoInqireService2/getWinnerInfoInqire', sgId=SG_ID, sgTypecode=SG_TYPE, pageNo=page)
        out += items
        if not items or len(out) >= total:
            return out
        page += 1


def pledges_of(huboid):
    items, _ = call('ElecPrmsInfoInqireService/getCnddtElecPrmsInfoInqire', sgId=SG_ID, sgTypecode=SG_TYPE, cnddtId=huboid)
    out = []
    for it in items:
        n = int(it.get('prmsCnt') or 0) or 10
        for i in range(1, n + 1):
            title = (it.get(f'prmsTitle{i}') or '').strip()
            if not title:
                continue
            out.append({'ord': int(it.get(f'prmsOrd{i}') or i), 'realm': (it.get(f'prmsRealmName{i}') or '').strip(),
                        'title': title, 'body': (it.get(f'prmmCont{i}') or '').strip()})
    return out


def main():
    if not os.environ.get('DATA_GO_KR_KEY'):
        print('DATA_GO_KR_KEY is not set: pledges not updated')
        return
    members = json.load(open(SRC / 'members.json', encoding='utf-8'))['members']
    ws = winners()
    print(f'winners listed: {len(ws)}')
    if ws:
        print('winner fields:', sorted(ws[0].keys()))
    path = SRC / 'pledges.json'
    have = json.load(open(path, encoding='utf-8')) if path.exists() else {}
    matched = 0
    for w in ws:
        name, sgg = w.get('name', ''), (w.get('sggName') or '').replace(' ', '')
        cand = [m for m in members if m['name'] == name and sgg and sgg in m['district'].replace(' ', '')]
        if len(cand) != 1:
            cand = [m for m in members if m['name'] == name and not m['district'].startswith('비례')]
        if len(cand) != 1:
            print(f'no member for {name} {w.get("sdName")} {sgg}')
            continue
        m = cand[0]
        if m['id'] in have and have[m['id']].get('pledges'):
            matched += 1
            continue
        ps = pledges_of(w['huboid'])
        have[m['id']] = {'huboid': w['huboid'], 'name': name, 'district': m['district'], 'party_2024': w.get('jdName'), 'pledges': ps}
        matched += 1
        if matched == 1:
            print('sample pledge count:', len(ps), (ps[0]['title'] if ps else '-'))
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(have.items())), f, ensure_ascii=False, indent=1)
    print(f'pledges kept for {matched} members, {sum(len(v["pledges"]) for v in have.values())} pledges')


if __name__ == '__main__':
    main()
