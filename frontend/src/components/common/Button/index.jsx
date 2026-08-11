/**
 * Button Component
 *
 * Extended for Path B with variants and sizes. LoginForm's usage
 * (label, onClick, type, loading, fullWidth) still works — those props
 * pick sensible defaults (variant='primary', size='md').
 *
 * VARIANTS:
 * - primary: cyan→blue gradient. Reserved for hero surfaces (login, marketing).
 * - accent:  solid cyan-600. Default for data-view CTAs (New product, Save).
 * - secondary: outlined. For Cancel and non-destructive alt actions.
 * - danger:  solid red. Deactivate / Delete.
 * - ghost:   transparent. Row action icons, tertiary text buttons.
 *
 * SIZES:
 * - md: 40px height, default
 * - sm: 32px height, for table row actions
 *
 * ICON-ONLY BUTTONS:
 * - Set iconOnly=true and provide `aria-label` for accessibility.
 * - Pass icon via `icon` prop (a lucide-react component) or as children.
 */

const VARIANT_CLASSES = {
  primary: `
    text-white
    bg-linear-to-r from-cyan-500 to-blue-500
    hover:from-cyan-400 hover:to-blue-400
    active:scale-95 shadow-lg shadow-cyan-500/25
  `,
  accent: `
    text-white
    bg-cyan-600 hover:bg-cyan-700
    dark:bg-cyan-600 dark:hover:bg-cyan-500
    active:scale-[0.98]
  `,
  secondary: `
    text-slate-700 dark:text-slate-200
    bg-white dark:bg-slate-800
    border border-slate-300 dark:border-slate-600
    hover:bg-slate-50 dark:hover:bg-slate-700
    hover:border-slate-400 dark:hover:border-slate-500
    active:scale-[0.98]
  `,
  danger: `
    text-white
    bg-red-600 hover:bg-red-700
    dark:bg-red-600 dark:hover:bg-red-500
    active:scale-[0.98]
  `,
  ghost: `
    text-slate-600 dark:text-slate-300
    bg-transparent
    hover:bg-slate-100 dark:hover:bg-slate-800
    hover:text-slate-900 dark:hover:text-white
  `,
};

const SIZE_CLASSES = {
  md: "h-10 px-4 text-sm gap-2",
  sm: "h-8 px-3 text-xs gap-1.5",
};

const ICON_ONLY_SIZE_CLASSES = {
  md: "w-10 h-10",
  sm: "w-8 h-8",
};

const Button = ({
  label,
  children,
  onClick,
  type = "button",
  loading = false,
  disabled = false,
  fullWidth = false,
  variant = "primary",
  size = "md",
  icon: Icon,
  iconOnly = false,
  className = "",
  ...rest
}) => {
  const variantClass = VARIANT_CLASSES[variant] || VARIANT_CLASSES.primary;
  const sizeClass = iconOnly
    ? ICON_ONLY_SIZE_CLASSES[size]
    : SIZE_CLASSES[size];

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        ${fullWidth ? "w-full" : ""}
        ${sizeClass}
        ${variantClass}
        rounded-lg font-semibold tracking-wide
        transition-all duration-200
        disabled:opacity-50 disabled:cursor-not-allowed
        flex items-center justify-center
        focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2
        dark:focus-visible:ring-offset-slate-900
        ${className}
      `}
      {...rest}
    >
      {loading && (
        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      )}
      {!loading && Icon && <Icon size={size === "sm" ? 14 : 16} />}
      {!iconOnly && (label || children)}
    </button>
  );
};

export default Button;
