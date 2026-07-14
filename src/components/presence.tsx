import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AwarenessUser } from "@/hooks/use-awareness-users";
import type { Identity } from "@/lib/identity";

const MAX_VISIBLE_OTHERS = 4;

function initials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function Avatar({
  name,
  color,
  className = "",
}: {
  name: string;
  color: string;
  className?: string;
}) {
  return (
    <span
      className={`flex size-7 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-background ${className}`}
      style={{ backgroundColor: color }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

export function Presence({
  users,
  selfClientId,
  identity,
  onRename,
}: {
  users: AwarenessUser[];
  selfClientId: number;
  identity: Identity;
  onRename: (name: string) => void;
}) {
  const [draft, setDraft] = useState(identity.name);
  const [open, setOpen] = useState(false);

  const others = users.filter((u) => u.clientId !== selfClientId);
  const visible = others.slice(0, MAX_VISIBLE_OTHERS);
  const overflow = others.length - visible.length;

  const submitRename = (e: React.FormEvent) => {
    e.preventDefault();
    const name = draft.trim();
    if (name && name !== identity.name) onRename(name);
    setOpen(false);
  };

  return (
    <div className="flex items-center">
      <div className="flex -space-x-2">
        {visible.map((u) => (
          <Avatar key={u.clientId} name={u.name} color={u.color} />
        ))}
        {overflow > 0 && (
          <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground ring-2 ring-background">
            +{overflow}
          </span>
        )}
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="rounded-full transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-label={`You are ${identity.name} — click to rename`}
            >
              <Avatar name={identity.name} color={identity.color} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64">
            <form onSubmit={submitRename} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="presence-name">Your name in this session</Label>
                <Input
                  id="presence-name"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={40}
                  autoFocus
                />
              </div>
              <Button type="submit" size="sm">
                Save
              </Button>
            </form>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
