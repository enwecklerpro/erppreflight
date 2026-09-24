import { Injectable } from '@nestjs/common';
import { AuditService } from './audit.service';

@Injectable()
export class AuditTrailService extends AuditService {}
