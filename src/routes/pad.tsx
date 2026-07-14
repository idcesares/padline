import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import useYProvider from "y-partyserver/react";
import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { PenLine } from "lucide-react";
import { isValidSlug } from "@/lib/slug";
import { getIdentity } from "@/lib/identity";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import { ThemeToggle } from "@/components/theme-toggle";

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

  return <PadEditor slug={slug} />;
}

function PadEditor({ slug }: { slug: string }) {
  const identity = useMemo(getIdentity, []);
  const { theme, toggleTheme } = useTheme();
  const [doc] = useState(() => new Y.Doc());
  const [status, setStatus] = useState<SyncStatus>("connecting");

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
  });

  useEffect(() => {
    const onStatus = ({ status }: { status: SyncStatus }) => setStatus(status);
    provider.on("status", onStatus);
    return () => provider.off("status", onStatus);
  }, [provider]);

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

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b bg-background/80 px-4 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 font-medium">
          <PenLine className="size-4" aria-hidden />
          <span>Padline</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="max-w-48 truncate text-sm text-muted-foreground">/{slug}</span>
          <span
            className={cn(
              "size-2 rounded-full",
              status === "connected" && "bg-emerald-500",
              status === "connecting" && "bg-amber-500",
              status === "disconnected" && "bg-red-500",
            )}
            title={status}
            aria-label={`Sync status: ${status}`}
          />
          <span
            className="flex size-7 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ backgroundColor: identity.color }}
            title={identity.name}
          >
            {identity.name.split(" ").map((w) => w[0]).join("")}
          </span>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <BlockNoteView editor={editor} theme={theme} />
      </main>
    </div>
  );
}
