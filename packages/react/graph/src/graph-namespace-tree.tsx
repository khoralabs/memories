import { ChevronRight, Folder } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { type MemoriesGraphNamespaceEntry, namespaceEntryLabel } from "./lib/namespace-entries.js";
import {
  buildNamespaceTree,
  isNamespaceUnderPath,
  type NamespaceTreeNode,
} from "./lib/namespace-tree.js";
import { type GraphScope, useMemoriesGraphChrome } from "./use-projection.js";

export type GraphNamespaceTreeProps = {
  className?: string;
  label?: string;
};

type NamespaceTreeItemProps = {
  node: NamespaceTreeNode;
  activeNamespace: string;
  namespaceRoot: string;
  entriesByPath: Map<string, MemoriesGraphNamespaceEntry>;
  onSelect: (path: string, scope: GraphScope) => void;
};

function treeNodeLabel(
  node: NamespaceTreeNode,
  entriesByPath: Map<string, MemoriesGraphNamespaceEntry>,
): { label: string; title: string } {
  const entry = entriesByPath.get(node.path);
  if (entry === undefined) return { label: node.name, title: node.path };
  const label = namespaceEntryLabel(entry);
  const display = label !== entry.namespace ? label : node.name;
  const title = entry.description.trim().length > 0 ? entry.description : entry.namespace;
  return { label: display, title };
}

function NamespaceTreeItem({
  node,
  activeNamespace,
  namespaceRoot,
  entriesByPath,
  onSelect,
}: NamespaceTreeItemProps) {
  const isActive = node.path === activeNamespace;
  const hasChildren = node.children.length > 0;
  const { label, title } = treeNodeLabel(node, entriesByPath);

  if (!hasChildren) {
    const scope: GraphScope = node.path === namespaceRoot ? "subtree" : "exact";
    return (
      <SidebarMenuItem>
        <SidebarMenuButton
          isActive={isActive}
          className="data-[active=true]:bg-transparent"
          title={title}
          onClick={() => onSelect(node.path, scope)}
        >
          {label}
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <Collapsible
        className="group/collapsible [&[data-state=open]>button>svg:first-child]:rotate-90"
        defaultOpen={isNamespaceUnderPath(activeNamespace, node.path)}
      >
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            isActive={isActive}
            title={title}
            onClick={() => onSelect(node.path, "subtree")}
          >
            <ChevronRight className="transition-transform" />
            <Folder />
            {label}
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {node.children.map((child) => (
              <NamespaceTreeItem
                key={child.path}
                node={child}
                activeNamespace={activeNamespace}
                namespaceRoot={namespaceRoot}
                entriesByPath={entriesByPath}
                onSelect={onSelect}
              />
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}

/** Hierarchical namespace tree; reads {@link useMemoriesGraphChrome} — must be under {@link GraphProjectionProvider}. */
export function GraphNamespaceTree({
  className,
  label = "Namespaces",
}: GraphNamespaceTreeProps = {}) {
  const {
    namespace,
    setNamespace,
    setScope,
    namespaceRoot,
    knownNamespaces,
    knownNamespaceEntries,
    namespacesLoading,
    namespacesError,
  } = useMemoriesGraphChrome();

  const tree = useMemo(() => buildNamespaceTree(knownNamespaces), [knownNamespaces]);
  const entriesByPath = useMemo(() => {
    const map = new Map<string, MemoriesGraphNamespaceEntry>();
    for (const entry of knownNamespaceEntries) map.set(entry.namespace, entry);
    return map;
  }, [knownNamespaceEntries]);

  const onSelect = (path: string, scope: GraphScope) => {
    setScope(scope);
    setNamespace(path);
  };

  let body: ReactNode;
  if (namespacesLoading && tree.length === 0) {
    body = <p className="px-2 text-xs text-muted-foreground">Loading namespaces…</p>;
  } else if (namespacesError && tree.length === 0) {
    body = <p className="px-2 text-xs text-muted-foreground">Could not load: {namespacesError}</p>;
  } else if (tree.length === 0) {
    body = <p className="px-2 text-xs text-muted-foreground">No namespaces yet.</p>;
  } else {
    body = (
      <SidebarMenu>
        {tree.map((node) => (
          <NamespaceTreeItem
            key={node.path}
            node={node}
            activeNamespace={namespace}
            namespaceRoot={namespaceRoot}
            entriesByPath={entriesByPath}
            onSelect={onSelect}
          />
        ))}
      </SidebarMenu>
    );
  }

  return (
    <SidebarGroup className={cn(className)}>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>{body}</SidebarGroupContent>
    </SidebarGroup>
  );
}
