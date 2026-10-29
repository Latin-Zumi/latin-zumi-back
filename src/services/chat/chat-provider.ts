export type ChatRole = 'user' | 'assistant';

export interface ChatHistoryEntry {
  role: ChatRole;
  content: string;
}

export interface ChatGroundingContext {
  accounts: Array<{
    currency: string;
    account_type: string;
    balance: string;
  }>;
  recentTransactions: Array<{
    description: string | null;
    occurred_at: Date | string;
    entries: Array<{
      amount: string;
      direction: 'debit' | 'credit';
      currency: string;
    }>;
  }>;
}

export interface ChatProviderRequest {
  message: string;
  conversationId: string;
  history?: ChatHistoryEntry[];
  context?: ChatGroundingContext;
}

export interface ChatProviderReply {
  message: string;
  conversationId: string;
  suggestions: string[];
}

export interface ChatProvider {
  generateReply(input: ChatProviderRequest): Promise<ChatProviderReply>;
}
