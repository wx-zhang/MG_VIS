export function formatMessageTimestamp(date: string | number | Date, now: Date = new Date()): string {
  const messageDate = date instanceof Date ? date : new Date(date);
  // Chat keeps current-year messages compact while making older history unambiguous.
  const shouldShowYear = messageDate.getFullYear() !== now.getFullYear();
  const dateText = messageDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(shouldShowYear ? { year: "numeric" as const } : {})
  });
  const timeText = messageDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });

  return `${dateText}, ${timeText}`;
}
