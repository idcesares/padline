# Modern Collaborative Dontpad

## 1. Proposal Summary

Build a lightweight, real-time collaborative text workspace inspired by Dontpad.

The product should preserve the original strengths of the Dontpad model:

- instant access through a simple URL;
- no mandatory account creation;
- minimal interface;
- automatic persistence;
- easy sharing;
- low operational complexity.

The main evolution is reliable simultaneous collaboration, including conflict-free editing, presence, collaborative cursors, offline recovery, and document history.

---

## 2. Product Concept

A user opens or creates a page through a URL:

```text
https://pad.example.com/project-idea
```

The page immediately becomes an editable collaborative document.

Anyone with the link may access the pad, subject to its privacy configuration.

The document should load quickly, remain usable on mobile and desktop, and require almost no onboarding.

---

## 3. Core Principles

1. **URL-first access**  
   The URL is the primary identity of a pad.

2. **No friction**  
   Opening a pad should be enough to start writing.

3. **Real-time by default**  
   Multiple users may edit the same document simultaneously.

4. **Local resilience**  
   Temporary network loss must not destroy recent work.

5. **Minimal interface**  
   The editor remains the main product surface.

6. **Progressive complexity**  
   Authentication, attachments, rich text, and advanced permissions should remain optional.

7. **Low-cost operations**  
   The architecture should scale from a small prototype to a public service without requiring a large infrastructure team.

---

## 4. Main User Experience

### Create or open a pad

The user enters any valid path:

```text
/project-idea
```

If the pad does not exist, it is created automatically.

If it already exists, the current document is loaded.

### Edit collaboratively

Users can:

- type simultaneously;
- see remote cursors and selections;
- recover from connection interruptions;
- receive live updates;
- view basic presence information;
- access recent document history.

### Share

Sharing requires only copying the URL.

Optional controls may include:

- public editing;
- read-only sharing;
- PIN protection;
- expiration date;
- private ownership through an account.

---

## 5. Recommended Technical Stack

### Frontend

- **TypeScript**
- **Vite**
- **CodeMirror 6**
- **Yjs**
- **y-indexeddb**
- Minimal CSS or a lightweight utility layer

CodeMirror 6 provides a compact and extensible editing experience. Yjs manages conflict-free collaborative state. IndexedDB allows local recovery and offline continuity.

### Backend

- **Cloudflare Workers**
- **Hono**
- **Durable Objects**
- **Durable Object SQLite**
- **WebSockets with hibernation**

Each pad maps to a Durable Object identified by its slug.

```text
/project-idea
      ↓
Durable Object: project-idea
```

The Durable Object becomes the authoritative collaboration room for that pad.

### Optional Infrastructure

- **Cloudflare D1** for global metadata, moderation, accounts, and search
- **Cloudflare R2** for attachments, exports, and media
- **Cloudflare Turnstile** for abuse prevention
- **Cloudflare Analytics or external telemetry** for product monitoring

---

## 6. High-Level Architecture

```text
Browser
  │
  ├── CodeMirror 6
  ├── Yjs document
  ├── IndexedDB persistence
  └── WebSocket connection
          │
          ▼
Cloudflare Worker + Hono
          │
          ▼
Durable Object for the pad
  ├── active connections
  ├── collaborative document state
  ├── presence
  ├── revision management
  └── SQLite persistence
          │
          ├── D1: optional global metadata
          └── R2: optional attachments
```

---

## 7. Collaboration Model

Yjs should manage the shared document state.

Each connected client maintains a local Yjs document and exchanges binary updates with the Durable Object.

The server should:

- relay Yjs updates;
- persist document snapshots;
- retain a limited revision history;
- restore the latest valid state after restart;
- manage awareness and presence messages;
- disconnect abusive or invalid clients.

The initial implementation should support plain text or Markdown rather than rich-text block structures.

---

## 8. Data Model

### Pad metadata

```ts
type PadMetadata = {
  slug: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  visibility: "public" | "unlisted" | "protected" | "private";
  expiresAt?: string;
  ownerId?: string;
};
```

### Durable Object storage

Each pad should store:

- current Yjs state;
- latest compact snapshot;
- revision sequence;
- timestamps;
- optional PIN hash;
- expiration policy;
- basic moderation flags.

