# OpenAI models (2026-09-23)

HumanCompiler uses `gpt-6-sol` for its default planning and task generation,
and `gpt-6-luna` for lightweight report defaults. A user's explicit model
selection still takes precedence, including for reports.

## Cost-conscious upgrade

Standard text pricing in USD per 1 million tokens, for short-context requests:

| Previous selection | New selection | Input, before → after | Output, before → after |
| --- | --- | --- | --- |
| GPT-5.5 | GPT-6 Sol | $5.00 → $2.00 | $30.00 → $10.00 |
| GPT-5.4 mini | GPT-6 Luna | $0.75 → $0.10 | $4.50 → $0.50 |
| GPT-5.4 nano | GPT-6 Luna | $0.20 → $0.10 | $1.25 → $0.50 |

Sol preserves the more capable planning role; Luna handles the previous
low-cost roles. These are workload-based choices, not a measured quality
equivalence. Actual costs depend on token usage, including reasoning tokens.
GPT-6 prompts over 272K input tokens use higher rates; cache writes and
processing tiers also affect billing. Existing output token budgets and
`high` reasoning settings are retained.

Official sources:

- [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol)
- [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5)
- [GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
- [GPT-5.4 nano](https://developers.openai.com/api/docs/models/gpt-5.4-nano)
- [Pricing](https://developers.openai.com/api/docs/pricing)

## API compatibility

GPT-6 Sol/Luna only support Chat Completions function calling with
`reasoning_effort="none"`. Weekly planning therefore uses Responses API function
calling with `reasoning={"effort": "high"}`, preserving the existing prompts,
function arguments, and output budget. The function schema explicitly uses
`strict=False` to retain its existing optional fields. Completed function-call
items are read from `response.output`; incomplete or missing calls are errors.
Planning requests set `store=False`.

JSON-only and text-only Chat Completions keep their existing endpoint and
reasoning effort. GPT-6 reasoning requests omit `temperature`. Background
draft generation retains its existing Responses API and storage behavior.
See the [official migration guide](https://developers.openai.com/api/docs/guides/latest-model).

## Deployment

Deploy the API changes together with migration
`032_update_openai_models_gpt6.sql`. The migration changes the database default
and the three previous active selections. It preserves custom/pinned model
IDs and leaves historical migrations unchanged. Staging/production startup
applies numbered migrations through MigrationManager.

The migration stores only original model selections in an RLS-protected
backup table. Run it transactionally through MigrationManager. Its rollback
restores original selections only for settings untouched since migration;
new or subsequently edited selections are preserved and may need manual
selection if reverting to an older API.

Update any deployment override of `NEXT_PUBLIC_DEFAULT_OPENAI_MODEL` to
`gpt-6-sol` and rebuild the web app. Local mock tests cover request parameters,
function-call parsing, invalid task filtering, failure handling, and defaults.
Real-account model access, generated quality/latency, and production migration
execution require verification in the deployment environment.
