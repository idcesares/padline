import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import useYProvider from "y-partyserver/react";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { Eye, Lock, PenLine } from "lucide-react";
import { getIdentity, saveIdentity } from "@/lib/identity";
import { usePadStats } from "@/hooks/use-pad-stats";
import { useStatusLine } from "@/hooks/use-status-line";
import { StatusLine, SyncDot } from "@/components/status-line";
import type { SyncStatus } from "@/components/status-line";
import {
  fetchPadInfo,
  fetchRoToken,
  fetchSnapshots,
  removePin,
  restoreSnapshot,
  rotateRoToken,
  setPin,
  verifyPin,
} from "@/lib/pad-api";
import { cn } from "@/lib/utils";
import { useAwarenessUsers } from "@/hooks/use-awareness-users";
import { useTheme } from "@/hooks/use-theme";
import { HistorySheet } from "@/components/history-sheet";
import { PadMenu } from "@/components/pad-menu";
import { Presence } from "@/components/presence";
import { ShareDialog } from "@/components/share-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const {
  image: _image,
  file: _file,
  video: _video,
  audio: _audio,
  ...textBlockSpecs
} = defaultBlockSpecs;

const schema = BlockNoteSchema.create({ blockSpecs: textBlockSpecs });

type AccessState =
  | { kind: "loading" }
  | { kind: "pin" }
  | { kind: "removed" }
  | { kind: "ready"; token?: string; pinProtected: boolean };

const sessionStorageKey = (slug: string) => `padline:token:${slug}`;

function storeSession(slug: string, token?: string): void {
  if (token) localStorage.setItem(sessionStorageKey(slug), token);
  else localStorage.removeItem(sessionStorageKey(slug));
}

