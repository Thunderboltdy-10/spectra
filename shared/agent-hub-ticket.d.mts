export declare const AGENT_HUB_AUDIENCE: "spectra-agent-hub";
export declare function signAgentHubTicket(claims: { sub: string; exp: number }, key: string): Promise<string>;
/** A ticket for `accountId` that lasts `lifetimeMs`. */
export declare function agentHubTicket(accountId: string, key: string, lifetimeMs: number): Promise<string>;
