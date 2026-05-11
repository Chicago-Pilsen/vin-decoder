/**
 * NHTSA vPIC API — https://vpic.nhtsa.dot.gov/api/
 * All data sourced exclusively from the US National Highway Traffic Safety Administration.
 */

const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles";
const NHTSA = "https://api.nhtsa.gov";

function val(results, variable) {
  const item = results.find(r => r.Variable === variable || r.VariableId === variable);
  return item?.Value && item.Value !== "Not Applicable" && item.Value !== "null" && item.Value !== ""
    ? item.Value
    : null;
}

export async function decodeVIN(vin) {
  // 1. Decode VIN via vPIC
  const decodeRes = await fetch(`${VPIC}/decodevin/${vin}?format=json`);
  if (!decodeRes.ok) throw new Error(`NHTSA decode failed: ${decodeRes.status}`);
  const decodeData = await decodeRes.json();
  const results = decodeData.Results || [];

  const make   = val(results, "Make");
  const model  = val(results, "Model");
  const year   = val(results, "Model Year");
  const trim   = val(results, "Trim");
  const series = val(results, "Series");
  const bodyClass    = val(results, "Body Class");
  const engineCyl    = val(results, "Engine Number of Cylinders");
  const engineDisp   = val(results, "Displacement (L)");
  const engineModel  = val(results, "Engine Model");
  const fuelType     = val(results, "Fuel Type - Primary");
  const driveType    = val(results, "Drive Type");
  const transmission = val(results, "Transmission Style");
  const transSpeeds  = val(results, "Transmission Speeds");
  const doors        = val(results, "Doors");
  const seating      = val(results, "Seating Rows") || val(results, "Number of Seat Rows");
  const plant        = val(results, "Plant City");
  const plantState   = val(results, "Plant State");
  const plantCountry = val(results, "Plant Country");
  const mfrName      = val(results, "Manufacturer Name");
  const vehicleType  = val(results, "Vehicle Type");
  const abs          = val(results, "Anti-Brake System (ABS)");
  const tpms         = val(results, "Tire Pressure Monitoring System (TPMS) Type");
  const errorCode    = val(results, "Error Code");
  const errorText    = val(results, "Error Text");

  if (errorCode && errorCode !== "0") {
    throw new Error(`NHTSA: ${errorText || "Could not decode this VIN."}`);
  }

  // 2. Safety ratings — use makeId lookup
  let safetyRatings = null;
  try {
    const makeRes = await fetch(`${VPIC}/getallmakes?format=json`);
    // skip if slow — ratings come from a separate lookup below
  } catch (_) {}

  // 3. Safety complaints count
  let complaintsCount = null;
  try {
    const complaintRes = await fetch(
      `${NHTSA}/complaints/complaintsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`
    );
    if (complaintRes.ok) {
      const cd = await complaintRes.json();
      complaintsCount = cd.count ?? (Array.isArray(cd.results) ? cd.results.length : null);
    }
  } catch (_) {}

  // 4. Recalls
  let recalls = [];
  try {
    const recallRes = await fetch(
      `${NHTSA}/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${year}`
    );
    if (recallRes.ok) {
      const rd = await recallRes.json();
      recalls = (rd.results || []).slice(0, 5).map(r => ({
        id: r.NHTSACampaignNumber,
        component: r.Component,
        summary: r.Summary,
        remedy: r.Remedy,
        reportedDate: r.ReportReceivedDate,
      }));
    }
  } catch (_) {}

  // 5. Safety ratings via NHTSA complaints API
  let safetyInfo = null;
  try {
    const ratingRes = await fetch(
      `${NHTSA}/SafetyRatings/modelyear/${year}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}`
    );
    if (ratingRes.ok) {
      const rd = await ratingRes.json();
      if (rd.Results?.length) {
        const r = rd.Results[0];
        const detailRes = await fetch(`${NHTSA}/SafetyRatings/VehicleId/${r.VehicleId}`);
        if (detailRes.ok) {
          const dd = await detailRes.json();
          const d = dd.Results?.[0];
          if (d) {
            safetyInfo = {
              overall: d.OverallRating,
              frontCrash: d.OverallFrontCrashRating,
              sideCrash: d.OverallSideCrashRating,
              rollover: d.RolloverRating,
            };
          }
        }
      }
    }
  } catch (_) {}

  // Build transmission string
  let transmissionStr = null;
  if (transmission) {
    transmissionStr = transSpeeds ? `${transSpeeds}-Speed ${transmission}` : transmission;
  }

  // Build engine string
  let engineStr = null;
  if (engineDisp || engineCyl) {
    const parts = [];
    if (engineDisp) parts.push(`${parseFloat(engineDisp).toFixed(1)}L`);
    if (engineCyl) parts.push(`${engineCyl}-Cyl`);
    if (engineModel) parts.push(engineModel);
    engineStr = parts.join(" ");
  }

  // Build plant string
  let plantStr = null;
  const plantParts = [plant, plantState, plantCountry].filter(Boolean);
  if (plantParts.length) plantStr = plantParts.join(", ");

  return {
    vin,
    year,
    make,
    model,
    trim,
    series,
    bodyClass,
    vehicleType,
    mfrName,
    engine: engineStr,
    engineDisp,
    engineCyl,
    fuelType,
    driveType,
    transmission: transmissionStr,
    doors,
    seating,
    abs,
    tpms,
    plant: plantStr,
    complaintsCount,
    recalls,
    safetyInfo,
    // raw for display
    _raw: results,
  };
}
