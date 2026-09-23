const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { User, AuthIdentity, Organization, OrganizationMember } = require("../models");
const {
  ensureOrganizationChat,
} = require("../services/organizationChatProvisioning");

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error("No email returned from Google profile."));
          }

          // 1. Has this Google account logged in before?
          let authIdentity = await AuthIdentity.findOne({
            where: { provider: "google", provider_user_id: profile.id },
            include: { model: User, as: "user" },
          });

          if (authIdentity) {
            return done(null, authIdentity.user);
          }

          // 2. No Google identity yet — does a user with this email already exist?
          //    (e.g. they registered with email/password before)
          let user = await User.findOne({ where: { email } });

          if (!user) {
            // Brand new user — Google sign-up creates their own organization,
            // same pattern as email/password register.
            const first_name = profile.name?.givenName || profile.displayName || "New";
            const last_name = profile.name?.familyName || "";

            user = await User.create({ first_name, last_name, email });

            const slug =
              (first_name + "-org-" + Date.now()).toLowerCase().replace(/\s+/g, "-");
            const organization = await Organization.create({
              name: `${first_name}'s Organization`,
              slug,
            });

            await OrganizationMember.create({
              organization_id: organization.id,
              user_id: user.id,
              role: "owner",
            });

            // Best-effort: this flow has no surrounding transaction, so a
            // chat provisioning failure must not block Google sign-up --
            // the org and its owner membership already exist.
            try {
              await ensureOrganizationChat(organization.id);
            } catch (chatError) {
              console.error(
                `Organization chat provisioning failed for organization ${organization.id}:`,
                chatError,
              );
            }
          }

          // 3. Link this Google identity to the (existing or new) user.
          await AuthIdentity.create({
            user_id: user.id,
            provider: "google",
            provider_user_id: profile.id,
          });

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );
} else {
  console.warn("⚠️  Google OAuth not configured (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET missing) — skipping Google login setup.");
}

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findByPk(id);
    done(null, user);
  } catch (error) {
    done(error);
  }
});

module.exports = passport;