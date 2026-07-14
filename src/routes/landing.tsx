import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, PenLine } from "lucide-react";
import { randomSlug, normalizeSlug, isValidSlug } from "@/lib/slug";
import { useTheme } from "@/hooks/use-theme";
import { ThemeToggle } from "@/components/theme-toggle";

export default function Landing() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [path, setPath] = useState("");

  const openPad = (slug: string) => navigate(`/${slug}`, { viewTransition: true });

  const openCustomPath = (e: React.FormEvent) => {
    e.preventDefault();
    const slug = normalizeSlug(path);
    if (slug && isValidSlug(slug)) openPad(slug);
  };

  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center gap-10 px-6">
      <div className="absolute right-4 top-4">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
      </div>
      <div className="flex animate-in flex-col items-center gap-4 text-center fade-in slide-in-from-bottom-3 duration-500 fill-mode-both">
        <div className="flex items-center gap-2.5">
          <PenLine className="size-8" aria-hidden />
          <h1 className="text-4xl font-semibold tracking-tight">Padline</h1>
        </div>
        <p className="max-w-md text-balance text-muted-foreground">
          Real-time collaborative pads. Open a URL, start writing, share the
          link. No accounts, no friction.
        </p>
      </div>

      <div className="flex w-full max-w-sm animate-in flex-col gap-3 fade-in slide-in-from-bottom-3 duration-500 delay-150 fill-mode-both">
        <button
          type="button"
          onClick={() => openPad(randomSlug())}
          className="group inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-primary px-6 font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          New pad
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </button>

        <form onSubmit={openCustomPath} className="flex gap-2">
          <div className="flex h-11 flex-1 items-center rounded-lg border bg-background pl-3 shadow-xs transition-shadow focus-within:ring-2 focus-within:ring-ring/50">
            <span className="text-muted-foreground">/</span>
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="or open a specific path"
              className="h-full w-full bg-transparent px-1 outline-none placeholder:text-muted-foreground"
              aria-label="Pad path"
            />
          </div>
          <button
            type="submit"
            className="inline-flex h-11 items-center justify-center rounded-lg border bg-background px-4 font-medium shadow-xs transition-all hover:bg-accent active:scale-[0.98]"
          >
            Open
          </button>
        </form>
      </div>
    </main>
  );
}
