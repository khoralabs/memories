import type { MemoriesDatabaseAccessStrategy } from "./types";

export function createNoneAuthStrategy(): MemoriesDatabaseAccessStrategy {
  return {
    async authenticate() {
      return { scheme: "none", subject: "local" };
    },
    async authorize() {
      return;
    },
  };
}
