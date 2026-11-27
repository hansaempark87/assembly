"""22nd general election (2024-04-10) pledges of the district winners.

The NEC pledge API carries 선거공약서, which the election law (art. 66) asks only
of presidential, local-government-head and superintendent candidates, so it has
nothing for National Assembly candidates. Pledges are therefore taken from what
the press reported during the campaign: Naver news search for the candidate's
pledges (items dated 2024-01-01 to the election day), read by the model, each
pledge kept with the articles it came from. The NEC winner list gives the
candidates and districts.

  WinnerInfoInqireService2/getWinnerInfoInqire     winners: candidate id, name, district
  ElecPrmsInfoInqireService/getCnddtElecPrmsInfoInqire  one candidate's pledges

Winners are matched to member codes by name and district, and the pledges kept
in data/source/pledges.json. Proportional members have no personal pledges in
this service. The key is read from DATA_GO_KR_KEY and sent only to data.go.kr.

    python3 pledges.py
"""
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request

from common import SRC, UA

BASE = 'https://apis.data.go.kr/9760000'
SG_ID, SG_TYPE = '20240410', '2'  # 22nd general election, district seats


def fetch(url):
    """body of a data.go.kr response; on an error status the body still says why (key not registered, ...)"""
    for i in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60) as r:
                return r.read().decode('utf-8', 'ignore')
        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', 'ignore')
            reason = re.search(r'errMsg\W+([A-Z_]+)', body)
            raise SystemExit(f"{url.split('?')[0].rsplit('/', 2)[-2]}: HTTP {e.code} {reason.group(1) if reason else body[:200]}"
                             + (' (check that this API is approved for the key; a new key can take an hour to work)' if e.code in (401, 403) else ''))
        except Exception:  # connection resets: try again
            time.sleep(3 * (i + 1))
    raise SystemExit(f"{url.split('?')[0]}: no response")


def call(path, **params):
    # the portal shows the key twice, URL-encoded and decoded; either may be stored, so decode first
    key = urllib.parse.unquote(os.environ['DATA_GO_KR_KEY'].strip())
    q = urllib.parse.urlencode({'serviceKey': key, 'resultType': 'json', 'pageNo': 1, 'numOfRows': 100, **params})
    raw = fetch(f'{BASE}/{path}?{q}')
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


NEWS_PROMPT = """아래는 2024년 4월 10일 22대 총선 전에 {district} 지역구 {party} {name} 후보의 공약을 다룬 기사 목록이다 (번호, 날짜, 제목, 요약).
이 후보가 내건 공약을 정리하라.

규칙:
- 기사에 실제로 나온 공약만 쓴다. 다른 후보의 공약, 정당 전체 공약은 빼고, 이 후보의 공약만 쓴다.
- 지역 사업(교통, 개발, 시설 등)과 입법·정책 공약을 모두 포함하되, 같은 공약은 하나로 합친다.
- 최대 10개, 중요해 보이는 순서로.
- title: 공약 이름, 30자 이내 (예: "GTX-B 노선 조기 착공").
- body: 무엇을 하겠다는 것인지 한 문장, 80자 이내.
- realm: 교통, 개발·주거, 교육, 복지, 경제·일자리, 환경, 문화·체육, 안전, 행정, 입법·정책 중 하나.
- sources: 근거 기사 번호 1~3개.
- 공약을 찾을 수 없으면 빈 배열.

기사:
{items}"""

NEWS_SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['pledges'], 'properties': {
    'pledges': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
                'required': ['title', 'body', 'realm', 'sources'],
                'properties': {'title': {'type': 'string'}, 'body': {'type': 'string'}, 'realm': {'type': 'string'},
                               'sources': {'type': 'array', 'items': {'type': 'integer'}}}}}}}

_client = None


def news_pledges(name, district, sd, party):
    """pledges reported in the press during the campaign; [] when the keys are missing or nothing is found"""
    global _client
    if not (os.environ.get('NAVER_CLIENT_ID') and os.environ.get('ANTHROPIC_API_KEY')):
        return []
    from audit import ask
    from pledge_check import naver
    place = district.split()[-1] if district else ''
    seen, found = set(), []
    for q in (f'{name} 후보 공약', f'{name} {place} 공약', f'{name} 총선 공약 {place}'):
        for it in naver('news', q, 30):
            if it['link'] in seen or not it['date'] or not ('2024-01-01' <= it['date'] <= '2024-04-10') or name not in it['title'] + it['desc']:
                continue
            seen.add(it['link'])
            found.append(it)
    if not found:
        return []
    found = found[:30]
    if _client is None:
        import anthropic
        _client = anthropic.Anthropic()
    listing = '\n'.join(f"[{i}] {it['date']} | {it['title']} | {it['desc']}" for i, it in enumerate(found))
    try:
        got = ask(_client, os.environ.get('PLEDGE_MODEL', 'claude-haiku-5-5'),
                  NEWS_PROMPT.format(district=district, party=party, name=name, items=listing), NEWS_SCHEMA)
    except RuntimeError as e:
        print(f'pledge extraction stopped: {e}')
        return []
    out = []
    for k, p in enumerate((got or {}).get('pledges', [])[:10], 1):
        src = [found[i] for i in p['sources'] if isinstance(i, int) and 0 <= i < len(found)][:3]
        if not src:
            continue  # a pledge with no article behind it is not kept
        out.append({'ord': k, 'realm': p['realm'], 'title': p['title'].strip(), 'body': p['body'].strip(), 'from': 'news',
                    'sources': [{'title': x['title'], 'date': x['date'], 'link': x['link']} for x in src]})
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
    scope = os.environ.get('PLEDGE_SCOPE', 'all').strip()
    if scope == 'all':
        wanted = None
    elif scope == 'pilot':
        from pledge_check import pilot
        wanted = {m['id'] for m in pilot(members)}
    else:
        wanted = {x.strip() for x in scope.split(',')}
    for w in ws:
        name, sgg = w.get('name', ''), (w.get('sggName') or '').replace(' ', '')
        cand = [m for m in members if m['name'] == name and sgg and sgg in m['district'].replace(' ', '')]
        if len(cand) != 1:
            cand = [m for m in members if m['name'] == name and not m['district'].startswith('비례')]
        if len(cand) != 1:
            print(f'no member for {name} {w.get("sdName")} {sgg}')
            continue
        m = cand[0]
        if wanted is not None and m['id'] not in wanted:
            continue
        if m['id'] in have and have[m['id']].get('pledges'):
            matched += 1
            continue
        ps = news_pledges(name, m['district'], w.get('sdName', ''), w.get('jdName', ''))
        have[m['id']] = {'huboid': w['huboid'], 'name': name, 'district': m['district'], 'party_2024': w.get('jdName'), 'pledges': ps}
        matched += 1
        if matched == 1:
            print('sample pledge count:', len(ps), (ps[0]['title'] if ps else '-'))
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(have.items())), f, ensure_ascii=False, indent=1)
    print(f'pledges kept for {matched} members, {sum(len(v["pledges"]) for v in have.values())} pledges')


if __name__ == '__main__':
    main()
