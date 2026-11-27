"""Opinion polls: Gallup Korea's weekly Daily Opinion (한국갤럽 데일리 오피니언).

Gallup publishes every weekly report free of charge, with the summary as a web
page (gallupdb/reportContent.asp). For each weekly report since the 22nd
Assembly opened this reads the page text and has the model pull out, as data:
the survey facts (period, sample, method, margin of error, response rate), the
presidential job approval, party support, and every policy or social question
with its overall results. Election questions (future leaders, expected election
results) are left out. One file per report in data/source/polls/gallup/, so each
report is read once. POLLS_MAX caps how many new reports one run reads.

    python3 polls.py
"""
import datetime as dt
import html
import json
import os
import re
import time
import urllib.parse
import urllib.request

from audit import ask
from common import SRC, UA

BASE = 'https://www.gallup.co.kr/gallupdb'
OUT = SRC / 'polls' / 'gallup'
SINCE = '2024-05-30'  # the 22nd Assembly's first day
CATEGORIES = ['경제', '부동산·주거', '노동·복지', '외교·안보', '사법·검찰', '정치·국회', '사회·안전', '교육', '환경·에너지', '과학·기술', '기타']

PROMPT = """아래는 한국갤럽 데일리 오피니언 주간 보고서 본문이다. 숫자를 그대로 옮겨 데이터로 정리하라.

규칙:
- 보고서에 있는 숫자만 쓴다. 계산하거나 추측하지 않는다. 없으면 null 또는 빈 배열.
- period_start, period_end: 조사기간 (YYYY-MM-DD).
- president: 대통령 직무 수행 평가의 '잘하고 있다'(approve)와 '잘못하고 있다'(disapprove) 비율. 대통령 이름. 이 질문이 없으면 null.
- parties: 정당 지지도의 전체 결과. 정당마다 하나씩, 무당층은 "무당층"으로. 정당 이름은 보고서 그대로.
- topics: 정책·사회·경제·외교 등 현안 질문마다 하나씩. 전체 응답자 결과만 쓴다.
  - 넣지 않는 것: 대통령 직무 평가, 정당 지지도, 정당 호감도, 장래 정치 지도자 선호도, 선거 결과 기대 등 선거·인물 선호 질문, 응답자 특성표.
  - title: 질문 주제를 짧게, 25자 이내 (예: "조희대 대법원장 탄핵 찬반").
  - question: 실제 질문 문장 요지, 80자 이내.
  - category: {categories} 중 하나.
  - results: 보기별 전체 결과 [{{label, pct}}], 보고서 순서대로. 모름/응답거절·의견 유보도 있으면 넣는다.
  - summary: 결과를 평가 없이 한 문장, 50자 이내 (예: "찬성 35%, 반대 42%로 반대가 많음").

보고서:
{text}"""

NUM = {'type': ['number', 'null']}
SCHEMA = {'type': 'object', 'additionalProperties': False,
          'required': ['period_start', 'period_end', 'sample', 'method', 'margin', 'response_rate', 'president', 'parties', 'topics'],
          'properties': {
              'period_start': {'type': 'string'}, 'period_end': {'type': 'string'}, 'sample': {'type': ['integer', 'null']},
              'method': {'type': 'string'}, 'margin': {'type': 'string'}, 'response_rate': {'type': 'string'},
              'president': {'anyOf': [{'type': 'null'}, {'type': 'object', 'additionalProperties': False, 'required': ['name', 'approve', 'disapprove'],
                                                         'properties': {'name': {'type': 'string'}, 'approve': NUM, 'disapprove': NUM}}]},
              'parties': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['party', 'pct'],
                                                      'properties': {'party': {'type': 'string'}, 'pct': {'type': 'number'}}}},
              'topics': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
                                                     'required': ['title', 'question', 'category', 'results', 'summary'],
                                                     'properties': {'title': {'type': 'string'}, 'question': {'type': 'string'},
                                                                    'category': {'type': 'string', 'enum': CATEGORIES}, 'summary': {'type': 'string'},
                                                                    'results': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
                                                                                'required': ['label', 'pct'], 'properties': {'label': {'type': 'string'}, 'pct': {'type': 'number'}}}}}}}}}


def log(msg):
    print(f'{dt.datetime.now().strftime("%H:%M:%S")} {msg}', flush=True)


def fetch(url, data=None):
    for i in range(4):
        try:
            req = urllib.request.Request(url, data=data, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode('euc-kr', 'ignore')
        except Exception as e:  # connection resets: wait and try again
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f'{url.split("?")[0]}: {last}')


def listing(page):
    data = urllib.parse.urlencode({'pagePos': page, 'search_target': '2', 'searchKeyword': '데일리'.encode('euc-kr'),
                                   'selectYear': '', 'p_menu_1': 'data', 'p_submenu_1': 'data01'}).encode()
    s = fetch(f'{BASE}/report.asp', data)
    rows = re.findall(r'<span class="t01">(\d+)</span>\s*<span class="t02"><a[^>]*>(.*?)</a></span>\s*<span class="t03">([\d/]+)', s, re.S)
    return [{'seq': int(a), 'title': re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', t))).strip(), 'date': d.replace('/', '-')}
            for a, t, d in rows if '데일리' in t]


def report_text(seq):
    s = fetch(f'{BASE}/reportContent.asp?seqNo={seq}')
    s = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', s, flags=re.S)
    t = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s)))
    i = t.find('조사 개요')
    return t[i:] if i >= 0 else t


def main():
    if not os.environ.get('ANTHROPIC_API_KEY'):
        print('ANTHROPIC_API_KEY is not set: polls not updated')
        return
    import anthropic
    client = anthropic.Anthropic()
    model = os.environ.get('POLLS_MODEL', 'claude-haiku-5-5')
    budget = int(os.environ.get('POLLS_MAX', '40'))
    os.makedirs(OUT, exist_ok=True)
    todo, page = [], 1
    while page <= 40:
        rows = listing(page)
        if not rows:
            break
        todo += [r for r in rows if r['date'] >= SINCE and not (OUT / f"{r['seq']}.json").exists()]
        if rows[-1]['date'] < SINCE:
            break
        page += 1
    log(f'new weekly reports: {len(todo)}')
    done = 0
    for r in todo[:budget]:
        text = report_text(r['seq'])
        try:
            got = ask(client, model, PROMPT.format(categories=', '.join(CATEGORIES), text=text[:16000]), SCHEMA)
        except RuntimeError as e:
            log(f'stop: {e}')
            break
        if not got:
            log(f"skip {r['seq']}: no answer")
            continue
        no = re.search(r'제\s*(\d+)\s*호', r['title'])
        out = {'source': '한국갤럽', 'seq': r['seq'], 'no': int(no.group(1)) if no else None, 'title': r['title'], 'posted': r['date'],
               'url': f"{BASE}/reportContent.asp?seqNo={r['seq']}", 'sponsor': '한국갤럽조사연구소 자체 조사', **got}
        with open(OUT / f"{r['seq']}.json", 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
        done += 1
        log(f"{r['date']} {r['title'][:40]}: president {bool(got['president'])}, parties {len(got['parties'])}, topics {len(got['topics'])}")
    log(f'polls read: {done}')


if __name__ == '__main__':
    main()
