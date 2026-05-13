import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

const InputField = ({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  error,
}) => {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";

  return (
    <div className="flex flex-col gap-1 w-full">
      {/* Label */}
      {label && (
        <label className="text-sm text-slate-300 font-medium">{label}</label>
      )}

      {/* Input Wrapper */}
      <div className="relative">
        <input
          type={isPassword && showPassword ? "text" : type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          className="
            w-full px-4 py-3 rounded-xl
            bg-white/5 border border-white/20
            text-white placeholder:text-slate-400
            focus:outline-none focus:border-brand-accent
            focus:ring-1 focus:ring-brand-accent
            transition duration-200
          "
        />

        {/* Password Toggle */}
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition"
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>

      {/* Error Message */}
      {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
    </div>
  );
};

export default InputField;
