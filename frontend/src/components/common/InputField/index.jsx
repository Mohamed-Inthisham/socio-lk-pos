import { useState } from "react";
import { Eye, EyeOff, Mail, Lock, ChevronDown } from "lucide-react";

/**
 * InputField Component
 *
 * Extended for Path B to support text, number, textarea, and select in
 * addition to the original email/password. LoginForm's usage still works —
 * type="email" auto-shows Mail icon, type="password" auto-shows Lock + toggle.
 *
 * NEW PROPS:
 * - type: 'text' | 'email' | 'password' | 'number' | 'textarea' | 'select'
 * - icon: lucide-react component, overrides the auto-picked icon
 * - options: [{ value, label }] — only for type='select'
 * - min, max, step: passed through to number inputs
 * - rows: passed through to textarea (default 3)
 * - required: shows a small asterisk on the label
 * - hint: helper text shown below input when there's no error
 */

const InputField = ({
  label,
  type = "text",
  name,
  placeholder,
  value,
  onChange,
  onBlur,
  error,
  icon: IconProp,
  options = [],
  min,
  max,
  step,
  rows = 3,
  required = false,
  hint,
  disabled = false,
  className = "",
  ...rest
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState(false);
  const isPassword = type === "password";
  const isEmail = type === "email";
  const isTextarea = type === "textarea";
  const isSelect = type === "select";
  const isNumber = type === "number";

  // Auto-pick icon for legacy email/password usage
  const Icon = IconProp || (isEmail ? Mail : isPassword ? Lock : null);

  const wrapperBase =
    "flex items-center gap-3 px-3.5 rounded-lg transition-all";
  const wrapperBg = "bg-slate-50 dark:bg-slate-800";
  const wrapperBorder = error
    ? "border-red-400 dark:border-red-500"
    : focused
      ? "border-cyan-500 dark:border-cyan-400 ring-2 ring-cyan-500/20 dark:ring-cyan-400/20"
      : "border-slate-300 dark:border-slate-600";
  const wrapperState = disabled ? "opacity-60 cursor-not-allowed" : "";

  const wrapperClass = `${wrapperBase} ${wrapperBg} border ${wrapperBorder} ${wrapperState}`;

  const inputBase =
    "flex-1 bg-transparent text-sm outline-none min-w-0 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500";

  const handleFocus = () => setFocused(true);
  const handleBlur = (e) => {
    setFocused(false);
    if (onBlur) onBlur(e);
  };

  return (
    <div className={`flex flex-col gap-1.5 w-full ${className}`}>
      {label && (
        <label
          htmlFor={name}
          className="text-xs uppercase tracking-widest font-semibold text-slate-500 dark:text-slate-400"
        >
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}

      {isTextarea ? (
        <div
          className={wrapperClass}
          style={{
            minHeight: `${rows * 20 + 16}px`,
            alignItems: "flex-start",
            paddingTop: 10,
            paddingBottom: 10,
          }}
        >
          <textarea
            id={name}
            name={name}
            placeholder={placeholder}
            value={value}
            onChange={onChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            disabled={disabled}
            rows={rows}
            className={`${inputBase} resize-y`}
            {...rest}
          />
        </div>
      ) : isSelect ? (
        <div
          className={wrapperClass}
          style={{ height: 44, position: "relative" }}
        >
          <select
            id={name}
            name={name}
            value={value ?? ""}
            onChange={onChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            disabled={disabled}
            className={`${inputBase} appearance-none pr-6 cursor-pointer [color-scheme:light] dark:[color-scheme:dark]`}
            {...rest}
          >
            {placeholder && (
              <option
                value=""
                disabled
                className="bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                {placeholder}
              </option>
            )}
            {options.map((opt) => (
              <option
                key={opt.value}
                value={opt.value}
                className="bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            className="pointer-events-none text-slate-400 dark:text-slate-500 absolute right-3.5"
          />
        </div>
      ) : (
        <div className={wrapperClass} style={{ height: 44 }}>
          {Icon && (
            <span
              className={`transition-colors ${
                focused
                  ? "text-cyan-500 dark:text-cyan-400"
                  : "text-slate-400 dark:text-slate-500"
              }`}
            >
              <Icon size={16} />
            </span>
          )}

          <input
            id={name}
            type={isPassword && showPassword ? "text" : type}
            name={name}
            placeholder={placeholder}
            value={value}
            onChange={onChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            disabled={disabled}
            min={isNumber ? min : undefined}
            max={isNumber ? max : undefined}
            step={isNumber ? step : undefined}
            inputMode={isNumber ? "decimal" : undefined}
            className={inputBase}
            {...rest}
          />

          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          )}
        </div>
      )}

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

export default InputField;
