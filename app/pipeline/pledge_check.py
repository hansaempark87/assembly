"""Where each pledge stands, judged from what can be found about it online.

For every pledge in data/source/pledges.json: the model writes two or three news
search queries (place + project), the Naver news and web-document search APIs are
asked, and the model reads the results (title, snippet, date, link) and gives one
status, with the items it relied on:

  done      완료        opened, completed, in force, enacted
  progress  진행 중     budget secured, plan approved, design or works under way
  delayed   지연·보류    delayed, on hold, scrapped
  notfound  관련 데이터를 찾을 수 없음

Only items dated after the election (2024-04-10) count. The status says where the
project stands, not who deserves the credit. Results go to
data/source/pledge-status.json with the date checked.

PLEDGE_SCOPE picks the members: 'pilot' (ten district members spread over parties
and regions), 'all', or a comma list of member codes. A member checked within
PLEDGE_RECHECK_DAYS is skipped. Needs NAVER_CLIENT_ID, NAVER_CLIENT_SECRET and
ANTHROPIC_API_KEY.

    PLEDGE_SCOPE=pilot python3 pledge_check.py
"""
import datetime as dt
import html
import json
import os
import re
import urllib.parse
import urllib.request

from audit import ask
from common import SRC

ELECTION = '2024-04-10'
STATUS = ['done', 'progress', 'delayed', 'notfound']

QUERY_PROMPT = """다음은 {district} 지역구 국회의원 {name}의 22대 총선 공약 목록이다.
공약마다 그 사업이 실제로 진행되는지 뉴스에서 찾기 위한 검색어를 2~3개 만들어라.

규칙:
- 지역명(시·군·구, 동네, 노선명)과 사업의 고유한 이름을 넣는다. 예: "남양주 GTX-B 착공", "왕숙 신도시 지하철 9호선 연장".
- 의원 이름은 넣지 않는다 (사업 자체의 진행을 찾는 것이므로).
- 전국 단위 입법 공약이면 법 이름이나 제도 이름으로 만든다.

공약:
{items}"""

QUERY_SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['pledges'], 'properties': {
    'pledges': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['ord', 'queries'],
                'properties': {'ord': {'type': 'integer'}, 'queries': {'type': 'array', 'items': {'type': 'string'}}}}}}}

JUDGE_PROMPT = """너는 공약 이행 상황을 확인하는 중립적인 조사원이다.
공약: [{district}] {title}
내용: {body}

아래는 검색으로 찾은 자료다 (번호, 날짜, 제목, 요약). 이 공약 사업이 지금 어디까지 왔는지 판정하라.

판정 기준:
- done: 개통·준공·완공·시행·법 통과 등 사업이 끝났다는 자료가 있다.
- progress: 예산 반영, 계획 승인·고시, 설계·용역 착수, 착공, 공사 중, 법안 발의·심사 중 등 진행 자료가 있다.
- delayed: 지연, 보류, 무산, 백지화, 예산 삭감 등 막혔다는 자료가 있다.
- notfound: 이 공약 사업의 진행을 보여주는 자료가 없다.

규칙:
- {election} 이후 날짜의 자료만 근거로 쓴다.
- 근거 자료의 제목이나 요약에 그 사업(또는 법·제도)의 이름이나 대상이 직접 나와야 한다. 지역 소식 모음, 다른 주제 기사는 근거가 아니다.
- 지역 사업이면 같은 지역의 같은 사업인지 꼭 확인한다. 비슷한 다른 지역 사업은 근거가 아니다.
- 입법·전국 정책 공약(법 제정·개정, 전국 제도)이면 지역과 상관없이 그 법이나 제도의 진행(발의, 심사, 통과, 시행)으로 판정한다.
- 공약 발표, 재다짐, 요구·촉구, "추진하겠다"는 계획 발언만 있으면 notfound다. 실제로 예산, 계획, 공사, 법안 처리 같은 단계가 움직였다는 자료가 있어야 progress다.
- reason과 status가 서로 맞아야 한다. 진행 자료가 없다고 쓰면 status는 notfound다.
- 여러 단계 자료가 있으면 가장 최근 상태를 고른다.
- 누구의 공로인지는 판단하지 않는다. 사업의 상태만 본다.
- reason: 판정 이유 한 문장, 60자 이내, 평가 표현 없이.
- evidence: 근거로 쓴 자료 번호 1~3개 (notfound면 빈 배열).

자료:
{items}"""

JUDGE_SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['status', 'reason', 'evidence'], 'properties': {
    'status': {'type': 'string', 'enum': STATUS}, 'reason': {'type': 'string'},
    'evidence': {'type': 'array', 'items': {'type': 'integer'}}}}


def naver(kind, query, n=10):
    q = urllib.parse.urlencode({'query': query, 'display': n, 'sort': 'sim'})
    req = urllib.request.Request(f'https://openapi.naver.com/v1/search/{kind}.json?{q}', headers={
        'X-Naver-Client-Id': os.environ['NAVER_CLIENT_ID'], 'X-Naver-Client-Secret': os.environ['NAVER_CLIENT_SECRET']})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            items = json.loads(r.read()).get('items', [])
    except Exception as e:  # a failed search leaves the pledge with fewer sources, not the run
        print(f'search failed ({kind}): {type(e).__name__}')
        return []
    clean = lambda s: html.unescape(re.sub(r'<[^>]+>', '', s or '')).strip()
    out = []
    for it in items:
        date = ''
        if it.get('pubDate'):
            try:
                date = dt.datetime.strptime(it['pubDate'], '%a, %d %b %Y %H:%M:%S %z').date().isoformat()
            except ValueError:
                date = ''
        out.append({'title': clean(it.get('title')), 'desc': clean(it.get('description'))[:220], 'date': date,
                    'link': it.get('originallink') or it.get('link'), 'kind': kind})
    return out