### Global metadata

D1 should only be introduced when cross-pad operations become necessary, such as:

- account ownership;
- administrative search;
- abuse reports;
- recent document lists;
- public discovery;
- expiration queues;
- analytics aggregation.

---

## 9. Hosting Model

The full application can be hosted on Cloudflare.

```text
Cloudflare DNS
   │
   ▼
Cloudflare Worker
   ├── static frontend assets
   ├── HTTP API
   ├── WebSocket upgrade
   ├── Durable Objects
   ├── D1
   └── R2
```

### Deployment

A standard production deployment may use:

- GitHub repository;
- GitHub Actions;
- automated tests;
- `wrangler deploy`;
- preview and production environments;
- environment-specific bindings.

The project can begin on the Cloudflare free tier and migrate to the paid Workers plan when production traffic requires it.

---

## 10. MVP Scope

### Included

- create or open a pad through its URL;
- plain-text or Markdown editing;
- real-time simultaneous collaboration;
- collaborative cursors;
- automatic persistence;
- local IndexedDB recovery;
- reconnection handling;
- basic document history;
- public and PIN-protected pads;
- responsive interface;
- pad expiration;
- basic rate limiting.

### Excluded from the first version

- rich block editor;
- comments;
- file attachments;
- semantic search;
- AI features;
- teams and workspaces;
- granular role management;
- public pad directory;
- end-to-end encryption;
- complex account system.

---

## 11. Delivery Phases

### Phase 1 — Functional Prototype

- URL-based pad creation;
- CodeMirror editor;
- Yjs collaboration;
- Durable Object WebSocket room;
- persistent snapshots;
- local recovery.

### Phase 2 — Reliable MVP

- presence and cursors;
- document history;
- PIN protection;
- expiration policies;
- rate limiting;
- monitoring and error reporting;
- mobile usability improvements.

### Phase 3 — Productization

- optional accounts;
- private pads;
- read-only links;
- attachments through R2;
- administrative moderation;
- analytics;
- export formats.

---

## 12. Security and Abuse Controls

A public, anonymous collaborative editor is inherently vulnerable to abuse.

The MVP should include:

- strict slug validation;
- payload size limits;
- connection limits per pad and IP;
- rate limiting;
- content and storage quotas;
- configurable expiration;
- hashed PIN storage;
- administrative deletion;
- abuse reporting;
- optional Turnstile challenges for suspicious traffic;
- sanitization of rendered Markdown;
- no arbitrary HTML execution.

Anonymous access should remain possible, but not unrestricted.

---

## 13. Main Trade-offs

### Durable Objects

**Advantages**

- natural mapping between one pad and one stateful room;
- strong consistency;
- integrated WebSockets and storage;
- low operational overhead;
- suitable for hibernating inactive rooms.

**Trade-off**

- each pad has one coordination location, which may introduce additional latency for geographically distant collaborators.

### Yjs

**Advantages**

- conflict-free concurrent editing;
- offline support;
- efficient incremental updates;
- mature editor integrations.

**Trade-off**

- binary document state and revision management are more complex than storing a plain text field.

### CodeMirror 6

**Advantages**

- lightweight;
- extensible;
- appropriate for text and Markdown;
- good performance with large documents.

**Trade-off**

- not intended to behave like a full Notion-style rich-text editor.

---

## 14. Success Criteria

The first production version should achieve:

- near-instant document opening;
- no lost edits during ordinary connection interruptions;
- stable simultaneous editing;
- automatic recovery after reconnection;
- minimal onboarding;
- predictable infrastructure costs;
- no server management outside the Cloudflare platform;
- maintainable code with limited infrastructure dependencies.

---

## 15. Final Recommendation

Use the following architecture for the initial implementation:

```text
Vite
TypeScript
CodeMirror 6
Yjs
y-indexeddb
Hono
Cloudflare Workers
Durable Objects
Durable Object SQLite
WebSocket Hibernation
```

Add D1, R2, authentication, and richer permissions only when concrete product requirements justify them.

The result should feel like Dontpad in its simplicity, but provide the collaboration reliability expected from a modern 2026 application.
