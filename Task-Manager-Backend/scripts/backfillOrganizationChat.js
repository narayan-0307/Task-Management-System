"use strict";

/**
 * ONE-TIME LOCAL DEVELOPMENT BACKFILL — Step 19.
 *
 * Organizations created before Organization Chat provisioning existed have
 * no org_wide "HumanCare Team" Conversation / ConversationMember rows,
 * because ensureOrganizationChat() is only wired into forward-looking
 * register()/acceptInvitation() flows (see Step 18's audit). This script
 * runs that SAME existing, idempotent, self-healing function once for
 * every organization that already exists, so it never needs to run again
 * once those rows are in place.
 *
 * This script does not duplicate any provisioning logic -- it only loads
 * organizations and calls the existing ensureOrganizationChat().
 *
 * Usage (local development only):
 *   node scripts/backfillOrganizationChat.js
 */

const { sequelize } = require("../config/db");
const { Organization } = require("../models");
const { ensureOrganizationChat } = require("../services/organizationChatProvisioning");

async function main() {
  await sequelize.authenticate();

  const env = process.env.NODE_ENV === "production" ? "production" : "development";
  // Safety guard: refuse to run against anything that looks like production.
  if (env === "production") {
    console.error(
      "Refusing to run: NODE_ENV=production. This script is for local development only.",
    );
    process.exit(1);
  }

  const { database, host } = sequelize.config;
  console.log(`Connected to database "${database}" on host "${host}".`);

  const organizations = await Organization.findAll({
    attributes: ["id", "name"],
    order: [["id", "ASC"]],
  });

  console.log(`Found ${organizations.length} organization(s) to process.\n`);

  let successCount = 0;
  let failureCount = 0;

  for (const org of organizations) {
    try {
      const conversation = await ensureOrganizationChat(org.id);
      successCount += 1;
      console.log(
        `OK    org_id=${org.id} name="${org.name}" -> conversation_id=${conversation.id}`,
      );
    } catch (error) {
      failureCount += 1;
      console.error(
        `FAIL  org_id=${org.id} name="${org.name}" -> ${error.message}`,
      );
    }
  }

  console.log("\n--- Summary ---");
  console.log(`Total processed: ${organizations.length}`);
  console.log(`Successful:      ${successCount}`);
  console.log(`Failed:          ${failureCount}`);

  await sequelize.close();

  process.exit(failureCount > 0 ? 1 : 0);
}

main().catch(async (error) => {
  console.error("Backfill script crashed:", error.message);
  try {
    await sequelize.close();
  } catch {
    // ignore
  }
  process.exit(1);
});
