import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UpdatePreferences } from '../../../host/contract.js';

const KEY = ['app-updates'];
export function useUpdates() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => window.n10.getUpdates(),
    refetchInterval: 2000,
  });
}
export function useUpdateActions() {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: KEY });
  const check = useMutation({
    mutationFn: () => window.n10.checkUpdates(),
    onSettled: refresh,
  });
  const preferences = useMutation({
    mutationFn: (patch: Partial<UpdatePreferences>) =>
      window.n10.setUpdatePreferences(patch),
    onSuccess: refresh,
  });
  return { check, preferences };
}
