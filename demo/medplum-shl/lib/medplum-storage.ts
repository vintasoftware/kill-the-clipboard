import { MedplumClient } from '@medplum/core';
import { DocumentManifest, DocumentReference, AuditEvent, Extension } from '@medplum/fhirtypes';
import { SHLManifestBuilderDBAttrs, SHLPayloadV1, SHLFileContentType } from 'kill-the-clipboard';


const EXTENSION_URLS = {
  SHL_PAYLOAD: 'https://kill-the-clipboard.vercel.app/fhir/extension/shl-payload',
  SHL_LABEL: 'https://kill-the-clipboard.vercel.app/fhir/extension/shl-label',
  SHL_FLAG: 'https://kill-the-clipboard.vercel.app/fhir/extension/shl-flag',
  HASHED_PASSCODE: 'https://kill-the-clipboard.vercel.app/fhir/extension/hashed-passcode',
  EXPIRATION_DATE: 'https://kill-the-clipboard.vercel.app/fhir/extension/expiration-date',
  FAILED_ATTEMPTS: 'https://kill-the-clipboard.vercel.app/fhir/extension/failed-attempts',
  IS_INVALIDATED: 'https://kill-the-clipboard.vercel.app/fhir/extension/is-invalidated',
  CIPHERTEXT_LENGTH: 'https://kill-the-clipboard.vercel.app/fhir/extension/ciphertext-length',
  LAST_UPDATED: 'https://kill-the-clipboard.vercel.app/fhir/extension/last-updated',
} as const;

// FHIR-based storage for Medplum backend
export class MedplumStorage {
  constructor(private medplum: MedplumClient) {}

  /**
   * Store SHL data as DocumentManifest with extensions
   * Creates DocumentReferences for each file first, then the DocumentManifest
   */
  async storeManifestBuilder({
    entropy,
    shlPayload,
    builderAttrs,
    hashedPasscode
  }: {
    entropy: string,
    shlPayload: SHLPayloadV1,
    builderAttrs: SHLManifestBuilderDBAttrs,
    hashedPasscode: string
  }): Promise<DocumentManifest> {
    // First, create DocumentReference resources for each file
    const documentReferences: DocumentReference[] = [];

    if (builderAttrs.files && Array.isArray(builderAttrs.files)) {
      for (const file of builderAttrs.files) {
        const docRef = await this.createDocumentReference({
          contentType: file.type,
          ciphertextLength: file.ciphertextLength,
          binaryUrl: file.storagePath, // This is the Binary resource ID/path
          lastUpdated: file.lastUpdated
        });
        documentReferences.push(docRef);
      }
    }

    // Create extensions array
    const extensions: Extension[] = [
      {
        url: EXTENSION_URLS.SHL_PAYLOAD,
        valueString: JSON.stringify(shlPayload)
      },
    ];

    if (shlPayload.label) {
      extensions.push({
        url: EXTENSION_URLS.SHL_LABEL,
        valueString: shlPayload.label
      });
    }

    if (shlPayload.flag) {
      extensions.push({
        url: EXTENSION_URLS.SHL_FLAG,
        valueString: shlPayload.flag
      });
    }

    if (hashedPasscode) {
      extensions.push({
        url: EXTENSION_URLS.HASHED_PASSCODE,
        valueString: hashedPasscode
      });
    }

    if (shlPayload.exp) {
      extensions.push({
        url: EXTENSION_URLS.EXPIRATION_DATE,
        valueDateTime: new Date(shlPayload.exp * 1000).toISOString()
      });
    }

    // Initialize counters
    extensions.push({
      url: EXTENSION_URLS.FAILED_ATTEMPTS,
      valueInteger: 0
    });

    extensions.push({
      url: EXTENSION_URLS.IS_INVALIDATED,
      valueBoolean: false
    });

    // Create content references from the created DocumentReferences
    const content = documentReferences.map(docRef => ({
      reference: `DocumentReference/${docRef.id}`
    }));

    const manifest: DocumentManifest = {
      resourceType: 'DocumentManifest',
      status: 'current',
      identifier: [{
        system: 'https://kill-the-clipboard.vercel.app/fhir/codesystem/shl-entropy',
        value: entropy
      }],
      created: new Date().toISOString(),
      content: content,
      extension: extensions
    };

    return await this.medplum.createResource(manifest);
  }

