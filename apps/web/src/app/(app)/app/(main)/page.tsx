import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { HomeView } from "@/components/app/home/home-view.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app.home");
  return { title: t("metaTitle") };
}

export default function HomePage() {
  return <HomeView />;
}
