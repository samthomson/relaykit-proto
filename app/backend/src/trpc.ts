import { initTRPC } from '@trpc/server';

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const appRouter = router({
  getRandomNumber: publicProcedure.query(() => {
    return Math.floor(Math.random() * 1000);
  }),
});

export type AppRouter = typeof appRouter;

