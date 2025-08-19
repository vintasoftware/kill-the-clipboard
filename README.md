# Kill the Clipboard JavaScript / TypeScript Library

JavaScript/TypeScript universal (browser and node) library to generate QR codes containing medical records for patients to share with providers. Implements the [SMART Health Cards Framework](https://smarthealth.cards/) for FHIR-based medical records, enabling patients to "Kill the Clipboard" by sharing health data via secure, verifiable QR codes.

Smart Health Links support is coming soon.

This aligns with the [CMS Interoperability Framework](https://www.cms.gov/health-technology-ecosystem/interoperability-framework) call to action for Patient Facing Apps to "Kill the Clipboard":

> We pledge to empower patients to retrieve their health records from CMS Aligned Networks or personal health record apps and share them with providers via **QR codes or Smart Health Cards/Links using FHIR bundles**. When possible, we will return visit records to patients in the same format. We commit to seamless, secure data exchange—eliminating the need for patients to repeatedly recall and write out their medical history. We are committed to "kill the clipboard," one encounter at a time.

⚠️ **This is a new library. While it's well tested, please verify the proper functionality before using in production. Please report any issues or suggestions to the [GitHub Issues](https://github.com/vintasoftware/kill-the-clipboard/issues) page. For sensitive security reports, please contact us at contact at vinta.com.br**

## Features

**Complete SMART Health Cards Implementation**
- Follows [SMART Health Cards Framework v1.4.0](https://spec.smarthealth.cards/)
- JWS generation
- File generation (.smart-health-card files)
- QR code generation with optional chunking support
- Decoding / Verification support

**Smart Health Links**
- Support for Smart Health Links is coming soon.

**Great Developer Experience**
- TypeScript support with full type definitions
- Comprehensive test suite (100+ tests)
- Proper error handling hierarchy  
- Built both for Node.js and browser environments

## Demo

<a href="https://vintasoftware.github.io/kill-the-clipboard/demo/"><img height="200" alt="Kill the Clipboard JavaScript / TypeScript library - Smart Health Cards demo" src="https://github.com/user-attachments/assets/5e820583-9a23-4ff4-aa37-112254c8bfa5" /></a>

**USE FOR TESTING PURPOSES ONLY - NOT FOR REAL HEALTH DATA.**

Want to see the library in action? Try our interactive browser demo that showcases QR code generation and camera-based scanning: https://vintasoftware.github.io/kill-the-clipboard/demo/

## Installation

```bash
npm install kill-the-clipboard
# or
pnpm add kill-the-clipboard
# or  
yarn add kill-the-clipboard
```

## Usage

### Basic Usage

**Security warning**: Issue/sign on a secure backend only; never expose the ES256 private key in browsers.

Use `SmartHealthCardIssuer` on the server. Use `SmartHealthCardReader` in the browser or server to verify and render QR.

Typical flow: client sends FHIR Bundle → server returns JWS/.smart-health-card or QR data.

```typescript
import { SmartHealthCardIssuer, SmartHealthCardReader } from 'kill-the-clipboard';

// Configure issuer with your details and ES256 key pair
// SECURITY: Use issuer on a secure backend only; never include privateKey in client-side code.
const issuer = new SmartHealthCardIssuer({
  issuer: 'https://your-healthcare-org.com',
  privateKey: privateKeyPKCS8String, // ES256 private key in PKCS#8 format
  publicKey: publicKeySPKIString, // ES256 public key in SPKI format
});

// Configure reader for verification (only needs public key)
const reader = new SmartHealthCardReader({
  publicKey: publicKeySPKIString, // ES256 public key in SPKI format
});

// Create FHIR Bundle
const fhirBundle = {
  resourceType: 'Bundle',  
  type: 'collection',
  entry: [
    {
      fullUrl: 'https://example.org/fhir/Patient/123',
      resource: {
        resourceType: 'Patient',
        id: '123', 
        name: [{ family: 'Doe', given: ['John'] }],
        birthDate: '1990-01-01',
      },
    },
    {
      fullUrl: 'https://example.org/fhir/Immunization/456',
      resource: {
        resourceType: 'Immunization',
        id: '456',
        status: 'completed',
        vaccineCode: {
          coding: [{
            system: 'http://hl7.org/fhir/sid/cvx',
            code: '207',
            display: 'COVID-19 vaccine', 
          }],
        },
        patient: { reference: 'Patient/123' },
        occurrenceDateTime: '2023-01-15',
      },
    },
  ],
};

// Issue a new SMART Health Card
const healthCard = await issuer.issue(fhirBundle);
console.log('Health Card JWS:', healthCard.asJWS());

// Generate QR codes
const qrCodes = await healthCard.asQR();
console.log('QR code data URL:', qrCodes[0]);

// Generate numeric QR codes (shc:/ prefixed strings)
const qrNumericStrings = healthCard.asQRNumeric();
console.log('Numeric QR code:', qrNumericStrings[0]);

// Create downloadable .smart-health-card file
const blob = await healthCard.asFileBlob();
console.log('File blob created, type:', blob.type);

// Verify and read the health card
const verifiedHealthCard = await reader.fromJWS(healthCard.asJWS());
const verifiedBundle = await verifiedHealthCard.asBundle();
console.log('Verified FHIR Bundle:', verifiedBundle);

// Read from file content
const fileContent = await healthCard.asFileContent();
const healthCardFromFile = await reader.fromFileContent(fileContent);
console.log('Bundle from file:', await healthCardFromFile.asBundle());

// Read from QR numeric data (simulate scanning QR codes)
const healthCardFromQR = await reader.fromQRNumeric(qrNumericStrings);
console.log('Bundle from QR:', await healthCardFromQR.asBundle());
```

### Advanced Usage

```typescript
import { 
  SmartHealthCardIssuer,
  SmartHealthCardReader,
  FHIRBundleProcessor, 
  VerifiableCredentialProcessor,
  JWSProcessor,
  QRCodeGenerator 
} from 'kill-the-clipboard';

// High-level API with SmartHealthCard object
const issuer = new SmartHealthCardIssuer(config);
const healthCard = await issuer.issue(fhirBundle, {
  includeAdditionalTypes: ['https://smarthealth.cards#covid19'],
});

// SmartHealthCard provides various output formats
const qrCodes = await healthCard.asQR({
  enableChunking: false,
  encodeOptions: {
    errorCorrectionLevel: 'L',
    scale: 4,
  },
});

const bundle = await healthCard.asBundle({ optimizeForQR: true, strictReferences: true });
const fileContent = await healthCard.asFileContent();

// Use individual processors for more control
const fhirProcessor = new FHIRBundleProcessor();
const vcProcessor = new VerifiableCredentialProcessor();
const jwsProcessor = new JWSProcessor();

// Process FHIR Bundle (standard processing)
const processedBundle = fhirProcessor.process(fhirBundle);
fhirProcessor.validate(processedBundle);

// Or process with QR code optimizations (shorter resource references, removes unnecessary fields)
// Use 'strictReferences' option. When true, missing references throw an error.
// When false, original references are preserved if target resource is not found in bundle.
const optimizedBundle = fhirProcessor.processForQR(fhirBundle, { strictReferences: true });
fhirProcessor.validate(optimizedBundle);

// Create Verifiable Credential
const vc = vcProcessor.create(processedBundle, {
  fhirVersion: '4.0.1',
  includeAdditionalTypes: [
    'https://smarthealth.cards#immunization',
    'https://smarthealth.cards#covid19',
  ],
});

// Create JWT payload
const jwtPayload = {
  iss: 'https://your-org.com',
  nbf: Math.floor(Date.now() / 1000),
  vc: vc.vc,
};

// Sign to create JWS
const jws = await jwsProcessor.sign(jwtPayload, privateKey, publicKey, {
  enableCompression: true, // Enable compression per SMART Health Cards spec
});

// Verify JWS
const verified = await jwsProcessor.verify(jws, publicKey);

// Generate QR codes
const qrGenerator = new QRCodeGenerator({
  // maxSingleQRSize auto-derived from errorCorrectionLevel if not specified:
  // L: 1195, M: 927, Q: 670, H: 519 (V22 limits from SMART Health Cards QR FAQ)
  // See: https://github.com/smart-on-fhir/health-cards/blob/main/FAQ/qr.md
  enableChunking: false, // Use single QR mode (recommended)
  encodeOptions: {
    errorCorrectionLevel: 'L', // L per SMART Health Cards spec
    scale: 4, // QR code scale factor
    margin: 1, // Quiet zone size
    color: { dark: '#000000ff', light: '#ffffffff' },
    // Optional: version, maskPattern, width
  }
});

const qrDataUrls = await qrGenerator.generateQR(jws);
console.log('Generated QR code data URL:', qrDataUrls[0]);

// Scan QR codes (simulate scanning with numeric data)
const scannedData = ['shc:/56762959532654603460292540772804336028702864716745...'];
const reconstructedJWS = await qrGenerator.decodeQR(scannedData);

// Manual JWS chunking and numeric conversion
const chunks = qrGenerator.chunkJWS(jws); // Returns array of shc:/ prefixed strings
const numericData = qrGenerator.encodeJWSToNumeric(jws);
const decodedJWS = qrGenerator.decodeNumericToJWS(numericData);
```

### Error Handling

```typescript
import { 
  SmartHealthCardIssuer,
  SmartHealthCardReader,
  SmartHealthCardError,
  FhirValidationError,
  JWSError,
  QRCodeError 
} from 'kill-the-clipboard';

const issuer = new SmartHealthCardIssuer(config);
const reader = new SmartHealthCardReader({ publicKey: config.publicKey });

try {
  const healthCard = await issuer.issue(fhirBundle);
  const qrCodes = await healthCard.asQR();
} catch (error) {
  if (error instanceof FhirValidationError) {
    console.error('FHIR Bundle validation failed:', error.message);
  } else if (error instanceof JWSError) {
    console.error('JWT/JWS processing failed:', error.message);
  } else if (error instanceof QRCodeError) {
    console.error('QR code processing failed:', error.message);
  } else if (error instanceof SmartHealthCardError) {
    console.error('SMART Health Card error:', error.message, error.code);
  } else {
    console.error('Unexpected error:', error);
  }
}

try {
  const verifiedCard = await reader.fromJWS(jws);
  const bundle = await verifiedCard.asBundle();
} catch (error) {
  console.error('Verification failed:', error.message);
}

try {
  const qrNumeric = 'shc:/56762959532654603460292540772804336028...';
  const verifiedCard = await reader.fromQRNumeric(qrNumeric);
  const bundle = await verifiedCard.asBundle();
} catch (error) {
  console.error('QR numeric verification failed:', error.message);
}
```

### File Operations

```typescript
import { SmartHealthCardIssuer, SmartHealthCardReader } from 'kill-the-clipboard';

const issuer = new SmartHealthCardIssuer(config);
const reader = new SmartHealthCardReader({ publicKey: config.publicKey });

// Issue a health card
const healthCard = await issuer.issue(fhirBundle);

// Create SMART Health Card file content (JSON wrapper with verifiableCredential array)
const fileContent = await healthCard.asFileContent();
console.log('File content:', fileContent); // JSON string with { verifiableCredential: [jws] }

// Create downloadable Blob (browser-compatible)
const blob = await healthCard.asFileBlob();
console.log('Blob type:', blob.type); // 'application/smart-health-card'

// Trigger download in browser (example implementation)
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'vaccination-card.smart-health-card';
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);

// Verify health card from file content
const verifiedFromFile = await reader.fromFileContent(fileContent);
console.log('Valid health card bundle:', await verifiedFromFile.asBundle());

// Verify health card from Blob (e.g., from file input)
const fileInput = document.querySelector('input[type="file"]');
fileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (file && file.name.endsWith('.smart-health-card')) {
    try {
      const verified = await reader.fromFileContent(file);
      console.log('Valid health card:', await verified.asBundle());
      
      // Or get QR codes from the verified health card
      const qrCodes = await verified.asQR();
      console.log('QR code data URL:', qrCodes[0]);
    } catch (error) {
      console.error('Invalid health card file:', error.message);
    }
  }
});
```

### Generating ES256 Key Pairs

```typescript
// Generate ES256 key pair for testing (Node.js 18+)
import crypto from 'crypto';
import { exportPKCS8, exportSPKI } from 'jose';

// Requires Node.js 18+ for crypto.webcrypto.subtle
const { publicKey, privateKey } = await crypto.webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
);

const privateKeyPKCS8 = await exportPKCS8(privateKey);
const publicKeySPKI = await exportSPKI(publicKey);

// Use these keys in SmartHealthCardIssuer config
const config = {
  issuer: 'https://your-org.com',
  privateKey: privateKeyPKCS8,
  publicKey: publicKeySPKI,
};
```

## API Reference Documentation

Available at [https://vintasoftware.github.io/kill-the-clipboard/](https://vintasoftware.github.io/kill-the-clipboard/).

### Generating Documentation

To generate and view the full API documentation locally:

```bash
# Generate documentation
pnpm run docs:build

# The documentation will be generated in the ./docs directory
# Open docs/index.html in your browser to view the complete API reference
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License  

MIT License - see [LICENSE](LICENSE) file for details.

## Commercial Support

[![alt text](https://avatars2.githubusercontent.com/u/5529080?s=80&v=4 "Vinta Logo")](https://www.vinta.com.br/)

This project is maintained by [Vinta Software](https://www.vinta.com.br/). We offer design and development services for healthcare companies. If you need any commercial support, feel free to get in touch: contact@vinta.com.br
