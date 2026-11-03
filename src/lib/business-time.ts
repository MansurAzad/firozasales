const businessTimeZone = "Asia/Dhaka";

export function businessDateKey(value: string | Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: businessTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function businessToday(): string {
  return businessDateKey(new Date());
}

export function displayBusinessDate(value: string, locale = "en-GB"): string {
  return value
    ? new Intl.DateTimeFormat(locale, {
        timeZone: businessTimeZone,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
}
