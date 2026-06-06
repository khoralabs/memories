import { Check, FolderSearchIcon, RefreshCcwIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { type GraphScope, useMemoriesGraphChrome } from "./use-projection.js";

export type GraphNamespaceSelectorProps = {
  className?: string;
};

type NamespacePickerMenuProps = { close: () => void };

function NamespacePickerMenu({ close }: NamespacePickerMenuProps) {
  const {
    namespace: value,
    setNamespace: onValueChange,
    namespaceRoot,
    setScope,
    knownNamespaces,
    knownProfiles,
    namespacesLoading: knownLoading,
    namespacesError: knownError,
  } = useMemoriesGraphChrome();
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const filteredProfiles = useMemo(() => {
    if (!q) return knownProfiles;
    return knownProfiles.filter((p) => {
      const label = (p.username ?? p.profileId).toLowerCase();
      return label.includes(q) || p.namespace.toLowerCase().includes(q);
    });
  }, [knownProfiles, q]);

  const filteredNs = !q
    ? knownNamespaces
    : knownNamespaces.filter((ns) => ns.toLowerCase().includes(q));

  const customExact = search.trim();
  const showCustom = customExact.length > 0 && !knownNamespaces.includes(customExact);
  const showNoMatches = filteredNs.length === 0 && filteredProfiles.length === 0 && !showCustom;

  const commitNamespace = (raw: string, scope: GraphScope) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    close();
    setSearch("");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setScope(scope);
        onValueChange(trimmed);
      });
    });
  };

  const commitFromList = (ns: string) => {
    commitNamespace(ns, ns === namespaceRoot ? "subtree" : "exact");
  };

  return (
    <Command shouldFilter={false}>
      <CommandInput
        placeholder="Search or type a namespace…"
        value={search}
        onValueChange={setSearch}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const t = search.trim();
            if (t) commitFromList(t);
          }
        }}
      />
      <CommandList>
        {showNoMatches && (
          <CommandEmpty>
            {knownLoading
              ? "Loading namespaces…"
              : knownError
                ? `Could not load: ${knownError}`
                : "Type a new namespace and press Enter, or pick one from the list."}
          </CommandEmpty>
        )}

        {filteredProfiles.length > 0 && (
          <CommandGroup heading="Profiles">
            {filteredProfiles.map((p) => {
              const label = p.username ? `@${p.username}` : p.profileId;
              return (
                <CommandItem
                  key={p.profileId}
                  value={`profile:${p.profileId}`}
                  onSelect={() => commitNamespace(p.namespace, "exact")}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4 shrink-0",
                      value === p.namespace ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {!p.indexed ? (
                    <span className="ml-2 shrink-0 text-xs text-muted-foreground">not indexed</span>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {filteredNs.length > 0 && (
          <CommandGroup heading="In database">
            {filteredNs.map((ns) => (
              <CommandItem key={ns} value={ns} onSelect={() => commitFromList(ns)}>
                <Check
                  className={cn("mr-2 size-4 shrink-0", value === ns ? "opacity-100" : "opacity-0")}
                  aria-hidden
                />
                <span className="min-w-0 break-all">{ns}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {showCustom && (
          <CommandGroup heading="Custom">
            <CommandItem
              value={`~custom~${customExact}`}
              onSelect={() => commitFromList(customExact)}
            >
              Use &quot;{customExact}&quot;
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

/** Namespace row + combobox; reads {@link useMemoriesGraphChrome} — must be under {@link GraphProjectionProvider}. */
export function GraphNamespaceSelector({ className }: GraphNamespaceSelectorProps = {}) {
  const {
    namespace: value,
    graphLoading: disabled,
    graphSummary,
    refreshAll,
  } = useMemoriesGraphChrome();

  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const [anchorWidth, setAnchorWidth] = useState<number>();

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const update = () => setAnchorWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const close = () => setOpen(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={rowRef} className="w-full">
          <InputGroup className={cn("relative w-full", className)}>
            <div className="pointer-events-none relative z-0 flex min-h-9 min-w-0 flex-1 items-center justify-between gap-1 self-stretch px-2">
              <span className="min-w-0 flex-1 truncate text-left text-sm">
                {value || "Namespace"}
              </span>
            </div>
            <InputGroupAddon className="pointer-events-none">
              <FolderSearchIcon className="text-muted-foreground" aria-hidden />
            </InputGroupAddon>
            <InputGroupAddon
              align="inline-end"
              className="pointer-events-none text-xs font-normal tabular-nums"
            >
              {graphSummary || "\u00a0"}
            </InputGroupAddon>
            <InputGroupAddon align="inline-end" className="relative z-[2]">
              <InputGroupButton
                variant="ghost"
                disabled={disabled}
                type="button"
                data-namespace-refresh
                onClick={() => {
                  void refreshAll();
                }}
              >
                <RefreshCcwIcon className="text-muted-foreground" aria-hidden />
              </InputGroupButton>
            </InputGroupAddon>
            <PopoverTrigger asChild>
              <button
                type="button"
                data-slot="namespace-popover-trigger"
                disabled={disabled}
                aria-expanded={open}
                aria-label="Namespace"
                title={value}
                className={cn(
                  "absolute inset-0 z-[1] cursor-pointer rounded-md opacity-0 disabled:cursor-not-allowed",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
                )}
              />
            </PopoverTrigger>
          </InputGroup>
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="p-0 max-w-none"
        align="start"
        style={anchorWidth != null ? { width: anchorWidth } : undefined}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <NamespacePickerMenu key={open ? "open" : "closed"} close={close} />
      </PopoverContent>
    </Popover>
  );
}
