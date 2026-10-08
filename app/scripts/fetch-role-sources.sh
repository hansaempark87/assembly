#!/bin/bash
# Downloads the public records used by scripts/role-adjust.py into $1 (default: app/tmp/sources).
#   votes/<BILL_ID>.json  — 국회의원 본회의 표결정보(nojepdqqaweusdfbi), one file per bill in the audit CSV
#   att/plenary-*.xlsx, att/standing-*.pdf, att/special-*.pdf — 열린국회정보 출결 파일, verified by sha256
# Requires ASSEMBLY_API_KEY in the environment. The key is never written to disk.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-tmp/sources}
mkdir -p "$OUT/votes" "$OUT/att"
: "${ASSEMBLY_API_KEY:?set ASSEMBLY_API_KEY}"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64)"   # the API rejects requests without a browser UA
AUDIT=../docs/vote-audit-results-2026-10-01.csv
FILES=../docs/attendance-audit-files-2026-10-01.csv

fetch_vote() {
  local id=$1 f="$OUT/votes/$1.json"
  [ -s "$f" ] && return 0
  for i in 1 2 3 4 5 6; do
    if curl -sS -m 60 -A "$UA" "https://open.assembly.go.kr/portal/openapi/nojepdqqaweusdfbi?KEY=$ASSEMBLY_API_KEY&Type=json&AGE=22&BILL_ID=$id&pIndex=1&pSize=400" -o "$f.tmp" 2>/dev/null \
       && [ "$(head -c1 "$f.tmp")" = "{" ]; then mv "$f.tmp" "$f"; return 0; fi
    sleep $((i * 2))
  done
  rm -f "$f.tmp"; echo "failed: $id" >&2
}
export -f fetch_vote; export OUT UA ASSEMBLY_API_KEY
tail -n +2 "$AUDIT" | cut -d, -f2 | xargs -P 6 -I{} bash -c 'fetch_vote {}'

tail -n +2 "$FILES" | tr -d '"' | while IFS=, read -r kind seq _title _pub ext _ _ _ _ _ _ sha; do
  f="$OUT/att/$kind-$seq.$ext"
  [ "$kind" = plenary ] && inf=O4Q5B50011905O18367 || inf=OND4F9001191DA18437
  for i in 1 2 3 4; do
    [ "$(sha256sum "$f" 2>/dev/null | cut -d' ' -f1)" = "$sha" ] && break
    curl -sSL -m 120 -A "$UA" -o "$f" "https://open.assembly.go.kr/portal/data/file/downloadFileData.do?infId=$inf&infSeq=1&fileSeq=$seq" || true
  done
  [ "$(sha256sum "$f" | cut -d' ' -f1)" = "$sha" ] || { echo "hash mismatch: $f" >&2; exit 1; }
done
echo "votes: $(ls "$OUT/votes" | wc -l) files, attendance: $(ls "$OUT/att" | wc -l) files (hash-verified)"
