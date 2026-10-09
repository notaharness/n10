/* global window */
// Evaluated by N10_QA_STEPS in the packaged renderer. The echoed command does
// not contain the marker, so only output from a running shell can pass.
(async () => {
  const terminal = await window.n10.launchTerminal({
    kind: 'shell',
    cwd: '/tmp/qa-repo',
    cols: 80,
    rows: 24,
  });
  try {
    await window.n10.writeSession(
      terminal.name,
      "printf '%s%s\\n' N10_ PTY_OK\n"
    );
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const { data } = await window.n10.watchSession(terminal.name);
      await window.n10.unwatchSession(terminal.name);
      if (data.includes('N10_PTY_OK')) return 'PTY_OK';
    }
    throw new Error('shell PTY did not return its output');
  } finally {
    await window.n10.killTerminal(terminal.name);
  }
})();
