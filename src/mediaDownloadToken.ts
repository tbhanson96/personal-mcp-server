import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const TOKEN_PREFIX = 'pmd1';
const AAD = Buffer.from('personal-media-download:v1', 'utf8');

export function encryptMediaDownloadLink(link: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  cipher.setAAD(AAD);

  const ciphertext = Buffer.concat([
    cipher.update(link, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    TOKEN_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptMediaDownloadLink(token: string, secret: string): string {
  const [prefix, ivText, tagText, ciphertextText] = token.split('.');
  if (prefix !== TOKEN_PREFIX || !ivText || !tagText || !ciphertextText) {
    throw new Error('Invalid personal media download token');
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivText, 'base64url'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
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
