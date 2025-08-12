/**
 * Script: validate-health-cards-examples
 * Purpose: Use this library's SmartHealthCard API to reproduce the reference
 *          example artifacts in `health-cards/docs/examples`, using the same
 *          signing keys as the reference implementation.
 *
 * Reference implementation:
 *   https://github.com/smart-on-fhir/health-cards/tree/main/generate-examples
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { SmartHealthCard, QRCodeGenerator } from "kill-the-clipboard";

import { importJWK } from "jose";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_SINGLE_JWS_SIZE = 1195;
const ROOT = path.resolve(__dirname, "..");
const EXAMPLES_DIR = path.join(ROOT, "scripts", "reference-examples");
const OUTPUT_DIR = path.join(ROOT, "scripts", "generated-examples");

async function loadIssuerKeys(index) {
  const jwksPath = path.join(
    ROOT,
    "scripts",
    "config",
    "issuer.jwks.private.json"
  );
  const jwks = JSON.parse(fs.readFileSync(jwksPath, "utf8"));
  const privateJwk = jwks.keys[index];
  if (!privateJwk) {
    throw new Error(`No key at index ${index} in issuer.jwks.private.json`);
  }
  // Import private key
  const privateKey = await importJWK(privateJwk, "ES256");
  // Derive public JWK by removing 'd'
  const { d, ...publicJwk } = privateJwk;
  const publicKey = await importJWK(publicJwk, "ES256");
  return { privateKey, publicKey };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function deepEqualJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function generateForExample(exampleNum, issuerIndex, qrCount) {
  const prefix = `example-${exampleNum}-`;
  const payloadPath = path.join(
    EXAMPLES_DIR,
    `${prefix}b-jws-payload-expanded.json`
  );
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  const fhirBundle = payload.vc.credentialSubject.fhirBundle;

  // Sign using high-level SmartHealthCard API with same keys and issuer
  const { privateKey, publicKey } = await loadIssuerKeys(issuerIndex);
  const issuer = "https://spec.smarthealth.cards/examples/issuer";
  const shc = new SmartHealthCard({
    issuer,
    privateKey,
    publicKey,
    enableQROptimization: true,
  });

  // Create JWS
  const jws = await shc.create(fhirBundle);

  // Generate numeric QR values
  const qrGenerator = new QRCodeGenerator({
    enableChunking: qrCount > 1,
  });
  const qrCodeStrings = qrGenerator.chunkJWS(jws);

  // Write outputs mirroring reference filenames into OUTPUT_DIR
  ensureDir(OUTPUT_DIR);

  fs.writeFileSync(path.join(OUTPUT_DIR, `${prefix}d-jws.txt`), jws);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${prefix}e-file.smart-health-card`),
    await shc.createFile(fhirBundle),
  );
  qrCodeStrings.forEach((qrString, i) => {
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${prefix}f-qr-code-numeric-value-${i}.txt`),
      qrString
    );
  });

  // Read each of the reference files and compare to our outputs.
  // Load the payload, to ensure deterministic differences are not present.

  // Load the JWS and ensure it matches the reference.
  console.log(`Checking if example ${exampleNum} matches ${prefix}d-jws.txt reference.`);
  const referenceJws = fs.readFileSync(path.join(EXAMPLES_DIR, `${prefix}d-jws.txt`), "utf8");
  const referenceJwsFhirBundle = await shc.getBundle(referenceJws);
  const ourJws = fs.readFileSync(path.join(OUTPUT_DIR, `${prefix}d-jws.txt`), "utf8");
  const ourJwsFhirBundle = await shc.getBundle(ourJws);
  if (!deepEqualJson(ourJwsFhirBundle, referenceJwsFhirBundle)) {
    throw new Error("FHIR Bundle does not match reference");
  }
  console.log(`Example ${exampleNum} matches ${prefix}d-jws.txt reference.`);

  // Load the SHC and ensure it matches the reference.
  console.log(`Checking if example ${exampleNum} matches ${prefix}e-file.smart-health-card reference.`);
  const referenceShc = fs.readFileSync(path.join(EXAMPLES_DIR, `${prefix}e-file.smart-health-card`), "utf8");
  const ourShc = fs.readFileSync(path.join(OUTPUT_DIR, `${prefix}e-file.smart-health-card`), "utf8");
  const referenceShcFhirBundle = await shc.getBundleFromFile(referenceShc);
  const ourShcFhirBundle = await shc.getBundleFromFile(ourShc);
  if (!deepEqualJson(ourShcFhirBundle, referenceShcFhirBundle)) {
    throw new Error("SHC does not match reference");
  }
  console.log(`Example ${exampleNum} matches ${prefix}e-file.smart-health-card reference.`);

  // Load the QR values and ensure they match the reference.
  console.log(`Checking if example ${exampleNum} QR code numeric values match reference files...`);

  const ourQRNumericValues: string[] = [];
  const referenceQRNumericValues: string[] = [];
  for (let i = 0; i < qrCount; i++) {
    const qrFilename = `${prefix}f-qr-code-numeric-value-${i}.txt`;

    const ourQRPath = path.join(OUTPUT_DIR, qrFilename);
    const ourQRValue = fs.readFileSync(ourQRPath, "utf8").trim();
    ourQRNumericValues.push(ourQRValue);

    const referenceQRPath = path.join(EXAMPLES_DIR, qrFilename);
    const referenceQRValue = fs.readFileSync(referenceQRPath, "utf8").trim();
    referenceQRNumericValues.push(referenceQRValue);
  }
  const ourQrFhirBundle = await shc.getBundle(await qrGenerator.scanQR(ourQRNumericValues));
  const referenceQrFhirBundle = await shc.getBundle(await qrGenerator.scanQR(referenceQRNumericValues));

  if (!deepEqualJson(ourQrFhirBundle, referenceQrFhirBundle)) {
    throw new Error("FHIR Bundle from QR codes does not match reference");
  }
  console.log(`Example ${exampleNum} QR code numeric values successfully validated.`);
}

async function main() {
  const matrix = [
    { num: "00", issuerIndex: 0, qrCount: 1 },
    { num: "01", issuerIndex: 2, qrCount: 1 },
    { num: "02", issuerIndex: 0, qrCount: 3 },
    { num: "03", issuerIndex: 0, qrCount: 1 },
  ];
  for (const m of matrix) {
    console.log(
      `Generating example ${m.num} with issuer index ${m.issuerIndex}...`
    );
    await generateForExample(m.num, m.issuerIndex, m.qrCount);
  }
  console.log(`Done. Outputs in ${OUTPUT_DIR}`);
}

main()
