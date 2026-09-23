"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("password_reset_tokens", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER.UNSIGNED,
      },

      user_id: {
        type: Sequelize.INTEGER.UNSIGNED,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },

      token_hash: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },

      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },

      used_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },

      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },

      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.NOW,
      },
    });

    await queryInterface.addIndex("password_reset_tokens", ["token_hash"], {
      unique: true,
      name: "password_reset_tokens_token_hash_unique",
    });

    await queryInterface.addIndex(
      "password_reset_tokens",
      ["user_id", "expires_at"],
      {
        name: "password_reset_tokens_user_expiry_idx",
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable("password_reset_tokens");
  },
};
