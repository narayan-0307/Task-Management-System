const User = require("./User");
const Organization = require("./Organization");
const AuthIdentity = require("./AuthIdentity");
const PasswordResetToken = require("./PasswordResetToken");
const OrganizationMember = require("./OrganizationMember");
const OrganizationInvitation = require("./OrganizationInvitation");
const Project = require("./Project");
const ProjectMember = require("./ProjectMember");
const Task = require("./Task");
const Subtask = require("./Subtask");
const Comment = require("./Comment");
const Tag = require("./Tag");
const Attachment = require("./Attachment");
const Notification = require("./Notification");
const Question = require("./Question");
const QuestionAnswer = require("./QuestionAnswer");
const MonitoringAgent = require("./MonitoringAgent");
const MonitoringEnrollment = require("./MonitoringEnrollment");
const MonitoringActivity = require("./MonitoringActivity");
const Activity = require("./Activity");
const TaskMessage = require("./TaskMessage");
const TaskChatRead = require("./TaskChatRead");
const TaskMember = require("./TaskMember");
const Conversation = require("./Conversation");
const ConversationMember = require("./ConversationMember");
const Message = require("./Message");

// Monitoring events pipeline (Phase 0).
const MonitoringEvent = require("./MonitoringEvent");
const MonitoringPcSession = require("./MonitoringPcSession");
const MonitoringInterval = require("./MonitoringInterval");
const MonitoringAppSession = require("./MonitoringAppSession");
const MonitoringWebSession = require("./MonitoringWebSession");
const MonitoringUserDaySummary = require("./MonitoringUserDaySummary");
const MonitoringRecomputeQueue = require("./MonitoringRecomputeQueue");
const MonitoringOrgSetting = require("./MonitoringOrgSetting");
const MonitoringBlocklistDomain = require("./MonitoringBlocklistDomain");
const MonitoringConsent = require("./MonitoringConsent");
const MonitoringContentEvent = require("./MonitoringContentEvent");
const MonitoringContentGrant = require("./MonitoringContentGrant");
const MonitoringContentAccessLog = require("./MonitoringContentAccessLog");
const MonitoringLiveScreenSession = require("./MonitoringLiveScreenSession");
const MonitoringScreenshotRequest = require("./MonitoringScreenshotRequest");

// User ↔ AuthIdentity
User.hasMany(AuthIdentity, {
  foreignKey: "user_id",
  as: "authIdentities",
});

AuthIdentity.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// User ↔ PasswordResetToken
User.hasMany(PasswordResetToken, {
  foreignKey: "user_id",
  as: "passwordResetTokens",
});

PasswordResetToken.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// User ↔ OrganizationMember
User.hasMany(OrganizationMember, {
  foreignKey: "user_id",
  as: "organizationMemberships",
});

OrganizationMember.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// Organization ↔ OrganizationMember
Organization.hasMany(OrganizationMember, {
  foreignKey: "organization_id",
  as: "members",
});

OrganizationMember.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// User ↔ Organization
User.belongsToMany(Organization, {
  through: OrganizationMember,
  foreignKey: "user_id",
  otherKey: "organization_id",
  as: "organizations",
});

Organization.belongsToMany(User, {
  through: OrganizationMember,
  foreignKey: "organization_id",
  otherKey: "user_id",
  as: "users",
});

// Organization ↔ OrganizationInvitation
Organization.hasMany(OrganizationInvitation, {
  foreignKey: "organization_id",
  as: "invitations",
});

OrganizationInvitation.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// User ↔ OrganizationInvitation
User.hasMany(OrganizationInvitation, {
  foreignKey: "invited_by",
  as: "sentInvitations",
});

OrganizationInvitation.belongsTo(User, {
  foreignKey: "invited_by",
  as: "inviter",
});

// Organization ↔ Project
Organization.hasMany(Project, {
  foreignKey: "organization_id",
  as: "projects",
});

Project.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// User ↔ Project
User.hasMany(Project, {
  foreignKey: "created_by",
  as: "createdProjects",
});

Project.belongsTo(User, {
  foreignKey: "created_by",
  as: "creator",
});

// Project ↔ ProjectMember
Project.hasMany(ProjectMember, {
  foreignKey: "project_id",
  as: "members",
});

ProjectMember.belongsTo(Project, {
  foreignKey: "project_id",
  as: "project",
});

// User ↔ ProjectMember
User.hasMany(ProjectMember, {
  foreignKey: "user_id",
  as: "projectMemberships",
});

