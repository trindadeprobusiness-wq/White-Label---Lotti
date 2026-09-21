export function updateDraft(drafts: Record<string, string>, id: string, value: string) {
  return { ...drafts, [id]: value };
}
