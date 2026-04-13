import { Storage } from "@google-cloud/storage";
import { env } from "../config/env";

export class StorageService {
  private readonly storage = new Storage({ projectId: env.GCP_PROJECT_ID });

  async uploadBuffer(path: string, data: Buffer, contentType: string): Promise<string> {
    const bucket = this.storage.bucket(env.GCS_BUCKET);
    const file = bucket.file(path);
    await file.save(data, { contentType, resumable: false });
    return `gs://${env.GCS_BUCKET}/${path}`;
  }

  async deleteObject(path: string): Promise<void> {
    const bucket = this.storage.bucket(env.GCS_BUCKET);
    await bucket.file(path).delete({ ignoreNotFound: true });
  }

  async uploadFile(
    localFilePath: string,
    destinationPath: string,
    contentType?: string,
    bucketName: string = env.GCS_BUCKET,
  ): Promise<string> {
    const bucket = this.storage.bucket(bucketName);
    const normalizedDestination = destinationPath.replace(/\\/g, "/");
    await bucket.upload(localFilePath, {
      destination: normalizedDestination,
      contentType,
      resumable: false,
    });
    return `gs://${bucketName}/${normalizedDestination}`;
  }
}
