import { useMemo, type ReactNode } from "react";
import { groupOptions, guideline, type Guideline } from "../../../core/benchmarks";
import { healthMetrics } from "../../../core/health";
import { fullMonths } from "../../../core/range";
import { useApp } from "../../../state";
import { fmtDate, money0, pct } from "../../format";
import { href } from "../../router";
import { ProfileForm } from "./ProfileForm";

type Verdict = "meets" | "close" | "misses" | "unknown" | "manual";
const VERDICT: Record<Verdict, [string, string]> = {
  meets: ["✓", "Within the guideline"],
  close: ["~", "Near the line"],
  misses: ["!", "Outside the guideline"],
  unknown: ["?", "Needs a number from you"],
  manual: ["→", "Check this one yourself"],
};

/** Bar for a share with a tick at the guideline; the numbers are always in the text beside it. */
function Meter({ value, mark, max }: { value: number; mark: number; max: number }) {
  return (
    <div className="meter" aria-hidden="true">
      <span style={{ width: `${Math.min(100, (Math.max(0, value) / max) * 100)}%` }} />
      <i style={{ left: `${Math.min(100, (mark / max) * 100)}%` }} />
    </div>
  );
}

function Check({ g, title, verdict, children, meter }: { g: Guideline; title?: string; verdict: Verdict; children: ReactNode; meter?: ReactNode }) {
  const [icon, text] = VERDICT[verdict];
  return (
    <div className="check">
      <h3>{title ?? g.label}</h3>
      <div className="verdict">
        <span aria-hidden="true">{icon}</span> {text}
      </div>
      {meter}
      <div>{children}</div>
      <p className="note" title={g.quote}>
        {g.rule}
      </p>
      <div className="src">
        Source:{" "}
        <a href={g.url} target="_blank" rel="noreferrer noopener">
          {g.source}
        </a>
      </div>
    </div>
  );
}

/** Within 10% under the floor counts as "near the line". */
const atLeast = (x: number, line: number): Verdict => (x >= line ? "meets" : x >= line * 0.9 ? "close" : "misses");

