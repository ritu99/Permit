import { program } from "commander";
import * as fs from "fs";
import * as path from "path";

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);
const TXT_DIR = path.join(SCRIPT_DIR, "comments", "txt");

// ============================================================================
// Types
// ============================================================================

interface Application {
  number: string;
  status: string;
  date_submitted: string | null;
  date_issued: string | null;
}

interface Property {
  address: string;
  parcel: string | null;
  zoning: string | null;
  subdivision: string | null;
  lot: string | null;
  block: string | null;
}

interface Party {
  name: string | null;
  address: string | null;
  phone: string | null;
}

interface BuildingClass {
  occupancy_class: string;
  construction_type: string;
  square_feet: number | null;
  occupancy_load: number | null;
  use_description: string;
}

interface DimensionalValue {
  maximum: number | null;
  provided: number | null;
}

interface Setbacks {
  front: DimensionalValue | null;
  side_left: DimensionalValue | null;
  side_right: DimensionalValue | null;
  rear: DimensionalValue | null;
}

interface Parking {
  bedrooms: number | null;
  required: number | null;
  provided: number | null;
}

interface ZoningReview {
  zoning_district: string | null;
  plat_name: string | null;
  plat_number: string | null;
  slab_sf: number | null;
  lot_area_sf: number | null;
  lot_coverage: DimensionalValue | null;
  height: DimensionalValue | null;
  lot_width: DimensionalValue | null;
  driveway_coverage: DimensionalValue | null;
  setbacks: Setbacks | null;
  parking: Parking | null;
  ufc_permit: string | null;
}

interface Reviewer {
  name: string | null;
  email: string | null;
  phone: string | null;
}

interface CorrectionItem {
  number: number;
  date: string | null;
  text: string;
}

interface CorrectionBlock {
  department: string;
  reviewer: Reviewer;
  items: CorrectionItem[];
}

interface ApprovalTask {
  task_name: string;
  status: string;
  completed_date: string | null;
  reviewer_name: string | null;
}

interface ThirdPartyReview {
  company: string | null;
  plan_review_date: string | null;
  reviewed_by: string | null;
  tenant_builder: string | null;
}

interface PermitComments {
  application: Application;
  property: Property;
  description_of_work: string | null;
  applicant: Party;
  owner: Party;
  building_classification: BuildingClass[];
  corrections: CorrectionBlock[];
  approval_tasks: ApprovalTask[];
  zoning_review: ZoningReview | null;
  third_party_review: ThirdPartyReview | null;
  raw_text?: string;
}

