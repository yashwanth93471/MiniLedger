import type { FastifyPluginAsync } from 'fastify';
import type { OtpService } from '../auth/otp-service';

const phoneNumberPattern = /^\+[1-9]\d{7,14}$/;
const otpPattern = /^\d{6}$/;

interface AuthRouteOptions {
  otpService: OtpService;
  users: {
    upsert(phoneNumber: string): Promise<{ id: string; phoneNumber: string }>;
  };
}

const authRoutes: FastifyPluginAsync<AuthRouteOptions> = async (app, options) => {
  app.post<{ Body: { phoneNumber?: unknown } }>('/otp/request', async (request, reply) => {
    const { phoneNumber } = request.body ?? {};
    if (typeof phoneNumber !== 'string' || !phoneNumberPattern.test(phoneNumber)) {
      return reply.code(400).send({ error: 'A valid phoneNumber in international format is required.' });
    }

    options.otpService.request(phoneNumber);
    return reply.code(200).send({ message: 'OTP sent.' });
  });

  app.post<{ Body: { phoneNumber?: unknown; otp?: unknown } }>('/otp/verify', async (request, reply) => {
    const { phoneNumber, otp } = request.body ?? {};
    if (typeof phoneNumber !== 'string' || !phoneNumberPattern.test(phoneNumber) || typeof otp !== 'string' || !otpPattern.test(otp)) {
      return reply.code(400).send({ error: 'A valid phoneNumber and six-digit otp are required.' });
    }

    if (!options.otpService.verify(phoneNumber, otp)) {
      return reply.code(401).send({ error: 'Invalid or expired OTP.' });
    }

    const user = await options.users.upsert(phoneNumber);
    const token = app.jwt.sign({ sub: user.id, phoneNumber: user.phoneNumber }, { expiresIn: '1h' });
    return reply.send({ token, tokenType: 'Bearer' });
  });
};

export default authRoutes;
