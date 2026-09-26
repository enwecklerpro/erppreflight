import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Password length bounds; the full policy is enforced by passwordPolicyViolations(). */
const PASSWORD_MAX = 128;

export class LoginDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(320)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  password: string;
}

export class RegisterDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(PASSWORD_MAX)
  password: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  fullName?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  organizationName: string;
}

export class TokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/, { message: 'Invalid or malformed token' })
  token: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(320)
  email: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @MaxLength(PASSWORD_MAX)
  newPassword: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  currentPassword: string;

  @IsString()
  @MaxLength(PASSWORD_MAX)
  newPassword: string;
}

export class PasswordConfirmationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  password: string;
}

export class TotpCodeDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code: string;
}

/** Either a 6-digit TOTP code or a recovery code. */
export class SecondFactorDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{5}-?[A-Za-z0-9]{5}$/, { message: 'Invalid recovery code format' })
  recoveryCode?: string;
}

export class LoginSecondFactorDto extends SecondFactorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  challengeToken: string;
}

export class DisableTwoFactorDto extends SecondFactorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  password: string;
}

export class DeleteAccountDto extends SecondFactorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX)
  password: string;

  @IsString()
  @IsIn(['DELETE MY ACCOUNT'], { message: 'Type DELETE MY ACCOUNT to confirm' })
  confirmation: string;

  /**
   * Ids of organizations the caller is the sole owner of, acknowledged for deletion.
   * Must match the server-computed list exactly (see GET /account/deletion-impact).
   */
  @IsOptional()
  @IsString({ each: true })
  confirmOrganizationDeletion?: string[];
}

export class SwitchOrganizationDto {
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  organizationId: string;
}

export class OrganizationSecurityPolicyDto {
  @IsBoolean()
  require2fa: boolean;
}
