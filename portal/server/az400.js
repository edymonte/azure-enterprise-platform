// AZ-400 course integration. The course lives in its own repository
// (PORTAL_AZ400_ROOT); the portal reads its lab catalog and the evidence its
// own Validate.ps1 writes, and never copies course content into this repo.
//
//   <root>/curriculum/lab-content.yml          lab catalog (JSON content)
//   <root>/.state/<labId>/<runId>/validation.json   evidence written by Validate.ps1
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { runCommand } from '../lib/exec.js';

const LAB_ID = /^[0-2][0-9]$/;
const RUN_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

function githubBlobUrl(remote) {
  const m = /github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/i.exec((remote || '').trim());
  return m ? `https://github.com/${m[1]}/${m[2]}/blob/main/` : null;
}

export class Az400 extends EventEmitter {
  constructor({ root }) {
    super();
    this.root = root;
    this.available = false;
    this.labs = [];
    this.evidence = {};
    this.repoUrl = null;
    this.error = null;
    this.watchers = [];
    this.timer = null;
  }

  async load() {
    const file = path.join(this.root, 'curriculum', 'lab-content.yml');
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      // Full task content (commands, validations, break/fix) is served on demand
      // by detail(); the state pushed to the browser keeps only the summary.
      this.raw = new Map((data.labs ?? []).filter((l) => LAB_ID.test(l.id)).map((l) => [l.id, l]));
      this.labs = (data.labs ?? []).filter((l) => LAB_ID.test(l.id)).map((l) => ({
        id: l.id,
        slug: l.slug,
        title: l.title,
        domain: l.domain,
        minutes: l.minutes,
        cost: l.cost,
        platforms: l.platforms ?? [],
        role: l.role,
        scenario: l.scenario,
        outcome: l.outcome,
        primer: l.primer,
        challenge: l.challenge,
        objectives: l.objectives ?? [],
        verification: l.verification?.status ?? null,
        checkpoints: (l.checkpoints ?? []).map((c) => ({ id: c.id, title: c.title, expected: c.expected, fix: c.fix })),
      }));
      this.available = this.labs.length > 0;
      this.error = this.available ? null : 'lab-content.yml has no labs';
    } catch (err) {
      this.available = false;
      this.error = `AZ-400 course not found at ${this.root} (${err.code ?? err.message}). Clone it there or set PORTAL_AZ400_ROOT.`;
      return this;
    }
    const remote = await runCommand('git', ['remote', 'get-url', 'origin'], { cwd: this.root, timeoutMs: 10000 });
    this.repoUrl = remote.code === 0 ? githubBlobUrl(remote.stdout) : null;
    this.scan();
    return this;
  }

  // Task content of one lab: the five checkpoints' commands and validations,
  // the break/fix and the challenge.
  detail(labId) {
    const l = this.raw?.get(labId);
    if (!l) return null;
    const str = (v) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').replace(/\n+$/, '') : null);
    return {
      id: l.id,
      checkpoints: (l.checkpoints ?? []).map((c) => ({
        id: c.id, title: c.title, expected: c.expected, fix: c.fix, evidence: c.evidence ?? null,
        commands: str(c.commands), positive: str(c.positive), negative: str(c.negative),
      })),
      breakFix: l.breakFix ? {
        trigger: str(l.breakFix.trigger), diagnose: str(l.breakFix.diagnose), repair: str(l.breakFix.repair),
        assert: str(l.breakFix.assert), expectedFailure: l.breakFix.expectedFailure ?? null,
      } : null,
      challenge: l.challenge ?? null,
      solutionNotes: l.solutionNotes ?? null,
      sources: l.sources ?? [],
    };
  }

  // The lab's practice questions (labs 01–25), read from labs/<slug>/questions.yml.
  questions(labId) {
    const l = this.raw?.get(labId);
    if (!l) return null;
    try {
      const q = JSON.parse(fs.readFileSync(path.join(this.root, 'labs', l.slug, 'questions.yml'), 'utf8').replace(/^﻿/, ''));
      const sources = new Map((q.sources ?? []).map((s) => [s.id, s.url]));
      const evidence = readEvidence(path.join(this.root, 'labs', l.slug, 'evidence.json'), sources);
      return (q.questions ?? []).map((x) => ({
        id: String(x.id),
        checkpointId: x.checkpointId ?? null,
        difficulty: x.difficulty ?? null,
        question: String(x.question),
        options: (x.options ?? []).map((o) => ({ key: String(o.key), text: String(o.text), rationale: o.rationale ? String(o.rationale) : '' })),
        correct: (x.correctAnswers ?? []).map(String),
        explanation: x.explanation ? String(x.explanation) : '',
        sources: (x.sourceIds ?? []).map((id) => sources.get(id)).filter(Boolean),
        evidence: evidence.get(String(x.id)) ?? null,
      }));
    } catch {
      return [];
    }
  }

  // Grades a quiz submission on the server: { questionId: ["A", …] } → result.
  grade(labId, answers) {
    const qs = this.questions(labId) ?? [];
    if (!qs.length) return null;
    let correct = 0;
    const wrong = [];
    for (const q of qs) {
      const given = Array.isArray(answers?.[q.id]) ? [...new Set(answers[q.id].map(String))].sort() : [];
      const ok = given.length === q.correct.length && [...q.correct].sort().every((k, i) => k === given[i]);
      if (ok) correct += 1;
      else wrong.push(q.id);
    }
    return { total: qs.length, correct, pct: Math.round((correct / qs.length) * 100), wrong };
  }

  // Reads every validation.json; keeps, per lab, the most recent verification.
  scan() {
    const next = {};
    const stateDir = path.join(this.root, '.state');
    for (const labId of safeList(stateDir)) {
      if (!LAB_ID.test(labId)) continue;
      for (const runId of safeList(path.join(stateDir, labId))) {
        if (!RUN_ID.test(runId)) continue;
        const file = path.join(stateDir, labId, runId, 'validation.json');
        let v;
        try {
          v = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
        } catch {
          continue;
        }
        if (v.labId !== labId || !['passed', 'failed', 'partial'].includes(v.status)) continue;
        const entry = {
          runId,
          status: v.status,
          verifiedAt: typeof v.verifiedAt === 'string' ? v.verifiedAt : null,
          breakFix: v.breakFix ?? null,
          integration: v.integration ?? null,
          checkpoints: Array.isArray(v.checkpoints) ? v.checkpoints.map((c) => ({ id: String(c.id), status: String(c.status), reason: c.reason ? String(c.reason).slice(0, 300) : undefined })) : [],
        };
        const prev = next[labId];
        if (!prev || (entry.verifiedAt ?? '') > (prev.verifiedAt ?? '')) next[labId] = entry;
      }
    }
    const changed = JSON.stringify(next) !== JSON.stringify(this.evidence);
    this.evidence = next;
    if (changed) this.emit('evidence', this.evidence);
    return changed;
  }

  // Watch the evidence folder (and poll as a fallback: .state may not exist yet).
  start() {
    if (!this.available) return;
    const rescan = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.scan(), 800);
    };
    const stateDir = path.join(this.root, '.state');
    const watchState = () => {
      try {
        const w = fs.watch(stateDir, { recursive: true }, (_e, f) => { if (!f || /validation\.json$/.test(f)) rescan(); });
        w.on('error', () => {});
        this.watchers.push(w);
        return true;
      } catch {
        return false;
      }
    };
    // .state is created by the course's first Setup.ps1: until then, watch
    // the course root for it and switch to the recursive watch when it appears.
    if (!watchState()) {
      try {
        const rootWatcher = fs.watch(this.root, (_e, f) => {
          if (f === '.state' && watchState()) {
            rootWatcher.close();
            rescan();
          }
        });
        rootWatcher.on('error', () => {});
        this.watchers.push(rootWatcher);
      } catch {
        // Course folder not watchable: the poll below still works.
      }
    }
    this.poll = setInterval(() => this.scan(), 10000);
    this.poll.unref?.();
  }

  stop() {
    for (const w of this.watchers) w.close();
    clearInterval(this.poll);
    clearTimeout(this.timer);
  }
}

function safeList(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export { LAB_ID, RUN_ID };

// Optional per-question documentation evidence (labs/<slug>/evidence.json):
// the source page, a short verbatim phrase and a URL that opens the page with
// that phrase highlighted (text fragment). Missing or broken files mean none.
function readEvidence(file, sources) {
  const out = new Map();
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return out;
  }
  for (const [qid, item] of Object.entries(doc.items ?? {})) {
    const url = sources.get(item?.sourceId);
    if (!url || typeof item.highlight !== 'string' || typeof item.summary !== 'string') continue;
    out.set(qid, {
      url,
      highlightUrl: `${url.split('#')[0]}#:~:text=${textFragment(item.highlight)}`,
      highlight: item.highlight,
      summary: item.summary,
      support: item.support === 'direct' ? 'direct' : 'principle',
    });
  }
  return out;
}

// Text fragments treat "-", "," and "&" as syntax, so they must be escaped too.
function textFragment(text) {
  return encodeURIComponent(text).replace(/-/g, '%2D');
}
