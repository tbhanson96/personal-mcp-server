import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { deflateRawSync, inflateRawSync } from 'zlib';

const CURRENT_TOKEN_PREFIX = 'pmd2';
const LEGACY_TOKEN_PREFIX = 'pmd1';
const AAD_V1 = Buffer.from('personal-media-download:v1', 'utf8');
const AAD_V2 = Buffer.from('personal-media-download:v2', 'utf8');

export function encryptMediaDownloadLink(link: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  cipher.setAAD(AAD_V2);

  const compressedLink = deflateRawSync(Buffer.from(link, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(compressedLink),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    CURRENT_TOKEN_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptMediaDownloadLink(token: string, secret: string): string {
  const normalizedToken = token.trim().replace(/\s+/g, '');
  const [prefix, ivText, tagText, ciphertextText] = normalizedToken.split('.');
  if ((prefix !== CURRENT_TOKEN_PREFIX && prefix !== LEGACY_TOKEN_PREFIX) || !ivText || !tagText || !ciphertextText) {
    throw new Error('Invalid personal media download token');
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivText, 'base64url'));
    decipher.setAAD(prefix === CURRENT_TOKEN_PREFIX ? AAD_V2 : AAD_V1);
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64url')),
      decipher.final(),
    ]);

    if (prefix === LEGACY_TOKEN_PREFIX) {
      return plaintext.toString('utf8');
    }

    return inflateRawSync(plaintext).toString('utf8');
  } catch {
    throw new Error('Invalid personal media download token');
  }
}

function deriveKey(secret: string): Buffer {
  return createHash('sha256')
    .update('personal-media-download-token:v1', 'utf8')
    .update(secret, 'utf8')
    .digest();
}
