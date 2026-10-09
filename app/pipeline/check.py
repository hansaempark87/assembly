#!/usr/bin/env python3
"""Gate a rebuilt data set against the one currently published (git HEAD).

Sources only ever add records, so no member's counts may go down, coverage
dates may not move back, and the graded population may not shrink sharply.
Any of those means a source changed underneath us and a person should look
before it goes live. Grade changes and large rank moves are listed for the
summary but do not block.

Writes data/build/summary.md (also appended to $GITHUB_STEP_SUMMARY).
Exit status 1 if the update must not be published automatically.
usage: check.py
"""
import json, os, subprocess, sys

from common import APP

MONOTONE = ('tenure_days', 'lead_count', 'lead_passed', 'lead_alternative', 'lead_withdrawn', 'lead_rejected', 'co_lead_count',
            'vote_participated', 'attendance_meetings', 'attendance_present', 'committee_meetings_total', 'committee_present')
MAX_GRADED_DROP = 3
BIG_MOVE = 20
GRADES = 'SABCD'


def load_module(text):
    return json.loads(text[text.index('export default ') + len('export default '):text.rstrip().rindex(';')])


def at_head(rel):
    try:
        return subprocess.run(['git', 'show', f'HEAD:app/{rel}'], cwd=APP, capture_output=True, check=True, text=True).stdout
    except subprocess.CalledProcessError:
        return None


def main():
    hard, warn = [], []
    build = APP / 'data' / 'build'
    report = json.load(open(build / 'report.json', encoding='utf-8')) if (build / 'report.json').exists() else {'hard': [], 'warn': [], 'info': []}
    hard += report['hard']
    warn += report['warn']

    new_rec = {r['id']: r for r in load_module(open(APP / 'lib' / 'member-records.js', encoding='utf-8').read())}
    new_run = load_module(open(APP / 'lib' / 'score-run.js', encoding='utf-8').read())
    old_rec_text, old_run_text = at_head('lib/member-records.js'), at_head('lib/score-run.js')
    old_rec = {r['id']: r for r in load_module(old_rec_text)} if old_rec_text else {}
    old_run = load_module(old_run_text) if old_run_text else None

    if old_rec and set(old_rec) != set(new_rec):
        hard.append(f'의원 구성이 바뀜: +{sorted(set(new_rec) - set(old_rec))} -{sorted(set(old_rec) - set(new_rec))}')
    for i, r in new_rec.items():
        o = old_rec.get(i)
        if not o:
            continue
        o_votes, n_votes = o['vote_eligible'] + o['vote_excluded'], r['vote_eligible'] + r['vote_excluded']
        if n_votes < o_votes:
            hard.append(f'{r["name"]}: 표결 대상 감소 {o_votes} → {n_votes}')
        for k in MONOTONE:
            if (r[k] or 0) < (o[k] or 0):
                hard.append(f'{r["name"]}: {k} 감소 {o[k]} → {r[k]}')

    cov_old = old_run['run']['coverage'] if old_run else {}
    cov_new = new_run['run']['coverage']
    for k, v in cov_new.items():
        if cov_old.get(k) and v < cov_old[k]:
            hard.append(f'수록 기준일 후퇴: {k} {cov_old[k]} → {v}')

    s_new = new_run['scores']
    s_old = old_run['scores'] if old_run else {}
    graded_new = sum(1 for s in s_new.values() if s['grade'])
    graded_old = sum(1 for s in s_old.values() if s['grade'])
    if old_run and graded_new < graded_old - MAX_GRADED_DROP:
        hard.append(f'등급 대상 급감: {graded_old} → {graded_new}명')

    # the API must load and agree with the records
    smoke = subprocess.run(['node', '--input-type=module', '-e', f"""
      const m = await import('{(APP / 'functions' / 'api' / 'members' / 'index.js').as_posix()}');
      const r = await (await m.onRequestGet({{}})).json();
      if (r.count !== {len(new_rec)}) throw new Error('count ' + r.count);
      if (r.members.filter((x) => x.grade).length !== {graded_new}) throw new Error('graded');
      console.log('api ok', r.count);
    """], capture_output=True, text=True)
    if smoke.returncode:
        hard.append(f'API 점검 실패: {smoke.stderr.strip()[-300:]}')

    changes, moves = [], []
    for i, s in s_new.items():
        o = s_old.get(i)
        if not o:
            continue
        name = new_rec[i]['name']
        if o['grade'] != s['grade']:
            changes.append(f'{name} {o["grade"] or "-"}→{s["grade"] or "-"}')
        if o['rank'] and s['rank'] and abs(o['rank'] - s['rank']) >= BIG_MOVE:
            moves.append(f'{name} {o["rank"]}→{s["rank"]}위')

    lines = ['## 주간 데이터 갱신', '',
             f'- 기준일: {old_run["run"]["data_as_of"] if old_run else "-"} → **{new_run["run"]["data_as_of"]}**',
             '- 수록 범위: ' + ', '.join(f'{k} {cov_old.get(k, "-")} → {v}' for k, v in cov_new.items()),
             f'- 등급 대상: {graded_old} → {graded_new}명',
             f'- 등급 변경 {len(changes)}명' + (': ' + ', '.join(changes[:40]) if changes else ''),
             f'- 순위 {BIG_MOVE}계단 이상 이동 {len(moves)}명' + (': ' + ', '.join(moves[:40]) if moves else '')]
    lines += ['', '### 수집 내역'] + [f'- {x}' for x in report['info']]
    if warn:
        lines += ['', '### 규칙에 따라 자동 처리한 항목'] + [f'- {x}' for x in warn[:100]]
    if hard:
        lines += ['', '### ⛔ 자동 반영 중단 — 확인 필요'] + [f'- {x}' for x in hard[:100]]
    else:
        lines += ['', '모든 검증 통과 — 자동 반영 대상입니다.']
    text = '\n'.join(lines) + '\n'
    os.makedirs(build, exist_ok=True)
    open(build / 'summary.md', 'w', encoding='utf-8').write(text)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8').write(text)
    print(text)
    return 1 if hard else 0


if __name__ == '__main__':
    sys.exit(main())
