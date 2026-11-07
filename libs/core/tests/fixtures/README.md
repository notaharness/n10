# Orchestra plugin fixture

`orchestra.tar.gz` is the unmodified `orchestra/` directory from
[notaharness/plugins at bfa59791](https://github.com/notaharness/plugins/tree/bfa5979106ab36258ab14468572afd71780b0f17/orchestra).
The plugin manifest declares version 2.0.0 and MIT licensing.

SHA-256: `0e6ce0640743b2287caba0af40e3d3c0439abefec7083e4d65e4e53b3ac16790`.

Generate from a checkout of that repository:

```sh
git archive --format=tar.gz --output=orchestra.tar.gz bfa5979106ab36258ab14468572afd71780b0f17 orchestra
```

To update, review an upstream commit, export it with the same command, and
update this provenance and the checksum in `orchestra-fixture.ts`. Commit the
archive so ordinary tests need no network, credentials, or installed agent CLI.

Tests unpack the complete plugin into a temporary HOME, validate its manifest
and skill entry points, and execute its installed Bash scripts. This tests the
plugin package and runtime, not an agent CLI's plugin manager or model behavior.
`fake-orchestra-agent.mjs` implements a small scripted agent and queue receiver.
