import { useState } from "react";
import { Check, Copy, Eye, Lock, LockOpen, Share2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fetchRoToken, removePin, setPin } from "@/lib/pad-api";

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" />
        <Button variant="outline" size="icon" onClick={copy} aria-label={`Copy ${label}`}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

export function ShareDialog({
  slug,
  token,
  pinProtected,
  onPinChange,
}: {
  slug: string;
  token?: string;
  pinProtected: boolean;
  onPinChange: (protected_: boolean, newToken?: string) => void;
}) {
  const [roLink, setRoLink] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const padUrl = `${window.location.origin}/${slug}`;

  const createRoLink = async () => {
    setBusy(true);
    setError(null);
    try {
      const roToken = await fetchRoToken(slug, token);
      setRoLink(`${padUrl}?v=${roToken}`);
    } catch {
      setError("Couldn't create the read-only link.");
    } finally {
      setBusy(false);
    }
  };

  const handleSetPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pinDraft.trim().length < 4) {
      setError("PIN must be at least 4 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const newToken = await setPin(slug, pinDraft.trim(), token);
      setPinDraft("");
      onPinChange(true, newToken);
    } catch {
      setError("Couldn't set the PIN.");
    } finally {
      setBusy(false);
    }
  };

  const handleRemovePin = async () => {
    setBusy(true);
    setError(null);
    try {
      await removePin(slug, token);
      onPinChange(false, undefined);
    } catch {
      setError("Couldn't remove the PIN.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Share this pad"
      >
        <Share2 className="size-4" aria-hidden />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share this pad</DialogTitle>
          <DialogDescription>
            Anyone with a link can open it{pinProtected ? " after entering the PIN" : ""}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <CopyRow label="Link" value={padUrl} />

          <div className="flex flex-col gap-1.5">
            {roLink ? (
              <CopyRow label="Read-only link" value={roLink} />
            ) : (
              <>
                <Label>Read-only link</Label>
                <Button
                  variant="outline"
                  onClick={createRoLink}
                  disabled={busy}
                  className="justify-start"
                >
                  <Eye className="size-4" />
                  Create read-only link
                </Button>
              </>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="share-pin">PIN protection</Label>
            {pinProtected ? (
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <span className="flex items-center gap-2 text-sm">
                  <Lock className="size-4 text-muted-foreground" />
                  This pad requires a PIN
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRemovePin}
                  disabled={busy}
                >
                  <LockOpen className="size-4" />
                  Remove
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSetPin} className="flex gap-2">
                <Input
                  id="share-pin"
                  type="password"
                  value={pinDraft}
                  onChange={(e) => setPinDraft(e.target.value)}
                  placeholder="Choose a PIN (min. 4 characters)"
                  minLength={4}
                  maxLength={64}
                />
                <Button type="submit" variant="outline" disabled={busy}>
                  Set
                </Button>
              </form>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
