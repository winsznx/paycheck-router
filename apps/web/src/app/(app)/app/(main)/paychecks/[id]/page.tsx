import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PaycheckDetailView } from "@/components/app/paycheck/paycheck-detail.tsx";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app.paycheck");
  return { title: t("metaTitle") };
}

export default async function PaycheckPage({ params }: PageProps<"/app/paychecks/[id]">) {
  const { id } = await params;
  return <PaycheckDetailView id={id} />;
}
