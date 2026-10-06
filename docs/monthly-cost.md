# Monthly operating estimate

Estimate recorded 2026-10-07 for production in Sweden Central. USD retail, before tax, sponsorship credits, discounts or exchange conversion. Sources: Azure Retail Prices API, Azure OpenAI pricing page, and ACA Sandboxes cost documentation. This is a budget model, not an invoice forecast.

## Fixed and low-volume infrastructure

- One SQL Standard S0 database: $0.4839/day, about **$14.72/month** at 365/12 days. No separate charge for the logical server. Production has one database; the existing development group has two, so all three databases together are about $44.16/month.
- Static Web Apps Free: $0 within the free plan limits. No paid hosting plan or always-ready Functions instances are provisioned.
- Key Vault Standard: $0.03 per 10,000 operations. Empty vault storage does not add a fixed monthly fee.
- Blob Hot LRS: $0.0184/GB-month. 10 GB is about $0.18/month, plus read/write operations and applicable bandwidth.
- Functions Flex on-demand: 100,000 GB-seconds and 250,000 executions free per month per eligible subscription; then $0.000026/GB-second and $0.40/million executions. Free grants can be shared with other apps in this subscription. Model waiting time counts as worker execution time.
- Analytics logs: $2.99/GB above applicable free allowance. Budget $0–$3/month for small log volume. The 0.1 GB/day workspace cap is a control, not a guarantee that all telemetry billing is capped.
- ACA sandbox CPU/memory: standard active rates $0.000024/vCPU-second and $0.000003/GiB-second. A 0.25-vCPU, 0.5-GiB sandbox running for 180 seconds is about $0.00135 before any grant. Our clean image restores that allocation. 100 such captures are roughly $0.14 in compute, plus image/snapshot storage if billed. Sandbox docs currently describe image/snapshot storage charging as coming soon; reserve $1–$3/month and recheck at activation.

**Idle/light-production infrastructure budget: $16–$22/month**, excluding model inference, unusual bandwidth/operations and GitHub Actions overage. Resource groups and managed identities have no separate usage line in this estimate.

## Model usage

The deployed model is GPT-6.1 Sol Data Zone Standard, not provisioned throughput. Deployment capacity is a throughput/quota setting, not a reserved monthly PTU charge. The Azure pricing page's embedded Sweden Central rates for short context are **$2.40/million input tokens, $0.12/million cached input tokens, $12/million output tokens**. Long-context rates are $4.80 input and $18 output; avoid assuming every request gets the short-context rate. Output includes billable reasoning tokens. Images and repeated agent/tool rounds increase input use.

Illustrative budgets using uncached short-context input, including all model rounds per operation:

| Operation | Input | Output incl. reasoning | Approximate inference cost |
| --- | ---: | ---: | ---: |
| Ordinary source capture, classification and analysis | 20,000 | 4,000 | $0.096 |
| Chat answer with retrieval | 40,000 | 5,000 | $0.156 |
| Browser recovery plus source analysis | 100,000 | 10,000 | $0.36 |

These token assumptions are not measured averages. Browser actions each send a view/screenshot and can be considerably more expensive at the action limit. Re-analysis, retries and very long conversations add usage.

- Light month: 100 ordinary captures + 100 chat answers + 20 browser recoveries = **$32.40 inference**, plus $16–$22 infrastructure, about **$48–$55/month production**.
- Busier month: 500 ordinary captures + 500 chat answers + 100 browser recoveries = **$162 inference**, plus roughly $20–$35 infrastructure, about **$180–$200/month production**.
- Keeping the two existing development S0 databases adds about **$29.44/month**, before dev inference and compute. Light prod + existing dev is roughly **$78–$85/month** under those assumptions.

GitHub Actions included minutes depend on the account plan. This estimate excludes paid overage; production plus development deployments now run on master pushes, and the existing hourly dev workflow also consumes runner minutes. Measure monthly usage before treating CI as free.

## Sources and refresh

- Azure Retail Prices API: query SQL Database/S0, Functions/Flex Consumption, Storage/Hot LRS and Log Analytics in swedencentral.
- https://azure.microsoft.com/en-us/pricing/details/azure-openai/
- https://azure.microsoft.com/en-us/pricing/details/functions/
- https://sandboxes.azure.com/docs/sandboxes/cost

Use actual token usage and Cost Management resource-group totals after the first week to replace these assumptions. Sponsorship credits reduce cash paid while available, not the underlying consumption cost.
