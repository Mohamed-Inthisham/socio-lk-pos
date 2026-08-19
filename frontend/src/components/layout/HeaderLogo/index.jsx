import logo from "../../../assets/logo.png";

/**
 * HeaderLogo Component
 *
 * Horizontal, compact brand mark for the app header. Deliberately separate
 * from the Logo component (which owns the stacked login-page layout) so
 * design changes to one never accidentally affect the other.
 *
 * On mobile (<640px), only the icon is visible — the brand text hides to
 * save space in the narrow header. On desktop, icon + brand name +
 * tagline show side-by-side.
 *
 * Uses Tailwind dark: classes because the header renders in both themes.
 */

const HeaderLogo = () => {
  return (
    <div className="flex items-center gap-2.5">
      <img
        src={logo}
        alt="SOCIO.LK POS"
        className="w-8 h-8 object-contain flex-shrink-0"
      />
      {/* Brand text hidden on mobile — icon alone identifies the app on
          a narrow header. Space is precious there. */}
      <div className="hidden sm:flex flex-col leading-tight">
        <span className="text-sm font-semibold tracking-widest text-slate-900 dark:text-slate-100">
          SOCIO.LK
        </span>
        <span className="text-[10px] tracking-[0.24em] uppercase font-medium text-cyan-600 dark:text-cyan-400">
          Point of Sale
        </span>
      </div>
    </div>
  );
};

export default HeaderLogo;
