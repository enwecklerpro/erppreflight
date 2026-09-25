import { z } from 'zod';

export const UpdateUserRoleDtoSchema = z.object({
  systemRole: z.enum(['USER', 'ADMIN', 'SUPER_ADMIN']),
});

export type UpdateUserRoleDto = z.infer<typeof UpdateUserRoleDtoSchema>;
