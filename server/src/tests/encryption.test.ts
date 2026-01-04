/**
 * Encryption Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the config
vi.mock('../config/env.js', () => ({
  config: {
    encryption: {
      key: Buffer.from('0'.repeat(64), 'hex'), // 32 byte test key
    },
  },
}));

describe('Encryption Service', () => {
  describe('encryptPrivateKey / decryptPrivateKey', () => {
    it('should encrypt and decrypt a private key correctly', async () => {
      const { encryptPrivateKey, decryptPrivateKey } = await import('../services/encryption.js');

      const originalKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

      const encrypted = encryptPrivateKey(originalKey);

      // Encrypted format should be iv:authTag:ciphertext
      expect(encrypted.split(':').length).toBe(3);

      const decrypted = decryptPrivateKey(encrypted);

      expect(decrypted).toBe(originalKey);
    });

    it('should produce different ciphertexts for same input', async () => {
      const { encryptPrivateKey } = await import('../services/encryption.js');

      const originalKey = '0x1234567890abcdef';

      const encrypted1 = encryptPrivateKey(originalKey);
      const encrypted2 = encryptPrivateKey(originalKey);

      // Due to random IV, each encryption should be different
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should throw on tampered data', async () => {
      const { encryptPrivateKey, decryptPrivateKey } = await import('../services/encryption.js');

      const originalKey = '0x1234567890abcdef';
      const encrypted = encryptPrivateKey(originalKey);

      // Tamper with the encrypted data
      const parts = encrypted.split(':');
      parts[2] = parts[2].replace(/[a-f]/g, '0'); // Modify ciphertext
      const tampered = parts.join(':');

      expect(() => decryptPrivateKey(tampered)).toThrow();
    });
  });

  describe('generateNonce', () => {
    it('should generate unique nonces', async () => {
      const { generateNonce } = await import('../services/encryption.js');

      const nonce1 = generateNonce();
      const nonce2 = generateNonce();

      expect(nonce1).not.toBe(nonce2);
      expect(nonce1.length).toBe(64); // 32 bytes hex encoded
    });
  });

  describe('secureCompare', () => {
    it('should return true for equal strings', async () => {
      const { secureCompare } = await import('../services/encryption.js');

      expect(secureCompare('test123', 'test123')).toBe(true);
    });

    it('should return false for different strings', async () => {
      const { secureCompare } = await import('../services/encryption.js');

      expect(secureCompare('test123', 'test124')).toBe(false);
    });

    it('should return false for different length strings', async () => {
      const { secureCompare } = await import('../services/encryption.js');

      expect(secureCompare('test', 'test123')).toBe(false);
    });
  });
});
