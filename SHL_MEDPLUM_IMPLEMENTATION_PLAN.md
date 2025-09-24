# SHL Demo Implementation Plan: Medplum-based Backend

This document outlines the implementation plan for migrating the SHL Demo from a Next.js server with SQLite database to use Medplum exclusively as the backend DB, storing all data as FHIR resources. A Next.js server will still be necessary for serving the SHL API routes (generation and serving manifests), as Medplum bots do not support URL parameters (in our case, the entropy parameter).

## Overview

The current SHL Demo uses a relational database with Prisma as the ORM. We will map this data structure to FHIR resources, primarily using `DocumentManifest` and `DocumentReference`.

## Data migration

No data migration is needed. This is a demo project, so we can start fresh.

## FHIR Resource Mapping

### DocumentManifest

**Purpose**: Represents the SHL and its collection of manifest files.

**Key Mappings**:
- `identifier[0]`: Store SHL entropy/key for efficient lookup
- `created`: Creation timestamp
- `content[]`: References to DocumentReference resources (manifest files)
- `extension[]`: Custom extensions for SHL-specific data
  - SHL payload (JSON serialized)
  - Label
  - Flags (long-term, passcode, direct file)
  - Expiration date (if applicable)
  - Hashed passcode
  - Failed attempts counter
  - Invalidation status

**Example Structure**:
```typescript
{
  resourceType: 'DocumentManifest',
  status: 'current',
  identifier: [
    {
      system: 'https://kill-the-clipboard.vercel.app/fhir/codesystem/shl-entropy',
      value: shlEntropyKey
    }
  ],
  created: '2025-01-01T00:00:00Z',
  content: [
    { reference: 'DocumentReference/manifest-file-1' },
    { reference: 'DocumentReference/manifest-file-2' }
  ],
  extension: [
    {
      url: 'https://kill-the-clipboard.vercel.app/fhir/extension/shl-payload',
      valueString: JSON.stringify(shlPayload)
    },
    {
      url: 'https://kill-the-clipboard.vercel.app/fhir/extension/shl-label',
      valueString: 'Patient Summary'
    },
    {
      url: 'https://kill-the-clipboard.vercel.app/fhir/extension/shl-flag',
      valueString: 'LP'
    },
    {
      url: 'https://kill-the-clipboard.vercel.app/fhir/extension/hashed-passcode',
      valueString: hashedPasscode
    },
    {
      url: 'https://kill-the-clipboard.vercel.app/fhir/extension/failed-attempts',
      valueInteger: 0
    },
    {
      url: 'https://kill-the-clipboard.vercel.app/fhir/extension/is-invalidated',
      valueBoolean: false
    },
  ]
}
```

### DocumentReference

**Purpose**: Represents each individual manifest file with its metadata and passcode information.

**Key Mappings**:
- `content[0].attachment`: Link to Binary resource containing encrypted JWE file
- `type`: Map from `SHLFileContentType` to CodeableConcept
- `date`: Creation timestamp
- `extension[]`: Custom extensions for SHL-specific metadata
  - Ciphertext length
  - Last updated timestamp

**Example Structure**:
```typescript
{
  resourceType: 'DocumentReference',
  status: 'current',
  type: {
    coding: [{
      system: 'https://kill-the-clipboard.vercel.app/fhir/codesystem/manifest-file-type',
      code: 'application/smart-health-card',
      display: 'SMART Health Card'
    }]
  },
  date: '2025-01-01T00:00:00Z',
  content: [{
    attachment: {
      contentType: 'application/jose',
      url: 'Binary/encrypted-jwe-file-123'
    }
  }],
  extension: [
    {
      url: 'https://kill-the-clipboard.vercel.app/fhir/extension/ciphertext-length',
      valueInteger: 1024
    },
    {
      url: 'https://kill-the-clipboard.vercel.app/fhir/extension/last-updated',
      valueDateTime: '2025-01-01T00:00:00Z'
    }
  ]
}
```

