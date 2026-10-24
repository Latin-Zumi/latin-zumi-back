declare module 'swagger-ui-express' {
  import type { RequestHandler } from 'express';

  const swaggerUi: {
    serve: RequestHandler[];
    setup: (swaggerDoc: object) => RequestHandler;
  };

  export default swaggerUi;
}
