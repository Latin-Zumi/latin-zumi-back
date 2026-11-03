declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        sessionId: string;
        passwordChangeRequired: boolean;
        roles: string[];
      };
    }
  }
}

export {};
