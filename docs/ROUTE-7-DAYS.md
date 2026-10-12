# 7-day personal route — Azure DevOps Consultant interview

Built with the **"personal route architect"** prompt:

> My goal is **to pass an English interview for an Azure DevOps Consultant role**: to **deliver a 2-minute architecture pitch and answer the most likely technical and consulting questions in ≤ 2 minutes each, with structure (answer → why → example → risk)** within **7 days** — not to learn Azure in general.
> I already master **Azure DevOps pipelines, GitHub Actions (GH-200), Terraform, Datadog/Dynatrace and day-to-day Azure work**.
> Build a 7-day route with one daily task of **at most 45 minutes**, a success criterion, and what NOT to do. Redo it until it leads to the goal.

## Rules of the route

- **One task per day, 45 minutes, timer on.** Stop when it rings, even if unfinished — record what was left.
- **Speak, don't read.** Every answer is said out loud and recorded (phone voice memo). Reading answers ≠ being able to give them.
- **Nothing gets deployed.** The interview tests explanation, not `terraform apply`. The lab is for after the interview.
- **Daily log** (2 lines at the end): criterion met? yes/no — what failed.
- **Re-plan rule:** if a day's criterion fails, the first 15 minutes of the next day redo the failed item, and that day's task is cut to 30 minutes. Day 7 produces the gap list for the next route.
- **Interview sooner than 7 days?** Do days 1 → 3 → 6 → 7 (pitch, pipelines, consulting stories, mock), in that order.

## The route

| Day | Task (≤ 45 min) | Success criterion | Don't |
|---:|---|---|---|
| 1 | **Pitch.** Read `HOW-IT-WORKS.md` §1–2 (10 min). Rewrite `docs/interview/01-pitch.md` in your own words (15 min). Record the 30 s and 2 min versions three times each (20 min). | 2-min pitch in **≤ 2:15**, without reading, **≤ 3 hesitations** ("uh", restarts) in the third take. | Don't add services to sound impressive. Don't memorize word for word — memorize the 7 beats. |
| 2 | **Terraform block.** Questions A1–A9 in `02-technical-answers.md`: answer each out loud **before** reading the model answer (3 min each), then compare. | **7 of 9** answers contain *one-sentence answer + why + example from the lab*. | Don't read the model answers first. Don't explain HCL syntax — explain decisions (state, layers, drift, secrets). |
| 3 | **Azure DevOps from memory.** In 15 min, write a multi-stage YAML on paper/editor: Validate → Plan → Apply (deployment job + environment), WIF service connection, variable group, template. Compare with `pipelines/azure-devops/infra.yml` (10 min). Answer B10–B16 out loud (20 min). | YAML has **stages, deployment job, environment, compile-time service connection, template** — no peeking. B10 answered in ≤ 2 min with the 6 setup steps in order. | Don't open the Azure DevOps portal. Don't study classic releases in depth — just how to migrate them. |
| 4 | **AKS + networking.** Draw the request flow (HOW-IT-WORKS §7.1) and the identity flow (§7.2) from memory (15 min). Answer C18–C24 and D25–D29 (30 min). | Request flow with **7 hops** and private-endpoint DNS explained in **≤ 90 s**; Workload Identity explained without saying "it just works". | Don't go into CNI/eBPF internals. Don't compare every ingress controller. |
| 5 | **Security, governance, observability.** E30–E34 and F35–F38 out loud (30 min). Prepare **one troubleshooting STAR story** (auth vs authz, e.g. a service connection/federation failure) (15 min). | Policy vs RBAC and Audit→Deny rollout explained with a consultant tone; STAR story **≤ 2 min, uses "I", ends with a measurable result**. | Don't list Defender plans or policy IDs. Don't tell a story without a result. |
| 6 | **Consulting.** Fill the 4 STAR stories in `03-consultant-scenarios.md` with real projects (25 min). Rehearse the 60-second self-introduction from `04-interview-english.md` (10 min). Pick 3 questions to ask them (10 min). | 4 stories written, each told in **≤ 2 min**; self-intro in **≤ 60 s**; zero false friends (*actually*, *assist*, *pretend*, *realize*). | Don't invent stories. Don't criticise a former employer or client. |
| 7 | **Mock interview.** Self-intro → 2-min pitch → 8 random questions (mix A–F + 2 consulting) → design question G39. Timer per answer (40 min). Write the gap list (5 min). | **≥ 8 of 10 answers ≤ 2 min with structure**; G39 starts with clarifying questions; gap list has ≤ 3 items. | Don't study new content on day 7. Don't redo the whole route — only the gaps. |

## Redo loop (until the goal)

After day 7:

1. Each gap becomes a **45-minute task** with its own criterion (same format as above).
2. If the interview is still ahead, run a **mini-route** with only those tasks plus a mock on the last day.
3. Bring the gap list back to the assistant and ask: *"Redo the route with these gaps: …"* — the route is regenerated until the mock passes.
4. **Night before the interview:** pitch once, STAR stories once, the "buying time" phrases once. Sleep.

## Daily log

| Day | Criterion met? | What failed | Redo tomorrow? |
|---:|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |
| 6 | | | |
| 7 | | | |
