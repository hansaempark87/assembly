"""National audit (국정감사) minutes: schedule and who spoke, from the official records.

The minutes list (VCONFAPIGCONFLIST) carries every audit meeting of the 22nd
Assembly, including upcoming ones whose minutes are not published yet. For each
meeting whose PDF is available this counts, per member, how many times they
spoke and how much (characters), and keeps the audited agencies from the cover
page. Results are cached per meeting under data/source/audit/, so a weekly run
only downloads minutes it has not seen.

    python3 audit.py            # update list + any newly published minutes

With ANTHROPIC_API_KEY set it also writes a neutral summary per meeting
(data/source/audit-summary/<id>.json): for each member, what they asked and
what the answer was, plus a short overview of the day. AUDIT_SUMMARY_MODEL
picks the model and AUDIT_SUMMARY_MAX caps how many meetings one run
summarises (newest first), so a weekly run has a bounded cost.
"""
import datetime as dt
import json
import os
import re
import subprocess
import tempfile
import unicodedata

from common import APP, People, _get, api_all, write_json

SRC = APP / 'data' / 'source'
OUT = SRC / 'audit'
SUM = SRC / 'audit-summary'
ERA = '제22대'
NOT_READY = '등록되지 않았습니다'
VERSION = 2  # 2: text read in content order (pdftotext -raw); 1 interleaved columns


def log(msg):
    print(f'{dt.datetime.now().strftime("%H:%M:%S")} {msg}', flush=True)


def pdf_text(data):
    with tempfile.NamedTemporaryFile(suffix='.pdf') as f:
        f.write(data)
        f.flush()
        return subprocess.run(['pdftotext', '-raw', f.name, '-'], capture_output=True, check=True).stdout.decode('utf-8', 'ignore')


SPEAKER = re.compile(r'^◯(\S+)(?:[ \t]+(\S+))?[ \t]*(.*)$')


def parse(text, people, committee='', date='9999'):
    """Speakers and how much each said; members resolved to their codes."""
    m = re.search(r'^피감사기관[ \t]*(.+)$', text, re.M)
    agencies = re.sub(r'\s+', ' ', m.group(1)).replace('|', ', ').strip(' ·') if m else ''
    members, chair, unknown = {}, {}, set()
    cur, buf = None, []
    talks, owner, label = {}, None, ''  # member -> lines of their questions and the answers they got

    def keep():
        if owner and buf:
            talks.setdefault(owner, []).append(f"{label}: {re.sub(r'\s+', ' ', ' '.join(buf)).strip()}")

    def flush():
        if cur is None:
            return
        kind, who = cur
        n = len(re.sub(r'\s+', '', ' '.join(buf)))
        tgt = members if kind == 'member' else chair if kind == 'chair' else None
        if tgt is not None:
            t = tgt.setdefault(who, [0, 0])
            t[0] += 1
            t[1] += n

    for line in text.splitlines():
        s = SPEAKER.match(line)
        if s:
            flush()
            keep()
            a, b, rest = s.group(1), s.group(2) or '', s.group(3)
            buf = [rest]
            if b == '위원':
                mid = resolve(a, people, committee, date)
                if mid:
                    cur = ('member', mid)
                    owner, label = mid, f'[질의] {a} 위원'
                else:
                    unknown.add(a)
                    cur, owner = None, None
            elif a.startswith('위원장') and b:
                mid = resolve(b, people, committee, date)
                cur = ('chair', mid) if mid else None
                owner = None  # the chair moves on to the next questioner
            else:
                cur = ('other', None)
                label = f'[답변] {a} {b}'.strip()
        elif cur is not None:
            buf.append(line)
    flush()
    keep()
    return agencies, members, chair, sorted(unknown), talks


