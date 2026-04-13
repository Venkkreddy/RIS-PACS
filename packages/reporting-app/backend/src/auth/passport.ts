import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { env } from "../config/env";

const masterAdmins = env.MASTER_ADMIN_EMAILS.split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/auth/google/callback",
      },
      (_accessToken, _refreshToken, profile, done) => {
        const email = (profile.emails?.[0]?.value ?? "").toLowerCase();
        const isMasterAdmin = masterAdmins.includes(email);
        done(null, {
          id: profile.id,
          email,
          displayName: profile.displayName,
          role: isMasterAdmin ? "super_admin" : "viewer",
          approved: isMasterAdmin,
          requestStatus: isMasterAdmin ? "approved" : "pending",
        });
      },
    ),
  );
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user: Express.User, done) => done(null, user));

export default passport;
