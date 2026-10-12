# Consultant scenarios

Consulting interviews test whether you can **work with clients**, not only with Azure. Expect at least one of each category below.

## The STAR shape (use it for every "tell me about a time…")

| Letter | What to say | Length |
|---|---|---|
| **S**ituation | Client, context, why it mattered | 1–2 sentences |
| **T**ask | Your responsibility | 1 sentence |
| **A**ction | What **you** did — "I", not "we" — with 2–3 concrete steps | most of the answer |
| **R**esult | Measurable outcome + what you learned | 1–2 sentences |

## Write your own stories (fill these in — use real projects)

Prepare **four** stories. Each one can answer several questions.

1. **A technical problem you solved under pressure**
   *Prompt:* a pipeline/service connection/identity failure; how you separated authentication vs authorization; the fix.
   - S: …
   - T: …
   - A: …
   - R: …

2. **A migration or modernization** *(e.g. repository / pipeline migration between Azure DevOps organizations, moving from secrets to workload identity federation)*
   - S: …
   - T: …
   - A: …
   - R: …

3. **A disagreement with a client or teammate**
   - S: …
   - T: …
   - A: … (listened, used data, proposed options, let the client decide)
   - R: …

4. **Something that went wrong — and what you changed afterwards**
   - S: …
   - T: …
   - A: …
   - R: … (the process improvement is the point)

## Scenario questions and how to approach them

**"A client wants to move to Azure 'as fast as possible'. Where do you start?"**
Discovery before tooling: business drivers, timeline, compliance, current inventory, team skills. Then propose a landing zone with guardrails first, a pilot workload, and a migration wave plan. "Fast" without a foundation becomes rework.

**"The client insists on a decision you think is wrong."** *(e.g. secrets in pipeline variables, Owner role for the pipeline)*
Understand their reason first; explain the risk in business terms (audit finding, incident); offer alternatives with effort estimates; if they still decide, document the decision and the risk (ADR / email) and make it as safe as possible. The client owns the decision; you own the advice.

**"How do you handle a production incident at a client?"**
Stabilize first (rollback / failover), communicate status on a fixed cadence, keep a timeline, then a blameless post-mortem with action items. Mention observability: the alert should have told us before the customer did.

**"How do you estimate a piece of work?"**
Break it into deliverables, estimate with ranges, call out assumptions and dependencies (access, approvals, client availability), add buffer for unknowns, and re-estimate after discovery.

**"How do you transfer knowledge to the client's team?"**
Pair on the work instead of handing over at the end, write runbooks and ADRs, record short walkthroughs, and plan a period where the client operates and you support.

**"The client's cloud bill doubled. What do you do?"**
Cost Management by tag/resource group to find the driver; quick wins (idle resources, oversized SKUs, log ingestion, dev environments running 24/7); structural fixes (reservations / savings plans, autoscaling, ephemeral environments, budgets with alerts, tagging policy).

**"Why consulting?"** *(prepare a sincere 20-second answer)*
Variety of clients and problems, learning fast, impact on many teams, and enjoying the communication side of engineering.

## Questions to ask them at the end (pick 2–3)

- "What does a typical engagement look like — length, team size, how much is hands-on versus advisory?"
- "Which Azure DevOps or platform challenges are your clients facing most right now?"
- "How do you support consultants keeping certifications and skills current?"
- "What would success look like for this role in the first 90 days?"
