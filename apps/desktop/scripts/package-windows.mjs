#!/usr/bin/env node
// Build the x64 NSIS installer on Windows.
import { buildInstaller } from './package-installer.mjs';

buildInstaller('win32');
