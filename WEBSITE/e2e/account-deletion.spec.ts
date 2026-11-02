import { test, expect } from '@playwright/test';

test('explains how to request account deletion without exposing credentials', async ({ page }) => {
  await page.goto('/account-deletion');
  await expect(page.getByRole('heading', { name: 'Request account deletion' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Email a deletion request' })).toHaveAttribute('href', /^mailto:support@trustpayhq\.com\?/);
  await expect(page.getByText(/never include your password/i)).toBeVisible();
  await expect(page.getByText(/does not immediately delete/i)).toBeVisible();
});
