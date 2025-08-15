// Import the SMART Health Cards library
// In a real application, you would import from 'kill-the-clipboard'
import {
  SmartHealthCardIssuer,
  SmartHealthCardReader,
} from "kill-the-clipboard";
// Import QR code decoding library
import decodeQR from "qr/decode.js";
// Import JOSE for key handling
import { importJWK } from "jose";
// Import Buffer polyfill for browser compatibility
import { Buffer } from "buffer";
import TEST_JWKS from "./issuer.jwks.private.json" assert { type: "json" };

// Make Buffer available globally (needed for qrcode library)
window.Buffer = Buffer;

// Load test JWKS keys (FOR TESTING ONLY - NEVER USE IN PRODUCTION)
let TEST_SIGNING_KEY = null;
let TEST_VERIFICATION_KEY = null;

// Load the test keys from imported JWKS
async function loadTestKeys() {
  try {
    // Find the signing key (first key with use: "sig" and alg: "ES256")
    const signingJwk = TEST_JWKS.keys.find(
      (key) => key.use === "sig" && key.alg === "ES256" && key.kty === "EC"
    );

    if (!signingJwk) {
      throw new Error("No suitable signing key found in JWKS");
    }

    // Import the private key as CryptoKey
    TEST_SIGNING_KEY = await importJWK(signingJwk, "ES256");

    // Create public key by removing the private 'd' parameter and importing
    const { d, ...publicJwk } = signingJwk;
    TEST_VERIFICATION_KEY = await importJWK(publicJwk, "ES256");

    console.log("Test keys loaded successfully");
    console.log("Using key ID:", signingJwk.kid);
  } catch (error) {
    console.error("❌ Failed to load test keys:", error);
    throw error;
  }
}

// Enumerate available camera devices
async function enumerateCameraDevices() {
  try {
    console.log("Enumerating camera devices...");

    // Request permission first to get device labels
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (permissionError) {
      console.warn(
        "⚠️ Camera permission denied, device labels may not be available"
      );
    }

    // Get all video input devices
    const devices = await navigator.mediaDevices.enumerateDevices();
    availableCameras = devices.filter((device) => device.kind === "videoinput");

    // Stop the permission stream if we created one
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    console.log(
      `Found ${availableCameras.length} camera(s):`,
      availableCameras.map(
        (c) => c.label || `Camera ${c.deviceId.substring(0, 8)}...`
      )
    );

    return availableCameras;
  } catch (error) {
    console.error("❌ Failed to enumerate camera devices:", error);
    availableCameras = [];
    return [];
  }
}

// Populate camera selector with available devices
function populateCameraSelector() {
  const cameraSelect = document.getElementById("cameraSelect");

  // Clear existing options
  cameraSelect.innerHTML = "";

  if (availableCameras.length === 0) {
    cameraSelect.innerHTML = '<option value="">No cameras found</option>';
    cameraSelect.disabled = true;
    return;
  }

  // Add default option
  if (availableCameras.length > 1) {
    cameraSelect.innerHTML =
      '<option value="">Auto (Prefer back camera)</option>';
  }

  // Add each camera as an option
  availableCameras.forEach((camera, index) => {
    const option = document.createElement("option");
    option.value = camera.deviceId;

    // Create a user-friendly label
    let label = camera.label;
    if (!label || label.trim() === "") {
      label = `Camera ${index + 1}`;
    }

    // Add camera type indicators if we can detect them
    if (
      label.toLowerCase().includes("back") ||
      label.toLowerCase().includes("rear")
    ) {
      label = `📱 ${label}`;
    } else if (
      label.toLowerCase().includes("front") ||
      label.toLowerCase().includes("user") ||
      label.toLowerCase().includes("face")
    ) {
      label = `🤳 ${label}`;
    } else {
      label = `📷 ${label}`;
    }

    option.textContent = label;
    cameraSelect.appendChild(option);
  });

  cameraSelect.disabled = false;

  // Select the back camera by default if available and there are multiple cameras
  if (availableCameras.length > 1) {
    const backCamera = availableCameras.find(
      (camera) =>
        camera.label &&
        (camera.label.toLowerCase().includes("back") ||
          camera.label.toLowerCase().includes("rear") ||
          camera.label.toLowerCase().includes("environment"))
    );
    if (backCamera) {
      cameraSelect.value = backCamera.deviceId;
    }
  }
}

