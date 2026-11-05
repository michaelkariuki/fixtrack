import { test, expect } from '@playwright/test';

const TOKEN = 'e2e-approval-token-0123456789abcdef';

test.describe('staff entry', () => {
  test('sign-in screen renders both forms', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('FIXTRACK').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.getByText(/Need an account\? Create one/i)).toBeVisible();
  });

  test('unauthenticated API calls are rejected', async ({ request }) => {
    expect((await request.get('/api/jobs')).status()).toBe(401);
    expect((await request.post('/api/workspaces', { data: { name: 'x' } })).status()).toBe(401);
  });
});

test.describe('customer quote', () => {
  test('renders the quotation with itemised totals and terms', async ({ page }) => {
    await page.goto(`/quote/${TOKEN}`);
    await expect(page.getByRole('heading', { name: /Repair quotation/i })).toBeVisible();
    await expect(page.getByText('Sample ThinkPad T14')).toBeVisible();
    await expect(page.getByText(/Sample part/)).toBeVisible();
    await expect(page.getByText(/Sample labour/)).toBeVisible();
    await expect(page.getByText(/Quote total/i).first()).toBeVisible();
    await expect(page.getByText(/Required deposit/i).first()).toBeVisible();
    await expect(page.getByText(/Sample repair terms for the end-to-end suite/)).toBeVisible();
  });

  test('customer approves the quote and sees the paid-to-date balance', async ({ page }) => {
    await page.goto(`/quote/${TOKEN}`);
    await page.getByRole('button', { name: /^approve/i }).click();
    await expect(page.getByText(/Your approval has been saved/i)).toBeVisible();
    await expect(page.getByText(/Approved/i).first()).toBeVisible();
    await expect(page.getByText(/Paid so far/i).first()).toBeVisible();
  });

  test('an unknown token shows a recoverable error', async ({ page }) => {
    await page.goto('/quote/this-token-does-not-exist-000000');
    await expect(page.getByText(/Try again/i).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Repair quotation/i })).toHaveCount(0);
  });
});

test.describe('api contract', () => {
  test('health reports up and the public quote route stays open', async ({ request }) => {
    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'up' });

    const quote = await request.get(`/api/quotes/public/${TOKEN}`);
    expect(quote.ok()).toBeTruthy();
    const body = await quote.json();
    expect(body.quote.status).toBe('approved');
    expect(body.payments.total_paid).toBeGreaterThanOrEqual(0);
  });

  test('an unknown approval token cannot approve anything', async ({ request }) => {
    const response = await request.post('/api/quotes/public/unknown-token-000000000000/approve', { data: {} });
    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({ error: 'Quote not found.' });
  });

  test('approving twice stays idempotent', async ({ request }) => {
    const again = await request.post(`/api/quotes/public/${TOKEN}/approve`, { data: {} });
    expect(again.status()).toBe(200);
    expect(await again.json()).toMatchObject({ success: true });
  });
});
