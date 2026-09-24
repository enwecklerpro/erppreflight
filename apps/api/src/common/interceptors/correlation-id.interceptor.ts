import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    let correlationId = request.headers['x-correlation-id'];
    if (!correlationId) {
      correlationId = uuidv4();
      request.headers['x-correlation-id'] = correlationId;
    }

    response.setHeader('X-Correlation-Id', correlationId);
    return next.handle();
  }
}
