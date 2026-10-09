import { createInstalledUpdates } from '@n10/engine';
import type { UpdatePreferences, UpdateService } from '@n10/engine/contract';

let updates: Promise<UpdateService> | undefined;
function service() {
  updates ??= createInstalledUpdates(
    process.env.N10_UPDATE_ROOT ?? '',
    process.env.N10_UPDATE_PACKAGED === '1'
  );
  return updates;
}
export async function getUpdates() {
  const current = await service();
  current.reloadPreferences();
  return current.getSnapshot();
}
export async function checkUpdates() {
  await (await service()).check();
}
export async function setUpdatePreferences(patch: Partial<UpdatePreferences>) {
  (await service()).setPreferences(patch);
}
export async function startUpdates() {
  (await service()).start();
}
export async function stopUpdates() {
  if (updates) (await updates).stop();
}