// ============================================================================
// Parsing Helpers
// ============================================================================

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function parseDate(text: string | null): string | null {
  if (!text) return null;
  // Match MM/DD/YYYY or M/D/YYYY
  const match = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (match) {
    const [, month, day, year] = match;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return null;
}

function parseNumber(text: string | null): number | null {
  if (!text) return null;
  const cleaned = text.replace(/[,%]/g, "").trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

function parseFeet(text: string | null): number | null {
  if (!text) return null;
  // Handle formats like "20' 3"", "20.5'", "20", "20' 0"", "20.50'"
  const match = text.match(/(\d+(?:\.\d+)?)\s*['']?\s*(\d+(?:\.\d+)?)?\s*[""]?/);
  if (match) {
    let feet = parseFloat(match[1]);
    if (match[2]) {
      feet += parseFloat(match[2]) / 12; // Convert inches to feet
    }
    return Math.round(feet * 100) / 100;
  }
  return null;
}

function parsePercent(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (match) {
    return parseFloat(match[1]);
  }
  // Sometimes just a number without %
  const num = parseFloat(text);
  return isNaN(num) ? null : num;
}

// ============================================================================
// Main Parsing Functions
// ============================================================================

function parseHeader(content: string): { application: Application; property: Property } {
  const lines = content.split("\n");

  // Application number
  const appMatch = content.match(/Application:\s*(PB\d+-\d+)/i);
  const statusMatch = content.match(/Status:\s*([A-Za-z\s]+?)(?:\s{2,}|Date|$)/i);
  const submittedMatch = content.match(/Date Submitted:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const issuedMatch = content.match(/Date Issued:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);

  // Property info
  const addressMatch = content.match(/Address:\s*(.+?)(?:\n|Parcel)/is);
  const parcelMatch = content.match(/Parcel:\s*(\d+)/i);
  const zoningMatch = content.match(/Zoning:\s*([A-Z0-9-]+)/i);
  const subdivisionMatch = content.match(/Subdivision:\s*([A-Za-z][A-Za-z0-9\s]+?)(?:\s{2,}|Lot\/Block|\n)/i);
  const lotBlockMatch = content.match(/Lot\/Block:\s*([^\/\s]+)\s*\/\s*([^\s\n]+)/i);

  return {
    application: {
      number: appMatch?.[1] || "",
      status: cleanText(statusMatch?.[1] || ""),
      date_submitted: parseDate(submittedMatch?.[1] || null),
      date_issued: parseDate(issuedMatch?.[1] || null),
    },
    property: {
      address: cleanText(addressMatch?.[1] || ""),
      parcel: parcelMatch?.[1] || null,
      zoning: zoningMatch?.[1] || null,
      subdivision: cleanText(subdivisionMatch?.[1] || "") || null,
      lot: lotBlockMatch?.[1] || null,
      block: lotBlockMatch?.[2] || null,
    },
  };
}

function parseDescriptionOfWork(content: string): string | null {
  const match = content.match(/Description of Work:\s*(.+?)(?:\n\s*\n|ADA TDLR)/is);
  if (match) {
    return cleanText(match[1]);
  }
  return null;
}

function parseApplicantOwner(content: string): { applicant: Party; owner: Party } {
  // This section has a specific format with applicant on left, owner on right
  const applicantMatch = content.match(/Applicant:\s*(.+?)(?:\s{2,}Owner:|$)/is);
  const ownerMatch = content.match(/Owner:\s*(.+?)(?:\n[A-Z][a-z]+:|Building Classification)/is);

  const parseParty = (text: string | null): Party => {
    if (!text) return { name: null, address: null, phone: null };
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const phoneMatch = text.match(/(\d{10}|\d{3}-\d{3}-\d{4}|\(\d{3}\)\s*\d{3}-\d{4})/);
    return {
      name: lines[0] || null,
      address: lines.slice(1).filter((l) => !l.match(/^\d{10}$/)).join(", ") || null,
      phone: phoneMatch?.[1] || null,
    };
  };

  return {
    applicant: parseParty(applicantMatch?.[1] || null),
    owner: parseParty(ownerMatch?.[1] || null),
  };
}

function parseBuildingClassification(content: string): BuildingClass[] {
  const classes: BuildingClass[] = [];

  // Find the building classification table
  const tableMatch = content.match(
    /Building Classification:[\s\S]*?Occ Class\s+Const Type\s+Square Feet\s+Occ Load\s+Use Description([\s\S]*?)(?:Sprinkler|Comment:|Required Corrections)/i
  );

  if (tableMatch) {
    const tableContent = tableMatch[1];
    // Match rows like: R-3    VB    1604    8    LIVING SPACE
    const rowRegex = /([RU]-?\d*|U)\s+(VB|VA|IIIA|IIIB|IIA|IIB|IA|IB)\s+(\d+)\s*(\d*)\s+([A-Za-z\s\/]+)/g;
    let match;
    while ((match = rowRegex.exec(tableContent)) !== null) {
      classes.push({
        occupancy_class: match[1].trim(),
        construction_type: match[2].trim(),
        square_feet: parseNumber(match[3]),
        occupancy_load: match[4] ? parseNumber(match[4]) : null,
        use_description: cleanText(match[5]),
      });
    }
  }

  return classes;
}

function parseCorrections(content: string): CorrectionBlock[] {
  const corrections: CorrectionBlock[] = [];

  // Find the Required Corrections section
  const correctionsMatch = content.match(
    /Required Corrections:([\s\S]*?)(?:Approval Table:|General Comments)/i
  );

  if (!correctionsMatch) return corrections;

  const correctionsContent = correctionsMatch[1];

  // Split by department headers (e.g., "Water\nReviewer:", "Building\nReviewer:")
  const deptRegex = /^([A-Za-z\s]+)\nReviewer:\s*(.+?)(?:\n|$)Email:\s*(.+?)(?:\n|$)Phone:\s*(.*?)(?:\n|$)([\s\S]*?)(?=^[A-Za-z\s]+\nReviewer:|$)/gm;

  // Simpler approach: look for Reviewer blocks
  const blocks = correctionsContent.split(/(?=^[A-Za-z][A-Za-z\s]*\nReviewer:)/m);

  for (const block of blocks) {
    if (!block.trim()) continue;

    const deptMatch = block.match(/^([A-Za-z][A-Za-z\s]*)\nReviewer:\s*(.+)/m);
    if (!deptMatch) continue;

    const department = cleanText(deptMatch[1]);
    const reviewerName = cleanText(deptMatch[2]);

    const emailMatch = block.match(/Email:\s*(.+?)(?:\n|$)/i);
    const phoneMatch = block.match(/Phone:\s*(.+?)(?:\n|$)/i);

    const items: CorrectionItem[] = [];

    // Find numbered items (e.g., "1. text" or "1. 08/15/25 - text")
    const itemRegex = /^\s*(\d+)\.\s*(?:(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–—]?\s*)?([\s\S]*?)(?=^\s*\d+\.|^[A-Za-z]+\nReviewer:|$)/gm;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(block)) !== null) {
      const itemText = cleanText(itemMatch[3]);
      if (itemText) {
        items.push({
          number: parseInt(itemMatch[1]),
          date: itemMatch[2] ? parseDate(itemMatch[2]) : null,
          text: itemText,
        });
      }
    }

    if (items.length > 0 || department) {
      corrections.push({
        department,
        reviewer: {
          name: reviewerName || null,
          email: cleanText(emailMatch?.[1] || "") || null,
          phone: cleanText(phoneMatch?.[1] || "") || null,
        },
        items,
      });
    }
  }

  return corrections;
}

function parseApprovalTable(content: string): ApprovalTask[] {
  const tasks: ApprovalTask[] = [];

  // Find the approval table section
  const tableMatch = content.match(
    /Approval Table:[\s\S]*?Task Name\s+Task Status\s+Completed Date\s+Task Rev Name([\s\S]*?)(?:General Comments|$)/i
  );

  if (!tableMatch) return tasks;

  const tableContent = tableMatch[1];
  const lines = tableContent.split("\n");

  // Process lines - task names can span multiple "words"
  const taskRegex = /^([A-Za-z][A-Za-z\s&\/]+?)\s{2,}(Approved|Not Required|Routed for Electronic Review|Issued|Opt-Out|Corrections Required|Finaled|Close|Pending)\s+(\d{1,2}\/\d{1,2}\/\d{4})?\s*(.*)$/;

  for (const line of lines) {
    const match = line.match(taskRegex);
    if (match) {
      tasks.push({
        task_name: cleanText(match[1]),
        status: cleanText(match[2]),
        completed_date: parseDate(match[3] || null),
        reviewer_name: cleanText(match[4]) || null,
      });
    }
  }

  return tasks;
}

function parseZoningReview(content: string): ZoningReview | null {
  // Look for Zoning Plans Exam section - expand search area
  const zoningMatch = content.match(/Zoning Plans Exam([\s\S]*?)(?:INFORMATION BLOCK|end ZONING|Planning Development Department[\s\S]{0,100}Planning Development Department|$)/i);

  if (!zoningMatch) return null;

  const zoningContent = zoningMatch[1];

  // Parse individual fields - zoning district (stop at "Type of layout" or newline)
  const zoningDistrictMatch = zoningContent.match(/Zoning district:\s*[""]?([A-Z0-9\s-]+?)(?:[""]|\s+Type of|\n)/i);
  const platNameMatch = zoningContent.match(/Official Plat:.*?\(([^)]+)\)/i);
  const platNumberMatch = zoningContent.match(/(FP-\d+-\d+)/i);

  const slabMatch = zoningContent.match(/Slab SF:\s*([\d,]+)/i);
  const lotAreaMatch = zoningContent.match(/Lot Area(?:\s*SF)?:\s*([\d,.]+)/i);

  // Lot coverage: various formats like "55% maximum... (Provided 19%)" or "50% maximum: 35.50%"
  let lotCoverageMax: number | null = null;
  let lotCoverageProv: number | null = null;
  const lotCovMatch1 = zoningContent.match(/Lot coverage:\s*(\d+)%?\s*maximum[\s\S]*?\(Provided\s*([\d.]+)%?\)/i);
  const lotCovMatch2 = zoningContent.match(/Lot coverage:\s*(\d+)%?\s*maximum[:\s"]*([\d.]+)%/i);
  const lotCovMatch3 = zoningContent.match(/coverage[:\s]+(\d+)%?\s*maximum[\s\S]*?(?:Provided|at)\s*([\d.]+)%/i);
  if (lotCovMatch1) {
    lotCoverageMax = parsePercent(lotCovMatch1[1]);
    lotCoverageProv = parsePercent(lotCovMatch1[2]);
  } else if (lotCovMatch2) {
    lotCoverageMax = parsePercent(lotCovMatch2[1]);
    lotCoverageProv = parsePercent(lotCovMatch2[2]);
  } else if (lotCovMatch3) {
    lotCoverageMax = parsePercent(lotCovMatch3[1]);
    lotCoverageProv = parsePercent(lotCovMatch3[2]);
  }

  // Height: "35' maximum (Provided: 23' 0")" or "35' maximum " Provided 17.79'"
  let heightMax: number | null = null;
  let heightProv: number | null = null;
  const heightMatch1 = zoningContent.match(/Height:\s*(\d+)['']?\s*maximum[\s\S]*?\(Provided[:\s]*([\d'"\s.]+)\)/i);
  const heightMatch2 = zoningContent.match(/Height:\s*(\d+)['']?\s*maximum[:\s"]+(?:Provided\s*)?([\d'"\s.]+)/i);
  if (heightMatch1) {
    heightMax = parseFeet(heightMatch1[1]);
    heightProv = parseFeet(heightMatch1[2]);
  } else if (heightMatch2) {
    heightMax = parseFeet(heightMatch2[1]);
    heightProv = parseFeet(heightMatch2[2]);
  }

  // Lot width: "50' minimum at building line (Provided 64.87')" or "50' minimum at building line: __50.00'__"
  let lotWidthMin: number | null = null;
  let lotWidthProv: number | null = null;
  const lotWidthMatch1 = zoningContent.match(/Lot Width:\s*(\d+)['']?\s*minimum[\s\S]*?\(Provided\s*([\d'.]+)\)/i);
  const lotWidthMatch2 = zoningContent.match(/Lot Width:\s*(\d+)['']?\s*minimum[^:]*:[:\s_]*([\d'.]+)/i);
  if (lotWidthMatch1) {
    lotWidthMin = parseFeet(lotWidthMatch1[1]);
    lotWidthProv = parseFeet(lotWidthMatch1[2]);
  } else if (lotWidthMatch2) {
    lotWidthMin = parseFeet(lotWidthMatch2[1]);
    lotWidthProv = parseFeet(lotWidthMatch2[2]);
  }

  // Driveway coverage
  let drivewayMax: number | null = null;
  let drivewayProv: number | null = null;
  const drivewayMatch1 = zoningContent.match(/driveway coverage:\s*(\d+)%?\s*maximum[\s\S]*?\(Provided\s*([\d.]+)%?\)/i);
  const drivewayMatch2 = zoningContent.match(/driveway coverage:\s*(\d+)%?\s*maximum[:\s"]*([\d.]+)%?/i);
  if (drivewayMatch1) {
    drivewayMax = parsePercent(drivewayMatch1[1]);
    drivewayProv = parsePercent(drivewayMatch1[2]);
  } else if (drivewayMatch2) {
    drivewayMax = parsePercent(drivewayMatch2[1]);
    drivewayProv = parsePercent(drivewayMatch2[2]);
  }

  // Setbacks - multiple formats
  // Front: "20' platted setback (Provided _26' 8")" or "20' minimum : 20.50'" or "20' minimum (provided _20' 0"_)"
  let frontMin: number | null = null;
  let frontProv: number | null = null;
  const frontMatch1 = zoningContent.match(/Front:\s*(\d+)['']?\s*(?:minimum|platted)[^(]*\(Provided[:\s_]*([\d'"\s.½]+)\)/i);
  const frontMatch2 = zoningContent.match(/Front:\s*(\d+)['']?\s*(?:minimum|platted)[^:]*:[:\s_]*([\d'"\s.½]+)/i);
  if (frontMatch1) {
    frontMin = parseFeet(frontMatch1[1]);
    frontProv = parseFeet(frontMatch1[2]);
  } else if (frontMatch2) {
    frontMin = parseFeet(frontMatch2[1]);
    frontProv = parseFeet(frontMatch2[2]);
  }

  // Sides: "5' minimum interior lot... (Provided 8' 3½" & 6' 8")" or "5' minimum... Left: 10.04' / Right 10.04'"
  let sideMin: number | null = null;
  let sideLeftProv: number | null = null;
  let sideRightProv: number | null = null;
  const sidesMatch1 = zoningContent.match(/Sides?:\s*(\d+)['']?\s*minimum[^(]*\(Provided\s*([\d'"\s.½]+)\s*[&,]\s*([\d'"\s.½]+)\)/i);
  const sidesMatch2 = zoningContent.match(/Sides?:\s*(\d+)['']?\s*minimum[^L]*Left[:\s]*([\d'"\s.½]+)[^R]*Right[:\s]*([\d'"\s.½]+)/i);
  if (sidesMatch1) {
    sideMin = parseFeet(sidesMatch1[1]);
    sideLeftProv = parseFeet(sidesMatch1[2]);
    sideRightProv = parseFeet(sidesMatch1[3]);
  } else if (sidesMatch2) {
    sideMin = parseFeet(sidesMatch2[1]);
    sideLeftProv = parseFeet(sidesMatch2[2]);
    sideRightProv = parseFeet(sidesMatch2[3]);
  }

  // Rear: "5' minimum (Provided _41' 4½")" or "5' minimum: 20.38'"
  let rearMin: number | null = null;
  let rearProv: number | null = null;
  const rearMatch1 = zoningContent.match(/Rear:\s*(\d+)['']?\s*minimum[^(]*\(Provided[:\s_]*([\d'"\s.½]+)\)/i);
  const rearMatch2 = zoningContent.match(/Rear:\s*(\d+)['']?\s*minimum[:\s_]*([\d'"\s.½]+)/i);
  if (rearMatch1) {
    rearMin = parseFeet(rearMatch1[1]);
    rearProv = parseFeet(rearMatch1[2]);
  } else if (rearMatch2) {
    rearMin = parseFeet(rearMatch2[1]);
    rearProv = parseFeet(rearMatch2[2]);
  }

  // Parking: "# Bedrooms: _3_ Parking spaces required _2 provided _4_" or "# bedrooms: 3 # parking spaces required 2 parking spaces provided: 4"
  const bedroomsMatch = zoningContent.match(/#\s*[Bb]edrooms?:\s*[_]?(\d+)/i);
  const parkingReqMatch = zoningContent.match(/(?:parking\s+)?spaces\s+required[:\s_]*(\d+)/i);
  // Be more specific to avoid matching "(Provided 19%)" etc
  const parkingProvMatch = zoningContent.match(/(?:parking\s+)?spaces\s+provided[:\s_]*(\d+)/i);

  // UFC
  const ufcMatch = zoningContent.match(/UFC[#\s-]*(\d+-\d+)/i);

  return {
    zoning_district: cleanText(zoningDistrictMatch?.[1] || "") || null,
    plat_name: cleanText(platNameMatch?.[1] || "") || null,
    plat_number: platNumberMatch?.[1] || null,
    slab_sf: parseNumber(slabMatch?.[1] || null),
    lot_area_sf: parseNumber(lotAreaMatch?.[1] || null),
    lot_coverage: (lotCoverageMax !== null || lotCoverageProv !== null)
      ? { maximum: lotCoverageMax, provided: lotCoverageProv }
      : null,
    height: (heightMax !== null || heightProv !== null)
      ? { maximum: heightMax, provided: heightProv }
      : null,
    lot_width: (lotWidthMin !== null || lotWidthProv !== null)
      ? { maximum: lotWidthMin, provided: lotWidthProv }
      : null,
    driveway_coverage: (drivewayMax !== null || drivewayProv !== null)
      ? { maximum: drivewayMax, provided: drivewayProv }
      : null,
    setbacks: {
      front: (frontMin !== null || frontProv !== null)
        ? { maximum: frontMin, provided: frontProv }
        : null,
      side_left: (sideMin !== null || sideLeftProv !== null)
        ? { maximum: sideMin, provided: sideLeftProv }
        : null,
      side_right: (sideMin !== null || sideRightProv !== null)
        ? { maximum: sideMin, provided: sideRightProv }
        : null,
      rear: (rearMin !== null || rearProv !== null)
        ? { maximum: rearMin, provided: rearProv }
        : null,
    },
    parking: {
      bedrooms: parseNumber(bedroomsMatch?.[1] || null),
      required: parseNumber(parkingReqMatch?.[1] || null),
      provided: parseNumber(parkingProvMatch?.[1] || null),
    },
    ufc_permit: ufcMatch?.[1] || null,
  };
}

function parseThirdPartyReview(content: string): ThirdPartyReview | null {
  // Look for INFORMATION BLOCK (Metro Code style)
  const infoMatch = content.match(/INFORMATION BLOCK([\s\S]*?)(?:BUILDING|ELECTRICAL|$)/i);

  if (!infoMatch) return null;

  const infoContent = infoMatch[1];

  const dateMatch = infoContent.match(/Plan Review Performed On:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  const byMatch = infoContent.match(/By:\s*([^\d\n]+)/i);
  const tenantMatch = infoContent.match(/Name of Tenant:\s*(.+?)(?:\n|$)/i);

  // Determine company from context
  let company: string | null = null;
  if (content.includes("METRO CODE") || content.includes("metrocode.com")) {
    company = "Metro Code Analysis";
  } else if (content.includes("NORTH TEXAS") || content.includes("ntispros.com")) {
    company = "North Texas Inspection Services";
  }

  if (!dateMatch && !byMatch && !tenantMatch) return null;

  return {
    company,
    plan_review_date: parseDate(dateMatch?.[1] || null),
    reviewed_by: cleanText(byMatch?.[1] || "") || null,
    tenant_builder: cleanText(tenantMatch?.[1] || "") || null,
  };
}

function parsePermitComments(content: string, includeRaw: boolean = false): PermitComments {
  const { application, property } = parseHeader(content);
  const { applicant, owner } = parseApplicantOwner(content);

  const result: PermitComments = {
    application,
    property,
    description_of_work: parseDescriptionOfWork(content),
    applicant,
    owner,
    building_classification: parseBuildingClassification(content),
    corrections: parseCorrections(content),
    approval_tasks: parseApprovalTable(content),
    zoning_review: parseZoningReview(content),
    third_party_review: parseThirdPartyReview(content),
  };

  if (includeRaw) {
    result.raw_text = content;
  }

  return result;
}

// ============================================================================
// File Processing
// ============================================================================

function getTxtFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => path.join(dir, f))
    .sort();
}

function processFile(filepath: string, includeRaw: boolean): PermitComments | null {
  try {
    const content = fs.readFileSync(filepath, "utf-8");
    return parsePermitComments(content, includeRaw);
  } catch (error) {
    console.error(`Error processing ${filepath}: ${error}`);
    return null;
  }
}

// ============================================================================
// CSV Export
// ============================================================================

function toCSV(permits: PermitComments[]): string {
  const headers = [
    "application_number",
    "status",
    "date_submitted",
    "date_issued",
    "address",
    "parcel",
    "zoning",
    "subdivision",
    "lot",
    "block",
    "description_of_work",
    "applicant_name",
    "owner_name",
    "living_sqft",
    "garage_sqft",
    "zoning_district",
    "plat_number",
    "slab_sf",
    "lot_area_sf",
    "lot_coverage_max",
    "lot_coverage_provided",
    "height_max",
    "height_provided",
    "lot_width_min",
    "lot_width_provided",
    "driveway_coverage_max",
    "driveway_coverage_provided",
    "setback_front_min",
    "setback_front_provided",
    "setback_side_min",
    "setback_side_left_provided",
    "setback_side_right_provided",
    "setback_rear_min",
    "setback_rear_provided",
    "bedrooms",
    "parking_required",
    "parking_provided",
    "ufc_permit",
    "third_party_company",
    "builder",
    "correction_count",
    "has_water_corrections",
    "has_zoning_corrections",
    "has_pard_corrections",
  ];

  const escapeCSV = (val: unknown): string => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = permits.map((p) => {
    const living = p.building_classification.find((c) => c.occupancy_class === "R-3");
    const garage = p.building_classification.find((c) => c.occupancy_class === "U");

    const correctionDepts = p.corrections.map((c) => c.department.toLowerCase());
    const totalCorrectionItems = p.corrections.reduce((sum, c) => sum + c.items.length, 0);

    return [
      p.application.number,
      p.application.status,
      p.application.date_submitted,
      p.application.date_issued,
      p.property.address,
      p.property.parcel,
      p.property.zoning,
      p.property.subdivision,
      p.property.lot,
      p.property.block,
      p.description_of_work,
      p.applicant.name,
      p.owner.name,
      living?.square_feet,
      garage?.square_feet,
      p.zoning_review?.zoning_district,
      p.zoning_review?.plat_number,
      p.zoning_review?.slab_sf,
      p.zoning_review?.lot_area_sf,
      p.zoning_review?.lot_coverage?.maximum,
      p.zoning_review?.lot_coverage?.provided,
      p.zoning_review?.height?.maximum,
      p.zoning_review?.height?.provided,
      p.zoning_review?.lot_width?.maximum,
      p.zoning_review?.lot_width?.provided,
      p.zoning_review?.driveway_coverage?.maximum,
      p.zoning_review?.driveway_coverage?.provided,
      p.zoning_review?.setbacks?.front?.maximum,
      p.zoning_review?.setbacks?.front?.provided,
      p.zoning_review?.setbacks?.side_left?.maximum,
      p.zoning_review?.setbacks?.side_left?.provided,
      p.zoning_review?.setbacks?.side_right?.provided,
      p.zoning_review?.setbacks?.rear?.maximum,
      p.zoning_review?.setbacks?.rear?.provided,
      p.zoning_review?.parking?.bedrooms,
      p.zoning_review?.parking?.required,
      p.zoning_review?.parking?.provided,
      p.zoning_review?.ufc_permit,
      p.third_party_review?.company,
      p.third_party_review?.tenant_builder,
      totalCorrectionItems,
      correctionDepts.includes("water"),
      correctionDepts.includes("zoning"),
      correctionDepts.includes("pard"),
    ].map(escapeCSV);
  });

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  program
    .option("--input <dir>", "Input directory with .txt files", TXT_DIR)
    .option("--output <file>", "Output file (JSON or CSV based on extension)")
    .option("--format <type>", "Output format: json or csv", "json")
    .option("--single <file>", "Process a single .txt file")
    .option("--include-raw", "Include raw text in JSON output")
    .option("--pretty", "Pretty print JSON output")
    .parse();

  const opts = program.opts();

  let files: string[] = [];

  if (opts.single) {
    const filepath = path.isAbsolute(opts.single)
      ? opts.single
      : path.join(process.cwd(), opts.single);
    if (!fs.existsSync(filepath)) {
      console.error(`Error: File not found: ${filepath}`);
      process.exit(1);
    }
    files = [filepath];
  } else {
    const inputDir = path.isAbsolute(opts.input)
      ? opts.input
      : path.join(process.cwd(), opts.input);
    files = getTxtFiles(inputDir);
    if (files.length === 0) {
      console.error(`Error: No .txt files found in ${inputDir}`);
      process.exit(1);
    }
  }

  console.log(`Processing ${files.length} file(s)...`);

  const permits: PermitComments[] = [];
  let successCount = 0;
  let errorCount = 0;

  for (const file of files) {
    const result = processFile(file, opts.includeRaw);
    if (result) {
      permits.push(result);
      successCount++;
    } else {
      errorCount++;
    }
  }

  console.log(`Processed: ${successCount} success, ${errorCount} errors`);

  // Determine output format
  const format = opts.output?.endsWith(".csv") ? "csv" : opts.format;

  let output: string;
  if (format === "csv") {
    output = toCSV(permits);
  } else {
    output = opts.pretty
      ? JSON.stringify(permits, null, 2)
      : JSON.stringify(permits);
  }

  // Write output
  if (opts.output) {
    const outputPath = path.isAbsolute(opts.output)
      ? opts.output
      : path.join(process.cwd(), opts.output);
    fs.writeFileSync(outputPath, output);
    console.log(`Output written to: ${outputPath}`);
  } else {
    console.log(output);
  }

  // Print summary statistics
  if (permits.length > 0) {
    console.log("\n--- Summary Statistics ---");
    console.log(`Total permits: ${permits.length}`);

    const statuses = permits.reduce((acc, p) => {
      acc[p.application.status] = (acc[p.application.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log("By status:", statuses);

    const withCorrections = permits.filter((p) => p.corrections.some((c) => c.items.length > 0)).length;
    console.log(`With corrections: ${withCorrections} (${((withCorrections / permits.length) * 100).toFixed(1)}%)`);

    const avgLivingSqft = permits
      .map((p) => p.building_classification.find((c) => c.occupancy_class === "R-3")?.square_feet)
      .filter((v): v is number => v !== null && v !== undefined);
    if (avgLivingSqft.length > 0) {
      const avg = avgLivingSqft.reduce((a, b) => a + b, 0) / avgLivingSqft.length;
      console.log(`Avg living sqft: ${Math.round(avg)}`);
    }
  }
}

main().catch(console.error);
