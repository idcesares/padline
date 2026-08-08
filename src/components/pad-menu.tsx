import { useState } from "react";
import { Check, Copy, Download, MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function PadMenu({
  slug,
  getMarkdown,
  statusLineVisible,
  onToggleStatusLine,
}: {
  slug: string;
  getMarkdown: () => string | Promise<string>;
  statusLineVisible: boolean;
  onToggleStatusLine: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(await getMarkdown());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const downloadMarkdown = async () => {
    const blob = new Blob([await getMarkdown()], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
          aria-label="Pad menu"
        >
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={copyMarkdown}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          Copy as Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onClick={downloadMarkdown}>
          <Download className="size-4" />
          Download .md
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={statusLineVisible}
          onCheckedChange={onToggleStatusLine}
        >
          Show status line
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
