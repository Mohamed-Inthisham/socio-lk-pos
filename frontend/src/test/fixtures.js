export const mainShop = {
  id: "branch-main",
  name: "Main Shop",
  is_active: true,
};

export const cityShop = {
  id: "branch-city",
  name: "City Shop",
  is_active: true,
};

export const closedShop = {
  id: "branch-closed",
  name: "Closed Shop",
  is_active: false,
};

export const cashierUser = {
  id: "user-cashier",
  email: "cashier@socio.lk",
  name: "Test Cashier",
  role: "cashier",
  branch_id: mainShop.id,
  branch: mainShop,
  avatar: null,
};

export const adminUser = {
  id: "user-admin",
  email: "admin@socio.lk",
  name: "Test Admin",
  role: "admin",
  branch_id: null,
  branch: null,
  avatar: null,
};
