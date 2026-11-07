# Orchestra plugin fixture

`orchestra.tar.gz` is the unmodified `orchestra/` directory from
[notaharness/plugins at db3f7c93](https://github.com/notaharness/plugins/tree/db3f7c9368b5529be68dfc8cf40a198d2d5e0af1/orchestra).
The plugin manifest declares version 2.0.0 and MIT licensing.

SHA-256: `be059b791cf05a37b2f39a2e096d29fc2167905ea5518e5f3b65046022dcc8c0`.

Generate from a checkout of that repository:

```sh
git archive --format=tar.gz --output=orchestra.tar.gz db3f7c9368b5529be68dfc8cf40a198d2d5e0af1 orchestra
```

To update, review an upstream commit, export it with the same command, and
update this provenance and the checksum in `orchestra-fixture.ts`. Commit the
archive so ordinary tests need no network, credentials, or installed agent CLI.

Tests unpack the complete plugin into a temporary HOME, validate its manifest
and skill entry points, and execute its installed Bash scripts. This tests the
plugin package and runtime, not an agent CLI's plugin manager or model behavior.
`fake-orchestra-agent.mjs` implements a small scripted agent and queue receiver.
