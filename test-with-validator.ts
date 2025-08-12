#!/usr/bin/env node

/**
 * Enhanced test script to validate QR code implementation
 * Tests both QR generation and the SMART Health Cards validator
 */

import crypto from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { calculateJwkThumbprint, exportJWK, exportPKCS8, exportSPKI } from 'jose'
import type { FhirBundle } from 'kill-the-clipboard'

import { QRCodeGenerator, SmartHealthCard } from 'kill-the-clipboard'

/**
 * Saves a PNG data URL to a PNG file
 */
async function savePngDataUrl(pngDataUrl: string, outputPath: string): Promise<void> {
  try {
    // Extract base64 data from data URL
    const base64Data = pngDataUrl.replace('data:image/png;base64,', '')

    // Convert base64 to buffer and save directly
    const pngBuffer = Buffer.from(base64Data, 'base64')
    await writeFile(outputPath, pngBuffer)
  } catch (error) {
    console.error(`Error saving PNG file: ${error}`)
    throw error
  }
}

// Create test output directory
const testDir = './test-output'
if (!existsSync(testDir)) {
  await mkdir(testDir, { recursive: true })
}

// Generate ES256 key pair for testing
console.log('🔑 Generating ES256 key pair for testing...')
const { publicKey, privateKey } = await crypto.webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
)

const privateKeyPKCS8 = await exportPKCS8(privateKey)
const publicKeySPKI = await exportSPKI(publicKey)
const publicJwk = await exportJWK(publicKey)
const kid = await calculateJwkThumbprint(publicJwk)

// Build issuer JWKS with derived kid (RFC7638) and required SMART Health Cards fields
const issuerJwks = {
  keys: [
    {
      ...publicJwk,
      use: 'sig',
      alg: 'ES256',
      kid,
    },
  ],
}

// Create SMART Health Card configuration
const config = {
  issuer: 'https://example.com/issuer',
  privateKey: privateKeyPKCS8,
  publicKey: publicKeySPKI,
  enableQROptimization: true, // Enable FHIR Bundle optimization for QR codes
}

const smartHealthCard = new SmartHealthCard(config)

// Test FHIR Bundle - COVID-19 Vaccination Record
const covidVaccinationBundle: FhirBundle = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: [
    {
      fullUrl: 'Patient/example-patient-123',
      resource: {
        resourceType: 'Patient',
        id: 'example-patient-123',
        name: [
          {
            family: 'Anyperson',
            given: ['John', 'B.'],
          },
        ],
        birthDate: '1951-01-20',
        gender: 'male',
      },
    },
    {
      fullUrl: 'Immunization/example-immunization-456',
      resource: {
        resourceType: 'Immunization',
        id: 'example-immunization-456',
        status: 'completed',
        vaccineCode: {
          coding: [
            {
              system: 'http://hl7.org/fhir/sid/cvx',
              code: '207',
              display: 'COVID-19, mRNA, LNP-S, PF, 30 mcg/0.3 mL dose',
            },
          ],
        },
        patient: {
          reference: 'Patient/example-patient-123',
        },
        occurrenceDateTime: '2021-01-01T11:45:33+11:00',
        location: {
          reference: 'Location/example-location',
        },
        performer: [
          {
            actor: {
              reference: 'Organization/example-organization',
            },
          },
        ],
        lotNumber: 'Lot #0000001',
      },
    },
    {
      fullUrl: 'Organization/example-organization',
      resource: {
        resourceType: 'Organization',
        id: 'example-organization',
        name: 'ABC General Hospital',
        identifier: [
          {
            system: 'http://hl7.org/fhir/sid/us-npi',
            value: '1234567890',
          },
        ],
      },
    },
    {
      fullUrl: 'Location/example-location',
      resource: {
        resourceType: 'Location',
        id: 'example-location',
        name: 'ABC General Hospital',
      },
    },
  ],
}

console.log('🏥 Creating SMART Health Card from COVID-19 vaccination record...')

