import { createInstalledUpdates } from '@n10/engine';
import type {
  UpdatePreferences,
  UpdateService,
  UpdateSnapshot,
} from '@n10/engine/contract';

let updates: UpdateService | undefined;
let changed: ((snapshot: UpdateSnapshot) => void) | null = null;
function service() {
  if (!updates) {
    updates = createInstalledUpdates(
      process.env.N10_UPDATE_ROOT ?? '',
      process.env.N10_UPDATE_PACKAGED === '1'
    );
    const current = updates;
    current.subscribe(() => changed?.(current.getSnapshot()));
  }
  return updates;
}
export function setUpdatesNotifier(fn: typeof changed) {
  changed = fn;
}
export async function getUpdates() {
  return service().getSnapshot();
}
export async function checkUpdates() {
  await service().check();
}
export async function setUpdatePreferences(patch: Partial<UpdatePreferences>) {
  service().setPreferences(patch);
}
export function startUpdates() {
  service().start();
}
export function stopUpdates() {
  updates?.stop();
}
