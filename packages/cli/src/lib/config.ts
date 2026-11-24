import { type Flags, strFlag } from "./argv.ts";

export const DB_ENV = "MEMORIES_DB";
export const NAMESPACE_ENV = "MEMORIES_NAMESPACE";
export const DB_KEY_ENV = "MEMORIES_DB_KEY";

function required(flags: Flags, flag: string, envName: string, env: NodeJS.ProcessEnv): string {
  const v = strFlag(flags, flag) ?? env[envName]?.trim();
  if (v === undefined || v.length === 0) throw new Error(`--${flag} (or ${envName}) is required`);
  return v;
}

export const resolveDb = (flags: Flags, env = process.env) => required(flags, "db", DB_ENV, env);
export const resolveNamespace = (flags: Flags, env = process.env) =>
  required(flags, "namespace", NAMESPACE_ENV, env);

export function requireFlag(flags: Flags, name: string): string {
  const v = strFlag(flags, name);
  if (v === undefined) throw new Error(`--${name} is required`);
  return v;
}
