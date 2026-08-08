import { cn } from "@/lib/utils";
import type { PadSelection, PadStats } from "@/hooks/use-pad-stats";

export type SyncStatus = "connecting" | "connected" | "disconnected";

const SYNC_LABEL: Record<SyncStatus, string> = {
  connecting: "Connecting",
  connected: "Synced",
  disconnected: "Offline",
};

const SYNC_TONE: Record<SyncStatus, string> = {
  connecting: "bg-status-warn",
  connected: "bg-status-ok",
  disconnected: "bg-status-error",
};

/**
 * Shared by the header and the status line so the two can never disagree.
 *
 * Standalone (in the header) it needs `labelled` to carry its own meaning; beside
 * the status line's text label it is decorative and stays out of the a11y tree.
 */
export function SyncDot({
  status,
  className,
  labelled = false,
}: {
  status: SyncStatus;
  className?: string;
  labelled?: boolean;
}) {
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full", SYNC_TONE[status], className)}
      {...(labelled
        ? {
            role: "status",
            title: SYNC_LABEL[status],
            "aria-label": `Sync status: ${SYNC_LABEL[status]}`,
          }
        : { "aria-hidden": true })}
    />
  );
}

function Stat({
  value,
  label,
  className,
}: {
  value: number;
  label: string;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center gap-1", className)}>
      <span className="text-foreground">{value.toLocaleString()}</span>
      {label}
    </span>
  );
}

/**
 * Document statistics and connection state, docked below the editor.
 *
 * Also the home of the sync indicator: the header keeps an unlabelled dot only
 * while this bar is hidden, so the always-visible sync signal survives either way.
 */
export function StatusLine({
  status,
  stats,
  selection,
}: {
  status: SyncStatus;
  stats: PadStats;
  selection: PadSelection | null;
}) {
  return (
    <footer className="sticky bottom-0 z-10 flex h-7 shrink-0 items-center justify-between gap-4 border-t bg-background/80 px-4 text-xs whitespace-nowrap text-muted-foreground tabular-nums backdrop-blur">
      <span className="flex items-center gap-2" role="status">
        <SyncDot status={status} />
        {SYNC_LABEL[status]}
      </span>

      {selection ? (
        <span className="flex items-center gap-1">
          <span className="text-foreground">
            {selection.words.toLocaleString()}
          </span>
          of {stats.words.toLocaleString()} words selected
          <span className="hidden sm:inline">
            {" · "}
            {selection.characters.toLocaleString()} characters
          </span>
        </span>
      ) : (
        <span className="flex items-center gap-3">
          <Stat value={stats.words} label="words" />
          <Stat
            value={stats.characters}
            label="characters"
            className="hidden sm:flex"
          />
          <Stat value={stats.blocks} label="blocks" className="hidden md:flex" />
          {stats.readingMinutes > 0 && (
            <span className="hidden items-center gap-1 md:flex">
              <span className="text-foreground">{stats.readingMinutes}</span>
              min read
            </span>
          )}
        </span>
      )}
    </footer>
  );
}
