import { useEffect, useState } from "react";
import { History } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  fetchSnapshots,
  restoreSnapshot,
  type SnapshotMeta,
} from "@/lib/pad-api";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function SnapshotRow({
  snapshot,
  onRestore,
}: {
  snapshot: SnapshotMeta;
  onRestore: (id: number) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    setBusy(true);
    try {
      await onRestore(snapshot.id);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <div className="flex flex-col">
        <span className="text-sm">
          {new Date(snapshot.createdAt).toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatSize(snapshot.size)}
        </span>
      </div>
      <Button
        size="sm"
        variant={confirming ? "destructive" : "outline"}
        disabled={busy}
        onClick={handleClick}
      >
        {busy ? "Restoring…" : confirming ? "Confirm restore" : "Restore"}
      </Button>
    </div>
  );
}

export function HistorySheet({
  slug,
  token,
}: {
  slug: string;
  token?: string;
}) {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(false);
    fetchSnapshots(slug, token)
      .then(setSnapshots)
      .catch(() => setError(true));
  }, [open, slug, token]);

  const handleRestore = async (id: number) => {
    await restoreSnapshot(slug, id, token);
    setOpen(false);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Document history"
      >
        <History className="size-4" aria-hidden />
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>History</SheetTitle>
          <SheetDescription>
            Snapshots are taken automatically while the pad is edited.
            Restoring applies the snapshot as a new edit — nothing is lost.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-2 overflow-y-auto px-4 pb-4">
          {error && (
            <p className="text-sm text-destructive">
              Couldn't load history. Try again.
            </p>
          )}
          {snapshots?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No snapshots yet — they appear about a minute after edits.
            </p>
          )}
          {snapshots?.map((s) => (
            <SnapshotRow key={s.id} snapshot={s} onRestore={handleRestore} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
