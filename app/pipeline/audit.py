"""National audit (국정감사) minutes: schedule and who spoke, from the official records.

The minutes list (VCONFAPIGCONFLIST) carries every audit meeting of the 22nd
Assembly, including upcoming ones whose minutes are not published yet. For each
meeting whose PDF is available this counts, per member, how many times they
spoke and how much (characters), and keeps the audited agencies from the cover
page. Results are cached per meeting under data/source/audit/, so a weekly run
only downloads minutes it has not seen.

    python3 audit.py            # update list + any newly published minutes
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
ERA = '제22대'
NOT_READY = '등록되지 않았습니다'


def log(msg):
    print(f'{dt.datetime.now().strftime("%H:%M:%S")} {msg}', flush=True)


def pdf_text(data):
    with tempfile.NamedTemporaryFile(suffix='.pdf') as f:
        f.write(data)
        f.flush()
        return subprocess.run(['pdftotext', f.name, '-'], capture_output=True, check=True).stdout.decode('utf-8', 'ignore')


SPEAKER = re.compile(r'^◯(\S+)(?:[ \t]+(\S+))?[ \t]*(.*)$')


def parse(text, people, committee='', date='9999'):
    """Speakers and how much each said; members resolved to their codes."""
    m = re.search(r'피감사기관(.*?)\n\s*일\s*\n', text, re.S)
    agencies = re.sub(r'\s+', ' ', m.group(1)).replace('|', ', ').strip(' ·') if m else ''
    agencies = re.sub(r'\s*·\s*$', '', agencies)
    members, chair, unknown = {}, {}, set()
    cur, buf = None, []

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
            a, b, rest = s.group(1), s.group(2) or '', s.group(3)
            buf = [rest]
            if b == '위원':
                mid = resolve(a, people, committee, date)
                if mid:
                    cur = ('member', mid)
                else:
                    unknown.add(a)
                    cur = None
            elif a.startswith('위원장') and b:
                mid = resolve(b, people, committee, date)
                cur = ('chair', mid) if mid else None
            else:
                cur = ('other', None)
        elif cur is not None:
            buf.append(line)
    flush()
    return agencies, members, chair, sorted(unknown)


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
    got = 0
    for r in listing:
        path = OUT / f"{r['id']}.json"
        if path.exists() or r['date'] > today:
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
        agencies, mem, chair, unknown = parse(pdf_text(data), people, r['committee'], r['date'])
        if unknown:
            log(f"{r['id']} unresolved speakers: {', '.join(unknown)}")
        with open(path, 'w', encoding='utf-8') as f:
            json.dump({'id': r['id'], 'date': r['date'], 'committee': r['committee'], 'agencies': agencies,
                       'members': mem, 'chair': chair, 'unresolved': unknown}, f, ensure_ascii=False, separators=(',', ':'))
        got += 1
        log(f"{r['date']} {r['committee']}: {len(mem)} members spoke")
    log(f'new minutes parsed: {got}')


if __name__ == '__main__':
    main()
