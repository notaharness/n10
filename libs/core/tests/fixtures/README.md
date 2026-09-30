# Orchestra plugin fixture

`orchestra.tar.gz` is the unmodified `orchestra/` directory from
[notaharness/plugins at 9605d7a6](https://github.com/notaharness/plugins/tree/9605d7a629cbaa1de390dec6b9acb85da7a112a7/orchestra).
The plugin manifest declares version 1.6.0 and MIT licensing.

SHA-256: `afe847911e21a8c73866d4743fd1cd645973bc5a6011ab14729d946efb65ea83`.

Generate from a checkout of that repository:

```sh
git archive --format=tar.gz --output=orchestra.tar.gz 9605d7a629cbaa1de390dec6b9acb85da7a112a7 orchestra
```

To update, review an upstream commit, export it with the same command, and
update this provenance and the checksum in `orchestra-fixture.ts`. Commit the
archive so ordinary tests need no network, credentials, or installed agent CLI.

Tests unpack the complete plugin into a temporary HOME, validate its manifest
and skill entry points, and execute its installed Bash scripts. This tests the
plugin package and runtime, not an agent CLI's plugin manager or model behavior.
`fake-orchestra-agent.mjs` implements a small scripted agent and queue receiver.
