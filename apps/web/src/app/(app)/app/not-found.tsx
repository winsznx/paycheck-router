import { buttonClassName } from "@paycheck-router/ui/components";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CONTENT_ID } from "@/components/skip-link.tsx";

/** Unknown `/app/*` paths keep the app shell, and with it the fork banner. */
export default async function AppNotFound() {
  const t = await getTranslations("notFound");
  return (
    <main id={CONTENT_ID} className="page stack" style={{ paddingBlock: 64 }}>
      <h1 className="pr-h1">{t("title")}</h1>
      <p className="pr-body pr-muted">{t("body")}</p>
      <p>
        <Link href="/app" className={buttonClassName({ variant: "secondary" })}>
          {t("action")}
        </Link>
      </p>
    </main>
  );
}
