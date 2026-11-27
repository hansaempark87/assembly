"""Plain three-line summaries of bills, written by an LLM from the official summary.

The Assembly publishes each bill's official summary (제안이유 및 주요내용,
BPMBILLSUMMARY). This turns it into three short, neutral lines saying what the
bill would change, for readers who will not open the original. Results are kept in
data/source/bill-summary.jsonl, one row per bill, so each bill is summarised once.

Bills are taken in this order: those shown on the bills home page, then passed
bills, then bills reflected in a committee alternative, newest first.
BILL_SUMMARY_MAX caps how many one run summarises, so a daily run has a bounded
cost; BILL_SUMMARY_MODEL picks the model. Needs ASSEMBLY_API_KEY and
ANTHROPIC_API_KEY.

    python3 billsum.py
"""
import datetime as dt
import json
import os

from audit import ask
from common import SRC, api, read_jsonl, write_jsonl

OUT = 'bill-summary.jsonl'
BATCH = 8
TEXT_MAX = 2500  # characters of the official summary sent per bill
PASSED = {'원안가결', '수정가결'}
ALT = {'대안반영폐기', '수정안반영폐기'}

PROMPT = """너는 국회 법안을 시민에게 쉽게 전하는 중립적인 편집자다.
아래는 법안별 공식 요약문(제안이유 및 주요내용)이다. 법안마다 이 법안이 무엇을 바꾸려는지 쉬운 말로 세 줄로 정리하라.

규칙:
- 공식 요약문에 있는 내용만 쓴다. 추측하지 않는다.
- 제안자의 주장, 평가, 정치적 표현(예: 정부의 무책임, 혐오, 시급한 등)은 옮기지 않는다. 법이 바뀌는 내용만 쓴다.
- 1줄: 무엇을 하는 법안인지. 2~3줄: 바뀌는 주요 내용(누가, 무엇을, 어떻게).
- 줄마다 한 문장, 45자 이내. 전문용어는 쉬운 말로 풀고, "~함", "~하도록 함"처럼 끝맺는다.
- 요약문이 비어 있거나 내용을 알 수 없으면 lines를 빈 배열로 둔다.

법안:
{items}"""

SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['bills'], 'properties': {
    'bills': {'type': 'array', 'items': {'type': 'object', 'additionalProperties': False, 'required': ['no', 'lines'],
                                         'properties': {'no': {'type': 'string'},
                                                        'lines': {'type': 'array', 'items': {'type': 'string'}}}}}}}


def log(msg):
    print(f'{dt.datetime.now().strftime("%H:%M:%S")} {msg}', flush=True)


def targets(bills):
    shown = set()
    home = SRC.parent.parent / 'public' / 'law-data' / 'home.json'
    if home.exists():
        h = json.load(open(home, encoding='utf-8'))
        for r in h.get('recent', []) + h.get('popular', []) + [i for t in h.get('topics', []) for i in t['items']]:
            shown.add(r['no'])
    rank = lambda b: (0 if b['BILL_NO'] in shown else 1 if b.get('PROC_RESULT') in PASSED else 2 if b.get('PROC_RESULT') in ALT else 9)
    pick = sorted((b for b in bills if rank(b) < 9), key=lambda b: (b.get('PROC_DT') or b['PROPOSE_DT'], b['BILL_NO']), reverse=True)
    return sorted(pick, key=rank)  # stable: newest first within each group


def official(no):
    try:
        _, rows = api('BPMBILLSUMMARY', BILL_NO=no)
    except RuntimeError as e:
        log(f'skip {no}: {e}')
        return None
    return (rows[0].get('SUMMARY') or '').strip() if rows else ''


def main():
    if not os.environ.get('ANTHROPIC_API_KEY'):
        print('ANTHROPIC_API_KEY is not set: bill summaries not updated')
        return
    import anthropic
    client = anthropic.Anthropic()
    model = os.environ.get('BILL_SUMMARY_MODEL', 'claude-haiku-5-5')
    budget = int(os.environ.get('BILL_SUMMARY_MAX', '200'))
    have = read_jsonl(OUT) if (SRC / OUT).exists() else []
    done = {r['no'] for r in have}
    todo = [b for b in targets(read_jsonl('bills.jsonl')) if b['BILL_NO'] not in done][:budget]
    log(f'bills to summarise: {len(todo)} (already {len(done)})')
    new = []
    for i in range(0, len(todo), BATCH):
        chunk = []
        for b in todo[i:i + BATCH]:
            text = official(b['BILL_NO'])
            if text is None:
                continue
            if not text:
                new.append({'no': b['BILL_NO'], 's': []})  # no official summary yet: keep, so it is not asked again
                continue
            chunk.append((b, text[:TEXT_MAX]))
        if not chunk:
            continue
        items = '\n\n'.join(f"[{b['BILL_NO']}] {b['BILL_NAME']}\n{t}" for b, t in chunk)
        try:
            got = ask(client, model, PROMPT.format(items=items), SCHEMA)
        except RuntimeError as e:
            log(f'stop: {e}')
            break
        by = {r['no']: r['lines'] for r in (got or {}).get('bills', [])}
        for b, _ in chunk:
            lines = [l.strip() for l in by.get(b['BILL_NO'], []) if l.strip()][:3]
            if lines:
                new.append({'no': b['BILL_NO'], 's': lines, 'model': model})
        log(f'summarised {min(i + BATCH, len(todo))}/{len(todo)}')
    write_jsonl(OUT, sorted(have + new, key=lambda r: r['no']))
    log(f'bill summaries: {len(new)} new, {len(have) + len(new)} kept')


if __name__ == '__main__':
    main()
