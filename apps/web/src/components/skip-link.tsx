import { getTranslations } from "next-intl/server";

export const CONTENT_ID = "content";

export async function SkipLink() {
  const t = await getTranslations("chrome");
  return (
    <a className="pr-skip-link" href={`#${CONTENT_ID}`}>
      {t("skipToContent")}
    </a>
  );
}
