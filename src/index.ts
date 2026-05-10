import http from 'http';
import { app } from './app';
import { initSocketIO } from './services/socketService';
import { initFreeSampleSweepJob } from './jobs/freeSampleSweep';

initFreeSampleSweepJob();

const httpServer = http.createServer(app);
initSocketIO(httpServer);

const port = process.env.PORT || 4000;
httpServer.listen(port, () => {
    console.log(`🚀 REST Server ready at: http://localhost:${port}/ping`);
    console.log(`🚀 GraphQL Server ready at: http://localhost:${port}/graphql`);
});
