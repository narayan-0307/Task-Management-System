const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { Op } = require("sequelize");

const {
  User,
  Organization,
  AuthIdentity,
  OrganizationMember,
  OrganizationInvitation,
  PasswordResetToken,
} = require("../models");

const { sequelize } = require("../config/db");
const { createActivity } = require("../utils/activity");
const { sendEmail } = require("../services/email/emailService");
const { passwordResetEmail } = require("../services/email/emailTemplates");
const {
  ensureOrganizationChat,
} = require("../services/organizationChatProvisioning");

function generateToken({ user, organizationId, role }) {
  return jwt.sign(
    { id: user.id, organization_id: organizationId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
  );
}

// POST /api/auth/register
// Creates a new organization (company) and its first user as "owner".
exports.register = async (req, res) => {
  try {
    const { company_name, first_name, last_name, email, password } = req.body;

    if (!company_name || !first_name || !email || !password) {
      return res.status(400).json({ message: "Missing required fields." });
    }

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(409).json({ message: "Email already in use." });
    }

    const slug =
      company_name.toLowerCase().trim().replace(/\s+/g, "-") + "-" + Date.now();

    const organization = await Organization.create({
      name: company_name,
      slug,
    });

    const user = await User.create({
      first_name,
      last_name,
      email,
    });

    const password_hash = await bcrypt.hash(password, 10);

    await AuthIdentity.create({
      user_id: user.id,
      provider: "local",
      password_hash,
    });

    const membership = await OrganizationMember.create({
      organization_id: organization.id,
      user_id: user.id,
      role: "owner",
    });

    // Best-effort: this flow has no surrounding transaction, so a chat
    // provisioning failure must not fail registration -- the org and its
    // owner membership already exist and are the source of truth.
    try {
      await ensureOrganizationChat(organization.id);
    } catch (chatError) {
      console.error(
        `Organization chat provisioning failed for organization ${organization.id}:`,
        chatError,
      );
    }

    const token = generateToken({
      user,
      organizationId: organization.id,
      role: membership.role,
    });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: membership.role,
        organization_id: organization.id,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error during registration." });
  }
};

// POST /api/auth/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    const user = await User.findOne({ where: { email } });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const authIdentity = await AuthIdentity.findOne({
      where: { user_id: user.id, provider: "local" },
    });
    if (!authIdentity || !authIdentity.password_hash) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const isMatch = await bcrypt.compare(password, authIdentity.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    // NOTE: assumes one org per user for now (first membership found).
    // If/when users can belong to multiple orgs, this needs a different
    // strategy (e.g. an org switcher, or a "primary org" flag).
    const membership = await OrganizationMember.findOne({
      where: { user_id: user.id, is_active: true },
    });
    if (!membership) {
      return res
        .status(403)
        .json({ message: "No active organization membership found." });
    }

    user.last_login_at = new Date();
    await user.save();

    const token = generateToken({
      user,
      organizationId: membership.organization_id,
      role: membership.role,
    });

    res.json({
      token,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: membership.role,
        organization_id: membership.organization_id,
      },
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    console.error("SQL MESSAGE:", error.original?.sqlMessage);
    console.error("SQL:", error.sql);

    res.status(500).json({ message: "Server error during login." });
  }
};

// GET /api/auth/google/callback
// Called by Passport after Google auth succeeds. req.user is set by passport.
exports.googleCallback = async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  try {
    const user = req.user;

    const membership = await OrganizationMember.findOne({
      where: { user_id: user.id, is_active: true },
    });

    if (!membership) {
      return res.redirect(`${frontendUrl}/login?error=no_membership`);
    }

    const token = generateToken({
      user,
      organizationId: membership.organization_id,
      role: membership.role,
    });

    // Redirect back to frontend with the token as a query param.
    // Frontend catches this on a dedicated route and stores it.
    res.redirect(`${frontendUrl}/oauth-success?token=${token}`);
  } catch (error) {
    console.error(error);
    res.redirect(`${frontendUrl}/login?error=server_error`);
  }
};

