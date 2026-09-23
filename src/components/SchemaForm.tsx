"use client";

import { TriangleAlert, X } from "lucide-react";
import { useState } from "react";

import { Select, Slider, inputClass } from "@/components/kit";
import { Switch } from "@/components/ui/switch";

import type { JsonSchemaProp, MissionActionContribution } from "@/proto/types";

/**
 * §11 schema-driven form for plugin `mission_action` params.
 *
 * Supported subset: string (+enum, +format: time), number / integer
 * (min+max → slider, otherwise a stepper), boolean, a single-level object,
 * and array of string. Anything else renders "needs a newer App" instead of
 * crashing. Titles and descriptions are rendered as TEXT — never markdown or
 * HTML (§11 信任邊界); React's text escaping is what enforces that.
 */

export function isSupported(p: JsonSchemaProp, depth = 0): boolean {
  switch (p.type) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
      return true;
    case "array":
      return p.items?.type === "string";
    case "object":
      return depth === 0 && Object.values(p.properties ?? {}).every((c) => isSupported(c, depth + 1) && c.type !== "object");
    default:
      return false;
  }
}

export function defaultsFor(schema: MissionActionContribution["schema"]) {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(schema.properties)) if (p.default !== undefined) out[k] = p.default;
  return out;
}

export function SchemaForm({
  schema,
  value,
  onChange,
}: {
  schema: MissionActionContribution["schema"];
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      {Object.entries(schema.properties).map(([key, prop]) => (
        <PropField
          key={key}
          name={key}
          prop={prop}
          required={schema.required?.includes(key)}
          value={value[key]}
          onChange={(v) => onChange({ ...value, [key]: v })}
        />
      ))}
    </div>
  );
}

function PropField({
  name,
  prop,
  value,
  onChange,
  required,
  depth = 0,
}: {
  name: string;
  prop: JsonSchemaProp;
  value: unknown;
  onChange: (v: unknown) => void;
  required?: boolean;
  depth?: number;
}) {
  const title = prop.title ?? name;

  if (!isSupported(prop, depth))
    return (
      <div className="bg-surface-sunken text-muted-foreground flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs">
        <TriangleAlert className="size-3.5 shrink-0" />
        <span>
          <span className="text-foreground font-medium">{title}</span>：此 plugin 需要更新的 App
        </span>
      </div>
    );

  const label = (
    <span className="text-[13px] font-medium">
      {title}
      {required && <span className="text-destructive"> *</span>}
    </span>
  );
  const desc = prop.description && <span className="text-muted-foreground block text-xs">{prop.description}</span>;

  switch (prop.type) {
    case "boolean":
      return (
        <label className="flex min-h-11 items-center justify-between gap-3">
          <span>
            {label}
            {desc}
          </span>
          <Switch checked={!!value} onCheckedChange={onChange} />
        </label>
      );
    case "string":
      return (
        <label className="block space-y-1.5">
          {label}
          {prop.enum ? (
            <Select label={title} value={(value as string) ?? prop.enum[0]} options={prop.enum.map((e) => ({ value: e, label: e }))} onChange={onChange} />
          ) : (
            <input className={inputClass} type={prop.format === "time" ? "time" : "text"} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />
          )}
          {desc}
        </label>
      );
    case "number":
    case "integer": {
      const step = prop.type === "integer" ? 1 : 0.5;
      const v = typeof value === "number" ? value : (prop.minimum ?? 0);
      return (
        <label className="block space-y-1">
          <span className="flex items-center justify-between">
            {label}
            <span className="text-[13px] font-semibold tabular-nums">{v}</span>
          </span>
          {prop.minimum !== undefined && prop.maximum !== undefined ? (
            <Slider label={title} min={prop.minimum} max={prop.maximum} step={step} value={v} onChange={onChange} />
          ) : (
            <input className={inputClass} type="number" step={step} value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
          )}
          {desc}
        </label>
      );
    }
    case "array":
      return <TagField label={label} value={(value as string[]) ?? []} onChange={onChange} />;
    case "object":
      return (
        <fieldset className="space-y-2 rounded-lg border p-3">
          <legend className="px-1">{label}</legend>
          {Object.entries(prop.properties ?? {}).map(([k, p]) => (
            <PropField
              key={k}
              name={k}
              prop={p}
              depth={depth + 1}
              value={(value as Record<string, unknown> | undefined)?.[k]}
              onChange={(v) => onChange({ ...((value as object) ?? {}), [k]: v })}
            />
          ))}
        </fieldset>
      );
  }
}

function TagField({ label, value, onChange }: { label: React.ReactNode; value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-1.5">
      {label}
      <div className="flex flex-wrap gap-1.5">
        {value.map((tag, i) => (
          <span key={i} className="bg-muted flex h-7 items-center gap-1 rounded-md pr-1 pl-2 text-xs">
            {tag}
            <button onClick={() => onChange(value.filter((_, j) => j !== i))} className="hover:bg-background grid size-5 cursor-pointer place-items-center rounded" aria-label={`移除 ${tag}`}>
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        className={inputClass}
        placeholder="輸入後按 Enter"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            onChange([...value, draft.trim()]);
            setDraft("");
          }
        }}
      />
    </div>
  );
}
