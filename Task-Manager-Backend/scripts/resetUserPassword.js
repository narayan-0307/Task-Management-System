require("dotenv").config();

const bcrypt = require("bcrypt");
const { sequelize } = require("../config/db");
const { User, AuthIdentity } = require("../models");

async function resetPassword() {
  try {
    await sequelize.authenticate();
    console.log("✅ Database connected.");

    const user = await User.findByPk(21);

    if (!user) {
      console.log("❌ User 7 not found.");
      return;
    }

    const newPassword = "Temp@12345";
    const password_hash = await bcrypt.hash(newPassword, 10);

    const identity = await AuthIdentity.findOne({
      where: {
        user_id: user.id,
        provider: "local",
      },
    });

    if (!identity) {
      console.log("❌ Local password identity not found.");
      return;
    }

    identity.password_hash = password_hash;
    await identity.save();

    console.log("✅ Password reset successfully.");
    console.log("User:", user.email);
    console.log("New password:", newPassword);
  } catch (error) {
    console.error("❌ Error resetting password:", error);
  } finally {
    await sequelize.close();
  }
}

resetPassword();