/** Owns access resolution and every browser resource scoped to one pad visit. */
export function PadSession({
  slug,
  readOnlyToken,
}: {
  slug: string;
  readOnlyToken?: string;
}) {
  const [access, setAccess] = useState<AccessState>(() =>
    readOnlyToken
      ? { kind: "ready", token: undefined, pinProtected: false }
      : { kind: "loading" },
  );

  useEffect(() => {
    if (readOnlyToken) return;
    let cancelled = false;
    void fetchPadInfo(slug)
      .then((info) => {
        if (cancelled) return;
        if (info.removed) {
          setAccess({ kind: "removed" });
          return;
        }
        if (!info.pinProtected) {
          setAccess({ kind: "ready", token: undefined, pinProtected: false });
          return;
        }
        const stored = localStorage.getItem(sessionStorageKey(slug));
        setAccess(
          stored
            ? { kind: "ready", token: stored, pinProtected: true }
            : { kind: "pin" },
        );
      })
      .catch(() => {
        // Local resilience: IndexedDB and the Room remain usable when the info
        // preflight is unavailable; the Room still enforces access.
        if (!cancelled) {
          setAccess({ kind: "ready", token: undefined, pinProtected: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [readOnlyToken, slug]);

  const grantPin = async (pin: string): Promise<boolean> => {
    const token = await verifyPin(slug, pin);
    if (!token) return false;
    storeSession(slug, token);
    setAccess({ kind: "ready", token, pinProtected: true });
    return true;
  };

  const rejectSession = () => {
    storeSession(slug);
    setAccess({ kind: "pin" });
  };

  const markRemoved = () => setAccess({ kind: "removed" });

  if (access.kind === "loading") return <PadSkeleton />;
  if (access.kind === "removed") return <PadRemoved slug={slug} />;
  if (access.kind === "pin") return <PinPrompt slug={slug} onVerify={grantPin} />;

  const changePin = async (pin: string) => {
    const token = await setPin(slug, pin, access.token);
    storeSession(slug, token);
    setAccess({ kind: "ready", token, pinProtected: true });
  };

  const clearPin = async () => {
    await removePin(slug, access.token);
    storeSession(slug);
    setAccess({ kind: "ready", token: undefined, pinProtected: false });
  };

  const padUrl = `${window.location.origin}/${slug}`;
  const createReadOnlyLink = async () => {
    const token = await fetchRoToken(slug, access.token);
    return `${padUrl}?v=${token}`;
  };
  const resetReadOnlyLink = async () => {
    const token = await rotateRoToken(slug, access.token);
    return `${padUrl}?v=${token}`;
  };

  return (
    <ActivePadSession
      slug={slug}
      token={access.token}
      readOnlyToken={readOnlyToken}
      pinProtected={access.pinProtected}
      padUrl={padUrl}
      onSessionRejected={rejectSession}
      onRemoved={markRemoved}
      onSetPin={changePin}
      onRemovePin={clearPin}
      onCreateReadOnlyLink={createReadOnlyLink}
      onResetReadOnlyLink={resetReadOnlyLink}
      onLoadSnapshots={() => fetchSnapshots(slug, access.token)}
      onRestoreSnapshot={(id) => restoreSnapshot(slug, id, access.token)}
    />
  );
}

function ActivePadSession({
  slug,
  token,
  readOnlyToken,
  pinProtected,
  padUrl,
  onSessionRejected,
  onRemoved,
  onSetPin,
  onRemovePin,
  onCreateReadOnlyLink,
  onResetReadOnlyLink,
  onLoadSnapshots,
  onRestoreSnapshot,
}: {
  slug: string;
  token?: string;
  readOnlyToken?: string;
  pinProtected: boolean;
  padUrl: string;
  onSessionRejected: () => void;
  onRemoved: () => void;
  onSetPin: (pin: string) => Promise<void>;
  onRemovePin: () => Promise<void>;
  onCreateReadOnlyLink: () => Promise<string>;
  onResetReadOnlyLink: () => Promise<string>;
  onLoadSnapshots: () => ReturnType<typeof fetchSnapshots>;
  onRestoreSnapshot: (id: number) => Promise<void>;
}) {
  const [identity, setIdentity] = useState(getIdentity);
  const { theme, toggleTheme } = useTheme();
  const { statusLineVisible, toggleStatusLine } = useStatusLine();
  const [doc] = useState(() => new Y.Doc());
  const [status, setStatus] = useState<SyncStatus>("connecting");
  const [ready, setReady] = useState(false);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const readOnly = !!readOnlyToken;

  useEffect(() => {
    document.title = `/${slug} — Padline`;
    return () => {
      document.title = "Padline";
    };
  }, [slug]);

  useEffect(() => {
    const persistence = new IndexeddbPersistence(`padline:${slug}`, doc);
    void persistence.whenSynced.then(() => {
      if (doc.getXmlFragment("document").length > 0) setReady(true);
    });
    return () => {
      void persistence.destroy();
    };
  }, [doc, slug]);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  const roomParams = useCallback(
    () => ({
      ...(tokenRef.current ? { token: tokenRef.current } : {}),
      ...(readOnlyToken ? { ro: readOnlyToken } : {}),
    }),
    [readOnlyToken],
  );

  const provider = useYProvider({
    party: "pad-room",
    room: slug,
    doc,
    options: { params: roomParams },
  });

  useEffect(() => {
    const onSync = (synced: boolean) => {
      if (synced) setReady(true);
    };
    provider.on("sync", onSync as never);
    return () => provider.off("sync", onSync as never);
  }, [provider]);

  useEffect(() => {
    const onStatus = ({ status: next }: { status: SyncStatus }) => setStatus(next);
    const onClose = (event: unknown) => {
      const code = (event as { code?: number } | null)?.code;
      if (code === 4401 && !readOnly) onSessionRejected();
      if (code === 4404) onRemoved();
    };
    provider.on("status", onStatus);
    provider.on("connection-close", onClose as never);
    return () => {
      provider.off("status", onStatus);
      provider.off("connection-close", onClose as never);
    };
  }, [onRemoved, onSessionRejected, provider, readOnly]);

  const users = useAwarenessUsers(provider);
  const editor = useCreateBlockNote(
    {
      schema,
      collaboration: {
        provider,
        fragment: doc.getXmlFragment("document"),
        user: identity,
      },
    },
    [provider],
  );

  const { stats, selection } = usePadStats(editor, statusLineVisible);

  const handleRename = (name: string) => {
    const next = { ...identity, name };
    saveIdentity(next);
    setIdentity(next);
    provider.awareness.setLocalStateField("user", next);
  };

  const getMarkdown = () => editor.blocksToMarkdownLossy(editor.document);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b bg-background/80 px-4 backdrop-blur">
        <Link to="/" viewTransition className="flex items-center gap-2 font-medium">
          <PenLine className="size-4" aria-hidden />
          <span>Padline</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="max-w-48 truncate text-sm text-muted-foreground">
            /{slug}
          </span>
          {readOnly && (
            <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              <Eye className="size-3" aria-hidden />
              View only
            </span>
          )}
          {!statusLineVisible && (
            <SyncDot status={status} className="mx-1" labelled />
          )}
          <Presence
            users={users}
            selfClientId={provider.awareness.clientID}
            identity={identity}
            onRename={handleRename}
          />
          {!readOnly && (
            <>
              <ShareDialog
                padUrl={padUrl}
                pinProtected={pinProtected}
                onSetPin={onSetPin}
                onRemovePin={onRemovePin}
                onCreateReadOnlyLink={onCreateReadOnlyLink}
                onResetReadOnlyLink={onResetReadOnlyLink}
              />
              <HistorySheet
                onLoadSnapshots={onLoadSnapshots}
                onRestoreSnapshot={onRestoreSnapshot}
              />
            </>
          )}
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <PadMenu
            slug={slug}
            getMarkdown={getMarkdown}
            statusLineVisible={statusLineVisible}
            onToggleStatusLine={toggleStatusLine}
          />
        </div>
      </header>
      <main
        className="relative mx-auto w-full max-w-3xl flex-1 px-4 pt-16 pb-24"
        aria-busy={!ready}
      >
        {!ready && (
          <div className="absolute inset-x-4 top-16">
            <EditorSkeleton />
          </div>
        )}
        {/*
          No `translate-y-0` at rest: Tailwind v4 compiles it to the independent
          `translate` property, whose `0px` (not `none`) creates a stacking
          context that traps BlockNote's floating toolbars under the header.
        */}
        <div
          className={cn(
            "transition-all duration-500",
            ready ? "opacity-100" : "translate-y-1 opacity-0",
          )}
        >
          <BlockNoteView editor={editor} theme={theme} editable={!readOnly} />
        </div>
      </main>
      {statusLineVisible && (
        <StatusLine status={status} stats={stats} selection={selection} />
      )}
    </div>
  );
}

function PadSkeleton() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-20" aria-busy>
      <EditorSkeleton />
    </main>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex animate-pulse flex-col gap-3 pt-1" aria-hidden>
      <div className="h-7 w-3/5 rounded-md bg-muted" />
      <div className="h-4 w-full rounded-md bg-muted" />
      <div className="h-4 w-11/12 rounded-md bg-muted" />
      <div className="h-4 w-4/6 rounded-md bg-muted" />
    </div>
  );
}

function PinPrompt({
  slug,
  onVerify,
}: {
  slug: string;
  onVerify: (pin: string) => Promise<boolean>;
}) {
  const [pin, setPinDraft] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(false);
    try {
      if (await onVerify(pin)) return;
      setError(true);
      setPinDraft("");
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Lock className="size-5" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold">This pad is protected</h1>
        <p className="text-sm text-muted-foreground">
          Enter the PIN for <span className="font-mono">/{slug}</span>
        </p>
      </div>
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col gap-3">
        <Input
          type="password"
          value={pin}
          onChange={(event) => setPinDraft(event.target.value)}
          placeholder="PIN"
          autoFocus
          aria-invalid={error}
        />
        {error && (
          <p className="text-sm text-destructive">Wrong PIN — try again.</p>
        )}
        <Button type="submit" disabled={busy || pin.length === 0}>
          {busy ? "Checking…" : "Open pad"}
        </Button>
      </form>
    </main>
  );
}

function PadRemoved({ slug }: { slug: string }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold">This pad was removed</h1>
      <p className="text-muted-foreground">
        <span className="font-mono">/{slug}</span> is no longer available. Pads
        that violate the{" "}
        <Link to="/content-policy" className="underline underline-offset-4">
          Content Policy
        </Link>{" "}
        may be removed.
      </p>
      <Link to="/" className="mt-2 underline underline-offset-4">
        Back to Padline
      </Link>
    </main>
  );
}
