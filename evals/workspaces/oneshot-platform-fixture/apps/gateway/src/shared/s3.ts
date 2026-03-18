import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { GatewayEnv } from "./config.js";

export function createS3(env: GatewayEnv): S3Client {
  return new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
}

export async function putJsonObject(
  s3: S3Client,
  bucket: string,
  key: string,
  value: unknown,
): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: Buffer.from(JSON.stringify(value), "utf8"),
    ContentType: "application/json",
  }));
}

export async function getJsonObject<T>(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<T | null> {
  try {
    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = response.Body;
    if (!body) return null;
    const text = await body.transformToString();
    return JSON.parse(text) as T;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("NoSuchKey") || msg.includes("NotFound")) {
      return null;
    }
    throw error;
  }
}
