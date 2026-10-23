import '@fastify/jwt';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; phoneNumber?: string };
    user: { sub: string; phoneNumber?: string };
  }
}
