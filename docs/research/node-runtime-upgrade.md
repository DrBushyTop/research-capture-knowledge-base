# Node runtime upgrade

Checked October 7, 2026.

## Current release choices

Node 24 is the latest LTS major. Node 22 remains in maintenance LTS until April 30, 2027. Node 24 reaches end of support on April 30, 2028. Node 26 is the latest Current major, with LTS scheduled for October 28, 2026. Node recommends Active LTS or Maintenance LTS for production. Node 25 is already unsupported. [Node release table](https://nodejs.org/en/about/previous-releases), [official release schedule](https://github.com/nodejs/Release/blob/main/schedule.json).

The release table and schedule agree on the relevant support windows. Their dates for the end of odd-numbered releases can differ because the table reports the last update, while the schedule reports planned end of support. Do not treat the table's "Last updated" column as the support deadline. [Node release table](https://nodejs.org/en/about/previous-releases), [official release schedule](https://github.com/nodejs/Release/blob/main/schedule.json).

## Azure Functions worker

The worker uses the Flex Consumption plan, with `FC1` and runtime version `22` in [infra/main.bicep](../../infra/main.bicep). Microsoft lists Node 22 and Node 24 as supported Flex Consumption versions. The Functions runtime table lists Node 24 as GA, with support expected through April 30, 2028. It does not list Node 26. The worker's hosting plan therefore does not block upgrading to 24. It does block treating 26 as a supported managed runtime today. [Flex Consumption supported versions](https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan#supported-language-stack-versions), [Functions language versions](https://learn.microsoft.com/en-us/azure/azure-functions/functions-versions#languages).

Node 22 is the final supported version on the older Linux Consumption plan. That restriction does not apply to this worker, which already uses Flex Consumption. [Functions language versions](https://learn.microsoft.com/en-us/azure/azure-functions/functions-versions#languages).

## Static Web Apps reader API

The reader sets `platform.apiRuntime` to `node:22` in [staticwebapp.config.json](../../apps/reader/staticwebapp.config.json). Microsoft documents only Node 20 and Node 22 among the non-retired managed Node API runtimes. Neither `node:24` nor `node:26` appears in the supported values. The runtime page says to bring your own Functions app when an application needs a version not listed. This is a deployment blocker for moving the managed reader API to 24, not a JavaScript code incompatibility. [Static Web Apps runtime table](https://learn.microsoft.com/en-us/azure/static-web-apps/languages-runtimes#api), [platform configuration](https://learn.microsoft.com/en-us/azure/static-web-apps/configuration#platform).

The runtime table was updated October 5, 2026. The more general API constraints page still lists older Node versions and calls Node 20 preview. Prefer the dedicated runtime table when choosing an `apiRuntime` value. None of the checked official pages documents `node:24` as supported for managed APIs. This finding does not prove that an undocumented value fails in every region, but an undocumented runtime is not a supported deployment choice. [Runtime table](https://learn.microsoft.com/en-us/azure/static-web-apps/languages-runtimes#api), [older constraints page](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-functions#constraints).

The frontend build runtime is separate from the managed API runtime. A newer Node version for local development or CI does not itself upgrade the deployed API. [Static Web Apps runtime definitions](https://learn.microsoft.com/en-us/azure/static-web-apps/languages-runtimes).

## Recommendation

Keep the managed reader API on 22 until Static Web Apps documents 24 support, or move it to a separately managed Functions app. The worker can target 24 after dependency, build, and packaged deployment checks. Updating local tooling and CI alone would leave a 22 production API, so retain 22 compatibility and test that runtime if taking that split-version approach.

The locked jsdom 30.1.2 package permits `^22.22.2 || ^24.15.0 || >=26.0.0`, so choose Node 24.15.0 or newer within major 24, rather than an early 24 release. [Locked package metadata](../../package-lock.json).

## Local checks

The current checkout passed `npm run check` and `npm run build:worker` under Node 24.21.0 on October 7, 2026. The test run passed 202 tests and skipped three. These checks used the existing installed dependencies, not a clean installation or an Azure deployment.

The installed jsdom 30.1.2 package requires `^22.22.2 || ^24.15.0 || >=26.0.0`. Use Node 24.15.0 or later on the 24 branch. Its engine declaration explains the root package's 22.22.2 minimum, but does not require staying on major 22. See [package-lock.json](../../package-lock.json).

A successful local build cannot establish support for a managed Azure runtime. No runtime configuration changed during this investigation.
