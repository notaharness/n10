import { listenToEmbedder } from './embed.js';
import { createDemoHost } from './host/create-host.js';
import { trackPointer } from './native/context-menu.js';

document.documentElement.dataset.n10Demo = 'passive';
window.n10 = createDemoHost();
trackPointer();
listenToEmbedder();
