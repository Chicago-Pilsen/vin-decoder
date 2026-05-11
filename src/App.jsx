import { useState, useRef, useCallback } from "react";
import { createWorker } from "tesseract.js";
import { decodeVIN } from "./nhtsa.js";
import "./App.css";

const VIN_REGEX = /[A-HJ-NPR-Z0-9]{17}/gi;

function extractVIN(text) {
  const upper = text.toUpperCase().replace(/[O]/g, "0").replace(/[I]/g, "1").replace(/[Q]/g, "9");
  const matches = upper.match(VIN_REGEX);
  return matches ? matches[0] : null;
}

function isValidVIN(v) {
  return typeof v === "string" && v.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/i.test(v);
}

function StarRating({ value }) {
  if (!value || value === "Not Rated") return <span className="spec-val muted">Not Rated</span>;
  const n = parseInt(value);
  if (isNaN(n)) return <span className="spec-val">{value}</span>;
  return (
    <span className="star-row">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={i < n ? "star filled" : "star"}>{i < n ? "★" : "☆"}</span>
      ))}
      <span className="star-num">{value}/5</span>
    </span>
  );
}

function TPMSBadge({ type }) {
  if (!type) return <span className="spec-val muted">Unknown</span>;
  const map = {
    "Direct":   { color: "#00e096", bg: "#0f2a1a" },
    "Indirect": { color: "#e8ff3c", bg: "#1a1a0a" },
  };
  const c = map[type] || { color: "#5a6070", bg: "#111418" };
  return (
    <span style={{ background: c.bg, border: `1px solid ${c.color}`, color: c.color, padding: "3px 10px", borderRadius: "2px", fontSize: "11px", fontWeight: "700", letterSpacing: "0.1em" }}>
      {type.toUpperCase()}
    </span>
  );
}

