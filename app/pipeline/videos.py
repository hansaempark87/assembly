"""NATV (국회방송) YouTube uploads, for linking audit meetings to their video.

NATV live-streams committee meetings and keeps the recordings on its channel,
titled like "[국회방송 생중계] 행정안전위원회 - 경찰청 등 (25.10.14.)", with
"1부 - " / "2부 - " in front when a long meeting is split. This keeps a local
list of the channel's uploads (data/source/natv-videos.jsonl): every video id,
title and publish time, plus the committee, date and part read from the title.
build.py matches them to audit meetings by committee and date.

Meeting recordings are finished live streams. The uploads playlist (UU...)
holds only the edited clips; the channel's live-stream playlist (UULV...)
holds the recordings, titled like "[국회방송 생중계] 1부 - 2025년 국정감사
법사위 - 대검찰청 (25.10.27.)". Both are read the same way.

The YouTube Data API key is read from YOUTUBE_API_KEY and sent only to the
API. Listing the uploads playlist costs one quota unit per 50 videos; a run
stops at the first video it already has, so a daily run reads one page.

    python3 videos.py
"""
import json
import os
import re
import urllib.parse

from common import SRC, _get, read_jsonl, write_jsonl

CHANNEL = 'UCsWa6xl7KxOolVhROUJ4Ghw'  # NATV 국회방송
UPLOADS = 'UU' + CHANNEL[2:]   # edited clips
STREAMS = 'UULV' + CHANNEL[2:]  # finished live streams: the meeting recordings
API = 'https://www.googleapis.com/youtube/v3/playlistItems'
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


def main():
    key = os.environ.get('YOUTUBE_API_KEY')
    if not key:
        print('YOUTUBE_API_KEY is not set: video list not updated')
        return
    path = SRC / 'natv-videos.jsonl'
    have = read_jsonl('natv-videos.jsonl') if path.exists() else []
    by_id = {v['id']: v for v in have}
    new = []
    for playlist, live in ((UPLOADS, False), (STREAMS, True)):
        # a playlist is read back to the first video already taken from that same playlist
        # (a few recordings are in both lists; meeting one from the other list must not stop the walk)
        seen = {i for i, v in by_id.items() if bool(v.get('live')) == live}
        token, done, read, total = None, False, 0, None
        while not done:
            q = {'part': 'snippet', 'playlistId': playlist, 'maxResults': 50, 'key': key}
            if token:
                q['pageToken'] = token
            page = json.loads(_get(f'{API}?{urllib.parse.urlencode(q)}', tries=4))
            total = page.get('pageInfo', {}).get('totalResults', total)
            for item in page.get('items', []):
                read += 1
                s = item['snippet']
                vid = s['resourceId']['videoId']
                if vid in seen or s['publishedAt'][:10] < SINCE:
                    done = True
                    break
                if vid in by_id:  # known from the other list: just mark it as a recording
                    if live:
                        by_id[vid]['live'] = True
                    continue
                row = {'id': vid, 'title': s['title'], 'published': s['publishedAt']}
                if live:
                    row['live'] = True
                row.update(parse(s['title']) or {})
                new.append(row)
                by_id[vid] = row
            token = page.get('nextPageToken')
            done = done or not token
        print(f"{'live streams' if live else 'uploads'}: {read} read of {total} in the list")
    have = [v for v in by_id.values() if v not in new]
    rows = sorted(new + have, key=lambda v: v['published'], reverse=True)
    write_jsonl('natv-videos.jsonl', rows)
    print(f'NATV videos: {len(new)} new, {len(rows)} kept')


if __name__ == '__main__':
    main()