// Initialize camera devices and populate selector
async function initializeCameraDevices() {
  try {
    showScanStatus("info", "🔍 Detecting available cameras...");

    await enumerateCameraDevices();
    populateCameraSelector();

    if (availableCameras.length === 0) {
      showScanStatus(
        "error",
        "❌ No cameras found. QR scanning will not be available."
      );
    } else {
      showScanStatus(
        "success",
        `✅ Found ${availableCameras.length} camera(s). Select your preferred camera above.`
      );
      // Hide status after a few seconds for successful camera detection
      setTimeout(() => {
        const scanStatus = document.getElementById("scanStatus");
        if (scanStatus) {
          scanStatus.style.display = "none";
        }
      }, 3000);
    }
  } catch (error) {
    console.error("❌ Camera initialization failed:", error);
    showScanStatus(
      "error",
      `❌ Camera initialization failed: ${error.message}`
    );
  }
}

// Sample FHIR Bundle (completely fake data for demo purposes)
const SAMPLE_FHIR_BUNDLE = {
  resourceType: "Bundle",
  type: "collection",
  entry: [
    {
      fullUrl: "https://example.org/fhir/Patient/123",
      resource: {
        resourceType: "Patient",
        id: "123",
        name: [{ family: "Demo", given: ["Test"] }],
        birthDate: "1990-01-01",
        gender: "unknown",
      },
    },
    {
      fullUrl: "https://example.org/fhir/Immunization/456",
      resource: {
        resourceType: "Immunization",
        id: "456",
        status: "completed",
        vaccineCode: {
          coding: [
            {
              system: "http://hl7.org/fhir/sid/cvx",
              code: "207",
              display: "COVID-19 vaccine (Demo Data Only)",
            },
          ],
        },
        patient: { reference: "Patient/123" },
        occurrenceDateTime: "2023-01-15",
        performer: [
          {
            actor: {
              display: "Demo Healthcare Provider (Test Only)",
            },
          },
        ],
      },
    },
  ],
};

// Global variables
let issuer = null;
let reader = null;
let videoStream = null;
let scanningActive = false;
let availableCameras = [];

// Initialize the application
async function init() {
  try {
    // Load test keys first
    await loadTestKeys();

    // Initialize SMART Health Card issuer and reader with test keys
    issuer = new SmartHealthCardIssuer({
      issuer: "https://spec.smarthealth.cards/examples/issuer",
      privateKey: TEST_SIGNING_KEY,
      publicKey: TEST_VERIFICATION_KEY,
    });

    reader = new SmartHealthCardReader({
      publicKey: TEST_VERIFICATION_KEY,
    });

    // Set up event listeners
    setupEventListeners();

    // Initialize camera devices
    await initializeCameraDevices();

    // Display the sample bundle
    displaySampleBundle();

    console.log("SMART Health Cards demo initialized successfully");
    console.log("Using SMART Health Cards example test keys");
  } catch (error) {
    console.error("❌ Failed to initialize demo:", error);
    showScanStatus("error", `Initialization failed: ${error.message}`);
  }
}

// Set up all event listeners
function setupEventListeners() {
  // QR Generation
  document
    .getElementById("generateBtn")
    .addEventListener("click", generateQRCode);
  document
    .getElementById("clearBtn")
    .addEventListener("click", clearGeneration);

  // QR Scanning
  document.getElementById("scanBtn").addEventListener("click", startCameraScan);
  document
    .getElementById("stopScanBtn")
    .addEventListener("click", stopCameraScan);

  // Listen for device changes (cameras being connected/disconnected)
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", async () => {
      console.log("Camera devices changed, refreshing camera list...");
      await enumerateCameraDevices();
      populateCameraSelector();
    });
  }
}

// Display the sample FHIR bundle
function displaySampleBundle() {
  const bundleDisplay = document.getElementById("bundleDisplay");
  bundleDisplay.textContent = JSON.stringify(SAMPLE_FHIR_BUNDLE, null, 2);
}

// Generate QR code from sample FHIR bundle
async function generateQRCode() {
  const generateBtn = document.getElementById("generateBtn");

  try {
    // Show loading state
    generateBtn.disabled = true;
    generateBtn.innerHTML = '<span class="loading"></span>Generating...';
    showGenerationStatus("info", "Generating SMART Health Card QR code...");

    // Generate the health card
    const healthCard = await issuer.issue(SAMPLE_FHIR_BUNDLE, {
      includeAdditionalTypes: ["https://smarthealth.cards#immunization"],
    });

    // Generate QR code
    const qrCodes = await healthCard.asQR({
      encodeOptions: {
        errorCorrectionLevel: "L",
        scale: 4,
        margin: 1,
      },
    });

    // Display the QR code
    displayQRCode(qrCodes[0]);

    showGenerationStatus(
      "success",
      `✅ QR code generated successfully! This contains the demo health card data.`
    );

    console.log("Generated QR code:", qrCodes[0].substring(0, 50) + "...");
    console.log("JWS:", healthCard.asJWS().substring(0, 100) + "...");
  } catch (error) {
    console.error("❌ QR generation failed:", error);
    showGenerationStatus("error", `QR generation failed: ${error.message}`);
  } finally {
    // Reset button state
    generateBtn.disabled = false;
    generateBtn.textContent = "Generate Sample QR Code";
  }
}

