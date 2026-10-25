import api from "./api";

export const listSuppliers = async ({ includeInactive = false } = {}) => {
  const response = await api.get("/suppliers", {
    params: includeInactive ? { includeInactive: true } : undefined,
  });
  return response.data;
};

export const createSupplier = async (payload) => {
  const response = await api.post("/suppliers", payload);
  return response.data;
};

export const updateSupplier = async (id, payload) => {
  const response = await api.patch(`/suppliers/${id}`, payload);
  return response.data;
};

export const deactivateSupplier = async (id) => {
  const response = await api.delete(`/suppliers/${id}`);
  return response.data;
};

export const reactivateSupplier = async (id) => {
  const response = await api.post(`/suppliers/${id}/reactivate`);
  return response.data;
};
