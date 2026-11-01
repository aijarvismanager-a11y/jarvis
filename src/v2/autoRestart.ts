import { useState } from "react";

// "Restart the server by itself once it runs old code and no request is running": a choice kept in this browser only.
const KEY = "autoRestartServer";

export function getAutoRestart(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function useAutoRestartChoice(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(getAutoRestart);
  return [
    on,
    (next) => {
      setOn(next);
      try {
        localStorage.setItem(KEY, next ? "1" : "0");
      } catch {
        /* storage blocked: the choice only lasts for this screen */
      }
    },
  ];
}