ProjectMember.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// Project ↔ Task
Project.hasMany(Task, {
  foreignKey: "project_id",
  as: "tasks",
});

Task.belongsTo(Project, {
  foreignKey: "project_id",
  as: "project",
});

// Organization ↔ Task
Organization.hasMany(Task, {
  foreignKey: "organization_id",
  as: "tasks",
});

Task.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// User ↔ Task (assigned user)
User.hasMany(Task, {
  foreignKey: "assigned_to",
  as: "assignedTasks",
});

Task.belongsTo(User, {
  foreignKey: "assigned_to",
  as: "assignee",
});

// User ↔ Task (creator)
User.hasMany(Task, {
  foreignKey: "created_by",
  as: "createdTasks",
});

Task.belongsTo(User, {
  foreignKey: "created_by",
  as: "creator",
});

// Task ↔ Subtask
Task.hasMany(Subtask, {
  foreignKey: "task_id",
  as: "subtasks",
});

Subtask.belongsTo(Task, {
  foreignKey: "task_id",
  as: "task",
});

// Organization ↔ Subtask
Organization.hasMany(Subtask, {
  foreignKey: "organization_id",
  as: "subtasks",
});

Subtask.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// User ↔ Subtask (assigned user)
User.hasMany(Subtask, {
  foreignKey: "assigned_to",
  as: "assignedSubtasks",
});

Subtask.belongsTo(User, {
  foreignKey: "assigned_to",
  as: "assignee",
});

// User ↔ Subtask (creator)
User.hasMany(Subtask, {
  foreignKey: "created_by",
  as: "createdSubtasks",
});

Subtask.belongsTo(User, {
  foreignKey: "created_by",
  as: "creator",
});

// Subtask ↔ Comment
Subtask.hasMany(Comment, {
  foreignKey: "subtask_id",
  as: "comments",
});

Comment.belongsTo(Subtask, {
  foreignKey: "subtask_id",
  as: "subtask",
});

// Subtask ↔ Tag (many-to-many through subtask_tags)
Subtask.belongsToMany(Tag, {
  through: "subtask_tags",
  foreignKey: "subtask_id",
  otherKey: "tag_id",
  as: "tags",
});

Tag.belongsToMany(Subtask, {
  through: "subtask_tags",
  foreignKey: "tag_id",
  otherKey: "subtask_id",
  as: "subtasks",
});

// Subtask ↔ Attachment
Subtask.hasMany(Attachment, {
  foreignKey: "subtask_id",
  as: "attachments",
});

Attachment.belongsTo(Subtask, {
  foreignKey: "subtask_id",
  as: "subtask",
});

// Task ↔ Comment
Task.hasMany(Comment, {
  foreignKey: "task_id",
  as: "comments",
});

Comment.belongsTo(Task, {
  foreignKey: "task_id",
  as: "task",
});

// Organization ↔ Comment
Organization.hasMany(Comment, {
  foreignKey: "organization_id",
  as: "comments",
});

Comment.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// User ↔ Comment (author)
User.hasMany(Comment, {
  foreignKey: "user_id",
  as: "comments",
});

Comment.belongsTo(User, {
  foreignKey: "user_id",
  as: "author",
});

// Task ↔ Tag (many-to-many through task_tags)
Task.belongsToMany(Tag, {
  through: "task_tags",
  foreignKey: "task_id",
  otherKey: "tag_id",
  as: "tags",
});

Tag.belongsToMany(Task, {
  through: "task_tags",
  foreignKey: "tag_id",
  otherKey: "task_id",
  as: "tasks",
});

// Organization ↔ Tag
Organization.hasMany(Tag, {
  foreignKey: "organization_id",
  as: "tags",
});

Tag.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// Task ↔ Attachment
Task.hasMany(Attachment, {
  foreignKey: "task_id",
  as: "attachments",
});

Attachment.belongsTo(Task, {
  foreignKey: "task_id",
  as: "task",
});

// Organization ↔ Attachment
Organization.hasMany(Attachment, {
  foreignKey: "organization_id",
  as: "attachments",
});

Attachment.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// User ↔ Attachment
User.hasMany(Attachment, {
  foreignKey: "uploaded_by",
  as: "attachments",
});

Attachment.belongsTo(User, {
  foreignKey: "uploaded_by",
  as: "uploader",
});

// Task ↔ TaskMessage
Task.hasMany(TaskMessage, {
  foreignKey: "task_id",
  as: "messages",
});

