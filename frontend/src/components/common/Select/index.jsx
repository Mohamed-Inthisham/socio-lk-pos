import { Fragment } from "react";
import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Transition,
} from "@headlessui/react";
import { Check, ChevronDown } from "lucide-react";

/**
 * Select Component
 *
 * A custom dropdown built on Headless UI's Listbox. Fully styled with
 * Tailwind — no native <select> behavior, so we get consistent look and
 * feel across browsers and OSes.
 *
 * API is designed to be a drop-in replacement for InputField type="select":
 * - Same props: label, value, onChange, options, placeholder, error, hint,
 *   required, disabled, name
 * - onChange receives a synthetic event: { target: { name, value } } so
 *   existing handlers written for <select onChange={e => e.target.value}>
 *   don't need to change.
 *
 * PROPS:
 * - label: field label (uppercase caption above the input)
 * - value: currently selected option value
 * - onChange: (event) => void, receives { target: { name, value } }
 * - options: [{ value, label }]
 * - placeholder: text shown when nothing is selected (default 'Select…')
 * - error: string, shows red error text below
 * - hint: string, shows muted helper text below (only when no error)
 * - required: adds a red asterisk to the label
 * - disabled: disables the trigger button
 * - name: passed through as the event's target.name
 * - icon: optional lucide-react component, rendered in the trigger button
 */

const Select = ({
  label,
  value,
  onChange,
  options = [],
  placeholder = "Select…",
  error,
  hint,
  required = false,
  disabled = false,
  name,
  icon: Icon,
  className = "",
}) => {
  const selectedOption = options.find((opt) => opt.value === value);

  // Adapt Listbox's onChange (which gives the raw new value) into a synthetic
  // event so callers expecting e.target.value keep working unchanged.
  const handleChange = (nextValue) => {
    if (onChange) {
      onChange({ target: { name, value: nextValue } });
    }
  };

  return (
    <div className={`flex flex-col gap-1.5 w-full ${className}`}>
      {label && (
        <label className="text-xs uppercase tracking-widest font-semibold text-slate-500 dark:text-slate-400">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      <Listbox value={value} onChange={handleChange} disabled={disabled}>
        <div className="relative">
          {/* Trigger button — styled to match InputField's look */}
          <ListboxButton
            className={`
              relative w-full h-11 pl-3.5 pr-10 rounded-lg
              flex items-center gap-3 text-left text-sm
              bg-slate-50 dark:bg-slate-800
              border transition-all
              text-slate-900 dark:text-slate-100
              ${
                error
                  ? "border-red-400 dark:border-red-500"
                  : "border-slate-300 dark:border-slate-600 data-[open]:border-cyan-500 dark:data-[open]:border-cyan-400 data-[open]:ring-2 data-[open]:ring-cyan-500/20 dark:data-[open]:ring-cyan-400/20 data-[focus]:border-cyan-500 dark:data-[focus]:border-cyan-400"
              }
              ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}
              focus:outline-none
            `}
          >
            {Icon && (
              <Icon
                size={16}
                className="text-slate-400 dark:text-slate-500 flex-shrink-0"
              />
            )}
            <span
              className={`block truncate flex-1 ${
                selectedOption
                  ? "text-slate-900 dark:text-slate-100"
                  : "text-slate-400 dark:text-slate-500"
              }`}
            >
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            <ChevronDown
              size={16}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none transition-transform ui-open:rotate-180"
              aria-hidden="true"
            />
          </ListboxButton>

          {/* Options menu — portal renders to body so it can escape overflow */}
          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
            enter="transition ease-out duration-150"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
          >
            <ListboxOptions
              anchor={{ to: "bottom start", gap: 4 }}
              className="
                z-50 w-[var(--button-width)] max-h-72 overflow-auto
                rounded-lg p-1
                bg-white dark:bg-slate-900
                border border-slate-200 dark:border-slate-700
                shadow-xl shadow-slate-900/10 dark:shadow-black/40
                focus:outline-none
              "
            >
              {options.length === 0 && (
                <div className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                  No options
                </div>
              )}
              {options.map((opt) => (
                <ListboxOption
                  key={opt.value}
                  value={opt.value}
                  className="
                    group flex items-center gap-2
                    px-3 py-2 rounded-md
                    text-sm text-slate-700 dark:text-slate-200
                    cursor-pointer select-none
                    data-[focus]:bg-cyan-50 dark:data-[focus]:bg-cyan-900/30
                    data-[focus]:text-slate-900 dark:data-[focus]:text-white
                    data-[selected]:font-medium
                  "
                >
                  <span className="flex-1 truncate">{opt.label}</span>
                  <Check
                    size={16}
                    className="text-cyan-600 dark:text-cyan-400 opacity-0 group-data-[selected]:opacity-100 flex-shrink-0"
                    aria-hidden="true"
                  />
                </ListboxOption>
              ))}
            </ListboxOptions>
          </Transition>
        </div>
      </Listbox>

      {error ? (
        <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {hint}
        </p>
      ) : null}
    </div>
  );
};

export default Select;
