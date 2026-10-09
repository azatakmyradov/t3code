import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";

/** Runs one bot command at a time and keeps its failure message for display. */
export function useBotOperation() {
  // A ref rather than `busy`: a double tap arrives before React re-renders.
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async <A, E>(operation: () => Promise<AtomCommandResult<A, E>>) => {
    if (pending.current) return null;
    pending.current = true;
    setBusy(true);
    setError(null);
    const result = await operation();
    pending.current = false;
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Something went wrong. Try again.");
    }
    return result;
  };
  return { busy, error, setError, run };
}
