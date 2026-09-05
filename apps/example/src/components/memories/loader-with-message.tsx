import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function LoaderWithMessage({
  children,
  className,
  ...props
}: React.ComponentProps<typeof Skeleton> & { children: React.ReactNode }) {
  return (
    <Skeleton
      className={cn(
        "flex items-center gap-2 text-sm text-muted-foreground p-3 rounded-md",
        className,
      )}
      {...props}
    >
      <Spinner aria-label="Loading" />
      <span>{children}</span>
    </Skeleton>
  );
}
