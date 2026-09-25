import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow.tsx";
import { CONTENT_ID } from "@/components/skip-link.tsx";
import { isStep, STEPS } from "@/lib/onboarding-steps.ts";

export function generateStaticParams() {
  return STEPS.map((step) => ({ step }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onboarding");
  return { title: t("metaTitle") };
}

export default async function OnboardingPage({ params }: PageProps<"/app/onboarding/[step]">) {
  const { step } = await params;
  if (!isStep(step)) notFound();
  return (
    <main id={CONTENT_ID} className="onboarding">
      <OnboardingFlow step={step} />
    </main>
  );
}
