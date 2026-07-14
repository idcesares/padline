import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import useYProvider from "y-partyserver/react";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { Eye, Lock, PenLine } from "lucide-react";
import { isValidSlug } from "@/lib/slug";
import { getIdentity, saveIdentity } from "@/lib/identity";
import { cn } from "@/lib/utils";
import { fetchPadInfo, tokenStorageKey, verifyPin } from "@/lib/pad-api";
import { useTheme } from "@/hooks/use-theme";
import { useAwarenessUsers } from "@/hooks/use-awareness-users";
import { ThemeToggle } from "@/components/theme-toggle";
import { Presence } from "@/components/presence";
import { PadMenu } from "@/components/pad-menu";
import { ShareDialog } from "@/components/share-dialog";
import { HistorySheet } from "@/components/history-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ADR-0007: v1 is text-first — image/file/media blocks are disabled.
const {
  image: _image,
  file: _file,
  video: _video,
  audio: _audio,
  ...textBlockSpecs
} = defaultBlockSpecs;

const schema = BlockNoteSchema.create({ blockSpecs: textBlockSpecs });

type SyncStatus = "connecting" | "connected" | "disconnected";

export default function Pad() {
  const { slug = "" } = useParams();
  const [searchParams] = useSearchParams();
  const viewToken = searchParams.get("v");

  if (!isValidSlug(slug)) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-2xl font-semibold">That's not a valid pad address</h1>
        <p className="text-muted-foreground">
          Pad paths use lowercase letters, numbers, and hyphens.
        </p>
        <Link to="/" className="mt-2 underline underline-offset-4">
          Back to Padline
        </Link>
      </main>
    );
  }

  // ADR-0005: a read-only link is a capability — no PIN gate needed.
  if (viewToken) {
    return <PadEditor slug={slug} roToken={viewToken} />;
  }

  return <PadGate slug={slug} />;
}

/** Resolves PIN protection before any document bytes are requested. */
function PadGate({ slug }: { slug: string }) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "pin" } | { kind: "ready"; token?: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchPadInfo(slug)
      .then((info) => {
        if (cancelled) return;
        if (!info.pinProtected) {
          setState({ kind: "ready", token: undefined });
          return;
        }
        const stored = localStorage.getItem(tokenStorageKey(slug));
        setState(stored ? { kind: "ready", token: stored } : { kind: "pin" });
      })
      .catch(() => {
        // Offline or transient failure: proceed; the socket enforces auth anyway.
        if (!cancelled) setState({ kind: "ready", token: undefined });
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.kind === "loading") {
    return <main className="min-h-svh" aria-busy />;
  }

  if (state.kind === "pin") {
    return (
      <PinPrompt
        slug={slug}
        onGranted={(token) => {
          localStorage.setItem(tokenStorageKey(slug), token);
          setState({ kind: "ready", token });
        }}
      />
    );
  }

  return (
    <PadEditor
      slug={slug}
      authToken={state.token}
      onAuthRejected={() => {
        localStorage.removeItem(tokenStorageKey(slug));
        setState({ kind: "pin" });
      }}
    />
  );
}

function PinPrompt({
  slug,
  onGranted,
}: {
  slug: string;
  onGranted: (token: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      const token = await verifyPin(slug, pin);
      if (token) {
        onGranted(token);
      } else {
        setError(true);
        setPin("");
      }
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
          onChange={(e) => setPin(e.target.value)}
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

function PadEditor({
  slug,
  authToken,
  roToken,
  onAuthRejected,
}: {
  slug: string;
  authToken?: string;
  roToken?: string;
  onAuthRejected?: () => void;
}) {
  const [identity, setIdentity] = useState(getIdentity);
  const { theme, toggleTheme } = useTheme();
  const [doc] = useState(() => new Y.Doc());
  const [status, setStatus] = useState<SyncStatus>("connecting");
  const [pinProtected, setPinProtected] = useState(false);
  const [token, setToken] = useState(authToken);
  const readOnly = !!roToken;

  useEffect(() => {
    fetchPadInfo(slug)
      .then((info) => setPinProtected(info.pinProtected))
      .catch(() => {});
  }, [slug]);

  // ADR: local resilience — every visited pad is cached in IndexedDB.
  useEffect(() => {
    const persistence = new IndexeddbPersistence(`padline:${slug}`, doc);
    return () => {
      void persistence.destroy();
    };
  }, [slug, doc]);

  const provider = useYProvider({
    party: "pad-room",
    room: slug,
    doc,
    options: {
      params: {
        ...(token ? { token } : {}),
        ...(roToken ? { ro: roToken } : {}),
      },
    },
  });

  useEffect(() => {
    const onStatus = ({ status }: { status: SyncStatus }) => setStatus(status);
    const onClose = (event: unknown) => {
      const code = (event as { code?: number } | null)?.code;
      if (code === 4401 && onAuthRejected) onAuthRejected();
    };
    provider.on("status", onStatus);
    provider.on("connection-close", onClose as never);
    return () => {
      provider.off("status", onStatus);
      provider.off("connection-close", onClose as never);
    };
  }, [provider, onAuthRejected]);

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

  const handleRename = (name: string) => {
    const next = { ...identity, name };
    saveIdentity(next);
    setIdentity(next);
    provider.awareness.setLocalStateField("user", next);
  };

  const handlePinChange = (protected_: boolean, newToken?: string) => {
    setPinProtected(protected_);
    setToken(newToken);
    if (newToken) {
      localStorage.setItem(tokenStorageKey(slug), newToken);
    } else {
      localStorage.removeItem(tokenStorageKey(slug));
    }
  };

  const getMarkdown = () => editor.blocksToMarkdownLossy(editor.document);

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b bg-background/80 px-4 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 font-medium">
          <PenLine className="size-4" aria-hidden />
          <span>Padline</span>
        </Link>
        <div className="flex items-center gap-2">
          <span className="max-w-48 truncate text-sm text-muted-foreground">/{slug}</span>
          {readOnly && (
            <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              <Eye className="size-3" aria-hidden />
              View only
            </span>
          )}
          <span
            className={cn(
              "mx-1 size-2 rounded-full",
              status === "connected" && "bg-emerald-500",
              status === "connecting" && "bg-amber-500",
              status === "disconnected" && "bg-red-500",
            )}
            title={status}
            aria-label={`Sync status: ${status}`}
          />
          <Presence
            users={users}
            selfClientId={provider.awareness.clientID}
            identity={identity}
            onRename={handleRename}
          />
          {!readOnly && (
            <>
              <ShareDialog
                slug={slug}
                token={token}
                pinProtected={pinProtected}
                onPinChange={handlePinChange}
              />
              <HistorySheet slug={slug} token={token} />
            </>
          )}
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <PadMenu slug={slug} getMarkdown={getMarkdown} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <BlockNoteView editor={editor} theme={theme} editable={!readOnly} />
      </main>
    </div>
  );
}
