/** Compact dictionary key, not a security hash. Generation rejects collisions. */
export function adminMessageKey(source: string): string {
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}
