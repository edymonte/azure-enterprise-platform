// Platform Academy — browser client. Renders the state pushed by the local
// server over Server-Sent Events. All dynamic text goes through textContent.
(() => {
  const TOKEN = document.querySelector('meta[name="portal-token"]').content;
  const $ = (sel) => document.querySelector(sel);
  const view = $('#view');

  let state = null;
  let lastJson = '';
  const openEvidence = new Set();
  const assessDraft = {};

  // ------------------------------------------------------------ helpers
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function rel(iso) {
    if (!iso) return '—';
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < -5) return `in ${fmtDur(-s)}`;
    if (s < 10) return 'just now';
    return `${fmtDur(s)} ago`;
  }
  function fmtDur(s) {
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)} min`;
    if (s < 86400) return `${Math.round(s / 3600)} h`;
    return `${Math.round(s / 86400)} d`;
  }
  const abs = (iso) => (iso ? new Date(iso).toLocaleString() : '—');
  const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

  function toast(msg, kind = 'error') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast ${kind === 'info' ? 'info' : ''}`;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.add('hidden'), 5000);
  }

  async function post(path, body = {}) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Portal-Token': TOKEN },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }
  const act = (id, action, body) => post(`/api/sessions/${id}/${action}`, body).catch((e) => toast(e.message));

  const STATE_LABEL = {
    AVAILABLE: 'Available', IN_PROGRESS: 'In progress', CHECKING: 'Checking…', BLOCKED: 'Blocked', FAILED: 'Not yet', COMPLETED: 'Completed',
  };
  const STATE_ICON = { AVAILABLE: '▶', IN_PROGRESS: '…', CHECKING: '↻', BLOCKED: '🔒', FAILED: '✕', COMPLETED: '✓' };
  const REASON_LABEL = {
    locked: 'Locked', platform_stopped: 'Platform stopped', missing_prerequisite: 'Missing prerequisite', auth_error: 'Authentication', validation_error: 'Checker error',
  };
  const isLocked = (s) => s.state === 'BLOCKED' && s.reason === 'locked';
  const stateText = (s) => (s.state === 'BLOCKED' ? `Blocked · ${REASON_LABEL[s.reason] ?? s.reason}` : STATE_LABEL[s.state]);
  const cycleOf = (id) => state.track.cycles.find((c) => c.id === id);

  function checkerChip(s) {
    if (s.checker.status !== 'implemented') return h('span', { class: 'chip warn', title: s.validation.notes }, 'Checker planned');
    if (s.validation.status === 'validated') return h('span', { class: 'chip ok', title: s.validation.notes }, 'Auto-validated ✓');
    return h('span', { class: 'chip info', title: s.validation.notes }, 'Auto-validated · live pass pending');
  }

  // ------------------------------------------------------------ chrome
  function renderChrome() {
    const t = state.totals;
    $('#rank-title').textContent = t.rank.title;
    $('#side-rank').textContent = t.rank.title;
    const nextXp = t.nextRank ? t.nextRank.minXp : t.xp;
    const floor = t.rank.minXp;
    const pct = t.nextRank ? ((t.xp - floor) / (nextXp - floor)) * 100 : 100;
    $('#xp-fill').style.width = `${Math.max(2, Math.min(100, pct))}%`;
    $('#xp-num').textContent = t.nextRank ? `${t.xp} / ${nextXp} XP → ${t.nextRank.title}` : `${t.xp} XP · max rank`;
    $('#coins').textContent = t.coins;
    $('#badge-count').textContent = t.badges.length;
    $('#validation-banner').classList.toggle('hidden', !state.meta.validationMode);

    const env = state.environment;
    const pills = $('#env-pills');
    pills.replaceChildren();
    const az = env.azure;
    const azKind = az.status === 'signed_in' ? (az.expectedSubscription === false ? 'bad' : 'ok') : az.status === 'unknown' ? '' : 'bad';
    const azText = az.status === 'signed_in' ? (az.expectedSubscription === false ? 'Azure: wrong subscription' : 'Azure: signed in') : `Azure: ${az.status.replace('_', ' ')}`;
    pills.append(h('span', { class: `pill ${azKind}`, title: az.user ?? az.detail ?? '' }, azText));
    const aks = env.aks;
    const aksKind = aks.status === 'running' ? 'ok' : aks.status === 'stopped' ? 'warn' : aks.status === 'not_deployed' ? '' : aks.status === 'unknown' ? '' : 'bad';
    pills.append(h('span', { class: `pill ${aksKind}` }, `AKS: ${aks.status.replace('_', ' ')}`));
    pills.append(h('span', { class: 'pill', title: abs(env.at) }, `probed ${rel(env.at)}`));

    for (const a of document.querySelectorAll('.nav-item')) a.classList.toggle('active', a.dataset.view === route().view);
  }

  // ------------------------------------------------------------ practice
  function sessionButton(s) {
    if (isLocked(s)) return h('button', { class: 'btn btn-ghost', disabled: true }, '🔒 Locked');
    if (s.state === 'AVAILABLE') return h('button', { class: 'btn btn-primary', onclick: (e) => { e.stopPropagation(); openLaunch(s.id, 'start'); } }, 'Start');
    if (s.state === 'COMPLETED') return h('button', { class: 'btn', onclick: (e) => { e.stopPropagation(); location.hash = `#/session/${s.id}`; } }, '✎ Revise');
    return h('button', { class: 'btn btn-warn', onclick: (e) => { e.stopPropagation(); openLaunch(s.id, 'resume'); } }, 'Continue');
  }

  function renderPractice() {
    const ss = state.sessions;
    const done = ss.filter((s) => s.state === 'COMPLETED').length;
    const pending = ss.filter((s) => ['IN_PROGRESS', 'FAILED', 'CHECKING'].includes(s.state) || (s.state === 'BLOCKED' && s.reason !== 'locked')).length;
    const unlocked = ss.filter((s) => s.state === 'AVAILABLE').length;
    const locked = ss.filter(isLocked).length;
    const nextId = state.next.sessionId;

    const next = h('section', { class: 'card next-card' },
      h('div', {}, h('div', { class: 'next-label' }, 'Next step'), h('div', { class: 'next-text' }, state.next.text)),
      nextId ? h('button', { class: 'btn btn-primary', onclick: () => { location.hash = `#/session/${nextId}`; } }, 'Open session →') : null);

    const fill = h('div', { class: 'progress-fill' });
    const wrap = h('div', { class: 'progress-wrap' }, h('div', { class: 'progress-track' }, fill));
    let acc = 0;
    for (const c of state.track.cycles) {
      acc += ss.filter((s) => s.cycle === c.id).length;
      const earned = state.totals.badges.some((b) => b.id === `cycle-${c.id}`);
      const m = h('div', { class: `milestone ${earned ? 'done' : ''}`, title: `${c.badge} — ${c.title}` }, earned ? '✦' : '◇', h('span', { class: 'milestone-label' }, `Session ${acc}`));
      m.style.left = `${(acc / ss.length) * 100}%`;
      wrap.append(m);
    }
    requestAnimationFrame(() => { fill.style.width = `${(done / ss.length) * 100}%`; });

    const track = h('section', { class: 'card' },
      h('div', { class: 'track-head' },
        h('div', { class: 'track-logo' }, h('div', {}, h('b', {}, '30'), 'Sessions', h('br'), h('span', {}, 'AZURE'))),
        h('div', {}, h('h1', { class: 'track-title' }, state.meta.title), h('div', { class: 'muted' }, state.meta.subtitle))),
      h('div', { class: 'progress-caption' }, `Progress: ${done}/${ss.length} sessions`),
      wrap,
      h('div', { class: 'stats' },
        h('div', { class: 'stat ok' }, h('b', {}, done), h('span', {}, 'Completed')),
        h('div', { class: 'stat warn' }, h('b', {}, pending), h('span', {}, 'In progress')),
        h('div', { class: 'stat info' }, h('b', {}, unlocked), h('span', {}, 'Unlocked')),
        h('div', { class: 'stat lock' }, h('b', {}, locked), h('span', {}, 'Locked'))));

    const list = h('section', { class: 'card' });
    for (const c of state.track.cycles) {
      const earned = state.totals.badges.some((b) => b.id === `cycle-${c.id}`);
      list.append(h('div', { class: 'cycle-head' }, h('h3', {}, `Cycle ${c.id} · ${c.title}`), h('span', { class: `cycle-badge ${earned ? 'done' : ''}` }, `✦ ${c.badge}`)));
      for (const s of ss.filter((x) => x.cycle === c.id)) {
        list.append(h('div', {
          class: `session-row ${s.id === nextId ? 'current' : ''} ${s.state === 'COMPLETED' ? 'completed' : ''} ${isLocked(s) ? 'locked' : ''}`,
          onclick: () => { location.hash = `#/session/${s.id}`; },
        },
        h('div', { class: 'row-num' }, s.number),
        h('div', {},
          h('div', { class: 'row-title' }, `Session ${s.number}: ${s.title}`),
          h('div', { class: 'row-meta' }, h('span', { class: 'chip' }, s.topic), h('span', { class: 'chip' }, `${s.timeMinutes} min`), h('span', { class: 'chip' }, `+${s.xp} XP`), checkerChip(s))),
        h('div', { class: 'row-date' }, s.completedAt ? day(s.completedAt) : s.state === 'BLOCKED' && !isLocked(s) ? REASON_LABEL[s.reason] : ''),
        h('div', { class: `state-dot ${s.state}`, title: stateText(s) }, STATE_ICON[s.state]),
        sessionButton(s)));
      }
    }
    view.replaceChildren(next, track, list);
  }

  // ------------------------------------------------------------ map
  function renderMap() {
    const grid = h('div', { class: 'map-grid' });
    for (const c of state.track.cycles) {
      const col = h('div', { class: 'card map-col' }, h('h3', {}, `Cycle ${c.id}`), h('p', { class: 'muted small' }, `${c.title} — ${c.summary}`));
      for (const s of state.sessions.filter((x) => x.cycle === c.id)) {
        col.append(h('div', { class: `map-node ${s.state} ${isLocked(s) ? 'locked' : ''} ${s.id === state.next.sessionId ? 'current' : ''}`, onclick: () => { location.hash = `#/session/${s.id}`; } },
          h('div', { class: 'n' }, s.state === 'COMPLETED' ? '✓' : s.number),
          h('div', {}, h('div', { class: 't' }, s.title), h('div', { class: 'muted small' }, `${s.topic} · ${stateText(s)}`))));
      }
      grid.append(col);
    }
    view.replaceChildren(h('section', { class: 'card' }, h('h2', {}, 'Curriculum map'), h('p', { class: 'muted' }, 'Every session of the route. Progress unlocks one session at a time, only from verified criteria.')), grid);
  }

  // ------------------------------------------------------------ session
  function stepsList(s) {
    const key = `steps:${s.id}`;
    let done = {};
    try { done = JSON.parse(localStorage.getItem(key) || '{}'); } catch { done = {}; }
    const ol = h('ol', { class: 'steps' });
    s.steps.forEach((st, i) => {
      const li = h('li', { class: done[i] ? 'done' : '' },
        h('div', { class: 'step-title' }, st.title, h('span', {
          class: 'step-toggle',
          onclick: () => {
            done[i] = !done[i];
            try { localStorage.setItem(key, JSON.stringify(done)); } catch { /* storage unavailable */ }
            li.classList.toggle('done', Boolean(done[i]));
          },
        }, 'mark ✓')),
        h('div', { class: 'muted' }, st.detail),
        st.command ? h('div', { class: 'cmd' }, h('code', {}, st.command),
          state.meta.terminal.enabled ? h('button', { class: 'btn copy', title: 'Paste into the terminal (you still press Enter)', onclick: () => sendToTerminal(st.command) }, '▶ Terminal') : null,
          h('button', {
            class: 'btn copy',
            onclick: () => navigator.clipboard.writeText(st.command).then(() => toast('Command copied.', 'info')),
          }, 'Copy')) : null);
      ol.append(li);
    });
    return ol;
  }

  function hintsCard(s) {
    const card = h('section', { class: 'card' }, h('h3', {}, 'Hints'));
    if (!s.startedAt) return card.append(h('p', { class: 'muted' }, 'Start the session to unlock graduated hints.')), card;
    for (const hint of s.hintsRevealed) card.append(h('div', { class: 'hint' }, h('b', {}, `Hint ${hint.level}: `), hint.text));
    if (s.hintsRevealed.length < s.hintsTotal) {
      const n = s.hintsRevealed.length + 1;
      card.append(h('button', { class: 'btn btn-warn', onclick: () => act(s.id, 'hint') }, `Reveal hint ${n} of ${s.hintsTotal}`),
        h('p', { class: 'muted small' }, s.completedAt ? 'After completion hints are free.' : 'Each hint before completion marks the attempt AI-assisted and costs 2 coins. Try your hypothesis first.'));
    } else card.append(h('p', { class: 'muted small' }, 'All hints revealed.'));
    if (!s.completedAt) {
      const cb = h('input', { type: 'checkbox', onchange: (e) => act(s.id, 'assisted', { value: e.target.checked }) });
      cb.checked = s.aiAssisted;
      card.append(h('label', { class: 'toggle' }, cb, 'I used AI help on this session (records the attempt as AI-assisted)'));
    }
    return card;
  }

  function envCard(s) {
    const env = state.environment;
    const need = s.prerequisites.platform;
    const rows = need.map((p) => {
      let ok = true;
      let txt = 'ready';
      if (p === 'offline') txt = 'works with the platform stopped';
      if (p === 'azure' || p === 'aks') { ok = env.azure.status === 'signed_in' && env.azure.expectedSubscription !== false; txt = ok ? `signed in (${env.azure.subscriptionName ?? ''})` : env.azure.status; }
      if (p === 'aks') { ok = ok && env.aks.status === 'running'; txt = env.aks.status; }
      if (p === 'github') { ok = env.tools.gh?.installed !== false; txt = ok ? 'gh available' : 'gh missing'; }
      if (p === 'azure-devops') txt = 'organization required (checked manually)';
      return [p, h('span', { class: `chip ${ok ? 'ok' : 'bad'}` }, txt)];
    });
    return h('section', { class: 'card' }, h('h3', {}, 'Prerequisites & environment'),
      h('dl', { class: 'kv' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]),
        h('dt', {}, 'layers'), h('dd', {}, s.prerequisites.layers.length ? s.prerequisites.layers.join(', ') : 'none'),
        h('dt', {}, 'cost'), h('dd', {}, s.cost)),
      s.prerequisites.notes ? h('p', { class: 'muted small' }, s.prerequisites.notes) : null);
  }

  function checkerCard(s) {
    const v = s.validation;
    return h('section', { class: 'card' }, h('h3', {}, 'Automatic validation'),
      h('div', { class: 'badges-row' }, h('span', { class: 'chip ok' }, 'Content ready'), checkerChip(s),
        h('span', { class: `chip ${v.status === 'validated' ? 'ok' : v.status === 'partial' ? 'info' : 'warn'}` }, `Validation: ${v.status}`)),
      h('p', { class: 'muted small' }, v.notes),
      s.checker.plan ? h('p', { class: 'small' }, h('b', {}, 'Planned checks: '), s.checker.plan) : null);
  }

  function completionCards(s) {
    if (!s.completedAt) return [];
    const c = s.completion;
    const a = s.assessment;
    const draft = assessDraft[s.id] ?? { english: a?.english ?? null, autonomy: a?.autonomy ?? null, tradeoffs: a?.tradeoffs ?? null, notes: a?.notes ?? '' };
    assessDraft[s.id] = draft;
    const seg = (key) => {
      const wrap = h('div', { class: 'seg' });
      for (const v of [0, 1, 2]) {
        wrap.append(h('button', { class: draft[key] === v ? 'on' : '', onclick: () => { draft[key] = v; render(true); } }, v));
      }
      return wrap;
    };
    const notes = h('textarea', { placeholder: 'Your 2-minute English narration notes, what you would do differently…', oninput: (e) => { draft.notes = e.target.value; } });
    notes.value = draft.notes;
    const complete = ['english', 'autonomy', 'tradeoffs'].every((k) => Number.isInteger(draft[k]));
    const score = a ? 2 + a.english + a.autonomy + a.tradeoffs : null;
    return [
      h('section', { class: 'card status-card COMPLETED' }, h('h3', {}, 'Completed'),
        h('dl', { class: 'kv' },
          h('dt', {}, 'when'), h('dd', {}, abs(c.at)),
          h('dt', {}, 'mode'), h('dd', {}, h('span', { class: `chip ${c.mode === 'SOLO' ? 'ok' : 'info'}` }, c.mode === 'SOLO' ? 'SOLO' : 'AI-assisted')),
          h('dt', {}, 'hints'), h('dd', {}, c.hintsUsed),
          h('dt', {}, 'rewards'), h('dd', {}, `+${c.rewards.xp} XP · +${c.rewards.coins} coins`),
          h('dt', {}, 'revision'), h('dd', {}, `${c.revision?.branch ?? '?'} @ ${c.revision?.commit ?? '?'}`),
          c.validationMode ? h('dt', {}, 'note') : null, c.validationMode ? h('dd', {}, 'completed in validation mode') : null)),
      h('section', { class: 'card' }, h('h3', {}, 'Debrief'), h('p', {}, s.debrief)),
      h('section', { class: 'card' }, h('h3', {}, 'Self-assessment (separate from the automatic check)'),
        h('div', { class: 'assess' },
          h('div', { class: 'assess-row' }, h('span', {}, 'Technical correctness (automatic)'), h('b', {}, '2')),
          h('div', { class: 'assess-row' }, h('span', {}, 'English clarity'), seg('english')),
          h('div', { class: 'assess-row' }, h('span', {}, 'Autonomy / reasoning'), seg('autonomy')),
          h('div', { class: 'assess-row' }, h('span', {}, 'Trade-offs'), seg('tradeoffs')),
          notes,
          h('div', { class: 'assess-row' },
            score !== null ? h('span', { class: 'score' }, `${score}/10`) : h('span', { class: 'muted' }, 'Investigation is scored by your mentor; 8/10 in two scenarios is the readiness signal.'),
            h('button', { class: 'btn btn-primary', disabled: !complete, onclick: () => act(s.id, 'assessment', draft).then(() => toast('Self-assessment saved.', 'info')) }, 'Save')))),
    ];
  }

  // ------------------------------------------------------------ workspace
  // KodeKloud-style lab view: task panel (left, with time box, Check and Try
  // later) and a terminal-looking *evidence console* (right). The console only
  // displays checker runs — it never executes anything.
  const ui = { tab: {}, expanded: false, rightTab: null };
  const CRIT_MARK = { pass: ['✓', 'con-pass'], fail: ['✕', 'con-fail'], skipped: ['–', 'con-skip'] };
  const OUTCOME_CLASS = { pass: 'con-pass', fail: 'con-fail', blocked: 'con-skip', error: 'con-warn', cancelled: 'con-dim' };

  function timeboxStart(s) {
    const key = `timebox:${s.id}`;
    let t = null;
    try { t = Number(localStorage.getItem(key)) || null; } catch { /* storage unavailable */ }
    if (!t) {
      t = Date.now();
      try { localStorage.setItem(key, String(t)); } catch { /* storage unavailable */ }
    }
    return t;
  }
  function resetTimebox(s) {
    try { localStorage.removeItem(`timebox:${s.id}`); } catch { /* storage unavailable */ }
  }
  function tickTimer() {
    const el = document.getElementById('ws-timer');
    if (!el) return;
    const s = state.sessions.find((x) => x.id === el.dataset.id);
    if (!s) return;
    if (s.completedAt) { el.textContent = '⏱ done'; el.classList.remove('over'); return; }
    const left = s.timeMinutes * 60 - Math.floor((Date.now() - timeboxStart(s)) / 1000);
    const abs = Math.abs(left);
    const mmss = `${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
    el.textContent = left >= 0 ? `⏱ ${mmss}` : `⏱ +${mmss}`;
    el.title = left >= 0 ? `Time box: ${s.timeMinutes} min` : 'Over the time box — write your hypothesis down, or ask for a hint';
    el.classList.toggle('over', left < 0);
  }
  setInterval(tickTimer, 1000);

  // Inline `code` in learn texts; everything else stays plain text.
  function richText(text) {
    return text.split(/(`[^`]+`)/).map((part) => (/^`[^`]+`$/.test(part) ? h('code', {}, part.slice(1, -1)) : part));
  }

  function learnBody(s) {
    const L = s.learn;
    const out = [
      h('div', { class: 'learn-banner' }, h('b', {}, 'Learn first. '), 'New to this topic? Read this before the task. Reading it is free — it does not count as a hint.'),
      h('h2', {}, `Concepts behind “${s.title}”`),
    ];
    for (const c of L.concepts) {
      out.push(h('div', { class: 'section-title' }, c.title));
      for (const para of c.body.split('\n\n')) out.push(h('p', {}, ...richText(para)));
      if (c.code) out.push(h('pre', { class: 'learn-code' }, c.code));
    }
    out.push(h('div', { class: 'section-title' }, `Worked example — ${L.example.title}`));
    for (const para of L.example.body.split('\n\n')) out.push(h('p', {}, ...richText(para)));
    if (L.example.code) out.push(h('pre', { class: 'learn-code' }, L.example.code));
    out.push(h('p', { class: 'muted small' }, 'The example is deliberately a different case from your task: apply the idea, do not copy it.'));
    out.push(h('div', { class: 'section-title' }, 'Glossary'));
    out.push(h('dl', { class: 'kv glossary' }, ...L.glossary.flatMap((g) => [h('dt', {}, g.term), h('dd', {}, ...richText(g.def))])));
    out.push(h('button', { class: 'btn btn-primary', onclick: () => { ui.tab[s.id] = 'task'; render(true); } }, 'Go to the task →'));
    return out;
  }

  function taskBody(s) {
    const tab = ui.tab[s.id] ?? (s.lastObservation ? 'task' : 'learn');
    if (tab === 'learn') return learnBody(s);
    if (tab === 'hints') return [hintsCard(s), envCard(s), checkerCard(s)];
    if (tab === 'result') return s.completedAt ? completionCards(s) : [h('p', { class: 'muted' }, 'The debrief and the self-assessment open after the technical validation passes.')];
    const cyc = cycleOf(s.cycle);
    return [
      h('div', { class: 's-head' }, h('div', { class: 's-num' }, s.number), h('div', {},
        h('h2', {}, s.title),
        h('div', { class: 'row-meta' }, h('span', { class: 'chip' }, `Cycle ${s.cycle} · ${cyc.title}`), h('span', { class: 'chip' }, s.topic),
          h('span', { class: 'chip' }, `Difficulty ${'●'.repeat(s.difficulty)}${'○'.repeat(3 - s.difficulty)}`), h('span', { class: 'chip' }, `+${s.xp} XP`)))),
      h('div', { class: 'section-title' }, 'Scenario'), h('blockquote', { class: 'scenario' }, s.scenario),
      h('div', { class: 'section-title' }, 'Mission'), h('p', {}, s.mission),
      h('div', { class: 'section-title' }, 'Objectives'), h('ul', { class: 'list' }, s.objectives.map((o) => h('li', {}, o))),
      h('div', { class: 'section-title' }, 'Success criteria'), h('ul', { class: 'list' }, s.criteria.map((c) => h('li', {}, c.text))),
      h('div', { class: 'section-title' }, 'Steps'), stepsList(s),
      h('div', { class: 'section-title' }, 'Expected result'), h('p', {}, s.expectedResult),
      h('div', { class: 'section-title' }, 'Notes'),
      h('ul', { class: 'list' },
        h('li', {}, h('b', {}, 'Prerequisites: '), `${s.prerequisites.platform.join(', ')}${s.prerequisites.layers.length ? ` · layers ${s.prerequisites.layers.join(', ')}` : ''}${s.prerequisites.notes ? ` — ${s.prerequisites.notes}` : ''}`),
        h('li', {}, h('b', {}, 'Cost: '), s.cost),
        h('li', {}, h('b', {}, 'If something goes wrong: '), s.recovery)),
      h('div', { class: 'section-title' }, "Don't"), h('ul', { class: 'list dont' }, s.dont.map((d) => h('li', {}, d))),
      h('div', { class: 'section-title' }, 'Interview question'), h('p', {}, h('b', {}, s.interview.question)),
      s.interview.followUps?.length ? h('ul', { class: 'list muted' }, s.interview.followUps.map((q) => h('li', {}, q))) : null,
      h('div', { class: 'section-title' }, 'References'), h('ul', { class: 'list' }, s.references.map((r) => h('li', {}, h('code', {}, r)))),
    ];
  }

  function taskFoot(s) {
    const implemented = s.checker.status === 'implemented';
    let check;
    if (s.state === 'AVAILABLE') check = h('button', { class: 'btn btn-primary btn-check', onclick: () => openLaunch(s.id, 'start') }, 'Start lab');
    else if (s.state === 'CHECKING') check = h('button', { class: 'btn btn-check', onclick: () => act(s.id, 'cancel') }, '↻ Checking… (click to cancel)');
    else if (!implemented) check = h('button', { class: 'btn btn-check', disabled: true, title: s.validation.notes }, 'Check — automatic checker planned');
    else check = h('button', { class: 'btn btn-primary btn-check', onclick: () => act(s.id, 'check') }, s.completedAt ? 'Re-verify' : 'Check');
    return [
      check,
      h('button', { class: 'btn btn-later', onclick: () => { location.hash = '#/practice'; toast('Session kept in progress — the portal keeps watching your evidence.', 'info'); } }, 'Try later'),
      h('div', { class: 'ws-note' }, s.startedAt && implemented ? 'Checks also run on their own when you save watched files or commit.' : ''),
    ];
  }

  function consoleBody(s) {
    const lines = [];
    const prompt = (text) => h('div', { class: 'con-line' }, h('span', { class: 'con-prompt' }, `${s.id.toLowerCase()} ~ `), h('span', { class: 'con-arrow' }, '➜ '), text);
    lines.push(h('div', { class: 'con-line con-dim' }, `# Evidence console — read-only. Run your commands in the VS Code terminal;`));
    lines.push(h('div', { class: 'con-line con-dim' }, `# every checker run appears here as it happens.`));
    if (!s.startedAt) lines.push(prompt(h('span', { class: 'con-dim' }, 'press "Start lab" to begin')));
    const hist = s.history ?? [];
    hist.forEach((run, i) => {
      const last = i === hist.length - 1;
      const passed = run.criteria.filter((c) => c.status === 'pass').length;
      const block = h('div', { class: 'con-block' },
        prompt(h('span', {}, `check ${s.id}`, h('span', { class: 'con-dim' }, `  # ${run.trigger ?? ''} · ${new Date(run.at).toLocaleTimeString()}`))));
      if (last && s.lastObservation) {
        const evidence = new Map((s.lastObservation.criteria ?? []).map((c) => [c.id, c]));
        for (const c of s.criteria) {
          const o = evidence.get(c.id);
          if (!o) continue;
          const [mark, cls] = CRIT_MARK[o.status] ?? ['·', 'con-dim'];
          block.append(h('div', { class: 'con-line' }, h('span', { class: cls }, `  ${mark} `), c.text));
          if (o.reason && o.status !== 'pass') block.append(h('div', { class: `con-line ${cls}` }, `      ${o.reason}`));
          if (o.evidence) {
            const det = h('details', { ontoggle: (e) => (e.target.open ? openEvidence.add(`${s.id}:${c.id}`) : openEvidence.delete(`${s.id}:${c.id}`)) }, h('summary', {}, 'evidence'), h('div', { class: 'con-evidence' }, o.evidence));
            if (openEvidence.has(`${s.id}:${c.id}`)) det.open = true;
            block.append(det);
          }
        }
      }
      const rev = run.revision ? ` · ${run.revision.branch ?? '?'}@${run.revision.commit ?? '?'}${run.revision.dirty ? '*' : ''}` : '';
      const label = run.outcome === 'blocked' ? `BLOCKED (${REASON_LABEL[run.blockedReason] ?? run.blockedReason})` : run.outcome.toUpperCase();
      block.append(h('div', { class: 'con-line' }, h('span', { class: OUTCOME_CLASS[run.outcome] ?? 'con-dim' }, `  → ${label}`),
        h('span', { class: 'con-dim' }, `  ${run.criteria.length ? `${passed}/${s.criteria.length} criteria` : ''}${run.durationMs !== null ? ` · ${(run.durationMs / 1000).toFixed(1)}s` : ''}${rev}`)));
      if (run.summary) block.append(h('div', { class: 'con-line con-dim' }, `    ${run.summary}`));
      lines.push(block);
    });
    if (s.state === 'CHECKING') lines.push(prompt(h('span', { class: 'con-info' }, `running checker…`)));
    else if (s.state === 'COMPLETED') lines.push(prompt(h('span', { class: 'con-pass' }, 'session complete ✓ ')));
    else if (s.startedAt) lines.push(prompt(h('span', { class: 'con-cursor' }, '')));
    return lines;
  }

  function renderWorkspace(id) {
    const s = state.sessions.find((x) => x.id === id);
    if (!s) return renderPractice();
    if (isLocked(s)) {
      view.replaceChildren(h('section', { class: 'card' }, h('a', { href: '#/practice', class: 'back' }, '← All sessions'),
        h('h2', {}, `🔒 Session ${s.number}: ${s.title}`), h('p', { class: 'muted' }, 'Unlocks when the previous session is completed — by verified evidence.'),
        h('blockquote', { class: 'scenario' }, s.scenario)));
      return;
    }
    const tab = ui.tab[s.id] ?? (s.lastObservation ? 'task' : 'learn');
    const tabBtn = (key, label) => h('button', { class: `ws-tab ${tab === key ? 'on' : ''}`, onclick: () => { ui.tab[s.id] = key; render(true); } }, label);
    const timer = h('span', { class: 'ws-timer', id: 'ws-timer', dataset: { id: s.id } });
    const task = h('section', { class: 'ws-panel ws-task' },
      h('div', { class: 'ws-head' }, tabBtn('learn', '📘 Learn'), tabBtn('task', '☰ Task'), tabBtn('hints', `Hints ${s.hintsRevealed.length}/${s.hintsTotal}`), s.completedAt ? tabBtn('result', '✓ Result') : null,
        h('span', { class: 'ws-spacer' }), timer,
        h('button', { class: 'ws-icon', title: 'Restart the time box', onclick: () => { resetTimebox(s); tickTimer(); } }, '↺'),
        h('button', { class: 'ws-icon', title: ui.expanded ? 'Show the evidence console' : 'Hide the evidence console', onclick: () => { ui.expanded = !ui.expanded; render(true); } }, ui.expanded ? '⤡' : '⤢')),
      h('div', { class: 'ws-body' }, ...taskBody(s)),
      h('div', { class: 'ws-foot' }, ...taskFoot(s)));
    const termOn = state.meta.terminal.enabled;
    const right = ui.rightTab ?? (termOn ? 'terminal' : 'evidence');
    const rightTab = (key, label, extra = '') => h('button', { class: `ws-tab ${right === key ? 'on' : ''} ${extra}`, onclick: () => { ui.rightTab = key; render(true); if (key === 'terminal' && term.input) term.input.focus(); } }, label);
    const lastRun = (s.history ?? []).at(-1);
    const evidenceLabel = lastRun ? `Evidence · ${stateText(s)}${lastRun.criteria.length ? ` ${lastRun.criteria.filter((c) => c.status === 'pass').length}/${s.criteria.length}` : ''}` : 'Evidence';
    const conBody = h('div', { class: 'ws-body', id: 'console-body' }, ...consoleBody(s));
    let rightBody = conBody;
    if (right === 'terminal') {
      rightBody = termOn ? buildTerminal() : h('div', { class: 'ws-body term-body' }, h('div', { class: 'con-line con-dim' },
        '# The terminal is off. To run commands here, stop the portal and start it with:\n#   $env:PORTAL_TERMINAL = "1"; npm --prefix portal start\n# It runs a real PowerShell in the repository folder (no PTY: vim/less do not work).'));
    }
    const termFocused = document.activeElement === term.input;
    const consolePanel = h('section', { class: 'ws-panel ws-console' },
      h('div', { class: 'ws-head' },
        rightTab('terminal', termOn ? `Terminal 1${term.status.busy ? ' ●' : ''}` : 'Terminal (off)'),
        rightTab('evidence', evidenceLabel, s.state === 'FAILED' ? 'tab-fail' : s.state === 'COMPLETED' ? 'tab-ok' : ''),
        h('span', { class: 'ws-spacer' }),
        right === 'terminal' && termOn ? h('button', { class: 'ws-icon', title: 'Clear the screen', onclick: () => post('/api/terminal/clear').catch((e) => toast(e.message)) }, '⌫') : null,
        right === 'terminal' && termOn ? h('button', { class: 'btn stop-lab', title: 'Kill the running command and start a fresh shell', onclick: () => post('/api/terminal/restart').catch((e) => toast(e.message)) }, '■ Restart') : null,
        h('span', { class: `status-pill ${s.state}`, title: s.reasonMessage ?? '' }, stateText(s)),
        h('a', { href: '#/practice', class: 'ws-icon', title: 'All sessions' }, '✕')),
      rightBody);
    const oldTask = view.querySelector('.ws-task .ws-body');
    const sameSession = ui.lastWs === s.id;
    const taskScroll = sameSession && oldTask ? oldTask.scrollTop : 0;
    view.replaceChildren(h('div', { class: `ws ${ui.expanded ? 'expanded' : ''}` }, task, h('div', { class: 'ws-divider' }, '‖'), consolePanel));
    ui.lastWs = s.id;
    task.querySelector('.ws-body').scrollTop = taskScroll;
    // Follow new console output unless the learner scrolled up to read.
    conBody.scrollTop = sameSession && ui.conAtBottom === false ? ui.conScroll ?? 0 : conBody.scrollHeight;
    conBody.addEventListener('scroll', () => {
      ui.conScroll = conBody.scrollTop;
      ui.conAtBottom = conBody.scrollHeight - conBody.scrollTop - conBody.clientHeight < 30;
    });
    if (right === 'terminal' && termOn) {
      if (term.stick !== false) term.out.scrollTop = term.out.scrollHeight;
      if (termFocused) term.input.focus();
    }
    tickTimer();
  }

  // ------------------------------------------------------------ terminal
  // A real PowerShell (opt-in, PORTAL_TERMINAL=1). The DOM is built once and
  // re-attached on every render, so live updates never wipe input or output.
  const term = { el: null, out: null, input: null, prompt: null, history: [], hIdx: 0, stick: true, status: { busy: true, cwd: '' } };
  const SGR_COLOURS = { 30: 'k', 31: 'r', 32: 'g', 33: 'y', 34: 'bl', 35: 'm', 36: 'c', 37: 'w', 90: 'k', 91: 'r', 92: 'g', 93: 'y', 94: 'bl', 95: 'm', 96: 'c', 97: 'w' };
  let sgr = { colour: null, bold: false };

  function termAppend(text) {
    if (!term.out) return;
    // Drop OSC and non-colour CSI sequences; keep SGR colours.
    const clean = text.replace(/\x1b\][^\x07]*\x07/g, '').replace(/\x1b\[[0-9;?]*[A-La-ln-zA-Z]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '');
    for (const part of clean.split(/(\x1b\[[0-9;]*m)/)) {
      const m = /^\x1b\[([0-9;]*)m$/.exec(part);
      if (m) {
        for (const code of (m[1] || '0').split(';').map(Number)) {
          if (code === 0) sgr = { colour: null, bold: false };
          else if (code === 1) sgr.bold = true;
          else if (code === 22) sgr.bold = false;
          else if (code === 39) sgr.colour = null;
          else if (SGR_COLOURS[code]) sgr.colour = SGR_COLOURS[code];
        }
      } else if (part) {
        const cls = [sgr.colour ? `ansi-${sgr.colour}` : '', sgr.bold ? 'ansi-b' : ''].join(' ').trim();
        term.out.append(cls ? h('span', { class: cls }, part) : document.createTextNode(part));
      }
    }
    while (term.out.childNodes.length > 5000) term.out.firstChild.remove();
    if (term.stick) term.out.scrollTop = term.out.scrollHeight;
  }

  function termPrompt() {
    if (!term.prompt) return;
    const st = term.status;
    // Long paths are shortened to their last two segments, like many shell themes.
    const parts = (st.cwd || '').split(/[\\/]/).filter(Boolean);
    const cwd = parts.length > 3 ? `…\\${parts.slice(-2).join('\\')}` : st.cwd || '';
    term.prompt.textContent = st.busy ? '… ' : `PS ${cwd}> `;
    term.prompt.title = st.cwd || '';
    term.prompt.className = `term-prompt ${st.busy ? 'busy' : st.lastOk === false ? 'err' : ''}`;
    term.input.placeholder = st.busy ? 'command running — type the answer to a prompt (e.g. y) and press Enter' : 'type a command and press Enter';
  }

  function buildTerminal() {
    if (term.el) return term.el;
    term.out = h('div', { class: 'term-out', onscroll: () => { term.stick = term.out.scrollHeight - term.out.scrollTop - term.out.clientHeight < 40; } });
    term.prompt = h('span', { class: 'term-prompt' }, 'PS> ');
    term.input = h('input', { class: 'term-input', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Terminal input' });
    term.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const line = term.input.value;
        term.input.value = '';
        if (line.trim() && !term.status.busy) {
          term.history.push(line);
          term.hIdx = term.history.length;
        }
        term.stick = true;
        post('/api/terminal/input', { line }).catch((err) => toast(err.message));
      } else if (e.key === 'ArrowUp' && term.history.length) {
        term.hIdx = Math.max(0, term.hIdx - 1);
        term.input.value = term.history[term.hIdx];
        e.preventDefault();
      } else if (e.key === 'ArrowDown' && term.history.length) {
        term.hIdx = Math.min(term.history.length, term.hIdx + 1);
        term.input.value = term.history[term.hIdx] ?? '';
        e.preventDefault();
      }
    });
    term.el = h('div', {
      class: 'ws-body term-body',
      onclick: (e) => { if (!window.getSelection().toString() && e.target !== term.input) term.input.focus(); },
    }, term.out, h('div', { class: 'term-row' }, term.prompt, term.input));
    termPrompt();
    return term.el;
  }

  function sendToTerminal(command) {
    if (!state.meta.terminal.enabled) return;
    ui.rightTab = 'terminal';
    render(true);
    term.input.value = command;
    term.input.focus();
    toast('Command pasted into the terminal — read it, then press Enter to run it.', 'info');
  }

  // ------------------------------------------------------------ launch screen
  // "Provisioning" = the real preflight: unlock, environment probe,
  // prerequisites and the first evidence collected by the checker.
  const QUOTES = [
    ['Every green check is <em>evidence</em>. Go and collect it.'],
    ['Write the <em>hypothesis</em> first. The fix comes second.'],
    ['If it is not in <em>Git</em>, it did not happen.'],
    ['Small batches, fast <em>feedback</em>, honest evidence.'],
    ['Production is a lab where <em>mistakes</em> cost more. Practise here.'],
    ['Read the <em>plan</em> before you type yes.'],
  ];
  let launch = null;

  function openLaunch(id, mode) {
    const s = state.sessions.find((x) => x.id === id);
    if (!s || isLocked(s)) return;
    launch = { id, mode, t0: Date.now(), baseline: s.lastObservation?.at ?? null, envBaseline: state.environment.at, done: false };
    const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)][0];
    const p = $('#launch-quote');
    p.replaceChildren();
    // Quotes are static strings from this file; <em> marks the highlighted word.
    for (const part of quote.split(/(<em>.*?<\/em>)/)) {
      const m = /^<em>(.*)<\/em>$/.exec(part);
      p.append(m ? h('em', {}, m[1]) : document.createTextNode(part));
    }
    $('#launch-word').textContent = 'Loading';
    $('#launch-word').classList.remove('ready');
    $('#launch').classList.remove('hidden', 'leaving');
    if (mode === 'start') act(id, 'start');
    else if (s.checker.status === 'implemented' && s.state !== 'CHECKING') act(id, 'check');
    post('/api/environment/refresh').catch(() => {});
    updateLaunch();
  }

  function updateLaunch() {
    if (!launch) return;
    const s = state.sessions.find((x) => x.id === launch.id);
    const env = state.environment;
    const elapsed = Date.now() - launch.t0;
    const envReady = Boolean(env.at);
    const implemented = s.checker.status === 'implemented';
    // Stages complete in order: evidence only counts once the environment is known.
    const evidence = !envReady ? false : implemented ? Boolean(s.lastObservation && s.lastObservation.at !== launch.baseline && s.state !== 'CHECKING') : 'skip';
    const prereq = !envReady ? false : s.state === 'BLOCKED' && s.reason !== 'locked' ? 'warn' : true;
    const stages = [
      ['Session unlocked', true],
      [`Environment probed${envReady ? ` · Azure ${env.azure.status.replace('_', ' ')} · AKS ${env.aks.status.replace('_', ' ')}` : ''}`, envReady],
      [prereq === 'warn' ? `Prerequisites: ${REASON_LABEL[s.reason] ?? s.reason}` : 'Prerequisites checked', prereq],
      [implemented ? 'First evidence collected' : 'Automatic checker planned for this session', evidence],
    ];
    const list = $('#launch-stages');
    list.replaceChildren();
    let firstPending = true;
    let score = 0;
    for (const [label, st] of stages) {
      let cls = '';
      if (st === true) { cls = 'done'; score += 1; } else if (st === 'warn') { cls = 'warn'; score += 1; } else if (st === 'skip') { cls = 'skip'; score += 1; } else if (firstPending) { cls = 'active'; firstPending = false; }
      list.append(h('li', { class: cls }, label));
    }
    $('#launch-arc').style.strokeDashoffset = String(578 * (1 - score / stages.length));
    const status = $('#launch-status');
    status.replaceChildren(score >= 2 ? 'Lab provisioned. ' : 'Provisioning lab. ', h('span', { class: 'hl' }, 'Getting'), ' ready…');
    const finished = score === stages.length || elapsed > 30000;
    if (finished && !launch.done) {
      launch.done = true;
      $('#launch-word').textContent = 'Ready';
      $('#launch-word').classList.add('ready');
      const target = launch.id;
      setTimeout(() => {
        $('#launch').classList.add('leaving');
        if (route().view !== 'session' || route().id !== target) location.hash = `#/session/${target}`;
        setTimeout(() => { $('#launch').classList.add('hidden'); launch = null; }, 450);
      }, 900);
    }
  }
  setInterval(updateLaunch, 1000);

  // ------------------------------------------------------------ progress / env
  function renderProgress() {
    const done = state.sessions.filter((s) => s.completion);
    const solo = done.filter((s) => s.completion.mode === 'SOLO').length;
    const badges = h('div', {}, state.track.cycles.map((c) => {
      const earned = state.totals.badges.some((b) => b.id === `cycle-${c.id}`);
      return h('div', { class: `badge-big ${earned ? 'earned' : ''}` }, h('div', { class: 'medal' }, '✦'), c.badge, h('span', { class: 'muted small' }, `Cycle ${c.id}`));
    }));
    const rows = done.map((s) => h('tr', {},
      h('td', {}, s.number), h('td', {}, s.title), h('td', {}, day(s.completedAt)),
      h('td', {}, s.completion.mode === 'SOLO' ? 'SOLO' : 'AI-assisted'), h('td', {}, s.completion.hintsUsed),
      h('td', {}, s.assessment ? `${2 + s.assessment.english + s.assessment.autonomy + s.assessment.tradeoffs}/10` : '—')));
    view.replaceChildren(
      h('section', { class: 'card' }, h('h2', {}, 'Progress'),
        h('div', { class: 'stats' },
          h('div', { class: 'stat ok' }, h('b', {}, done.length), h('span', {}, 'Completed')),
          h('div', { class: 'stat info' }, h('b', {}, solo), h('span', {}, 'SOLO')),
          h('div', { class: 'stat warn' }, h('b', {}, done.length - solo), h('span', {}, 'AI-assisted')),
          h('div', { class: 'stat lock' }, h('b', {}, state.totals.xp), h('span', {}, 'XP')))),
      h('section', { class: 'card' }, h('h3', {}, 'Badges'), badges),
      h('section', { class: 'card' }, h('h3', {}, 'Completed sessions'),
        done.length ? h('table', {}, h('thead', {}, h('tr', {}, ['#', 'Session', 'Date', 'Mode', 'Hints', 'Score'].map((t) => h('th', {}, t)))), h('tbody', {}, rows))
          : h('p', { class: 'muted' }, 'Nothing completed yet. Your first verified session will show up here.')));
  }

  // ------------------------------------------------------------ study plan
  function renderStudy() {
    const plan = state.studyPlan;
    const all = plan.sections.flatMap((s) => s.items);
    const done = all.filter((i) => i.done).length;
    const fill = h('div', { class: 'progress-fill' });
    requestAnimationFrame(() => { fill.style.width = `${all.length ? (done / all.length) * 100 : 0}%`; });
    const cards = plan.sections.map((sec) => {
      const secDone = sec.items.filter((i) => i.done).length;
      return h('section', { class: 'card' },
        h('div', { class: 'cycle-head' }, h('h3', {}, sec.title), h('span', { class: `cycle-badge ${secDone === sec.items.length ? 'done' : ''}` }, `${secDone}/${sec.items.length}`)),
        sec.note ? h('p', { class: 'muted small' }, sec.note) : null,
        h('ul', { class: 'study-list' }, sec.items.map((item) => {
          const cb = h('input', { type: 'checkbox', onchange: (e) => post(`/api/study/${item.id}`, { done: e.target.checked }).then(() => { if (e.target.checked) toast('Nice — one more step towards the next role.', 'info'); }).catch((err) => toast(err.message)) });
          cb.checked = item.done;
          return h('li', { class: `study-item ${item.done ? 'done' : ''}` },
            h('label', {}, cb, h('span', { class: 'study-title' }, item.title)),
            item.detail ? h('div', { class: 'muted small' }, item.detail) : null,
            item.link ? h('a', { href: item.link, target: '_blank', rel: 'noopener noreferrer', class: 'small' }, 'Open reference ↗') : null,
            item.done && item.at ? h('div', { class: 'muted small' }, `Done ${day(item.at)}`) : null);
        })));
    });
    view.replaceChildren(
      h('section', { class: 'card' }, h('h2', {}, plan.title), h('p', { class: 'muted' }, plan.intro),
        h('div', { class: 'progress-caption' }, `${done}/${all.length} items`), h('div', { class: 'progress-track study-track' }, fill)),
      ...cards);
  }

  // ------------------------------------------------------------ interview practice
  function renderInterview() {
    const total = state.sessions.length;
    const practised = state.sessions.filter((s) => state.interview[s.id]?.passes > 0).length;
    const intro = h('section', { class: 'card' }, h('h2', {}, 'Interview practice'),
      h('p', { class: 'muted' }, 'Answer out loud, in English, in two minutes: context → what you did → why → trade-off. Press "I practised" after each pass — three passes per question builds the memory you want in a real interview.'),
      h('div', { class: 'stats' },
        h('div', { class: 'stat ok' }, h('b', {}, practised), h('span', {}, 'Questions practised')),
        h('div', { class: 'stat info' }, h('b', {}, Object.values(state.interview).reduce((a, r) => a + (r.passes || 0), 0)), h('span', {}, 'Total passes')),
        h('div', { class: 'stat warn' }, h('b', {}, state.sessions.filter((s) => (state.interview[s.id]?.passes ?? 0) >= 3).length), h('span', {}, 'Mastered (3+ passes)')),
        h('div', { class: 'stat lock' }, h('b', {}, total - practised), h('span', {}, 'Not practised yet'))),
      h('p', { class: 'small' }, 'More material in the repository: ', h('code', {}, 'docs/interview/'), ' (pitch, technical answers, consultant scenarios, English).'));
    const cards = state.track.cycles.map((c) => h('section', { class: 'card' },
      h('div', { class: 'cycle-head' }, h('h3', {}, `Cycle ${c.id} · ${c.title}`)),
      h('ul', { class: 'study-list' }, state.sessions.filter((s) => s.cycle === c.id).map((s) => {
        const rec = state.interview[s.id] ?? { passes: 0 };
        return h('li', { class: `study-item ${rec.passes >= 3 ? 'done' : ''}` },
          h('div', { class: 'iv-head' },
            h('span', { class: 'study-title' }, s.interview.question),
            h('span', { class: `chip ${rec.passes >= 3 ? 'ok' : rec.passes ? 'info' : ''}` }, `${rec.passes} pass${rec.passes === 1 ? '' : 'es'}`),
            h('button', { class: 'btn copy', onclick: () => post(`/api/interview/${s.id}/practised`).then((r) => toast(r.passes >= 3 ? 'Mastered — this answer is yours now.' : `Pass ${r.passes} recorded. Keep going.`, 'info')).catch((e) => toast(e.message)) }, 'I practised')),
          s.interview.followUps?.length ? h('div', { class: 'muted small' }, `Follow-ups: ${s.interview.followUps.join(' · ')}`) : null,
          h('div', { class: 'muted small' }, `From session ${s.number}: ${s.title}${rec.lastAt ? ` · last pass ${day(rec.lastAt)}` : ''}`));
      }))));
    view.replaceChildren(intro, ...cards);
  }

  function renderEnvironment() {
    const env = state.environment;
    const tools = Object.entries(env.tools ?? {}).map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', {}, v.installed ? h('span', { class: 'chip ok' }, 'installed') : h('span', { class: 'chip bad' }, 'missing')), h('td', { class: 'mono' }, v.version ?? '')));
    view.replaceChildren(
      h('section', { class: 'card' }, h('h2', {}, 'Environment'), h('p', { class: 'muted' }, `Last probe: ${abs(env.at)} (${rel(env.at)}). Read-only: az account show, az aks show, tool versions.`),
        h('button', { class: 'btn btn-primary', onclick: () => post('/api/environment/refresh').then(() => toast('Refreshing environment…', 'info')).catch((e) => toast(e.message)) }, '↻ Refresh now')),
      h('div', { class: 'grid-2' },
        h('section', { class: 'card' }, h('h3', {}, 'Azure'), h('dl', { class: 'kv' },
          h('dt', {}, 'status'), h('dd', {}, env.azure.status),
          h('dt', {}, 'user'), h('dd', {}, env.azure.user ?? '—'),
          h('dt', {}, 'subscription'), h('dd', {}, env.azure.subscriptionName ?? '—'),
          h('dt', {}, 'lab subscription'), h('dd', {}, env.azure.expectedSubscription === null || env.azure.expectedSubscription === undefined ? 'unknown (no settings file)' : env.azure.expectedSubscription ? 'yes' : 'NO'),
          env.azure.detail ? h('dt', {}, 'detail') : null, env.azure.detail ? h('dd', {}, env.azure.detail) : null)),
        h('section', { class: 'card' }, h('h3', {}, 'AKS'), h('dl', { class: 'kv' },
          h('dt', {}, 'status'), h('dd', {}, env.aks.status),
          h('dt', {}, 'power'), h('dd', {}, env.aks.powerState ?? '—'),
          h('dt', {}, 'provisioning'), h('dd', {}, env.aks.provisioningState ?? '—')),
        h('p', { class: 'muted small' }, 'Evening: az aks stop · Morning: az aks start. Sessions that need the cluster show "Platform stopped" instead of failing.'))),
      h('section', { class: 'card' }, h('h3', {}, 'Tools'), h('table', {}, h('tbody', {}, tools))));
  }

  // ------------------------------------------------------------ routing
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    if (parts[0] === 'session' && /^C\d{3}$/.test(parts[1] ?? '')) return { view: 'session', id: parts[1] };
    return { view: ['practice', 'map', 'progress', 'environment', 'study', 'interview'].includes(parts[0]) ? parts[0] : 'practice' };
  }

  function render(force = false) {
    if (!state) return;
    // Do not rebuild the page under the learner's cursor while they type.
    if (!force && document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;
    const y = window.scrollY;
    renderChrome();
    const r = route();
    if (r.view === 'session') renderWorkspace(r.id);
    else if (r.view === 'map') renderMap();
    else if (r.view === 'progress') renderProgress();
    else if (r.view === 'environment') renderEnvironment();
    else if (r.view === 'study') renderStudy();
    else if (r.view === 'interview') renderInterview();
    else renderPractice();
    window.scrollTo(0, y);
  }

  window.addEventListener('hashchange', () => { render(true); window.scrollTo(0, 0); });
  setInterval(() => render(), 15000); // refresh relative times

  // ------------------------------------------------------------ celebration
  function celebrate(e) {
    $('#cele-title').textContent = `Session ${e.number} complete!`;
    $('#cele-sub').textContent = e.title;
    $('#cele-rewards').replaceChildren(
      h('span', { class: 'reward xp' }, `+${e.rewards.xp} XP`),
      h('span', { class: 'reward coins' }, `+${e.rewards.coins} ●`),
      h('span', { class: 'reward mode' }, e.mode === 'SOLO' ? 'SOLO' : 'AI-assisted'));
    $('#cele-badges').textContent = e.badges.length ? `Badges: ${e.badges.map((b) => b.title).join(' · ')}` : '';
    $('#cele-next').textContent = e.unlocked ? `Unlocked: Session ${state ? state.sessions.findIndex((s) => s.id === e.unlocked.id) + 1 : ''} — ${e.unlocked.title}` : 'Track complete!';
    $('#celebration').classList.remove('hidden');
    window.Confetti.burst($('#confetti'));
  }
  $('#cele-close').addEventListener('click', () => $('#celebration').classList.add('hidden'));

  // ------------------------------------------------------------ live updates
  function connect() {
    const es = new EventSource(`/api/events?token=${encodeURIComponent(TOKEN)}`);
    const conn = $('#conn');
    es.addEventListener('open', () => { conn.className = 'conn live'; $('#conn-text').textContent = 'Live'; });
    es.addEventListener('state', (ev) => {
      if (ev.data === lastJson) return;
      lastJson = ev.data;
      state = JSON.parse(ev.data);
      if (!term.statusFromEvents && state.meta.terminal.enabled) { term.status = state.meta.terminal; termPrompt(); }
      render();
      updateLaunch();
    });
    es.addEventListener('celebrate', (ev) => celebrate(JSON.parse(ev.data)));
    es.addEventListener('term-snapshot', (ev) => {
      buildTerminal();
      term.out.replaceChildren();
      sgr = { colour: null, bold: false };
      termAppend(JSON.parse(ev.data).buffer);
    });
    es.addEventListener('term', (ev) => { buildTerminal(); termAppend(JSON.parse(ev.data).chunk); });
    es.addEventListener('term-clear', () => { if (term.out) term.out.replaceChildren(); });
    es.addEventListener('term-status', (ev) => {
      const wasBusy = term.status.busy;
      term.status = JSON.parse(ev.data);
      term.statusFromEvents = true;
      termPrompt();
      if (wasBusy !== term.status.busy && route().view === 'session') render(true);
    });
    es.addEventListener('error', () => { conn.className = 'conn down'; $('#conn-text').textContent = 'Reconnecting…'; });
  }
  connect();
})();