TaskMessage.belongsTo(Task, {
  foreignKey: "task_id",
  as: "task",
});

// Organization ↔ TaskMessage
Organization.hasMany(TaskMessage, {
  foreignKey: "organization_id",
  as: "taskMessages",
});

TaskMessage.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// User ↔ TaskMessage (sender)
User.hasMany(TaskMessage, {
  foreignKey: "sender_id",
  as: "sentTaskMessages",
});

TaskMessage.belongsTo(User, {
  foreignKey: "sender_id",
  as: "sender",
});

// TaskMessage ↔ Attachment
TaskMessage.hasMany(Attachment, {
  foreignKey: "message_id",
  as: "attachments",
});

Attachment.belongsTo(TaskMessage, {
  foreignKey: "message_id",
  as: "message",
});

// Task ↔ TaskChatRead
Task.hasMany(TaskChatRead, {
  foreignKey: "task_id",
  as: "chatReads",
});

TaskChatRead.belongsTo(Task, {
  foreignKey: "task_id",
  as: "task",
});

// User ↔ TaskChatRead
User.hasMany(TaskChatRead, {
  foreignKey: "user_id",
  as: "taskChatReads",
});

TaskChatRead.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// Task ↔ TaskMember
Task.hasMany(TaskMember, {
  foreignKey: "task_id",
  as: "taskMembers",
});

TaskMember.belongsTo(Task, {
  foreignKey: "task_id",
  as: "task",
});

// User ↔ TaskMember
User.hasMany(TaskMember, {
  foreignKey: "user_id",
  as: "taskMemberships",
});

TaskMember.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// User ↔ TaskMember (added by)
TaskMember.belongsTo(User, {
  foreignKey: "added_by",
  as: "addedBy",
});

User.hasMany(TaskMember, {
  foreignKey: "added_by",
  as: "taskMembershipsAdded",
});

// Organization ↔ Conversation
Organization.hasMany(Conversation, {
  foreignKey: "organization_id",
  as: "conversations",
});

Conversation.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// User ↔ Conversation (creator)
User.hasMany(Conversation, {
  foreignKey: "created_by",
  as: "createdConversations",
});

Conversation.belongsTo(User, {
  foreignKey: "created_by",
  as: "creator",
});

// Conversation ↔ ConversationMember
Conversation.hasMany(ConversationMember, {
  foreignKey: "conversation_id",
  as: "members",
});

ConversationMember.belongsTo(Conversation, {
  foreignKey: "conversation_id",
  as: "conversation",
});

// User ↔ ConversationMember
User.hasMany(ConversationMember, {
  foreignKey: "user_id",
  as: "conversationMemberships",
});

ConversationMember.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// Conversation ↔ Message
Conversation.hasMany(Message, {
  foreignKey: "conversation_id",
  as: "messages",
});

Message.belongsTo(Conversation, {
  foreignKey: "conversation_id",
  as: "conversation",
});

// Organization ↔ Message
Organization.hasMany(Message, {
  foreignKey: "organization_id",
  as: "messages",
});

Message.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// User ↔ Message (sender)
User.hasMany(Message, {
  foreignKey: "sender_id",
  as: "sentMessages",
});

Message.belongsTo(User, {
  foreignKey: "sender_id",
  as: "sender",
});

// Message ↔ Attachment (Organization Chat) -- kept entirely separate from
// TaskMessage ↔ Attachment above (message_id -> task_messages.id). This
// uses its own column, org_message_id -> messages.id, and its own alias
// ("orgMessage") so it can never be confused with Task Chat's "message".
Message.hasMany(Attachment, {
  foreignKey: "org_message_id",
  as: "attachments",
});

Attachment.belongsTo(Message, {
  foreignKey: "org_message_id",
  as: "orgMessage",
});

// User ↔ Notification (recipient)
User.hasMany(Notification, {
  foreignKey: "user_id",
  as: "notifications",
});

Notification.belongsTo(User, {
  foreignKey: "user_id",
  as: "recipient",
});

// User ↔ Notification (actor)
User.hasMany(Notification, {
  foreignKey: "actor_id",
  as: "triggeredNotifications",
});

Notification.belongsTo(User, {
  foreignKey: "actor_id",
  as: "actor",
});

// Task ↔ Notification
Task.hasMany(Notification, {
  foreignKey: "task_id",
  as: "notifications",
});

Notification.belongsTo(Task, {
  foreignKey: "task_id",
  as: "task",
});

