"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("attachments", "org_message_id", {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: "messages",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    await queryInterface.addIndex("attachments", ["org_message_id"]);
  },

  async down(queryInterface) {
    // MySQL ties the FK constraint to the index backing it, so the
    // constraint must be dropped before the index/column can go (mirrors
    // 20260918120200-add-message-id-to-attachments.js).
    await queryInterface.removeConstraint(
      "attachments",
      "attachments_org_message_id_foreign_idx",
    );
    await queryInterface.removeIndex("attachments", ["org_message_id"]);
    await queryInterface.removeColumn("attachments", "org_message_id");
  },
};
