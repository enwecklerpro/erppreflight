import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';

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
  title: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsEnum(FeedbackType)
  @IsOptional()
  feedbackType?: FeedbackType = FeedbackType.FEATURE_REQUEST;

  @IsString()
  @IsOptional()
  projectId?: string;

  @IsString()
  @IsOptional()
  findingId?: string;

  @IsString()
  @IsOptional()
  targetEngine?: string;
}

export class UpdateFeedbackStatusDto {
  @IsEnum(FeedbackStatus)
  status: FeedbackStatus;
}
