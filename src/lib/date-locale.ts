import type { Locale } from "date-fns";
import { enUS, es, ko, ptBR } from "date-fns/locale";

/** date-fns locale matching the app language (next-intl locale code). */
export function dateLocaleFor(locale: string): Locale {
  switch (locale) {
    case "pt":
      return ptBR;
    case "es":
      return es;
    case "ko":
      return ko;
    default:
      return enUS;
  }
}
