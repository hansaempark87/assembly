"""Shared paths, file formats, the Assembly API client and source parsers.

Everything the scores are computed from lives under app/data/source/ as
plain JSON / JSON Lines, already reduced to the fields the site uses:

  meta.json        data date, bill cut-off, fetch time
  members.json     current members (+ former members seen in the records)
  bills.jsonl      의원 발의법률안 (nzmimeepazxkubdpn), one bill per line
  votes.jsonl      본회의 표결 (ncocpgfiaoituanbr + nojepdqqaweusdfbi), one vote per line
  plenary.json     본회의 출결 XLSX, parsed per file
  committee.jsonl  위원회 출결 PDF, one member row per line
  files.json       attendance files used, with sha256

fetch.py updates these from the public sources, build.py turns them into the
records, bill lists and score run the site serves.
"""
import collections, datetime as dt, hashlib, json, os, re, time, urllib.parse, urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
SRC = APP / 'data' / 'source'

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'  # the API rejects requests without a browser UA
API = 'https://open.assembly.go.kr/portal/openapi/'
FILE_LIST = 'https://open.assembly.go.kr/portal/data/file/searchFileData.do'
FILE_GET = 'https://open.assembly.go.kr/portal/data/file/downloadFileData.do'
PLENARY_INF = 'O4Q5B50011905O18367'
COMMITTEE_INF = 'OND4F9001191DA18437'

VOTED = {'찬성': 'Y', '반대': 'N', '기권': 'A'}
STATUSES = ('출석', '결석', '청가', '출장', '결석신고서')
# votes counted in the denominator; hold_tenure_boundary votes fall on a day a
# seat changed hands and are left out for everyone (see /notes)
SCORED_VOTE = {'api_only_pass', 'web_repair_pass', 'hold_count_mismatch'}


# ---------- files ----------

def read_json(name):
    with open(SRC / name, encoding='utf-8') as f:
        return json.load(f)


def write_json(name, data, indent=1):
    path = SRC / name if not isinstance(name, Path) else name
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
        f.write('\n')


def read_jsonl(name):
    with open(SRC / name, encoding='utf-8') as f:
        return [json.loads(line) for line in f if line.strip()]


