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
    if (s.state === 'AVAILABLE') return h('button', { class: 'btn btn-primary', onclick: (e) => { e.stopPropagation(); act(s.id, 'start'); location.hash = `#/session/${s.id}`; } }, 'Start');
    if (s.state === 'COMPLETED') return h('button', { class: 'btn', onclick: (e) => { e.stopPropagation(); location.hash = `#/session/${s.id}`; } }, '✎ Revise');
    return h('button', { class: 'btn btn-warn', onclick: (e) => { e.stopPropagation(); location.hash = `#/session/${s.id}`; } }, 'Continue');
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
        st.command ? h('div', { class: 'cmd' }, h('code', {}, st.command), h('button', {
          class: 'btn copy',
          onclick: () => navigator.clipboard.writeText(st.command).then(() => toast('Command copied — run it in your VS Code terminal.', 'info')),
        }, 'Copy')) : null);
      ol.append(li);
    });
    return ol;
  }

  function criteriaCard(s) {
    const obs = s.lastObservation;
    const byId = new Map((obs?.criteria ?? []).map((c) => [c.id, c]));
    const ul = h('ul', { class: 'criteria' });
    for (const c of s.criteria) {
      const o = byId.get(c.id);
      const status = o?.status ?? 'none';
      const det = o?.evidence ? h('details', { ontoggle: (e) => (e.target.open ? openEvidence.add(`${s.id}:${c.id}`) : openEvidence.delete(`${s.id}:${c.id}`)) }, h('summary', {}, 'evidence observed'), h('pre', { class: 'evidence' }, o.evidence)) : null;
      if (det && openEvidence.has(`${s.id}:${c.id}`)) det.open = true;
      ul.append(h('li', { class: `criterion ${status}` },
        h('div', { class: 'c-head' }, h('span', { class: 'c-ico' }, { pass: '✓', fail: '✕', skipped: '–', none: '·' }[status]), h('div', {}, c.text,
          o?.reason && status !== 'pass' ? h('div', { class: 'c-reason' }, o.reason) : null,
          !o ? h('div', { class: 'muted small' }, s.checker.status === 'implemented' ? 'Not observed yet' : 'Automatic check planned') : null)),
        det));
    }
    return h('section', { class: 'card' }, h('h3', {}, 'Success criteria'), h('p', { class: 'muted small' }, 'Technical correctness is checked automatically from real evidence. Ticking steps never completes a session.'), ul);
  }

  function statusCard(s) {
    const obs = s.lastObservation;
    const started = Boolean(s.startedAt);
    const canCheck = started && s.checker.status === 'implemented' && s.state !== 'CHECKING';
    return h('section', { class: `card status-card ${s.state}` },
      h('div', { class: 'status-line' }, h('div', { class: `state-dot ${s.state}` }, STATE_ICON[s.state]), h('div', { class: 'status-name' }, stateText(s))),
      s.reasonMessage ? h('div', { class: 'status-reason' }, s.reasonMessage) : null,
      obs?.summary ? h('div', { class: 'muted', style: null }, obs.summary) : null,
      h('div', { class: 'obs-meta' },
        h('div', {}, `Last observation: ${obs ? `${rel(obs.at)} (${abs(obs.at)})` : 'none yet'}`),
        obs ? h('div', {}, `Trigger: ${obs.trigger} · ${Math.round(obs.durationMs / 100) / 10}s`) : null,
        obs?.revision ? h('div', {}, `Verified revision: ${obs.revision.branch ?? '?'} @ ${obs.revision.commit ?? '?'}${obs.revision.dirty ? ' (uncommitted changes present)' : ''}`) : null,
        s.checker.nextPollAt ? h('div', {}, `Next external poll: ${rel(s.checker.nextPollAt)}`) : null,
        started && s.checker.status === 'implemented' && s.checker.watch.length ? h('div', {}, `Watching: ${s.checker.watch.join(', ')}${s.checker.watchGit ? ' + git commits' : ''}`) : null),
      h('div', { class: 'actions' },
        s.state === 'AVAILABLE' ? h('button', { class: 'btn btn-primary', onclick: () => act(s.id, 'start') }, '▶ Start session') : null,
        canCheck ? h('button', { class: 'btn btn-primary', onclick: () => act(s.id, 'check') }, s.completedAt ? '↻ Re-verify' : '↻ Check now') : null,
        s.state === 'CHECKING' ? h('button', { class: 'btn btn-warn', onclick: () => act(s.id, 'cancel') }, '■ Cancel check') : null));
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

  function renderSession(id) {
    const s = state.sessions.find((x) => x.id === id);
    if (!s) return renderPractice();
    const cyc = cycleOf(s.cycle);
    const main = h('div', { class: 'card' },
      h('a', { href: '#/practice', class: 'back' }, '← All sessions'),
      h('div', { class: 's-head' }, h('div', { class: 's-num' }, s.number), h('div', {},
        h('h1', { class: 's-title' }, s.title),
        h('div', { class: 'row-meta' }, h('span', { class: 'chip' }, `Cycle ${s.cycle} · ${cyc.title}`), h('span', { class: 'chip' }, s.topic),
          h('span', { class: 'chip' }, `Difficulty ${'●'.repeat(s.difficulty)}${'○'.repeat(3 - s.difficulty)}`), h('span', { class: 'chip' }, `${s.timeMinutes} min`), h('span', { class: 'chip' }, `+${s.xp} XP`)))),
      h('div', { class: 'section-title' }, 'Scenario'), h('blockquote', { class: 'scenario' }, s.scenario),
      h('div', { class: 'section-title' }, 'Mission'), h('p', {}, s.mission),
      h('div', { class: 'section-title' }, 'Objectives'), h('ul', { class: 'list' }, s.objectives.map((o) => h('li', {}, o))),
      h('div', { class: 'section-title' }, 'Steps'),
      isLocked(s) ? h('p', { class: 'muted' }, 'Unlocks when the previous session is completed.') : stepsList(s),
      h('div', { class: 'section-title' }, 'Expected result'), h('p', {}, s.expectedResult),
      h('div', { class: 'section-title' }, 'If something goes wrong'), h('p', {}, s.recovery),
      h('div', { class: 'section-title' }, "Don't"), h('ul', { class: 'list dont' }, s.dont.map((d) => h('li', {}, d))),
      h('div', { class: 'section-title' }, 'Interview question'), h('p', {}, h('b', {}, s.interview.question)),
      s.interview.followUps?.length ? h('ul', { class: 'list muted' }, s.interview.followUps.map((q) => h('li', {}, q))) : null,
      h('div', { class: 'section-title' }, 'References'), h('ul', { class: 'list' }, s.references.map((r) => h('li', {}, h('code', {}, r)))));
    const side = h('div', { class: 'session-side' }, statusCard(s), criteriaCard(s), ...completionCards(s), hintsCard(s), envCard(s), checkerCard(s));
    view.replaceChildren(h('div', { class: 'session-layout' }, main, side));
  }

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
    return { view: ['practice', 'map', 'progress', 'environment'].includes(parts[0]) ? parts[0] : 'practice' };
  }

  function render(force = false) {
    if (!state) return;
    // Do not rebuild the page under the learner's cursor while they type.
    if (!force && document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;
    const y = window.scrollY;
    renderChrome();
    const r = route();
    if (r.view === 'session') renderSession(r.id);
    else if (r.view === 'map') renderMap();
    else if (r.view === 'progress') renderProgress();
    else if (r.view === 'environment') renderEnvironment();
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
      render();
    });
    es.addEventListener('celebrate', (ev) => celebrate(JSON.parse(ev.data)));
    es.addEventListener('error', () => { conn.className = 'conn down'; $('#conn-text').textContent = 'Reconnecting…'; });
  }
  connect();
})();
