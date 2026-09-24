import { z } from 'zod';
import { RoleEnum } from './common';

export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255),
  planTier: z.enum(['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE']).default('FREE'),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']).default('ACTIVE'),
  dataPolicy: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type Organization = z.infer<typeof OrganizationSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string().optional().nullable(),
  systemRole: z.enum(['USER', 'ADMIN', 'SUPER_ADMIN']).default('USER'),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).default('ACTIVE'),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type User = z.infer<typeof UserSchema>;

export const OrganizationMemberSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: RoleEnum.default('VIEWER'),
  permissions: z.array(z.string()).default([]),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type OrganizationMember = z.infer<typeof OrganizationMemberSchema>;
