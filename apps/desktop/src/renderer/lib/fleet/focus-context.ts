import { createContext, type RefObject } from 'react';

/** Whether the fleet view's container was already on screen. */
export const ContainerMounted = createContext<RefObject<boolean> | null>(null);
