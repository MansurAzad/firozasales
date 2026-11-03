export type ShareResult = "shared" | "cancelled" | "unavailable";

export function canShareFile(file: File): boolean {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function")
    return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

// Call directly from a click after file preparation to preserve user activation.
export async function shareFile(file: File, title: string): Promise<ShareResult> {
  if (!canShareFile(file)) return "unavailable";
  try {
    await navigator.share({ files: [file], title });
    return "shared";
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError"
    )
      return "cancelled";
    return "unavailable";
  }
}