def resolve(name, people, committee='', date='9999'):
    # PDFs use CJK compatibility ideographs for some hanja (柳 U+F9C9): compare NFKC forms
    hanja = getattr(people, '_nfkc', None)
    if hanja is None:
        hanja = people._nfkc = {unicodedata.normalize('NFKC', k): v for k, v in people.by_hanja.items()}
    key = unicodedata.normalize('NFKC', name)
    if key in hanja and name not in people.by_name:
        return hanja[key]['id']
    c = [m for m in people.by_name.get(name, []) if m['term_start'] <= date]
    if len(c) > 1 and committee:  # same name (박지원 ×2): the one sitting on this committee
        c = [m for m in c if committee in (m.get('committee') or '')]
    return c[0]['id'] if len(c) == 1 else None


# ---------- summaries ----------

MEMBER_PROMPT = """너는 국정감사 회의록을 시민에게 쉽게 전하는 중립적인 편집자다.
아래는 {date} {committee} 국정감사에서 {name} 위원이 한 질의와 그에 대한 답변을 회의록 순서대로 옮긴 것이다.

규칙:
- 회의록에 실제로 있는 내용만 쓴다. 추측, 평가, 감정이 담긴 표현(날카롭게, 질타, 맹공, 무책임 등)은 쓰지 않는다.
- 질의 주제를 중요한 순서로 최대 3개 고른다. 인사말, 회의 진행, 단순 자료 요청은 다른 질의가 없을 때만 적는다.
- question: 위원이 무엇을 지적하거나 물었는지 한 문장, 60자 이내.
- answer: 누가(직함) 무엇이라고 답했는지 한 문장, 60자 이내. 답변이 없으면 "답변 없음", 분명하지 않으면 "명확한 답변 없음".
- 쉬운 말로, "~을 지적함", "~라고 답함"처럼 끝맺는다. 숫자와 기관명은 회의록 그대로 쓴다.

회의록:
{text}"""

OVERVIEW_PROMPT = """아래는 {date} {committee} 국정감사({agencies})에서 위원별로 정리한 질의 요지다.
이날 회의를 시민이 한눈에 이해하도록 정리하라.

규칙:
- 아래 요지에 있는 내용만 쓴다. 평가나 감정 표현, 특정 정당·의원을 부각하는 표현은 쓰지 않는다.
- headline: 이날 가장 많이 다뤄진 내용을 담은 제목, 40자 이내.
- brief: 이날 회의의 핵심을 2문장, 합쳐서 100자 이내로 압축.
- summary: 회의 전체 흐름을 4~6문장으로. 어떤 문제가 제기됐고 기관이 대체로 어떻게 답했는지.
- issues: 주요 쟁점 3~5개, 여러 위원이 다룬 주제부터.
  - title: 쟁점 이름, 25자 이내.
  - detail: 무엇이 문제로 지적됐고 기관이 어떻게 답했는지 2~3문장.

위원별 요지:
{items}"""

TOPICS = {'type': 'object', 'additionalProperties': False, 'required': ['topics'], 'properties': {
    'topics': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False,
                                         'required': ['question', 'answer'],
                                         'properties': {'question': {'type': 'string'}, 'answer': {'type': 'string'}}}}}}
OVERVIEW = {'type': 'object', 'additionalProperties': False, 'required': ['headline', 'brief', 'summary', 'issues'], 'properties': {
    'headline': {'type': 'string'}, 'brief': {'type': 'string'}, 'summary': {'type': 'string'},
    'issues': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['title', 'detail'],
                                          'properties': {'title': {'type': 'string'}, 'detail': {'type': 'string'}}}}}}
CHUNK = 150_000  # characters per request; one member's exchanges rarely pass 30k


def ask(client, model, prompt, schema):
    import anthropic
    try:
        r = client.messages.create(model=model, max_tokens=4000, output_config={'effort': 'low', 'format': {'type': 'json_schema', 'schema': schema}},
                                   messages=[{'role': 'user', 'content': prompt}])
    except anthropic.APIStatusError as e:
        raise RuntimeError(f'summary request failed: {e.status_code} {e.message}') from e
    if r.stop_reason in ('refusal', 'max_tokens'):
        return None
    return json.loads(next(b.text for b in r.content if b.type == 'text'))