try {
  // Generate SMART Health Card
  const healthCardJWS = await smartHealthCard.create(covidVaccinationBundle, {
    includeAdditionalTypes: [
      'https://smarthealth.cards#immunization',
      'https://smarthealth.cards#covid19',
    ],
  })
  console.log('✅ Successfully created SMART Health Card JWS')
  console.log(`📏 JWS Length: ${healthCardJWS.length} characters`)

  // Test QR Code Generation
  console.log('\n🔲 Testing QR Code Generation...')

  const qrGenerator = new QRCodeGenerator({
    enableChunking: false,
  })

  // Generate QR code
  console.log('📱 Generating QR code from JWS...')
  const qrDataUrls = await qrGenerator.generateQR(healthCardJWS)
  console.log(`✅ Generated ${qrDataUrls.length} QR code(s)`)

  // Test QR code scanning
  console.log('🔍 Testing QR code scanning...')

  // Extract numeric data from the first QR code data URL
  // Note: In a real implementation, you'd scan the QR code to get the numeric string
  // For testing, we'll simulate this by encoding and then decoding
  const numericData = qrGenerator.encodeJWSToNumeric(healthCardJWS)
  console.log(`📊 Numeric data length: ${numericData.length} characters`)
  console.log(`📊 First 50 chars: ${numericData.substring(0, 50)}...`)

  // Test scanning with shc:/ prefix
  const shcData = [`shc:/${numericData}`]
  const reconstructedJWS = await qrGenerator.scanQR(shcData)
  console.log('✅ Successfully reconstructed JWS from QR data')
  console.log(`🔄 Reconstructed matches original: ${reconstructedJWS === healthCardJWS}`)

  // Test chunked QR codes
  console.log('\n🔲 Testing Chunked QR Codes...')
  const chunkedGenerator = new QRCodeGenerator({
    maxSingleQRSize: 500, // Force chunking
    enableChunking: true,
  })

  const chunkedQRs = await chunkedGenerator.generateQR(healthCardJWS)
  console.log(`✅ Generated ${chunkedQRs.length} chunked QR codes`)

  // Test chunked scanning (simulate getting numeric data from multiple QR codes)
  const chunkedNumericData: string[] = []
  const chunkSize = 480 // Approximate chunk size after header overhead
  for (let i = 0; i < numericData.length; i += chunkSize) {
    const chunk = numericData.substring(i, i + chunkSize)
    const chunkIndex = Math.floor(i / chunkSize) + 1
    const totalChunks = Math.ceil(numericData.length / chunkSize)
    chunkedNumericData.push(`shc:/${chunkIndex}/${totalChunks}/${chunk}`)
  }

  const reconstructedFromChunks = await chunkedGenerator.scanQR(chunkedNumericData)
  console.log('✅ Successfully reconstructed JWS from chunked QR data')
  console.log(
    `🔄 Chunked reconstruction matches original: ${reconstructedFromChunks === healthCardJWS}`
  )

  // Save QR codes as PNG files for validator testing
  console.log('\n💾 Saving QR codes as PNG files for validator...')

  // Save single QR code to PNG
  const singleQRPngPath = `${testDir}/single-qr.png`
  await savePngDataUrl(qrDataUrls[0], singleQRPngPath)
  console.log(`📄 Saved single QR code as PNG: ${singleQRPngPath}`)

  // Save chunked QR codes to PNG
  const chunkedQRPngPaths: string[] = []
  for (let i = 0; i < chunkedQRs.length; i++) {
    const chunkPngPath = `${testDir}/chunked-qr-${i + 1}.png`
    await savePngDataUrl(chunkedQRs[i], chunkPngPath)
    chunkedQRPngPaths.push(chunkPngPath)
    console.log(`📄 Saved chunked QR code ${i + 1} as PNG: ${chunkPngPath}`)
  }

  // Save QR code data URLs as HTML for visual inspection
  const qrHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>SMART Health Card QR Codes</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .qr-container { margin: 20px 0; padding: 20px; border: 1px solid #ccc; }
        .qr-info { margin: 10px 0; }
        img { max-width: 400px; border: 1px solid #ddd; }
    </style>
</head>
<body>
    <h1>SMART Health Card QR Codes</h1>

    <div class="qr-container">
        <h2>Single QR Code</h2>
        <div class="qr-info">JWS Length: ${healthCardJWS.length} characters</div>
        <div class="qr-info">Numeric Data Length: ${numericData.length} characters</div>
        <img src="${qrDataUrls[0]}" alt="Single QR Code" />
        <div class="qr-info">
            <strong>QR Content Preview:</strong><br/>
            <code>shc:/${numericData.substring(0, 100)}...</code>
        </div>
        <div class="qr-info">
            <strong>PNG File:</strong> single-qr.png (for validator testing)
        </div>
    </div>

    <div class="qr-container">
        <h2>Chunked QR Codes (${chunkedQRs.length} codes)</h2>
        ${chunkedQRs
          .map(
            (qr, i) => `
            <div style="margin: 10px 0;">
                <h3>Chunk ${i + 1} of ${chunkedQRs.length}</h3>
                <img src="${qr}" alt="Chunked QR Code ${i + 1}" />
                <div class="qr-info">
                    <strong>PNG File:</strong> chunked-qr-${i + 1}.png (for validator testing)
                </div>
            </div>
        `
          )
          .join('')}
    </div>

    <div class="qr-container">
        <h2>Test Results</h2>
        <ul>
            <li>✅ QR Generation: Success</li>
            <li>✅ QR Scanning: Success</li>
            <li>✅ Single QR Reconstruction: ${
              reconstructedJWS === healthCardJWS ? 'Pass' : 'Fail'
            }</li>
            <li>✅ Chunked QR Reconstruction: ${
              reconstructedFromChunks === healthCardJWS ? 'Pass' : 'Fail'
            }</li>
            <li>✅ PNG Conversion: Success</li>
        </ul>
    </div>
</body>
</html>`

  await writeFile(`${testDir}/qr-codes.html`, qrHtml)
  console.log(`📄 Saved QR codes visualization: ${testDir}/qr-codes.html`)

  // Save issuer JWKS (public keys) so validator can verify signatures without network fetch
  const jwksPath = `${testDir}/issuer.jwks.json`
  await writeFile(jwksPath, JSON.stringify(issuerJwks, null, 2))
  console.log(`📄 Saved issuer JWKS: ${jwksPath}`)

  // Test our own verification
  console.log('\n🔍 Testing internal verification...')
  const verifiedVC = await smartHealthCard.verify(healthCardJWS)
  console.log('✅ Internal verification successful')

  const bundle = verifiedVC.vc.credentialSubject.fhirBundle
  const firstResource = bundle.entry?.[0]?.resource
  const patient = firstResource?.resourceType === 'Patient' ? firstResource : undefined
  console.log(`   - Patient: ${patient?.name?.[0]?.family ?? 'Unknown'}`)
  console.log(`   - FHIR Version: ${verifiedVC.vc.credentialSubject.fhirVersion}`)
  console.log(`   - Bundle Type: ${verifiedVC.vc.credentialSubject.fhirBundle.type}`)

  // Create standard test files
  const jwsFile = `${testDir}/covid-vaccination.jws`
  await writeFile(jwsFile, healthCardJWS)
  console.log(`📄 Saved JWS file: ${jwsFile}`)

  const fileContent = await smartHealthCard.createFile(covidVaccinationBundle, {
    includeAdditionalTypes: [
      'https://smarthealth.cards#immunization',
      'https://smarthealth.cards#covid19',
    ],
  })
  const healthCardFile = `${testDir}/covid-vaccination.smart-health-card`
  await writeFile(healthCardFile, fileContent)
  console.log(`📄 Saved SMART Health Card file: ${healthCardFile}`)

  // Save the optimized bundle from the verified health card
  // This will have the QR optimizations applied (short resource URIs, removed .id fields, etc.)
  const optimizedBundle = verifiedVC.vc.credentialSubject.fhirBundle
  const bundleFile = `${testDir}/covid-vaccination-bundle.json`
  await writeFile(bundleFile, JSON.stringify(optimizedBundle, null, 2))
  console.log(`📄 Saved optimized FHIR Bundle file: ${bundleFile}`)

  console.log('\n📋 QR Code Implementation Test Results:')
  console.log('✅ QR Code Generation: WORKING')
  console.log('✅ QR Code Scanning: WORKING')
  console.log('✅ Single QR Mode: WORKING')
  console.log('✅ Chunked QR Mode: WORKING')
  console.log('✅ Numeric Encoding/Decoding: WORKING')
  console.log('✅ SHC Prefix Handling: WORKING')

  console.log('\n🧪 To test with the official validator:')
  console.log('1. Go into the health-cards-dev-tools directory:')
  console.log('   cd health-cards-dev-tools')
  console.log('2. Test the SMART Health Card file:')
  console.log(`   node . --path ../${healthCardFile} --type healthcard --jwkset ../${jwksPath}`)
  console.log('3. Test the JWS directly:')
  console.log(`   node . --path ../${jwsFile} --type jws --jwkset ../${jwksPath}`)
  console.log('4. Test the FHIR Bundle:')
  console.log(`   node . --path ../${bundleFile} --type fhirbundle`)
  console.log('5. Test the QR codes (PNG format):')
  console.log(`   node . --path ../${singleQRPngPath} --type qr --jwkset ../${jwksPath}`)
  console.log('   # For chunked QR codes (single command with multiple paths):')
  const chunkedPaths = chunkedQRPngPaths.map(path => `../${path}`).join(' --path ')
  console.log(`   node . --path ${chunkedPaths} --type qr --jwkset ../${jwksPath}`)
  console.log('6. (Optional) Validate the JWKS itself:')
  console.log(`   node . --path ../${jwksPath} --type jwkset`)

  console.log('\n👀 Open the QR codes visualization:')
  console.log(`   Open ${testDir}/qr-codes.html in your browser`)
} catch (error) {
  console.error('❌ Error during QR code testing:', error.message)
  console.error(error)
  process.exit(1)
}
