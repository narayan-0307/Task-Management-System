const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const TaskMessage = sequelize.define(
  "TaskMessage",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    task_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    organization_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    sender_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    deleted_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "task_messages",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = TaskMessage;
