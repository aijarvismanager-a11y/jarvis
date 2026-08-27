import { startServer } from './server';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4173;

startServer(PORT);