// Display QR code in the container
function displayQRCode(dataUrl) {
  const container = document.getElementById("qrCodeContainer");

  container.innerHTML = `
    <div>
      <img src="${dataUrl}" alt="SMART Health Card QR Code" style="max-width: 300px;" />
      <p style="margin-top: 10px; color: #666; font-size: 0.9rem;">
          📷 You can scan this QR code using the camera scanner below
      </p>
    </div>
  `;
}

// Clear the generation results
function clearGeneration() {
  const container = document.getElementById("qrCodeContainer");
  const status = document.getElementById("generationStatus");

  container.innerHTML =
    '<p class="placeholder">Click "Generate Sample QR Code" to create a QR code</p>';
  status.style.display = "none";
}

// Start camera scanning for QR codes
async function startCameraScan() {
  const scanBtn = document.getElementById("scanBtn");
  const stopBtn = document.getElementById("stopScanBtn");
  const cameraSelect = document.getElementById("cameraSelect");
  const video = document.getElementById("video");
  const canvas = document.getElementById("canvas");
  const placeholder = document.getElementById("scannerPlaceholder");

  try {
    scanBtn.disabled = true;
    stopBtn.disabled = false;
    showScanStatus("info", "Requesting camera access...");

    // Check if any cameras are available
    if (availableCameras.length === 0) {
      throw new Error(
        "No cameras available. Please ensure you have a camera connected and grant camera permissions."
      );
    }

    // Prepare video constraints based on selected camera
    const videoConstraints = {
      width: { ideal: 640 },
      height: { ideal: 480 },
    };

    const selectedDeviceId = cameraSelect.value;
    if (selectedDeviceId) {
      // Use specific camera device
      videoConstraints.deviceId = { exact: selectedDeviceId };
      console.log(`Using selected camera: ${selectedDeviceId}`);
    } else {
      // Use default behavior (prefer back camera)
      videoConstraints.facingMode = "environment";
      console.log("Using auto camera selection (prefer back camera)");
    }

    // Request camera access with selected constraints
    videoStream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
    });

    // Set up video element
    video.srcObject = videoStream;
    video.play();

    // Show video and hide placeholder
    video.style.display = "block";
    placeholder.style.display = "none";

    // Add scanner overlay
    const container = document.getElementById("scannerContainer");
    if (!container.querySelector(".scanner-overlay")) {
      const overlay = document.createElement("div");
      overlay.className = "scanner-overlay";
      container.appendChild(overlay);
    }

    scanningActive = true;
    showScanStatus(
      "info",
      "📷 Camera active - position QR code within the frame"
    );

    // Start scanning loop
    scanForQRCode(video, canvas);
  } catch (error) {
    console.error("❌ Camera access failed:", error);

    let errorMessage = `Camera access failed: ${error.message}`;

    // Add specific guidance based on the error and selected camera
    const selectedDeviceId = cameraSelect.value;
    if (selectedDeviceId) {
      const selectedCamera = availableCameras.find(
        (cam) => cam.deviceId === selectedDeviceId
      );
      const cameraName =
        selectedCamera?.label ||
        `Camera ${selectedDeviceId.substring(0, 8)}...`;
      errorMessage += ` (Selected camera: ${cameraName}). Try selecting a different camera or use auto-selection.`;
    } else {
      errorMessage += ` Please ensure you've granted camera permissions and try selecting a specific camera.`;
    }

    showScanStatus("error", errorMessage);

    scanBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

// Stop camera scanning
function stopCameraScan() {
  const scanBtn = document.getElementById("scanBtn");
  const stopBtn = document.getElementById("stopScanBtn");
  const status = document.getElementById("scanStatus");
  const video = document.getElementById("video");
  const placeholder = document.getElementById("scannerPlaceholder");

  scanningActive = false;

  if (videoStream) {
    videoStream.getTracks().forEach((track) => track.stop());
    videoStream = null;
  }

  // Reset UI
  video.style.display = "none";
  placeholder.style.display = "block";
  placeholder.textContent = 'Click "Start Camera Scan" to begin scanning';

  // Remove overlay
  const container = document.getElementById("scannerContainer");
  const overlay = container.querySelector(".scanner-overlay");
  if (overlay) {
    overlay.remove();
  }

  scanBtn.disabled = false;
  stopBtn.disabled = true;
  status.style.display = "none";
}

// Continuously scan for QR codes in video feed
function scanForQRCode(video, canvas) {
  if (!scanningActive) return;

  const context = canvas.getContext("2d");

  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    // Set canvas size to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw current video frame to canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Get image data and scan for QR codes
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    let decoded = null;
    try {
      decoded = decodeQR(
        {
          width: imageData.width,
          height: imageData.height,
          data: imageData.data,
        },
        {}
      );
    } catch (_) {
      // Ignore decode errors for individual frames
    }

    if (typeof decoded === "string" && decoded.startsWith("shc:/")) {
      // QR code found! Process it
      processScanResult(decoded);
      return;
    }
  }

  // Continue scanning
  requestAnimationFrame(() => scanForQRCode(video, canvas));
}

