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

## Convert PDFs to Text

```bash
# Convert all PDFs to text (skips existing .txt files)
./convert_to_text.sh

# Force re-convert all PDFs
./convert_to_text.sh --force
```

Text files are saved to `comments/txt/[PermitNumber]_Comments.txt`

## Download Options

| Flag | Description | Default |
|------|-------------|---------|
| `--csv <file>` | Process a single CSV file | - |
| `--all` | Process all CSV files in directory | - |
| `--force` | Re-download even if PDF exists | false |
| `--headed` | Show browser window | false (headless) |
| `--delay <ms>` | Delay between permits | 2000 |
| `--retries <n>` | Retry failed permits | 2 |

## Extract Structured Data

Parse the text files to extract structured permit data into JSON or CSV.

```bash
# Extract all to JSON
npx tsx extract_comments.ts --output comments/extracted.json

# Extract all to CSV
npx tsx extract_comments.ts --output comments/extracted.csv

# Single file with pretty output
npx tsx extract_comments.ts --single comments/txt/PB25-12058_Comments.txt --pretty

# Include raw text in JSON output
npx tsx extract_comments.ts --output extracted.json --include-raw
```

### Extraction Options

| Flag | Description | Default |
|------|-------------|---------|
| `--input <dir>` | Input directory with .txt files | `comments/txt` |
| `--output <file>` | Output file (.json or .csv) | stdout |
| `--format <type>` | Output format: json or csv | json |
| `--single <file>` | Process a single .txt file | - |
| `--include-raw` | Include raw text in JSON | false |
| `--pretty` | Pretty print JSON | false |

### Extracted Fields

**Application:**
- `application_number`, `status`, `date_submitted`, `date_issued`

**Property:**
- `address`, `parcel`, `zoning`, `subdivision`, `lot`, `block`

**Parties:**
- `applicant_name`, `owner_name`

**Building Classification:**
- `living_sqft` (R-3 occupancy), `garage_sqft` (U occupancy)

**Zoning Review:**
- `zoning_district`, `plat_number`, `slab_sf`, `lot_area_sf`
- `lot_coverage_max`, `lot_coverage_provided`
- `height_max`, `height_provided`
- `lot_width_min`, `lot_width_provided`
- `driveway_coverage_max`, `driveway_coverage_provided`
- `setback_front_min`, `setback_front_provided`
- `setback_side_min`, `setback_side_left_provided`, `setback_side_right_provided`
- `setback_rear_min`, `setback_rear_provided`
- `bedrooms`, `parking_required`, `parking_provided`
- `ufc_permit` (Urban Forestry)

**Third Party Review:**
- `third_party_company` (Metro Code, North Texas Inspection)
- `builder` (Lennar, Perry, DR Horton, etc.)

**Corrections:**
- `correction_count`, `has_water_corrections`, `has_zoning_corrections`, `has_pard_corrections`

**JSON-only fields:**
- Full `corrections` array with department, reviewer, and item details
- Full `approval_tasks` array with task names, statuses, dates, reviewers
- Complete `zoning_review` and `third_party_review` objects