// Organization ↔ Notification
Organization.hasMany(Notification, {
  foreignKey: "organization_id",
  as: "notifications",
});

Notification.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// Comment ↔ Attachment
Comment.hasMany(Attachment, {
  foreignKey: "comment_id",
  as: "attachments",
});

Attachment.belongsTo(Comment, {
  foreignKey: "comment_id",
  as: "comment",
});

// Organization ↔ Question

Organization.hasMany(Question, {
  foreignKey: "organization_id",
  as: "questions",
});

Question.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// Project ↔ Question

Project.hasMany(Question, {
  foreignKey: "project_id",
  as: "questions",
});

Question.belongsTo(Project, {
  foreignKey: "project_id",
  as: "project",
});

// User ↔ Question (creator)

User.hasMany(Question, {
  foreignKey: "created_by",
  as: "createdQuestions",
});

Question.belongsTo(User, {
  foreignKey: "created_by",
  as: "creator",
});

// User ↔ Question (assigned user)

User.hasMany(Question, {
  foreignKey: "assigned_to",
  as: "assignedQuestions",
});

Question.belongsTo(User, {
  foreignKey: "assigned_to",
  as: "assignee",
});

// User ↔ Question (resolver)

User.hasMany(Question, {
  foreignKey: "resolved_by",
  as: "resolvedQuestions",
});

Question.belongsTo(User, {
  foreignKey: "resolved_by",
  as: "resolver",
});

// Question ↔ QuestionAnswer
Question.hasMany(QuestionAnswer, {
  foreignKey: "question_id",
  as: "answers",
});

QuestionAnswer.belongsTo(Question, {
  foreignKey: "question_id",
  as: "question",
});

// User ↔ QuestionAnswer
User.hasMany(QuestionAnswer, {
  foreignKey: "user_id",
  as: "questionAnswers",
});

QuestionAnswer.belongsTo(User, {
  foreignKey: "user_id",
  as: "author",
});

// Organization ↔ QuestionAnswer
Organization.hasMany(QuestionAnswer, {
  foreignKey: "organization_id",
  as: "questionAnswers",
});

QuestionAnswer.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// Question ↔ Attachment
Question.hasMany(Attachment, {
  foreignKey: "question_id",
  as: "attachments",
});

Attachment.belongsTo(Question, {
  foreignKey: "question_id",
  as: "question",
});

// QuestionAnswer ↔ Attachment
QuestionAnswer.hasMany(Attachment, {
  foreignKey: "question_answer_id",
  as: "attachments",
});

Attachment.belongsTo(QuestionAnswer, {
  foreignKey: "question_answer_id",
  as: "questionAnswer",
});

// Organization ↔ MonitoringAgent

Organization.hasMany(MonitoringAgent, {
  foreignKey: "organization_id",
  as: "monitoringAgents",
});

MonitoringAgent.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// User ↔ MonitoringAgent

User.hasMany(MonitoringAgent, {
  foreignKey: "user_id",
  as: "monitoringAgents",
});

MonitoringAgent.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// Organization ↔ MonitoringEnrollment
Organization.hasMany(MonitoringEnrollment, {
  foreignKey: "organization_id",
  as: "monitoringEnrollments",
});

MonitoringEnrollment.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// User ↔ MonitoringEnrollment (employee)

User.hasMany(MonitoringEnrollment, {
  foreignKey: "user_id",
  as: "monitoringEnrollments",
});

MonitoringEnrollment.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// User ↔ MonitoringEnrollment (admin who created it)

User.hasMany(MonitoringEnrollment, {
  foreignKey: "created_by",
  as: "createdMonitoringEnrollments",
});

MonitoringEnrollment.belongsTo(User, {
  foreignKey: "created_by",
  as: "createdBy",
});

// MonitoringAgent ↔ MonitoringActivity

MonitoringAgent.hasMany(MonitoringActivity, {
  foreignKey: "agent_id",
  as: "activities",
});

MonitoringActivity.belongsTo(MonitoringAgent, {
  foreignKey: "agent_id",
  as: "agent",
});

// User ↔ MonitoringActivity

User.hasMany(MonitoringActivity, {
  foreignKey: "user_id",
  as: "monitoringActivities",
});

MonitoringActivity.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// Organization ↔ MonitoringActivity

Organization.hasMany(MonitoringActivity, {
  foreignKey: "organization_id",
  as: "monitoringActivities",
});

MonitoringActivity.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// Organization ↔ Activity
Organization.hasMany(Activity, {
  foreignKey: "organization_id",
  as: "activities",
});

