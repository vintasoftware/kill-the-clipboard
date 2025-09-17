# SMART Health Links (SHL) Demo

This is a Next.js demo application that demonstrates SMART Health Links (SHL) functionality using International Patient Summary (IPS) data and the `kill-the-clipboard` library.

## What this demo implements

- **International Patient Summary (IPS) Integration**: Uses IPS-formatted FHIR Bundle data as defined by the [HL7 IPS Implementation Guide](https://hl7.org/fhir/uv/ips/) for demonstrating comprehensive patient health information display
- **SMART Health Link Generator**: Creates SMART Health Links that point to a manifest; `U` flag unsupported
    - **ID-based Database Design**: Uses server-generated CUID 2 IDs for identifying SHLs in the database
    - **Passcode protection (`P` flag)**: Server-enforced passcode prompted on the viewer; passcodes are stored as Argon2id hashes in SQLite database using OWASP recommended security parameters
    - **Persistent SHL Storage**: Complete SHL payloads, `SHLManifestBuilder` state, and passcode hashes stored in SQLite database using Prisma ORM with proper relational structure
    - **File storage**: Encrypted JWE files persisted to local filesystem (development) or Cloudflare R2 (production)
    - **QR code rendering**: Rendering of SHL QR codes using `qr` library
- **SMART Health Link Viewer**: Resolves `shlink:/...`, prompts for passcode if needed, fetches manifest, decrypts files, and displays FHIR resources
    - **Manifest serving**: POST manifest endpoint; embeds JWEs ≤ 4 KiB, otherwise returns JWE file URLs
    - **Optional long-term flag (`L`)**: Flag is settable on creation; no polling implemented yet
    - **Failed attempt tracking**: Tracks failed passcode attempts and permanently invalidates SHLs after exceeding the configured limit (default: 100 attempts)
    - **Recipient tracking**: Records the name and access time of each recipient who successfully accesses an SHL

## URL Paths

- **SHL Generator** (`/`): Create SHLs
- **SHL Generation API** (`/api/shl`): Server-side SHL generation
- **SHL Viewer** (`/viewer`): Resolve and display SHLs
- **Manifest API** (`/api/shl/manifests/[entropy]/manifest.json`): Serve SHL manifests

## Important limitations

- Static International Patient Summary (IPS) data only - no real patient data integration
- No polling for SHLs with `L` flag
- No rate limiting for manifest requests
- No authentication or user management (uses static demo data)

## Setup

### Prerequisites

- Node.js 20.19.0 or higher
- pnpm package manager
- SQLite (for database storage)

### Installation

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Copy the example environment variables:
   ```bash
   cp .env.example .env.local
   ```

3. Set up the database:
   ```bash
   npx prisma migrate dev
   ```

4. Run the development server:
   ```bash
   pnpm dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Creating a SMART Health Link

1. Open the home page at `http://localhost:3000`
2. The page displays a comprehensive International Patient Summary with all standard IPS sections
3. Click "Create SMART Health Link" to generate a SHL from this IPS data
4. Set a passcode (minimum 6 characters); optionally set label and `L` flag
5. Submit the form; the server will:
   - Generate a server-managed CUID 2-based ID for the SHL
   - Use the static IPS Bundle data and create a SMART Health Card 
   - Encrypt and save the bundle as JWE files to the local filesystem
   - Persist SHL payload, manifest builder attributes, and passcode hash in SQLite database using Prisma
6. You'll get a `shlink:/...` URI and a button to open the viewer

### Viewing a SMART Health Link

1. Navigate to `/viewer` (or open from the creation screen)
2. Paste the SMART Health Link URI (or it is pre-filled when opened via button)
3. Enter the passcode and your name as the recipient
4. Click "View Health Information" to resolve and decrypt the link content, displaying the International Patient Summary

## Development

### Project Structure

```
demo/shl/
├── app/
│   ├── api/
│   │   └── shl/
│   │       ├── route.ts                # POST /api/shl - Create SHLs
│   │       └── manifests/
│   │           └── [entropy]/
│   │               └── manifest.json/
│   │                   └── route.ts    # POST manifest endpoint
│   ├── viewer/
│   │   └── page.tsx                    # SHL viewer page
│   ├── layout.tsx
│   ├── page.tsx                        # Home page - SHL creation
│   └── root.tsx
├── components/
│   ├── CreateSHLForm.tsx               # Form for creating SHLs
│   ├── PatientDataBundleDisplay.tsx    # IPS data display component with table format
│   ├── PatientDataControl.tsx          # Manager for loading and displaying IPS data
│   └── SHLDisplay.tsx                  # Component for displaying created SHLs
├── data/
│   └── Bundle-bundle-ips-all-sections.json # IPS FHIR Bundle sample data
├── lib/
│   ├── auth.ts                         # Passcode hashing and verification
│   ├── filesystem-file-handlers.ts     # JWE file upload/storage for SHL files (filesystem)
│   ├── r2-file-handlers.ts             # JWE file upload/storage for SHL files (Cloudflare R2)
│   ├── storage-factory.ts              # Environment-aware storage backend selector
│   └── storage.ts                      # Prisma database storage CRUD functions
├── prisma/
│   ├── migrations/                     # Database migration files
│   └── schema.prisma                   # Prisma schema definition
├── package.json
└── README.md
```

### API Endpoints

- **`POST /api/shl`**: Create a new SMART Health Link
- **`POST /api/shl/manifests/[entropy]/manifest.json`**: Serve SHL manifests (passcode enforced)
- **`GET /api/shl/files/[fileId]`**: Serve encrypted JWE files (development/filesystem storage only)

### Database Schema

The demo uses a relational database schema with the following tables:

- **`shls`**: Stores complete SHL payloads with server-generated CUID 2 IDs
- **`manifests`**: Stores `SHLManifestBuilder` attributes linked to SHL IDs
- **`manifest_files`**: Stores metadata about JWE files
- **`passcodes`**: Stores Argon2id-hashed passcodes and failure tracking linked to SHL IDs
- **`recipients`**: Tracks recipient access with SHL ID, recipient name, and access time

### Database Management

For development purposes, you can inspect and manage the database using Prisma Studio:

```bash
# from demo/shl directory
npx prisma studio
```

This will open a web interface at [http://localhost:5555](http://localhost:5555) where you can view and edit the DB tables.
