#!/usr/bin/env node
// Build the Linux installers for the host architecture.
import { buildInstaller } from './package-installer.mjs';

buildInstaller('linux');
