# AGENTS.md

This file provides guidance to Codex when working in the HumanCompiler repository.

## Response Language

Respond to the user in Japanese unless they explicitly request another language.

## GitHub Review Threads

When the user asks to address PR review feedback, treat unresolved actionable review threads as in scope by default.

- Fetch thread-aware review data, including resolved/outdated state, before editing.
- Implement fixes for all unresolved actionable threads unless the user narrows the scope.
- After pushing the fixes, re-check the review threads.
- Resolve GitHub review threads that have been addressed by the pushed changes.
- If a thread is addressed by explanation rather than code, leave a concise GitHub reply explaining the decision.
- Do not resolve threads that remain ambiguous, intentionally deferred, or contradicted by other feedback; summarize those for the user.
