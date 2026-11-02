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

/**
 * Record a stock purchase. payload.client_request_id is the page's id for
 * this purchase (Phase 1 T1c), kept for every retry: a resend of a
 * purchase the server already recorded is answered 200 with that purchase,
 * so nothing is received twice.
 *
 * @param {Object} payload - CreateStockPurchaseDto, with client_request_id
 * @returns {Promise<{ purchase: Object, resent: boolean }>} resent: the
 *   server answered 200, an id it had already recorded
 */
export const createStockPurchase = async (payload) => {
  const response = await api.post('/stock-purchases', payload);
  return { purchase: response.data, resent: response.status === 200 };
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
