import Drawer from "../../common/Drawer";
import Sidebar from "../Sidebar";
import useLayoutStore from "../../../store/zustand/layoutStore";

/**
 * SidebarDrawer Component
 *
 * Mobile-only wrapper that renders Sidebar inside a slide-in Drawer.
 * On desktop (lg+), this component renders nothing — desktop uses
 * the Sidebar directly. AppLayout decides which to render via CSS
 * (hidden lg:block / lg:hidden).
 *
 * When the user taps a nav item, the drawer closes automatically —
 * we pass `onNavigate={closeMobileDrawer}` to Sidebar, and NavLink's
 * onClick fires before the route changes.
 */

const SidebarDrawer = () => {
  const open = useLayoutStore((s) => s.mobileDrawerOpen);
  const closeMobileDrawer = useLayoutStore((s) => s.closeMobileDrawer);

  return (
    <Drawer
      open={open}
      onClose={closeMobileDrawer}
      side="left"
      width="w-64"
      title="Menu"
    >
      <Sidebar onNavigate={closeMobileDrawer} />
    </Drawer>
  );
};

export default SidebarDrawer;
