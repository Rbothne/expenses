import { useApp } from "../state";

export function CategorySelect({ value, onChange, label, includeAuto }: { value: string; onChange: (c: string) => void; label: string; includeAuto?: string }) {
  const { snapshot } = useApp();
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {includeAuto !== undefined && <option value="">{includeAuto}</option>}
      {snapshot.rules.categories.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
      {value && !snapshot.rules.categories.includes(value) && <option value={value}>{value}</option>}
    </select>
  );
}
