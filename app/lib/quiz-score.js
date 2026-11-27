// The quiz result for a shared ?s= code, computed on the server for link
// previews. Same rules as public/js/quiz.js (compute, lean): keep the two in step.

export function leanOf(me) {
  if (me === null) return null;
  const a = Math.abs(me);
  if (a < 0.15) return { key: 'center', label: '중도' };
  const side = me < 0 ? '진보' : '보수';
  const strong = a >= 0.45;
  return { key: `${strong ? '' : 'c'}${me < 0 ? 'prog' : 'cons'}`, label: strong ? side : `중도 ${side}` };
}

export function quizResult(D, code) {
  if (!code || code.length !== D.questions.length || !/^[YNS]+$/.test(code)) return null;
  const answers = code.split('');
  const qs = answers.map((a, k) => k).filter((k) => answers[k] === 'Y' || answers[k] === 'N');
  const pos = [];
  for (const k of qs) {
    const side = Object.entries(D.answers).filter(([id, s]) => s[k] === answers[k] && D.members[id] && D.members[id][3] !== null)
      .map(([id]) => D.members[id][3]);
    if (side.length) pos.push(side.reduce((a, b) => a + b, 0) / side.length);
  }
  const me = pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : null;
  const need = Math.min(5, qs.length);
  const people = Object.entries(D.answers).map(([id, s]) => {
    let both = 0, same = 0;
    for (const k of qs) if (s[k] === 'Y' || s[k] === 'N') { both += 1; same += s[k] === answers[k]; }
    return { id, both, same, rate: both ? same / both : 0 };
  }).filter((p) => p.both >= need && D.members[p.id]);
  people.sort((a, b) => b.rate - a.rate || b.both - a.both || (D.members[a.id][0] < D.members[b.id][0] ? -1 : 1));
  const top = people[0];
  return { lean: leanOf(me), top: top ? { name: D.members[top.id][0], rate: top.rate } : null };
}
