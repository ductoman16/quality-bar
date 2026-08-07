# Swarm-themed project name collision check

Status: naming research performed **2026-07-22** for the proposed open-source AI code-review project. This is a practical knockout screen, not a trademark clearance or legal opinion.

## Question

How collision-prone are **DiffSwarm**, **CounterSwarm**, **SwarmCheck**, **SwarmGuard**, and **SwarmWatch** across active software products, open-source projects, developer package registries, domains, companies, and obvious trademark records?

## Bottom line

Do not adopt any of the five without accepting an existing collision. Four are clear knockouts; **CounterSwarm** is the least bad, but it is not clean.

| Name | Verdict | Why |
| --- | --- | --- |
| **DiffSwarm** | **Hard stop** | An active commercial product already uses multiple independent agents to review PRs, challenge findings, reach consensus, and report code issues. This is effectively the same product category and brand story. |
| **SwarmWatch** | **Hard stop** | An active open-source product already monitors and controls AI coding-agent swarms, with approvals and audit trails. |
| **SwarmCheck** | **Hard stop** | An active AI QA product runs swarm-based checks on every PR, and a second established AI platform uses the same name. |
| **SwarmGuard** | **Hard stop** | An active software/security company uses the exact name and GitHub organization, all four checked domain variants are registered, and an active international trademark application covers software and SaaS/security categories. |
| **CounterSwarm** | **Avoid** | The exact name is already used by an active defensive-readiness software company and a counter-drone simulation project. It is in a different market, but the brand and search territory are occupied. |

Collision severity, from worst to least bad: **DiffSwarm**, **SwarmWatch**, **SwarmCheck**, **SwarmGuard**, **CounterSwarm**.

## Findings by name

### DiffSwarm — direct same-field collision

