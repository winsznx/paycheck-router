import { buttonClassName } from "@paycheck-router/ui/components";
import { getTranslations } from "next-intl/server";
import { CONTENT_ID } from "@/components/skip-link.tsx";
import { Link } from "@/i18n/navigation.ts";

export default async function NotFound() {
  const t = await getTranslations("notFound");
  return (
    <main id={CONTENT_ID} className="page stack" style={{ paddingBlock: 64 }}>
      <h1 className="pr-h1">{t("title")}</h1>
      <p className="pr-body pr-muted">{t("body")}</p>
      <p>
        <Link href="/" className={buttonClassName({ variant: "secondary" })}>
          {t("action")}
        </Link>
      </p>
    </main>
  );
}