export function HealthCheck() {
  const { enriched, snapshot, earliest, latest } = useApp();
  const rules = snapshot.rules;
  // The last 12 complete months, so a half-imported current month isn't averaged as a whole one.
  const win = fullMonths(latest, earliest, 12);
  const m = useMemo(() => healthMetrics(enriched, rules, win), [enriched, rules, win.from, win.to]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!enriched.length) return null;

  const hud = guideline("hud-cost-burden");
  const severe = guideline("hud-severe-cost-burden");
  const needs = guideline("503020-needs");
  const wants = guideline("503020-wants");
  const save = guideline("503020-savings");
  const emergency = guideline("emergency-fund");
  const retire = guideline("retirement-15");
  const card = guideline("cc-pay-in-full");
  const inc = m.income.monthly;
  const gross = rules.profile.grossAnnual;
  const s = m.shares;

  const incText =
    m.income.source === "typed"
      ? `${money0(inc!)}/mo (typed)`
      : m.income.source === "detected"
        ? `${money0(inc!)}/mo (${money0(m.income.detected)} in paychecks over ${m.income.months} months${m.income.partial ? ` — Schwab is only imported for ${m.income.months} of these ${m.months} months` : ""})`
        : "unknown: no paychecks matched. Type it above, or adjust Paychecks on the Rules page.";

  // HUD counts utilities in housing cost; our Utilities & Bills also holds phone/internet, so the pair brackets the truth.
  const hudVerdict: Verdict =
    s.housingOfGross == null || !hud ? "unknown" : s.housingOfGross > hud.hi ? "misses" : (s.housingUtilOfGross ?? 0) <= hud.hi * 0.9 ? "meets" : "close";

  return (
    <section className="card">
      <div className="card-head">
        <h2>Health check</h2>
        <span className="muted">
          Monthly averages, {fmtDate(win.from)} – {fmtDate(win.to)}
        </span>
      </div>
      <ProfileForm groups={groupOptions()} />
      <p className="note">
        Spending {money0(m.spendMonthly)}/mo · take-home {incText}
        {m.housingMonthly === 0 && (
          <>
            {" "}
            · <strong>No Housing spending found.</strong> Find your rent on the <a href={href("/transactions")}>Transactions</a> page and set its category to Housing.
          </>
        )}
      </p>

      <div className="checks">
        {hud && (
          <Check
            g={hud}
            title="Housing cost"
            verdict={hudVerdict}
            meter={s.housingUtilOfGross != null ? <Meter value={s.housingUtilOfGross} mark={hud.hi} max={Math.max(0.6, s.housingUtilOfGross * 1.1)} /> : undefined}
          >
            {s.housingOfGross != null ? (
              <>
                Housing is <strong>{pct(s.housingOfGross)}</strong> of before-tax income, <strong>{pct(s.housingUtilOfGross!)}</strong> counting Utilities &amp; Bills (which also holds phone and internet, so the true figure is in between).
                {severe && s.housingOfGross > severe.hi && <> That's past HUD's {pct(severe.hi)} “severe” line.</>}
              </>
            ) : s.housingOfTakeHome != null ? (
              <>Housing is {pct(s.housingOfTakeHome)} of take-home. HUD measures against before-tax income; enter it above.</>
            ) : (
              <>Enter before-tax income above.</>
            )}
          </Check>
        )}

        {needs && wants && save && (
          <Check
            g={needs}
            title="50/30/20 budget"
            verdict={
              s.needs == null
                ? "unknown"
                : s.savings! >= save.lo && s.needs <= needs.hi && s.wants! <= wants.hi
                  ? "meets"
                  : s.savings! >= save.lo * 0.9 && s.needs <= needs.hi * 1.1 && s.wants! <= wants.hi * 1.1
                    ? "close"
                    : "misses"
            }
            meter={s.needs != null ? <Meter value={s.needs} mark={needs.hi} max={Math.max(1, s.needs + s.wants!)} /> : undefined}
          >
            {s.needs == null ? (
              <>Needs take-home pay to split.</>
            ) : (
              <>
                Needs <strong>{pct(s.needs)}</strong> (≤{pct(needs.hi)}) · wants <strong>{pct(s.wants!)}</strong> (≤{pct(wants.hi)}) · savings &amp; debt paydown <strong>{pct(s.savings!)}</strong> (≥{pct(save.lo)})
                {m.savingsMonthly! < 0 && <>. You spent {money0(-m.savingsMonthly!)}/mo more than you took home.</>}
                <br />
                <span className="muted">
                  Needs = {rules.needsCategories.join(", ")}. Savings &amp; debt paydown = take-home minus spending, plus loan payments. It's only right if every account you spend from is imported.
                </span>
              </>
            )}
          </Check>
        )}

        {emergency && (
          <Check
            g={emergency}
            verdict={m.emergencyMonths == null ? "unknown" : atLeast(m.emergencyMonths, emergency.lo)}
            meter={m.emergencyMonths != null ? <Meter value={m.emergencyMonths} mark={emergency.lo} max={Math.max(emergency.hi, m.emergencyMonths) * 1.1} /> : undefined}
          >
            {emergency.lo}–{emergency.hi} months of your expenses is{" "}
            <strong>
              {money0(m.spendMonthly * emergency.lo)} – {money0(m.spendMonthly * emergency.hi)}
            </strong>
            {m.emergencyMonths != null ? (
              <>
                . Yours covers <strong>{m.emergencyMonths} months</strong>.
              </>
            ) : (
              <>. Enter your emergency savings above to see how many months it covers.</>
            )}
          </Check>
        )}

        {retire && (
          <Check g={retire} verdict={gross ? "manual" : "unknown"}>
            {gross ? (
              <>
                {pct(retire.lo)} of {money0(gross)} is <strong>{money0((gross * retire.lo) / 12)}/mo</strong>, employer match included. Payroll 401(k) contributions don't pass through checking or cards, so compare it with your pay stub (plus any IRA deposits).
              </>
            ) : (
              <>Enter before-tax income to see the monthly amount. Payroll contributions don't appear in bank exports, so this can't be checked automatically.</>
            )}
          </Check>
        )}

        {card && (
          <Check g={card} title="Card interest" verdict={m.cardInterest > 0 ? "misses" : "meets"}>
            {m.cardInterest > 0 ? (
              <>
                You paid <strong>{money0(m.cardInterest)}</strong> in card interest over these {m.months} months, so a balance was carried.
              </>
            ) : (
              <>No card interest in this window.</>
            )}
            {m.fees > 0 && (
              <>
                {" "}
                Separately, {money0(m.fees)} in fees (annual, ATM and the like).
              </>
            )}{" "}
            <a href={href(`/category/${encodeURIComponent("Fees & Interest")}`)}>See Fees &amp; Interest</a>
          </Check>
        )}
      </div>
      <p className="note">General rules of thumb from the linked sources (hover a rule for the exact quote), not personal financial advice.</p>
    </section>
  );
}
