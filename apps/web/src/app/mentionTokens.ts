export function activeMentionToken(text: string, caretIndex: number): { start: number; end: number; query: string } | null {
  const beforeCaret = text.slice(0, caretIndex);
  const match = beforeCaret.match(/(?:^|\s)@([^\s@]*)$/u);
  if (!match) return null;
  const atIndex = beforeCaret.lastIndexOf("@");
  return { start: atIndex, end: caretIndex, query: match[1] ?? "" };
}
