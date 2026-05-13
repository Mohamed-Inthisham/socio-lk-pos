import { useState } from "react";
import { Eye, EyeOff, Mail, Lock } from "lucide-react";

const InputField = ({
  label,
  type = "text",
  name,
  placeholder,
  value,
  onChange,
  error,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState(false);
  const isPassword = type === "password";
  const isEmail = type === "email";

  return (
    <div className="flex flex-col gap-1.5 w-full">
      {/* Label */}
      {label && (
        <label
          className="text-xs uppercase tracking-widest font-semibold"
          style={{ color: "#64748b" }}
        >
          {label}
        </label>
      )}

      {/* Input Wrapper */}
      <div
        className="flex items-center gap-3 px-4 rounded-xl transition-all"
        style={{
          background: "#f1f5f9",
          border: focused ? "1.5px solid #0ea5e9" : "1.5px solid #cbd5e1",
          height: "48px",
          boxShadow: focused ? "0 0 0 3px rgba(14,165,233,0.15)" : "none",
        }}
      >
        <span
          style={{ color: focused ? "#0ea5e9" : "#94a3b8" }}
          className="transition-colors"
        >
          {isEmail && <Mail size={16} />}
          {isPassword && <Lock size={16} />}
        </span>

        <input
          type={isPassword && showPassword ? "text" : type}
          name={name}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: "#0f172a" }}
        />

        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            style={{ color: "#94a3b8" }}
            className="hover:text-slate-700 transition"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        )}
      </div>

      {error && (
        <p className="text-xs mt-1" style={{ color: "#ef4444" }}>
          {error}
        </p>
      )}
    </div>
  );
};

export default InputField;
