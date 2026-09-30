/**
 * What the fixture loads into the app's session host, the utility
 * process that makes the providers' requests, through
 * `N10_HOST_REQUIRE`: the network guard, then the Azure DevOps fake
 * when a test serves one. The host takes one module; this is it.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- a preload is CommonJS, and these are its siblings. */
require('./network-guard.cjs');
if (process.env.N10_FAKE_ADO) require('./fake-ado.cjs');
