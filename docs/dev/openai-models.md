# OpenAI models (2026-09-23)

HumanCompiler uses `gpt-6-sol` for its default planning and task generation,
and `gpt-6-luna` for lightweight report defaults. A user's explicit model
selection still takes precedence, including for reports.

## Cost-conscious upgrade

Standard text pricing in USD per 1 million tokens, for short-context requests:

| Current selection | Suggested upgrade | Input, before → after | Output, before → after |
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
`reasoning_effort="none"`. Weekly planning, the only feature that used function
calling, was removed on 2026-09-26.

JSON-only and text-only Chat Completions keep their existing endpoint and
reasoning effort. GPT-6 reasoning requests omit `temperature`. Background
draft generation retains its existing Responses API and storage behavior.
See the [official migration guide](https://developers.openai.com/api/docs/guides/latest-model).

## Deployment

No database migration is required. Existing saved model selections and the
SQL column default remain unchanged. The settings picker keeps GPT-5.5 and
GPT-5.4 mini/nano available, so existing users can continue using and saving
their current selection. Users switch to Sol or Luna themselves from settings.
New settings created through the application use the GPT-6 Sol default.

Update any deployment override of `NEXT_PUBLIC_DEFAULT_OPENAI_MODEL` to
`gpt-6-sol` and rebuild the web app. Local mock tests cover request parameters
and defaults.
Real-account model access and generated quality/latency require verification
in the deployment environment.
