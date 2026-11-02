import { Test } from '@nestjs/testing';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import {
  NotificationsController,
  AdminNotificationsController,
} from './notifications.controller';
import { ProviderNotificationsService } from '../exchange/provider-notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('notification HTTP access boundaries', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [NotificationsController, AdminNotificationsController],
      providers: [
        {
          provide: ProviderNotificationsService,
          useValue: {
            countUnread: async (_userId: string, audience = 'ADMIN') =>
              audience === 'ADMIN' ? 51 : 3,
            list: async (userId: string, audience = 'ADMIN') => [
              { userId, audience },
            ],
            read: async (
              userId: string,
              id: string,
              key: string,
              audience = 'ADMIN',
            ) => ({ userId, id, key, audience }),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          if (!req.headers.authorization) throw new UnauthorizedException();
          req.user =
            req.headers.authorization === 'Bearer admin'
              ? { userId: 'admin-a', role: 'ADMIN' }
              : { userId: 'customer-a', role: 'USER' };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('requires authentication and restricts admin access by role', async () => {
    await request(app.getHttpServer()).get('/api/notifications').expect(401);
    await request(app.getHttpServer())
      .get('/api/admin/notifications')
      .set('Authorization', 'Bearer user')
      .expect(403);
    const response = await request(app.getHttpServer())
      .get('/api/admin/notifications')
      .set('Authorization', 'Bearer admin')
      .expect(200);
    expect(response.body).toEqual([{ userId: 'admin-a', audience: 'ADMIN' }]);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/admin/notifications/unread-count')
          .set('Authorization', 'Bearer admin')
          .expect(200)
      ).body,
    ).toEqual({ unreadCount: 51 });
  });
  it('derives customer scope from authentication and ignores injected audience parameters', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/notifications?audience=ADMIN&userId=other')
      .set('Authorization', 'Bearer user')
      .expect(200);
    expect(response.body).toEqual([
      { userId: 'customer-a', audience: 'USER:customer-a' },
    ]);
    const count = await request(app.getHttpServer())
      .get('/api/notifications/unread-count?audience=ADMIN')
      .set('Authorization', 'Bearer user')
      .expect(200);
    expect(count.body).toEqual({ unreadCount: 3 });
    const id = '77c5ec0f-c9ca-4616-b111-cab7c455c653';
    const read = await request(app.getHttpServer())
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', 'Bearer user')
      .set('X-Idempotency-Key', 'mutation:synthetic-key-1234')
      .expect(201);
    expect(read.body).toMatchObject({
      userId: 'customer-a',
      audience: 'USER:customer-a',
      key: 'mutation:synthetic-key-1234',
    });
    await request(app.getHttpServer())
      .post('/api/notifications/not-a-uuid/read')
      .set('Authorization', 'Bearer user')
      .expect(400);
  });
});
