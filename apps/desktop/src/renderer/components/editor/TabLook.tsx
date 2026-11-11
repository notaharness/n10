import type { SidebarItem } from '../../../host/contract.js';
import { usePlanCount } from '../../lib/plan/plan.js';
import { itemRunning } from '../../lib/sidebar/sidebar-model.js';
import { cutSide } from '../../lib/tabs/tab-presentation.js';
import { FACE_ICON, TabIcon } from './TabIcon.js';
import { TabLabel } from './TabLabel.js';
import {
  PlanCountBadge,
  PinnedMark,
  RemovedMark,
  RepoBand,
  TabCloseButton,
  UnseenDot,
} from './tab-marks.js';
import type { TabFace } from './use-strip-groups.js';

/**
 * What a tab shows, drawn the same on the strip (`TabButton`) and in the
 * copy that follows the pointer out of it (`CarriedOverlay`).
 */

/** What follows the label: the plan count, the removed and unseen
 *  marks, and the close button (none on a group's home, whose chip is
 *  no tab to close) — or, on a pinned tab, its pin mark. */
export function TabEnd({
  item,
  unseen,
  pinned = false,
  onClose,
}: {
  item: SidebarItem | undefined;
  unseen: boolean;
  pinned?: boolean;
  onClose?: () => void;
}) {
  // A plan is built inside a tab and then navigated away from, so the
  // count has to be visible from wherever the user ends up.
  const planCount = usePlanCount(item?.pr?.id);
  return (
    <>
      <PlanCountBadge count={planCount} />
      <RemovedMark item={item} />
      {unseen && <UnseenDot />}
      {pinned ? (
        <PinnedMark />
      ) : (
        onClose && (
          <TabCloseButton
            onClose={(e) => {
              e.stopPropagation();
              onClose();
            }}
          />
        )
      )}
    </>
  );
}

/** A tab's face: its icon and status, label, end marks and repository
 *  band. No close button without `onClose`. */
export function TabLook({
  face,
  active,
  pinned = false,
  onClose,
}: {
  face: TabFace;
  active: boolean;
  pinned?: boolean;
  onClose?: () => void;
}) {
  const { tab, item, snapshot, repoColor } = face;
  const { label, labelKind: kind } = face;
  return (
    <>
      <TabIcon
        Icon={FACE_ICON[kind]}
        running={item ? itemRunning(item) : face.running}
        snapshot={snapshot}
        active={active}
      />
      <TabLabel
        label={label}
        parts={face.labelParts}
        preview={tab.preview}
        task={face.agentTab && kind !== 'pr'}
        cut={face.labelSource === 'task' ? 'end' : cutSide(kind)}
      />
      <TabEnd
        item={item}
        unseen={face.unseen}
        pinned={pinned}
        {...(onClose ? { onClose } : {})}
      />
      {/* After the close button, so its cover leaves the band whole. */}
      <RepoBand color={repoColor} />
    </>
  );
}
