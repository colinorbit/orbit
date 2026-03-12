const crypto = require('crypto');

const ALGO = 'aes-256-gcm';

if (!process.env.ENCRYPTION_KEY && process.env.NODE_ENV === 'production') {
  throw new Error('[ORBIT] ENCRYPTION_KEY is required in production. Set it to a 32-byte hex string.');
}
if (!process.env.ENCRYPTION_KEY) {
  // Development only — log a prominent warning
  console.warn('[ORBIT] WARNING: ENCRYPTION_KEY not set. Using insecure dev key. CRM credentials will be lost on restart.');
}
const KEY_HEX = process.env.ENCRYPTION_KEY || 'dev-insecure-key-do-not-use-in-production-00000';
const KEY_BUF = Buffer.from(KEY_HEX.padEnd(64, '0').slice(0, 64), 'hex');

/**
 * Encrypt a JSON-serializable value.
 * Returns a base64 string: iv:authTag:ciphertext
 */
function encrypt(value) {
  const iv         = crypto.randomBytes(12);
  const cipher     = crypto.createCipheriv(ALGO, KEY_BUF, iv);
  const plaintext  = JSON.stringify(value);
  const encrypted  = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag    = cipher.getAuthTag();
  return [iv, authTag, encrypted].map(b => b.toString('base64')).join(':');
}

/**
 * Decrypt a value produced by encrypt().
 */
function decrypt(token) {
  const [ivB64, tagB64, dataB64] = token.split(':');
  const iv       = Buffer.from(ivB64,  'base64');
  const authTag  = Buffer.from(tagB64, 'base64');
  const data     = Buffer.from(dataB64,'base64');
  const decipher = crypto.createDecipheriv(ALGO, KEY_BUF, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf8'));
}

module.exports = { encrypt, decrypt };
