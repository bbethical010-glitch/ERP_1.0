import { z } from 'zod';

const stockItemSchema = z.object({
    name: z.string().min(1, 'Item name is required'),
    category: z.string().optional(),
    quantity: z.number().positive('Quantity must be positive'),
    unitCost: z.number().min(0, 'Unit cost cannot be negative'),
});

const financialLineSchema = z.object({
    code: z.string(),
    name: z.string(),
    amount: z.number().min(0)
});

export const OpeningPositionValidator = {
    validateStockItem(item) {
        return stockItemSchema.safeParse(item);
    },

    calculateTotals(assets, liabilities, capital, inventory) {
        const totalInventory = inventory.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0);
        const sumAssets = assets.reduce((sum, item) => sum + item.amount, 0) + totalInventory;
        const sumLiabilities = liabilities.reduce((sum, item) => sum + item.amount, 0);
        const variance = sumAssets - (sumLiabilities + capital);

        return {
            totalInventory,
            sumAssets,
            sumLiabilities,
            variance
        };
    }
};
