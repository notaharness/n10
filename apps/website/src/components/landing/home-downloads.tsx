'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BrandLogo } from '@/components/brand/logos';
import { detectPlatform, type Platform } from '@/lib/platform';
import { LinuxDownload } from '@/components/landing/linux-download';
import { RELEASES_URL, macAsset } from '@/lib/release-assets';

const command = 'npm install -g @notaharness/n10';
export function HomeDownloads() {
  const [platform, setPlatform] = useState<Platform>({});
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    let active = true;
    detectPlatform().then(detected => { if (active) setPlatform(detected); }, () => undefined);
    return () => { active = false; };
  }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(command); setCopyStatus('Copied'); }
    catch { setCopyStatus('Select the command to copy it.'); }
  }
  return (
    <section className="hero-downloads" id="install" aria-label="Download n10">
      <div className="platform-choices">
        <a className={`platform-download ${platform.os === 'mac' ? 'primary' : ''}`} href={macAsset(platform.os === 'mac' ? platform.arch ?? 'arm64' : 'arm64').url}>
          <BrandLogo mark="apple" className="platform-mark" />
          <span>Download for macOS</span><span aria-hidden>↓</span>
        </a>
        <LinuxDownload arch={platform.arch} primary={platform.os === 'linux'} />
      </div>
      <div className="npm-install"><div className="command-line"><code>{command}</code><button type="button" onClick={copy} aria-label="Copy npm install command">Copy</button></div><span role="status">{copyStatus}</span></div>
      <div className="install-links"><Link href="/docs/installation">Installation guide</Link><Link href="/docs/getting-started">Getting started</Link><a href={RELEASES_URL}>Releases <span aria-hidden>↗</span></a></div>
      <p className="windows-note"><Link href="/docs/windows">Windows support</Link>: experimental via WSLg, install via npm.</p>
    </section>
  );
}
