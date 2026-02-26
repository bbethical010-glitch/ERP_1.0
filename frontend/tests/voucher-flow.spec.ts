import { test, expect } from '@playwright/test';

test('Keyboard-only Voucher Entry Flow', async ({ page }) => {
    // 1. Visit Gateway of Tally (Dashboard)
    await page.goto('/');
    await expect(page.locator('text=Gateway of Tally')).toBeVisible();

    // Wait for network/hydration
    await page.waitForTimeout(500);

    // 2. Open Command Palette via Ctrl+K
    await page.keyboard.press('Control+k');

    const palette = page.locator('.command-palette');
    await expect(palette).toBeVisible();

    // 3. Search for "sales"
    await page.keyboard.type('sales');

    // 4. Hit Enter to execute the top command (should be Sales Voucher)
    // Give it a tiny bit to filter
    await page.waitForTimeout(100);
    await page.keyboard.press('Enter');

    // Verify we navigated to the voucher entry modal and it says Sales
    await expect(page.locator('text=Voucher Entry')).toBeVisible();
    const typeSelect = page.locator('select').first();
    await expect(typeSelect).toHaveValue('SALES');

    // 5. Navigate through fields with Tab and type entries
    // Jump to narration
    await page.keyboard.press('Alt+3');
    // Type narration
    await page.keyboard.type('End-to-end Test Sales Entry');

    // Jump to first ledger row (Arrow navigation via LedgerSearch input)
    await page.locator('input[placeholder="Search accounts..."]').first().focus();
    await page.keyboard.type('Cash');

    // Arrow down to pick the first search result 
    await page.waitForTimeout(200); // Wait for debounce
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter'); // Select the ledger

    // Focus should shift. Let's tab to the amount field.
    await page.keyboard.press('Tab'); // DR/CR
    await page.keyboard.press('Tab'); // Amount
    await page.keyboard.type('500');

    // 6. Duplicate row using Ctrl+D (custom keyboard shortcut)
    await page.keyboard.press('Control+d');

    // 7. Test form submission via Ctrl+Enter (Should fail if unbalanced, but for this test we'll just check it attempts to fire)
    // We can't actually post in E2E effectively without mock data, so we'll just verify the button exists and shortcut executes.

    // Let's attempt to post
    await page.keyboard.press('Control+Enter');

    // Expect an aria-live error because lines aren't balanced
    await expect(page.locator('text=Error')).toBeVisible();

    // Cancel back out to gateway
    await page.keyboard.press('Escape');
    // Confirm navigation back
    await expect(page.locator('text=Gateway of Tally')).toBeVisible();
});
