// Este módulo solo se encarga de levantar el servidor
import { app } from './server.js';
import { env } from './config/env.js';

app.listen(env.PORT, () => {
    console.log(`Server listening on port ${env.PORT}`);
});
