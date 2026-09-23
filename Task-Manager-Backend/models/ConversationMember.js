const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const ConversationMember = sequelize.define(
  "ConversationMember",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    conversation_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },

    user_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },

    joined_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },

    last_read_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    tableName: "conversation_members",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = ConversationMember;
