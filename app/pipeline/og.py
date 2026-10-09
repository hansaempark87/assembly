"""Link-preview images (1200x630 PNG) for sharing on KakaoTalk, social media
and messengers, drawn with Pillow from the same data the pages show.

  public/og/site.png          default image (main page and other pages)
  public/og/m/<id>.png        one per member: grade, rank, the four measures
  public/og/v/<BILL_ID>.png   notable votes only (party clash, 20+ no/abstain,
                              rejected): seat chart and totals
  public/og/vote.png          every other vote page

A file is rewritten only when its pixels change, so a weekly update touches
only the images whose numbers moved.
"""
import io, math, os

from PIL import Image, ImageDraw, ImageFont

from common import APP

W, H = 1200, 630
FONTS = APP / 'pipeline' / 'fonts'
BG, SURFACE, BORDER = '#f6f7f9', '#ffffff', '#e5e7eb'
TEXT, TEXT2, TEXT3 = '#111827', '#4b5563', '#6b7280'
ACCENT, TRACK = '#2a78d6', '#e6e9ee'
GRADE = {'S': ('#08313f', '#ffffff'), 'A': ('#0f5c74', '#ffffff'), 'B': ('#1b8aa8', '#ffffff'),
         'C': ('#63bdd3', '#062530'), 'D': ('#bfe6ef', '#0b3a47'), None: ('#e5e7eb', '#4b5563')}
CHOICE = {'Y': ('찬성', '#2a78d6'), 'N': ('반대', '#eb6834'), 'A': ('기권', '#4a3aa7'), 'X': ('불참', '#c9ced6')}
LEFT = ['더불어민주당', '조국혁신당', '진보당', '기본소득당', '사회민주당']
RIGHT = ['개혁신당', '국민의힘']
SITE = 'assembly-korea.com'

_fonts = {}


def font(size, bold=False):
    key = (size, bold)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(str(FONTS / ('Pretendard-Bold.otf' if bold else 'Pretendard-Regular.otf')), size)
    return _fonts[key]


def kdate(iso):
    return iso.replace('-', '.')


def pct(r):
    return '-' if r is None else f'{r * 100:.1f}%'


def top(p):
    if p is None:
        return ''
    t = max(1, math.ceil(100 - p))
    return f'상위 {t}%'


def canvas():
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((40, 40, W - 40, H - 40), radius=28, fill=SURFACE, outline=BORDER, width=2)
    # brand
    d.rounded_rectangle((80, 78, 124, 122), radius=10, fill=ACCENT)
    d.text((102, 100), '국', font=font(26, True), fill='#ffffff', anchor='mm')
    d.text((138, 100), '일하는 국회', font=font(28, True), fill=TEXT, anchor='lm')
    return im, d


def footer(d, text):
    d.text((80, H - 82), text, font=font(22), fill=TEXT3, anchor='lm')
    d.text((W - 80, H - 82), SITE, font=font(22, True), fill=ACCENT, anchor='rm')


def fit(d, text, size, max_w, bold=True):
    while size > 18 and d.textlength(text, font=font(size, bold)) > max_w:
        size -= 2
    return font(size, bold)


def save(im, path):
    """Write only when the image changed; returns True if written."""
    buf = io.BytesIO()
    im.convert('P', palette=Image.ADAPTIVE, colors=64).save(buf, 'PNG', optimize=True)
    data = buf.getvalue()
    if path.exists() and path.read_bytes() == data:
        return False
    os.makedirs(path.parent, exist_ok=True)
    path.write_bytes(data)
    return True


# ---------- member ----------

MEASURES = [('입법 성과', 'legislation_percentile', None), ('표결 참여', 'vote_percentile', 'participation_rate'),
            ('본회의 출석', 'attendance_percentile', 'attendance_rate'), ('위원회 출석', 'committee_attendance_percentile', 'committee_attendance_rate')]
STATUS = {'short_tenure': '관찰 기간 부족', 'role_hold': '겸직으로 평가 유보'}


