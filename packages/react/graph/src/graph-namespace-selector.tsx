import { Check, FolderSearchIcon } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { GraphRefreshButton, type GraphRefreshButtonProps } from "./graph-refresh-button.js";
import { namespaceEntryLabel } from "./lib/namespace-entries.js";
import { useMemoriesNamespaces } from "./memories-namespaces-provider.js";
import { useMemoriesGraphChrome } from "./use-projection.js";

export type GraphNamespaceSelectorProps = {
  className?: string;
  refreshButtonProps?: GraphRefreshButtonProps;
};

type NamespacePickerMenuProps = { close: () => void };

function NamespacePickerMenu({ close }: NamespacePickerMenuProps) {
  const {
    namespace: value,
    focus,
    namespaceRoot,
    paths,
    entries,
    profiles,
    loading: knownLoading,
    error: knownError,
  } = useMemoriesNamespaces();
  const [search, setSearch] = useState("");

  const q = search.trim().toLowerCase();
  const filteredProfiles = useMemo(() => {
    if (!q) return profiles;
    return profiles.filter((p) => {
      const label = (p.username ?? p.profileId).toLowerCase();
      return label.includes(q) || p.namespace.toLowerCase().includes(q);
    });
  }, [profiles, q]);

  const filteredNs = useMemo(() => {
    if (!q) return entries;
    return entries.filter((entry) => {
      const alias = entry.alias?.toLowerCase() ?? "";
      return (
        entry.namespace.toLowerCase().includes(q) ||
        alias.includes(q) ||
        entry.description.toLowerCase().includes(q)
      );
    });
  }, [entries, q]);

  const customExact = search.trim();
  const showCustom = customExact.length > 0 && !paths.includes(customExact);
  const showNoMatches = filteredNs.length === 0 && filteredProfiles.length === 0 && !showCustom;

  const commitFromList = (ns: string) => {
    const trimmed = ns.trim();
    if (!trimmed) return;
    close();
    setSearch("");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        focus(trimmed, trimmed === namespaceRoot ? "subtree" : "exact");
      });
    });
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
                  onSelect={() => {
                    close();
                    setSearch("");
                    requestAnimationFrame(() => {
                      requestAnimationFrame(() => {
                        focus(p.namespace, "exact");
                      });
                    });
                  }}
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
            {filteredNs.map((entry) => {
              const label = namespaceEntryLabel(entry);
              const showPath = label !== entry.namespace;
              return (
                <CommandItem
                  key={entry.namespace}
                  value={`${entry.namespace} ${entry.alias ?? ""} ${entry.description}`}
                  title={entry.description || entry.namespace}
                  onSelect={() => commitFromList(entry.namespace)}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4 shrink-0",
                      value === entry.namespace ? "opacity-100" : "opacity-0",
                    )}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="break-all">{label}</span>
                    {showPath ? (
                      <span className="mt-0.5 block break-all text-xs text-muted-foreground">
                        {entry.namespace}
                      </span>
                    ) : null}
                  </span>
                </CommandItem>
              );
            })}
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

/** Namespace row + combobox; reads {@link useMemoriesNamespaces} + graph chrome summary. */
export function GraphNamespaceSelector({
  className,
  refreshButtonProps,
}: GraphNamespaceSelectorProps = {}) {
  const { namespace: value } = useMemoriesNamespaces();
  const { graphLoading: disabled, graphSummary } = useMemoriesGraphChrome();

  const {
    className: refreshClassName,
    onClick: refreshOnClick,
    children: refreshChildren,
    variant: refreshVariant = "ghost",
    disabled: refreshDisabled,
    type: refreshType = "button",
    ...restRefreshProps
  } = refreshButtonProps ?? {};

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
              <GraphRefreshButton
                data-namespace-refresh
                size="icon-sm"
                variant={refreshVariant}
                type={refreshType}
                {...restRefreshProps}
                disabled={refreshDisabled ?? disabled}
                className={refreshClassName}
                onClick={refreshOnClick}
              >
                {refreshChildren}
              </GraphRefreshButton>
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
