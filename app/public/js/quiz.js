(function () {
  const { esc, num, kdate, gradeBadge, partyColor, shareBar } = window.NA;
  const root = document.getElementById('quiz');
  let D = null;
  let answers = []; // 'Y' | 'N' | '?' per question
  let cur = 0;

  const CHO = { Y: '찬성', N: '반대', '?': '잘 모르겠음' };
  const LEFT_LABEL = '진보 성향';
  const RIGHT_LABEL = '보수 성향';

  // ---------- screens ----------
  function intro() {
    root.innerHTML = `<section class="card quiz-card quiz-intro">
      <span class="chip">정치성향 테스트 · 약 3분</span>
      <h1>나와 닮은 국회의원은 누구일까?</h1>
      <p class="lead">제22대 국회에서 <b>여야가 실제로 갈렸던 법안 10개</b>에 직접 찬성·반대해 보세요.
        국회의원 299명의 실제 표결과 비교해 나와 가장 비슷하게 투표한 의원과 정당, 그리고 내 성향의 위치를 보여 드립니다.</p>
      <ul class="quiz-points">
        <li>문항마다 법이 무엇을 바꾸는지와 찬반 양쪽 주장을 같은 분량으로 보여 드립니다.</li>
        <li>판단이 어려우면 "잘 모르겠음"을 고르세요. 결과 계산에서 빠집니다.</li>
        <li>답은 이 기기 안에서만 계산하며 어디에도 저장하거나 보내지 않습니다.</li>
      </ul>
      <button type="button" class="btn btn-primary btn-lg" id="start">시작하기</button>
    </section>`;
    document.getElementById('start').addEventListener('click', () => { answers = []; cur = 0; question(); });
  }

  function question() {
    const q = D.questions[cur];
    const n = D.questions.length;
    root.innerHTML = `<section class="card quiz-card">
      <div class="quiz-progress"><span style="width:${(cur / n) * 100}%"></span></div>
      <div class="quiz-step"><span class="chip">${esc(q.topic)}</span><span class="num">${cur + 1} / ${n}</span></div>
      <h2 class="quiz-q">${esc(q.title)}</h2>
      <p class="quiz-sum"><b>${esc(q.law)}</b> — ${esc(q.summary)}</p>
      <div class="quiz-sides">
        <div class="side pro"><b>찬성 쪽 주장</b><p>${esc(q.pro)}</p></div>
        <div class="side con"><b>반대 쪽 주장</b><p>${esc(q.con)}</p></div>
      </div>
      <div class="quiz-answers">
        <button type="button" class="btn ans ans-y" data-a="Y">찬성</button>
        <button type="button" class="btn ans ans-n" data-a="N">반대</button>
        <button type="button" class="btn ans ans-s" data-a="?">잘 모르겠음</button>
      </div>
      ${cur ? '<button type="button" class="link-btn quiz-back" id="back">← 이전 문항</button>' : ''}
    </section>`;
    root.querySelectorAll('.ans').forEach((b) => b.addEventListener('click', () => {
      answers[cur] = b.dataset.a;
      cur += 1;
      if (cur < n) question(); else finish();
    }));
    document.getElementById('back')?.addEventListener('click', () => { cur -= 1; question(); });
    root.scrollIntoView({ block: 'start' });
  }

  function finish() {
    const code = answers.map((a) => (a === '?' ? 'S' : a)).join('');
    history.replaceState(null, '', `?a=${code}`);
    result();
  }

  // ---------- scoring ----------
  function compute() {
    const qs = D.questions.map((q, k) => k).filter((k) => answers[k] === 'Y' || answers[k] === 'N');
    // my position: mean position of the members who chose what I chose, per question
    const pos = [];
    for (const k of qs) {
      const side = Object.entries(D.answers).filter(([id, s]) => s[k] === answers[k] && D.members[id] && D.members[id][3] !== null)
        .map(([id]) => D.members[id][3]);
      if (side.length) pos.push(side.reduce((a, b) => a + b, 0) / side.length);
    }
    const me = pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : null;
    // members: share of my Y/N answers they matched, among questions they voted Y/N on
    const need = Math.min(5, qs.length);
    const people = Object.entries(D.answers).map(([id, s]) => {
      let both = 0, same = 0;
      for (const k of qs) if (s[k] === 'Y' || s[k] === 'N') { both += 1; same += s[k] === answers[k]; }
      return { id, both, same, rate: both ? same / both : 0 };
    }).filter((p) => p.both >= need && D.members[p.id]);
    people.sort((a, b) => b.rate - a.rate || b.both - a.both || (D.members[a.id][0] < D.members[b.id][0] ? -1 : 1));
    const parties = Object.entries(D.parties).map(([p, v]) => {
      let both = 0, same = 0;
      for (const k of qs) if (v.majority[k] === 'Y' || v.majority[k] === 'N') { both += 1; same += v.majority[k] === answers[k]; }
      return { party: p, pos: v.pos, n: v.n, both, same, rate: both ? same / both : null };
    }).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.n - a.n);
    return { qs, me, people, parties };
  }

  function axis(me, parties) {
    const x = (p) => ((p + 1) / 2) * 100;
    const dots = Object.values(D.members).filter((m) => m[3] !== null)
      .map((m) => `<i class="ax-dot" style="left:${x(m[3]).toFixed(1)}%;background:${partyColor(m[1])}"></i>`).join('');
    // one label per line, ordered left to right, so close parties never overlap
    const marks = [...parties].sort((a, b) => a.pos - b.pos).map((p, k) => `<span class="ax-party" style="left:${x(p.pos).toFixed(1)}%;top:${k * 20}px"><i style="background:${partyColor(p.party)}"></i>${esc(p.party)}</span>`).join('');
    return `<div class="axis">
      <div class="ax-track">${dots}${me !== null ? `<span class="ax-me" style="left:${x(me).toFixed(1)}%"><b>나</b></span>` : ''}</div>
      <div class="ax-parties" style="height:${parties.length * 20 + 4}px">${marks}</div>
      <div class="ax-ends"><span>← ${LEFT_LABEL}</span><span>${RIGHT_LABEL} →</span></div>
    </div>`;
  }

  function lean(me) {
    if (me === null) return '판단할 답이 부족합니다';
    const a = Math.abs(me);
    const side = me < 0 ? '진보' : '보수';
    if (a < 0.15) return '중도';
    if (a < 0.45) return `중도 ${side}`;
    return side;
  }

  function result(shared) {
    const { qs, me, people, parties } = compute();
    const top = people.slice(0, 3);
    const far = people.length ? people[people.length - 1] : null;
    const card = (p) => {
      const m = D.members[p.id];
      return `<a class="match" href="/member?id=${encodeURIComponent(p.id)}">
        <span class="match-rate num">${Math.round(p.rate * 100)}%</span>
        <span class="match-who"><b>${esc(m[0])}</b><small><i class="dot-key" style="background:${partyColor(m[1])}"></i>${esc(m[1])} · ${p.same}/${p.both} 일치</small></span>
        ${gradeBadge(m[2])}
      </a>`;
    };
    const partyRows = parties.filter((p) => p.rate !== null).map((p) => `<div class="pm-row">
      <span class="pm-label"><i class="dot-key" style="background:${partyColor(p.party)}"></i>${esc(p.party)}</span>
      <div class="meter"><div class="meter-fill" style="width:${(p.rate * 100).toFixed(0)}%;background:${partyColor(p.party)}"></div></div>
      <span class="pm-val num">${Math.round(p.rate * 100)}%<small>${p.same}/${p.both} 일치</small></span></div>`).join('');
    const recap = D.questions.map((q, k) => {
      const my = answers[k];
      const big = ['더불어민주당', '국민의힘'].map((p) => {
        const v = D.parties[p];
        const c = v ? v.majority[k] : '.';
        return `<span class="rc-p"><i class="dot-key" style="background:${partyColor(p)}"></i>${p === '더불어민주당' ? '민주' : '국힘'} ${c === 'Y' ? '찬성' : c === 'N' ? '반대' : '-'}</span>`;
      }).join('');
      return `<div class="recap-row">
        <a href="/vote?id=${encodeURIComponent(q.vote)}" class="rc-q">${esc(q.law)}<small>${kdate(q.date)} · ${esc(q.result || '')}</small></a>
        <span class="rc-me ${my === 'Y' ? 'y' : my === 'N' ? 'n' : ''}">나: ${CHO[my]}</span>
        <span class="rc-parties">${big}</span>
      </div>`;
    }).join('');

    root.innerHTML = `${shared ? `<div class="notice quiz-shared">누군가 공유한 결과입니다. <button type="button" class="btn btn-primary btn-sm" id="mine">나도 해보기</button></div>` : ''}
    <section class="card quiz-card quiz-result">
      <span class="chip">결과 · ${qs.length}개 문항 기준</span>
      <h1>나의 표결 성향: <span class="lean">${lean(me)}</span></h1>
      <p class="card-sub">점은 국회의원 한 명, 위치는 실제 표결 패턴으로 계산했습니다.</p>
      ${axis(me, parties)}
      <div class="grid grid-2 section">
        <div><h3 class="wk-h">나와 가장 비슷하게 투표한 의원</h3>${top.map(card).join('') || '<p class="muted">답이 부족합니다.</p>'}
          ${far ? `<h3 class="wk-h section">나와 가장 반대로 투표한 의원</h3>${card(far)}` : ''}</div>
        <div><h3 class="wk-h">정당별 일치율</h3>${partyRows || '<p class="muted">답이 부족합니다.</p>'}</div>
      </div>
      <div class="section"><h3 class="wk-h">문항별로 다시 보기</h3><div class="recap">
        <div class="recap-row recap-head"><span>법안</span><span>나의 선택</span><span>양당 다수의 실제 선택</span></div>${recap}</div></div>
      <div class="quiz-actions section">
        <div id="share"></div>
        <button type="button" class="btn" id="again">다시 하기</button>
      </div>
      <p class="muted quiz-note">계산 방법: 각 의원과 정당(그날 소속 의원 다수의 선택)이 같은 법안에 실제로 찬성·반대한 기록과 비교했습니다. 성향 위치는 여야가 갈린 본회의 표결 123건 전체에서 의원들의 표결 패턴을 한 줄로 요약한 값이며, 왼쪽·오른쪽 이름은 실제 정당 위치를 따랐습니다. 재미로 보는 참고 자료입니다. 기준일 ${kdate(D.as_of)}.</p>
    </section>`;
    shareBar(document.getElementById('share'), { title: '나와 닮은 국회의원 찾기', text: `내 표결 성향은 "${lean(me)}". 나와 가장 비슷한 의원은 ${top[0] ? D.members[top[0].id][0] : '?'} 의원! 너도 해봐` });
    const restart = () => { history.replaceState(null, '', location.pathname); intro(); };
    document.getElementById('again').addEventListener('click', restart);
    document.getElementById('mine')?.addEventListener('click', restart);
    root.scrollIntoView({ block: 'start' });
  }

  fetch('/quiz-data.json').then((r) => r.json()).then((d) => {
    D = d;
    const a = new URLSearchParams(location.search).get('a');
    if (a && a.length === D.questions.length && /^[YNS]+$/.test(a)) {
      answers = a.split('').map((c) => (c === 'S' ? '?' : c));
      result(true);
    } else intro();
  }).catch((e) => { root.innerHTML = `<div class="card error">불러오지 못했습니다: ${esc(e.message)}</div>`; });
})();
