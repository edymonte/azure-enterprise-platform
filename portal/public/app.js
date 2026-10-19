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
    t.className = `toast ${kind === 'info' ? '' : 'error'}`;
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

  // ------------------------------------------------------------ dates
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtShort = (s) => { const d = parseIso(s); return { wd: WD[d.getDay()], dm: `${String(d.getDate()).padStart(2, '0')} ${MO[d.getMonth()]}` }; };
  const fmtLong = (s) => { const d = parseIso(s); return `${WD[d.getDay()]}, ${MO[d.getMonth()]} ${d.getDate()}`; };

  // ------------------------------------------------------------ AZ-400 model
  const DOMAINS = {
    foundation: { n: 'Foundation', w: 'support' }, process: { n: 'Processes', w: '10–15%' }, source: { n: 'Source control', w: '10–15%' },
    pipelines: { n: 'Pipelines', w: '50–55%' }, security: { n: 'Security', w: '10–15%' }, instrumentation: { n: 'Monitoring', w: '5–10%' }, capstone: { n: 'Capstones', w: 'practice' },
  };
  const PLAT = { local: 'Local', github: 'GitHub', 'azure-devops': 'Azure DevOps', azure: 'Azure' };
  const PREP = { id: 'prep', slug: '', domain: 'foundation', minutes: 120, title: 'Before anything: prepare the machine and accounts', platforms: ['local'],
    role: 'Done once, on the first day.', scenario: 'Install the tools, create the disposable accounts and set the context variables every course script reads.',
    primer: 'Use throw-away accounts and a disposable subscription, never work ones: a mistake in a lab must not touch anything real.', checkpoints: [] };

  const az = () => state.az400;
  const labById = (id) => (id === 'prep' ? PREP : az().labs.find((l) => l.id === id));
  const runId = (l) => `l${l.id}-${az().progress.run || 'vacation'}`;
  function costInfo(l) {
    const c = (l.cost || '').toLowerCase();
    if (l.id === 'prep' || c === 'none') return { t: 'No cost', k: 'ok' };
    if (c.includes('billable') || c.includes('developer store') || c.includes('b1 app service')) return { t: 'Creates billable Azure resources', k: 'warn' };
    if (c.includes('paid features')) return { t: 'Paid features off', k: 'ok' };
    if (c.includes('hosted-run')) return { t: 'Uses CI minutes', k: 'ok' };
    return { t: l.cost, k: '' };
  }

  // The runbook of a lab (mirrors the course: understand → prepare → 5 tasks → break/fix → validate → questions → clean up).
  function az400Steps(l) {
    const root = az().root;
    if (l.id === 'prep') return [
      { ph: 'Tools', k: 'req', t: 'Check the prerequisites', d: 'PowerShell 7.4+, .NET 10, Git, GitHub CLI (gh), Azure CLI with the azure-devops extension and Python 3. Install anything missing.', link: ['docs/prerequisites.md', 'Open prerequisites'] },
      { k: 'init', t: 'Initialise the course environment', d: 'From the course folder. It checks the tools and prepares the git-ignored .state/ folder where your evidence lives.', code: `Set-Location '${root}'\n./tools/Initialize-LabEnvironment.ps1` },
      { ph: 'Accounts', k: 'acc', t: 'Create the disposable accounts (once)', d: 'A personal GitHub account, a training Azure DevOps organisation and a disposable Azure subscription. Sign in to gh and az.', link: ['docs/account-bootstrap.md', 'Open account setup'], code: 'gh auth login\naz login\naz account show --output table' },
      { k: 'env', t: 'Set the context variables', d: 'Every script reads these. Replace the values with yours; put them in your PowerShell profile (notepad $PROFILE) to keep them.', code: "$env:AZ400_GITHUB_OWNER = 'your-github-login'\n$env:AZ400_ADO_ORGANIZATION = 'https://dev.azure.com/your-training-org'\n$env:AZ400_SUBSCRIPTION_ID = '<disposable-subscription-guid>'", link: ['docs/configuration.md', 'Open configuration'] },
      { ph: 'Safety and cost', k: 'cost', t: 'Read the cost and cleanup rules', d: 'Labs 15, 16, 17, 24, 25 and the capstones create paid Azure resources. The rule: every lab you run ends with Cleanup, the same day.', link: ['docs/cost-and-cleanup.md', 'Open cost and cleanup'] },
    ];
    const lab = `./labs/${l.slug}/scripts/cli`;
    const R = runId(l);
    const isCap = l.domain === 'capstone';
    const hasQ = Number(l.id) >= 1 && Number(l.id) <= 25;
    const costly = costInfo(l).k === 'warn';
    const out = [];
    out.push({ ph: 'Understand', k: 'read', t: 'Read the scenario and the concept in the README', d: 'Scenario, Architecture and Concept primer, plus the diagram (~15 min). Explain in your own words what will happen before running anything.', link: [`labs/${l.slug}/README.md`, 'Open the lab README'] });
    out.push({ ph: 'Prepare', k: 'pre', t: 'Run Preflight (read-only)', d: 'From the course folder. Preflight only reads: tools, sign-ins and context. Fix anything it reports before going on.', code: `Set-Location '${root}'\n$lab = '${lab}'\n& "$lab/Preflight.ps1" -RunId '${R}'` });
    out.push({ k: 'setup', t: 'Preview, then create the sandbox', d: 'First without -Execute: it shows what it would create and changes nothing. Read the preview, then run the second line.', note: costly ? 'This lab creates paid Azure resources. Only run -Execute when you have time to finish and clean up today.' : null, code: `& "$lab/Setup.ps1" -RunId '${R}' -ProvisionOnly\n# after reviewing the preview:\n& "$lab/Setup.ps1" -RunId '${R}' -ProvisionOnly -Execute -AcknowledgeCost -AcknowledgeTenantChange` });
    out.push({ k: 'ctx', t: 'Load the context into the session', d: 'Creates $WorkRoot, $GhRepo, $ResourceGroup… used by the task commands. Note the leading dot: it loads into the current session. Run it again if you restart the terminal.', code: `. "$lab/Context.ps1" -RunId '${R}'` });
    l.checkpoints.forEach((c, i) => {
      out.push({ ph: i === 0 ? 'Practise: 5 tasks' : null, k: `cp${i + 1}`, t: `Task ${i + 1}: ${c.title}`, d: `In the README, go to Task ${i + 1}. Run the main commands, then the positive and negative validations. Tick it only when both pass.`,
        orig: [['Expected result', c.expected], ['If it goes wrong', c.fix]], link: [`labs/${l.slug}/README.md#task-${i + 1}`, `Go to Task ${i + 1}`] });
    });
    if (isCap) out.push({ k: 'int', t: 'Run the capstone integration', d: 'Joins the five tasks and checks the end-to-end delivery. Read the integration section first.', note: 'Creates an App Service B1 and telemetry (paid). Clean up the same day.', code: `& "$lab/Integration.ps1" -RunId '${R}' -Execute -AcknowledgeCost -AcknowledgeTenantChange` });
    out.push({ ph: 'Break and fix', k: 'bf', t: 'Run the break/fix', d: 'Read only the Fault trigger in the README and guess how the failure will show. The script proves health, injects the fault, requires detection, repairs and proves again.', code: `& "$lab/BreakFix.ps1" -RunId '${R}' -Execute` });
    out.push({ k: 'val', t: 'Validate the final result', d: 'Independently re-validates the five tasks and the break/fix and writes validation.json — the portal reads it and marks the lab verified when it says passed.', code: `& "$lab/Validate.ps1" -RunId '${R}'` });
    if (hasQ) out.push({ ph: 'Lock it in for the exam', k: 'q', t: 'Answer the 50 questions', d: 'Answer all of QUESTIONS.md before opening the answers, then read every rationale in ANSWERS.md — including the ones you got right. Record your score.', link: [`labs/${l.slug}/QUESTIONS.md`, 'Open questions'], link2: [`labs/${l.slug}/ANSWERS.md`, 'Open answers'], score: true });
    out.push({ ph: 'Close', k: 'clean', t: 'Clean up everything the lab created', d: 'First without -Execute and read the list: only items of this Run ID must appear. Then with -Execute. Never skip it — it is what prevents charges.', code: `& "$lab/Cleanup.ps1" -RunId '${R}'\n# after reviewing the list:\n& "$lab/Cleanup.ps1" -RunId '${R}' -Execute` });
    return out;
  }
  const labSteps = (l) => az400Steps(l).map((s) => s.k);
  const stepDone = (l, k) => Boolean(az().progress.steps[`${l.id}:${k}`]);
  function labProgress(l) { const ks = labSteps(l); return { d: ks.filter((k) => stepDone(l, k)).length, t: ks.length }; }
  const labVerified = (l) => (l.id === 'prep' ? labProgress(l).d === labProgress(l).t : Boolean(az().progress.completions[l.id]));

  // ------------------------------------------------------------ plan model
  function planItems() {
    return state.schedule.items.filter((it) => (it.kind === 'az400' ? state.az400.available && labById(it.id) : state.sessions.some((s) => s.id === it.id)));
  }
  function itemDone(it) {
    if (it.kind === 'az400') return labVerified(labById(it.id));
    return state.sessions.find((s) => s.id === it.id).state === 'COMPLETED';
  }
  function itemStarted(it) {
    if (it.kind === 'az400') return labProgress(labById(it.id)).d > 0;
    return Boolean(state.sessions.find((s) => s.id === it.id).startedAt);
  }
  function itemStatus(it) {
    const today = isoToday();
    if (itemDone(it)) return ['done', it.kind === 'az400' && it.id !== 'prep' ? 'Verified' : 'Done'];
    if (it.date > state.schedule.lastDay) return ['extra', 'After'];
    if (it.date < today) return ['late', 'Late'];
    if (it.date === today) return ['today', 'Today'];
    if (itemStarted(it)) return ['doing', 'Doing'];
    return ['next', ''];
  }
  const itemKey = (it) => `${it.kind}:${it.id}`;
  function itemTitle(it) {
    if (it.kind === 'az400') return it.id === 'prep' ? 'Preparation' : `${it.id} · ${labById(it.id).title}`;
    const s = state.sessions.find((x) => x.id === it.id);
    return `${s.id} · ${s.title}`;
  }

  // ------------------------------------------------------------ chrome (summary band)
  function applyTheme() {
    let t = null;
    try { t = localStorage.getItem('theme'); } catch { /* storage unavailable */ }
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  applyTheme();
  $('#theme-btn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    try { localStorage.setItem('theme', dark ? 'light' : 'dark'); } catch { /* storage unavailable */ }
    applyTheme();
  });

  function renderChrome() {
    const t = state.totals;
    $('#rank-title').textContent = t.rank.title;
    const nextXp = t.nextRank ? t.nextRank.minXp : t.xp;
    const pct = t.nextRank ? ((t.xp - t.rank.minXp) / (nextXp - t.rank.minXp)) * 100 : 100;
    $('#xp-fill').style.width = `${Math.max(2, Math.min(100, pct))}%`;
    $('#xp-num').textContent = t.nextRank ? `${t.xp}/${nextXp} XP` : `${t.xp} XP`;
    $('#coins').textContent = t.coins;
    $('#badge-count').textContent = t.badges.length;
    $('#validation-banner').classList.toggle('hidden', !state.meta.validationMode);
    $('#plan-subtitle').textContent = state.schedule.start ? `${fmtLong(state.schedule.start)} – ${fmtLong(state.schedule.lastDay)} · ${state.schedule.subtitle}` : state.meta.subtitle;

    const labs = state.az400.available ? state.az400.labs : [];
    const verified = labs.filter(labVerified).length;
    $('#s-labs').textContent = state.az400.available ? `${verified}/${labs.length}` : 'n/a';
    $('#s-labs-bar').style.width = `${labs.length ? (verified / labs.length) * 100 : 0}%`;
    const doneSessions = state.sessions.filter((s) => s.state === 'COMPLETED').length;
    $('#s-sessions').textContent = `${doneSessions}/${state.sessions.length}`;
    $('#s-sessions-bar').style.width = `${(doneSessions / state.sessions.length) * 100}%`;

    const today = isoToday();
    const items = planItems();
    const due = items.filter((it) => it.date < today && it.date <= state.schedule.lastDay);
    const late = due.filter((it) => !itemDone(it)).length;
    const ahead = items.filter((it) => it.date > today && itemDone(it)).length;
    const pace = $('#s-pace');
    if (state.schedule.start && today < state.schedule.start) { pace.textContent = `Starts ${fmtShort(state.schedule.start).dm}`; pace.style.color = 'var(--muted)'; }
    else if (late) { pace.textContent = `${late} item${late > 1 ? 's' : ''} late`; pace.style.color = 'var(--bad)'; }
    else if (ahead) { pace.textContent = `${ahead} ahead`; pace.style.color = 'var(--ok)'; }
    else { pace.textContent = 'On track'; pace.style.color = 'var(--ok)'; }
    const next = items.find((it) => !itemDone(it));
    if (next) {
      $('#today-lbl').textContent = `Next · ${next.date === today ? 'today' : fmtLong(next.date)}`;
      $('#today-txt').textContent = itemTitle(next);
      $('#today-btn').onclick = () => { selectItem(itemKey(next)); location.hash = '#/schedule'; };
    } else { $('#today-lbl').textContent = 'All done'; $('#today-txt').textContent = 'Book the exam'; $('#today-btn').onclick = null; }

    const order = ['process', 'source', 'pipelines', 'security', 'instrumentation', 'capstone'];
    const doms = $('#domains');
    doms.replaceChildren(...order.map((k) => {
      const ls = labs.filter((l) => l.domain === k);
      const dn = ls.filter(labVerified).length;
      const fill = h('div');
      fill.style.width = `${ls.length ? (dn / ls.length) * 100 : 0}%`;
      fill.style.background = `var(--d-${k})`;
      return h('div', { class: 'dom' }, h('div', { class: 'row' }, h('b', {}, DOMAINS[k].n), h('span', {}, `${dn}/${ls.length} · ${DOMAINS[k].w}`)), h('div', { class: 'bar' }, fill));
    }), (() => {
      const fill = h('div');
      fill.style.width = `${(doneSessions / state.sessions.length) * 100}%`;
      fill.style.background = 'var(--d-platform)';
      return h('div', { class: 'dom' }, h('div', { class: 'row' }, h('b', {}, 'Azure platform'), h('span', {}, `${doneSessions}/${state.sessions.length}`)), h('div', { class: 'bar' }, fill));
    })());

    const env = state.environment;
    const pills = $('#env-pills');
    const azs = env.azure;
    const azKind = azs.status === 'signed_in' ? (azs.expectedSubscription === false ? 'bad' : 'ok') : azs.status === 'unknown' ? '' : 'bad';
    const azText = azs.status === 'signed_in' ? (azs.expectedSubscription === false ? 'Azure: wrong subscription' : 'Azure') : `Azure: ${azs.status.replace('_', ' ')}`;
    const aks = env.aks;
    const aksKind = aks.status === 'running' ? 'ok' : aks.status === 'stopped' ? 'warn' : '';
    pills.replaceChildren(
      h('span', { class: `pill-env ${azKind}`, title: azs.user ?? azs.detail ?? '' }, azText),
      h('span', { class: `pill-env ${aksKind}` }, `AKS: ${aks.status.replace('_', ' ')}`),
      h('span', { class: `pill-env ${state.az400.available ? 'ok' : 'bad'}`, title: state.az400.error ?? state.az400.root }, state.az400.available ? 'AZ-400 course' : 'AZ-400 course missing'));
    const v = route().view;
    for (const a of document.querySelectorAll('.nav-item')) a.classList.toggle('active', a.dataset.view === v || (v === 'session' && a.dataset.view === 'map'));
  }

  // ------------------------------------------------------------ schedule view
  function selectItem(key) {
    ui.sel = key;
    try { localStorage.setItem('plan.sel', key); } catch { /* storage unavailable */ }
    render(true);
  }
  function currentItem(items) {
    if (!ui.sel) { try { ui.sel = localStorage.getItem('plan.sel'); } catch { /* storage unavailable */ } }
    return items.find((it) => itemKey(it) === ui.sel) ?? items.find((it) => !itemDone(it)) ?? items[0];
  }

  function renderSchedule() {
    const items = planItems();
    if (!items.length) {
      view.replaceChildren(h('section', { class: 'card' }, h('h2', {}, 'No plan yet'), h('p', { class: 'muted' }, state.az400.error ?? 'catalog/schedule.json has no items.')));
      return;
    }
    const sel = currentItem(items);
    const today = isoToday();
    const rail = h('div', { class: 'rail-list' });
    let lastWeek = null;
    for (const it of items) {
      const wk = it.date > state.schedule.lastDay ? 'After the vacation' : `Week ${Math.floor((parseIso(it.date) - parseIso(state.schedule.start)) / 864e5 / 7) + 1}`;
      if (wk !== lastWeek) { rail.append(h('div', { class: 'week' }, wk)); lastWeek = wk; }
      const f = fmtShort(it.date);
      const [sk, sl] = itemStatus(it);
      let dom; let sub;
      if (it.kind === 'az400') {
        const l = labById(it.id); const p = labProgress(l);
        dom = `var(--d-${l.domain})`; sub = `${DOMAINS[l.domain].n} · ${p.d}/${p.t}`;
      } else {
        const s = state.sessions.find((x) => x.id === it.id);
        dom = 'var(--d-platform)'; sub = `Azure platform · ${stateText(s)}`;
      }
      const dotEl = h('i', { class: 'dot' });
      dotEl.style.background = dom;
      rail.append(h('button', { class: `item ${it.date === today ? 'is-today' : ''}`, type: 'button', 'aria-current': String(itemKey(it) === itemKey(sel)), onclick: () => selectItem(itemKey(it)) },
        h('span', { class: 'date' }, f.wd, h('b', {}, f.dm)),
        h('span', { class: 't' }, h('b', {}, itemTitle(it)), h('small', {}, dotEl, sub)),
        sl ? h('span', { class: `pill p-${sk}` }, sl) : h('span')));
    }
    const railEl = h('nav', { class: 'rail', 'aria-label': 'Schedule' },
      h('div', { class: 'rail-head' }, h('h2', {}, 'Schedule'), h('span', { class: 'mono small muted' }, `${items.filter(itemDone).length}/${items.length}`)), rail);
    const detail = h('main', { class: 'detail' }, ...(sel.kind === 'az400' ? az400Detail(labById(sel.id), sel, items) : platformDetail(state.sessions.find((s) => s.id === sel.id), sel)));
    const oldRail = view.querySelector('.rail-list');
    const railScroll = oldRail ? oldRail.scrollTop : null;
    view.replaceChildren(h('div', { class: 'main-grid' }, railEl, detail));
    if (railScroll !== null) rail.scrollTop = railScroll;
    else { const cur = rail.querySelector('[aria-current="true"]'); if (cur) cur.scrollIntoView({ block: 'center' }); }
  }

  function repoLink(rel, label) {
    const base = state.az400.repoUrl;
    return base ? h('a', { href: base + rel, target: '_blank', rel: 'noopener noreferrer' }, label) : h('span', { class: 'muted small' }, `${label}: ${rel}`);
  }
  function verdict(v) {
    if (v === undefined || v === null || Number.isNaN(v)) return ['v-none', 'No score yet'];
    if (v < 70) return ['v-bad', 'Below 70%: redo the lab'];
    if (v < 85) return ['v-mid', '70–84%: review the weak spots'];
    return ['v-ok', '85% or more: move on'];
  }
  // The terminal takes one line: paste the first group of commands (up to the
  // first comment, e.g. before an -Execute line that needs a review first).
  function firstCommandGroup(code) {
    const lines = [];
    for (const line of code.split('\n')) {
      if (line.trim().startsWith('#')) break;
      if (line.trim()) lines.push(line.trim());
    }
    return lines.join('; ');
  }

  function codeBlock(code) {
    return h('div', { class: 'code' }, h('pre', {}, code), h('div', { class: 'code-actions' },
      state.meta.terminal.enabled ? h('button', { type: 'button', title: 'Paste into the terminal below (you still press Enter)', onclick: () => sendToTerminal(firstCommandGroup(code)) }, '▶ Terminal') : null,
      h('button', { type: 'button', onclick: (e) => navigator.clipboard.writeText(code).then(() => { e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy'; }, 1400); }) }, 'Copy')));
  }

  function az400Detail(l, it, items) {
    const ci = costInfo(l);
    const isPrep = l.id === 'prep';
    const hasQ = !isPrep && Number(l.id) >= 1 && Number(l.id) <= 25;
    const ev = state.az400.evidence[l.id];
    const done = state.az400.progress.completions[l.id];
    const split = h('div', { class: 'daysplit', 'aria-label': 'How to split the day' });
    const seg = (cls, flex, text) => { const d = h('div', { class: cls }, text); d.style.flex = String(flex); return d; };
    if (isPrep) split.append(seg('ds-a', 2, 'Preparation · 2 h'), seg('ds-b', 1, 'Lab 00 · 1 h'));
    else if (l.id === '00') split.append(seg('ds-b', 2, 'Preparation · 2 h'), seg('ds-a', 1, 'Lab 00 · 1 h'));
    else if (l.domain === 'capstone') split.append(seg('ds-a', 3, 'Lab · 4 h (split over 2 days)'), seg('ds-c', 1, 'Review'));
    else split.append(seg('ds-c', 0.25, '15 min'), seg('ds-a', 1.75, 'Lab: tasks, break/fix, cleanup · 1 h 45'), seg('ds-b', 1, '50 questions · 1 h'));
    const domDot = h('i', { class: 'dot' });
    domDot.style.background = `var(--d-${l.domain})`;
    const head = h('section', { class: 'card' },
      h('div', { class: 'lab-top' },
        h('span', { class: 'tag' }, domDot, `${DOMAINS[l.domain].n} · ${DOMAINS[l.domain].w}`),
        h('span', { class: 'tag mono' }, `${l.minutes} min`),
        h('span', { class: `tag ${ci.k ? `cost-${ci.k}` : ''}` }, ci.t),
        h('span', { class: 'tag' }, (l.platforms || []).map((x) => PLAT[x] || x).join(' · ')),
        h('span', {}, 'Planned: ', h('b', {}, fmtLong(it.date)), it.date > state.schedule.lastDay ? ' (after the vacation)' : '')),
      h('h2', { class: 'title' }, isPrep ? null : h('span', { class: 'num' }, l.id), l.title),
      h('p', { class: 'role' }, isPrep ? l.role : `Your role: ${l.role}`),
      h('div', { class: 'two' },
        h('div', { class: 'box' }, h('h3', {}, 'What you will do'), h('p', {}, l.scenario)),
        h('div', { class: 'box exam' }, h('h3', {}, isPrep ? 'Rule' : 'Concept primer'), h('p', {}, l.primer || l.outcome))),
      split,
      isPrep ? null : h('div', { class: 'links' },
        repoLink(`labs/${l.slug}/README.md`, 'Lab README'), repoLink(`labs/${l.slug}/solution/README.md`, 'Worked solution'),
        hasQ ? repoLink(`labs/${l.slug}/QUESTIONS.md`, 'Questions') : null, hasQ ? repoLink(`labs/${l.slug}/ANSWERS.md`, 'Answers') : null),
      linksBlock(`az400-${l.id}`));

    const evCard = isPrep ? null : h('section', { class: `card ${done ? 'status-card COMPLETED' : ''}` },
      h('div', { class: 'prog-head' }, h('h3', {}, 'Evidence from Validate.ps1'),
        h('button', { class: 'btn copy', onclick: () => post('/api/az400/rescan').then(() => toast('Evidence re-read.')).catch((e) => toast(e.message)) }, '↻ Re-read')),
      ev ? h('div', {},
        h('div', {}, 'Status: ', h('span', { class: `ev-status ${ev.status}` }, ev.status.toUpperCase()), h('span', { class: 'muted small' }, ` · run ${ev.runId} · ${ev.verifiedAt ? abs(ev.verifiedAt) : 'no timestamp'}`)),
        h('div', { class: 'ev-grid' }, ...ev.checkpoints.map((c) => h('span', { class: `ev-cp ${c.status}`, title: c.reason ?? '' }, `${c.id} ${c.status}`)),
          h('span', { class: `ev-cp ${ev.breakFix === 'passed' ? 'passed' : ev.breakFix === 'failed' ? 'failed' : ''}` }, `break/fix ${ev.breakFix}`),
          ev.integration && ev.integration !== 'not-required' ? h('span', { class: `ev-cp ${ev.integration}` }, `integration ${ev.integration}`) : null),
        done ? h('p', { class: 'small' }, `Verified ${abs(done.at)} · +${done.rewards.xp} XP`) : h('p', { class: 'muted small' }, 'The lab turns green when validation.json says passed (all 5 tasks + break/fix).'))
        : h('p', { class: 'muted small' }, `No validation.json yet. Run Validate.ps1 (step "Validate the final result"); the portal reads ${state.az400.root}\\.state\\${l.id}\\<run-id>\\validation.json automatically.`));

    const ss = az400Steps(l);
    const p = labProgress(l);
    const pbar = h('div');
    pbar.style.width = `${(p.d / p.t) * 100}%`;
    pbar.style.background = 'var(--ok)';
    const stepsCard = h('section', { class: 'card' },
      h('div', { class: 'prog-head' }, h('h3', {}, 'Step by step'), h('span', { class: 'mono muted' }, `${p.d} of ${p.t} steps`)),
      h('div', { class: 'bar' }, pbar),
      isPrep ? null : (() => {
        const input = h('input', { value: az().progress.run, maxlength: '16', 'aria-label': 'Run ID suffix' });
        input.addEventListener('change', () => post('/api/az400/run', { suffix: input.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 16) }).then(() => toast('Run ID updated in every command.')).catch((e) => toast(e.message)));
        return h('div', { class: 'runid' }, 'Run ID for this lab:', h('code', {}, runId(l)), '· suffix', input, h('span', { class: 'small' }, 'Change the suffix to redo a lab from scratch.'));
      })());
    let list = h('ol', { class: 'steps-list' });
    stepsCard.append(list);
    ss.forEach((st, i) => {
      if (st.ph) { stepsCard.append(h('div', { class: 'phase' }, st.ph)); list = h('ol', { class: 'steps-list' }); stepsCard.append(list); }
      const on = stepDone(l, st.k);
      const scoreRow = st.score ? (() => {
        const v = az().progress.scores[l.id];
        const [vc, vt] = verdict(v);
        const vd = h('span', { class: `verdict ${vc}` }, vt);
        const inp = h('input', { type: 'number', min: '0', max: '100', inputmode: 'numeric', 'aria-label': 'Your score (%)' });
        inp.value = v ?? '';
        inp.addEventListener('change', () => post(`/api/az400/${l.id}/score`, { value: inp.value === '' ? null : Number(inp.value) }).catch((e) => toast(e.message)));
        return h('div', { class: 'score' }, h('label', {}, 'Your score (%)'), inp, vd);
      })() : null;
      list.append(h('li', { class: `step ${on ? 'done' : ''}` },
        h('button', { class: 'chk', type: 'button', role: 'checkbox', 'aria-checked': String(on), 'aria-label': `Done: ${st.t}`,
          onclick: () => post(`/api/az400/${l.id}/step`, { key: st.k, done: !on }).then(() => { if (!on && labProgress(l).d + 1 === p.t) toast(isPrep ? 'Preparation complete — on to Lab 00.' : 'All steps ticked. Run Validate.ps1 if you have not: the evidence makes it official.'); }).catch((e) => toast(e.message)) },
          on ? '✓' : String(i + 1)),
        h('div', { class: 'step-body' }, h('h4', {}, st.t), h('p', {}, st.d),
          st.note ? h('div', { class: 'note' }, st.note) : null,
          ...(st.orig ?? []).filter((o) => o[1]).map((o) => h('div', { class: 'orig' }, h('em', {}, `${o[0]} · course text`), o[1])),
          st.code ? codeBlock(st.code) : null,
          st.link || st.link2 ? h('div', { class: 'links' }, st.link ? repoLink(st.link[0], st.link[1]) : null, st.link2 ? repoLink(st.link2[0], st.link2[1]) : null) : null,
          scoreRow)));
    });

    const termCard = state.meta.terminal.enabled ? h('section', { class: 'card term-card' },
      h('div', { class: 'ws-head' }, h('span', { class: 'ws-tab on' }, 'Terminal 1'), h('span', { class: 'ws-spacer' }),
        h('button', { class: 'btn copy', title: 'Paste a cd to the course folder', onclick: () => sendToTerminal(`Set-Location '${state.az400.root}'`) }, 'cd to course'),
        h('button', { class: 'ws-icon', title: 'Clear the screen', onclick: () => post('/api/terminal/clear').catch((e) => toast(e.message)) }, '⌫'),
        h('button', { class: 'btn stop-lab', onclick: () => post('/api/terminal/restart').catch((e) => toast(e.message)) }, '■ Restart')),
      buildTerminal()) : h('section', { class: 'card' }, h('p', { class: 'muted small' }, 'Tip: start the portal with $env:PORTAL_TERMINAL = "1" to run these commands in a terminal right here.'));

    const idx = items.findIndex((x) => itemKey(x) === itemKey(it));
    const nx = items[idx + 1];
    const foot = h('section', { class: 'card foot' },
      h('span', { class: 'muted small' }, isPrep ? 'Finished the preparation? Move on to Lab 00 the same day.' : 'Stuck on a task? Check the README Troubleshooting section and the worked solution — then come back to the method: observation, hypothesis, test, evidence.'),
      nx ? h('button', { class: 'btn btn-primary', onclick: () => { selectItem(itemKey(nx)); window.scrollTo({ top: 0, behavior: 'smooth' }); } }, 'Next item →') : null);
    return [head, evCard, stepsCard, termCard, foot];
  }

  function platformDetail(s, it) {
    const cyc = cycleOf(s.cycle);
    const dot = h('i', { class: 'dot' });
    dot.style.background = 'var(--d-platform)';
    const head = h('section', { class: 'card' },
      h('div', { class: 'lab-top' }, h('span', { class: 'tag' }, dot, `Azure platform · cycle ${s.cycle} · ${cyc.title}`), h('span', { class: 'tag mono' }, `${s.timeMinutes} min`), h('span', { class: 'tag' }, s.topic), checkerChip(s),
        h('span', {}, 'Planned: ', h('b', {}, fmtLong(it.date)))),
      h('h2', { class: 'title' }, h('span', { class: 'num' }, s.id), s.title),
      h('p', { class: 'role' }, `Status: ${stateText(s)}`),
      h('div', { class: 'two' }, h('div', { class: 'box' }, h('h3', {}, 'Scenario'), h('p', {}, s.scenario)), h('div', { class: 'box exam' }, h('h3', {}, 'Mission'), h('p', {}, s.mission))),
      h('div', { class: 'links' }, sessionButton(s), h('a', { href: `#/session/${s.id}`, class: 'btn' }, 'Open the lab workspace →')));
    const nextHere = state.next.sessionId === s.id ? nextCard() : null;
    const crit = h('section', { class: 'card' }, h('h3', {}, 'Success criteria — what to do'), criteriaGuide(s));
    return [head, nextHere, crit];
  }

  // ------------------------------------------------------------ platform helpers
  function sessionButton(s) {
    if (isLocked(s)) return h('button', { class: 'btn btn-ghost', disabled: true }, '🔒 Locked');
    if (s.state === 'AVAILABLE') return h('button', { class: 'btn btn-primary', onclick: (e) => { e.stopPropagation(); openLaunch(s.id, 'start'); } }, 'Start');
    if (s.state === 'COMPLETED') return h('button', { class: 'btn', onclick: (e) => { e.stopPropagation(); location.hash = `#/session/${s.id}`; } }, '✎ Revise');
    return h('button', { class: 'btn btn-warn', onclick: (e) => { e.stopPropagation(); openLaunch(s.id, 'resume'); } }, 'Continue');
  }

  // "What do I do now?" — the first pending criterion and the concrete action.
  function nextCard() {
    const n = state.next;
    const pct = n.progress ? Math.round((n.progress.passed / n.progress.total) * 100) : 0;
    const bar = h('div', { class: 'progress-fill' });
    requestAnimationFrame(() => { bar.style.width = `${pct}%`; });
    return h('section', { class: 'card next-card' },
      h('div', { class: 'next-main' },
        h('div', { class: 'next-label' }, n.checking ? 'Next step · checking your evidence…' : 'Next step'),
        n.session ? h('div', { class: 'next-session' }, n.session) : null,
        h('div', { class: 'next-text' }, n.text),
        n.how ? h('div', { class: 'next-how' }, h('b', {}, 'How: '), n.how) : null,
        n.progress ? h('div', { class: 'next-progress' }, h('div', { class: 'progress-track' }, bar), h('span', { class: 'muted small' }, `${n.progress.passed}/${n.progress.total} criteria verified`)) : null),
      n.sessionId ? h('button', { class: 'btn btn-primary', onclick: () => { location.hash = `#/session/${n.sessionId}`; } }, 'Open session →') : null);
  }

  // Criteria with live status and the concrete action for each one.
  function criteriaGuide(s) {
    const observed = new Map((s.lastObservation?.criteria ?? []).map((c) => [c.id, c.status]));
    let firstPending = true;
    return h('ol', { class: 'crit-guide' }, s.criteria.map((c) => {
      const st = observed.get(c.id) ?? 'none';
      const isNext = st !== 'pass' && firstPending;
      if (isNext) firstPending = false;
      return h('li', { class: `crit-item ${st} ${isNext ? 'next' : ''}` },
        h('div', { class: 'crit-head' }, h('span', { class: 'c-ico' }, { pass: '✓', fail: '✕', skipped: '–', none: '·' }[st]), h('span', {}, c.text), isNext ? h('span', { class: 'chip warn' }, 'do this now') : null),
        c.how ? h('div', { class: 'crit-how' }, c.how) : null);
    }));
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

  // Personal course links (stored locally, never in the repository).
  function linksBlock(target) {
    const list = state.links?.[target] ?? [];
    const open = ui.linkForm === target;
    const block = h('div', { class: 'links-block' },
      h('div', { class: 'links-head' }, h('b', {}, 'My course links'),
        h('button', { class: 'btn copy', onclick: () => { ui.linkForm = open ? null : target; render(true); } }, open ? 'Cancel' : '+ Add link')),
      list.length ? h('ul', { class: 'links-list' }, list.map((l, i) => h('li', {},
        h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, `${l.label} ↗`),
        h('button', { class: 'ws-icon', title: 'Remove link', onclick: () => post(`/api/links/${target}/remove`, { index: i }).catch((e) => toast(e.message)) }, '✕'))))
        : (open ? null : h('div', { class: 'muted small' }, 'Paste the lesson you use for this topic (e.g. a module of your course) to open it from here.')));
    if (open) {
      const label = h('input', { class: 'link-input', type: 'text', placeholder: 'Name, e.g. AZ-400 › Module 12', maxlength: '80' });
      const url = h('input', { class: 'link-input', type: 'url', placeholder: 'https://…', maxlength: '500' });
      const save = () => post(`/api/links/${target}`, { label: label.value, url: url.value })
        .then(() => { ui.linkForm = null; render(true); toast('Link saved.', 'info'); })
        .catch((e) => toast(e.message));
      url.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      block.append(h('div', { class: 'link-form' }, label, url, h('button', { class: 'btn btn-primary copy', onclick: save }, 'Save')));
      requestAnimationFrame(() => label.focus());
    }
    return block;
  }

  function learnBody(s) {
    const L = s.learn;
    const out = [
      h('div', { class: 'learn-banner' }, h('b', {}, 'Learn first. '), 'New to this topic? Read this before the task. Reading it is free — it does not count as a hint.'),
      linksBlock(s.id),
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
      h('div', { class: 'section-title' }, 'Success criteria — what to do'), criteriaGuide(s),
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
      h('button', { class: 'btn btn-later', onclick: () => { location.hash = '#/schedule'; toast('Session kept in progress — the portal keeps watching your evidence.', 'info'); } }, 'Try later'),
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
    if (!s) return renderSchedule();
    if (isLocked(s)) {
      view.replaceChildren(h('section', { class: 'card' }, h('a', { href: '#/schedule', class: 'back' }, '← All sessions'),
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
        h('a', { href: '#/schedule', class: 'ws-icon', title: 'All sessions' }, '✕')),
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

  // ------------------------------------------------------------ charts
  // Single-series SVG charts (no legend: the card title names the series).
  // Thin marks, recessive hairline grid, crosshair / per-bar tooltips, and a
  // data table alongside so no value lives only in the hover layer.
  const SVG = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }
  const shortDate = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };
  function niceMax(v) {
    if (v <= 0) return 4;
    const p = 10 ** Math.floor(Math.log10(v));
    const n = [1, 2, 2.5, 5, 10].find((k) => k * p >= v);
    return n * p;
  }

  function chartCard(title, subtitle, chart) {
    return h('section', { class: 'card chart-card' }, h('h3', {}, title), h('div', { class: 'muted small' }, subtitle), chart);
  }

  function chartFrame(points, maxY, build) {
    const W = 560; const H = 220; const P = { l: 40, r: 16, t: 14, b: 26 };
    const iw = W - P.l - P.r; const ih = H - P.t - P.b;
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
    const y = (v) => P.t + ih - (v / maxY) * ih;
    for (let i = 0; i <= 4; i++) {
      const v = (maxY / 4) * i;
      svg.append(svgEl('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid' }));
      const t = svgEl('text', { x: P.l - 8, y: y(v) + 4, class: 'axis', 'text-anchor': 'end' });
      t.textContent = Number.isInteger(v) ? v : v.toFixed(1);
      svg.append(t);
    }
    const step = iw / Math.max(1, points.length - 1);
    points.forEach((p, i) => {
      if (i % 7 !== points.length % 7 && i !== points.length - 1) return;
      const t = svgEl('text', { x: P.l + i * step, y: H - 6, class: 'axis', 'text-anchor': 'middle' });
      t.textContent = shortDate(p.x);
      svg.append(t);
    });
    const wrap = h('div', { class: 'chart-wrap' });
    const tip = h('div', { class: 'chart-tip hidden' });
    wrap.append(svg, tip);
    build({ svg, W, H, P, iw, ih, y, step, tip, wrap });
    return wrap;
  }

  function showTip(tip, wrap, svg, xSvg, lines) {
    tip.replaceChildren(h('b', {}, lines[0]), ...lines.slice(1).map((l) => h('div', { class: 'muted small' }, l)));
    tip.classList.remove('hidden');
    const r = svg.getBoundingClientRect();
    const px = (xSvg / svg.viewBox.baseVal.width) * r.width;
    tip.style.left = `${Math.min(Math.max(px - 70, 0), r.width - 150)}px`;
  }

  function lineChart(points, { format }) {
    const maxY = niceMax(Math.max(...points.map((p) => p.y)));
    return chartFrame(points, maxY, ({ svg, P, ih, y, step, tip, wrap }) => {
      const xs = points.map((_, i) => P.l + i * step);
      const d = points.map((p, i) => `${i ? 'L' : 'M'}${xs[i]},${y(p.y)}`).join(' ');
      svg.append(svgEl('path', { d: `${d} L${xs.at(-1)},${P.t + ih} L${xs[0]},${P.t + ih} Z`, class: 'area' }));
      svg.append(svgEl('path', { d, class: 'line' }));
      const last = points.at(-1);
      svg.append(svgEl('circle', { cx: xs.at(-1), cy: y(last.y), r: 4.5, class: 'dot' }));
      const label = svgEl('text', { x: xs.at(-1) - 8, y: y(last.y) - 10, class: 'end-label', 'text-anchor': 'end' });
      label.textContent = format(last.y);
      svg.append(label);
      const cross = svgEl('line', { x1: 0, x2: 0, y1: P.t, y2: P.t + ih, class: 'crosshair hidden' });
      const hover = svgEl('circle', { r: 4.5, class: 'dot hidden' });
      svg.append(cross, hover);
      const hit = svgEl('rect', { x: P.l, y: P.t, width: xs.at(-1) - P.l + 1, height: ih, class: 'hit', tabindex: 0 });
      const move = (clientX) => {
        const r = svg.getBoundingClientRect();
        const sx = ((clientX - r.left) / r.width) * svg.viewBox.baseVal.width;
        const i = Math.max(0, Math.min(points.length - 1, Math.round((sx - P.l) / step)));
        cross.setAttribute('x1', xs[i]); cross.setAttribute('x2', xs[i]); cross.classList.remove('hidden');
        hover.setAttribute('cx', xs[i]); hover.setAttribute('cy', y(points[i].y)); hover.classList.remove('hidden');
        showTip(tip, wrap, svg, xs[i], [format(points[i].y), points[i].x]);
      };
      hit.addEventListener('pointermove', (e) => move(e.clientX));
      hit.addEventListener('focus', () => { const r = svg.getBoundingClientRect(); move(r.right - 20); });
      const leave = () => { cross.classList.add('hidden'); hover.classList.add('hidden'); tip.classList.add('hidden'); };
      hit.addEventListener('pointerleave', leave);
      hit.addEventListener('blur', leave);
      svg.append(hit);
    });
  }

  function columnChart(points) {
    const maxY = niceMax(Math.max(...points.map((p) => p.y)));
    return chartFrame(points, maxY, ({ svg, P, ih, y, step, tip, wrap }) => {
      const bw = Math.min(14, step - 2);
      points.forEach((p, i) => {
        const cx = P.l + i * step;
        if (p.y > 0) {
          const top = y(p.y);
          const hgt = P.t + ih - top;
          const r = Math.min(4, bw / 2, hgt);
          // Rounded data end, square at the baseline.
          svg.append(svgEl('path', { class: 'bar', d: `M${cx - bw / 2},${P.t + ih} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${P.t + ih} Z` }));
        }
        const hit = svgEl('rect', { x: cx - step / 2, y: P.t, width: step, height: ih, class: 'hit', tabindex: 0 });
        const on = () => showTip(tip, wrap, svg, cx, [`${p.y} actions`, p.x, ...p.detail.filter((t) => !t.startsWith('0 '))]);
        hit.addEventListener('pointerenter', on);
        hit.addEventListener('focus', on);
        hit.addEventListener('pointerleave', () => tip.classList.add('hidden'));
        hit.addEventListener('blur', () => tip.classList.add('hidden'));
        svg.append(hit);
      });
    });
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
    const tl = state.timeline;
    const actions = (d) => d.checks + d.interview + d.study + d.hints + (d.steps ?? 0) + d.completions;
    const activeDays = tl.filter((d) => actions(d) > 0).length;
    const tableOpen = ui.progressTable === true;
    const labsVerified = state.az400.available ? state.az400.labs.filter((l) => state.az400.progress.completions[l.id]).length : 0;
    view.replaceChildren(
      h('section', { class: 'card' }, h('h2', {}, 'Progress'),
        h('div', { class: 'stats' },
          h('div', { class: 'stat ok' }, h('b', {}, labsVerified), h('span', {}, 'AZ-400 labs verified')),
          h('div', { class: 'stat info' }, h('b', {}, done.length), h('span', {}, `Platform sessions (${solo} SOLO)`)),
          h('div', { class: 'stat warn' }, h('b', {}, Object.keys(state.az400.progress.scores).length), h('span', {}, 'Question sets scored')),
          h('div', { class: 'stat lock' }, h('b', {}, activeDays), h('span', {}, 'Active days (last 30)')))),
      h('div', { class: 'grid-2' },
        chartCard('Cumulative XP', `${state.totals.xp} XP · next rank ${state.totals.nextRank ? `${state.totals.nextRank.title} at ${state.totals.nextRank.minXp}` : 'reached'}`,
          lineChart(tl.map((d) => ({ x: d.date, y: d.xp })), { format: (v) => `${v} XP` })),
        chartCard('Daily practice', 'Lab steps, checker runs, completions, interview passes, study items and hints per day',
          columnChart(tl.map((d) => ({ x: d.date, y: actions(d), detail: [`${d.steps ?? 0} lab steps`, `${d.checks} checks`, `${d.completions} completions`, `${d.interview} interview passes`, `${d.study} study items`, `${d.hints} hints`] }))))),
      h('section', { class: 'card' }, h('h3', {}, 'Completion by cycle'),
        h('div', { class: 'meters' }, state.track.cycles.map((c) => {
          const list = state.sessions.filter((s) => s.cycle === c.id);
          const n = list.filter((s) => s.state === 'COMPLETED').length;
          const fill = h('div', { class: 'meter-fill' });
          requestAnimationFrame(() => { fill.style.width = `${(n / list.length) * 100}%`; });
          return h('div', { class: 'meter-row' }, h('span', { class: 'meter-label' }, `Cycle ${c.id} · ${c.title}`),
            h('div', { class: 'meter-track', role: 'img', 'aria-label': `${n} of ${list.length} sessions completed` }, fill), h('span', { class: 'meter-value' }, `${n}/${list.length}`));
        }))),
      h('section', { class: 'card' },
        h('div', { class: 'how-head' }, h('h3', {}, 'Data table (last 30 days)'),
          h('button', { class: 'btn copy', onclick: () => { ui.progressTable = !tableOpen; render(true); } }, tableOpen ? 'Hide table' : 'Show data table')),
        tableOpen ? h('table', {}, h('thead', {}, h('tr', {}, ['Date', 'XP (cumulative)', 'Lab steps', 'Checks', 'Completions', 'Interview', 'Study', 'Hints'].map((t) => h('th', {}, t)))),
          h('tbody', {}, tl.slice().reverse().map((d) => h('tr', {}, [d.date, d.xp, d.steps ?? 0, d.checks, d.completions, d.interview, d.study, d.hints].map((v) => h('td', {}, v)))))) : null),
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
            linksBlock(item.id),
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
    return { view: ['schedule', 'map', 'progress', 'environment', 'study', 'interview'].includes(parts[0]) ? parts[0] : 'schedule' };
  }

  function render(force = false) {
    if (!state) return;
    // Do not rebuild the page under the learner's cursor while they type.
    const active = document.activeElement;
    if (!force && active && (active.tagName === 'TEXTAREA' || active.closest?.('.link-form'))) return;
    const y = window.scrollY;
    renderChrome();
    const r = route();
    if (r.view === 'session') renderWorkspace(r.id);
    else if (r.view === 'map') renderMap();
    else if (r.view === 'progress') renderProgress();
    else if (r.view === 'environment') renderEnvironment();
    else if (r.view === 'study') renderStudy();
    else if (r.view === 'interview') renderInterview();
    else renderSchedule();
    window.scrollTo(0, y);
  }

  window.addEventListener('hashchange', () => { render(true); window.scrollTo(0, 0); });
  setInterval(() => render(), 15000); // refresh relative times

  // ------------------------------------------------------------ celebration
  function celebrate(e) {
    $('#cele-title').textContent = e.kind === 'az400' ? `Lab ${e.number} verified!` : `Session ${e.number} complete!`;
    $('#cele-sub').textContent = e.title;
    $('#cele-rewards').replaceChildren(
      h('span', { class: 'reward xp' }, `+${e.rewards.xp} XP`),
      h('span', { class: 'reward coins' }, `+${e.rewards.coins} ●`),
      h('span', { class: 'reward mode' }, e.mode === 'VERIFIED' ? 'Validate.ps1 ✓' : e.mode === 'SOLO' ? 'SOLO' : 'AI-assisted'));
    $('#cele-badges').textContent = e.badges.length ? `Badges: ${e.badges.map((b) => b.title).join(' · ')}` : '';
    $('#cele-next').textContent = e.kind === 'az400' ? 'Evidence read from the course validation.json.' : e.unlocked ? `Unlocked: Session ${state ? state.sessions.findIndex((s) => s.id === e.unlocked.id) + 1 : ''} — ${e.unlocked.title}` : 'Track complete!';
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
