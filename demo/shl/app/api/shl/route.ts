import { NextRequest, NextResponse } from 'next/server';
import type { Bundle } from '@medplum/fhirtypes';
import { SHL, SHLManifestBuilder, SmartHealthCardIssuer } from 'kill-the-clipboard';
import { createSHL, storeManifestBuilder, storePasscode } from '@/lib/storage';
import { hashPasscode } from '@/lib/auth';
import { createManifestFileHandlers } from '@/lib/storage-factory';
import ipsBundleData from '@/data/Bundle-bundle-ips-all-sections.json';

// Function to extract entropy from URL
const extractEntropyFromURL = (url: string): string | null => {
  // URL format: https://shl.example.org/manifests/{entropy}/manifest.json
  const match = url.match(/\/manifests\/([^/]+)\/?.*/);
  return match ? match[1] : null;
}

// Function to filter bundle based on selected sections
const filterBundleBySelections = (bundle: Bundle, selectedSections: Record<string, boolean>): Bundle => {
  if (Object.keys(selectedSections).length === 0) {
    // If no selections provided, include all sections (default behavior)
    return bundle;
  }

  const filteredBundle = { ...bundle };
  const entries = Array.isArray(bundle.entry) ? [...bundle.entry] : [];

  // Find the composition
  const compositionEntry = entries.find((entry: any) => entry.resource?.resourceType === 'Composition');
  if (!compositionEntry?.resource) {
    return bundle; // Return original if no composition found
  }

  const composition = compositionEntry.resource as any;

  // Build a set of resource references to keep
  const resourcesToKeep = new Set<string>();

  // Always keep Patient and Composition
  entries.forEach((entry: any) => {
    if (entry.resource?.resourceType === 'Patient' || entry.resource?.resourceType === 'Composition') {
      resourcesToKeep.add(entry.fullUrl);
    }
  });

  // Filter composition sections and collect references to keep
  const filteredSections = composition.section?.filter((section: any) => {
    const code = section.code?.coding?.[0]?.code;
    const sectionKey = code || section.title;
    const isSelected = selectedSections[sectionKey] ?? true; // Default to selected if not specified

    if (isSelected && section.entry) {
      // Add all references from this section to the keep set
      section.entry.forEach((entry: any) => {
        if (entry.reference) {
          resourcesToKeep.add(entry.reference);
        }
      });
    }

    return isSelected;
  }) || [];

  // Update the composition with filtered sections
  const updatedComposition = {
    ...composition,
    section: filteredSections
  };

  // Filter the bundle entries to only include resources we want to keep
  const filteredEntries = entries.filter((entry: any) => {
    return resourcesToKeep.has(entry.fullUrl) ||
           resourcesToKeep.has(`${entry.resource?.resourceType}/${entry.resource?.id}`);
  });

  // Update the composition entry
  const compositionIndex = filteredEntries.findIndex((entry: any) => entry.resource?.resourceType === 'Composition');
  if (compositionIndex >= 0) {
    filteredEntries[compositionIndex] = {
      ...filteredEntries[compositionIndex],
      resource: updatedComposition
    };
  }

  return {
    ...filteredBundle,
    entry: filteredEntries
  };
};

interface CreateSHLRequest {
  passcode: string;
  label?: string;
  longTerm: boolean;
  selectedSections?: Record<string, boolean>;
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateSHLRequest = await request.json();
    const { passcode, label, longTerm, selectedSections = {} } = body;

    // Validate required fields
    if (!passcode) {
      return NextResponse.json({ error: 'Passcode is required' }, { status: 400 });
    }

    // Get the base URL for manifest construction
    const baseManifestURL = process.env.SHL_SERVER_BASE_URL! + '/manifests/'

    // Create SHL instance
    const shl = SHL.generate({
      baseManifestURL: baseManifestURL,
      manifestPath: 'manifest.json',
      flag: longTerm ? 'LP' : 'P', // P for passcode, LP for long-term + passcode
      label,
    });

    // Extract entropy from the manifest URL for database storage
    const entropy = extractEntropyFromURL(shl.url);
    if (!entropy) {
      return NextResponse.json({ error: 'Invalid manifest URL' }, { status: 500 });
    }

    // Store the SHL payload in database and get the generated ID
    const shlId = await createSHL(shl.payload, entropy);

    // Create manifest builder with filesystem file storage
    const manifestBuilder = new SHLManifestBuilder({
      shl,
      ...createManifestFileHandlers(),
    });

    // Use the static IPS bundle data and filter based on selections
    const originalBundle: Bundle = ipsBundleData as Bundle;
    const fhirBundle: Bundle = filterBundleBySelections(originalBundle, selectedSections);

    // Add the FHIR bundle to the manifest
    await manifestBuilder.addFHIRResource({ content: fhirBundle, enableCompression: false });

    // Add the FHIR bundle as a SMART Health Card to the manifest
    const shcIssuer = new SmartHealthCardIssuer({
      issuer: process.env.SHC_ISSUER!,
      privateKey: JSON.parse(process.env.SHC_PRIVATE_KEY!),
      publicKey: JSON.parse(process.env.SHC_PUBLIC_KEY!),
      strictReferences: false,
    });
    fhirBundle.type = 'collection';  // Required by SMART Health Cards spec
    const shc = await shcIssuer.issue(fhirBundle);
    await manifestBuilder.addHealthCard({ shc, enableCompression: false });

    // Store the manifest builder state in database using the SHL ID
    await storeManifestBuilder(shlId, manifestBuilder.toDBAttrs());

    // Hash and store the passcode using the SHL ID
    const { hash } = await hashPasscode(passcode);
    await storePasscode(shlId, hash);

    // Return the SHL URI
    const shlUri = shl.toURI();

    return NextResponse.json({
      shlUri,
    });

  } catch (error) {
    console.error('Error creating SHL:', error);
    return NextResponse.json(
      { error: `Failed to create SMART Health Link: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
