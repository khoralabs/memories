import { ChevronRight, Folder } from "lucide-react";
import {
  Children,
  createContext,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
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
import { AddNamespaceButton } from "./add-namespace-button.js";
import { GraphRefreshButton, RefreshGraphButton } from "./graph-refresh-button.js";
import { type MemoriesGraphNamespaceEntry, namespaceEntryLabel } from "./lib/namespace-entries.js";
import { isNamespaceUnderPath, type NamespaceTreeNode } from "./lib/namespace-tree.js";
import { type GraphScope, useMemoriesNamespaces } from "./memories-namespaces-provider.js";

export type GraphNamespaceTreeProps = {
  className?: string;
  children?: ReactNode;
};

type NamespaceTreeItemProps = {
  node: NamespaceTreeNode;
  activeNamespace: string;
  namespaceRoot: string;
  entriesByPath: Map<string, MemoriesGraphNamespaceEntry>;
  onSelect: (path: string, scope: GraphScope) => void;
};

const GraphNamespaceTreeContext = createContext<true | null>(null);

function useGraphNamespaceTree() {
  const ctx = useContext(GraphNamespaceTreeContext);
  if (ctx == null) {
    throw new Error("GraphNamespaceTree parts must be used within GraphNamespaceTree");
  }
}

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

function isLabelAction(child: ReactElement): boolean {
  return (
    child.type === AddNamespaceButton ||
    child.type === RefreshGraphButton ||
    child.type === GraphRefreshButton
  );
}

function GraphNamespaceTreeLabel({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SidebarGroupLabel>) {
  useGraphNamespaceTree();
  const text: ReactNode[] = [];
  const actions: ReactNode[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement(child) && isLabelAction(child)) {
      actions.push(child);
      return;
    }
    text.push(child);
  });

  return (
    <SidebarGroupLabel className={cn("gap-1 pr-1", className)} {...props}>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {actions.length > 0 ? (
        <span className="ml-auto flex shrink-0 items-center gap-0.5">{actions}</span>
      ) : null}
    </SidebarGroupLabel>
  );
}
GraphNamespaceTreeLabel.displayName = "GraphNamespaceTree.Label";

function GraphNamespaceTreeHierarchy({ className }: { className?: string } = {}) {
  useGraphNamespaceTree();
  const { namespace, focus, namespaceRoot, tree, entries, loading, error } =
    useMemoriesNamespaces();

  const entriesByPath = useMemo(() => {
    const map = new Map<string, MemoriesGraphNamespaceEntry>();
    for (const entry of entries) map.set(entry.namespace, entry);
    return map;
  }, [entries]);

  const onSelect = (path: string, scope: GraphScope) => {
    focus(path, scope);
  };

  let body: ReactNode;
  if (loading && tree.length === 0) {
    body = <p className="px-2 text-xs text-muted-foreground">Loading namespaces…</p>;
  } else if (error && tree.length === 0) {
    body = <p className="px-2 text-xs text-muted-foreground">Could not load: {error}</p>;
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

  return <SidebarGroupContent className={className}>{body}</SidebarGroupContent>;
}
GraphNamespaceTreeHierarchy.displayName = "GraphNamespaceTree.Hierarchy";

/** Hierarchical namespace tree; reads {@link useMemoriesNamespaces}. */
function GraphNamespaceTreeRoot({ className, children }: GraphNamespaceTreeProps = {}) {
  return (
    <GraphNamespaceTreeContext.Provider value={true}>
      <SidebarGroup className={cn(className)}>{children}</SidebarGroup>
    </GraphNamespaceTreeContext.Provider>
  );
}

export const GraphNamespaceTree = Object.assign(GraphNamespaceTreeRoot, {
  Label: GraphNamespaceTreeLabel,
  Hierarchy: GraphNamespaceTreeHierarchy,
});
