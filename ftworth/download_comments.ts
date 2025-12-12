import { chromium, Page, BrowserContext } from "playwright";
import { parse } from "csv-parse/sync";
import { program } from "commander";
import * as fs from "fs";
import * as path from "path";

const BASE_URL =
  "https://aca-prod.accela.com/CFW/Cap/CapHome.aspx?module=Development&TabName=Development&TabList=Home%7C0%7CDevelopment%7C1%7CFire%7C2%7CGasWell%7C3%7CPlanning%7C4%7CStreetUse%7C5%7CInfrastructure%7C6%7CLicenses%7C7%7CWater%7C8%7CCurrentTabIndex%7C1";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const COMMENTS_DIR = path.join(SCRIPT_DIR, "comments");

interface PermitRecord {
  "Permit Number": string;
  [key: string]: string;
}

// Store for captured PDFs (used by route interceptor)
let capturedPdf: Buffer | null = null;

function parseCSV(filepath: string): string[] {
  const content = fs.readFileSync(filepath, "utf-8");
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
  }) as PermitRecord[];

  return records
    .map((r) => r["Permit Number"])
    .filter((p) => p && p.trim() !== "" && !p.includes("TMP"));
}

function getCSVFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".csv"))
    .map((f) => path.join(dir, f))
    .sort();
}

function pdfExists(permitNumber: string): boolean {
  const pdfPath = path.join(COMMENTS_DIR, `${permitNumber}_Comments.pdf`);
  return fs.existsSync(pdfPath);
}

async function searchPermit(page: Page, permitNumber: string): Promise<boolean> {
  try {
    // Check if we're already on the search page, if not navigate there
    const currentUrl = page.url();
    if (!currentUrl.includes("CapHome.aspx") || currentUrl.includes("CapDetail.aspx")) {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    }

    // Wait for the search form to be ready
    const permitInput = page.locator('#ctl00_PlaceHolderMain_generalSearchForm_txtGSPermitNumber');
    await permitInput.waitFor({ state: "visible", timeout: 15000 });

    // Clear and fill the permit number
    await permitInput.clear();
    await permitInput.fill(permitNumber);

    // Click search button
    const searchButton = page.locator('#ctl00_PlaceHolderMain_btnNewSearch');
    await searchButton.click();

    // Wait for navigation - check URL change to CapDetail.aspx (most reliable indicator)
    try {
      await page.waitForURL(/CapDetail\.aspx/, { timeout: 15000 });
      return true; // Successfully navigated to detail page
    } catch {
      // URL didn't change to detail page - check for other outcomes
    }

    // Check if we got "no matching records" message
    const noResultsIndicator = page.locator('text="No matching records found"').first();
    const hasNoResults = await noResultsIndicator.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasNoResults) {
      console.log(`  No results found for ${permitNumber}`);
      return false;
    }

    // Check if there are search results to click
    const searchResultsLink = page.locator(`a:has-text("${permitNumber}")`).first();
    const hasResults = await searchResultsLink.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasResults) {
      await searchResultsLink.click();
      try {
        await page.waitForURL(/CapDetail\.aspx/, { timeout: 10000 });
        return true;
      } catch {
        // Fall through to final check
      }
    }

    // Final check - are we on the detail page?
    if (page.url().includes("CapDetail.aspx")) {
      return true;
    }

    console.log(`  No results found for ${permitNumber}`);
    return false;
  } catch (error) {
    console.log(`  Error searching for ${permitNumber}: ${error}`);
    return false;
  }
}

async function downloadComments(
  page: Page,
  context: BrowserContext,
  permitNumber: string
): Promise<boolean> {
  let popup: Page | null = null;
  try {
    // Look for "View Conditions/Comments" button (green button at bottom of page)
    const conditionsButton = page.locator('a:has-text("View Conditions/Comments")').first();

    const buttonVisible = await conditionsButton
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (!buttonVisible) {
      console.log(`  No "View Conditions/Comments" button found for ${permitNumber}`);
      return false;
    }

    // Reset captured PDF
    capturedPdf = null;

    // Listen for popup (new window/tab) that will contain the PDF viewer
    const popupPromise = context.waitForEvent("page", { timeout: 30000 });

    // Click the button
    await conditionsButton.click();

    // Wait for popup window
    popup = await popupPromise;
    await popup.waitForLoadState("networkidle").catch(() => {});
    await popup.waitForTimeout(3000); // Give time for PDF to load via route interceptor

    await popup.close().catch(() => {});
    popup = null;

    // Check if we captured a PDF via the route interceptor
    if (capturedPdf && capturedPdf.length > 1000) {
      const pdfPath = path.join(COMMENTS_DIR, `${permitNumber}_Comments.pdf`);
      fs.writeFileSync(pdfPath, capturedPdf);
      console.log(`  Saved: ${permitNumber}_Comments.pdf (${capturedPdf.length} bytes)`);

      // Navigate back to search page for next permit (faster than reloading)
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" }).catch(() => {});

      return true;
    } else {
      console.log(`  Failed to capture PDF for ${permitNumber}`);
      return false;
    }
  } catch (error) {
    console.log(`  Error downloading comments for ${permitNumber}: ${error}`);
    // Clean up popup if it was opened
    if (popup) {
      await popup.close().catch(() => {});
    }
    return false;
  }
}

interface ProcessResult {
  success: boolean;
  skipped: boolean;
  failReason?: string;
}

