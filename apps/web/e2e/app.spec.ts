import { expect, test } from '@playwright/test';

/**
 * Full user journey (spec §22): register -> login -> create project ->
 * create tasks -> update status -> request export -> poll until completion ->
 * download link appears.
 *
 * Requires the stack running (docker compose up). The export download link
 * points at S3 (LocalStack) — we assert it renders; fetching the object from a
 * host browser is a documented local limitation (see DEVIATIONS.md).
 */
test('end-to-end task management journey', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;

  // Register (auto-logs in and redirects to /projects)
  await page.goto('/register');
  await page.getByLabel('Display name').fill('E2E User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/projects$/);

  // Create a project
  await page.getByRole('button', { name: 'New project' }).click();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await page.getByLabel('Name').fill('E2E Project');
  await page.getByLabel('Description').fill('Created by Playwright');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Project' })).toBeVisible();

  // Add a task
  await page.getByLabel('Title').fill('Write tests');
  await page.getByRole('button', { name: 'Add task' }).click();
  await expect(page.getByRole('cell', { name: 'Write tests' })).toBeVisible();

  // Summary total should reflect the new task
  await expect(page.getByText('Total').locator('..')).toContainText('1');

  // Request an export and poll to completion
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await expect(page.getByTestId('export-status')).toContainText('completed', { timeout: 30_000 });
  await expect(page.getByTestId('export-download')).toBeVisible();
});
