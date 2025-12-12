#!/bin/bash

# Convert all PDFs in comments/ to text files
# Usage: ./convert_to_text.sh [--force]

COMMENTS_DIR="$(dirname "$0")/comments"
TXT_DIR="$COMMENTS_DIR/txt"
FORCE=false

if [[ "$1" == "--force" ]]; then
  FORCE=true
fi

if [[ ! -d "$COMMENTS_DIR" ]]; then
  echo "Error: comments directory not found"
  exit 1
fi

# Create txt directory if it doesn't exist
mkdir -p "$TXT_DIR"

# Check if pdftotext is available
if ! command -v pdftotext &> /dev/null; then
  echo "Error: pdftotext not found. Install with: brew install poppler"
  exit 1
fi

converted=0
skipped=0
failed=0

for pdf in "$COMMENTS_DIR"/*.pdf; do
  [[ -f "$pdf" ]] || continue

  basename=$(basename "$pdf")
  txt="$TXT_DIR/${basename%.pdf}.txt"

  # Skip if txt already exists (unless --force)
  if [[ -f "$txt" && "$FORCE" == false ]]; then
    ((skipped++))
    continue
  fi

  if pdftotext -layout "$pdf" "$txt" 2>/dev/null; then
    echo "Converted: $basename"
    ((converted++))
  else
    echo "Failed: $basename"
    ((failed++))
  fi
done

echo ""
echo "=== Summary ==="
echo "Converted: $converted"
echo "Skipped:   $skipped"
echo "Failed:    $failed"
