// Loaded only by the measured utility process through N10_HOST_REQUIRE.
const { appendFileSync } = require('node:fs');
const { performance } = require('node:perf_hooks');
const output = process.env.N10_HOST_PROBE_LOG;
if (!output) throw new Error('Host probe requires an isolated output file');
const period = 10;
let previous = performance.now();
let samples = [];
const timer = setInterval(() => {
  const now = performance.now();
  samples.push([Date.now(), Math.max(0, now - previous - period)]);
  previous = now;
}, period);
timer.unref();
function flush() {
  if (!samples.length) return;
  appendFileSync(output, JSON.stringify({ pid: process.pid, samples }) + '\n');
  samples = [];
}
const writer = setInterval(flush, 1000);
writer.unref();
process.on('exit', flush);
