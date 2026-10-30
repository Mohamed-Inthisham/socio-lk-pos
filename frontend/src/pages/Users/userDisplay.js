/**
 * How a user is shown on the Users page and in their profile card
 * (Task 2.4): the role and status badges and where they work.
 */

export const ROLE_BADGE = {
  admin: "bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300",
  manager: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  cashier: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
};

export const statusBadge = (active) =>
  active
    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
    : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";

/** Where the user works: admins work at every branch. */
export const branchLabel = (user) => {
  if (user.role === "admin") return "All branches";
  const name = user.branch?.name;
  if (!name) return "—";
  return user.branch.is_active === false ? `${name} (inactive)` : name;
};

/** "Nimal Silva" → "NS", "Madonna" → "M". */
export const initialsOf = (name = "") =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0].toUpperCase()).join("");
