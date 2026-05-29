import { SECTION_ORDER, SECTION_TITLES, type SectionKey } from "./master-template-defaults";
import { substituteSection, type SubstitutionVars } from "./template";

type Props = {
  sections: Record<SectionKey, string>;
  vars: SubstitutionVars;
};

export function ContractHtml({ sections, vars }: Props) {
  return (
    <article className="sign-contract">
      <header className="sign-title">
        <h1>GB2GLLC Services Agreement</h1>
        <p className="sign-effective">Effective: upon signing by Client</p>
      </header>

      <p className="sign-para">{substituteSection(sections.preamble, vars)}</p>

      {SECTION_ORDER.filter((k) => k !== "preamble").map((key) => (
        <section key={key} className="sign-section">
          <h2>{SECTION_TITLES[key]}</h2>
          <p>{substituteSection(sections[key], vars)}</p>
        </section>
      ))}

      <section className="sign-block">
        <h3>On behalf of GB2GLLC</h3>
        <p>John McCully · Founder</p>
        <p>Oberon Analytics LLC d/b/a GB2GLLC</p>
        <p>Date: {vars.generated_date}</p>
      </section>
    </article>
  );
}