// Process the scanned QR code result
async function processScanResult(qrData) {
  console.log("QR code detected:", qrData.substring(0, 50) + "...");

  try {
    // Stop scanning
    stopCameraScan();

    showScanStatus("info", "🔍 QR code detected! Verifying health card...");

    // Verify and decode the health card
    const healthCard = await reader.fromQRNumeric(qrData);
    const bundle = await healthCard.asBundle();

    // Display the result
    displayScanResult(bundle, qrData);

    showScanStatus(
      "success",
      "✅ SMART Health Card verified and decoded successfully!"
    );
  } catch (error) {
    console.error("❌ QR verification failed:", error);
    showScanStatus("error", `QR verification failed: ${error.message}`);

    // Still display the raw data for debugging
    displayScanResult(null, qrData, error.message);
  }
}

// Display the scan result
function displayScanResult(bundle, rawQrData, error = null) {
  const resultContainer = document.getElementById("scanResult");

  if (bundle) {
    // Successfully decoded health card
    const patientData = bundle.entry?.find(
      (entry) => entry.resource?.resourceType === "Patient"
    )?.resource;
    const immunizationData = bundle.entry?.filter(
      (entry) => entry.resource?.resourceType === "Immunization"
    );

    let displayText = "🎉 SMART Health Card Verified!\n\n";

    if (patientData) {
      const name = patientData.name?.[0];
      displayText += `👤 Patient: ${name?.given?.[0] || "Unknown"} ${
        name?.family || "Unknown"
      }\n`;
      displayText += `📅 Birth Date: ${patientData.birthDate || "Unknown"}\n\n`;
    }

    if (immunizationData && immunizationData.length > 0) {
      displayText += "💉 Immunizations:\n";
      immunizationData.forEach((entry, index) => {
        const immunization = entry.resource;
        const vaccine = immunization.vaccineCode?.coding?.[0];
        displayText += `  ${index + 1}. ${
          vaccine?.display || vaccine?.code || "Unknown vaccine"
        }\n`;
        displayText += `     Date: ${
          immunization.occurrenceDateTime || "Unknown date"
        }\n`;
        displayText += `     Status: ${immunization.status || "Unknown"}\n`;
      });
    }

    displayText += "\n📋 Full FHIR Bundle:\n";
    displayText += JSON.stringify(bundle, null, 2);

    resultContainer.textContent = displayText;
  } else {
    // Failed to decode or error occurred
    let displayText = "❌ QR Code Processing Failed\n\n";
    if (error) {
      displayText += `Error: ${error}\n\n`;
    }
    displayText += `Raw QR Data: ${rawQrData}\n`;
    displayText += `Length: ${rawQrData.length} characters`;

    resultContainer.textContent = displayText;
  }
}

// Show generation status messages
function showGenerationStatus(type, message) {
  const element = document.getElementById("generationStatus");
  if (element) {
    element.className = `status-message ${type}`;
    element.textContent = message;
    element.style.display = "block";
  }
}

// Show scanning status messages
function showScanStatus(type, message) {
  const element = document.getElementById("scanStatus");
  if (element) {
    element.className = `status-message ${type}`;
    element.textContent = message;
    element.style.display = "block";
  }
}

// Initialize the app when DOM is loaded
document.addEventListener("DOMContentLoaded", init);