This is the decisive collision in the list. The live commercial [DiffSwarm product](https://diffswarm.com/) describes itself as a local, multi-agent PR-review and security-audit CLI. Several independent agents inspect a complete PR, challenge candidate findings, vote against evidence thresholds, and produce a report. It supports Claude Code and Codex, can comment on GitHub PRs, and charges a subscription. Its [documentation](https://diffswarm.com/docs) exposes `diffswarm pr` and `diffswarm diff` commands, and its [pricing page](https://www.diffswarm.com/pricing) confirms the product is being sold.

There is also a separate MIT-licensed repository, [thejchap/diffswarm](https://github.com/thejchap/diffswarm), described as “github-style review and workflow for any unified diff” and linked to `diffswarm.dev`. The commercial CLI has a separate [Homebrew tap](https://github.com/bro4all/homebrew-diffswarm). Thus the exact name is already occupied by at least one direct competitor and one additional diff-review project.

This is not a case where two projects merely happen to contain “diff.” Users searching for DiffSwarm would find an already-launched multi-agent code-review tool whose pitch closely matches this project.

### CounterSwarm — least bad, but still occupied

[CounterSwarm](https://counterswarmhq.com/company) is an active software company building defensive-readiness, scenario-simulation, incident-response, and reporting software for counter-drone and critical-infrastructure teams. That is a different buyer and product category from code review, so the likelihood of ordinary product confusion is materially lower than for DiffSwarm, SwarmWatch, or SwarmCheck.

However, the exact name is already in use by a technology company, `counterswarm.com` is registered, and the exact GitHub account [github.com/counterswarm](https://github.com/counterswarm) is occupied. An independent [Counter-Swarm repository](https://github.com/AravKaul20/counterswarm) also implements a heterogeneous counter-drone swarm-defense simulation.

“Counter-swarm” is established defense terminology rather than a distinctive coined software name; the UK government has used “counter-swarm systems” in an official [defense competition](https://www.gov.uk/government/publications/competition-many-drones-make-light-work-phase-3/competition-document-many-drones-make-light-work-phase-3). That makes search results and ownership of the concept noisier even if the industries could legally coexist.

If one of these five had to be retained, this is the only remotely defensible choice. It would still begin life with avoidable brand and search confusion.

### SwarmCheck — adjacent developer-quality collision

[Swarmcheck AI](https://www.swarmcheckai.com/) is an active AI QA product that tests UI flows and AI features with persona swarms and semantic assertions. Its site explicitly positions those checks on every pull request and covers hallucinations, prompt injection, and response-quality regressions. That is not identical to code review, but it occupies the same developer-quality, AI-agent, PR-check neighborhood.

A separate established [Swarmcheck platform](https://www.swarmcheck.ai/home) uses AI-assisted argumentation and collective intelligence for decision support. Its official [technology page](https://www.swarmcheck.ai/tech) identifies Swarmcheck as a brand and company owned by the Optimum Pareto Foundation. The exact GitHub organization [github.com/Swarmcheck](https://github.com/Swarmcheck) is also occupied.

Two active exact-name products, one strongly adjacent to AI software quality on PRs, make this a hard stop despite some useful developer domains lacking current RDAP records.

### SwarmGuard — active software/security brand and trademark risk

[SwarmGuard](https://swarmguard.com/) is an active secure-connectivity and remote-access platform. Its [technology page](https://swarmguard.com/technology/) describes an encrypted overlay network built around WireGuard, and its [privacy policy](https://swarmguard.com/privacy-policy/) identifies Inalp Solutions AG as the operator. The company also controls the exact [SwarmGuard GitHub organization](https://github.com/swarmguard), whose description and linked site match that product.

There are several other exact-name repositories, including an [AI-native autonomous workforce system](https://github.com/Abdulazeez41/SwarmGuard), so the name is noisy even beyond the established commercial product.

The trademark signal is material. Inalp Group AG filed international registration 1855593 / US serial 79424210 for **SWARMGUARD** across software, networking, remote monitoring, SaaS/PaaS, computer security, and related services. The USPTO issued a [nonfinal provisional full refusal](https://tmng-al.uspto.gov/resting2/api/casedoc/cms/case/79424210/office-action/OfficeAction7674108.pdf) requiring clearer goods/services wording; it was not a finding that the name was free for others. Canada's official database currently shows the corresponding [application 2400195](https://ised-isde.canada.ca/cipo/trademark-search/2400195?lang=eng) as active and under examination.

This report does not resolve the application's ultimate status or geographic scope. The active marketplace use, exact domain/handle ownership, and live international application are already enough to reject the name for this project.

### SwarmWatch — direct coding-agent ecosystem collision

[SwarmPack/SwarmWatch](https://github.com/SwarmPack/SwarmWatch) is an active MIT-licensed activity monitor and control plane for AI coding swarms. Its [product page](https://swarmpack.github.io/landing-page/) says it works with Claude, Cursor, GitHub Copilot, Cline, and VS Code plugins, and includes bidirectional approvals and audit trails. That is adjacent enough to this project's coding-agent oversight story to create routine confusion.

A second repository, [rudycelekli/swarmwatch](https://github.com/rudycelekli/swarmwatch), describes itself as local-first mission control for multi-agent runs and exposes a CLI, dashboard, event verification, alarms, and MCP tools. An unrelated but active [Swarmwatch satellite-constellation tracker](https://swarmwatch.dev/) owns the exact `.dev` domain.

There is also a historical US **SWARMWATCH** registration, serial 87516327, for SaaS network monitoring and analytics. The [USPTO TSDR record](https://tsdr.uspto.gov/#caseNumber=87516327&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch) should be used for authoritative verification; public trademark indexes report that registration was canceled under Section 8 in January 2025. That old record is not the reason to reject the name—the live coding-agent projects are.

## GitHub identity check

GitHub's current repository and account results reinforce the product findings:

| Name | Exact or material GitHub use |
| --- | --- |
| **DiffSwarm** | [thejchap/diffswarm](https://github.com/thejchap/diffswarm) is a unified-diff review workflow; [bro4all/homebrew-diffswarm](https://github.com/bro4all/homebrew-diffswarm) distributes the commercial AI review CLI. The exact organization/user handle did not resolve during this check. |
| **CounterSwarm** | [AravKaul20/counterswarm](https://github.com/AravKaul20/counterswarm) is a counter-drone swarm simulation; the exact [counterswarm account](https://github.com/counterswarm) is occupied. |
| **SwarmCheck** | The exact [Swarmcheck organization](https://github.com/Swarmcheck) is occupied. |
| **SwarmGuard** | The exact [swarmguard organization](https://github.com/swarmguard) belongs to the active secure-connectivity product; several unrelated exact-name repositories also exist. |
| **SwarmWatch** | [SwarmPack/SwarmWatch](https://github.com/SwarmPack/SwarmWatch) is an active coding-agent monitor/control plane; [rudycelekli/swarmwatch](https://github.com/rudycelekli/swarmwatch) is another active multi-agent mission-control tool. The exact organization/user handle did not resolve during this check. |

## Domain check

The table reports registry RDAP state at the time of the check. **Registered** means the authoritative registry returned a domain record. **No record** means it returned HTTP 404; this is a momentary technical observation, not a guarantee that a registrar will sell the domain or that it is free of premium/reserved status.

| Name | `.com` | `.dev` | `.org` | `.io` |
| --- | --- | --- | --- | --- |
| **DiffSwarm** | [Registered](https://rdap.verisign.com/com/v1/domain/diffswarm.com) | [Registered](https://pubapi.registry.google/rdap/domain/diffswarm.dev) | [No record](https://rdap.publicinterestregistry.org/rdap/domain/diffswarm.org) | [No record](https://rdap.identitydigital.services/rdap/domain/diffswarm.io) |
| **CounterSwarm** | [Registered](https://rdap.verisign.com/com/v1/domain/counterswarm.com) | [No record](https://pubapi.registry.google/rdap/domain/counterswarm.dev) | [No record](https://rdap.publicinterestregistry.org/rdap/domain/counterswarm.org) | [No record](https://rdap.identitydigital.services/rdap/domain/counterswarm.io) |
| **SwarmCheck** | [Registered](https://rdap.verisign.com/com/v1/domain/swarmcheck.com) | [No record](https://pubapi.registry.google/rdap/domain/swarmcheck.dev) | [No record](https://rdap.publicinterestregistry.org/rdap/domain/swarmcheck.org) | [No record](https://rdap.identitydigital.services/rdap/domain/swarmcheck.io) |
| **SwarmGuard** | [Registered](https://rdap.verisign.com/com/v1/domain/swarmguard.com) | [Registered](https://pubapi.registry.google/rdap/domain/swarmguard.dev) | [Registered](https://rdap.publicinterestregistry.org/rdap/domain/swarmguard.org) | [Registered](https://rdap.identitydigital.services/rdap/domain/swarmguard.io) |
| **SwarmWatch** | [Registered](https://rdap.verisign.com/com/v1/domain/swarmwatch.com) | [Registered](https://pubapi.registry.google/rdap/domain/swarmwatch.dev) | [No record](https://rdap.publicinterestregistry.org/rdap/domain/swarmwatch.org) | [No record](https://rdap.identitydigital.services/rdap/domain/swarmwatch.io) |

Every exact `.com` is registered. The `.dev` domains for CounterSwarm and SwarmCheck and several `.org`/`.io` variants had no RDAP record, but those openings do not overcome the existing product and company collisions.

## Package-registry check

The exact unscoped names returned no package record from npm, PyPI, RubyGems, or crates.io at the time of the check:

| Name | Exact registry queries |
| --- | --- |
| **DiffSwarm** | [npm](https://registry.npmjs.org/diffswarm), [PyPI](https://pypi.org/pypi/diffswarm/json), [RubyGems](https://rubygems.org/api/v1/gems/diffswarm.json), [crates.io](https://crates.io/api/v1/crates/diffswarm) |
| **CounterSwarm** | [npm](https://registry.npmjs.org/counterswarm), [PyPI](https://pypi.org/pypi/counterswarm/json), [RubyGems](https://rubygems.org/api/v1/gems/counterswarm.json), [crates.io](https://crates.io/api/v1/crates/counterswarm) |
| **SwarmCheck** | [npm](https://registry.npmjs.org/swarmcheck), [PyPI](https://pypi.org/pypi/swarmcheck/json), [RubyGems](https://rubygems.org/api/v1/gems/swarmcheck.json), [crates.io](https://crates.io/api/v1/crates/swarmcheck) |
| **SwarmGuard** | [npm](https://registry.npmjs.org/swarmguard), [PyPI](https://pypi.org/pypi/swarmguard/json), [RubyGems](https://rubygems.org/api/v1/gems/swarmguard.json), [crates.io](https://crates.io/api/v1/crates/swarmguard) |
| **SwarmWatch** | [npm](https://registry.npmjs.org/swarmwatch), [PyPI](https://pypi.org/pypi/swarmwatch/json), [RubyGems](https://rubygems.org/api/v1/gems/swarmwatch.json), [crates.io](https://crates.io/api/v1/crates/swarmwatch) |

This is the only clean part of the screen, and it is fragile: package names can be claimed at any time, SwarmWatch's repository already documents an intended `npx swarmwatch` interface, and DiffSwarm is already distributed through Homebrew.

## Recommendation

Restart from the **swarm concept**, not these exact constructions.

- Do not use **DiffSwarm**; it is a direct competitor's exact name.
- Do not use **SwarmWatch** or **SwarmCheck**; both would be confused with active adjacent developer tools.
- Do not use **SwarmGuard**; it has the broadest domain, company, GitHub, and trademark exposure.
- Treat **CounterSwarm** only as evidence that the adversarial “agents checking agents” story is good. The exact name is already occupied.

A better next naming round should preserve the swarm/adversarial idea while avoiding the exact words `diff`, `check`, `guard`, `watch`, and `counter` directly adjacent to `swarm`. Any finalist should be checked live before public use because this category is moving quickly.
