import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectPlatform } from '../src/lib/platform.ts';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const hints = (platform, architecture, bitness = '64') => ({
  platform,
  getHighEntropyValues: async () => ({ architecture, bitness }),
});

const cases = [
  ['iPhone Safari', { userAgent: iphone }, {}],
  [
    'iPhone with Mac hints',
    { userAgent: iphone, userAgentData: hints('macOS', 'arm') },
    {},
  ],
  ['iPad desktop mode', { userAgent: mac, maxTouchPoints: 5 }, {}],
  ['Mac Safari leaves CPU unknown', { userAgent: mac }, { os: 'mac' }],
  [
    'Apple Silicon hints',
    { userAgent: mac, userAgentData: hints('macOS', 'arm') },
    { os: 'mac', arch: 'arm64' },
  ],
  [
    'Intel Mac hints',
    { userAgent: mac, userAgentData: hints('macOS', 'x86') },
    { os: 'mac', arch: 'x64' },
  ],
  [
    'Linux ARM hints override frozen UA',
    { userAgent: 'Linux x86_64', userAgentData: hints('Linux', 'arm') },
    { os: 'linux', arch: 'arm64' },
  ],
  [
    'Linux Firefox ARM',
    { userAgent: 'Linux aarch64' },
    { os: 'linux', arch: 'arm64' },
  ],
  ['Android', { userAgent: 'Linux; Android 15' }, {}],
  ['Windows', { userAgent: 'Windows NT 10.0; Win64; x64' }, {}],
  [
    '32-bit hints leave CPU unknown',
    { userAgent: 'Linux', userAgentData: hints('Linux', 'x86', '32') },
    { os: 'linux' },
  ],
  [
    'rejected hints',
    {
      userAgent: 'Linux',
      userAgentData: {
        platform: 'Linux',
        getHighEntropyValues: async () => {
          throw new Error('Denied');
        },
      },
    },
    { os: 'linux' },
  ],
];

for (const [name, navigator, expected] of cases) {
  test(name, async (t) => {
    t.mock.getter(globalThis, 'navigator', () => navigator);
    assert.deepEqual(await detectPlatform(), expected);
  });
}
