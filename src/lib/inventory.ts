export interface InventorySnapshot {
  products: { id: string; category: string }[];
  imeiUnits: { product_id: string; status: string; is_damaged: boolean; is_voided?: boolean }[];
  inventoryReceiptItems: { product_id: string; quantity: number }[];
  issueItems: { product_id: string; quantity: number }[];
  returns: { product_id: string; quantity: number; is_damaged: boolean }[];
  dealerReturnItems: { product_id: string; quantity: number; is_damaged: boolean }[];
}

export function companyStock(snapshot: InventorySnapshot, productId: string): number {
  const product = snapshot.products.find((item) => item.id === productId);
  if (!product) return 0;
  if (product.category === "smartphone") {
    return snapshot.imeiUnits.filter(
      (unit) =>
        unit.product_id === productId &&
        unit.status === "in_dealer_stock" &&
        !unit.is_damaged &&
        !unit.is_voided,
    ).length;
  }
  const received = snapshot.inventoryReceiptItems
    .filter((item) => item.product_id === productId)
    .reduce((total, item) => total + item.quantity, 0);
  const issued = snapshot.issueItems
    .filter((item) => item.product_id === productId)
    .reduce((total, item) => total + item.quantity, 0);
  const returned = snapshot.returns
    .filter((item) => item.product_id === productId && !item.is_damaged)
    .reduce((total, item) => total + item.quantity, 0);
  const dealerReturned = snapshot.dealerReturnItems
    .filter((item) => item.product_id === productId && !item.is_damaged)
    .reduce((total, item) => total + item.quantity, 0);
  return received - issued + returned + dealerReturned;
}
