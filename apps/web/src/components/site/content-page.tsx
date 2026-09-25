import type { ReactNode } from "react";
import { CONTENT_ID } from "@/components/skip-link.tsx";

export type ContentSection = { key: string; title: string; body: string; extra?: ReactNode };

/** A reading-width page of titled sections; paragraphs are separated by blank lines. */
export function ContentPage({
  title,
  lead,
  notice,
  sections,
  children,
}: {
  title: string;
  lead?: string | undefined;
  notice?: ReactNode;
  sections: readonly ContentSection[];
  children?: ReactNode;
}) {
  return (
    <main id={CONTENT_ID} className="page site-page stack-lg">
      <header className="stack reading">
        <h1 className="pr-h1">{title}</h1>
        {lead ? <p className="pr-body-l pr-muted">{lead}</p> : null}
      </header>
      {notice}
      {sections.map((section) => (
        <section
          key={section.key}
          className="stack reading"
          aria-labelledby={`section-${section.key}`}
        >
          <h2 id={`section-${section.key}`} className="pr-h2">
            {section.title}
          </h2>
          {section.body.split("\n\n").map((paragraph) => (
            <p key={paragraph.slice(0, 32)} className="pr-body">
              {paragraph}
            </p>
          ))}
          {section.extra}
        </section>
      ))}
      {children}
    </main>
  );
}
