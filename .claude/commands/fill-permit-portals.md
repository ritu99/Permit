---
name: fill-permit-portals
description: Batch process cities CSV to find permit portal software using the permit-portal-finder agent
---

# Fill Permit Portals Task

You need to add a "Permit_Portal" column to `/Users/ritvik/Permits/top_6000_cities.csv` by researching what permit software each city uses.

## Instructions

1. Read the CSV at `/Users/ritvik/Permits/top_6000_cities.csv`
2. For each city, use @permit-portal-finder to find their permit portal software
3. Add results to a new "Permit_Portal" column
4. Save progress incrementally to avoid data loss

## Batch Processing Strategy

- Process cities in batches of 5-10 in parallel using the Task tool
- After each batch, append results to a results file
- Track which cities have been processed to enable resume capability
- Start with the largest cities (they're already sorted by population)

## Output Format

For each city, the agent returns:
```
RESULT: [City], [State] | [Software Vendor] | [Portal URL]
```

Store in CSV as:
- Permit_Portal column: "[Software Vendor]"
- Optionally add Permit_URL column: "[Portal URL]"

## Resume Capability

Check if `/Users/ritvik/Permits/permit_results.csv` exists with partial results. If so, skip already-processed cities and continue from where we left off.

## Example Agent Call

For a city like "Plano, TX", spawn:
```
Use @permit-portal-finder to find the permit portal software for Plano, TX
```

## Progress Tracking

After every 50 cities, report progress:
- Cities processed: X / 6000
- Software breakdown so far (e.g., "Accela: 15, Tyler: 12, OpenGov: 8...")

Begin by reading the CSV and processing the first batch of 10 cities.
