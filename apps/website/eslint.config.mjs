import next from '@next/eslint-plugin-next';
import baseConfig from '../../eslint.config.mjs';

const boundaryOptions = baseConfig.find(
  (config) => config.rules?.['@nx/enforce-module-boundaries']
).rules['@nx/enforce-module-boundaries'][1];

export default [
  ...baseConfig,
  {
    // The website and release pipeline share asset names, not desktop code.
    files: ['src/lib/release-assets.ts'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        { ...boundaryOptions, allow: ['../../../desktop/release-assets.json'] },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { '@next/next': next },
    // The plugin looks for the app relative to the working directory,
    // which is the repo root when pre-commit lints a staged file.
    settings: { next: { rootDir: import.meta.dirname } },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs['core-web-vitals'].rules,
      // Static assets under `images.unoptimized: true` (see
      // next.config.mjs) have no optimizer behind next/image, so the
      // rule's premise doesn't hold here.
      '@next/next/no-img-element': 'off',
    },
  },
  {
    // App Router server files (page/layout/route) are not React
    // Compiler input: they run once on the build machine and hold no
    // state, so the compiler abandons every async component and
    // `react-hooks/todo` reports each one. Client components (anything
    // with 'use client') keep the rule, which is where it earns its
    // keep — see src/components/**.
    files: [
      'src/app/**/page.tsx',
      'src/app/**/layout.tsx',
      'src/app/**/route.ts',
    ],
    rules: { 'react-hooks/todo': 'off' },
  },
  {
    ignores: [
      '**/.next',
      '**/.source',
      '**/.open-next',
      '**/.wrangler',
      '**/next-env.d.ts',
      'src/generated/**',
      // Copied from desktop:build-demo by sync-demo.
      'public/desktop-demo/**',
    ],
  },
];
