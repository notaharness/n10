/**
 * The convention's encoding rules for the values n10 publishes: single
 * line UTF-8 with no C0/C1 control characters, at most 4,096 bytes;
 * tokens `[a-z][a-z0-9-]{0,63}`; paths absolute and canonical. A value
 * that fails is left out, never escaped or truncated.
 */

const TOKEN = /^[a-z][a-z0-9-]{0,63}$/;
// eslint-disable-next-line no-control-regex -- the rule is exactly "no control characters"
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const LONE_SURROGATE =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const MAX_VALUE_BYTES = 4096;

export function isTagToken(value: string | undefined): value is string {
  return !!value && TOKEN.test(value);
}

export function isTagValue(value: string | undefined): value is string {
  return (
    !!value &&
    !CONTROL.test(value) &&
    !LONE_SURROGATE.test(value) &&
    Buffer.byteLength(value, 'utf8') <= MAX_VALUE_BYTES
  );
}

/** Absolute, with no empty, `.` or `..` component and no trailing
 *  slash except `/` itself. */
export function isTagPath(value: string | undefined): value is string {
  if (!isTagValue(value) || !value.startsWith('/')) return false;
  if (value === '/') return true;
  return value
    .slice(1)
    .split('/')
    .every((part) => part !== '' && part !== '.' && part !== '..');
}
