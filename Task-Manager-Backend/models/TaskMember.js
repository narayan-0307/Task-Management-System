const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const TaskMember = sequelize.define(
  "TaskMember",
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

    added_by: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
  },
  {
    tableName: "task_members",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = TaskMember;
