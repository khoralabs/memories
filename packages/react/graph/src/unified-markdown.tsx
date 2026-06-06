import type { ComponentPropsWithoutRef } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import rehypeReact from "rehype-react";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

export const unifiedMarkdown = unified()
  .use(remarkParse)
  .use(remarkRehype)
  .use(rehypeReact, {
    Fragment,
    jsx,
    jsxs,
    development: false,
    elementAttributeNameCase: "react",
    components: {
      a: (props: ComponentPropsWithoutRef<"a">) => (
        <a
          className="text-primary font-medium underline underline-offset-2"
          rel="noopener noreferrer"
          target="_blank"
          {...props}
        />
      ),
      blockquote: (props: ComponentPropsWithoutRef<"blockquote">) => (
        <blockquote
          className="border-muted-foreground/40 text-muted-foreground mb-2 border-l-2 pl-3 italic last:mb-0"
          {...props}
        />
      ),
      code: ({ className, ...props }: ComponentPropsWithoutRef<"code">) => {
        const block = typeof className === "string" && className.includes("language-");
        return (
          <code
            className={
              block
                ? `block font-mono text-xs ${className ?? ""}`
                : "rounded bg-muted/50 px-1 py-0.5 font-mono text-[0.9em]"
            }
            {...props}
          />
        );
      },
      h1: (props: ComponentPropsWithoutRef<"h1">) => (
        <h1 className="mb-2 text-lg font-semibold last:mb-0" {...props} />
      ),
      h2: (props: ComponentPropsWithoutRef<"h2">) => (
        <h2 className="mb-2 text-base font-semibold last:mb-0" {...props} />
      ),
      h3: (props: ComponentPropsWithoutRef<"h3">) => (
        <h3 className="mb-1.5 text-sm font-semibold last:mb-0" {...props} />
      ),
      hr: (props: ComponentPropsWithoutRef<"hr">) => (
        <hr className="border-border my-3" {...props} />
      ),
      li: (props: ComponentPropsWithoutRef<"li">) => <li className="leading-relaxed" {...props} />,
      ol: (props: ComponentPropsWithoutRef<"ol">) => (
        <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0" {...props} />
      ),
      p: (props: ComponentPropsWithoutRef<"p">) => (
        <p className="mb-2 text-sm leading-relaxed last:mb-0" {...props} />
      ),
      pre: (props: ComponentPropsWithoutRef<"pre">) => (
        <pre
          className="bg-muted mb-2 overflow-x-auto rounded-md p-3 text-sm last:mb-0"
          {...props}
        />
      ),
      strong: (props: ComponentPropsWithoutRef<"strong">) => (
        <strong className="font-semibold" {...props} />
      ),
      ul: (props: ComponentPropsWithoutRef<"ul">) => (
        <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0" {...props} />
      ),
    },
  });
