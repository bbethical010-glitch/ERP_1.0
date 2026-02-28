import { z } from 'zod';

const stockItemSchema = z.object({
    sku: z.string().optional(),
    name: z.string().min(1, 'Item name is required'),
    uom: z.string().optional(),
    initialQty: z.number().positive('Quantity must be positive'),
    unitCost: z.number().min(0, 'Unit cost cannot be negative'),
});

export const OpeningPositionValidator = {
    validateStockItem(item) {
        return stockItemSchema.safeParse(item);
    },

    calculateTotals(openingBalances, inventory) {
        let sumAssets = 0;
        let sumLiabilities = 0;
        let ownerCapital = 0;

        openingBalances.forEach(line => {
            const amount = parseFloat(line.amount) || 0;
            if (line.drCr === 'DR') {
                sumAssets += amount;
            } else if (line.drCr === 'CR') {
                if (line.group.toLowerCase().includes('capital') || line.group.toLowerCase().includes('equity')) {
                    ownerCapital += amount;
                } else {
                    sumLiabilities += amount;
                }
            }
        });

        let totalInventory = 0;
        inventory.forEach((item) => {
            totalInventory += (parseFloat(item.initialQty) || 0) * (parseFloat(item.unitCost) || 0);
        });

        // Add inventory to total assets visually
        sumAssets += totalInventory;

        // Assets = Liabilities + Capital
        const variance = Math.abs(sumAssets - (sumLiabilities + ownerCapital)) < 0.01 ? 0 : sumAssets - (sumLiabilities + ownerCapital);

        return {
            totalInventory,
            sumAssets,
            sumLiabilities,
            ownerCapital,
            variance
        };
    }
};
