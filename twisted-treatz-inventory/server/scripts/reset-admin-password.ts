// Blessed recovery path for a locked-out admin (no SMTP = no self-service
// reset). Run from the Railway shell or locally against the prod DB.
//
//   npx tsx --env-file=.env scripts/reset-admin-password.ts <email> [newPassword]
//
// If newPassword is omitted, a strong one is generated and printed once.
// Only ever updates an EXISTING admin — never creates one.
import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../src/lib/prisma.js";

function strongPassword(): string {
  return randomBytes(14).toString("base64url").slice(0, 18);
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error(
      "Usage: npx tsx --env-file=.env scripts/reset-admin-password.ts <email> [newPassword]",
    );
    process.exit(1);
  }

  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin) {
    console.error(`No admin with email ${email}. (This script never creates one.)`);
    process.exit(1);
  }

  const newPassword = process.argv[3] ?? strongPassword();
  if (newPassword.length < 10) {
    console.error("New password must be at least 10 characters.");
    process.exit(1);
  }

  await prisma.admin.update({
    where: { id: admin.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 12) },
  });

  console.log(`\nPassword reset for ${email}.`);
  console.log(`New password: ${newPassword}`);
  console.log("Save it now — it is not stored anywhere else.\n");
}

main()
  .catch((e) => {
    console.error("Reset failed:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