// GET /api/auth/me
// Returns the currently logged-in user's info, based on the JWT.
// POST /api/auth/register/invitation
// Creates a new user account from a pending organization invitation.
exports.registerWithInvitation = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { token, first_name, last_name, password } = req.body;

    if (!token || !first_name || !password) {
      await transaction.rollback();

      return res.status(400).json({
        message: "Token, first name and password are required.",
      });
    }

    // 1. Find valid invitation
    const invitation = await OrganizationInvitation.findOne({
      where: {
        token,
        status: "pending",
      },
      transaction,
    });

    if (!invitation) {
      await transaction.rollback();

      return res.status(404).json({
        message: "Invitation not found or is no longer valid.",
      });
    }

    // 2. Check expiration
    if (new Date(invitation.expires_at) < new Date()) {
      invitation.status = "expired";

      await invitation.save({ transaction });
      await transaction.commit();

      return res.status(410).json({
        message: "This invitation has expired.",
      });
    }

    // 3. Check whether email already has an account
    const existingUser = await User.findOne({
      where: {
        email: invitation.email,
      },
      transaction,
    });

    if (existingUser) {
      await transaction.rollback();

      return res.status(409).json({
        message:
          "An account already exists for this email. Please log in and accept the invitation.",
      });
    }

    // 4. Create user
    const user = await User.create(
      {
        first_name,
        last_name,
        email: invitation.email,
      },
      {
        transaction,
      },
    );

    // 5. Create password identity
    const password_hash = await bcrypt.hash(password, 10);

    await AuthIdentity.create(
      {
        user_id: user.id,
        provider: "local",
        password_hash,
      },
      {
        transaction,
      },
    );

    // 6. Add user to invited organization
    const membership = await OrganizationMember.create(
      {
        organization_id: invitation.organization_id,
        user_id: user.id,
        role: invitation.role,
        is_active: true,
        joined_at: new Date(),
      },
      {
        transaction,
      },
    );

    // 6b. Ensure the org-wide "HumanCare Team" conversation exists and the
    // new active member is in it. Joins this same transaction (not a
    // second one) so a provisioning failure rolls back with everything
    // else above rather than leaving a half-completed acceptance.
    await ensureOrganizationChat(invitation.organization_id, { transaction });

    // 7. Mark invitation accepted
    invitation.status = "accepted";
    invitation.accepted_at = new Date();

    await invitation.save({ transaction });

    // 8. Update login timestamp
    user.last_login_at = new Date();
    await user.save({ transaction });

    // 9. Generate JWT
    const jwtToken = generateToken({
      user,
      organizationId: membership.organization_id,
      role: membership.role,
    });

    await transaction.commit();

    // This flow is token-based and unauthenticated (no req.user). The actor is
    // the newly created user; the organization comes from the validated invitation.
    await createActivity({
      organization_id: invitation.organization_id,
      user_id: user.id,
      entity_type: "invitation",
      action: "updated",
      entity_id: invitation.id,
      project_id: null,
      task_id: null,
      description: `Accepted invitation`,
      metadata: {
        invitation_id: invitation.id,
        invitee_email: invitation.email,
        status: "accepted",
      },
    });

    return res.status(201).json({
      message: "Account created and invitation accepted successfully.",
      token: jwtToken,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: membership.role,
        organization_id: membership.organization_id,
      },
    });
  } catch (error) {
    await transaction.rollback();

    console.error("Invitation registration error:", error);

    return res.status(500).json({
      message: "Server error during invitation registration.",
    });
  }
};

// GET /api/auth/me
// Returns the currently logged-in user's info, based on the JWT.
exports.getMe = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    res.json({
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: req.user.role,
        organization_id: req.user.organization_id,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error." });
  }
};

// POST /api/auth/forgot-password
// Sends a password reset link to the user's email.
exports.forgotPassword = async (req, res) => {
  try {
    const email = String(req.body.email || "")
      .trim()
      .toLowerCase();

    if (!email) {
      return res.status(400).json({
        message: "Email is required.",
      });
    }

    const user = await User.findOne({
      where: { email },
      attributes: ["id", "first_name", "last_name", "email"],
    });

    // Always return the same response for unknown emails.
    // This prevents account enumeration.
    if (!user) {
      return res.json({
        message:
          "If an account exists with this email, a reset link has been sent.",
      });
    }

    // Invalidate any previous unused reset tokens for this user.
    await PasswordResetToken.update(
      { used_at: new Date() },
      {
        where: {
          user_id: user.id,
          used_at: null,
        },
      },
    );

    // Generate a random token for the URL.
    const rawToken = crypto.randomBytes(32).toString("hex");

    // Store only the hash in the database.
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    // Reset link expires in 15 minutes.
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await PasswordResetToken.create({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    const resetUrl = `${frontendUrl}/reset-password?token=${rawToken}`;

    const recipientName =
      `${user.first_name || ""} ${user.last_name || ""}`.trim() || user.email;

    const emailContent = passwordResetEmail({
      recipientName,
      resetUrl,
    });

    try {
      await sendEmail({
        to: user.email,
        subject: emailContent.subject,
        text: emailContent.text,
        html: emailContent.html,
      });
    } catch (emailError) {
      console.error(
        `Password reset email failed for ${user.email}:`,
        emailError.message,
      );
    }

    return res.json({
      message:
        "If an account exists with this email, a reset link has been sent.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);

    return res.status(500).json({
      message: "Server error while processing password reset request.",
    });
  }
};

// POST /api/auth/reset-password
// Consumes a password reset token and sets a new local password.
exports.resetPassword = async (req, res) => {
  const { token, password } = req.body;

  if (!token) {
    return res.status(400).json({ message: "Token is required." });
  }

  if (!password) {
    return res.status(400).json({ message: "Password is required." });
  }

  if (password.length < 8) {
    return res
      .status(400)
      .json({ message: "Password must be at least 8 characters." });
  }

  const invalidTokenResponse = () =>
    res.status(400).json({
      message: "This password reset link is invalid or has expired.",
    });

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    const resetToken = await PasswordResetToken.findOne({
      where: { token_hash: tokenHash, used_at: null },
    });

    if (!resetToken || new Date(resetToken.expires_at) <= new Date()) {
      return invalidTokenResponse();
    }

    const authIdentity = await AuthIdentity.findOne({
      where: { user_id: resetToken.user_id, provider: "local" },
    });

    if (!authIdentity) {
      return invalidTokenResponse();
    }

    const password_hash = await bcrypt.hash(password, 10);

    const transaction = await sequelize.transaction();

    try {
      authIdentity.password_hash = password_hash;
      await authIdentity.save({ transaction });

      resetToken.used_at = new Date();
      await resetToken.save({ transaction });

      // Invalidate any other unused reset tokens for this user.
      await PasswordResetToken.update(
        { used_at: new Date() },
        {
          where: {
            user_id: resetToken.user_id,
            used_at: null,
            id: { [Op.ne]: resetToken.id },
          },
          transaction,
        },
      );

      await transaction.commit();
    } catch (transactionError) {
      await transaction.rollback();
      throw transactionError;
    }

    return res.json({ message: "Password has been reset successfully." });
  } catch (error) {
    console.error("Reset password error:", error.message);

    return res.status(500).json({
      message: "Server error while resetting password.",
    });
  }
};
