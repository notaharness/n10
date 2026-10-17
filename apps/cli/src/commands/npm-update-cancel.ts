/** Clears npm's spinner frame first; npm keeps drawing on the line below. */
export function showNpmUpdateCancelling(
  output: Pick<NodeJS.WriteStream, 'write'> = process.stdout
) {
  output.write(
    '\r\x1b[KCancelling update…\nWaiting for the current download to finish, then restoring the previous version. Keep n10 open.\n'
  );
}
