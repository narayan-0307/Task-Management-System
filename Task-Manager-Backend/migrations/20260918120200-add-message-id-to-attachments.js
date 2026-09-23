"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("attachments", "message_id", {
      type: Sequelize.INTEGER.UNSIGNED,
      allowNull: true,
      references: {
        model: "task_messages",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    await queryInterface.addIndex("attachments", ["message_id"]);
  },

  async down(queryInterface) {
    // MySQL ties the FK constraint to the index backing it, so the
    // constraint must be dropped before the index/column can go.
    await queryInterface.removeConstraint(
      "attachments",
      "attachments_message_id_foreign_idx",
    );
    await queryInterface.removeIndex("attachments", ["message_id"]);
    await queryInterface.removeColumn("attachments", "message_id");
  },
};
