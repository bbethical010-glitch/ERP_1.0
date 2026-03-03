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

    calculateTotals(openingBalances = [], inventory = []) {
        let sumAssets = 0;
        let sumLiabilities = 0;
        let ownerCapital = 0;

        openingBalances.forEach(line => {
            if (!line.groupCode) return;

            const amount = parseFloat(line.amount) || 0;

            // ASSETS
            if (line.groupCode.startsWith('CA') || line.groupCode === 'FA') {
                sumAssets += line.drCr === 'DR' ? amount : -amount;
            }

            // LIABILITIES
            else if (line.groupCode === 'LI' || line.groupCode === 'LI-AP') {
                sumLiabilities += line.drCr === 'CR' ? amount : -amount;
            }

            // CAPITAL / EQUITY
            else if (line.groupCode === 'EQ') {
                ownerCapital += line.drCr === 'CR' ? amount : -amount;
            }
        });

        const totalInventory = inventory.reduce((sum, item) => {
            return sum + (parseFloat(item.initialQty) || 0) * (parseFloat(item.unitCost) || 0);
        }, 0);

        const totalAssets = sumAssets + totalInventory;

        const variance =
            Math.abs(totalAssets - (sumLiabilities + ownerCapital)) < 0.01
                ? 0
                : totalAssets - (sumLiabilities + ownerCapital);

        return {
            totalInventory,
            sumAssets: totalAssets,
            sumLiabilities,
            ownerCapital,
            variance
        };
    }
}
