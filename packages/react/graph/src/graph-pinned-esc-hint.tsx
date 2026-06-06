import { Button } from "@/components/ui/button.js";
import { Kbd } from "@/components/ui/kbd";
import { useMemoriesGraphChrome } from "./use-projection.js";

/** Shown when pin/search drives the subgraph; reads {@link useMemoriesGraphChrome}. */
export function GraphPinnedEscHint() {
  const { hasGraphSubgraphStrongFocus, dismissPersistentGraphFocus } = useMemoriesGraphChrome();
  if (!hasGraphSubgraphStrongFocus) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="flex shrink-0 items-center gap-2"
      onClick={() => dismissPersistentGraphFocus()}
    >
      <span className="text-xs text-muted-foreground font-normal">esc to clear edges</span>
      <Kbd className="text-[10px]">Esc</Kbd>
    </Button>
  );
}
