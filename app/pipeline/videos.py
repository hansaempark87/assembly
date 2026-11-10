"""NATV (국회방송) YouTube uploads, for linking audit meetings to their video.

NATV live-streams committee meetings and keeps the recordings on its channel,
titled like "[국회방송 생중계] 행정안전위원회 - 경찰청 등 (25.10.14.)", with
"1부 - " / "2부 - " in front when a long meeting is split. This keeps a local
list of the channel's uploads (data/source/natv-videos.jsonl): every video id,
title and publish time, plus the committee, date and part read from the title.
build.py matches them to audit meetings by committee and date.

Meeting recordings are finished live streams, which the uploads playlist does
not list, so they are found with the search API (eventType=completed) over
each audit period: 100 quota units per 50 results. A period is searched once
and again while it is still running or recent (data/source/natv-search.json
remembers when), so a daily run stays far inside the free 10,000 units.

The YouTube Data API key is read from YOUTUBE_API_KEY and sent only to the
API. Listing the uploads playlist costs one quota unit per 50 videos; a run
stops at the first video it already has, so a daily run reads one page.

    python3 videos.py
"""
import datetime as dt
import html
import json
import os
import re
import urllib.parse

from common import SRC, _get, read_jsonl, write_jsonl

CHANNEL = 'UCsWa6xl7KxOolVhROUJ4Ghw'  # NATV 국회방송
UPLOADS = 'UU' + CHANNEL[2:]
API = 'https://www.googleapis.com/youtube/v3/playlistItems'
SEARCH = 'https://www.googleapis.com/youtube/v3/search'
SINCE = '2024-06-01'  # the 22nd Assembly's first audit was in October 2024
TITLE = re.compile(r'^(?:\[[^\]]*\]\s*)?(?:(\d)부\s*-\s*)?(.+?)\s*\((\d{2})\.(\d{1,2})\.(\d{1,2})\.?\)\s*$')


def parse(title):
    """committee, agenda, date and part from a NATV title (None when it does not fit)"""
    m = TITLE.match(title.strip())
    if not m:
        return None
    part, body, yy, mm, dd = m.groups()
    head, _, agenda = body.partition(' - ')
    return {'committee': head.strip(), 'agenda': agenda.strip(), 'date': f'20{yy}-{int(mm):02d}-{int(dd):02d}',
            'part': int(part) if part else None}


def audit_windows():
    """(start, end) of each audit period in the minutes list, padded a few days"""
    lst = json.load(open(SRC / 'audit_list.json', encoding='utf-8'))
    years = {}
    for r in lst:
        years.setdefault(r['date'][:4], []).append(r['date'])
    pad = lambda d, n: (dt.date.fromisoformat(d) + dt.timedelta(days=n)).isoformat()
    return {y: (pad(min(ds), -3), pad(max(ds), 3)) for y, ds in years.items()}


def search_streams(key, start, end):
    """finished live streams of the channel published between start and end"""
    out, token = [], None
    while True:
        q = {'part': 'snippet', 'channelId': CHANNEL, 'eventType': 'completed', 'type': 'video', 'order': 'date',
             'publishedAfter': f'{start}T00:00:00Z', 'publishedBefore': f'{end}T23:59:59Z', 'maxResults': 50, 'key': key}
        if token:
            q['pageToken'] = token
        page = json.loads(_get(f'{SEARCH}?{urllib.parse.urlencode(q)}', tries=4))
        for item in page.get('items', []):
            s = item['snippet']
            row = {'id': item['id']['videoId'], 'title': html.unescape(s['title']), 'published': s['publishedAt'], 'live': True}
            row.update(parse(row['title']) or {})
            out.append(row)
        token = page.get('nextPageToken')
        if not token:
            return out


def main():
    key = os.environ.get('YOUTUBE_API_KEY')
    if not key:
        print('YOUTUBE_API_KEY is not set: video list not updated')
        return
    path = SRC / 'natv-videos.jsonl'
    have = read_jsonl('natv-videos.jsonl') if path.exists() else []
    known = {v['id'] for v in have}
    new, token, done = [], None, False
    while not done:
        q = {'part': 'snippet', 'playlistId': UPLOADS, 'maxResults': 50, 'key': key}
        if token:
            q['pageToken'] = token
        page = json.loads(_get(f'{API}?{urllib.parse.urlencode(q)}', tries=4))
        for item in page.get('items', []):
            s = item['snippet']
            vid = s['resourceId']['videoId']
            if vid in known or s['publishedAt'][:10] < SINCE:
                done = True
                break
            row = {'id': vid, 'title': s['title'], 'published': s['publishedAt']}
            row.update(parse(s['title']) or {})
            new.append(row)
        token = page.get('nextPageToken')
        done = done or not token
    # finished live streams over each audit period not searched since it ended
    spath = SRC / 'natv-search.json'
    searched = json.load(open(spath, encoding='utf-8')) if spath.exists() else {}
    today = dt.date.today().isoformat()
    seen = {v['id'] for v in new + have}
    for year, (start, end) in audit_windows().items():
        last = searched.get(year)
        if last and last > (dt.date.fromisoformat(end) + dt.timedelta(days=7)).isoformat():
            continue  # searched well after the period ended: nothing new to find
        found, a = [], dt.date.fromisoformat(start)
        stop = dt.date.fromisoformat(min(end, today))
        try:
            while a <= stop:  # a week per query: one search returns at most about 500 results
                b = min(a + dt.timedelta(days=6), stop)
                found += [v for v in search_streams(key, a.isoformat(), b.isoformat()) if v['id'] not in seen]
                seen.update(v['id'] for v in found)
                a = b + dt.timedelta(days=1)
        except RuntimeError as e:  # quota or network: keep what was found, search this period again next run
            print(f'{year} audit period: search stopped ({e})')
            new += found
            continue
        new += found
        searched[year] = today
        print(f'{year} audit period {start}..{end}: {len(found)} new recordings')
    with open(spath, 'w', encoding='utf-8') as f:
        json.dump(searched, f, ensure_ascii=False, indent=1)
    rows = sorted(new + have, key=lambda v: v['published'], reverse=True)
    write_jsonl('natv-videos.jsonl', rows)
    print(f'NATV videos: {len(new)} new, {len(rows)} kept')


if __name__ == '__main__':
    main()