def write_jsonl(name, rows):
    with open(SRC / name, 'w', encoding='utf-8') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, separators=(',', ':')) + '\n')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def days(a, b):
    return (dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days + 1


# ---------- network ----------

def _get(url, data=None, timeout=90, tries=10):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # connection resets are common on this host
            last = e
            time.sleep(min(30, 3 * (i + 1)))
    raise RuntimeError(f'request failed after {tries} tries: {url.split("?")[0]}: {last}')


def api(service, **params):
    """One page of an Open Assembly API service; returns (total, rows)."""
    key = os.environ.get('ASSEMBLY_API_KEY')
    if not key:
        raise RuntimeError('ASSEMBLY_API_KEY is not set')
    q = urllib.parse.urlencode({'KEY': key, 'Type': 'json', **params})
    body = json.loads(_get(f'{API}{service}?{q}'))
    if service not in body:
        code = body.get('RESULT', {}).get('CODE')
        if code == 'INFO-200':  # no data
            return 0, []
        raise RuntimeError(f'{service}: unexpected response {body.get("RESULT")}')
    head, rows = body[service][0]['head'], body[service][1]['row']
    return head[0]['list_total_count'], rows


def api_all(service, size=1000, **params):
    out, page = [], 1
    while True:
        total, rows = api(service, pIndex=page, pSize=size, **params)
        out += rows
        if len(out) >= total or not rows:
            break
        page += 1
    if len(out) != total:
        raise RuntimeError(f'{service}: got {len(out)} rows, expected {total}')
    return out


def file_list(inf_id):
    body = urllib.parse.urlencode({'infId': inf_id, 'infSeq': 1, 'rows': 1000, 'page': 1}).encode()
    return json.loads(_get(FILE_LIST, data=body))['data']


def file_get(inf_id, seq):
    return _get(f'{FILE_GET}?infId={inf_id}&infSeq=1&fileSeq={seq}', timeout=180)


# ---------- people ----------

class People:
    """Maps the names printed in attendance files to member codes.

    Current members come from members.json; former members (who still appear
    in older files and as co-sponsors) are known by the name the vote API
    gives their code. A name shared by two people is resolved by the hanja
    name the file prints for the newer member (e.g. 朴芝源) and by whether
    the person had taken office by the file's last meeting date.
    """

    def __init__(self, members, former):
        self.members = {m['id']: m for m in members}
        self.by_name = collections.defaultdict(list)
        self.by_hanja = {}
        for m in members:
            self.by_name[m['name']].append(m)
            if m.get('hanja_name'):
                self.by_hanja[m['hanja_name']] = m
        for code, name in former.items():
            self.by_name[name].append({'id': code, 'name': name, 'hanja_name': None, 'term_start': '0000-00-00', 'former': True})

    def plenary(self, name, names_in_file, last_date):
        if name in self.by_hanja and name not in self.by_name:
            return self.by_hanja[name]['id']
        c = [m for m in self.by_name.get(name, [])
             if m['hanja_name'] not in names_in_file and m['term_start'] <= last_date]
        return c[0]['id'] if len(c) == 1 else None

    def committee(self, name, hanja):
        c = self.by_name.get(name, [])
        if len(c) == 1:
            return c[0]['id']  # unique name: the PDFs carry a few hanja typos
        c = [m for m in c if m['hanja_name'] == hanja]
        return c[0]['id'] if len(c) == 1 else None


# ---------- attendance parsers ----------

def _ymd(s):
    d = re.sub(r'\D', '', s)
    return f'{d[:4]}-{d[4:6]}-{d[6:8]}'


def parse_plenary(path):
    """Plenary XLSX: per-date status and the session totals printed per row."""
    import openpyxl
    rows = list(openpyxl.load_workbook(path, read_only=True).worksheets[0].iter_rows(values_only=True))
    cols = [i for i, h in enumerate(rows[3]) if h and re.match(r'\(\d{4}년', str(h))]
    t0 = cols[-1] + 1
    if rows[2][t0] != '회의일수':
        raise ValueError(f'{path}: unexpected layout')
    out = []
    for r in rows[4:]:
        if not r[0] or r[0] == '의원명':
            continue
        out.append({'name': str(r[0]).strip(), 'party': (r[1] or '').strip(),
                    'status': [(r[i] or '').strip() for i in cols],
                    'total': [int(r[t0 + k] or 0) for k in range(6)]})
    return [_ymd(rows[3][i]) for i in cols], out


def parse_committee(path, published):
    """Committee PDF: per-date status and the totals printed per row."""
    import pdfplumber
    py, pm = map(int, published.split('-')[:2])
    out = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            cmt = ((page.extract_text() or '').split('\n') or [''])[0].strip()
            for tb in page.extract_tables():
                dates = None
                for row in tb:
                    cells = [(c or '').strip() for c in row]
                    if any(re.match(r'\d{1,2}월\s*\d{1,2}일', c) for c in cells):
                        dates = []
                        for c in cells[1:]:
                            m = re.match(r'(\d{1,2})월\s*(\d{1,2})일', c)
                            if m:
                                mo, d = int(m.group(1)), int(m.group(2))
                                dates.append(f'{py if mo <= pm else py - 1}-{mo:02d}-{d:02d}')
                            else:
                                dates.append(None)
                        continue
                    m = re.match(r'^(.+?)\((.*)\)$', cells[0])
                    if not m or dates is None or not all(re.fullmatch(r'\d+', x) for x in cells[-6:]):
                        continue
                    daily = [[dates[i] if i < len(dates) else None, s]
                             for i, s in enumerate(cells[1:len(cells) - 6]) if s]
                    out.append({'committee': cmt, 'name': m.group(1), 'hanja': m.group(2),
                                'total': [int(x) for x in cells[-6:]], 'daily': daily})
    return out


def session_of(title):
    m = re.search(r'제\s*(\d+)\s*회', title)
    return int(m.group(1)) if m else None


def month_of(title):
    m = re.search(r'(\d{4})년도?\s*(\d{1,2})월', title)
    return f'{m.group(1)}-{int(m.group(2)):02d}' if m else None


def committee_kind(title):
    return 'special' if '특' in title.split('월', 1)[-1] else 'standing'


# ---------- records from API rows ----------

BILL_FIELDS = ('BILL_ID', 'BILL_NO', 'BILL_NAME', 'COMMITTEE', 'PROPOSE_DT', 'PROC_RESULT', 'PROC_DT', 'RST_MONA_CD', 'PUBL_MONA_CD')


def bill_record(r):
    return {k: r.get(k) for k in BILL_FIELDS}


def vote_record(item, rows, status):
    """item: a row of the vote list API; rows: its per-member rows."""
    out = {'bill_id': item['BILL_ID'], 'bill_no': item['BILL_NO'], 'bill_name': item['BILL_NAME'],
           'date': item['PROC_DT'], 'result': item.get('PROC_RESULT_CD'), 'status': status,
           'totals': {'members': item['MEMBER_TCNT'], 'voted': item['VOTE_TCNT'], 'yes': item['YES_TCNT'],
                      'no': item['NO_TCNT'], 'abstain': item['BLANK_TCNT']}}
    for k in VOTED.values():
        out[k] = []
    for r in rows:
        k = VOTED.get(r['RESULT_VOTE_MOD'])
        if k:
            out[k].append(r['MONA_CD'])
    for k in VOTED.values():
        out[k].sort()
    return out
