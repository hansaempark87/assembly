#!/usr/bin/env python3
"""Give every script and stylesheet URL in the HTML pages a content hash
(?v=1a2b3c4d), so a changed file gets a new URL and browsers can never run
an old copy, whatever cache time the CDN hands them.

Run after changing anything in public/js or public/css (build.py runs it too).
"""
import hashlib, re

from common import APP

PUBLIC = APP / 'public'


def main():
    changed = 0
    for page in sorted(PUBLIC.glob('*.html')):
        html = page.read_text(encoding='utf-8')

        def stamp(m):
            attr, path = m.group(1), m.group(2)
            digest = hashlib.sha256((PUBLIC / path.lstrip('/')).read_bytes()).hexdigest()[:8]
            return f'{attr}="{path}?v={digest}"'

        new = re.sub(r'(src|href)="(/(?:js|css)/[^"?]+)(?:\?v=[0-9a-f]+)?"', stamp, html)
        if new != html:
            page.write_text(new, encoding='utf-8')
            changed += 1
    print(f'asset stamps: {changed} pages updated')


if __name__ == '__main__':
    main()