function RecallCard({ recall, index }) {
  const [open, setOpen] = useState(false);
  const date = recall.reportedDate ? new Date(recall.reportedDate).toLocaleDateString() : null;
  return (
    <div className="recall-card">
      <button className="recall-header" onClick={() => setOpen(o => !o)}>
        <div className="recall-left">
          <span className="recall-badge">#{index + 1}</span>
          <span className="recall-component">{recall.component || "Unknown Component"}</span>
        </div>
        <div className="recall-right">
          {date && <span className="recall-date">{date}</span>}
          <span className="recall-toggle">{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open && (
        <div className="recall-body">
          {recall.id && <p className="recall-id">NHTSA Campaign #{recall.id}</p>}
          {recall.summary && <><p className="recall-section-label">SUMMARY</p><p className="recall-text">{recall.summary}</p></>}
          {recall.remedy && <><p className="recall-section-label">REMEDY</p><p className="recall-text">{recall.remedy}</p></>}
        </div>
      )}
    </div>
  );
}

function Row({ label, val }) {
  if (!val) return null;
  return (
    <div className="spec-row">
      <span className="spec-key">{label}</span>
      <span className="spec-val">{val}</span>
    </div>
  );
}

export default function App() {
  const [vin, setVin] = useState("");
  const [mode, setMode] = useState("idle"); // idle | camera | scanning
  const [cameraStream, setCameraStream] = useState(null);
  const [capturedImage, setCapturedImage] = useState(null);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [error, setError] = useState("");
  const [specs, setSpecs] = useState(null);
  const [loadingSpecs, setLoadingSpecs] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  const valid = isValidVIN(vin);

  const lookupSpecs = useCallback(async (vinStr) => {
    setLoadingSpecs(true);
    setLoadingStep("Contacting NHTSA vPIC…");
    setError("");
    setSpecs(null);
    try {
      setLoadingStep("Decoding VIN structure…");
      const data = await decodeVIN(vinStr);
      setSpecs(data);
    } catch (e) {
      setError(e.message || "NHTSA lookup failed. Check your connection and try again.");
    } finally {
      setLoadingSpecs(false);
      setLoadingStep("");
    }
  }, []);

  const handleVinChange = (e) => {
    const raw = e.target.value.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17);
    setVin(raw);
    setError("");
    setSpecs(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && isValidVIN(vin)) lookupSpecs(vin);
  };

  // Handle paste — extract VIN from pasted text even if it contains dashes/spaces
  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text");
    const cleaned = pasted.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
    const extracted = extractVIN(cleaned) || cleaned.slice(0, 17);
    if (extracted) {
      setVin(extracted);
      setError("");
      setSpecs(null);
      if (isValidVIN(extracted)) {
        setTimeout(() => lookupSpecs(extracted), 50);
      }
    }
  };

  const openGallery = () => fileInputRef.current?.click();

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setCapturedImage(url);
    runOCR(url);
    e.target.value = "";
  };

  const runOCR = useCallback(async (imageSource) => {
    setMode("scanning");
    setOcrProgress(0);
    setError("");
    setSpecs(null);
    try {
      const worker = await createWorker("eng", 1, {
        logger: (m) => {
          if (m.status === "recognizing text") setOcrProgress(Math.round(m.progress * 100));
        },
      });
      await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHJKLMNPRSTUVWXYZ0123456789" });
      const { data } = await worker.recognize(imageSource);
      await worker.terminate();
      const found = extractVIN(data.text);
      if (found) {
        setVin(found);
        setMode("idle");
        lookupSpecs(found);
      } else {
        setError("No VIN found in image. Try a clearer photo or enter manually.");
        setMode("idle");
      }
    } catch {
      setError("OCR failed. Please try again.");
      setMode("idle");
    }
  }, [lookupSpecs]);

  const startCamera = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: 1280, height: 720 } });
      setCameraStream(stream);
      setMode("camera");
      setTimeout(() => {
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }
      }, 100);
    } catch {
      setError("Camera access denied. Please allow camera permissions.");
    }
  };

  const stopCamera = () => {
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    setCameraStream(null);
    setMode("idle");
  };

  const capturePhoto = () => {
    const video = videoRef.current, canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    setCapturedImage(dataUrl);
    stopCamera();
    runOCR(dataUrl);
  };

  const reset = () => {
    setMode("idle"); setCapturedImage(null); setOcrProgress(0);
    setError(""); setVin(""); setSpecs(null);
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    setCameraStream(null);
  };

  const s = specs;
  const showScanOptions = mode === "idle" && !loadingSpecs && !specs;

  return (
    <div className="app">
      <div className="noise" />
      <div className="grid-bg" />

      <header className="header">
        <div className="logo-chip">
          <span className="logo-icon">⬡</span>
          <span className="logo-text">VINSCOPE</span>
        </div>
        <p className="tagline">Powered by NHTSA — nhtsa.gov</p>
      </header>

      <main className="main">

        {/* ── VIN INPUT CARD ── */}
        <div className={`vin-card ${valid ? "valid" : vin.length > 0 && vin.length < 17 ? "" : ""}`}>
          <div className="vin-card-header">
            <span className="field-tag">VIN NUMBER</span>
            {valid
              ? <span className="badge badge-ok">VALID</span>
              : vin.length === 17
                ? <span className="badge badge-err">INVALID FORMAT</span>
                : null
            }
          </div>

          <div className="vin-input-wrap">
            <input
              className="vin-input"
              type="text"
              value={vin}
              onChange={handleVinChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Enter or paste VIN…"
              maxLength={17}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
            />
            {vin && <button className="clear-btn" onClick={reset} title="Clear">×</button>}
          </div>

          {/* pip tracker */}
          <div className="vin-footer">
            <div className="char-track">
              {Array.from({ length: 17 }).map((_, i) => (
                <div key={i} className={`char-pip ${i < vin.length ? "filled" : ""}`} />
              ))}
            </div>
            <span className="char-count">{vin.length}/17</span>
          </div>

          {/* segment breakdown */}
          {vin.length === 17 && (
            <div className="vin-breakdown">
              <div className="seg">
                <span className="seg-label">WMI</span>
                <span className="seg-val mono">{vin.slice(0, 3)}</span>
                <span className="seg-desc">Manufacturer</span>
              </div>
              <div className="seg-div" />
              <div className="seg">
                <span className="seg-label">VDS</span>
                <span className="seg-val mono">{vin.slice(3, 9)}</span>
                <span className="seg-desc">Descriptor</span>
              </div>
              <div className="seg-div" />
              <div className="seg">
                <span className="seg-label">VIS</span>
                <span className="seg-val mono">{vin.slice(9, 17)}</span>
                <span className="seg-desc">Identifier</span>
              </div>
            </div>
          )}

          {/* DECODE BUTTON — shown whenever VIN is valid and not already loaded */}
          {valid && !specs && !loadingSpecs && (
            <button className="lookup-btn" onClick={() => lookupSpecs(vin)}>
              <span>DECODE VIN — NHTSA LOOKUP</span>
              <span className="lookup-arrow">→</span>
            </button>
          )}
        </div>

        {/* ── SCAN OPTIONS ── */}
        {showScanOptions && (
          <div className="actions">
            <p className="actions-label">— OR SCAN VIN PLATE —</p>
            <div className="action-row">
              <button className="action-btn gallery-btn" onClick={openGallery}>
                <span className="btn-glyph">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2.5" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <path d="M21 15l-5-5L5 21" />
                  </svg>
                </span>
                <span className="btn-label">Gallery</span>
              </button>
              <button className="action-btn camera-btn" onClick={startCamera}>
                <span className="btn-glyph">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                </span>
                <span className="btn-label">Camera</span>
              </button>
            </div>
          </div>
        )}

        {/* ── CAMERA ── */}
        {mode === "camera" && (
          <div className="camera-wrap">
            <video ref={videoRef} className="camera-feed" autoPlay playsInline muted />
            <div className="vin-overlay">
              <div className="vin-frame">
                <span className="fc tl" /><span className="fc tr" />
                <span className="fc bl" /><span className="fc br" />
                <p className="frame-hint">Align VIN plate within frame</p>
              </div>
            </div>
            <div className="cam-controls">
              <button className="cam-cancel-btn" onClick={stopCamera}>✕ Cancel</button>
              <button className="shutter-btn" onClick={capturePhoto}><span className="shutter-ring" /></button>
            </div>
          </div>
        )}

        {/* ── OCR SCANNING ── */}
        {mode === "scanning" && (
          <div className="scanning-wrap">
            {capturedImage && (
              <div className="scan-preview">
                <img src={capturedImage} className="scan-img" alt="Scanning" />
                <div className="scan-beam" />
              </div>
            )}
            <div className="ocr-status">
              <span className="ocr-label">READING VIN — {ocrProgress}%</span>
              <div className="ocr-bar"><div className="ocr-fill" style={{ width: `${ocrProgress}%` }} /></div>
            </div>
          </div>
        )}

        {/* ── LOADING NHTSA ── */}
        {loadingSpecs && (
          <div className="loading-specs">
            <div className="loading-orb" />
            <div>
              <p className="loading-title">QUERYING NHTSA</p>
              <p className="loading-sub">{loadingStep}</p>
            </div>
          </div>
        )}

        {/* ── SPECS PANEL ── */}
        {s && !loadingSpecs && (
          <div className="specs-panel">

            {/* HERO */}
            <div className="specs-hero">
              <div className="hero-year-bg">{s.year}</div>
              <div className="hero-content">
                <p className="hero-make">{s.make}</p>
                <h2 className="hero-model">{s.model}</h2>
                {(s.trim || s.series) && (
                  <p className="hero-trim">{[s.trim, s.series].filter(Boolean).join(" — ")}</p>
                )}
                <div className="hero-badges">
                  {s.driveType && <span className="badge-pill accent">{s.driveType}</span>}
                  {s.bodyClass && <span className="badge-pill muted-pill">{s.bodyClass}</span>}
                  {s.vehicleType && <span className="badge-pill muted-pill">{s.vehicleType}</span>}
                </div>
              </div>
              <div className="nhtsa-credit">
                <span className="nhtsa-dot" />
                DATA SOURCE: NHTSA.GOV
              </div>
            </div>

            {/* IDENTITY */}
            <div className="spec-group">
              <div className="group-header"><span className="group-icon">🪪</span><span className="group-title">VEHICLE IDENTITY</span></div>
              <div className="group-rows">
                <Row label="Model Year" val={s.year} />
                <Row label="Make" val={s.make} />
                <Row label="Model" val={s.model} />
                <Row label="Trim" val={s.trim} />
                <Row label="Series" val={s.series} />
                <Row label="Body Style" val={s.bodyClass} />
                <Row label="Vehicle Type" val={s.vehicleType} />
                <Row label="Manufacturer" val={s.mfrName} />
                <Row label="Assembly Plant" val={s.plant} />
              </div>
            </div>

            {/* ENGINE */}
            <div className="spec-group highlight">
              <div className="group-header"><span className="group-icon">⚙️</span><span className="group-title">ENGINE & DRIVETRAIN</span></div>
              <div className="group-rows">
                <Row label="Engine" val={s.engine} />
                {s.engineDisp && <Row label="Displacement" val={`${parseFloat(s.engineDisp).toFixed(1)}L`} />}
                <Row label="Cylinders" val={s.engineCyl} />
                <Row label="Fuel Type" val={s.fuelType} />
                <Row label="Drive Type" val={s.driveType} />
                <Row label="Transmission" val={s.transmission} />
              </div>
            </div>

            {/* SAFETY SYSTEMS */}
            <div className="spec-group highlight">
              <div className="group-header"><span className="group-icon">🛞</span><span className="group-title">SAFETY SYSTEMS</span></div>
              <div className="group-rows">
                <div className="spec-row">
                  <span className="spec-key">TPMS System</span>
                  <TPMSBadge type={s.tpms} />
                </div>
                <Row label="ABS Brakes" val={s.abs} />
              </div>
            </div>

            {/* DIMENSIONS */}
            {(s.doors || s.seating) && (
              <div className="spec-group">
                <div className="group-header"><span className="group-icon">📐</span><span className="group-title">DIMENSIONS & CAPACITY</span></div>
                <div className="group-rows">
                  <Row label="Doors" val={s.doors} />
                  <Row label="Seat Rows" val={s.seating} />
                </div>
              </div>
            )}

            {/* NHTSA SAFETY RATINGS */}
            {s.safetyInfo && (
              <div className="spec-group highlight">
                <div className="group-header"><span className="group-icon">🛡️</span><span className="group-title">NHTSA SAFETY RATINGS</span></div>
                <div className="group-rows">
                  <div className="spec-row"><span className="spec-key">Overall</span><StarRating value={s.safetyInfo.overall} /></div>
                  <div className="spec-row"><span className="spec-key">Front Crash</span><StarRating value={s.safetyInfo.frontCrash} /></div>
                  <div className="spec-row"><span className="spec-key">Side Crash</span><StarRating value={s.safetyInfo.sideCrash} /></div>
                  <div className="spec-row"><span className="spec-key">Rollover</span><StarRating value={s.safetyInfo.rollover} /></div>
                </div>
              </div>
            )}

            {/* COMPLAINTS */}
            {s.complaintsCount != null && (
              <div className="spec-group">
                <div className="group-header"><span className="group-icon">📋</span><span className="group-title">NHTSA COMPLAINTS</span></div>
                <div className="group-rows">
                  <div className="spec-row">
                    <span className="spec-key">Registered Complaints</span>
                    <span className={`spec-val ${s.complaintsCount > 100 ? "warn" : ""}`}>{s.complaintsCount.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            )}

            {/* RECALLS */}
            {s.recalls?.length > 0 && (
              <div className="recalls-section">
                <div className="recalls-header">
                  <span className="recalls-icon">⚠️</span>
                  <span className="recalls-title">NHTSA ACTIVE RECALLS</span>
                  <span className="recalls-count">{s.recalls.length} FOUND</span>
                </div>
                {s.recalls.map((r, i) => <RecallCard key={i} recall={r} index={i} />)}
              </div>
            )}

            {s.recalls?.length === 0 && (
              <div className="no-recalls">
                <span>✓</span> No active NHTSA recalls found for this vehicle
              </div>
            )}

            <p className="data-footer">
              All data sourced from the US National Highway Traffic Safety Administration · nhtsa.gov
            </p>

            <button className="reset-btn" onClick={reset}>↩ Scan Another Vehicle</button>
          </div>
        )}

        {/* ERROR */}
        {error && (
          <div className="error-banner">
            <span className="err-icon">⚠</span>
            <span>{error}</span>
          </div>
        )}

      </main>

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileChange} />
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}
