"use client";

import { Check, ChevronDown, Minus, Plus } from "lucide-react";
import { useState, type ReactElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { CommandBinding, CommandControl, CommandControlOption, CommandParam } from "../commands";

/**
 * The controls a command can be.
 *
 * A font picker, a size stepper and a colour well are not chrome that lives
 * beside the registry — they are commands with a value. Keeping them here means
 * `document.format.fontFamily` is one record with one `execute`, reachable by
 * pointer, by keyboard, from the overflow menu and from the AI dispatcher, and
 * customizable like every other command.
 *
 * Two renderings exist for each kind. In the bar a control is compact and opens
 * a portaled popover. In the overflow menu the same control renders *inline and
 * already open* — a menu inside a menu is a trap, and a person who reached the
 * menu is already looking for the choice.
 */

type Emit = (value: CommandParam) => void;

function optionLabel(options: readonly CommandControlOption[], value?: string) {
  return options.find((option) => option.value === value)?.label;
}

/** Shared popover shell: portaled, collision-aware, and on the named layer. */
function ControlPopover({
  open,
  onOpenChange,
  trigger,
  children,
  ariaLabel,
  width,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement;
  children: ReactNode;
  ariaLabel: string;
  width?: number;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        role="listbox"
        aria-label={ariaLabel}
        align="start"
        layer="dropdown"
        className="spectra-workbar-control-popover"
        style={width ? { width } : undefined}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

function ControlOptionRow({
  option,
  selected,
  onSelect,
}: {
  option: CommandControlOption;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = option.icon;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      disabled={option.disabled}
      onClick={onSelect}
      className="spectra-workbar-control-option"
      title={option.hint ?? option.label}
      style={option.previewFontFamily ? { fontFamily: option.previewFontFamily } : undefined}
    >
      <span className="spectra-workbar-control-check" aria-hidden="true">
        {selected ? <Check className="size-3" /> : null}
      </span>
      {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate text-left">{option.label}</span>
      {option.hint ? (
        <span className="spectra-workbar-control-option-hint">{option.hint}</span>
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------------------ select */

function SelectControl({
  action,
  control,
  emit,
}: {
  action: CommandBinding;
  control: Extract<CommandControl, { kind: "select" | "menu" }>;
  emit: Emit;
}) {
  const [open, setOpen] = useState(false);
  const current = optionLabel(control.options, control.value);
  const shown = control.kind === "menu"
    ? action.label
    : current ?? ("placeholder" in control ? control.placeholder : undefined) ?? action.label;
  return (
    <ControlPopover
      open={open}
      onOpenChange={setOpen}
      ariaLabel={action.label}
      width={control.kind === "select" ? 224 : 196}
      trigger={
        <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={action.label}
        title={action.hint ? `${action.label} · ${action.hint}` : action.label}
        disabled={action.disabled}
        onClick={() => setOpen((value) => !value)}
        className="spectra-workbar-control spectra-workbar-control-select"
        style={"width" in control && control.width ? { width: control.width } : undefined}
        data-empty={current ? undefined : true}
      >
        <span className="min-w-0 flex-1 truncate text-left">{shown}</span>
        <ChevronDown className="size-3 shrink-0 text-[var(--text-tertiary)]" />
      </button>
      }
    >
        {control.options.map((option) => (
          <ControlOptionRow
            key={option.value}
            option={option}
            selected={option.value === control.value}
            onSelect={() => {
              emit(option.value);
              setOpen(false);
            }}
          />
        ))}
    </ControlPopover>
  );
}

/* ----------------------------------------------------------------- numeric */

function NumericControl({
  action,
  control,
  emit,
}: {
  action: CommandBinding;
  control: Extract<CommandControl, { kind: "numeric" }>;
  emit: Emit;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const step = control.step ?? 1;
  const min = control.min ?? 0;
  const max = control.max ?? 999;
  const value = control.value;
  const shown = draft ?? (value === undefined ? "" : String(value));
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const commit = (raw: string) => {
    const next = Number(raw);
    setDraft(null);
    if (Number.isFinite(next) && raw.trim() !== "") emit(clamp(next));
  };
  return (
    <div
      className="spectra-workbar-control spectra-workbar-control-numeric"
      role="group"
      aria-label={action.label}
    >
      <button
        type="button"
        aria-label={`Decrease ${action.label.toLowerCase()}`}
        title={`Decrease ${action.label.toLowerCase()}`}
        disabled={action.disabled || value === undefined || value <= min}
        onClick={() => value !== undefined && emit(clamp(value - step))}
        className="spectra-workbar-control-step"
      >
        <Minus className="size-3" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        // A stepper with a range is a spinbutton, even though the field itself is
        // text so someone can type "11.5" without fighting a browser spinner.
        // Without this a screen reader announces an unlabelled text box and the
        // range the command enforces is invisible.
        role="spinbutton"
        aria-label={action.label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        {...(control.suffix ? { "aria-valuetext": `${shown}${control.suffix}` } : {})}
        title={action.hint ?? action.label}
        disabled={action.disabled}
        value={shown}
        placeholder={control.suffix ?? "—"}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit((event.target as HTMLInputElement).value);
            (event.target as HTMLInputElement).blur();
          }
          if (event.key === "Escape") setDraft(null);
          if (event.key === "ArrowUp" && value !== undefined) {
            event.preventDefault();
            emit(clamp(value + step));
          }
          if (event.key === "ArrowDown" && value !== undefined) {
            event.preventDefault();
            emit(clamp(value - step));
          }
        }}
        className="spectra-workbar-control-numeric-input"
      />
      <button
        type="button"
        aria-label={`Increase ${action.label.toLowerCase()}`}
        title={`Increase ${action.label.toLowerCase()}`}
        disabled={action.disabled || value === undefined || value >= max}
        onClick={() => value !== undefined && emit(clamp(value + step))}
        className="spectra-workbar-control-step"
      >
        <Plus className="size-3" />
      </button>
      {control.presets?.length ? (
        <ControlPopover
          open={open}
          onOpenChange={setOpen}
          ariaLabel={`${action.label} presets`}
          width={104}
          trigger={
            <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={`${action.label} presets`}
            title={`${action.label} presets`}
            disabled={action.disabled}
            onClick={() => setOpen((current) => !current)}
            className="spectra-workbar-control-step"
          >
            <ChevronDown className="size-3" />
          </button>
          }
        >
            {control.presets.map((preset) => (
              <ControlOptionRow
                key={preset}
                option={{ value: String(preset), label: String(preset) }}
                selected={preset === value}
                onSelect={() => {
                  emit(preset);
                  setOpen(false);
                }}
              />
            ))}
        </ControlPopover>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- color */

function ColorSwatchGrid({
  control,
  emit,
  onDone,
}: {
  control: Extract<CommandControl, { kind: "color" }>;
  emit: Emit;
  onDone?: () => void;
}) {
  return (
    <div className="spectra-workbar-color-grid">
      {(control.swatches ?? []).map((swatch) => (
        <button
          key={swatch}
          type="button"
          role="option"
          aria-selected={swatch.toLowerCase() === control.value?.toLowerCase()}
          aria-label={swatch}
          title={swatch}
          onClick={() => {
            emit(swatch);
            onDone?.();
          }}
          className="spectra-workbar-color-swatch"
          data-selected={swatch.toLowerCase() === control.value?.toLowerCase() || undefined}
          style={{ background: swatch }}
        />
      ))}
      {control.clearLabel ? (
        <button
          type="button"
          role="option"
          aria-selected={!control.value}
          onClick={() => {
            emit(null);
            onDone?.();
          }}
          className="spectra-workbar-color-clear"
        >
          {control.clearLabel}
        </button>
      ) : null}
    </div>
  );
}

function ColorControl({
  action,
  control,
  emit,
}: {
  action: CommandBinding;
  control: Extract<CommandControl, { kind: "color" }>;
  emit: Emit;
}) {
  const [open, setOpen] = useState(false);
  const Icon = action.icon;
  return (
    <ControlPopover
      open={open}
      onOpenChange={setOpen}
      ariaLabel={action.label}
      width={168}
      trigger={
        <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={action.label}
        title={action.hint ? `${action.label} · ${action.hint}` : action.label}
        disabled={action.disabled}
        onClick={() => setOpen((value) => !value)}
        className="spectra-workbar-control spectra-workbar-control-color"
      >
        {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
        <span
          className="spectra-workbar-color-bar"
          aria-hidden="true"
          data-empty={control.value ? undefined : true}
          style={control.value ? { background: control.value } : undefined}
        />
      </button>
      }
    >
        <ColorSwatchGrid control={control} emit={emit} onDone={() => setOpen(false)} />
    </ControlPopover>
  );
}

/* --------------------------------------------------------------- segmented */

function SegmentedControl({
  action,
  control,
  emit,
}: {
  action: CommandBinding;
  control: Extract<CommandControl, { kind: "segmented" }>;
  emit: Emit;
}) {
  return (
    <div
      className="spectra-workbar-control spectra-workbar-control-segmented"
      role="group"
      aria-label={action.label}
    >
      {control.options.map((option) => {
        const Icon = option.icon;
        const active = option.value === control.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            aria-label={option.label}
            title={option.label}
            disabled={action.disabled || option.disabled}
            data-active={active || undefined}
            onClick={() => emit(option.value)}
            className="spectra-workbar-segment"
          >
            {Icon ? <Icon className="size-3.5" /> : <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ facade */

/**
 * Renders a command in the bar. Buttons and toggles return `null` here so the
 * caller keeps using the plain action button — one shape per command, never two.
 */
export function WorkbarCommandControl({
  action,
  onEmit,
}: {
  action: CommandBinding;
  onEmit: Emit;
}) {
  const control = action.control;
  if (!control) return null;
  switch (control.kind) {
    case "select":
    case "menu":
      return <SelectControl action={action} control={control} emit={onEmit} />;
    case "numeric":
      return <NumericControl action={action} control={control} emit={onEmit} />;
    case "color":
      return <ColorControl action={action} control={control} emit={onEmit} />;
    case "segmented":
      return <SegmentedControl action={action} control={control} emit={onEmit} />;
    default:
      return null;
  }
}

export function isRenderedControl(action: CommandBinding) {
  const kind = action.control?.kind;
  return kind === "select" || kind === "menu" || kind === "numeric" || kind === "color" || kind === "segmented";
}

/**
 * The overflow rendering: the choice is already open. Nothing here opens a
 * second popover, because a menu that spawns a menu loses the pointer.
 */
export function WorkbarControlMenuRow({
  action,
  onEmit,
}: {
  action: CommandBinding;
  onEmit: Emit;
}) {
  const control = action.control;
  if (!control) return null;
  return (
    // Deliberately not a labelled group: every branch below renders its own
    // labelled group or listbox, and nesting a second one with the same name
    // makes a screen reader announce "Size group, Size group, Size spinbutton"
    // for one stepper. The visible label is the row's heading, nothing more.
    <div className="spectra-workbar-control-row">
      <div className="spectra-workbar-control-row-label" aria-hidden="true">
        {action.icon ? <action.icon className="size-3.5 shrink-0" /> : null}
        <span className="min-w-0 flex-1 truncate">{action.label}</span>
      </div>
      {control.kind === "color" ? (
        <ColorSwatchGrid control={control} emit={onEmit} />
      ) : control.kind === "numeric" ? (
        <NumericControl action={action} control={control} emit={onEmit} />
      ) : control.kind === "segmented" ? (
        <SegmentedControl action={action} control={control} emit={onEmit} />
      ) : control.kind === "select" || control.kind === "menu" ? (
        <div className="spectra-workbar-control-row-options" role="listbox" aria-label={action.label}>
          {control.options.map((option) => (
            <ControlOptionRow
              key={option.value}
              option={option}
              selected={option.value === control.value}
              onSelect={() => onEmit(option.value)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export { cn as workbarCn };
