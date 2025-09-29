/**
 * Script: validate-health-cards-examples
 * Purpose: Use this library's SHC API to reproduce the reference
 *          example artifacts in `health-cards/docs/examples`, using the same
 *          signing keys as the reference implementation.
 *
 * Reference implementation:
 *   https://github.com/smart-on-fhir/health-cards/tree/main/generate-examples
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { SHCIssuer, SHCReader } from "kill-the-clipboard";

import { importJWK } from "jose";

import CovidVaccinesFixture from "./fixtures/covid-vaccines-bundle.json" with { type: "json" };
import DrFixtureOriginal from "./fixtures/dr-bundle.json" with { type: "json" };
import RevokedFixture from "./fixtures/revoked-bundle.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "..");
const EXAMPLES_DIR = path.join(ROOT, "scripts", "reference-examples");
const OUTPUT_DIR = path.join(ROOT, "scripts", "generated-examples");

// Fix the DrFixture to use resource:0 instead of Patient/pat2,
// because the reference implementation does that manually.
// See: https://github.com/smart-on-fhir/health-cards/issues/118
const DrFixture = JSON.parse(JSON.stringify(DrFixtureOriginal).replaceAll("Patient/pat2", "resource:0"));

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
  // Recursively remove .meta.security, because the reference implementation does not include it,
  // even though the spec says it should.
  function dropMetaSecurity(value) {
    if (Array.isArray(value)) {
      return value.map((item) => dropMetaSecurity(item));
    }
    if (value && typeof value === "object") {
      const result: Record<string, unknown> = {};
      const keys = Object.keys(value).sort();
      for (const key of keys) {
        if (key === "meta") continue;
        result[key] = dropMetaSecurity((value as Record<string, unknown>)[key]);
      }
      return result;
    }
    return value;
  }

  const na = dropMetaSecurity(a);
  const nb = dropMetaSecurity(b);
  return JSON.stringify(na) === JSON.stringify(nb);
}

async function generateForExample(fixture, exampleNum, issuerIndex, qrCount) {
  const prefix = `example-${exampleNum}-`;

  // Sign using SHCIssuer API with same keys and issuer
  const { privateKey, publicKey } = await loadIssuerKeys(issuerIndex);
  const issuerUrl = "https://spec.smarthealth.cards/examples/issuer";
  const issuer = new SHCIssuer({
    issuer: issuerUrl,
    privateKey,
    publicKey,
    enableQROptimization: true,
    strictReferences: false,  // reference implementation does not use strict references
  });

  // Create health card
  const healthCard = await issuer.issue(fixture);
  const jws = healthCard.asJWS();

  // Generate numeric QR values using the cleaner API
  const qrCodeStrings = healthCard.asQRNumeric({
    enableChunking: qrCount > 1,
  });

  // Write outputs mirroring reference filenames into OUTPUT_DIR
  ensureDir(OUTPUT_DIR);

  fs.writeFileSync(path.join(OUTPUT_DIR, `${prefix}d-jws.txt`), jws);
  fs.writeFileSync(
    path.join(OUTPUT_DIR, `${prefix}e-file.smart-health-card`),
    await healthCard.asFileContent()
  );
  qrCodeStrings.forEach((qrString, i) => {
    fs.writeFileSync(
      path.join(OUTPUT_DIR, `${prefix}f-qr-code-numeric-value-${i}.txt`),
      qrString
    );
  });

  // Read each of the reference files and compare to our outputs.
  // Load the payload, to ensure deterministic differences are not present.

  // Create reader for verification
  const reader = new SHCReader({
    publicKey,
    enableQROptimization: true,
    strictReferences: false,
  });

  // Load the JWS and ensure it matches the reference.
  console.log(
    `Checking if example ${exampleNum} matches ${prefix}d-jws.txt reference.`
  );
  const referenceJws = fs.readFileSync(
    path.join(EXAMPLES_DIR, `${prefix}d-jws.txt`),
    "utf8"
  );
  const referenceHealthCard = await reader.fromJWS(referenceJws);
  const referenceJwsFhirBundle = await referenceHealthCard.asBundle();
  const ourJws = fs.readFileSync(
    path.join(OUTPUT_DIR, `${prefix}d-jws.txt`),
    "utf8"
  );
  const ourHealthCard = await reader.fromJWS(ourJws);
  const ourJwsFhirBundle = await ourHealthCard.asBundle();
  if (!deepEqualJson(ourJwsFhirBundle, referenceJwsFhirBundle)) {
    throw new Error(
      `FHIR Bundle does not match reference: ${path.join(
        OUTPUT_DIR,
        `${prefix}d-jws-fhir-bundle.json`
      )} vs ${path.join(OUTPUT_DIR, `${prefix}d-jws-fhir-bundle-reference.json`)}`
    );
  }
  console.log(`Example ${exampleNum} matches ${prefix}d-jws.txt reference.`);

  // Load the SHC and ensure it matches the reference.
  console.log(
    `Checking if example ${exampleNum} matches ${prefix}e-file.smart-health-card reference.`
  );
  const referenceShc = fs.readFileSync(
    path.join(EXAMPLES_DIR, `${prefix}e-file.smart-health-card`),
    "utf8"
  );
  const ourShc = fs.readFileSync(
    path.join(OUTPUT_DIR, `${prefix}e-file.smart-health-card`),
    "utf8"
  );
  const referenceShcHealthCard = await reader.fromFileContent(referenceShc);
  const referenceShcFhirBundle = await referenceShcHealthCard.asBundle();
  const ourShcHealthCard = await reader.fromFileContent(ourShc);
  const ourShcFhirBundle = await ourShcHealthCard.asBundle();
  if (!deepEqualJson(ourShcFhirBundle, referenceShcFhirBundle)) {
    throw new Error("SHC does not match reference");
  }
  console.log(
    `Example ${exampleNum} matches ${prefix}e-file.smart-health-card reference.`
  );

  // Load the QR values and ensure they match the reference.
  console.log(
    `Checking if example ${exampleNum} QR code numeric values match reference files...`
  );

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
  const ourQrHealthCard = await reader.fromQRNumeric(ourQRNumericValues);
  const ourQrFhirBundle = await ourQrHealthCard.asBundle();
  const referenceQrHealthCard = await reader.fromQRNumeric(referenceQRNumericValues);
  const referenceQrFhirBundle = await referenceQrHealthCard.asBundle();

  if (!deepEqualJson(ourQrFhirBundle, referenceQrFhirBundle)) {
    throw new Error("FHIR Bundle from QR codes does not match reference");
  }
  console.log(
    `Example ${exampleNum} QR code numeric values successfully validated.`
  );
}

async function main() {
  const matrix = [
    { fixture: CovidVaccinesFixture, num: "00", issuerIndex: 0, qrCount: 1 },
    { fixture: CovidVaccinesFixture, num: "01", issuerIndex: 2, qrCount: 1 },
    { fixture: DrFixture, num: "02", issuerIndex: 0, qrCount: 3 },
    { fixture: RevokedFixture, num: "03", issuerIndex: 0, qrCount: 1 },
  ];
  for (const m of matrix) {
    console.log(
      `Generating example ${m.num} with issuer index ${m.issuerIndex}...`
    );
    await generateForExample(m.fixture, m.num, m.issuerIndex, m.qrCount);
  }
  console.log(`Done. Outputs in ${OUTPUT_DIR}`);
}

main();
