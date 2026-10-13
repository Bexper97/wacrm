"use client";

import { usePathname, useSearchParams } from "next/navigation";

/**
 * True while a single conversation is open in the inbox (`/inbox?c=<id>`).
 * On phones the thread then takes the whole screen, so the app header and the
 * bottom tab bar step aside — same as WhatsApp. Needs a Suspense boundary
 * above it (useSearchParams).
 */
export function useChatOpen(): boolean {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return pathname.startsWith("/inbox") && !!searchParams.get("c");
}
