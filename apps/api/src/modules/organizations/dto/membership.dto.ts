import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export const ORGANIZATION_ROLES = [
  'ORGANIZATION_OWNER',
  'SECURITY_ADMIN',
  'LEAD_ARCHITECT',
  'MIGRATION_CONSULTANT',
  'AUDITOR',
  'VIEWER',
] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export class CreateInvitationDto {
  @IsEmail()
  @MaxLength(255)
  email: string;

  @IsIn(ORGANIZATION_ROLES as unknown as string[])
  role: OrganizationRole;
}

export class UpdateMemberRoleDto {
  @IsIn(ORGANIZATION_ROLES as unknown as string[])
  role: OrganizationRole;
}

export class InvitationTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'Invalid or malformed invitation token' })
  token: string;
}

export class AcceptInvitationNewAccountDto extends InvitationTokenDto {
  @IsString()
  @MaxLength(128)
  password: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fullName?: string;
}

export class OrganizationSecurityDto {
  @IsBoolean()
  require2fa: boolean;
}

export class DeleteOrganizationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;

  /** Must equal the organization's current name (typed confirmation). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  confirmName: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/)
  code?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/)
  recoveryCode?: string;
}
