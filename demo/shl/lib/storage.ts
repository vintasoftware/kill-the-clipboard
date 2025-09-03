import { SerializedSHLManifestBuilder } from 'kill-the-clipboard';
import fs from 'fs/promises';
import path from 'path';

// Simple file-based storage for demo purposes
// In production, this should be replaced with a proper database like PostgreSQL

const STORAGE_DIR = path.join(process.cwd(), '.shl-storage');
const MANIFESTS_FILE = path.join(STORAGE_DIR, 'manifests.json');
const PASSCODES_FILE = path.join(STORAGE_DIR, 'passcodes.json');

interface StoredManifest {
  entropy: string;
  builderState: SerializedSHLManifestBuilder;
  createdAt: string;
  userId?: string;
}

interface StoredPasscode {
  entropy: string;
  hashedPasscode: string;
  createdAt: string;
}

// Ensure storage directory exists
async function ensureStorageDir() {
  try {
    await fs.access(STORAGE_DIR);
  } catch {
    await fs.mkdir(STORAGE_DIR, { recursive: true });
  }
}

// Load data from JSON file
async function loadJsonFile<T>(filePath: string): Promise<T[]> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// Save data to JSON file
async function saveJsonFile<T>(filePath: string, data: T[]): Promise<void> {
  await ensureStorageDir();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

export async function storeManifestBuilder(
  entropy: string,
  builderState: SerializedSHLManifestBuilder,
  userId?: string
): Promise<void> {
  const manifests = await loadJsonFile<StoredManifest>(MANIFESTS_FILE);

  const newManifest: StoredManifest = {
    entropy,
    builderState,
    createdAt: new Date().toISOString(),
    userId,
  };

  // Remove any existing manifest with the same entropy
  const filteredManifests = manifests.filter(m => m.entropy !== entropy);
  filteredManifests.push(newManifest);

  await saveJsonFile(MANIFESTS_FILE, filteredManifests);
}

export async function getManifestBuilder(entropy: string): Promise<SerializedSHLManifestBuilder | null> {
  const manifests = await loadJsonFile<StoredManifest>(MANIFESTS_FILE);
  const manifest = manifests.find(m => m.entropy === entropy);
  return manifest?.builderState || null;
}

export async function storePasscode(entropy: string, hashedPasscode: string): Promise<void> {
  const passcodes = await loadJsonFile<StoredPasscode>(PASSCODES_FILE);

  const newPasscode: StoredPasscode = {
    entropy,
    hashedPasscode,
    createdAt: new Date().toISOString(),
  };

  // Remove any existing passcode with the same entropy
  const filteredPasscodes = passcodes.filter(p => p.entropy !== entropy);
  filteredPasscodes.push(newPasscode);

  await saveJsonFile(PASSCODES_FILE, filteredPasscodes);
}

export async function getStoredPasscode(entropy: string): Promise<string | null> {
  const passcodes = await loadJsonFile<StoredPasscode>(PASSCODES_FILE);
  const passcode = passcodes.find(p => p.entropy === entropy);
  return passcode?.hashedPasscode || null;
}