def summarize(client, model, r, agencies, talks, names):
    members = {}
    for mid, lines in talks.items():
        text = '\n'.join(lines)
        topics = []
        for i in range(0, len(text), CHUNK):
            got = ask(client, model, MEMBER_PROMPT.format(date=r['date'], committee=r['committee'], name=names.get(mid, ''),
                                                          text=text[i:i + CHUNK]), TOPICS)
            topics += (got or {}).get('topics', [])
        members[mid] = [{'q': t['question'], 'a': t['answer']} for t in topics[:3]]
    items = '\n'.join(f"- {names.get(mid, '')}: " + ' / '.join(f"{t['q']} → {t['a']}" for t in ts) for mid, ts in members.items() if ts)
    overview = ask(client, model, OVERVIEW_PROMPT.format(date=r['date'], committee=r['committee'], agencies=agencies,
                                                         items=items), OVERVIEW) if items else None
    return {'v': 1, 'model': model, 'overview': overview, 'members': members}


def main():
    os.makedirs(OUT, exist_ok=True)
    members = json.load(open(SRC / 'members.json', encoding='utf-8'))
    people = People(members['members'], members.get('former', {}))
    rows = api_all('VCONFAPIGCONFLIST', size=400, ERACO=ERA)
    rows = [r for r in rows if r.get('CONF_KND') == '국정감사 회의록']
    listing = sorted(({'id': r['CONF_ID'], 'date': r['CONF_DT'], 'sess': r['SESS'], 'committee': r['CMIT_NM'],
                       'pdf': r['DOWN_URL']} for r in rows), key=lambda r: (r['date'], r['committee'], r['id']))
    write_json('audit_list.json', listing)
    log(f'audit meetings listed: {len(listing)}')
    today = dt.date.today().isoformat()
    os.makedirs(SUM, exist_ok=True)
    client = None
    if os.environ.get('ANTHROPIC_API_KEY'):
        import anthropic
        client = anthropic.Anthropic()
    model = os.environ.get('AUDIT_SUMMARY_MODEL', 'claude-opus-5-5')
    budget = int(os.environ.get('AUDIT_SUMMARY_MAX', '30'))
    names = {m['id']: m['name'] for m in members['members']}
    names.update(members.get('former', {}))
    got = summed = 0
    for r in sorted(listing, key=lambda r: r['date'], reverse=True):
        path, spath = OUT / f"{r['id']}.json", SUM / f"{r['id']}.json"
        if r['date'] > today:
            continue
        need_parse = not (path.exists() and json.load(open(path, encoding='utf-8')).get('v', 1) >= VERSION)
        need_sum = client is not None and summed < budget and not spath.exists()
        if not need_parse and not need_sum:
            continue
        try:
            data = _get(r['pdf'], tries=4)
        except RuntimeError as e:
            log(f"skip {r['id']}: {e}")
            continue
        if not data.startswith(b'%PDF'):
            if NOT_READY.encode() not in data:
                log(f"skip {r['id']}: not a PDF")
            continue  # minutes not published yet
        agencies, mem, chair, unknown, talks = parse(pdf_text(data), people, r['committee'], r['date'])
        if need_parse:
            if unknown:
                log(f"{r['id']} unresolved speakers: {', '.join(unknown)}")
            with open(path, 'w', encoding='utf-8') as f:
                json.dump({'v': VERSION, 'id': r['id'], 'date': r['date'], 'committee': r['committee'], 'agencies': agencies,
                           'members': mem, 'chair': chair, 'unresolved': unknown}, f, ensure_ascii=False, separators=(',', ':'))
            got += 1
            log(f"{r['date']} {r['committee']}: {len(mem)} members spoke")
        if need_sum:
            try:
                out = summarize(client, model, r, agencies, talks, names)
            except RuntimeError as e:
                log(f'stop summarising: {e}')
                client = None
                continue
            with open(spath, 'w', encoding='utf-8') as f:
                json.dump(out, f, ensure_ascii=False, indent=1)
            summed += 1
            log(f"summarised {r['date']} {r['committee']}")
    log(f'new minutes parsed: {got}, summarised: {summed}')


if __name__ == '__main__':
    main()
