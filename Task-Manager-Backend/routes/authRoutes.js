const express = require("express");
const passport = require("passport");
const router = express.Router();
const { requireAuth } = require("../middleware/authMiddleware");
const {
  register,
  login,
  googleCallback,
  getMe,
  registerWithInvitation,
  forgotPassword,
  resetPassword,
} = require("../controllers/authController");

router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.get("/me", requireAuth, getMe);

router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  }),
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: "/login",
  }),
  googleCallback,
);

router.post("/register/invitation", registerWithInvitation);

module.exports = router;
