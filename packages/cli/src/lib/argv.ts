export type Flags = Record<string, string | boolean>;

const BOOLEAN = new Set([
  "y",
  "yes",
  "g",
  "global",
  "f",
  "force",
  "json",
  "h",
  "help",
  "V",
  "version",
]);

/** Minimal argv parser: `--k v`, `--k=v`, `-y`; known boolean flags never consume a value. */
export function parseArgv(argv: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (!arg.startsWith("-") || arg === "-") {
      positional.push(arg);
      continue;
    }
    const [name = "", inline] = arg.replace(/^--?/, "").split(/=(.*)/s, 2);
    const next = argv[i + 1];
    if (inline !== undefined) flags[name] = inline;
    else if (BOOLEAN.has(name) || next === undefined || next.startsWith("-")) flags[name] = true;
    else flags[name] = argv[++i] as string;
  }
  return { positional, flags };
}

export function boolFlag(flags: Flags, ...names: string[]): boolean {
  return names.some((n) => flags[n] === true || flags[n] === "true");
}

export function strFlag(flags: Flags, name: string): string | undefined {
  const v = flags[name];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}
