import { useEffect, useState } from "react";
import type YProvider from "y-partyserver/provider";

export type AwarenessUser = {
  clientId: number;
  name: string;
  color: string;
};

/** Live list of everyone in the pad, from Yjs awareness. */
export function useAwarenessUsers(provider: YProvider): AwarenessUser[] {
  const [users, setUsers] = useState<AwarenessUser[]>([]);

  useEffect(() => {
    const awareness = provider.awareness;
    const update = () => {
      const list: AwarenessUser[] = [];
      awareness.getStates().forEach((state, clientId) => {
        const user = state?.user as { name?: string; color?: string } | undefined;
        if (user?.name) {
          list.push({
            clientId,
            name: user.name,
            color: user.color ?? "#71717a",
          });
        }
      });
      setUsers(list.sort((a, b) => a.clientId - b.clientId));
    };
    update();
    awareness.on("change", update);
    return () => {
      awareness.off("change", update);
    };
  }, [provider]);

  return users;
}
