import { describe, expect, it } from 'vitest';
import { hostEnv, restoreNodeOptions } from './host-env.js';

describe('the host environment', () => {
  it('loads N10_HOST_REQUIRE into the host, and gives its children none of it', () => {
    const env = hostEnv(
      {
        NODE_OPTIONS: '--max-old-space-size=4096',
        N10_HOST_REQUIRE: '/t/a b.cjs',
      },
      '/data'
    );
    expect(env.NODE_OPTIONS).toBe(
      '--max-old-space-size=4096 --require "/t/a b.cjs"'
    );
    expect(env.N10_USER_DATA).toBe('/data');
    restoreNodeOptions(env);
    expect(env.NODE_OPTIONS).toBe('--max-old-space-size=4096');
    expect(env.N10_HOST_REQUIRE).toBeUndefined();
    expect(env.N10_HOST_NODE_OPTIONS).toBeUndefined();
  });

  it('leaves no NODE_OPTIONS where the app had none', () => {
    const env = hostEnv({ N10_HOST_REQUIRE: '/t/a.cjs' }, '/data');
    restoreNodeOptions(env);
    expect('NODE_OPTIONS' in env).toBe(false);
  });

  it('touches nothing without N10_HOST_REQUIRE', () => {
    const env = hostEnv({ NODE_OPTIONS: '--inspect' }, '/data');
    restoreNodeOptions(env);
    expect(env.NODE_OPTIONS).toBe('--inspect');
  });
});
