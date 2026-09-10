import express from 'express';
import cors from 'cors';
import { menusRouter } from './routes/menus';
import { ordersRouter } from './routes/orders';

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/menus', menusRouter);
app.use('/api/orders', ordersRouter);

const port = process.env.PORT || 3333;
const server = app.listen(port, () => {
  console.log(`ourmenu api listening at http://localhost:${port}/api`);
});
server.on('error', console.error);
