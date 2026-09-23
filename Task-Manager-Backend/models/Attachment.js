const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const Attachment = sequelize.define(
  "Attachment",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    task_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    comment_id: {
  type: DataTypes.INTEGER.UNSIGNED,
  allowNull: true,
},
    subtask_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    question_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    question_answer_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    message_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    org_message_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    organization_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    uploaded_by: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    file_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    file_path: {
      type: DataTypes.STRING(500),
      allowNull: false,
    },
    file_size: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    mime_type: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
  },
  {
    tableName: "attachments",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = Attachment;