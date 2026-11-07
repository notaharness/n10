# Orchestra plugin fixture

`orchestra.tar.gz` is the unmodified `orchestra/` directory from
[notaharness/plugins at 250dd199](https://github.com/notaharness/plugins/tree/250dd1994d55b3fa6885558d1ac5e5c5bb5cf9e5/orchestra).
The plugin manifest declares version 2.0.0 and MIT licensing.

SHA-256: `38a05c4d610c549519c0fbbeaa54856ecc36c146e604731b1c1575b02ad80c20`.

Generate from a checkout of that repository:

```sh
git archive --format=tar.gz --output=orchestra.tar.gz 250dd1994d55b3fa6885558d1ac5e5c5bb5cf9e5 orchestra
```

To update, review an upstream commit, export it with the same command, and
update this provenance and the checksum in `orchestra-fixture.ts`. Commit the
archive so ordinary tests need no network, credentials, or installed agent CLI.

Tests unpack the complete plugin into a temporary HOME, validate its manifest
and skill entry points, and execute its installed Bash scripts. This tests the
plugin package and runtime, not an agent CLI's plugin manager or model behavior.
`fake-orchestra-agent.mjs` implements a small scripted agent and queue receiver.