  /**
   * Create a DocumentReference for a manifest file (internal method)
   */
  private async createDocumentReference(
    fileConfig: {
      contentType: string;
      ciphertextLength: number;
      binaryUrl: string;
      lastUpdated?: string;
    }
  ): Promise<DocumentReference> {
    // Map content type to FHIR coding
    const getTypeFromContentType = (contentType: string) => {
      const typeMap: Record<string, { code: string; display: string }> = {
        'application/smart-health-card': {
          code: 'application/smart-health-card',
          display: 'SMART Health Card'
        },
        'application/fhir+json': {
          code: 'application/fhir+json',
          display: 'FHIR Resource'
        },
        'application/smart-api-access': {
          code: 'application/smart-api-access',
          display: 'SMART API Access'
        }
      };

      return typeMap[contentType] || { code: contentType, display: contentType };
    };

    const typeInfo = getTypeFromContentType(fileConfig.contentType);

    const docRef: DocumentReference = {
      resourceType: 'DocumentReference',
      status: 'current',
      type: {
        coding: [{
          system: 'https://kill-the-clipboard.vercel.app/fhir/codesystem/manifest-file-type',
          code: typeInfo.code,
          display: typeInfo.display
        }]
      },
      date: new Date().toISOString(),
      content: [{
        attachment: {
          contentType: 'application/jose',
          url: fileConfig.binaryUrl
        }
      }],
      extension: [
        {
          url: EXTENSION_URLS.CIPHERTEXT_LENGTH,
          valueInteger: fileConfig.ciphertextLength
        },
        {
          url: EXTENSION_URLS.LAST_UPDATED,
          valueDateTime: fileConfig.lastUpdated || new Date().toISOString()
        }
      ]
    };

    return await this.medplum.createResource(docRef);
  }

  /**
   * Get Manifest Builder attributes and SHL payload by entropy key
   */
  async getBuilderAttrsAndSHL(
    entropy: string
  ): Promise<{ shlPayload: SHLPayloadV1 | null, builderAttrs: SHLManifestBuilderDBAttrs | null }> {
    let shlPayload: SHLPayloadV1 | null = null;
    let builderAttrs: SHLManifestBuilderDBAttrs | null = null;

    const manifest = await this.medplum.searchOne('DocumentManifest', {
      identifier: entropy
    });

    if (!manifest) {
      return { shlPayload: null, builderAttrs: null }
    }

    // Find the SHL payload extension
    const payloadExtension = manifest.extension?.find(
      (ext: Extension) => ext.url === EXTENSION_URLS.SHL_PAYLOAD
    );

    if (!payloadExtension?.valueString) {
      return { shlPayload: null, builderAttrs: null }
    }

    shlPayload = JSON.parse(payloadExtension.valueString);

    // Get DocumentReference resources referenced in the manifest
    if (manifest.content.length === 0) {
      builderAttrs = { files: [] };
    } else {
      // Fetch all DocumentReference resources
      const documentReferences = await Promise.all(
        manifest.content.map(ref => this.medplum.readReference(ref) as Promise<DocumentReference>)
      );

      // Extract SHLManifestFileDBAttrs from each DocumentReference
      const files = documentReferences
        .filter((docRef): docRef is DocumentReference => docRef !== null)
        .map(docRef => {
          // Extract content type from the type coding
          const contentType = docRef.type?.coding?.[0]?.code || 'application/fhir+json';

          // Get the attachment URL (this is already the final presigned S3 URL when read from Medplum)
          // This will be used through the proxy route to bypass CORS issues
          // See `getSHLFileURL` in medplum-file-handlers.ts for more details
          const storagePath = docRef.content?.[0]?.attachment?.url || '';

          // Extract ciphertext length from extension
          const ciphertextLengthExt = docRef.extension?.find(
            ext => ext.url === EXTENSION_URLS.CIPHERTEXT_LENGTH
          );
          const ciphertextLength = ciphertextLengthExt?.valueInteger || 0;

          // Extract last updated from extension
          const lastUpdatedExt = docRef.extension?.find(
            ext => ext.url === EXTENSION_URLS.LAST_UPDATED
          );
          const lastUpdated = lastUpdatedExt?.valueDateTime;

          return {
            type: contentType as SHLFileContentType,
            storagePath,
            ciphertextLength,
            lastUpdated
          };
        });

      builderAttrs = { files };
    }

    return { shlPayload, builderAttrs };
  }

  /**
   * Get stored passcode hash by entropy
   */
  async getStoredPasscode(entropy: string): Promise<string | null> {
    try {
      const manifest = await this.medplum.searchOne('DocumentManifest', {
        identifier: entropy
      });

      if (!manifest) {
        return null;
      }

      const passcodeExtension = manifest.extension?.find(
        (ext: Extension) => ext.url === EXTENSION_URLS.HASHED_PASSCODE
      );

      return passcodeExtension?.valueString || null;
    } catch (error) {
      console.error('Error getting stored passcode:', error);
      return null;
    }
  }

