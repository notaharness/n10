'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BrandLogo } from '@/components/brand/logos';
import { LinuxDownload } from '@/components/landing/linux-download';
import { macDownload } from '@/lib/downloads';
import { detectPlatform, type Platform } from '@/lib/platform';
import { RELEASES_URL } from '@/lib/release-assets';

const command = 'npm install -g @notaharness/n10';

/** The detected platform, empty until detection resolves after hydration. */
function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>({});
  useEffect(() => {
    let active = true;
    detectPlatform().then(
      (detected) => {
        if (active) setPlatform(detected);
      },
      () => undefined
    );
    return () => {
      active = false;
    };
  }, []);
  return platform;
}

function NpmInstall() {
  const [copyStatus, setCopyStatus] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopyStatus('Copied');
    } catch {
      setCopyStatus('Select the command to copy it.');
    }
  }
  return (
    <div className="npm-install">
      <div className="command-line">
        <code>{command}</code>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy npm install command"
        >
          Copy
        </button>
      </div>
      <span role="status">{copyStatus}</span>
    </div>
  );
}

export function HomeDownloads() {
  const platform = usePlatform();
  return (
    <section className="hero-downloads" id="install" aria-label="Download n10">
      <div className="platform-choices">
        <a
          className={`platform-download ${
            platform.os === 'mac' ? 'primary' : ''
          }`}
          href={macDownload(platform).url}
        >
          <BrandLogo mark="apple" className="platform-mark" />
          <span>Download for macOS</span>
          <span aria-hidden>↓</span>
        </a>
        <LinuxDownload arch={platform.arch} primary={platform.os === 'linux'} />
      </div>
      <NpmInstall />
      <div className="install-links">
        <Link href="/docs/installation">Installation guide</Link>
        <Link href="/docs/getting-started">Getting started</Link>
        <a href={RELEASES_URL}>
          Releases <span aria-hidden>↗</span>
        </a>
      </div>
      <p className="windows-note">
        <Link href="/docs/windows">Windows support</Link>: experimental via
        WSLg, install via npm.
      </p>
    </section>
  );
}