def pilot(members, pledges=None):
    """ten district members: by seat share of party, spread over regions (with pledges, when given)"""
    pool = [m for m in members if not m['district'].startswith('비례') and (pledges is None or pledges.get(m['id'], {}).get('pledges'))]
    want = {'더불어민주당': 5, '국민의힘': 4}
    out, regions = [], set()
    for m in sorted(pool, key=lambda m: (m['district'], m['id'])):
        k = m['party'] if m['party'] in want else 'other'
        quota = want.get(k, 1)
        if sum(1 for x in out if (x['party'] if x['party'] in want else 'other') == k) >= quota:
            continue
        r = m['district'].split()[0]
        if r in regions and len(regions) < 9:
            continue
        out.append(m)
        regions.add(r)
        if len(out) == 10:
            break
    return out


def main():
    for k in ('NAVER_CLIENT_ID', 'NAVER_CLIENT_SECRET', 'ANTHROPIC_API_KEY'):
        if not os.environ.get(k):
            print(f'{k} is not set: pledge status not updated')
            return
    import anthropic
    client = anthropic.Anthropic()
    model = os.environ.get('PLEDGE_MODEL', 'claude-haiku-5-5')
    pledges = json.load(open(SRC / 'pledges.json', encoding='utf-8'))
    members = json.load(open(SRC / 'members.json', encoding='utf-8'))['members']
    scope = os.environ.get('PLEDGE_SCOPE', 'pilot')
    if scope == 'pilot':
        chosen = pilot(members, pledges)
    elif scope == 'all':
        chosen = [m for m in members if m['id'] in pledges]
    else:
        ids = {x.strip() for x in scope.split(',')}
        chosen = [m for m in members if m['id'] in ids]
    path = SRC / 'pledge-status.json'
    have = json.load(open(path, encoding='utf-8')) if path.exists() else {}
    today = dt.date.today()
    recheck = 0 if scope == 'pilot' else int(os.environ.get('PLEDGE_RECHECK_DAYS', '25'))
    print(f'members to check: {len(chosen)} ({", ".join(m["name"] for m in chosen[:12])})')
    for m in chosen:
        prev = have.get(m['id'], {}).get('checked')
        if prev and (today - dt.date.fromisoformat(prev)).days < recheck:
            continue
        ps = pledges[m['id']]['pledges']
        items = '\n'.join(f"{p['ord']}. {p['title']} — {p['body'][:200]}" for p in ps)
        try:
            qs = ask(client, model, QUERY_PROMPT.format(district=m['district'], name=m['name'], items=items), QUERY_SCHEMA)
        except RuntimeError as e:
            print(f'stop: {e}')
            break
        queries = {q['ord']: q['queries'][:3] for q in (qs or {}).get('pledges', [])}
        results = []
        for p in ps:
            found, seen = [], set()
            for q in queries.get(p['ord'], [p['title']]):
                for it in naver('news', q, 20):  # web documents carry no date, so only news counts
                    if it['link'] in seen or not it['date'] or it['date'] < ELECTION:  # undated pages can't show when
                        continue
                    seen.add(it['link'])
                    found.append(it)
            found = found[:24]
            listing = '\n'.join(f"[{i}] {it['date'] or '날짜 없음'} | {it['title']} | {it['desc']}" for i, it in enumerate(found)) or '(검색 결과 없음)'
            try:
                j = ask(client, model, JUDGE_PROMPT.format(district=m['district'], title=p['title'], body=p['body'][:400],
                                                           election=ELECTION, items=listing), JUDGE_SCHEMA) if found else None
            except RuntimeError as e:
                print(f'stop: {e}')
                j = None
            j = j or {'status': 'notfound', 'reason': '같은 사업을 다룬 자료를 찾지 못함', 'evidence': []}
            ev = [found[i] for i in j['evidence'] if isinstance(i, int) and 0 <= i < len(found)][:3]
            if j['status'] != 'notfound' and not ev:
                j = {'status': 'notfound', 'reason': '근거 자료를 확인하지 못함', 'evidence': []}
            if j['status'] != 'notfound' and re.search(r'자료(가|는) 없|확인할 수 없|판단(할|하기) 어렵|공약 단계', j['reason']):
                j = {'status': 'notfound', 'reason': j['reason'], 'evidence': []}  # the reason itself says nothing moved
                ev = []
            results.append({'ord': p['ord'], 'title': p['title'], 'realm': p['realm'], 'status': j['status'], 'reason': j['reason'],
                            'evidence': [{'title': e['title'], 'date': e['date'], 'link': e['link']} for e in ev],
                            'queries': queries.get(p['ord'], []), 'searched': len(found)})
        have[m['id']] = {'name': m['name'], 'district': m['district'], 'checked': today.isoformat(), 'model': model, 'items': results}
        c = {s: sum(r['status'] == s for r in results) for s in STATUS}
        print(f"{m['name']} ({m['district']}): {c}")
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(dict(sorted(have.items())), f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
