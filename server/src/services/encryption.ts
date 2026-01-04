/**
 * Encryption Service
 * AES-256-GCM encryption for session keys with key rotation support
 *
 * CRITICAL: Server NEVER generates session keys
 * Client generates key pair, encrypts private key, sends to server
 * Server only decrypts when executing trades
 */

import * as crypto from 'crypto';
import { config } from '../config/env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_VERSION_LENGTH = 1;
const CURRENT_KEY_VERSION = 1;

// Support for key rotation - multiple keys can be active
interface EncryptionKey {
  version: number;
  key: Buffer;
  createdAt: Date;
  expiresAt?: Date;
}

// Key registry for rotation support
const keyRegistry: Map<number, EncryptionKey> = new Map();

// Initialize with current key
keyRegistry.set(CURRENT_KEY_VERSION, {
  version: CURRENT_KEY_VERSION,
  key: config.encryption.key,
  createdAt: new Date(),
});

/**
 * Register a new encryption key for rotation
 * Old keys are kept for decryption of existing data
 */
export function registerEncryptionKey(version: number, keyHex: string, expiresAt?: Date): void {
  if (keyHex.length !== 64) {
    throw new Error('Encryption key must be 32 bytes (64 hex chars)');
  }

  keyRegistry.set(version, {
    version,
    key: Buffer.from(keyHex, 'hex'),
    createdAt: new Date(),
    expiresAt,
  });
}

/**
 * Get the current encryption key version
 */
export function getCurrentKeyVersion(): number {
  return CURRENT_KEY_VERSION;
}

/**
 * Get key by version
 */
function getKey(version: number): Buffer {
  const keyInfo = keyRegistry.get(version);
  if (!keyInfo) {
    throw new Error(`Encryption key version ${version} not found`);
  }
  return keyInfo.key;
}

/**
 * Encrypt a private key using AES-256-GCM
 * Format: version:iv:authTag:encryptedData (all hex encoded)
 * Version byte allows for key rotation
 */
export function encryptPrivateKey(privateKey: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getKey(CURRENT_KEY_VERSION);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(privateKey, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Include version for key rotation support
  return `${CURRENT_KEY_VERSION}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a private key encrypted with encryptPrivateKey
 * Returns the original private key string
 * Supports both versioned and legacy (non-versioned) formats
 *
 * IMPORTANT: Clear the returned value from memory as soon as possible
 */
export function decryptPrivateKey(encryptedData: string): string {
  const parts = encryptedData.split(':');

  let version: number;
  let ivHex: string;
  let authTagHex: string;
  let encryptedHex: string;

  if (parts.length === 4) {
    // New versioned format
    version = parseInt(parts[0], 10);
    ivHex = parts[1];
    authTagHex = parts[2];
    encryptedHex = parts[3];
  } else if (parts.length === 3) {
    // Legacy format without version
    version = 1;
    ivHex = parts[0];
    authTagHex = parts[1];
    encryptedHex = parts[2];
  } else {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  if (iv.length !== IV_LENGTH) {
    throw new Error('Invalid IV length');
  }

  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error('Invalid auth tag length');
  }

  const key = getKey(version);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Re-encrypt data with the current key version
 * Used during key rotation to upgrade old data
 */
export function reencryptWithCurrentKey(encryptedData: string): string {
  const decrypted = decryptPrivateKey(encryptedData);
  const reencrypted = encryptPrivateKey(decrypted);

  // Clear the decrypted value from memory
  // Note: This is best-effort in JavaScript due to string immutability
  return reencrypted;
}

/**
 * Check if data needs re-encryption (uses old key)
 */
export function needsReencryption(encryptedData: string): boolean {
  const parts = encryptedData.split(':');

  if (parts.length === 3) {
    // Legacy format, needs re-encryption
    return true;
  }

  if (parts.length === 4) {
    const version = parseInt(parts[0], 10);
    return version < CURRENT_KEY_VERSION;
  }

  return false;
}

/**
 * Get key version from encrypted data
 */
export function getKeyVersion(encryptedData: string): number {
  const parts = encryptedData.split(':');

  if (parts.length === 3) {
    return 1; // Legacy format
  }

  if (parts.length === 4) {
    return parseInt(parts[0], 10);
  }

  throw new Error('Invalid encrypted data format');
}

/**
 * Generate a secure random nonce for SIWE
 */
export function generateNonce(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a message using SHA-256
 */
export function hashMessage(message: string): string {
  return crypto.createHash('sha256').update(message).digest('hex');
}

/**
 * Generate a random UUID
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Secure compare two strings (timing-attack safe)
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Derive a key from password using PBKDF2
 * (For client-side encryption if needed)
 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
}

/**
 * Generate encryption key (for setup)
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Securely clear a buffer from memory
 * Note: This is best-effort in JavaScript
 */
export function secureClear(buffer: Buffer): void {
  buffer.fill(0);
}

/**
 * Create a secure temporary buffer for sensitive data
 * The buffer will be automatically cleared when the callback completes
 */
export async function withSecureBuffer<T>(
  data: string,
  callback: (buffer: Buffer) => Promise<T>
): Promise<T> {
  const buffer = Buffer.from(data, 'utf8');
  try {
    return await callback(buffer);
  } finally {
    secureClear(buffer);
  }
}
