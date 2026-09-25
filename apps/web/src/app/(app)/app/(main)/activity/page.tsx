import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ActivityView } from "@/components/app/activity-view.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app.activity");
  return { title: t("title") };
}

export default function ActivityPage() {
  return <ActivityView />;
}