### AuditEvent

**Purpose**: Track recipient access to SHLs for audit trail.

**Key Mappings**:
- `recorded`: Access timestamp
- `agent[0].name`: Recipient name
- `entity[0].what`: Reference to DocumentManifest (the SHL)
- `outcome`: Success/failure status
- `extension[]`: Additional tracking data

**Example Structure**:
```typescript
{
  resourceType: 'AuditEvent',
  type: {
    system: 'http://dicom.nema.org/resources/ontology/DCM',
    code: '110110',
    display: 'Patient Record has been read via SMART Health Link'
  },
  action: 'R',
  recorded: '2025-01-01T12:00:00Z',
  outcome: '0',
  agent: [{
    type: {
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/extra-security-role-type',
        code: 'humanuser'
      }]
    },
    name: recipientName
  }],
  entity: [{
    what: {
      reference: `DocumentManifest/${shlManifestId}`
    }
  }]
}
```

## Implementation Strategy

### Search Strategies

See: https://www.medplum.com/docs/search/basic-search

**Find SHL by entropy**:
```typescript
const manifest = await medplum.searchOne('DocumentManifest', {
  identifier: shlEntropyKey
});
```

**Get manifest files for SHL**:
```typescript
const files = await Promise.all(
  manifest.content.map(ref => 
    medplum.readReference(ref)
  )
);
```

**Track recipient access**:
```typescript
await medplum.createResource({
  resourceType: 'AuditEvent',
  // ... audit event structure
});
```

**Update passcode attempts**:
```typescript
// Get DocumentReference, update extension, save
const docRef = await medplum.readResource('DocumentReference', fileId);
const failedAttemptsExt = docRef.extension.find(
  ext => ext.url === 'https://kill-the-clipboard.vercel.app/fhir/extension/failed-attempts'
);
failedAttemptsExt.valueInteger += 1;
await medplum.updateResource(docRef);
```

### Frontend Changes

**Authentication**: Frontend needs to handle Medplum OAuth2 authentication. All operations require auth.

### Backend API Changes

**Authentication**: Backend needs to check Medplum OAuth2 token sent by the frontend.

## File Storage Strategy

See: https://www.medplum.com/docs/fhir-datastore/binary-data

### Binary Resources for Encrypted Files

Use Medplum's Attachment (wraps a Binary resource) resource system instead of filesystem/R2:

```typescript
// Upload encrypted file
const attachment = await medplum.createAttachment({
  data: encryptedJWE,
  filename: `manifest-${fileId}.jwe`,
  contentType: 'application/jose'
});

// Link in DocumentReference
const docRef = await medplum.createResource({
  resourceType: 'DocumentReference',
  content: [{
    attachment
  }]
});
```

### File Serving

Medplum Binary files are automatically converted to S3 URLs when the FHIR resource is read. No custom file serving route is needed.

## Security Considerations

### 1. Access Control

- Use Medplum's built-in authentication, both on frontend and backend
- Configure Medplum access policies to restrict SHL resource access, provide a pnpm command for that
- Consider patient compartments since SHLs are mostly patient-specific

### 2. Passcode Protection

- Store passcode hashes in DocumentReference extensions
- Implement failed attempt tracking via resource updates

### 3. Data Encryption

- Encrypted JWE files stored as Binary resources
- Passcode hashes stored in extensions (already hashed)
- Medplum already provides built-in encryption at rest for all resources

## Limitations and Trade-offs

- Multiple API calls needed to reconstruct SHL data
- FHIR search limitations compared to SQL queries
- Manual reference integrity maintenance required
- Cascade deletes need custom implementation
- Extension management complexity

## Success Criteria

1. **Functional Parity**: All current SHL Demo features work with Medplum backend (no need to support IPS-specific features)
2. **Security**: Maintains current security posture with passcode protection
3. **Maintainability**: Code remains maintainable with FHIR resource patterns
