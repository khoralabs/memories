export const HELP = `memories — agent CLI for local memories stores (SQLite)

Usage:
  memories help
  memories search --db <path> --namespace <ns> --query "..." [--top-k N] [--json]
  memories get --db <path> --namespace <ns> --key <key> [--json]
  memories namespaces --db <path> [--json]
  memories provenance --db <path> [--limit N] [--json]
  memories write --db <path> --namespace <ns> --key <key> --text "..." [--json]
  memories integrate-plan --db <path> --namespace <ns> --key <key> --plan <file.json> [--text "..."] [--json]
  memories skills install -y [-g] [--force] [--json]
  memories --version

Env: MEMORIES_DB, MEMORIES_NAMESPACE, MEMORIES_DB_KEY (SQLCipher), MEMORIES_CLI_ASSETS_DIR
Search is lexical-only (no embedding model).
`;

export function handleHelp(): void {
  console.log(HELP);
}
