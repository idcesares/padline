import { Link, useParams, useSearchParams } from "react-router";
import { isValidSlug } from "@/lib/slug";
import { PadSession } from "@/routes/pad-session";

export default function Pad() {
  const { slug = "" } = useParams();
  const [searchParams] = useSearchParams();
  const readOnlyToken = searchParams.get("v") || undefined;

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

  return (
    <PadSession
      key={`${slug}:${readOnlyToken ?? "edit"}`}
      slug={slug}
      readOnlyToken={readOnlyToken}
    />
  );
}
