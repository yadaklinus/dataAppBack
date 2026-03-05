const bcrypt = require('bcryptjs');
const prisma = require('./lib/prisma');

async function createInitialSuperAdmin() {
    const defaultEmail = 'admin@mufti.com';
    const defaultPassword = 'Mufti@12345'; // Explicitly distinct from the staff password
    const fullName = 'Mufti Pay Super Admin';

    console.log(`Checking if Super Admin (${defaultEmail}) already exists...`);

    try {
        const existingAdmin = await prisma.staff.findUnique({
            where: { email: defaultEmail }
        });

        if (existingAdmin) {
            console.log("Super Admin already exists. No action taken.");
            return;
        }

        const passwordHash = await bcrypt.hash(defaultPassword, 10);

        const admin = await prisma.staff.create({
            data: {
                email: defaultEmail,
                fullName,
                passwordHash,
                role: 'SUPER_ADMIN',
                requiresPasswordChange: true // They should also change this on first login for safety
            }
        });

        console.log("\n================================================");
        console.log("✅ SUPER ADMIN CREATED SUCCESSFULLY");
        console.log("================================================");
        console.log(`Email: ${defaultEmail}`);
        console.log(`Temp Password: ${defaultPassword}`);
        console.log("Role: SUPER_ADMIN");
        console.log("\n⚠️ IMPORTANT: You MUST log in and change this password immediately via the force-reset endpoint.");
        console.log("================================================\n");

    } catch (error) {
        console.error("Failed to create Super Admin:", error);
    } finally {
        await prisma.$disconnect();
    }
}

createInitialSuperAdmin();
