/**
 * Creates a staff account WITHOUT a password and prints a single-use, 72-hour link that the
 * person uses to set their own password. No credentials are ever generated or stored in code.
 *
 *   npm run create-staff -- --name "Usama M. Usman" --email usama@example.com --role admin --title "BDM"
 *   npm run create-staff -- --name "Shuja Mubeen" --email shuja@example.com --role sales_executive --title "Online Sales Executive"
 *
 * Roles: admin (Super Administrator) | administrator | content_editor (Content Manager) | product_manager | order_manager | sales_executive (run seed:base or migrate first).
 */
import { Role, User } from '../models';
import { createResetToken, resetLink } from '../modules/auth/auth.service';
import { seedBase } from '../seed/seed';
import { arg, run } from './_run';

run(async () => {
  const name = arg('name');
  const email = arg('email')?.toLowerCase();
  const roleKey = arg('role') ?? 'admin';
  const title = arg('title') ?? '';
  if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Usage: npm run create-staff -- --name "Full Name" --email person@company.com --role admin [--title "Job title"]');
  }
  await seedBase();
  const role = await Role.findOne({ key: roleKey }).lean();
  if (!role) throw new Error(`Unknown role "${roleKey}"`);
  let user = await User.findOne({ email });
  if (user && user.type !== 'staff') throw new Error('That email belongs to a customer account');
  if (!user) user = await User.create({ type: 'staff', name, email, title, role: role._id, preferredLang: 'en' });
  else await User.updateOne({ _id: user._id }, { $set: { role: role._id, active: true, title } });
  const token = await createResetToken(user._id, 72 * 60);
  return `Staff account ready: ${name} <${email}> — role: ${role.key}\nSet-password link (valid 72 hours, single use — deliver privately):\n${resetLink(token, 'en', true)}`;
});
