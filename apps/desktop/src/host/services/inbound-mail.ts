import { machines } from './machines.js';
export type { InboundMailPort } from '@n10/engine';
export const setInboundMailPort = machines.setMailPort;
export const dismissInboundMail = machines.dismissMail;