Activity.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// Project ↔ Activity
Project.hasMany(Activity, {
  foreignKey: "project_id",
  as: "activities",
});

Activity.belongsTo(Project, {
  foreignKey: "project_id",
  as: "project",
});

// Task ↔ Activity
Task.hasMany(Activity, {
  foreignKey: "task_id",
  as: "activities",
});

Activity.belongsTo(Task, {
  foreignKey: "task_id",
  as: "task",
});

// User ↔ Activity
User.hasMany(Activity, {
  foreignKey: "user_id",
  as: "activities",
});

Activity.belongsTo(User, {
  foreignKey: "user_id",
  as: "user",
});

// ---------------------------------------------------------------------------
// Monitoring events pipeline (Phase 0)
// ---------------------------------------------------------------------------

// MonitoringEvent (append-only raw stream)
Organization.hasMany(MonitoringEvent, {
  foreignKey: "organization_id",
  as: "monitoringEvents",
});
MonitoringEvent.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});
User.hasMany(MonitoringEvent, {
  foreignKey: "user_id",
  as: "monitoringEvents",
});
MonitoringEvent.belongsTo(User, { foreignKey: "user_id", as: "user" });
MonitoringAgent.hasMany(MonitoringEvent, {
  foreignKey: "agent_id",
  as: "events",
});
MonitoringEvent.belongsTo(MonitoringAgent, {
  foreignKey: "agent_id",
  as: "agent",
});

// MonitoringPcSession (derived, per device-day)
Organization.hasMany(MonitoringPcSession, {
  foreignKey: "organization_id",
  as: "monitoringPcSessions",
});
MonitoringPcSession.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});
User.hasMany(MonitoringPcSession, {
  foreignKey: "user_id",
  as: "monitoringPcSessions",
});
MonitoringPcSession.belongsTo(User, { foreignKey: "user_id", as: "user" });
MonitoringAgent.hasMany(MonitoringPcSession, {
  foreignKey: "agent_id",
  as: "pcSessions",
});
MonitoringPcSession.belongsTo(MonitoringAgent, {
  foreignKey: "agent_id",
  as: "agent",
});

// MonitoringPcSession ↔ its derived children
MonitoringPcSession.hasMany(MonitoringInterval, {
  foreignKey: "pc_session_id",
  as: "intervals",
});
MonitoringInterval.belongsTo(MonitoringPcSession, {
  foreignKey: "pc_session_id",
  as: "pcSession",
});
MonitoringPcSession.hasMany(MonitoringAppSession, {
  foreignKey: "pc_session_id",
  as: "appSessions",
});
MonitoringAppSession.belongsTo(MonitoringPcSession, {
  foreignKey: "pc_session_id",
  as: "pcSession",
});
MonitoringPcSession.hasMany(MonitoringWebSession, {
  foreignKey: "pc_session_id",
  as: "webSessions",
});
MonitoringWebSession.belongsTo(MonitoringPcSession, {
  foreignKey: "pc_session_id",
  as: "pcSession",
});

// MonitoringUserDaySummary (derived, per user-day)
Organization.hasMany(MonitoringUserDaySummary, {
  foreignKey: "organization_id",
  as: "monitoringUserDaySummaries",
});
MonitoringUserDaySummary.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});
User.hasMany(MonitoringUserDaySummary, {
  foreignKey: "user_id",
  as: "monitoringDaySummaries",
});
MonitoringUserDaySummary.belongsTo(User, { foreignKey: "user_id", as: "user" });

// MonitoringRecomputeQueue
MonitoringAgent.hasMany(MonitoringRecomputeQueue, {
  foreignKey: "agent_id",
  as: "recomputeQueueEntries",
});
MonitoringRecomputeQueue.belongsTo(MonitoringAgent, {
  foreignKey: "agent_id",
  as: "agent",
});

// MonitoringOrgSetting (one per org)
Organization.hasOne(MonitoringOrgSetting, {
  foreignKey: "organization_id",
  as: "monitoringSettings",
});
MonitoringOrgSetting.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});

// MonitoringConsent
Organization.hasMany(MonitoringConsent, {
  foreignKey: "organization_id",
  as: "monitoringConsents",
});
MonitoringConsent.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});
User.hasMany(MonitoringConsent, {
  foreignKey: "user_id",
  as: "monitoringConsents",
});
MonitoringConsent.belongsTo(User, { foreignKey: "user_id", as: "user" });

