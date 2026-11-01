/**
 * Placeholder, kept on purpose. Migration v2 in wrangler.jsonc registered a
 * Durable Object namespace for this class, and a Worker may not stop exporting
 * a class its applied migrations still name. Nothing binds to it and nothing
 * calls it. To remove it, add a `deleted_classes` migration and delete this
 * file; that erases whatever the namespace stores.
 */
export class ModerationLedger implements DurableObject {
  async fetch(): Promise<Response> {
    return new Response("Gone", { status: 410 });
  }
}
