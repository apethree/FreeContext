import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const KEY_BYTES = 32;
const IV_BYTES = 12;

function decodeMasterKey(base64: string): Buffer {
  const key = Buffer.from(base64, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error("TENANT_TOKEN_ENCRYPTION_KEY_BASE64 must decode to exactly 32 bytes");
  }
  return key;
}

function deriveTenantKey(master: Buffer, tenantId: string): Buffer {
  return createHmac("sha256", master).update(tenantId).digest().subarray(0, KEY_BYTES);
}

export function fingerprintToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function encryptTenantSecret(masterKeyBase64: string, tenantId: string, plainText: string): string {
  const master = decodeMasterKey(masterKeyBase64);
  const key = deriveTenantKey(master, tenantId);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, encrypted, tag]);
  return packed.toString("base64url");
}

export function decryptTenantSecret(masterKeyBase64: string, tenantId: string, encoded: string): string {
  const packed = Buffer.from(encoded, "base64url");
  if (packed.length <= IV_BYTES + 16) {
    throw new Error("encrypted payload is too short");
  }

  const master = decodeMasterKey(masterKeyBase64);
  const key = deriveTenantKey(master, tenantId);
  const iv = packed.subarray(0, IV_BYTES);
  const tag = packed.subarray(packed.length - 16);
  const encrypted = packed.subarray(IV_BYTES, packed.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return plain.toString("utf8");
}
