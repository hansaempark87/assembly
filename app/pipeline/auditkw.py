"""Topic chips per member from their national-audit questions.

Reads the per-meeting summaries (data/source/audit-summary/*.json, written by
audit.py), gathers each member's question lines, and asks the model for the few
topics they returned to most. Kept in data/source/audit-topics.json with a hash
of the questions used, so a member is asked again only when new questions come in.
AUDIT_TOPICS_MAX caps how many members one run asks. Needs ANTHROPIC_API_KEY.

    python3 auditkw.py
"""
import collections
import datetime as dt
import hashlib
import json
import os

from audit import SUM, ask
from common import SRC

OUT = SRC / 'audit-topics.json'

PROMPT = """아래는 한 국회의원이 국정감사에서 한 질의의 요지 목록이다.
이 의원이 주로 다룬 주제를 3~5개 골라라.

규칙:
- 목록에 여러 번 나오거나 비중이 큰 주제부터 고른다.
- 주제마다 2~10자의 짧은 명사구로 쓴다 (예: 전세사기 피해, 의대 정원, 산업재해, 공공기관 채용).
- 평가나 감정이 담긴 말(비리, 질타, 무능 등)은 쓰지 않는다. 사람 이름과 정당 이름은 쓰지 않는다.

질의 요지:
{items}"""

SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['topics'],
          'properties': {'topics': {'type': 'array', 'items': {'type': 'string'}}}}


def log(msg):
    print(f'{dt.datetime.now().strftime("%H:%M:%S")} {msg}', flush=True)


def main():
    if not os.environ.get('ANTHROPIC_API_KEY'):
        print('ANTHROPIC_API_KEY is not set: audit topics not updated')
        return
    import anthropic
    client = anthropic.Anthropic()
    model = os.environ.get('AUDIT_TOPICS_MODEL', 'claude-haiku-5-5')
    budget = int(os.environ.get('AUDIT_TOPICS_MAX', '400'))
    qs = collections.defaultdict(list)
    for f in sorted(SUM.glob('*.json')):
        for mid, items in json.load(open(f, encoding='utf-8')).get('members', {}).items():
            qs[mid] += [t['q'] for t in items if t.get('q')]
    have = json.load(open(OUT, encoding='utf-8')) if OUT.exists() else {}
    asked = 0
    for mid, lines in sorted(qs.items(), key=lambda kv: -len(kv[1])):
        if len(lines) < 3:
            continue
        sig = hashlib.sha1('\n'.join(lines).encode()).hexdigest()[:12]
        if have.get(mid, {}).get('sig') == sig:
            continue
        if asked >= budget:
            break
        try:
            got = ask(client, model, PROMPT.format(items='\n'.join(f'- {l}' for l in lines[:120])), SCHEMA)
        except RuntimeError as e:
            log(f'stop: {e}')
            break
        topics = [t.strip() for t in (got or {}).get('topics', []) if t.strip() and len(t.strip()) <= 14][:5]
        if topics:
            have[mid] = {'topics': topics, 'n': len(lines), 'sig': sig}
        asked += 1
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(dict(sorted(have.items())), f, ensure_ascii=False, indent=1)
    log(f'audit topics: {asked} members asked, {len(have)} kept')


if __name__ == '__main__':
    main()