  /**
   * Check if SHL is invalidated
   */
  async isSHLInvalidated(entropy: string): Promise<boolean> {
    try {
      const manifest = await this.medplum.searchOne('DocumentManifest', {
        identifier: entropy
      });

      if (!manifest) {
        return true; // Consider non-existent SHLs as invalidated
      }

      const invalidatedExtension = manifest.extension?.find(
        (ext: Extension) => ext.url === EXTENSION_URLS.IS_INVALIDATED
      );

      return invalidatedExtension?.valueBoolean || false;
    } catch (error) {
      console.error('Error checking SHL invalidation:', error);
      return true;
    }
  }

  /**
   * Increment failed attempts and potentially invalidate SHL
   */
  async incrementFailedAttempts(entropy: string, maxAttempts: number): Promise<{ invalidated: boolean; attempts: number }> {
    try {
      const manifest = await this.medplum.searchOne('DocumentManifest', {
        identifier: entropy
      });

      if (!manifest) {
        throw new Error(`DocumentManifest not found for entropy: ${entropy}`);
      }

      // Find and update failed attempts extension
      const extensions = [...(manifest.extension || [])];
      const attemptsIndex = extensions.findIndex(
        ext => ext.url === EXTENSION_URLS.FAILED_ATTEMPTS
      );

      const currentAttempts = (extensions[attemptsIndex]?.valueInteger || 0) + 1;
      extensions[attemptsIndex] = {
        url: EXTENSION_URLS.FAILED_ATTEMPTS,
        valueInteger: currentAttempts
      };

      const shouldInvalidate = currentAttempts >= maxAttempts;

      // Update invalidation status if needed
      if (shouldInvalidate) {
        const invalidatedIndex = extensions.findIndex(
          ext => ext.url === EXTENSION_URLS.IS_INVALIDATED
        );

        if (invalidatedIndex >= 0) {
          extensions[invalidatedIndex] = {
            url: EXTENSION_URLS.IS_INVALIDATED,
            valueBoolean: true
          };
        } else {
          extensions.push({
            url: EXTENSION_URLS.IS_INVALIDATED,
            valueBoolean: true
          });
        }
      }

      // Update the resource
      await this.medplum.updateResource({
        ...manifest,
        extension: extensions
      });

      return {
        invalidated: shouldInvalidate,
        attempts: currentAttempts
      };
    } catch (error) {
      console.error('Error incrementing failed attempts:', error);
      throw error;
    }
  }

  /**
   * Create audit event for SHL access
   */
  async recordAccess(
    entropy: string,
    recipientName: string,
    outcome: 'success' | 'failure',
    details?: string
  ): Promise<AuditEvent> {
    try {
      const manifest = await this.medplum.searchOne('DocumentManifest', {
        identifier: entropy
      });

      if (!manifest) {
        throw new Error(`DocumentManifest not found for entropy: ${entropy}`);
      }

      const auditEvent: AuditEvent = {
        resourceType: 'AuditEvent',
        type: {
          system: 'http://dicom.nema.org/resources/ontology/DCM',
          code: '110110',
          display: 'Patient Record'
        },
        action: 'R',
        recorded: new Date().toISOString(),
        outcome: outcome === 'success' ? '0' : '4',
        source: {
          observer: {
            display: 'SHL Demo Application'
          }
        },
        agent: [{
          type: {
            coding: [{
              system: 'http://terminology.hl7.org/CodeSystem/extra-security-role-type',
              code: 'humanuser'
            }]
          },
          name: recipientName,
          requestor: true
        }],
        entity: [{
          what: {
            reference: `DocumentManifest/${manifest.id}`
          }
        }]
      };

      if (details) {
        auditEvent.entity![0].description = details;
      }

      return await this.medplum.createResource(auditEvent);
    } catch (error) {
      console.error('Error recording access:', error);
      throw error;
    }
  }

  /**
   * Get manifest files for a given SHL
   */
  async getManifestFiles(entropy: string): Promise<DocumentReference[]> {
    try {
      const manifest = await this.medplum.searchOne('DocumentManifest', {
        identifier: entropy
      });

      if (!manifest?.content) {
        return [];
      }

      // Fetch all referenced DocumentReference resources
      const files = await Promise.all(
        manifest.content.map((ref: any) => this.medplum.readReference(ref) as Promise<DocumentReference>)
      );

      return files.filter((file: DocumentReference | null): file is DocumentReference =>
        file !== null
      );
    } catch (error) {
      console.error('Error getting manifest files:', error);
      return [];
    }
  }
}

// Factory function for creating storage with authenticated Medplum client
export function createMedplumStorage(medplum: MedplumClient): MedplumStorage {
  return new MedplumStorage(medplum);
}
