export function resolveMemoryPathIdentity(
  namespace: string,
  key: string,
): { namespace: string; key: string } {
  const sep = "::";
  const idx = key.indexOf(sep);
  if (idx === -1) return { namespace, key };
  const qualifiedNs = key.slice(0, idx).trim();
  const memoryKey = key.slice(idx + sep.length).trim();
  if (qualifiedNs.length === 0 || memoryKey.length === 0) {
    return { namespace, key };
  }
  return { namespace: qualifiedNs, key: memoryKey };
}
