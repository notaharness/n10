/**
 * Whether the review rail is collapsed. The reader collapses and shows it
 * with its own control; a workspace too narrow for the rail beside the
 * content collapses it the same way, and gives it back once there is
 * room, unless the reader has chosen since.
 */

/** Below this workspace width the rail would squeeze the content. */
export const NARROW_WORKSPACE = 720;

export interface RailState {
  hidden: boolean;
  /** Collapsed for the width, not by the reader. */
  auto: boolean;
  narrow: boolean;
}

export const RAIL_SHOWN: RailState = {
  hidden: false,
  auto: false,
  narrow: false,
};

/** The rail as the workspace crosses into or out of narrow. */
export function railAtWidth(state: RailState, narrow: boolean): RailState {
  if (narrow === state.narrow) return state;
  if (narrow && !state.hidden) return { hidden: true, auto: true, narrow };
  if (!narrow && state.auto) return { hidden: false, auto: false, narrow };
  return { ...state, narrow };
}

/** The reader's own choice, which the width no longer undoes. */
export function railByReader(state: RailState, hidden: boolean): RailState {
  return { ...state, hidden, auto: false };
}
