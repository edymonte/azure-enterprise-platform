# Agent instructions (Codex and other assistants)

Read [CLAUDE.md](CLAUDE.md) before working in this repository. Its architecture, English-only content convention, protected-`main` PR/CI process, IaC/GitOps rules, security constraints, cloud-cost approvals, and guided-lab protocol apply to every coding agent.

## Execution ownership

- **Claude Code in the VS Code extension is Edilson's primary technical executor.**
- **ChatGPT Chat** is the mentor for Azure/DevOps learning, decisions, interviews, and English.
- **ChatGPT Work** supports planning, analysis, documentation, progress tracking, and review. It does not start a competing lab or implement code without an explicit assignment.
- **Codex in VS Code is backup only:** step in if Claude's token availability is temporarily exhausted and Edilson explicitly requests the switch. Do not operate in parallel with Claude or silently take ownership.

## Continuity checklist

1. Use the existing `azure-enterprise-platform` lab and `portal/` schedule, including the 8-hour recovery sprint followed by the ordered platform and AZ-400 activities. Do not duplicate labs or create another curriculum.
2. On takeover, inspect the active branch, `git status`, recent commits, the current issue/PR, available handoff notes, and portal progress **before changing files**.
3. Resume the same scoped task. Do not overwrite uncommitted work; stop and ask if ownership or state is uncertain.
4. At handoff, summarize the task, branch/commit, changed files, evidence/checks, blockers, next safe step, and any active Azure-cost exposure. Do not copy secrets into summaries.
5. Respect the protected branch workflow and Edilson's explicit approval for infrastructure apply/destroy, paid resources, external actions, or destructive changes.

If a rule conflicts with repository guidance, ask Edilson before proceeding.
