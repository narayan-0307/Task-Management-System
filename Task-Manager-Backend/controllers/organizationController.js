const crypto = require("crypto");
const { sequelize } = require("../config/db");
const {
  User,
  OrganizationMember,
  OrganizationInvitation,
} = require("../models");
const { createActivity } = require("../utils/activity");
const {
  ensureOrganizationChat,
} = require("../services/organizationChatProvisioning");


// GET /api/organization/members
// Returns members belonging to the currently logged-in user's organization.
exports.getMembers = async (req, res) => {
  try {
    const organizationId = req.user.organization_id;

    const members = await OrganizationMember.findAll({
      where: {
        organization_id: organizationId,
        is_active: true,
      },
      include: [
        {
          model: User,
          as: "user",
          attributes: [
            "id",
            "first_name",
            "last_name",
            "email",
            "phone",
            "avatar_url",
          ],
        },
      ],
      order: [["joined_at", "ASC"]],
    });

    res.json({
      members: members.map((member) => ({
        id: member.id,
        user_id: member.user_id,
        first_name: member.user.first_name,
        last_name: member.user.last_name,
        email: member.user.email,
        phone: member.user.phone,
        avatar_url: member.user.avatar_url,
        role: member.role,
        joined_at: member.joined_at,
      })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      message: "Server error while fetching organization members.",
    });
  }
};


exports.createInvitation = async (req, res) => {
  try {
    const { email, role } = req.body;

    // 1. Validate input
    if (!email || !role) {
      return res.status(400).json({
        message: "Email and role are required.",
      });
    }

    // 2. Only these roles can be assigned through an invitation
    const allowedRoles = ["admin", "manager", "member", "client"];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({
        message: "Invalid role.",
      });
    }

    // 3. Only owner/admin can invite users
    if (!["owner", "admin"].includes(req.user.role)) {
      return res.status(403).json({
        message: "You are not allowed to invite members.",
      });
    }

    // 4. Generate secure invitation token
    const token = crypto.randomBytes(32).toString("hex");

    // 5. Invitation expires in 7 days
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // 6. Create invitation
    const invitation = await OrganizationInvitation.create({
      organization_id: req.user.organization_id,
      email: email.toLowerCase().trim(),
      role,
      token,
      invited_by: req.user.id,
      status: "pending",
      expires_at: expiresAt,
    });

    await createActivity({
      organization_id: req.user.organization_id,
      user_id: req.user.id,
      entity_type: "invitation",
      action: "created",
      entity_id: invitation.id,
      project_id: null,
      task_id: null,
      description: `Sent invitation to "${invitation.email}"`,
      metadata: {
        invitation_id: invitation.id,
        invitee_email: invitation.email,
        role: invitation.role,
      },
    });

    res.status(201).json({
      message: "Invitation created successfully.",
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expires_at: invitation.expires_at,
      },
    });
  } catch (error) {
    console.error("Create invitation error:", error);

    res.status(500).json({
      message: "Server error while creating invitation.",
    });
  }
};


// GET /api/organization/invitations
exports.getInvitations = async (req, res) => {
  try {
    const invitations = await OrganizationInvitation.findAll({
      where: {
        organization_id: req.user.organization_id,
      },
      attributes: [
        "id",
        "email",
        "role",
        "status",
        "expires_at",
        "accepted_at",
        "created_at",
      ],
      order: [["created_at", "DESC"]],
    });

    res.json({
      invitations,
    });
  } catch (error) {
    console.error("Get invitations error:", error);

    res.status(500).json({
      message: "Server error while fetching invitations.",
    });
  }
};

// POST /api/organization/invitations/:token/accept
exports.acceptInvitation = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const { token } = req.params;

    // Get the currently logged-in user
    const user = await User.findByPk(req.user.id, {
      transaction,
    });

    if (!user) {
      await transaction.rollback();

      return res.status(404).json({
        message: "User not found.",
      });
    }

    // Find the invitation
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
        message: "Invitation not found or is no longer pending.",
      });
    }

    // Check expiration
    if (new Date(invitation.expires_at) < new Date()) {
      invitation.status = "expired";
      await invitation.save({ transaction });

      await transaction.commit();

      return res.status(410).json({
        message: "This invitation has expired.",
      });
    }

    // Invitation email must belong to the logged-in user
    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
      await transaction.rollback();

      return res.status(403).json({
        message: "This invitation was sent to a different email address.",
      });
    }

    // Check whether user is already a member
    const existingMembership = await OrganizationMember.findOne({
      where: {
        organization_id: invitation.organization_id,
        user_id: user.id,
      },
      transaction,
    });

    if (existingMembership) {
      await transaction.rollback();

      return res.status(409).json({
        message: "You are already a member of this organization.",
      });
    }

    // Create organization membership
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
      }
    );

    // Ensure the org-wide "HumanCare Team" conversation exists and this
    // newly active member is in it. Joins this same transaction (not a
    // second one) so a provisioning failure rolls back with everything
    // else above rather than leaving a half-completed acceptance.
    await ensureOrganizationChat(invitation.organization_id, { transaction });

    // Mark invitation as accepted
    invitation.status = "accepted";
    invitation.accepted_at = new Date();

    await invitation.save({ transaction });

    await transaction.commit();

    // Organization scope comes from the validated invitation, not req.user —
    // the accepting user may be joining an organization other than their current one.
    await createActivity({
      organization_id: invitation.organization_id,
      user_id: req.user.id,
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

    return res.status(200).json({
      message: "Invitation accepted successfully.",
      membership: {
        id: membership.id,
        organization_id: membership.organization_id,
        user_id: membership.user_id,
        role: membership.role,
        joined_at: membership.joined_at,
      },
    });
  } catch (error) {
    await transaction.rollback();

    console.error("Accept invitation error:", error);

    return res.status(500).json({
      message: "Server error while accepting invitation.",
    });
  }
};