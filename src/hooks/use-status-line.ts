import { useEffect, useState } from "react";

const STORAGE_KEY = "padline:statusline";

function initialVisible(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== "off";
}

/**
 * Whether the status line is shown. Keyed globally rather than per pad — like
 * identity, it is a preference about the visitor, not about one document.
 */
export function useStatusLine() {
  const [visible, setVisible] = useState<boolean>(initialVisible);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, visible ? "on" : "off");
  }, [visible]);

  const toggleStatusLine = () => setVisible((current) => !current);

  return { statusLineVisible: visible, toggleStatusLine };
}
