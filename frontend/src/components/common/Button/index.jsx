const Button = ({
  label,
  onClick,
  type = "button",
  loading = false,
  disabled = false,
  fullWidth = false,
}) => {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        ${fullWidth ? "w-full" : ""}
        px-6 py-3 rounded-xl font-semibold text-white
        bg-linear-to-r from-cyan-500 to-blue-500
        hover:from-cyan-400 hover:to-blue-400
        active:scale-95 transition duration-200
        disabled:opacity-50 disabled:cursor-not-allowed
        flex items-center justify-center gap-2
        tracking-wide shadow-lg shadow-cyan-500/25
      `}
    >
      {loading && (
        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      )}
      {label}
    </button>
  );
};

export default Button;
