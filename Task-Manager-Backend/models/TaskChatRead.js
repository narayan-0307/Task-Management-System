const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const TaskChatRead = sequelize.define(
  "TaskChatRead",
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
    user_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    last_read_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "task_chat_reads",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = TaskChatRead;
