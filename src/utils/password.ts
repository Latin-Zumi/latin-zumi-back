import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const CURRENT_COST = 2 ** 17;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const CURRENT_MAX_MEMORY = 256 * 1024 * 1024;
const LEGACY_COST = 2 ** 14;
const LEGACY_MAX_MEMORY = 32 * 1024 * 1024;

interface ScryptOptions {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}

export interface PasswordVerification {
  valid: boolean;
  needsRehash: boolean;
}

function deriveKey(
  password: string,
  salt: string,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LENGTH, options, (error, derivedKey) => {
      if (error) return reject(error);
      resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await deriveKey(password, salt, {
    N: CURRENT_COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
    maxmem: CURRENT_MAX_MEMORY,
  });

  return `scrypt$v2$${CURRENT_COST}$${BLOCK_SIZE}$${PARALLELIZATION}$${salt}$${derivedKey.toString('hex')}`;
}

async function verifyDerivedKey(
  password: string,
  salt: string,
  expectedHex: string,
  options: ScryptOptions,
): Promise<boolean> {
  if (!/^[a-f\d]{32}$/i.test(salt) || !/^[a-f\d]{128}$/i.test(expectedHex)) {
    return false;
  }

  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await deriveKey(password, salt, options);
  return timingSafeEqual(actual, expected);
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<PasswordVerification> {
  const parts = storedHash.split('$');

  if (parts.length === 7 && parts[0] === 'scrypt' && parts[1] === 'v2') {
    const [, , cost, blockSize, parallelization, salt, expectedHex] = parts;
    if (
      Number(cost) !== CURRENT_COST ||
      Number(blockSize) !== BLOCK_SIZE ||
      Number(parallelization) !== PARALLELIZATION
    ) {
      return { valid: false, needsRehash: false };
    }

    return {
      valid: await verifyDerivedKey(password, salt, expectedHex, {
        N: CURRENT_COST,
        r: BLOCK_SIZE,
        p: PARALLELIZATION,
        maxmem: CURRENT_MAX_MEMORY,
      }),
      needsRehash: false,
    };
  }

  if (parts.length === 3 && parts[0] === 'scrypt') {
    const [, salt, expectedHex] = parts;
    return {
      valid: await verifyDerivedKey(password, salt, expectedHex, {
        N: LEGACY_COST,
        r: BLOCK_SIZE,
        p: PARALLELIZATION,
        maxmem: LEGACY_MAX_MEMORY,
      }),
      needsRehash: true,
    };
  }

  return { valid: false, needsRehash: false };
}

export function isPasswordLongEnough(password: string): boolean {
  const length = Array.from(password).length;
  return length >= 15 && length <= 128;
}

export const DUMMY_PASSWORD_HASH =
  `scrypt$v2$${CURRENT_COST}$${BLOCK_SIZE}$${PARALLELIZATION}$${'0'.repeat(32)}$${'0'.repeat(128)}`;
