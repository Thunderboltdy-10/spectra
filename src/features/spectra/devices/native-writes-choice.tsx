"use client";

import { NATIVE_WRITES_OPTIONS, type NativeWrites } from "./devices-model";

/*
 * When Spectra may write back to the files on the student's computers, as
 * three plain choices with what each one means. It is one choice for every
 * device, so it sits beside them rather than inside one.
 */
export function NativeWritesChoice({
  value,
  disabled,
  onChange,
}: {
  value: NativeWrites;
  disabled: boolean;
  onChange: (choice: NativeWrites) => void;
}) {
  return (
    <section aria-labelledby="native-writes" className="device-slip">
      <h2 id="native-writes" className="device-slip-heading">
        Changes to desktop files
      </h2>
      <p className="device-slip-about">When Spectra may write back to the files on your computers. Applies to every device.</p>
      <div role="radiogroup" aria-labelledby="native-writes" className="mt-4 space-y-1.5">
        {NATIVE_WRITES_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className="device-choice"
          >
            <span aria-hidden className="device-choice-dot" />
            <span className="min-w-0">
              <span className="block text-ui font-medium text-[var(--text-primary)]">{option.label}</span>
              <span className="block text-caption leading-5 text-[var(--text-secondary)]">{option.description}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
