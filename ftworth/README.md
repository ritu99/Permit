# Fort Worth Permit Comments Downloader

Downloads "Conditions/Comments" PDFs for permits from the Fort Worth Accela portal.

## Setup

```bash
# Install dependencies
npm install

# Install Playwright browser
npx playwright install chromium
```

## Usage

```bash
# Download comments for a single CSV
npx tsx download_comments.ts --csv 20251201.csv

# Download comments for all CSVs
npx tsx download_comments.ts --all

# Force re-download existing files
npx tsx download_comments.ts --csv 20251201.csv --force

# Run with visible browser (for debugging)
npx tsx download_comments.ts --csv 20251201.csv --headed

# Adjust delay between permits (default: 2000ms)
npx tsx download_comments.ts --csv 20251201.csv --delay 3000

# Adjust retry count (default: 2)
npx tsx download_comments.ts --csv 20251201.csv --retries 3
```

## CSV Files

CSV filenames represent the **first day of permits** contained in that file (e.g., `20251201.csv` contains permits starting from December 1, 2025).

CSV format:
- Column: `Permit Number` (e.g., `PB25-16985`)
- Permits with "TMP" in the number are automatically skipped

## Output

- PDFs saved to `comments/[PermitNumber]_Comments.pdf`
- Report saved to `comments/download_report_[timestamp].txt`

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--csv <file>` | Process a single CSV file | - |
| `--all` | Process all CSV files in directory | - |
| `--force` | Re-download even if PDF exists | false |
| `--headed` | Show browser window | false (headless) |
| `--delay <ms>` | Delay between permits | 2000 |
| `--retries <n>` | Retry failed permits | 2 |