// MonitoringContentEvent (encrypted; inert until Phase 4)
Organization.hasMany(MonitoringContentEvent, {
  foreignKey: "organization_id",
  as: "monitoringContentEvents",
});
MonitoringContentEvent.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});
User.hasMany(MonitoringContentEvent, {
  foreignKey: "user_id",
  as: "monitoringContentEvents",
});
MonitoringContentEvent.belongsTo(User, { foreignKey: "user_id", as: "user" });
MonitoringAgent.hasMany(MonitoringContentEvent, {
  foreignKey: "agent_id",
  as: "contentEvents",
});
MonitoringContentEvent.belongsTo(MonitoringAgent, {
  foreignKey: "agent_id",
  as: "agent",
});

// MonitoringContentGrant (inert until Phase 4)
Organization.hasMany(MonitoringContentGrant, {
  foreignKey: "organization_id",
  as: "monitoringContentGrants",
});
MonitoringContentGrant.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});
User.hasMany(MonitoringContentGrant, {
  foreignKey: "grantee_user_id",
  as: "monitoringContentGrantsHeld",
});
MonitoringContentGrant.belongsTo(User, {
  foreignKey: "grantee_user_id",
  as: "grantee",
});
MonitoringContentGrant.belongsTo(User, {
  foreignKey: "granted_by_user_id",
  as: "grantedBy",
});
MonitoringContentGrant.belongsTo(User, {
  foreignKey: "target_user_id",
  as: "targetUser",
});

// MonitoringContentAccessLog (inert until Phase 4)
Organization.hasMany(MonitoringContentAccessLog, {
  foreignKey: "organization_id",
  as: "monitoringContentAccessLogs",
});
MonitoringContentAccessLog.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});
MonitoringContentAccessLog.belongsTo(User, {
  foreignKey: "viewer_user_id",
  as: "viewer",
});
MonitoringContentAccessLog.belongsTo(User, {
  foreignKey: "target_user_id",
  as: "targetUser",
});

// MonitoringLiveScreenSession — audit metadata only (gated by liveScreenGate.js)
Organization.hasMany(MonitoringLiveScreenSession, {
  foreignKey: "organization_id",
  as: "monitoringLiveScreenSessions",
});
MonitoringLiveScreenSession.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});
MonitoringLiveScreenSession.belongsTo(User, {
  foreignKey: "viewer_user_id",
  as: "viewer",
});
MonitoringLiveScreenSession.belongsTo(User, {
  foreignKey: "target_user_id",
  as: "targetUser",
});
MonitoringLiveScreenSession.belongsTo(MonitoringAgent, {
  foreignKey: "agent_id",
  as: "agent",
});

// MonitoringScreenshotRequest — audit metadata only, separate feature from
// Live Screen. No image data column exists on this model or its table.
Organization.hasMany(MonitoringScreenshotRequest, {
  foreignKey: "organization_id",
  as: "monitoringScreenshotRequests",
});
MonitoringScreenshotRequest.belongsTo(Organization, {
  foreignKey: "organization_id",
  as: "organization",
});
MonitoringScreenshotRequest.belongsTo(User, {
  foreignKey: "viewer_user_id",
  as: "viewer",
});
MonitoringScreenshotRequest.belongsTo(User, {
  foreignKey: "target_user_id",
  as: "targetUser",
});
MonitoringScreenshotRequest.belongsTo(MonitoringAgent, {
  foreignKey: "agent_id",
  as: "agent",
});

module.exports = {
  User,
  Organization,
  AuthIdentity,
  PasswordResetToken,
  OrganizationMember,
  OrganizationInvitation,
  Project,
  ProjectMember,
  Task,
  Subtask,
  Comment,
  Tag,
  Attachment,
  Notification,
  Question,
  QuestionAnswer,
  MonitoringAgent,
  MonitoringEnrollment,
  MonitoringActivity,
  Activity,
  TaskMessage,
  TaskChatRead,
  TaskMember,
  Conversation,
  ConversationMember,
  Message,
  MonitoringEvent,
  MonitoringPcSession,
  MonitoringInterval,
  MonitoringAppSession,
  MonitoringWebSession,
  MonitoringUserDaySummary,
  MonitoringRecomputeQueue,
  MonitoringOrgSetting,
  MonitoringBlocklistDomain,
  MonitoringConsent,
  MonitoringContentEvent,
  MonitoringContentGrant,
  MonitoringContentAccessLog,
  MonitoringLiveScreenSession,
  MonitoringScreenshotRequest,
};
