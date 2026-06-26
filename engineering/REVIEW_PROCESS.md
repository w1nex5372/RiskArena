# Review Process

Use this checklist before final response or PR review.

## Coordinator Gate

- Was the issue classified before implementation?
- Was root cause identified before editing?
- Were findings ranked A/B/C by ROI?
- Was Priority A implemented first?
- Were unnecessary sub-agents avoided?
- Were relevant ADRs checked?
- Were Gameplay Vision and Design Principles checked when player-facing behavior changed?
- Were reusable lessons added to Knowledge Base when appropriate?

## Anti-Regression Policy

Before changing any existing system, verify:

- Does this violate an ADR?
- Does this violate Gameplay Vision?
- Does this violate Design Principles?

If yes, the Coordinator must explicitly justify the change in the final report and update the relevant doc/ADR if the decision changes.

## Diff Review

- Are all changed files in scope?
- Are there unrelated refactors or formatting churn?
- Are existing dirty user changes preserved?
- Are comments useful and minimal?
- Are labels/copy still accurate after behavior changes?

## Safety Review

- No payment/Solana changes unless explicitly requested.
- No bot/fake-player changes unless explicitly requested.
- No economy, reward, gambling, prize, or pay-to-win changes unless explicitly requested.
- No combat HP/damage/cooldown rebalance unless explicitly requested.
- No database behavior change unless explicitly requested.

## Quality Review

- Reject hacks that bypass validation, duplicate source-of-truth values, or hide failures.
- Reject temporary workarounds with no owner or follow-up.
- Reject magic numbers unless they match existing local constants/patterns.
- Reject dead code and unused states.
- Reject overengineering and unnecessary rewrites.
- Reject scope creep and unrelated polish.
- Reject UI states that misrepresent backend behavior.
- Reject server trust of client-only data where validation already exists.
- Check mobile usability for player-facing changes.
- Check gameplay readability for combat-facing changes.

## Check Review

- Run the user's requested checks.
- If docs-only, `git diff --check` is usually enough.
- If frontend changed, run frontend build.
- If gameserver changed, run gameserver build.
- If backend Python changed, run targeted compile/tests.
- Record skipped checks and why.

## Completion Review

Do not mark complete until build/checks, validation, playtest, regression review, protected-system review, and Coordinator review are done or explicitly documented as not applicable.
