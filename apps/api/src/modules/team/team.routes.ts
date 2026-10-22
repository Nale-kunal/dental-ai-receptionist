import { Router } from 'express';
import { authenticate } from '../../middleware/authentication/authenticate';
import { prisma } from '../../database/prisma/client';
import { getAuthenticatedClinicId } from '../../middleware/authorization/tenantScope';
import { sendSuccess } from '../../utils/response';

export const teamRouter = Router();
teamRouter.use(authenticate);

teamRouter.get('/', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const members = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, clinic_id, auth_subject, full_name, email, role, active, created_at
       FROM api.users
       WHERE clinic_id = $1::uuid
       ORDER BY full_name ASC`,
      clinicId
    );

    sendSuccess(res, members.map((m) => {
      const parts = (m.full_name || '').split(' ');
      return {
        id: m.id,
        email: m.email,
        fullName: m.full_name,
        firstName: parts[0] || '',
        lastName: parts.slice(1).join(' ') || '',
        roles: [m.role],
        role: m.role,
        isActive: m.active,
        createdAt: new Date(m.created_at).toISOString(),
      };
    }));
  } catch (e) { next(e); }
});

teamRouter.patch('/:userId/role', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const { role } = req.body;
    if (!role) return sendSuccess(res, null, 'Invalid role');

    await prisma.$queryRawUnsafe(
      `UPDATE api.users SET role = $3 WHERE id = $1::uuid AND clinic_id = $2::uuid`,
      req.params.userId,
      clinicId,
      role
    );

    sendSuccess(res, { userId: req.params.userId, role }, 'Role updated');
  } catch (e) { next(e); }
});

teamRouter.patch('/:userId/status', async (req, res, next) => {
  try {
    const clinicId = getAuthenticatedClinicId(req);
    const { isActive, active } = req.body;
    const newActive = Boolean(isActive ?? active);

    await prisma.$queryRawUnsafe(
      `UPDATE api.users SET active = $3 WHERE id = $1::uuid AND clinic_id = $2::uuid`,
      req.params.userId,
      clinicId,
      newActive
    );

    sendSuccess(res, { userId: req.params.userId, isActive: newActive });
  } catch (e) { next(e); }
});
