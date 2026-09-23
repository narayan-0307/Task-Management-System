const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const Message = sequelize.define(
  "Message",
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
    tableName: "messages",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = Message;