def member_image(m, s, graded, as_of):
    """m: raw record, s: score entry from the run (scored values applied)."""
    im, d = canvas()
    vals = {**m, **(s.get('correct') or {}), **(s.get('scored') or {})}
    # grade tile
    g = s.get('grade')
    fill, ink = GRADE[g]
    d.rounded_rectangle((W - 330, 150, W - 90, 390), radius=28, fill=fill)
    d.text((W - 210, 255), g or '–', font=font(150, True), fill=ink, anchor='mm')
    d.text((W - 210, 360), f'{g}등급' if g else STATUS.get(s.get('status'), '평가 제외'), font=font(24, True), fill=ink, anchor='mm')
    # who
    # (the font has no hanja, so the hanja name is left out)
    d.text((80, 215), m['name'], font=font(76, True), fill=TEXT, anchor='ls')
    sub = f"{m.get('party') or ''} · {(m.get('district') or '').strip()}"
    d.text((82, 262), sub, font=fit(d, sub, 30, W - 470, False), fill=TEXT2, anchor='ls')
    if s.get('rank'):
        line = f"종합 {s['rank']}위 / {graded}명 · {top(s.get('composite_percentile'))}"
    else:
        line = STATUS.get(s.get('status'), '평가 제외')
    d.text((82, 318), line, font=font(36, True), fill=ACCENT if s.get('rank') else TEXT2, anchor='ls')
    # measures
    y = 352
    for label, pkey, rkey in MEASURES:
        p = s.get(pkey)
        value = top(p) if rkey is None else pct(vals.get(rkey))
        d.text((82, y + 14), label, font=font(24), fill=TEXT2, anchor='lm')
        x0, x1 = 250, 640
        d.rounded_rectangle((x0, y + 6, x1, y + 22), radius=8, fill=TRACK)
        if p is not None:
            d.rounded_rectangle((x0, y + 6, x0 + max(16, (x1 - x0) * p / 100), y + 22), radius=8, fill=ACCENT)
        d.text((x1 + 20, y + 14), value, font=font(24, True), fill=TEXT, anchor='lm')
        y += 44
    footer(d, f'{kdate(as_of)} 기준 · 국회 공식 기록으로 계산')
    return im


# ---------- votes ----------

def party_order(counts):
    mid = sorted((p for p in counts if p not in LEFT and p not in RIGHT), key=lambda p: (p == '무소속', -counts[p]))
    return [p for p in LEFT + mid + RIGHT if counts.get(p)]


def seat_positions(n, rows=None):
    rows = rows or max(4, round(math.sqrt(n / 3)))
    r0 = 0.38
    radii = [r0 + i * (1 - r0) / (rows - 1) for i in range(rows)]
    per = [max(1, round(n * r / sum(radii))) for r in radii]
    diff, i = n - sum(per), rows - 1
    while diff:
        step = 1 if diff > 0 else -1
        per[i] += step
        diff -= step
        i = (i - 1) % rows
    pos = []
    for r, k in zip(radii, per):
        for j in range(k):
            a = math.pi / 2 if k == 1 else math.pi - j * math.pi / (k - 1)
            pos.append((a, r))
    pos.sort(key=lambda p: (-p[0], p[1]))
    return pos, (1 - r0) / (rows - 1) * 0.42


