import api from './api';

export const listStockPurchases = async () => {
  const response = await api.get('/stock-purchases');
  return response.data;
};

export const listSupplierPurchaseBalances = async () => {
  const response = await api.get('/stock-purchases/supplier-balances');
  return response.data;
};

export const getStockPurchase = async (id) => {
  const response = await api.get(`/stock-purchases/${id}`);
  return response.data;
};

export const getProductPurchaseIdentifiers = async (productId) => {
  const response = await api.get(`/stock-purchases/products/${productId}/identifiers`);
  return response.data;
};

export const createStockPurchase = async (payload) => {
  const response = await api.post('/stock-purchases', payload);
  return response.data;
};

export const addStockPurchasePayment = async (purchaseId, payload) => {
  const response = await api.post(`/stock-purchases/${purchaseId}/payments`, payload);
  return response.data;
};

export const resolveStockPurchaseCheque = async (purchaseId, paymentId, status) => {
  const response = await api.patch(
    `/stock-purchases/${purchaseId}/payments/${paymentId}/status`,
    { status },
  );
  return response.data;
};
