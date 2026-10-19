import { describe, expect, it } from 'vitest';
import {
  detectWsl,
  parseMountInfo,
  windowsDriveMount,
  windowsDriveOf,
  type WslProbe,
} from './wsl.js';
import { environmentNotices } from './environment-notices.js';

// Kernel releases as each kind of machine reports them.
const WSL2_RELEASE = '6.6.87.2-microsoft-standard-WSL2';
const WSL1_RELEASE = '4.4.0-26100-Microsoft';
const UBUNTU_RELEASE = '6.8.0-45-generic';

// A WSL 2 distro's mounts: ext4 root, the C: drive over 9p, WSLg's
// tmpfs, and a mount point with a space (escaped as \040).
const WSL2_MOUNTINFO = [
  String.raw`70 59 8:48 / / rw,relatime - ext4 /dev/sdd rw,discard,errors=remount-ro,data=ordered`,
  String.raw`91 70 0:59 / /mnt/c rw,noatime - 9p C:\134 rw,aname=drvfs;path=C:\;uid=1000;gid=1000;symlinkroot=/mnt/,mmap,access=client,msize=65536,trans=fd,rfd=5,wfd=5`,
  String.raw`92 70 0:60 / /mnt/wslg rw,relatime - tmpfs none rw`,
  String.raw`93 70 0:61 / /mnt/my\040drive rw,noatime - 9p D:\134 rw,aname=drvfs;path=D:\;uid=1000`,
  String.raw`94 70 8:48 /home/ada/linked /mnt/c/Users/ada/linux rw,relatime - ext4 /dev/sdd rw`,
].join('\n');

const WSL1_MOUNTINFO = String.raw`5 0 0:5 / / rw,noatime - lxfs rootfs rw
8 5 0:7 / /mnt/c rw,noatime - drvfs C:\134 rw,case=off`;

function probe(
  overrides: Partial<WslProbe> & { files?: Record<string, string> }
): WslProbe {
  const files = overrides.files ?? {};
  return {
    platform: 'linux',
    env: {},
    readFile: (path) => files[path] ?? null,
    exists: (path) => path in files,
    ...overrides,
  };
}

describe('detectWsl', () => {
  it('reads WSL 2 from its kernel release and the interop entry', () => {
    const wsl = detectWsl(
      probe({
        env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' },
        files: {
          '/proc/sys/kernel/osrelease': `${WSL2_RELEASE}\n`,
          '/proc/sys/fs/binfmt_misc/WSLInterop': 'enabled',
        },
      })
    );
    expect(wsl).toEqual({ version: 2, distro: 'Ubuntu-24.04', interop: true });
  });

  it('accepts the interop entry systemd renames', () => {
    const wsl = detectWsl(
      probe({
        files: {
          '/proc/sys/kernel/osrelease': WSL2_RELEASE,
          '/proc/sys/fs/binfmt_misc/WSLInterop-late': 'enabled',
        },
      })
    );
    expect(wsl?.interop).toBe(true);
  });

  it('reports interop off when its binfmt entry is absent', () => {
    const wsl = detectWsl(
      probe({ files: { '/proc/sys/kernel/osrelease': WSL2_RELEASE } })
    );
    expect(wsl).toEqual({ version: 2, distro: null, interop: false });
  });

  it('tells WSL 1 by its Windows-kernel release', () => {
    const wsl = detectWsl(
      probe({
        env: { WSL_DISTRO_NAME: 'Ubuntu' },
        files: { '/proc/sys/kernel/osrelease': WSL1_RELEASE },
      })
    );
    expect(wsl?.version).toBe(1);
  });

  it('counts a custom kernel inside a distro as WSL 2', () => {
    const wsl = detectWsl(
      probe({
        env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' },
        files: { '/proc/sys/kernel/osrelease': '6.10.0-custom' },
      })
    );
    expect(wsl?.version).toBe(2);
  });

  it('is null on plain Linux and on other platforms', () => {
    const files = { '/proc/sys/kernel/osrelease': UBUNTU_RELEASE };
    expect(detectWsl(probe({ files }))).toBeNull();
    expect(
      detectWsl(
        probe({
          platform: 'darwin',
          env: { WSL_DISTRO_NAME: 'x' },
          files: { '/proc/sys/kernel/osrelease': WSL2_RELEASE },
        })
      )
    ).toBeNull();
  });
});

describe('windowsDriveMount', () => {
  const mounts = parseMountInfo(WSL2_MOUNTINFO);

  it('decodes mount points and sources', () => {
    expect(mounts.map((m) => m.mountPoint)).toEqual([
      '/',
      '/mnt/c',
      '/mnt/wslg',
      '/mnt/my drive',
      '/mnt/c/Users/ada/linux',
    ]);
    expect(mounts[1]?.source).toBe('C:\\');
  });

  it('finds a repository on a mounted Windows drive', () => {
    expect(
      windowsDriveMount('/mnt/c/Users/ada/src/app', mounts)?.mountPoint
    ).toBe('/mnt/c');
    expect(windowsDriveMount('/mnt/c', mounts)?.mountPoint).toBe('/mnt/c');
    expect(windowsDriveMount('/mnt/my drive/app', mounts)?.mountPoint).toBe(
      '/mnt/my drive'
    );
  });

  it('leaves Linux storage alone, including paths that only look alike', () => {
    expect(windowsDriveMount('/home/ada/src/app', mounts)).toBeNull();
    expect(windowsDriveMount('/mnt/cache/app', mounts)).toBeNull();
    expect(windowsDriveMount('/mnt/wslg/runtime', mounts)).toBeNull();
  });

  it('judges a path by the innermost mount holding it', () => {
    expect(windowsDriveMount('/mnt/c/Users/ada/linux/app', mounts)).toBeNull();
  });

  it('recognises WSL 1 drvfs mounts', () => {
    const wsl1 = parseMountInfo(WSL1_MOUNTINFO);
    expect(windowsDriveMount('/mnt/c/src', wsl1)?.mountPoint).toBe('/mnt/c');
  });

  it('reads nothing into an unreadable mount table', () => {
    expect(windowsDriveOf('/mnt/c/src', probe({}))).toBeNull();
  });
});

describe('environmentNotices', () => {
  const files = { '/proc/self/mountinfo': WSL2_MOUNTINFO };
  const wsl2 = { version: 2 as const, distro: 'Ubuntu-24.04', interop: true };

  it('says nothing outside WSL, even for a /mnt path', () => {
    expect(
      environmentNotices('/mnt/c/src/app', null, probe({ files }))
    ).toEqual([]);
  });

  it('says nothing for a Linux repository on WSL 2', () => {
    expect(
      environmentNotices('/home/ada/src/app', wsl2, probe({ files }))
    ).toEqual([]);
  });

  it('warns about a repository on a Windows drive', () => {
    const notices = environmentNotices(
      '/mnt/c/src/app',
      wsl2,
      probe({ files })
    );
    expect(notices.map((n) => n.id)).toEqual(['windows-drive']);
    expect(notices[0]?.message).toContain('/mnt/c/src/app');
  });

  it('warns about WSL 1 and names the conversion command', () => {
    const notices = environmentNotices(
      '/home/ada/src/app',
      { version: 1, distro: 'Ubuntu', interop: true },
      probe({ files })
    );
    expect(notices.map((n) => n.id)).toEqual(['wsl1']);
    expect(notices[0]?.message).toContain('wsl --set-version Ubuntu 2');
  });
});