def vote_image(v, as_of):
    im, d = canvas()
    title = v['name']
    f = fit(d, title, 40, W - 160)
    # wrap long titles onto two lines
    lines = [title]
    if d.textlength(title, font=f) > W - 160 or f.size < 30:
        f = font(34, True)
        cut = len(title)
        while cut > 0 and d.textlength(title[:cut], font=f) > W - 160:
            cut -= 1
        lines = [title[:cut], title[cut:]]
        if d.textlength(lines[1], font=f) > W - 160:
            while d.textlength(lines[1] + '…', font=f) > W - 160:
                lines[1] = lines[1][:-1]
            lines[1] += '…'
    y = 175
    for line in lines:
        d.text((80, y), line, font=f, fill=TEXT, anchor='ls')
        y += 46
    d.text((82, y + 2), f"{kdate(v['date'])} 본회의 · {v.get('result') or ''}", font=font(26), fill=TEXT2, anchor='ls')
    # seat chart
    seats = v['seats']
    counts = {}
    for s in seats:
        counts[s[2]] = counts.get(s[2], 0) + 1
    order = party_order(counts)
    rank = {p: i for i, p in enumerate(order)}
    seats = sorted(seats, key=lambda s: (rank.get(s[2], 99), 'YNAX'.index(s[3])))
    pos, dot = seat_positions(len(seats))
    cx, cy, R = 380, 520, 290
    for (a, r), s in zip(pos, seats):
        x, yy = cx + R * r * math.cos(a), cy - R * r * math.sin(a)
        rr = R * dot
        d.ellipse((x - rr, yy - rr, x + rr, yy + rr), fill=CHOICE[s[3]][1])
    # totals
    y = 290
    for k, n in zip('YNAX', v['counts']):
        label, color = CHOICE[k]
        d.rounded_rectangle((760, y - 14, 788, y + 14), radius=7, fill=color)
        d.text((806, y), label, font=font(30), fill=TEXT2, anchor='lm')
        d.text((W - 90, y), f'{n}명', font=font(36, True), fill=TEXT, anchor='rm')
        y += 58
    footer(d, '의원별 찬반은 링크에서 · 국회 공식 기록')
    return im


def site_image(n_members, graded, n_votes, as_of):
    im, d = canvas()
    d.text((80, 250), '국회의원 실적,', font=font(70, True), fill=TEXT, anchor='ls')
    d.text((80, 340), '공식 기록으로 비교합니다', font=font(70, True), fill=ACCENT, anchor='ls')
    d.text((82, 410), f'제22대 국회의원 {n_members}명 · 등급 평가 {graded}명 · 본회의 표결 {n_votes:,}건', font=font(30), fill=TEXT2, anchor='ls')
    d.text((82, 460), '입법 성과 · 표결 참여 · 본회의 출석 · 위원회 출석', font=font(28), fill=TEXT3, anchor='ls')
    footer(d, f'{kdate(as_of)} 기준 · 매주 자동 갱신')
    return im


def generic_vote_image(as_of):
    im, d = canvas()
    d.text((80, 250), '본회의 표결 결과', font=font(70, True), fill=TEXT, anchor='ls')
    d.text((82, 320), '누가 찬성하고 누가 반대했는지 의석 그림으로 봅니다', font=font(32), fill=TEXT2, anchor='ls')
    x = 82
    for k in 'YNAX':
        label, color = CHOICE[k]
        d.rounded_rectangle((x, 390, x + 26, 416), radius=7, fill=color)
        d.text((x + 38, 403), label, font=font(28), fill=TEXT2, anchor='lm')
        x += 150
    footer(d, '국회 공식 기록')
    return im


def build_all(records, run, vote_index, vote_pages_dir, as_of):
    out = APP / 'public' / 'og'
    scores = run['scores']
    graded = sum(1 for s in scores.values() if s.get('grade'))
    written = 0
    written += save(site_image(len(records), graded, len(vote_index), as_of), out / 'site.png')
    written += save(generic_vote_image(as_of), out / 'vote.png')
    keep_m = set()
    for m in records:
        keep_m.add(m['id'])
        written += save(member_image(m, scores.get(m['id'], {}), graded, as_of), out / 'm' / f"{m['id']}.png")
    notable = [v for v in vote_index if v['og']]
    keep_v = set()
    import json
    for v in notable:
        keep_v.add(v['id'])
        path = out / 'v' / f"{v['id']}.png"
        if path.exists():
            continue  # a vote never changes once recorded
        page = json.load(open(vote_pages_dir / f"{v['id']}.json", encoding='utf-8'))
        written += save(vote_image(page, as_of), path)
    for sub, keep in (('m', keep_m), ('v', keep_v)):
        for p in (out / sub).glob('*.png'):
            if p.stem not in keep:
                os.remove(p)
    print(f'og images: {written} written, {len(keep_m)} members, {len(keep_v)} notable votes')
    return keep_v
