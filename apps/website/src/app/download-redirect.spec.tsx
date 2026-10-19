import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeDownloads } from '@/components/landing/home-downloads';
import config from '../../next.config.mjs';

describe('/download', () => {
  it('redirects permanently to the homepage’s downloads', async () => {
    expect(await config.redirects?.()).toContainEqual({
      source: '/download',
      destination: '/#install',
      permanent: true,
    });
  });

  it('lands on the section that holds the downloads', () => {
    expect(renderToStaticMarkup(<HomeDownloads />)).toMatch(
      /^<section[^>]* id="install"[^>]*>.*Download for macOS.*Download for Linux/
    );
  });
});
