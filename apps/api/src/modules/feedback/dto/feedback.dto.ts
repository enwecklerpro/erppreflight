import { IsString, IsNotEmpty, IsOptional, IsEnum, IsUUID, MaxLength } from 'class-validator';

export enum FeedbackType {
  FEATURE_REQUEST = 'FEATURE_REQUEST',
  ACCURACY_DISPUTE = 'ACCURACY_DISPUTE',
  GAP_VOTE = 'GAP_VOTE',
}

export enum FeedbackStatus {
  UNDER_REVIEW = 'UNDER_REVIEW',
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  SHIPPED = 'SHIPPED',
  DECLINED = 'DECLINED',
}

export class CreateFeedbackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  description: string;

  @IsEnum(FeedbackType)
  @IsOptional()
  feedbackType?: FeedbackType = FeedbackType.FEATURE_REQUEST;

  @IsUUID()
  @IsOptional()
  projectId?: string;

  @IsUUID()
  @IsOptional()
  findingId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  targetEngine?: string;
}

export class UpdateFeedbackStatusDto {
  @IsEnum(FeedbackStatus)
  status: FeedbackStatus;
}
