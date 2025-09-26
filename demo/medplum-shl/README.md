# Medplum SMART Health Links (SHL) Demo

This is a Next.js demo application that demonstrates SMART Health Links (SHL) functionality using Medplum as the backend and the `kill-the-clipboard` library.

## What this demo implements

- **SMART Health Link Generator**: Creates SMART Health Links that point to a manifest; `U` flag unsupported
    - **Passcode protection (`P` flag)**: Server-enforced passcode prompted on the viewer; passcodes are stored as Argon2id hashes using OWASP recommended security parameters
    - **Persistent Manifest storage**: Complete SHL payloads, `SHLManifestBuilder` attributes, and passcode hashes stored inside FHIR `DocumentManifest` and `DocumentReference` resources in Medplum
    - **File storage**: Encrypted JWE files persisted to Medplum as `Binary` resources inside `DocumentReference` resources
    - **QR code rendering**: Rendering of SHL QR codes using `qr` library
- **SMART Health Link Viewer**: Resolves `shlink:/...`, prompts for passcode if needed, fetches manifest, decrypts files, and displays FHIR resources
    - **Manifest serving**: POST manifest endpoint; embeds JWEs ≤ 1 KiB, otherwise returns JWE file URLs
    - **Optional long-term flag (`L`)**: Flag is settable on creation; no polling implemented yet
    - **Failed attempt tracking**: Tracks failed passcode attempts and permanently invalidates SHLs after exceeding the configured limit (default: 100 attempts)
    - **Audit trail**: All SHL access attempts (successful and failed) are tracked using FHIR `AuditEvent` resources

## URL Paths

- **SHL Generator** (`/`): Create SHLs
- **SHL Generation API** (`/api/shl`): Server-side SHL generation
- **SHL Viewer** (`/viewer`): Resolve and display SHLs

## Important limitations

- No support for generating SHLs with `U` flag (single, direct file access, w/o manifest)
- No polling for SHLs with `L` flag
- No rate limiting for manifest requests

## Setup

### Prerequisites

- Node.js 20.19.0 or higher
- pnpm package manager
- Configured Medplum project (see sections below)

### Medplum Client Credentials setup

Get your Medplum project ID from the app.medplum.com [Project page](https://app.medplum.com/admin/project). Keep the project ID at hand to set it as an environment variable.

Now create a Client application: inside Project page, create a Client application, and get the client ID and secret. The secret is necessary to authenticate the server-side client, and it will be set as an environment variable.

Note: the project ID and client ID are different.

For more details, see the [Medplum Client Credentials documentation](https://www.medplum.com/docs/auth/methods/client-credentials).

### Medplum reCAPTCHA setup

Create a new reCAPTCHA configuration to get the site key and secret key at [google.com/recaptcha/admin/create](https://www.google.com/recaptcha/admin/create).

Go to the [app.medplum.com](https://app.medplum.com), go to Project, then Sites. Create a Site with domains `localhost` and `127.0.0.1` and set the reCAPTCHA site key and secret key. Also, keep the reCAPTCHA site key at hand to set it as an environment variable.

### Medplum Patient Access Policy setup

Ensure your Medplum project has the proper [Access Policy](https://www.medplum.com/docs/access/access-policies#patient-access) for Patients. Patient users must have access to all resource types this demo requires, especially `DocumentManifest` and `DocumentReference` to support SHL file serving. Check the file [`patient-access-policy.json`](./patient-access-policy.json) for the policy you can use in your project. Go to the [app.medplum.com Access Policy page](https://app.medplum.com/AccessPolicy), create an Access Policy, and use the "JSON" tab to set the policy JSON.

Additionally, to support new Patient registrations, set the new patient access policy as the default. Navigate to [app.medplum.com Project page](https://app.medplum.com/Project) and select your project. In the "Edit" tab, set the "Default Patient Access Policy" field to your new policy and click "Update".

### Installation

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Set up environment variables:
   ```bash
   cp .env.example .env.local
   ```

   Configure the following variables:
   ```env
   NEXT_PUBLIC_MEDPLUM_BASE_URL=https://api.medplum.com
   NEXT_PUBLIC_MEDPLUM_PROJECT_ID=your_project_id
   NEXT_PUBLIC_MEDPLUM_CLIENT_ID=your_client_id
   MEDPLUM_CLIENT_SECRET=your_client_secret
   NEXT_PUBLIC_MEDPLUM_RECAPTCHA_SITE_KEY=your_recaptcha_site_key
   ```

   The other variables can be left as is.

3. Run the development server:
   ```bash
   pnpm dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Patient Registration and Sign-In

1. **New users**: On the home page, click "Register here" to create a new patient account
2. **Existing users**: Sign in with your Medplum Patient credentials (non-Patient accounts are not supported)

### Creating a SMART Health Link

1. After signing in, click on "Add Sample Data" if needed
2. Click "Create SMART Health Link"
3. Set a passcode (minimum 6 characters); optionally set label and `L` flag
4. Submit the form; the server will:
   - Build a FHIR Bundle and a SMART Health Card from your Medplum data
   - Encrypt and upload the bundle as JWE files using Medplum `Binary` FHIR resources inside `DocumentReference` resources
   - Persist SHL payload and manifest builder attributes in Medplum as FHIR `DocumentManifest` resources (which point to the `DocumentReference` resources that hold the JWE files)
5. You'll get a `shlink:/...` URI and a button to open the viewer

### Viewing a SMART Health Link

1. Navigate to `/viewer` (or open from the creation screen)
2. Paste the SMART Health Link URI (or it is pre-filled when opened via button)
3. Enter the passcode and your name as the recipient
4. Click "View Health Information" to resolve and decrypt the link content

## Development

### Project Structure

```
demo/medplum-shl/
├── app/
│   ├── api/
│   │   └── shl/
│   │       ├── route.ts                # POST /api/shl - Create SHLs
│   │       └── manifests/
│   │           └── [entropy]/
│   │               └── manifest.json/
│   │                   └── route.ts    # POST manifest endpoint
│   │       └── files/proxy/
│   │           └── route.ts            # GET file endpoint (proxy to Medplum's S3 presigned URLs)
│   ├── viewer/
│   │   └── page.tsx                    # SHL viewer page
│   ├── layout.tsx
│   ├── page.tsx                        # Home page - SHL creation
│   └── root.tsx
├── components/
│   ├── CreateSHLForm.tsx               # Form for creating SHLs
│   ├── RegisterForm.tsx                # Form for patient registration
│   └── SHLDisplay.tsx                  # Component for displaying created SHLs
├── lib/
│   ├── auth.ts                         # Passcode hashing and verification
│   ├── medplum-file-handlers.ts        # JWE file upload/URL generation for SHL files
│   └── medplum-storage.ts              # FHIR-based SHL storage using Medplum resources
├── package.json
└── README.md
```

### API Endpoints

- **`POST /api/shl`**: Create a new SMART Health Link (requires Medplum bearer token)
- **`POST /api/shl/manifests/[entropy]/manifest.json`**: Serve SHL manifests (passcode enforced)
- **`GET /api/shl/files/proxy`**: Proxy to serve files from Medplum's S3 presigned URLs (`Binary` URLs are not allowed to be accessed directly from the client side due to CORS issues)

### Data Storage

All SHL data is stored as FHIR resources in Medplum:

- **`DocumentManifest`**: Stores SHL payload, manifest builder attributes, hashed passcodes, references to `DocumentReference` resources that hold the JWE files
- **`DocumentReference`**: Stores individual JWE file metadata and a reference to the `Binary` resource that stores the JWE file content
- **`AuditEvent`**: Tracks all SHL access attempts for audit trail
