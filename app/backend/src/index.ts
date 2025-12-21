import express from 'express';
import cors from 'cors';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './trpc';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// tRPC endpoint
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
  })
);

// Health check
app.get('/', (req, res) => {
  res.send('<h1>RelayKit</h1><p>Backend running</p>');
});

app.listen(PORT, () => {
  console.log(`RelayKit backend running on port ${PORT}`);
});

