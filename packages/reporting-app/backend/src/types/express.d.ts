import "express-session";

declare module "express-session" {
  interface SessionData {
    user?: {
      id: string;
      email: string;
      role: "admin" | "radiographer" | "radiologist" | "referring" | "billing" | "receptionist" | "viewer";
      approved?: boolean;
      requestStatus?: "pending" | "approved" | "rejected";
      displayName?: string;
    };
  }
}
