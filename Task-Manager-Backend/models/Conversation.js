const { DataTypes } = require("sequelize");
const { sequelize } = require("../config/db");

const Conversation = sequelize.define(
  "Conversation",
  {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },

    organization_id: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },

    type: {
      type: DataTypes.ENUM("org_wide", "direct", "group"),
      allowNull: false,
    },

    name: {
      type: DataTypes.STRING,
      allowNull: true,
    },

    created_by: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
  },
  {
    tableName: "conversations",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = Conversation;
