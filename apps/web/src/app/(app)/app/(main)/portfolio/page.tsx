import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PortfolioView } from "@/components/app/portfolio-view.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app.portfolio");
  return { title: t("title") };
}

export default function PortfolioPage() {
  return <PortfolioView />;
}
