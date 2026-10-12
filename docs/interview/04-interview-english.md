# Interview English — phrase bank for engineers

## 1. Structuring an answer

- "There are **three things** I'd look at here. First… second… and finally…"
- "**The short answer is** X. **The longer answer depends on** Y."
- "**The main trade-off is** between cost and isolation."
- "**In my experience**, … / **In my last project**, …"
- "**To sum up**, I'd go with X because …"

## 2. Buying time (sounds thoughtful, not lost)

- "That's a good question — **let me think about it for a second.**"
- "**Just to make sure I understand** the question: you mean … ?"
- "**Can I assume** this is a production environment?"
- "**Let me draw this quickly**, it's easier to explain with a diagram."

## 3. When you don't know

- "**I haven't used** X in production, **but** I've used Y, which solves the same problem. **The way I'd approach it** is …"
- "**I'm not 100% sure** about the exact limit, **I'd double-check** the documentation, **but my understanding is** …"

Never bluff. Consulting interviewers value honesty plus a method.

## 4. Disagreeing and advising (consultant tone)

- "**I see your point.** **One risk I'd like to flag** is …"
- "**An alternative would be** …, **which gives you** … **at the cost of** …"
- "**My recommendation would be** X, **but it's your call** — **I'll document** the trade-off."
- "**Would it help if I** prepared a short comparison of the options?"

## 5. Describing troubleshooting

- "**First, I'd check** whether it's a network issue or an identity issue."
- "**My hypothesis was** that DNS was resolving to the public IP."
- "**To confirm it**, I ran nslookup from inside the cluster, **and it turned out** …"
- "**The root cause was** a missing private DNS zone link. **We fixed it** in Terraform **and added** a check to prevent it."

## 6. False friends for Portuguese speakers (very common in interviews)

| Don't say | When you mean | Say |
|---|---|---|
| "**Actually** I work at…" | *atualmente* | "**Currently** I work at…" |
| "**Eventually** we had problems" | *eventualmente* (sometimes) | "**Occasionally** / **from time to time**" (*eventually* = in the end) |
| "I **assisted** the meeting" | *assisti* | "I **attended** the meeting" |
| "I **pretend** to work with AKS" | *pretendo* | "I **intend / plan** to work with AKS" |
| "I **realized** the migration" | *realizei* | "I **carried out / delivered / led** the migration" |
| "The **responsible** for the pipeline" | *o responsável* | "The **person responsible for** / **owner of** the pipeline" |
| "I have **5 years of experience in DevOps**" ✔️ | | correct — but avoid "I **have** 30 years" for age: "I **am** 30" |
| "It **lacks** of documentation" | *falta* | "It **lacks** documentation" (no "of") |
| "**Make** a question" | *fazer uma pergunta* | "**Ask** a question" |
| "**Discuss about** it" | *discutir sobre* | "**Discuss** it" |
| "**Explain me**" | *me explica* | "**Explain to me**" / "Could you explain…" |
| "The **informations**" | *as informações* | "The **information**" (uncountable) |
| "**Datas**" | *dados* | "**data**" (and *date* = data do calendário) |
| "**Push** the changes **in** production" | | "**deploy** the changes **to** production" |

## 7. Pronunciation traps (tech words)

| Word | Tip |
|---|---|
| **Azure** | "**AZH**-er" — /ˈæʒər/. Not "a-ZU-re". |
| **cache** | "**cash**" — one syllable. |
| **route** | US "**raut**" or "**root**" — both fine; be consistent. |
| **Kubernetes** | "koo-ber-**NET**-eez" |
| **kubectl** | "**cube**-control" or "cube-C-T-L" — both used. |
| **YAML** | "**YAM**-ul" |
| **Linux** | "**LIN**-ux" (short i) |
| **SQL** | "**sequel**" or "S-Q-L" — Microsoft people usually say "sequel". |
| **Terraform** | "**TEH**-ra-form" |
| **deploy / deployment** | stress on "**PLOY**": de-**PLOY**-ment |
| **suite** (test suite) | "**sweet**" |
| **analysis / analyses** | "a-**NAL**-ysis" |

## 8. Small things that make you sound fluent

- Use **contractions**: "I'd", "it's", "we'll", "didn't".
- Prefer **short sentences**. One idea per sentence.
- Signpost: "**So**, …", "**Basically**, …", "**The thing is**, …" — but don't overuse "basically".
- When you finish an answer, **stop**. Optionally: "**Does that answer your question?**" or "**Happy to go deeper** on any part."

## 9. Self-introduction template (60 seconds)

> "Hi, I'm Edilson. I'm a DevOps engineer focused on Azure, with experience in **[X years]** building CI/CD pipelines in Azure DevOps and GitHub Actions — I'm GitHub Actions certified (GH-200) — and infrastructure as code with Terraform. Recently I've been working on **[real project: e.g. migrating repositories and pipelines between Azure DevOps organizations, moving service connections to workload identity federation]**, and on observability with **Datadog** and Dynatrace. To sharpen my AKS and platform skills I also built an enterprise-style reference platform — AKS with GitOps, private endpoints, Azure Policy and Front Door — fully in Terraform. I enjoy consulting because **[your reason]**, and I'm looking for an international role where I can work with different clients on Azure platforms."

Fill the brackets with **true** details, then rehearse until it fits in 60 seconds.
