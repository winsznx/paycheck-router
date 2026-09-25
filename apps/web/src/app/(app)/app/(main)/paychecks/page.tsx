import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PaycheckList } from "@/components/app/paycheck/paycheck-list.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app.paychecks");
  return { title: t("title") };
}

export default async function PaychecksPage() {
  const t = await getTranslations("app.paychecks");
  return (
    <div className="stack-lg">
      <h1 className="pr-h1">{t("title")}</h1>
      <PaycheckList />
    </div>
  );
}
