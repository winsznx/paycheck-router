import { getLocale } from "next-intl/server";
import { countryOptions } from "@/lib/countries.ts";
import { WaitlistForm } from "./waitlist-form.tsx";

/** The waitlist form with its country names rendered once, on the server. */
export async function Waitlist({ source }: { source: string }) {
  const locale = await getLocale();
  return <WaitlistForm source={source} countries={countryOptions(locale)} />;
}
