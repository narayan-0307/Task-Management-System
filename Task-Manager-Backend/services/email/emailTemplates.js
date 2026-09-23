function taskCreatedEmail({ recipientName, taskTitle, taskUrl, creatorName }) {
  return {
    subject: `New task assigned: ${taskTitle}`,

    text: `Hi ${recipientName},

A new task has been created for you.

Task: ${taskTitle}
Created by: ${creatorName}

View the task:
${taskUrl}

Regards,
HumanCare Team`,

    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>New Task Assigned</h2>

        <p>Hi ${recipientName},</p>

        <p>A new task has been created for you.</p>

        <p>
          <strong>Task:</strong> ${taskTitle}<br>
          <strong>Created by:</strong> ${creatorName}
        </p>

        <p>
          <a href="${taskUrl}"
             style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">
            View Task
          </a>
        </p>

        <p>Regards,<br>HumanCare Team</p>
      </div>
    `,
  };
}

function mentionEmail({
  recipientName,
  mentionedBy,
  taskTitle,
  message,
  taskUrl,
}) {
  return {
    subject: `${mentionedBy} mentioned you in ${taskTitle}`,

    text: `Hi ${recipientName},

${mentionedBy} mentioned you in the task "${taskTitle}".

Message:
${message}

View the task:
${taskUrl}

Regards,
HumanCare Team`,

    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>You were mentioned</h2>

        <p>Hi ${recipientName},</p>

        <p>
          <strong>${mentionedBy}</strong> mentioned you in
          <strong>${taskTitle}</strong>.
        </p>

        <blockquote style="border-left:4px solid #2563eb;padding-left:12px;color:#555;">
          ${message}
        </blockquote>

        <p>
          <a href="${taskUrl}"
             style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">
            View Task
          </a>
        </p>

        <p>Regards,<br>HumanCare Team</p>
      </div>
    `,
  };
}

function invitationEmail({
  recipientName,
  inviterName,
  organizationName,
  invitationUrl,
}) {
  return {
    subject: `You're invited to ${organizationName}`,

    text: `Hi ${recipientName},

${inviterName} has invited you to join ${organizationName} on HumanCare Task Management System.

Accept the invitation:
${invitationUrl}

Regards,
HumanCare Team`,

    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>You're Invited</h2>

        <p>Hi ${recipientName},</p>

        <p>
          <strong>${inviterName}</strong> has invited you to join
          <strong>${organizationName}</strong> on HumanCare Task Management System.
        </p>

        <p>
          <a href="${invitationUrl}"
             style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">
            Accept Invitation
          </a>
        </p>

        <p>Regards,<br>HumanCare Team</p>
      </div>
    `,
  };
}

function passwordResetEmail({ recipientName, resetUrl }) {
  return {
    subject: "Reset your HumanCare password",

    text: `Hi ${recipientName},

We received a request to reset your HumanCare Task Management System password.

Reset your password:
${resetUrl}

This link will expire in 15 minutes.

If you did not request a password reset, you can safely ignore this email.

Regards,
HumanCare Team`,

    html: `
      <div style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2>Reset Your Password</h2>

        <p>Hi ${recipientName},</p>

        <p>
          We received a request to reset your HumanCare Task Management System password.
        </p>

        <p>
          <a href="${resetUrl}"
             style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">
            Reset Password
          </a>
        </p>

        <p>
          This link will expire in <strong>15 minutes</strong>.
        </p>

        <p>
          If you did not request a password reset, you can safely ignore this email.
        </p>

        <p>Regards,<br>HumanCare Team</p>
      </div>
    `,
  };
}

module.exports = {
  taskCreatedEmail,
  mentionEmail,
  invitationEmail,
  passwordResetEmail,
};
