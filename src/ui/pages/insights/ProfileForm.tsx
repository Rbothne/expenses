import { useEffect, useRef, useState } from "react";
import type { Profile } from "../../../core/types";
import { useApp } from "../../../state";

type NumKey = "householdSize" | "grossAnnual" | "takeHomeMonthly" | "emergencySavings";

const FIELDS: { key: NumKey; label: string; help: string; step: number }[] = [
  { key: "householdSize", label: "People this spending covers", help: "Picks the matching household size for comparisons.", step: 1 },
  { key: "grossAnnual", label: "Yearly income before tax", help: "For the housing and retirement checks. Optional.", step: 1000 },
  { key: "takeHomeMonthly", label: "Take-home per month", help: "Leave blank to use paychecks found in Schwab.", step: 100 },
  { key: "emergencySavings", label: "Emergency savings", help: "Cash you could reach in a week. Optional.", step: 500 },
];

/** Numbers the CSVs can't tell us. Saved on blur, kept in rules.json with everything else (never uploaded). */
export function ProfileForm({ groups }: { groups: { id: string; label: string }[] }) {
  const { snapshot, updateRules } = useApp();
  const p = snapshot.rules.profile;
  const [draft, setDraft] = useState<Record<NumKey, string>>(() => toDraft(p));
  // Open on first visit only; saving a field must not snap it shut mid-entry.
  const [open] = useState(() => !p.grossAnnual && !p.householdSize);
  // When the saved profile changes (this form, a restore, another PC), refresh only the fields whose saved value
  // changed, so a save of one field never wipes what's being typed in another.
  const prev = useRef(p);
  useEffect(() => {
    const was = toDraft(prev.current),
      now = toDraft(p);
    prev.current = p;
    setDraft((d) => {
      const next = { ...d };
      for (const k of Object.keys(now) as NumKey[]) if (was[k] !== now[k]) next[k] = now[k];
      return next;
    });
  }, [p]);

  const save = (patch: Partial<Profile>) => updateRules((r) => ({ ...r, profile: { ...r.profile, ...patch } }));
  const commit = (k: NumKey) => {
    const raw = draft[k].replace(/[$,\s]/g, "");
    const v = raw === "" ? undefined : Number(raw);
    if (v !== undefined && (!Number.isFinite(v) || v < 0)) return setDraft({ ...draft, [k]: toDraft(p)[k] });
    if (v !== p[k]) void save({ [k]: v });
  };

  return (
    <details className="profile" open={open}>
      <summary>
        <strong>About you</strong> <span className="muted">— makes the checks below accurate</span>
      </summary>
      <div className="filters">
        {FIELDS.map((f) => (
          <label key={f.key} className="field" title={f.help}>
            <span>{f.label}</span>
            <input
              inputMode="decimal"
              value={draft[f.key]}
              placeholder={f.key === "takeHomeMonthly" ? "auto" : "—"}
              step={f.step}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              onBlur={() => commit(f.key)}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </label>
        ))}
        <label className="field">
          <span>Housing</span>
          <select value={p.tenure ?? "rent"} onChange={(e) => void save({ tenure: e.target.value as Profile["tenure"] })}>
            <option value="rent">Rent</option>
            <option value="own-mortgage">Own, with mortgage</option>
            <option value="own-outright">Own outright</option>
          </select>
        </label>
        {groups.length > 0 && (
          <label className="field">
            <span>Compare with</span>
            <select value={p.benchmarkGroup ?? ""} onChange={(e) => void save({ benchmarkGroup: e.target.value || undefined })}>
              <option value="">Automatic (household size)</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </details>
  );
}

const toDraft = (p: Profile): Record<NumKey, string> => ({
  householdSize: p.householdSize?.toString() ?? "",
  grossAnnual: p.grossAnnual?.toString() ?? "",
  takeHomeMonthly: p.takeHomeMonthly?.toString() ?? "",
  emergencySavings: p.emergencySavings?.toString() ?? "",
});