async function processPermit(
  page: Page,
  context: BrowserContext,
  permitNumber: string,
  force: boolean
): Promise<ProcessResult> {
  console.log(`Processing: ${permitNumber}`);

  // Check if already downloaded
  if (!force && pdfExists(permitNumber)) {
    console.log(`  Skipped (already exists)`);
    return { success: true, skipped: true };
  }

  // Search for the permit
  const found = await searchPermit(page, permitNumber);
  if (!found) {
    return { success: false, skipped: false, failReason: "not found in search" };
  }

  // Download comments PDF
  const downloaded = await downloadComments(page, context, permitNumber);
  if (!downloaded) {
    return { success: false, skipped: false, failReason: "no View Conditions/Comments button" };
  }
  return { success: true, skipped: false };
}

async function main() {
  program
    .option("--csv <file>", "Process a single CSV file")
    .option("--all", "Process all CSV files in the directory")
    .option("--force", "Re-download even if PDF already exists")
    .option("--delay <ms>", "Delay between permits in ms", "2000")
    .option("--headed", "Run with visible browser (default is headless)")
    .option("--retries <n>", "Number of retries for failed permits", "2")
    .parse();

  const opts = program.opts();

  if (!opts.csv && !opts.all) {
    console.error("Error: Must specify either --csv <file> or --all");
    process.exit(1);
  }

  // Ensure comments directory exists
  if (!fs.existsSync(COMMENTS_DIR)) {
    fs.mkdirSync(COMMENTS_DIR, { recursive: true });
  }

  // Get list of CSV files to process
  let csvFiles: string[] = [];
  if (opts.all) {
    csvFiles = getCSVFiles(SCRIPT_DIR);
  } else {
    const csvPath = path.isAbsolute(opts.csv)
      ? opts.csv
      : path.join(SCRIPT_DIR, opts.csv);
    if (!fs.existsSync(csvPath)) {
      console.error(`Error: CSV file not found: ${csvPath}`);
      process.exit(1);
    }
    csvFiles = [csvPath];
  }

  console.log(`Found ${csvFiles.length} CSV file(s) to process`);

  // Collect all permit numbers
  const allPermits: string[] = [];
  for (const csvFile of csvFiles) {
    const permits = parseCSV(csvFile);
    console.log(`  ${path.basename(csvFile)}: ${permits.length} permits`);
    allPermits.push(...permits);
  }

  // Remove duplicates
  const uniquePermits = [...new Set(allPermits)];
  console.log(`\nTotal unique permits: ${uniquePermits.length}`);

  // Launch browser (headless by default)
  const browser = await chromium.launch({ headless: !opts.headed });
  const context = await browser.newContext();

  // Set up route interceptor to capture PDF responses at context level
  await context.route("**/*", async (route) => {
    try {
      const response = await route.fetch();
      const contentType = response.headers()["content-type"] || "";

      // Capture PDF responses
      if (contentType.includes("application/pdf")) {
        const body = await response.body();
        // Verify it's a real PDF (starts with %PDF)
        if (body.length > 1000 && body[0] === 0x25 && body[1] === 0x50) {
          capturedPdf = body;
        }
      }

      await route.fulfill({ response });
    } catch (e) {
      // On timeout or error, just continue the request normally
      await route.continue().catch(() => {});
    }
  });

  const page = await context.newPage();

  const delay = parseInt(opts.delay);
  const maxRetries = parseInt(opts.retries);
  const downloaded: string[] = [];
  const skipped: string[] = [];
  const failed: { permit: string; reason: string }[] = [];

  for (let i = 0; i < uniquePermits.length; i++) {
    const permit = uniquePermits[i];
    console.log(`\n[${i + 1}/${uniquePermits.length}]`);

    let result: ProcessResult = { success: false, skipped: false };

    try {
      // Retry loop
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          console.log(`  Retry ${attempt}/${maxRetries}...`);
          await page.waitForTimeout(1000); // Brief pause before retry
        }

        result = await processPermit(page, context, permit, opts.force);

        if (result.success || result.skipped) {
          break; // Success or skipped, no need to retry
        }
      }
    } catch (error) {
      console.log(`  Unexpected error for ${permit}: ${error}`);
      result = { success: false, skipped: false, failReason: "unexpected error" };
    }

    if (result.skipped) {
      skipped.push(permit);
    } else if (result.success) {
      downloaded.push(permit);
    } else {
      failed.push({ permit, reason: result.failReason || "unknown" });
    }

    // Delay between permits (skip delay for already-downloaded files)
    if (i < uniquePermits.length - 1 && !result.skipped) {
      await page.waitForTimeout(delay);
    }
  }

  await browser.close();

  // Print summary
  console.log("\n" + "=".repeat(50));
  console.log("SUMMARY");
  console.log("=".repeat(50));
  console.log(`Total permits: ${uniquePermits.length}`);
  console.log(`Downloaded:    ${downloaded.length}`);
  console.log(`Skipped:       ${skipped.length}`);
  console.log(`Failed:        ${failed.length}`);

  if (downloaded.length > 0) {
    console.log("\n--- Downloaded ---");
    downloaded.forEach((p) => console.log(`  ${p}`));
  }

  if (failed.length > 0) {
    console.log("\n--- Failed ---");
    failed.forEach((f) => console.log(`  ${f.permit} (${f.reason})`));
  }

  // Write report to file with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const reportPath = path.join(COMMENTS_DIR, `download_report_${timestamp}.txt`);
  const reportContent = [
    `Download Report - ${new Date().toISOString()}`,
    "=".repeat(50),
    `Total permits: ${uniquePermits.length}`,
    `Downloaded: ${downloaded.length}`,
    `Skipped: ${skipped.length}`,
    `Failed: ${failed.length}`,
    "",
    "Downloaded:",
    ...downloaded.map((p) => `  ${p}`),
    "",
    "Failed:",
    ...failed.map((f) => `  ${f.permit} (${f.reason})`),
  ].join("\n");
  fs.writeFileSync(reportPath, reportContent);
  console.log(`\nReport saved to: ${reportPath}`);
}

main().catch(console.error);
