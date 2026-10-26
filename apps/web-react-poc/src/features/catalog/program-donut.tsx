import type { CategoryWorkload } from "@/features/comparison/model";
import styles from "./program-detail.module.css";

function point(radius: number, turn: number): string {
  const angle = turn * 2 * Math.PI - Math.PI / 2;
  return `${(120 + radius * Math.cos(angle)).toFixed(3)},${(120 + radius * Math.sin(angle)).toFixed(3)}`;
}

/** Real annular paths keep the hit area inside each sector, including tiny ones. */
function sectorPath(start: number, fraction: number, selected: boolean): string {
  const outer = selected ? 110 : 107;
  const inner = selected ? 78 : 81;
  const middle = start + fraction / 2;
  const end = start + fraction;
  return `M${point(outer, start)} A${outer},${outer} 0 0 1 ${point(outer, middle)} A${outer},${outer} 0 0 1 ${point(outer, end)} L${point(inner, end)} A${inner},${inner} 0 0 0 ${point(inner, middle)} A${inner},${inner} 0 0 0 ${point(inner, start)} Z`;
}

export function ProgramDonut({ categories, total, activeKey, onSelect }: {
  categories: readonly (CategoryWorkload & { color: string })[];
  total: number;
  activeKey: string | null;
  onSelect: (key: string) => void;
}) {
  return <svg viewBox="0 0 240 240" role="group" aria-label="Распределение опубликованных часов по категориям">
    <circle cx="120" cy="120" r="94" fill="none" stroke="var(--line)" strokeWidth="26" pointerEvents="none" />
    {categories.map((category, index) => {
      if (total <= 0 || category.hours.value <= 0) return null;
      const fraction = category.hours.value / total;
      const offset = categories.slice(0, index).reduce((sum, entry) => sum + entry.hours.value, 0) / total;
      const selected = activeKey === category.key;
      return <path key={category.key} className={styles.donutSector} d={sectorPath(offset, fraction, selected)} fill={category.color} opacity={activeKey && !selected ? .3 : 1}
        role="button" tabIndex={0} aria-pressed={selected} aria-label={`${category.name} · ${new Intl.NumberFormat("ru-RU").format(category.hours.value)} ч.`}
        onClick={() => onSelect(category.key)} onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(category.key); }
        }}><title>{`${category.name} · ${Math.round(fraction * 1000) / 10}%`}</title></path>;
    })}
  </svg>;
}
