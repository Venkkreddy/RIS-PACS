import { v4 as uuid } from "uuid";
import { getFirestore } from "./firebaseAdmin";

export interface NotificationRecord {
  id: string;
  type: string;
  report_id: string;
  patient_name: string;
  radiologist_name: string;
  study_type: string;
  created_at: string;
  read: boolean;
  target_roles: string[];
}

export type CreateNotificationInput = Omit<NotificationRecord, "id" | "created_at" | "read">;

const COLLECTION = "notifications";

export class NotificationService {
  private readonly firestore;

  constructor(firestore?: ReturnType<typeof getFirestore>) {
    this.firestore = firestore ?? getFirestore();
  }

  async create(input: CreateNotificationInput): Promise<NotificationRecord> {
    const record: NotificationRecord = {
      ...input,
      id: uuid(),
      created_at: new Date().toISOString(),
      read: false,
    };
    await this.firestore.collection(COLLECTION).doc(record.id).set(record);
    return record;
  }

  /** Returns notifications targeted at the given role, most recent first. */
  async listForRole(role: string, limit = 100): Promise<NotificationRecord[]> {
    const snapshot = await this.firestore
      .collection(COLLECTION)
      .where("target_roles", "array-contains", role)
      .orderBy("created_at", "desc")
      .limit(limit)
      .get();
    return snapshot.docs.map((doc) => doc.data() as NotificationRecord);
  }

  async markRead(id: string): Promise<void> {
    await this.firestore.collection(COLLECTION).doc(id).update({ read: true });
  }
}
