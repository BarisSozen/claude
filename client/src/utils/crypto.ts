/**
 * Client-side cryptographic utilities for session key management
 * Uses Web Crypto API and viem for Ethereum key generation
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';

export interface SessionKeyPair {
  privateKey: Hex;
  address: Address;
}

export interface EncryptedSessionKey {
  encryptedData: string;
  iv: string;
  salt: string;
}

/**
 * Generate a new session key pair
 * Returns the private key and derived address
 */
export function generateSessionKey(): SessionKeyPair {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);

  return {
    privateKey,
    address: account.address,
  };
}

/**
 * Derive an encryption key from a signature
 * The user signs a message and we derive an AES key from it
 */
async function deriveKeyFromSignature(signature: Hex): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const signatureBytes = hexToBytes(signature);

  // Import the signature as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    signatureBytes.slice(0, 32), // Use first 32 bytes
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  // Derive an AES-GCM key
  const salt = encoder.encode('defi-bot-session-key-v1');
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a session key private key using a signature-derived key
 * @param privateKey - The session key private key to encrypt
 * @param signature - A signature from the user's wallet to derive the encryption key
 */
export async function encryptSessionKey(
  privateKey: Hex,
  signature: Hex
): Promise<string> {
  const key = await deriveKeyFromSignature(signature);

  // Generate a random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt the private key
  const encoder = new TextEncoder();
  const data = encoder.encode(privateKey);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  // Combine IV and encrypted data, encode as base64
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return bytesToBase64(combined);
}

/**
 * Decrypt a session key (for local use only - never send decrypted keys to server)
 * @param encryptedKey - The encrypted session key
 * @param signature - The same signature used for encryption
 */
export async function decryptSessionKey(
  encryptedKey: string,
  signature: Hex
): Promise<Hex> {
  const key = await deriveKeyFromSignature(signature);

  // Decode and split IV and data
  const combined = base64ToBytes(encryptedKey);
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  const decoder = new TextDecoder();
  return decoder.decode(decrypted) as Hex;
}

/**
 * Generate the encryption signature message
 * User signs this to derive the encryption key
 */
export function getEncryptionSignatureMessage(walletAddress: Address): string {
  return `DeFi Bot Session Key Encryption\n\nThis signature will be used to encrypt your session key. It will not be stored or transmitted.\n\nWallet: ${walletAddress}\nTimestamp: ${Date.now()}`;
}

// Utility functions
function hexToBytes(hex: Hex): Uint8Array {
  const bytes = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
